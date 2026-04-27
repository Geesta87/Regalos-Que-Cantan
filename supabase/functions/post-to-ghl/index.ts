// supabase/functions/post-to-ghl/index.ts
// Posts a rendered social clip to the brand's connected GHL social accounts.
// Creates TWO GHL posts per song:
//   1. Feed post — FB, IG, TikTok, YouTube — permanent timeline content
//   2. Story post — FB + IG only — 24-hour ephemeral (TikTok/YT don't have
//      the same stories mechanic)
//
// Captions are platform-specific — each network has its own native copy
// style. No recipient names (keeps content private + makes copy evergreen).
//
// Auth: GHL Private Integration token (pit-...) stored as GHL_API_TOKEN secret.
// Target location: GHL_LOCATION_ID secret.
//
// Idempotency: we check social_posts.ghl_post_id AND ghl_story_post_id.
// The function is safe to call multiple times — whichever post variants
// haven't been scheduled yet get scheduled; whichever already have an ID
// are skipped.
//
// Deploy with: supabase functions deploy post-to-ghl

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GHL_API_TOKEN = Deno.env.get('GHL_API_TOKEN');
const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

// 15-min buffer for feed post — GHL needs clear future time.
// Story gets 2 extra min so the two posts don't hit platforms at the exact
// same instant (easier to eyeball in dashboards, no rate-limit drama).
const FEED_SCHEDULE_DELAY_SECONDS = 900;
const STORY_SCHEDULE_DELAY_SECONDS = 1020;

const GHL_USER_ID = 'FzWeDSE9qm2dyrKmh1hn';
const SITE_URL = 'regalosquecantan.com';

// Branded per-genre thumbnails hosted in Supabase Storage (video-photos
// bucket, thumbnails/ prefix). GHL's `media.thumbnail` field accepts a
// public URL and uses it as the feed preview instead of the video's
// first frame. Falls back to undefined (GHL auto-generates from first
// frame) if the genre is unknown or the file isn't present.
const THUMBNAIL_BASE_URL =
  'https://yzbvajungshqcpusfiia.supabase.co/storage/v1/object/public/video-photos/thumbnails';

function thumbnailUrlFor(genre: string | null | undefined): string | undefined {
  if (!genre) return undefined;
  const key = genre.toLowerCase().trim().replace(/[\s-]/g, '_');
  // Only return a URL for genres we actually have thumbnails for. The 22
  // keys below must match the GENRE_META keys and the filenames uploaded
  // to Supabase Storage. Anything else returns undefined (safe fallback).
  const known = new Set([
    'corrido', 'sierreno', 'norteno', 'banda', 'duranguense', 'tejano',
    'ranchera', 'mariachi', 'cumbia', 'merengue', 'salsa', 'vallenato',
    'bachata', 'bolero', 'reggaeton', 'latin_trap', 'balada', 'romantica',
    'pop_latino', 'rock_espanol', 'vals', 'grupera',
  ]);
  if (!known.has(key)) return undefined;
  return `${THUMBNAIL_BASE_URL}/${key}.png`;
}

// ---------------------------------------------------------------------------
// Genre metadata for caption generation.
// ---------------------------------------------------------------------------
type GenreMeta = { label: string; emoji: string; hashtag: string };

const GENRE_META: Record<string, GenreMeta> = {
  corrido:      { label: 'Corrido',      emoji: '🎩', hashtag: 'Corrido' },
  sierreno:     { label: 'Sierreño',     emoji: '🎸', hashtag: 'Sierreno' },
  norteno:      { label: 'Norteño',      emoji: '🤠', hashtag: 'Norteno' },
  banda:        { label: 'Banda',        emoji: '🎺', hashtag: 'Banda' },
  duranguense:  { label: 'Duranguense',  emoji: '🎺', hashtag: 'Duranguense' },
  tejano:       { label: 'Tejano',       emoji: '🎺', hashtag: 'Tejano' },
  ranchera:     { label: 'Ranchera',     emoji: '🎻', hashtag: 'Ranchera' },
  mariachi:     { label: 'Mariachi',     emoji: '🎻', hashtag: 'Mariachi' },
  cumbia:       { label: 'Cumbia',       emoji: '🎉', hashtag: 'Cumbia' },
  merengue:     { label: 'Merengue',     emoji: '🥁', hashtag: 'Merengue' },
  salsa:        { label: 'Salsa',        emoji: '💃', hashtag: 'Salsa' },
  vallenato:    { label: 'Vallenato',    emoji: '🎉', hashtag: 'Vallenato' },
  bachata:      { label: 'Bachata',      emoji: '🌹', hashtag: 'Bachata' },
  bolero:       { label: 'Bolero',       emoji: '🌹', hashtag: 'Bolero' },
  reggaeton:    { label: 'Reggaetón',    emoji: '⚡', hashtag: 'Reggaeton' },
  latin_trap:   { label: 'Latin Trap',   emoji: '⚡', hashtag: 'LatinTrap' },
  balada:       { label: 'Balada',       emoji: '💕', hashtag: 'Balada' },
  romantica:    { label: 'Romántica',    emoji: '💕', hashtag: 'Romantica' },
  pop_latino:   { label: 'Pop Latino',   emoji: '⭐', hashtag: 'PopLatino' },
  rock_espanol: { label: 'Rock',         emoji: '🎸', hashtag: 'Rock' },
  vals:         { label: 'Vals',         emoji: '💍', hashtag: 'Vals' },
  grupera:      { label: 'Grupera',      emoji: '🎶', hashtag: 'Grupera' },
};

const DEFAULT_GENRE_META: GenreMeta = {
  label: 'Canción',
  emoji: '🎵',
  hashtag: 'Cancion',
};

function getGenreMeta(genre: string | null | undefined): GenreMeta {
  if (!genre) return DEFAULT_GENRE_META;
  const key = genre.toLowerCase().trim().replace(/[\s-]/g, '_');
  return GENRE_META[key] || {
    ...DEFAULT_GENRE_META,
    label: genre.charAt(0).toUpperCase() + genre.slice(1).toLowerCase(),
    hashtag: genre.replace(/[^A-Za-z0-9]/g, ''),
  };
}

// ---------------------------------------------------------------------------
// FEED CAPTIONS — one per platform, no recipient names.
//   Instagram: emoji-heavy, 4-5 hashtags, mid-length, emotional
//   TikTok:    punchy, #fyp, 2-3 hashtags, hook + CTA
//   Facebook:  conversational, question hook, 1-2 hashtags
//   YouTube:   ultra-short description for Shorts
// ---------------------------------------------------------------------------
type SongContext = { genre: string | null };

function buildInstagramFeed(song: SongContext): string {
  const g = getGenreMeta(song.genre);
  return (
`${g.emoji} Una ${g.label.toUpperCase()} hecha con el alma, para regalar emociones inolvidables ✨

Cada canción es única — letra, melodía e interpretación creadas a medida.
Hecha para hacer llorar (de felicidad).

👉 ${SITE_URL}
🎁 Cumpleaños · Aniversarios · Bodas · Día de las Madres

#RegalosQueCantan #${g.hashtag}Personalizada #CancionPersonalizada #RegaloUnico #AmorQueCanta`
  );
}

function buildTikTokFeed(song: SongContext): string {
  const g = getGenreMeta(song.genre);
  return (
`${g.emoji} Una ${g.label.toUpperCase()} hecha solo para quien amas 🎵
Lista en 3 minutos 👉 ${SITE_URL}
#fyp #regalopersonalizado #${g.hashtag.toLowerCase()}`
  );
}

function buildFacebookFeed(song: SongContext): string {
  const g = getGenreMeta(song.genre);
  return (
`¿Y si le regalaras una canción única, escrita solo para esa persona especial?

${g.emoji} Cada ${g.label.toUpperCase()} de Regalos Que Cantan nace con una intención: convertir tu historia en música.

Lista en 3 minutos. Desde $29.99 USD.

👉 Crea la tuya: ${SITE_URL}

#RegalosQueCantan #${g.hashtag}`
  );
}

function buildYouTubeFeed(song: SongContext): string {
  const g = getGenreMeta(song.genre);
  return (
`${g.emoji} ${g.label.toUpperCase()} Personalizada — canción única hecha a medida en 3 minutos.

👉 ${SITE_URL}

#Shorts #RegalosPersonalizados #${g.hashtag} #RegalosQueCantan`
  );
}

// Feed caption lookup by platform — returns a plain string for that platform.
function feedCaptionFor(platform: string, song: SongContext): string {
  switch (platform) {
    case 'facebook':  return buildFacebookFeed(song);
    case 'instagram': return buildInstagramFeed(song);
    case 'tiktok':    return buildTikTokFeed(song);
    case 'youtube':   return buildYouTubeFeed(song);
    case 'google':    return buildFacebookFeed(song);  // Google Business reuses FB style
    default:          return buildInstagramFeed(song); // safe default
  }
}

// ---------------------------------------------------------------------------
// STORY CAPTIONS — IG + FB only. Ultra-short. Stories are visual-first and
// text overlay is tiny. Most users tap through fast; headline + CTA.
// ---------------------------------------------------------------------------
function buildInstagramStory(song: SongContext): string {
  const g = getGenreMeta(song.genre);
  return (
`${g.emoji} Nueva ${g.label.toUpperCase()} personalizada ✨
Link en bio 👆`
  );
}

function buildFacebookStory(song: SongContext): string {
  const g = getGenreMeta(song.genre);
  return (
`${g.emoji} Nueva ${g.label.toUpperCase()} personalizada ✨
👉 ${SITE_URL}`
  );
}

// Story caption lookup by platform — IG and FB only.
function storyCaptionFor(platform: string, song: SongContext): string {
  switch (platform) {
    case 'facebook':  return buildFacebookStory(song);
    case 'instagram': return buildInstagramStory(song);
    default:          return buildInstagramStory(song);
  }
}

// ---------------------------------------------------------------------------
// GHL API helpers
// ---------------------------------------------------------------------------
type GhlAccount = {
  id: string;
  platform: string;
  name: string;
  isExpired: boolean;
  deleted: boolean;
};

async function ghlFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GHL_API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${GHL_API_TOKEN}`,
      'Version': GHL_API_VERSION,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function listConnectedAccounts(): Promise<GhlAccount[]> {
  const resp = await ghlFetch(
    `/social-media-posting/${GHL_LOCATION_ID}/accounts`,
    { method: 'GET' },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GHL list accounts ${resp.status}: ${body.substring(0, 300)}`);
  }
  const data = await resp.json();
  return (data?.results?.accounts || []) as GhlAccount[];
}

// GHL's `POST /posts` response wraps the created record at
// `ghlData.results.post._id`. The create response differs from the
// list response (which nests under `results.posts` array), so we
// check both shapes plus a couple of fallbacks for older API versions.
function extractGhlPostId(ghlData: any): string | null {
  return (
    ghlData?.results?.post?._id ||
    ghlData?.results?.post?.id ||
    ghlData?.results?.post?.parentPostId ||
    ghlData?.results?.posts?.[0]?._id ||
    ghlData?.results?._id ||
    ghlData?.results?.parentPostId ||
    ghlData?.post?._id ||
    ghlData?._id ||
    ghlData?.id ||
    null
  );
}

// Submit ONE post to ONE platform. GHL's `summary` field only accepts a
// string (not the object form with per-platform overrides we tried first —
// that was silently converted to empty string). To get per-platform captions
// we make one API call per platform with its own caption string.
async function schedulePlatformPost(args: {
  platform: string;              // for logging only
  variant: 'feed' | 'story';
  accountId: string;
  summary: string;               // plain string, NOT an object
  videoUrl: string;
  thumbnailUrl?: string;         // optional — genre-branded thumbnail
  scheduleDate: string;
}): Promise<{ ghlPostId: string | null; error: string | null; response?: any }> {
  // Build the media object. When a thumbnail URL is provided, GHL uses it
  // as the preview image in the feed (instead of the video's first frame).
  const mediaItem: any = { url: args.videoUrl, type: 'video/mp4' };
  if (args.thumbnailUrl) {
    mediaItem.thumbnail = args.thumbnailUrl;
  }

  const payload: any = {
    accountIds: [args.accountId],
    userId: GHL_USER_ID,
    media: [mediaItem],
    scheduleDate: args.scheduleDate,
    type: args.variant === 'story' ? 'story' : 'post',
    status: 'scheduled',
  };

  // GHL rejects captions on Instagram and Facebook stories with a 422
  // ("Story will not support caption for publishing post directly"). So
  // only include `summary` for feed posts. Stories rely on text overlays
  // inside the video instead.
  if (args.variant === 'feed') {
    payload.summary = args.summary;
  }

  const resp = await ghlFetch(
    `/social-media-posting/${GHL_LOCATION_ID}/posts`,
    { method: 'POST', body: JSON.stringify(payload) },
  );

  if (!resp.ok) {
    const errText = await resp.text();
    return {
      ghlPostId: null,
      error: `${args.platform}/${args.variant}_${resp.status}: ${errText.substring(0, 300)}`,
    };
  }

  const data = await resp.json();
  const id = extractGhlPostId(data);
  // Log the full response shape ONCE if ID extraction failed — helps us
  // adjust extractGhlPostId when GHL's response format changes.
  if (!id) {
    console.warn(
      `[post-to-ghl] ${args.platform}/${args.variant}: no ID in response — shape was:`,
      JSON.stringify(data).substring(0, 600),
    );
  }
  return { ghlPostId: id, error: null, response: data };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Global pause switch (same env var as render-social-clip). Set
    //   SOCIAL_CLIPS_ENABLED=false
    // to stop all GHL posting. Safety net — even if the render function
    // somehow produces a clip while paused, nothing will get posted.
    const enabled = Deno.env.get('SOCIAL_CLIPS_ENABLED') !== 'false';
    if (!enabled) {
      console.log('[post-to-ghl] SOCIAL_CLIPS_ENABLED=false — posting paused, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'pipeline_paused' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    if (!GHL_API_TOKEN || !GHL_LOCATION_ID) {
      throw new Error('GHL_API_TOKEN or GHL_LOCATION_ID not configured');
    }

    const { socialPostId } = await req.json();
    if (!socialPostId) throw new Error('Missing socialPostId');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load social_post + JOIN song for caption context.
    const { data: post, error: postErr } = await supabase
      .from('social_posts')
      .select(`
        id, song_id, social_video_url, caption, video_status, post_status,
        ghl_post_id, ghl_story_post_id, retry_count,
        songs ( genre )
      `)
      .eq('id', socialPostId)
      .single();

    if (postErr || !post) {
      throw new Error(`social_post not found: ${postErr?.message || 'no row'}`);
    }

    if (post.video_status !== 'completed' || !post.social_video_url) {
      console.log(`[post-to-ghl] video_status=${post.video_status}, skipping`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'video_not_ready' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    // Fetch live connected accounts.
    const accounts = await listConnectedAccounts();
    const usable = accounts.filter((a) => !a.isExpired && !a.deleted);
    if (usable.length === 0) {
      throw new Error('No usable GHL social accounts connected');
    }

    console.log(
      `[post-to-ghl] usable accounts:`,
      usable.map((a) => `${a.platform}:${a.name}`).join(', '),
    );

    const songCtx: SongContext = {
      genre: (post as any).songs?.genre ?? null,
    };

    // Resolve the per-genre branded thumbnail once up front. Passed into
    // every schedulePlatformPost call below so all 6 posts (feed + story)
    // use the same genre thumbnail as their feed preview image.
    const thumbnailUrl = thumbnailUrlFor(songCtx.genre);
    if (thumbnailUrl) {
      console.log(`[post-to-ghl] using thumbnail: ${thumbnailUrl}`);
    } else {
      console.log(`[post-to-ghl] no thumbnail for genre "${songCtx.genre}" — GHL will auto-generate from video first frame`);
    }

    // Track results of each variant per platform. One API call per platform
    // (not one per variant as in the old code) — GHL's `summary` field
    // accepts only a string, so we can't multiplex platforms per call.
    const feedResults: Record<string, { id: string | null; err: string | null }> = {};
    const storyResults: Record<string, { id: string | null; err: string | null }> = {};

    const feedBaseDate = Date.now() + FEED_SCHEDULE_DELAY_SECONDS * 1000;
    const storyBaseDate = Date.now() + STORY_SCHEDULE_DELAY_SECONDS * 1000;

    // ---- FEED variant: one call per connected platform ----
    if (!post.ghl_post_id) {
      for (let i = 0; i < usable.length; i++) {
        const account = usable[i];
        // Stagger each platform by 30s so they don't all hit at the same
        // second in GHL's queue. Keeps dashboard timing readable.
        const scheduleDate = new Date(feedBaseDate + i * 30_000).toISOString();
        const result = await schedulePlatformPost({
          platform: account.platform,
          variant: 'feed',
          accountId: account.id,
          summary: feedCaptionFor(account.platform, songCtx),
          videoUrl: post.social_video_url,
          thumbnailUrl,
          scheduleDate,
        });
        feedResults[account.platform] = { id: result.ghlPostId, err: result.error };
        if (result.error) console.warn(`[post-to-ghl] feed/${account.platform} failed:`, result.error);
        else console.log(`[post-to-ghl] feed/${account.platform} scheduled for ${scheduleDate}`);
      }
    } else {
      console.log(`[post-to-ghl] feed already scheduled (${post.ghl_post_id}), skipping`);
    }

    // ---- STORY variant: IG + FB only, one call per platform ----
    const storyPlatforms = usable.filter(
      (a) => a.platform === 'instagram' || a.platform === 'facebook',
    );
    if (!post.ghl_story_post_id && storyPlatforms.length > 0) {
      for (let i = 0; i < storyPlatforms.length; i++) {
        const account = storyPlatforms[i];
        const scheduleDate = new Date(storyBaseDate + i * 30_000).toISOString();
        const result = await schedulePlatformPost({
          platform: account.platform,
          variant: 'story',
          accountId: account.id,
          summary: storyCaptionFor(account.platform, songCtx),
          videoUrl: post.social_video_url,
          thumbnailUrl,
          scheduleDate,
        });
        storyResults[account.platform] = { id: result.ghlPostId, err: result.error };
        if (result.error) console.warn(`[post-to-ghl] story/${account.platform} failed:`, result.error);
        else console.log(`[post-to-ghl] story/${account.platform} scheduled for ${scheduleDate}`);
      }
    } else if (post.ghl_story_post_id) {
      console.log(`[post-to-ghl] story already scheduled (${post.ghl_story_post_id}), skipping`);
    } else {
      console.log(`[post-to-ghl] no IG/FB accounts — skipping story variant`);
    }

    // ---- Compute overall status + per-platform states ----
    const platformStatuses: Record<string, string | null> = {};
    for (const a of usable) {
      const key = `${a.platform}_status`;
      if (['facebook_status', 'instagram_status', 'tiktok_status', 'youtube_status'].includes(key)) {
        const feedOk = feedResults[a.platform]?.id;
        const storyOk = storyResults[a.platform]?.id;
        platformStatuses[key] =
          feedOk || storyOk ? 'scheduled' : (feedResults[a.platform]?.err ? 'failed' : null);
      }
    }

    // Use the first successful ID per variant as the representative ID in the DB.
    const firstFeedId = Object.values(feedResults).find((r) => r.id)?.id || null;
    const firstStoryId = Object.values(storyResults).find((r) => r.id)?.id || null;

    const allErrors = [
      ...Object.values(feedResults),
      ...Object.values(storyResults),
    ].map((r) => r.err).filter(Boolean);
    const anySuccess =
      Object.values(feedResults).some((r) => r.id) ||
      Object.values(storyResults).some((r) => r.id);

    const updatePayload: any = {
      post_status: anySuccess ? 'scheduled' : 'failed',
      last_error: allErrors.length > 0 ? allErrors.join(' | ').substring(0, 800) : null,
      updated_at: new Date().toISOString(),
      ...platformStatuses,
    };
    if (firstFeedId) updatePayload.ghl_post_id = firstFeedId;
    if (firstStoryId) updatePayload.ghl_story_post_id = firstStoryId;
    if (!anySuccess) {
      updatePayload.retry_count = (post.retry_count || 0) + 1;
      updatePayload.next_retry_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    }

    await supabase.from('social_posts').update(updatePayload).eq('id', post.id);

    if (!anySuccess) {
      throw new Error(`All platform posts failed: ${allErrors.join(' | ')}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        feed: feedResults,
        story: storyResults,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error: any) {
    console.error('[post-to-ghl] error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
