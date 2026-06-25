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
  { q: 'canción personalizada', lang: 'es' },
  { q: 'canción con tu nombre', lang: 'es' },
  { q: 'regalo canción personalizada', lang: 'es' },
  { q: 'personalized song gift', lang: 'en' },
  { q: 'custom song for someone', lang: 'en' },
  { q: 'make a song as a gift', lang: 'en' },
];
const PER_KEYWORD = Number(Deno.env.get('COMPETITOR_PER_KEYWORD') || '8');
const MAX_NEW = Number(Deno.env.get('COMPETITOR_MAX_NEW') || '30');

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

async function scSearch(q: string): Promise<any[]> {
  const url = `${SC}?query=${encodeURIComponent(q)}&country=US&status=ACTIVE&sort_by=total_impressions&trim=true`;
  const r = await fetch(url, { headers: { 'x-api-key': SC_KEY! } });
  if (!r.ok) { console.warn(`SC ${q} ${r.status}`); return []; }
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const json = (s: number, b: any) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (!SC_KEY) return json(200, { success: false, skipped: true, reason: 'SCRAPECREATORS_API_KEY missing' });

  try {
    // Pull + flatten + shape.
    const seen = new Set<string>();
    const collected: any[] = [];
    for (const k of KEYWORDS) {
      const results = await scSearch(k.q);
      for (const r of results.slice(0, PER_KEYWORD)) {
        const ad = shapeAd(r, k.lang);
        if (!ad.ad_archive_id || seen.has(ad.ad_archive_id)) continue;
        seen.add(ad.ad_archive_id);
        collected.push(ad);
      }
    }

    // Skip ones we already have.
    const ids = collected.map((a) => a.ad_archive_id);
    const { data: existing } = await supabase.from('competitor_ads').select('ad_archive_id').in('ad_archive_id', ids);
    const have = new Set((existing || []).map((e: any) => e.ad_archive_id));
    const fresh = collected.filter((a) => !have.has(a.ad_archive_id)).slice(0, MAX_NEW);

    if (fresh.length === 0) {
      await supabase.from('agent_runs').insert({ agent: 'competitor-scan', status: 'ok', ok: true, summary: 'No new competitor ads', finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
      return json(200, { success: true, scanned: collected.length, new: 0 });
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

    await supabase.from('agent_runs').insert({ agent: 'competitor-scan', status: 'ok', ok: true, summary: `Stored ${stored} new competitor ads`, payload: { scanned: collected.length, stored }, finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
    return json(200, { success: true, scanned: collected.length, new: stored });
  } catch (e: any) {
    await supabase.from('agent_runs').insert({ agent: 'competitor-scan', status: 'error', ok: false, error: String(e?.message || e).slice(0, 600), finished_at: new Date().toISOString() }).then(() => {}, () => {});
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
