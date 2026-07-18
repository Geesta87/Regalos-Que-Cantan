// supabase/functions/affiliate-recruiter/index.ts
// ===========================================================================
// AFFILIATE RECRUITER — discover + score + draft outreach
// ===========================================================================
// Finds US-based Latino creators/influencers who'd make great affiliates
// (TikTok + Instagram search via ScrapeCreators), Claude scores each for fit +
// drafts a warm Spanish outreach DM, and stores them in affiliate_prospects. It
// NEVER auto-DMs (that gets accounts banned) — it hands the owner a ranked list
// + ready-to-send copy.
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

// Target = US-BASED HISPANIC / SPANISH-SPEAKING CONTENT CREATORS & INFLUENCERS
// (audience-owners who take brand deals), NOT our own product category. Searching
// product terms like "canción personalizada" only surfaces competitors, so those
// are gone. Terms lean toward how US-Latino creators label themselves (usa /
// estados unidos / latina) to bias the pool toward the US market; the scorer then
// rejects clearly non-US accounts (the geo lean is a bias, not a guarantee — the
// TikTok/IG search endpoints return no reliable country field).
const NICHES = (Deno.env.get('RECRUITER_NICHES') || 'creadora de contenido latina,influencer latina,mexicana en usa,latina en estados unidos,mamá latina,contenido de parejas,comedia mexicana,creador de contenido usa').split(',').map((s) => s.trim()).filter(Boolean);
const DO_TIKTOK = Deno.env.get('RECRUITER_TIKTOK') !== 'false';
const DO_INSTAGRAM = Deno.env.get('RECRUITER_INSTAGRAM') !== 'false';
const MIN_FOLLOWERS = Number(Deno.env.get('RECRUITER_MIN_FOLLOWERS') || '3000');
const MAX_FOLLOWERS = Number(Deno.env.get('RECRUITER_MAX_FOLLOWERS') || '1500000');
const PER_SEARCH = Number(Deno.env.get('RECRUITER_PER_SEARCH') || '25'); // pull deeper so repeat scans surface NEW creators, not the same top few
const MAX_NEW = Number(Deno.env.get('RECRUITER_MAX_NEW') || '25');

async function scGet(path: string, params: Record<string, string>, errs?: string[], timeoutMs = 15000) {
  const qs = new URLSearchParams(params);
  try {
    const r = await fetch(`https://api.scrapecreators.com${path}?${qs}`, { headers: { 'x-api-key': SC_KEY! }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) { const msg = `SC ${path} ${r.status}`; console.warn(msg); errs?.push(msg); return {}; }
    return await r.json().catch(() => ({}));
  } catch (_) { const msg = `SC ${path} timeout/err`; console.warn(msg); errs?.push(msg); return {}; }
}

function shapeTikTok(u: any, niche: string) {
  const ui = u.user_info || u;
  const handle = ui.unique_id;
  if (!handle) return null;
  // TikTok search exposes the bio as `signature` — feed it to the scorer so it
  // can read US/location + collab signals (same as we do for Instagram bios).
  const bio = typeof ui.signature === 'string' && ui.signature.trim() ? ui.signature.trim() : null;
  return {
    platform: 'tiktok', handle, display_name: ui.nickname || null,
    followers: Number(ui.follower_count) || null, videos: Number(ui.aweme_count) || null,
    likes: Number(ui.total_favorited) || null, verified: (ui.verification_type || 0) > 0,
    private: !!ui.is_private_account, profile_url: `https://www.tiktok.com/@${handle}`, niche,
    bio, external_url: null, business_email: null,
  };
}
function shapeInstagram(u: any, niche: string) {
  const x = u.user || u;
  const handle = x.username;
  if (!handle) return null;
  const bio = typeof x.biography === 'string' && x.biography.trim() ? x.biography.trim() : null;
  // Many creators put a business email right in the bio — capture it for the email outreach lane.
  const emailMatch = bio ? bio.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) : null;
  return {
    platform: 'instagram', handle, display_name: x.full_name || null,
    followers: Number(x.follower_count ?? x.edge_followed_by?.count) || null, videos: Number(x.media_count) || null,
    likes: null, verified: !!x.is_verified, private: !!x.is_private,
    profile_url: `https://www.instagram.com/${handle}`, niche,
    bio, external_url: x.external_url || null, business_email: emailMatch ? emailMatch[0] : null,
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
            fit_score: { type: 'integer', description: '0-100 fit as an AFFILIATE: a real US-based Spanish-speaking Hispanic content creator/influencer (a person with a face + engaged audience) who would promote a personalized-song gift to their followers. Competitors, faceless repost/aggregator pages, pure product shops, and clearly non-US accounts score low.' },
            fit_reason: { type: 'string', description: 'One line: why they fit (or do not). For a disqualifier, start with the reason word: "Competitor", "Repost page", "Shop/vendor", or "Non-US".' },
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
  const list = cands.map((c, i) => `#${i} — @${c.handle} (${c.platform}) "${c.display_name || ''}" · ${c.followers ?? '?'} followers${c.likes ? `, ${c.likes} likes` : ''}${c.videos ? `, ${c.videos} posts` : ''} · found via "${c.niche}"${c.bio ? ` · bio: "${String(c.bio).slice(0, 140)}"` : ''}`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000,
      system: `You recruit affiliates for "Regalos Que Cantan", a US-Hispanic brand selling personalized Spanish songs as gifts (~$30, flat 20% commission) to Hispanics IN THE UNITED STATES. The ideal affiliate is a US-BASED HISPANIC / SPANISH-SPEAKING CONTENT CREATOR or INFLUENCER: a real person with a face, personality and an engaged, warm audience (family, couples, motherhood, lifestyle, música, cultura, comedy) who takes brand collaborations and would recommend a heartfelt personalized-song gift to their followers.

SCORE HIGH (70-95): genuine US-based Spanish-language individual creators/influencers, micro-to-mid (a few thousand to a few hundred thousand followers), with real engagement and signs they do collabs (business email / "colaboraciones" / manager in bio).

SCORE LOW and name the reason at the start of fit_reason:
- "Competitor" (0-15): the account itself sells or makes personalized/custom songs or music.
- "Repost page" (10-30): faceless meme/clip/song-repost or aggregator account with no personal creator behind it — followers don't trust a person, so they won't convert.
- "Shop/vendor" (25-45): a business selling its own product (bakery, decor, dress shop, gift shop). They rarely promote someone else's product; deprioritize unless they're clearly a creator/influencer too.
- "Non-US" (0-35): clearly based outside the United States with a non-US audience — especially Brazil / Portuguese-language accounts, Spain, and Latin-America-only creators with no US tie. US signals to look for: US city/state in bio, 🇺🇸, English+Spanish mix, US brand collabs, prices in USD. If US-based is genuinely unclear but the account is otherwise a strong Latino creator, cap the score around 55 rather than rejecting.

Draft a warm, genuine Spanish outreach DM for each (no spam), and NEVER quote a commission rate or dollar figure in the DM. Score honestly — most accounts are a 40-70, reserve 80+ for standout US-based creators.`,
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
    const scErrors: string[] = []; // failed search calls — surfaced instead of silently reporting "no new prospects"
    // Run every niche search in parallel (each call is capped at 15s) so the
    // whole discovery step finishes in ~one call's time, not the sum.
    const tasks: Promise<any[]>[] = [];
    for (const niche of niches) {
      if (DO_TIKTOK && onlyPlatform !== 'instagram') tasks.push(scGet('/v1/tiktok/search/users', { query: niche, trim: 'true' }, scErrors).then((j) => (j.users || []).slice(0, PER_SEARCH).map((u: any) => shapeTikTok(u, niche)).filter(Boolean)));
      // NOTE: ScrapeCreators returns Instagram results under `profiles` — the old
      // users/data/results chain matched nothing, which is why IG never produced a
      // single prospect. Keep `profiles` first.
      // IG search is slow on ScrapeCreators' side (regularly >15s) — give it 60s. All
      // searches run in parallel, so wall-clock stays at the slowest single call.
      if (DO_INSTAGRAM && onlyPlatform !== 'tiktok') tasks.push(scGet('/v1/instagram/search/profiles', { query: niche }, scErrors, 60000).then((j) => (j.profiles || j.users || j.data || j.results || []).slice(0, PER_SEARCH).map((u: any) => shapeInstagram(u, niche)).filter(Boolean)));
    }
    const cands: any[] = (await Promise.all(tasks)).flat();

    // If every search call failed, this is an outage (bad key, rate limit), not a quiet market.
    if (cands.length === 0 && scErrors.length > 0 && scErrors.length >= tasks.length) {
      await supabase.from('agent_runs').insert({ agent: 'affiliate-recruiter', status: 'error', ok: false, error: `All ${tasks.length} searches failed: ${scErrors.slice(0, 3).join('; ')}`, finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
      return json(502, { success: false, error: 'ScrapeCreators searches all failed', details: scErrors.slice(0, 5) });
    }

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
    const { data: existing } = await supabase.from('affiliate_prospects').select('platform, handle');
    const have = new Set((existing || []).map((e: any) => `${e.platform}:${(e.handle || '').toLowerCase()}`));
    const { data: affs } = await supabase.from('affiliates').select('instagram');
    const affHandles = new Set((affs || []).map((a: any) => (a.instagram || '').toLowerCase().replace('@', '')).filter(Boolean));
    const fresh = filtered.filter((c) => !have.has(`${c.platform}:${c.handle.toLowerCase()}`) && !affHandles.has(c.handle.toLowerCase())).slice(0, MAX_NEW);

    if (fresh.length === 0) {
      const failNote = scErrors.length ? ` (warning: ${scErrors.length} search call(s) failed)` : '';
      await supabase.from('agent_runs').insert({ agent: 'affiliate-recruiter', status: 'ok', ok: true, summary: `No new prospects — ${filtered.length} matched but were already in your list. Try different terms or a wider follower range.${failNote}`, finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
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
          bio: c.bio ?? null, external_url: c.external_url ?? null, business_email: c.business_email ?? null,
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
