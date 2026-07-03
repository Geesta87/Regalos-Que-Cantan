// supabase/functions/competitor-scan/index.ts
// ===========================================================================
// COMPETITORS — weekly scan + rate
// ===========================================================================
// Pulls personalized-song competitors' ACTIVE Facebook ads from the Ad Library
// (ScrapeCreators API) across ES + EN keywords, de-dupes, and has Claude rate
// each (hook, angle, why it works, how long it's been running, fit for RQC, and
// a suggested RQC angle). Stores into competitor_ads for the Competitors tab.
//
// verify_jwt = false (pg_cron + manual). Reads SCRAPECREATORS_API_KEY +
// ANTHROPIC_API_KEY. ~1 credit per keyword.
// Deploy: supabase functions deploy competitor-scan --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SC_KEY = Deno.env.get('SCRAPECREATORS_API_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('COMPETITOR_MODEL') || 'claude-opus-4-8';
const SC = 'https://api.scrapecreators.com/v1/facebook/adLibrary/search/ads';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// ES + EN keywords that surface personalized-song advertisers.
const KEYWORDS: { q: string; lang: string }[] = [
  // Spanish — US-Hispanic + Mexico
  { q: 'canción personalizada', lang: 'es' },
  { q: 'canción con tu nombre', lang: 'es' },
  { q: 'regalo canción personalizada', lang: 'es' },
  { q: 'canción para dedicar', lang: 'es' },
  { q: 'canción de cumpleaños personalizada', lang: 'es' },
  { q: 'corrido personalizado', lang: 'es' },
  { q: 'serenata personalizada', lang: 'es' },
  { q: 'canción para regalar', lang: 'es' },
  // English — US
  { q: 'personalized song gift', lang: 'en' },
  { q: 'custom song for someone', lang: 'en' },
  { q: 'make a song as a gift', lang: 'en' },
  { q: 'custom song for her', lang: 'en' },
  { q: 'birthday song with name', lang: 'en' },
  { q: 'anniversary custom song', lang: 'en' },
];
// Regions to search. Same ad running in both is de-duped by ad_archive_id/creative.
const REGIONS = (Deno.env.get('COMPETITOR_REGIONS') || 'US,MX').split(',').map((c) => c.trim()).filter(Boolean);
const PER_KEYWORD = Number(Deno.env.get('COMPETITOR_PER_KEYWORD') || '8');
const MAX_NEW = Number(Deno.env.get('COMPETITOR_MAX_NEW') || '30');
// Our own pages — never list ourselves as a "competitor".
const OWN_BRANDS = ['regalos que cantan', 'giftmosongmo', 'gift mo song mo'];
const isOwnBrand = (name: string | null) => !!name && OWN_BRANDS.includes(name.trim().toLowerCase());

function shapeAd(r: any, lang: string) {
  const s = r.snapshot || {};
  const img = s.images?.[0]?.original_image_url || s.images?.[0]?.resized_image_url || s.videos?.[0]?.video_preview_image_url || null;
  const vid = s.videos?.[0]?.video_hd_url || s.videos?.[0]?.video_sd_url || null;
  const start = r.start_date ? new Date(r.start_date * 1000) : null;
  return {
    ad_archive_id: String(r.ad_archive_id || ''),
    page_name: s.page_name || r.page_name || null,
    lang,
    media_type: vid ? 'video' : 'image',
    image_url: img, video_url: vid,
    body_text: (s.body?.text || '').slice(0, 1200) || null,
    cta_text: s.cta_text || null,
    is_active: !!r.is_active,
    ad_start: start ? start.toISOString() : null,
    active_days: start ? Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000)) : null,
    publisher_platforms: Array.isArray(r.publisher_platform) ? r.publisher_platform : null,
  };
}

async function scSearch(q: string, country: string): Promise<any[]> {
  const url = `${SC}?query=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}&status=ACTIVE&sort_by=total_impressions&trim=true`;
  const r = await fetch(url, { headers: { 'x-api-key': SC_KEY! } });
  if (!r.ok) { console.warn(`SC ${q}/${country} ${r.status}`); return []; }
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j.searchResults) ? j.searchResults : [];
}

// Batch-rate ads with Claude (one call). Returns ratings keyed by index.
const RATE_TOOL = {
  name: 'rate_competitor_ads',
  description: 'Rate each competitor personalized-song ad.',
  input_schema: {
    type: 'object',
    properties: {
      ratings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'integer', description: 'The ad index from the list.' },
            score: { type: 'integer', description: '0-100: how strong/effective this ad is.' },
            hook: { type: 'string', description: 'The core hook in a few words.' },
            angle: { type: 'string', description: 'The emotional/persuasive angle.' },
            why_working: { type: 'string', description: 'One line: why this likely performs (consider how long it has run).' },
            rqc_fit: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How well the concept fits Regalos Que Cantan.' },
            suggested_rqc_angle: { type: 'string', description: 'How RQC could do its own ORIGINAL version of this concept (no copying).' },
          },
          required: ['i', 'score', 'hook', 'angle', 'why_working', 'rqc_fit', 'suggested_rqc_angle'],
        },
      },
    },
    required: ['ratings'],
  },
};

async function rate(ads: any[]): Promise<Record<number, any>> {
  if (!ANTHROPIC_API_KEY || ads.length === 0) return {};
  const list = ads.map((a, i) => `#${i} — ${a.page_name} (${a.lang}, running ${a.active_days ?? '?'} days, ${a.media_type})\nCopy: ${(a.body_text || '(none)').slice(0, 300)}\nCTA: ${a.cta_text || '(none)'}`).join('\n\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000,
      system: 'You are a direct-response ad strategist for "Regalos Que Cantan", a US-Hispanic brand selling personalized Spanish songs as gifts. Rate competitor personalized-song ads. An ad that has run a long time is usually a proven winner. Be sharp and concise.',
      tools: [RATE_TOOL], tool_choice: { type: 'tool', name: 'rate_competitor_ads' },
      messages: [{ role: 'user', content: `Rate these ${ads.length} competitor ads:\n\n${list}` }],
    }),
  });
  if (!res.ok) { console.warn(`rate ${res.status}`); return {}; }
  const data = await res.json();
  const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
  const out: Record<number, any> = {};
  for (const r of (tu?.input?.ratings || [])) out[r.i] = r;
  return out;
}

// Meta Ad Library media URLs EXPIRE (hours–days), which is why previews go blank.
// Download the display thumbnail once and mirror it to our own public bucket so
// it stays valid. Returns the durable URL, or null (caller keeps the original).
//
// fbcdn rejects header-less serverless fetches, so send a browser User-Agent and
// retry once. Every failure is LOGGED (previously silent) so we can see which ads
// fail to cache and why.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
async function cacheThumb(supabase: any, url: string | null, key: string): Promise<string | null> {
  if (!url) return null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'image/avif,image/webp,image/png,image/*,*/*;q=0.8' } });
      if (!r.ok) { console.warn(`cacheThumb ${key} attempt ${attempt}: HTTP ${r.status}`); continue; }
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength < 500) { console.warn(`cacheThumb ${key}: tiny body ${bytes.byteLength}b (placeholder?)`); return null; }
      const path = `competitor/${key}.jpg`;
      const { error } = await supabase.storage.from('creative-studio').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (error) { console.warn(`cacheThumb ${key}: upload failed ${error.message}`); return null; }
      const { data } = supabase.storage.from('creative-studio').getPublicUrl(path);
      return data?.publicUrl || null;
    } catch (e) { console.warn(`cacheThumb ${key} attempt ${attempt}: ${e}`); }
  }
  return null;
}

// True once a URL is our own durable copy (Supabase storage), false for an
// expiring fbcdn/Meta URL or null. Used to avoid overwriting good cache.
const isDurable = (u: string | null | undefined) => !!u && u.includes('/storage/v1/object/');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const json = (s: number, b: any) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // REPAIR mode: re-cache every ad whose poster isn't durable yet, straight from
  // its stored URL — no Ad Library search, so it costs no ScrapeCreators credits.
  // Fixes tiles whose fbcdn URL is still alive (e.g. refreshed in a recent scan)
  // but never got mirrored to our bucket. Truly-dead URLs fail gracefully.
  let reqBody: any = {}; try { reqBody = await req.json(); } catch { reqBody = {}; }
  if (reqBody?.mode === 'repair') {
    const { data: rows } = await supabase.from('competitor_ads')
      .select('ad_archive_id, image_url').neq('status', 'dismissed');
    const targets = (rows || []).filter((r: any) => r.image_url && !isDurable(r.image_url));
    let fixed = 0, failed = 0;
    await Promise.all(targets.map(async (r: any) => {
      const durable = await cacheThumb(supabase, r.image_url, r.ad_archive_id);
      if (durable) { await supabase.from('competitor_ads').update({ image_url: durable }).eq('ad_archive_id', r.ad_archive_id); fixed++; }
      else { failed++; }
    }));
    await supabase.from('agent_runs').insert({ agent: 'competitor-scan', status: 'ok', ok: true, summary: `Repair: fixed ${fixed}/${targets.length} blank posters (${failed} still unreachable)`, finished_at: new Date().toISOString(), execution_ms: Date.now() - start }).then(() => {}, () => {});
    return json(200, { success: true, mode: 'repair', targets: targets.length, fixed, failed });
  }

  if (!SC_KEY) return json(200, { success: false, skipped: true, reason: 'SCRAPECREATORS_API_KEY missing' });

  try {
    // Pull + flatten + shape. De-dupe by ad id AND by creative (same video/image
    // run under different ad ids / languages should only appear once).
    // Fire every keyword×region search in parallel — sequential was ~28 round-trips
    // and blew past the 150s edge timeout, which would kill the weekly cron.
    const pairs = KEYWORDS.flatMap((k) => REGIONS.map((country) => ({ k, country })));
    const searchResults = await Promise.all(pairs.map(async (p) => ({ lang: p.k.lang, results: await scSearch(p.k.q, p.country) })));

    // De-dupe by ad id AND by creative (same video/image run under different ad
    // ids / languages / regions should only appear once). Processed in a stable
    // order so the winner (first hit) is deterministic.
    const seen = new Set<string>();
    const seenMedia = new Set<string>();
    const collected: any[] = [];
    for (const { lang, results } of searchResults) {
      for (const r of results.slice(0, PER_KEYWORD)) {
        const ad = shapeAd(r, lang);
        if (!ad.ad_archive_id || seen.has(ad.ad_archive_id)) continue;
        if (isOwnBrand(ad.page_name)) continue; // never surface our own ads
        const mkey = (ad.video_url || ad.image_url || '').split('?')[0];
        if (mkey && seenMedia.has(mkey)) continue; // same creative already collected
        seen.add(ad.ad_archive_id);
        if (mkey) seenMedia.add(mkey);
        collected.push(ad);
      }
    }

    // Split into brand-new vs already-stored.
    const ids = collected.map((a) => a.ad_archive_id);
    const { data: existing } = await supabase.from('competitor_ads').select('ad_archive_id').in('ad_archive_id', ids);
    const have = new Set((existing || []).map((e: any) => e.ad_archive_id));
    const fresh = collected.filter((a) => !have.has(a.ad_archive_id)).slice(0, MAX_NEW);

    // REFRESH + SELF-HEAL: ads we already have that showed up again in this scan
    // (still active) get fresh media + a re-cached durable thumbnail — this repairs
    // the blank "Vista previa no disponible" tiles whose old Meta URLs had expired.
    //
    // Fetch which stored rows already have a durable (cached) poster, so we NEVER
    // overwrite a working cached URL with a fresh-but-expiring fbcdn one (that was
    // the bug that let good tiles regress back to blank).
    const reSeen = collected.filter((a) => have.has(a.ad_archive_id));
    const { data: reRows } = await supabase.from('competitor_ads')
      .select('ad_archive_id, image_url').in('ad_archive_id', reSeen.map((a) => a.ad_archive_id));
    const storedImg = new Map((reRows || []).map((r: any) => [r.ad_archive_id, r.image_url as string | null]));
    let refreshed = 0, repaired = 0;
    await Promise.all(reSeen.map(async (a) => {
      const storedUrl = storedImg.get(a.ad_archive_id);
      const wasBlank = !isDurable(storedUrl);
      const durable = await cacheThumb(supabase, a.image_url, a.ad_archive_id);
      const update: Record<string, unknown> = { video_url: a.video_url, media_type: a.media_type, active_days: a.active_days };
      // Only touch image_url when we have a durable copy. If caching failed but the
      // stored one is still expiring, we at least fall back to the fresh fbcdn URL.
      if (durable) update.image_url = durable;
      else if (!isDurable(storedUrl)) update.image_url = a.image_url;
      const { error } = await supabase.from('competitor_ads').update(update).eq('ad_archive_id', a.ad_archive_id);
      if (!error) { refreshed++; if (wasBlank && durable) repaired++; }
    }));

    // Mirror each NEW ad's display thumbnail to our bucket so it never expires. Videos
    // keep their (expiring) video_url for playback but gain a durable poster here.
    let cachedFresh = 0;
    await Promise.all(fresh.map(async (a) => {
      const durable = await cacheThumb(supabase, a.image_url, a.ad_archive_id);
      if (durable) { a.image_url = durable; cachedFresh++; }
      else console.warn(`fresh ad ${a.ad_archive_id} (${a.page_name}): no durable poster, keeping ${a.image_url ? 'fbcdn' : 'null'}`);
    }));

    if (fresh.length === 0) {
      await supabase.from('agent_runs').insert({ agent: 'competitor-scan', status: 'ok', ok: true, summary: `No new competitor ads (refreshed ${refreshed}, repaired ${repaired} blank)`, finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
      return json(200, { success: true, scanned: collected.length, new: 0, refreshed, repaired });
    }

    // Rate in small chunks so the tool output never truncates, then store.
    const CHUNK = 10;
    let stored = 0;
    for (let off = 0; off < fresh.length; off += CHUNK) {
      const chunk = fresh.slice(off, off + CHUNK);
      const ratings = await rate(chunk);
      for (let j = 0; j < chunk.length; j++) {
        const a = chunk[j];
        const rt = ratings[j] || {};
        const { error } = await supabase.from('competitor_ads').insert({
          ...a,
          score: Number.isFinite(rt.score) ? rt.score : null,
          analysis: rt.hook ? { hook: rt.hook, angle: rt.angle, why_working: rt.why_working, rqc_fit: rt.rqc_fit, suggested_rqc_angle: rt.suggested_rqc_angle } : null,
          status: 'new',
        });
        if (!error) stored++;
      }
    }

    // TEAM FEED: hand the strongest high-fit finds straight to the Art Director
    // as inspiration (insights — he works them into his next batch; the owner
    // still approves every creative). Top 3 per scan, score ≥ 75 + high fit,
    // deduped against anything already posted in the last 30 days.
    try {
      const { data: topAds } = await supabase.from('competitor_ads')
        .select('ad_archive_id, page_name, analysis, score')
        .eq('status', 'new').gte('score', 75)
        .order('score', { ascending: false }).limit(6);
      const picks = (topAds || [])
        .filter((a: any) => a.analysis?.rqc_fit === 'high' && a.analysis?.suggested_rqc_angle)
        .slice(0, 3);
      if (picks.length) {
        const { data: existing } = await supabase.from('team_feed')
          .select('ref').eq('author', 'competitor-scan')
          .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString());
        const seen = new Set((existing || []).map((e: any) => e.ref?.ad_archive_id).filter(Boolean));
        const freshPicks = picks.filter((a: any) => !seen.has(a.ad_archive_id));
        if (freshPicks.length) {
          await supabase.from('team_feed').insert(freshPicks.map((a: any) => ({
            author: 'competitor-scan', kind: 'insight', audience: ['creative-studio'],
            title: `Working for "${a.page_name}" (score ${a.score}): ${String(a.analysis.hook || a.analysis.angle || '').slice(0, 140)}`,
            body: `Why it works: ${a.analysis.why_working || '—'} · Our original take: ${a.analysis.suggested_rqc_angle}`,
            ref: { ad_archive_id: a.ad_archive_id }, status: 'done', resolved_at: new Date().toISOString(),
          })));
        }
      }
    } catch (e) { console.warn('team_feed insight post failed', e); }

    await supabase.from('agent_runs').insert({ agent: 'competitor-scan', status: 'ok', ok: true, summary: `Stored ${stored} new competitor ads (${cachedFresh}/${fresh.length} cached, repaired ${repaired} blank)`, payload: { scanned: collected.length, stored, cachedFresh, refreshed, repaired }, finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
    return json(200, { success: true, scanned: collected.length, new: stored, cachedFresh, refreshed, repaired });
  } catch (e: any) {
    await supabase.from('agent_runs').insert({ agent: 'competitor-scan', status: 'error', ok: false, error: String(e?.message || e).slice(0, 600), finished_at: new Date().toISOString() }).then(() => {}, () => {});
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
