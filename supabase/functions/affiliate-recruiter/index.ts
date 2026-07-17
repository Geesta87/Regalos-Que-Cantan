// supabase/functions/affiliate-recruiter/index.ts
// ===========================================================================
// AFFILIATE RECRUITER — discover + score + draft outreach
// ===========================================================================
// Finds Latino creators/vendors who'd make great affiliates (TikTok + Instagram
// search via ScrapeCreators), Claude scores each for fit + drafts a warm Spanish
// outreach DM, and stores them in affiliate_prospects. It NEVER auto-DMs (that
// gets accounts banned) — it hands the owner a ranked list + ready-to-send copy.
//
// verify_jwt = false (pg_cron + manual). Reads SCRAPECREATORS_API_KEY +
// ANTHROPIC_API_KEY. ~1 credit per niche search.
// Deploy: supabase functions deploy affiliate-recruiter --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SC_KEY = Deno.env.get('SCRAPECREATORS_API_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('RECRUITER_MODEL') || 'claude-sonnet-4-6';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// Target = HISPANIC / SPANISH-SPEAKING CONTENT CREATORS & INFLUENCERS (audience-
// owners who take brand deals), NOT our own product category. Searching product
// terms like "canción personalizada" only surfaces competitors, so those are gone.
// These terms match how Latino creators label themselves in their name/bio.
const NICHES = (Deno.env.get('RECRUITER_NICHES') || 'creadora de contenido,creador de contenido,influencer mexicana,influencer latina,mamá latina,contenido de parejas,comedia mexicana,vlog familiar').split(',').map((s) => s.trim()).filter(Boolean);
const DO_TIKTOK = Deno.env.get('RECRUITER_TIKTOK') !== 'false';
const DO_INSTAGRAM = Deno.env.get('RECRUITER_INSTAGRAM') !== 'false';
const MIN_FOLLOWERS = Number(Deno.env.get('RECRUITER_MIN_FOLLOWERS') || '3000');
const MAX_FOLLOWERS = Number(Deno.env.get('RECRUITER_MAX_FOLLOWERS') || '1500000');
const PER_SEARCH = Number(Deno.env.get('RECRUITER_PER_SEARCH') || '25'); // pull deeper so repeat scans surface NEW creators, not the same top few
const MAX_NEW = Number(Deno.env.get('RECRUITER_MAX_NEW') || '25');

async function scGet(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params);
  try {
    const r = await fetch(`https://api.scrapecreators.com${path}?${qs}`, { headers: { 'x-api-key': SC_KEY! }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { console.warn(`SC ${path} ${r.status}`); return {}; }
    return await r.json().catch(() => ({}));
  } catch (_) { console.warn(`SC ${path} timeout/err`); return {}; }
}

function shapeTikTok(u: any, niche: string) {
  const ui = u.user_info || u;
  const handle = ui.unique_id;
  if (!handle) return null;
  return {
    platform: 'tiktok', handle, display_name: ui.nickname || null,
    followers: Number(ui.follower_count) || null, videos: Number(ui.aweme_count) || null,
    likes: Number(ui.total_favorited) || null, verified: (ui.verification_type || 0) > 0,
    private: !!ui.is_private_account, profile_url: `https://www.tiktok.com/@${handle}`, niche,
  };
}
function shapeInstagram(u: any, niche: string) {
  const x = u.user || u;
  const handle = x.username;
  if (!handle) return null;
  return {
    platform: 'instagram', handle, display_name: x.full_name || null,
    followers: Number(x.follower_count ?? x.edge_followed_by?.count) || null, videos: null,
    likes: null, verified: !!x.is_verified, private: !!x.is_private,
    profile_url: `https://www.instagram.com/${handle}`, niche,
  };
}

const SCORE_TOOL = {
  name: 'score_prospects',
  description: 'Score each creator as an affiliate prospect and draft outreach.',
  input_schema: {
    type: 'object',
    properties: {
      ratings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'integer' },
            fit_score: { type: 'integer', description: '0-100 fit as an AFFILIATE: a real Spanish-speaking Hispanic content creator/influencer (a person with a face + engaged audience) who would promote a personalized-song gift to their followers. Competitors, faceless repost/aggregator pages, and pure product shops score low.' },
            fit_reason: { type: 'string', description: 'One line: why they fit (or do not). For a disqualifier, start with the reason word: "Competitor", "Repost page", or "Shop/vendor".' },
            suggested_commission: { type: 'integer', description: 'The program pays a FLAT 20% commission — return 20. Do not invent a higher rate.' },
            outreach_draft: { type: 'string', description: 'A warm, personal Spanish DM to send them: compliment something specific, explain they can earn commission promoting a product their audience will love, low-pressure invite to reply. 3-5 sentences, no spammy vibe. Do NOT state a specific commission percentage or dollar figure in the message — that is discussed after they reply.' },
          },
          required: ['i', 'fit_score', 'fit_reason', 'suggested_commission', 'outreach_draft'],
        },
      },
    },
    required: ['ratings'],
  },
};

async function score(cands: any[]): Promise<Record<number, any>> {
  if (!ANTHROPIC_API_KEY || cands.length === 0) return {};
  const list = cands.map((c, i) => `#${i} — @${c.handle} (${c.platform}) "${c.display_name || ''}" · ${c.followers ?? '?'} followers${c.likes ? `, ${c.likes} likes` : ''}${c.videos ? `, ${c.videos} posts` : ''} · found via "${c.niche}"`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000,
      system: `You recruit affiliates for "Regalos Que Cantan", a US-Hispanic brand selling personalized Spanish songs as gifts (~$30, flat 20% commission). The ideal affiliate is a HISPANIC / SPANISH-SPEAKING CONTENT CREATOR or INFLUENCER: a real person with a face, personality and an engaged, warm audience (family, couples, motherhood, lifestyle, música, cultura, comedy) who takes brand collaborations and would recommend a heartfelt personalized-song gift to their followers.

SCORE HIGH (70-95): genuine Spanish-language individual creators/influencers, micro-to-mid (a few thousand to a few hundred thousand followers), with real engagement and signs they do collabs (business email / "colaboraciones" / manager in bio).

SCORE LOW and name the reason at the start of fit_reason:
- "Competitor" (0-15): the account itself sells or makes personalized/custom songs or music.
- "Repost page" (10-30): faceless meme/clip/song-repost or aggregator account with no personal creator behind it — followers don't trust a person, so they won't convert.
- "Shop/vendor" (25-45): a business selling its own product (bakery, decor, dress shop, gift shop). They rarely promote someone else's product; deprioritize unless they're clearly a creator/influencer too.
- Also score low anyone whose audience is not Spanish-speaking/Latino.

Draft a warm, genuine Spanish outreach DM for each (no spam), and NEVER quote a commission rate or dollar figure in the DM. Score honestly — most accounts are a 40-70, reserve 80+ for standout creators.`,
      tools: [SCORE_TOOL], tool_choice: { type: 'tool', name: 'score_prospects' },
      messages: [{ role: 'user', content: `Score these ${cands.length} creators and draft outreach:\n\n${list}` }],
    }),
  });
  if (!res.ok) { console.warn(`score ${res.status}`); return {}; }
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

  // Optional per-scan overrides from the admin "Filtros" panel (fall back to env
  // defaults). Lets the owner steer who the recruiter goes after.
  let reqBody: any = {}; try { reqBody = await req.json(); } catch { reqBody = {}; }
  const niches = Array.isArray(reqBody.niches) && reqBody.niches.length
    ? reqBody.niches.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 12) : NICHES;
  const minFollowers = Number.isFinite(Number(reqBody.min_followers)) && reqBody.min_followers != null && reqBody.min_followers !== ''
    ? Number(reqBody.min_followers) : MIN_FOLLOWERS;
  const maxFollowers = Number.isFinite(Number(reqBody.max_followers)) && reqBody.max_followers != null && reqBody.max_followers !== ''
    ? Number(reqBody.max_followers) : MAX_FOLLOWERS;
  const onlyPlatform = reqBody.platform === 'tiktok' || reqBody.platform === 'instagram' ? reqBody.platform : null;

  try {
    const seen = new Set<string>();
    // Run every niche search in parallel (each call is capped at 15s) so the
    // whole discovery step finishes in ~one call's time, not the sum.
    const tasks: Promise<any[]>[] = [];
    for (const niche of niches) {
      if (DO_TIKTOK && onlyPlatform !== 'instagram') tasks.push(scGet('/v1/tiktok/search/users', { query: niche, trim: 'true' }).then((j) => (j.users || []).slice(0, PER_SEARCH).map((u: any) => shapeTikTok(u, niche)).filter(Boolean)));
      if (DO_INSTAGRAM && onlyPlatform !== 'tiktok') tasks.push(scGet('/v1/instagram/search/profiles', { query: niche }).then((j) => (j.users || j.data || j.results || []).slice(0, PER_SEARCH).map((u: any) => shapeInstagram(u, niche)).filter(Boolean)));
    }
    const cands: any[] = (await Promise.all(tasks)).flat();

    // Filter (size + public) + de-dup within batch.
    const filtered = cands.filter((c) => {
      if (c.private || !c.handle) return false;
      if (c.followers != null && (c.followers < minFollowers || c.followers > maxFollowers)) return false;
      const key = `${c.platform}:${c.handle.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Skip ones already stored or already affiliates (by handle).
    const handles = filtered.map((c) => c.handle.toLowerCase());
    const { data: existing } = await supabase.from('affiliate_prospects').select('platform, handle');
    const have = new Set((existing || []).map((e: any) => `${e.platform}:${(e.handle || '').toLowerCase()}`));
    const { data: affs } = await supabase.from('affiliates').select('instagram');
    const affHandles = new Set((affs || []).map((a: any) => (a.instagram || '').toLowerCase().replace('@', '')).filter(Boolean));
    const fresh = filtered.filter((c) => !have.has(`${c.platform}:${c.handle.toLowerCase()}`) && !affHandles.has(c.handle.toLowerCase())).slice(0, MAX_NEW);

    if (fresh.length === 0) {
      await supabase.from('agent_runs').insert({ agent: 'affiliate-recruiter', status: 'ok', ok: true, summary: `No new prospects — ${filtered.length} matched but were already in your list. Try different terms or a wider follower range.`, finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
      return json(200, { success: true, found: filtered.length, new: 0 });
    }

    // Score chunks of 10 in parallel.
    const chunks: any[][] = [];
    for (let off = 0; off < fresh.length; off += 10) chunks.push(fresh.slice(off, off + 10));
    const chunkRatings = await Promise.all(chunks.map((c) => score(c)));
    let stored = 0;
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci]; const ratings = chunkRatings[ci];
      for (let j = 0; j < chunk.length; j++) {
        const c = chunk[j]; const rt = ratings[j] || {};
        const { error } = await supabase.from('affiliate_prospects').insert({
          platform: c.platform, handle: c.handle, display_name: c.display_name, profile_url: c.profile_url,
          followers: c.followers, videos: c.videos, likes: c.likes, verified: c.verified, niche: c.niche,
          fit_score: Number.isFinite(rt.fit_score) ? rt.fit_score : null, fit_reason: rt.fit_reason || null,
          suggested_commission: Number.isFinite(rt.suggested_commission) ? rt.suggested_commission : 20,
          outreach_draft: rt.outreach_draft || null, status: 'new',
        });
        if (!error) stored++;
      }
    }

    await supabase.from('agent_runs').insert({ agent: 'affiliate-recruiter', status: 'ok', ok: true, summary: `Stored ${stored} new prospects`, payload: { found: filtered.length, stored }, finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
    return json(200, { success: true, found: filtered.length, new: stored });
  } catch (e: any) {
    await supabase.from('agent_runs').insert({ agent: 'affiliate-recruiter', status: 'error', ok: false, error: String(e?.message || e).slice(0, 600), finished_at: new Date().toISOString() }).then(() => {}, () => {});
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
