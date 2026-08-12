// ===========================================================================
// CREATIVE AUTO-POST — hands-off scheduler for the branded [MES-1] queue.
// ===========================================================================
// pg_cron jobs call this (?kind=image at 6am+7pm PT, ?kind=video at 2pm PT).
// Each run posts the OLDEST 'ready' [MES-1] piece of that kind whose batch_date
// has ARRIVED (<= today UTC) via GHL (feed to every connected account + story
// to IG/FB), then flips it to 'posted'. The batch_date guard means rescheduling
// a post to a future day actually delays it. Stops gracefully when nothing is
// due. Respects creative_posting_state (owner's pause switch). Only ever touches
// concept LIKE '[MES-1%'. Token-gated in URL. verify_jwt = false (pg_cron) —
// config.toml. ?dryrun=1 previews without posting.
// Deploy: supabase functions deploy creative-auto-post --project-ref yzbvajungshqcpusfiia
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GHL_API_TOKEN = Deno.env.get('GHL_API_TOKEN');
const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
const GHL_USER_ID = Deno.env.get('GHL_USER_ID') || 'FzWeDSE9qm2dyrKmh1hn';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const TOKEN = 'rqc-autopost-9f3e7b2a641c8d5e0a7f4b19';

// Platforms that can ONLY accept video. Sending a still image to these burns a
// post: TikTok rejects it loudly (422 "TikTok needs a video"), YouTube accepts
// the upload and then silently fails it as "Processing abandoned" — 29 dead
// uploads piled up on the channel that way before this guard existed. An image
// slot simply skips them now.
const VIDEO_ONLY_PLATFORMS = new Set(['tiktok', 'youtube']);

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }); }
async function ghlFetch(path: string, init: RequestInit = {}) {
  return fetch(`${GHL_API_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${GHL_API_TOKEN}`, Version: GHL_API_VERSION, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) } });
}
async function listConnectedAccounts(): Promise<any[]> {
  const r = await ghlFetch(`/social-media-posting/${GHL_LOCATION_ID}/accounts`, { method: 'GET' });
  if (!r.ok) throw new Error(`GHL accounts ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  return (d?.results?.accounts || []).filter((a: any) => !a.isExpired && !a.deleted);
}
function extractGhlPostId(d: any): string | null {
  return d?.results?.post?._id || d?.results?.post?.id || d?.results?.posts?.[0]?._id || d?.results?._id || d?.post?._id || d?._id || d?.id || null;
}

// ---------------------------------------------------------------------------
// YOUTUBE TITLE
// ---------------------------------------------------------------------------
// YouTube is a search engine, and the title is its single biggest lever. GHL
// only sets it from `youtubePostDetails.title` (same field post-to-ghl uses);
// `summary` is the DESCRIPTION there. Without the field YouTube publishes the
// Short as literally "Untitled" — that is what shipped for months.
//
// The queue's `headline` is a lyric fragment ("Contigo pasé la vida") — lovely,
// but nobody searches it. So the title is built the way the channel's actual
// top performers read: a searchable lead, then the headline as the hook —
//   "Bolero personalizado de aniversario | Contigo pasé la vida"
// mirroring live winners like "Serenata con mariachi personalizada | Canción
// con su nombre" (984 views) and "Corrido personalizado | Canción única hecha
// a medida" (1,217).

// House-song slug → genre label + grammatical gender of "personalizad_".
// Slugs come from the concept, e.g. "[MES-1-VIDEO] hs2 · hs2-corrido-mi-gente-3".
const GENRE_BY_SLUG: Array<[string, string, 'o' | 'a']> = [
  ['corrido-mi-gente', 'Corrido', 'o'],
  ['sigo-de-pie', 'Corrido', 'o'],
  ['hoy-te-celebro', 'Banda', 'a'],
  ['nuestra-cancion', 'Bachata', 'a'],
  ['gracias-mama', 'Balada', 'a'],
  ['manos-de-mi-padre', 'Norteño', 'o'],
  ['que-empiece-la-fiesta', 'Cumbia', 'a'],
  ['sesenta-primaveras', 'Bolero', 'o'],
  ['serenata-de-bolsillo', 'Serenata con mariachi', 'a'],
  ['a-dos-mil-millas', 'Norteño', 'o'],
];

// occasion → the search phrase people actually type.
const OCCASION_PHRASE: Record<string, string> = {
  cumpleanos: 'de cumpleaños',
  aniversario: 'de aniversario',
  papa: 'para papá',
  amor: 'de amor',
  distancia: 'para el amor a distancia',
  fiesta: 'para fiesta',
  memorial: 'en su memoria',
  para_mi: 'para ti mismo',
};

function buildYouTubeTitle(c: any): string {
  const concept = String(c.concept || '').toLowerCase();
  const headline = String(c.headline || '').trim();
  const hl = headline.toLowerCase();

  const genre = GENRE_BY_SLUG.find(([slug]) => concept.includes(slug));

  // `homenaje` covers mamá / papá / abuela pieces — the occasion column doesn't
  // say which, but the headline does ("Para mamá", "Para la abuela").
  let occPhrase = OCCASION_PHRASE[String(c.occasion || '')] || '';
  if (!occPhrase) {
    if (hl.includes('mamá') || hl.includes('mama')) occPhrase = 'para mamá';
    else if (hl.includes('papá') || hl.includes('padre')) occPhrase = 'para papá';
    else if (hl.includes('abuela') || hl.includes('abuelo')) occPhrase = 'para los abuelos';
  }

  const lead = genre
    ? `${genre[1]} personalizad${genre[2]}${occPhrase ? ' ' + occPhrase : ''}`
    : `Canción personalizada${occPhrase ? ' ' + occPhrase : ''}`;

  // Don't echo the lead back as the hook ("Canción personalizada para mamá |
  // Para mamá") — fall back to the evergreen hook instead.
  const leadLc = lead.toLowerCase();
  const hookIsRedundant = !headline || leadLc.includes(hl) || hl.length < 4;
  const hook = hookIsRedundant ? 'Canción con su nombre 🎁' : headline;

  // YouTube hard-caps titles at 100 chars. Trim the HOOK, never the lead.
  const full = `${lead} | ${hook}`;
  if (full.length <= 100) return full;
  const room = 100 - (lead.length + 3);
  return room > 12 ? `${lead} | ${hook.slice(0, room - 1).trimEnd()}…` : lead.slice(0, 100);
}

async function ghlPost(accountId: string, caption: string, mediaUrl: string, kind: string, scheduleDate: string, variant: 'feed' | 'story', youtubeTitle?: string) {
  const payload: any = { accountIds: [accountId], userId: GHL_USER_ID, media: [{ url: mediaUrl, type: kind === 'video' ? 'video/mp4' : 'image/png' }], scheduleDate, type: variant === 'story' ? 'story' : 'post', status: 'scheduled' };
  if (variant === 'feed') payload.summary = caption;
  // Same shape post-to-ghl uses in production — verified field name.
  if (youtubeTitle) payload.youtubePostDetails = { title: youtubeTitle, privacyLevel: 'public', type: 'video' };
  const r = await ghlFetch(`/social-media-posting/${GHL_LOCATION_ID}/posts`, { method: 'POST', body: JSON.stringify(payload) });
  if (!r.ok) return { id: null, error: `${r.status}: ${(await r.text()).slice(0, 160)}` };
  return { id: extractGhlPostId(await r.json()), error: null as string | null };
}
function fullCaption(c: any): string {
  const tags = Array.isArray(c.hashtags) && c.hashtags.length ? '\n\n' + c.hashtags.map((h: string) => `#${String(h).replace(/^#/, '')}`).join(' ') : '';
  let body = String(c.caption || '').trim();
  if (!body) body = [c.headline, c.primary_text].map((s: any) => String(s || '').trim()).filter(Boolean).join('\n\n');
  return `${body}${tags}`.trim();
}

serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('token') !== TOKEN) return json({ error: 'forbidden' }, 403);
  const kind = url.searchParams.get('kind') === 'video' ? 'video' : 'image';
  const dryrun = url.searchParams.get('dryrun') === '1';
  const today = new Date().toISOString().slice(0, 10);
  const admin = createClient(SUPABASE_URL, SERVICE);
  try {
    const { data: state } = await admin.from('creative_posting_state').select('enabled').eq('id', 1).single();
    const posting = Deno.env.get('SOCIAL_CLIPS_ENABLED') !== 'false' && (state ? !!state.enabled : true);
    if (!posting) return json({ ok: true, skipped: 'posting_paused', kind });
    // oldest ready [MES-1] of this kind whose scheduled day has arrived
    const { data: c } = await admin.from('creative_queue').select('*').eq('status', 'ready').eq('kind', kind).like('concept', '[MES-1%').lte('batch_date', today).order('batch_date', { ascending: true }).order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (!c) return json({ ok: true, done: 'nothing_due', kind, today });
    if (!c.media_url) { await admin.from('creative_queue').update({ status: 'failed', error: 'no media', updated_at: new Date().toISOString() }).eq('id', c.id); return json({ ok: false, error: 'no_media', id: c.id }); }
    const caption = fullCaption(c);
    const ytTitle = kind === 'video' ? buildYouTubeTitle(c) : null;
    if (dryrun) {
      let accts: string[] = [];
      try { accts = (await listConnectedAccounts()).map((a: any) => a.platform); } catch (e) { return json({ ok: false, dryrun: true, ghl_error: String((e as Error).message) }); }
      const targets = accts.filter((p) => kind === 'video' || !VIDEO_ONLY_PLATFORMS.has(p));
      return json({ ok: true, dryrun: true, would_post: { id: c.id, kind, headline: c.headline, batch_date: c.batch_date }, to_accounts: targets, skipped_video_only: accts.filter((p) => !targets.includes(p)), youtube_title: ytTitle, caption_preview: caption.slice(0, 120) });
    }
    if (!GHL_API_TOKEN || !GHL_LOCATION_ID) return json({ error: 'GHL not configured' }, 500);
    const allAccounts = await listConnectedAccounts();
    if (!allAccounts.length) return json({ error: 'no_connected_accounts' }, 502);
    // An image slot must not reach TikTok or YouTube — see VIDEO_ONLY_PLATFORMS.
    const accounts = allAccounts.filter((a: any) => kind === 'video' || !VIDEO_ONLY_PLATFORMS.has(a.platform));
    if (!accounts.length) return json({ ok: true, done: 'no_eligible_accounts', kind });
    // Facebook (via GHL) rejects a scheduleDate under ~10 min out with a 422
    // ("Schedule Date must be after current date"). Schedule 20 min ahead so
    // every platform — Facebook included — accepts. IG/YT/TikTok are fine either way.
    const base = Date.now() + 1_200_000;
    const results: Record<string, string | null> = {}; const errs: string[] = []; let firstId: string | null = null;
    for (let i = 0; i < accounts.length; i++) {
      const isYt = accounts[i].platform === 'youtube';
      const r = await ghlPost(accounts[i].id, caption, c.media_url, c.kind, new Date(base + i * 30_000).toISOString(), 'feed', isYt && ytTitle ? ytTitle : undefined);
      results[accounts[i].platform] = r.id; if (r.id && !firstId) firstId = r.id; if (r.error) errs.push(`${accounts[i].platform}:${r.error}`);
    }
    const storyAcc = accounts.filter((a: any) => a.platform === 'instagram' || a.platform === 'facebook');
    for (let i = 0; i < storyAcc.length; i++) {
      const r = await ghlPost(storyAcc[i].id, caption, c.media_url, c.kind, new Date(base + 120_000 + i * 30_000).toISOString(), 'story');
      if (r.error) errs.push(`story/${storyAcc[i].platform}:${r.error}`);
    }
    if (!firstId) { await admin.from('creative_queue').update({ status: 'ready', error: errs.join(' | ').slice(0, 500), updated_at: new Date().toISOString() }).eq('id', c.id); return json({ ok: false, error: 'all_feed_failed', detail: errs.join(' | ') }, 502); }
    await admin.from('creative_queue').update({ status: 'posted', approved_at: new Date().toISOString(), posted_at: new Date().toISOString(), ghl_post_id: firstId, error: errs.length ? errs.join(' | ').slice(0, 500) : null, updated_at: new Date().toISOString() }).eq('id', c.id);
    await admin.from('agent_runs').insert({ agent: 'creative-auto-post', status: 'ok', ok: true, summary: `Auto-posted ${kind} ${c.id} (${c.headline})`, payload: { id: c.id, kind, results, youtube_title: ytTitle }, finished_at: new Date().toISOString() }).then(() => {}, () => {});
    return json({ ok: true, posted: { id: c.id, kind, headline: c.headline }, youtube_title: ytTitle, ghl_post_id: firstId, results });
  } catch (e) {
    console.error('creative-auto-post:', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
