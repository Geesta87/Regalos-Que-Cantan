// supabase/functions/render-share-videos/index.ts
// Deploy with: supabase functions deploy render-share-videos --project-ref yzbvajungshqcpusfiia
//
// Dispatcher for per-song branded share videos (the video that replaces the
// audio player on the /song/:id gift page). Designed to run from pg_cron every
// 5 minutes (same no-JWT pattern as health-check / clip-studio-watchdog), but
// until the cron is scheduled the feature is effectively OFF.
//
// Each run:
//   1. picks up to BATCH paid songs newer than the launch cutoff that still
//      need a share video (never-tried, failed <3 attempts, or stale
//      'rendering' >25 min — a renderer redeploy kills in-flight 202 jobs),
//   2. mints a signed upload URL for videos/share/<song_id>.mp4,
//   3. POSTs the job to the Cloud Run renderer (/share-video, 202-ack), which
//      reports back via the share-video-callback edge fn.
//
// Manual test mode: POST {"song_id":"..."} dispatches that one paid song
// immediately, ignoring the cutoff — used for the pre-launch live test.
//
// FUTURE SONGS ONLY (owner decision 2026-07-19): the cutoff keeps the back
// catalog untouched; no backfill.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RENDERER_URL = Deno.env.get('INHOUSE_RENDERER_URL');
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';

const LAUNCH_CUTOFF = Deno.env.get('SHARE_VIDEO_CUTOFF') || '2026-07-19T00:00:00Z';
const BATCH = 4;
const MAX_ATTEMPTS = 3;
const STALE_MINUTES = 25;
const BUCKET = 'videos';
const SITE_URL = 'https://www.regalosquecantan.com';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/share-video-callback`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type SongRow = {
  id: string; audio_url: string; genre: string | null; image_url: string | null;
  recipient_name: string | null; sender_name: string | null;
  share_video_status: string | null; share_video_attempts: number | null;
};

async function dispatchSong(song: SongRow): Promise<string | null> {
  if (!RENDERER_URL) throw new Error('INHOUSE_RENDERER_URL not configured');

  const objectPath = `share/${song.id}.mp4`;
  const { data: signed, error: se } = await supabase.storage.from(BUCKET)
    .createSignedUploadUrl(objectPath, { upsert: true });
  if (se) throw new Error(`sign: ${se.message}`);
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;

  // Artwork preference: our own genre art (permanent, branded) -> the song's
  // provider cover (may expire in ~14 days, but it gets baked into the MP4
  // at render time) -> renderer's plain-backdrop fallback.
  const artUrls = [
    song.genre ? `${SITE_URL}/images/album-art/${song.genre}.jpg` : null,
    song.image_url || null,
  ].filter(Boolean);

  await supabase.from('songs').update({
    share_video_status: 'rendering',
    share_video_attempts: (song.share_video_attempts || 0) + 1,
    share_video_dispatched_at: new Date().toISOString(),
  }).eq('id', song.id);

  const res = await fetch(`${RENDERER_URL}/share-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN },
    body: JSON.stringify({
      song_id: song.id,
      audio_url: song.audio_url,
      art_urls: artUrls,
      recipient_name: song.recipient_name || '',
      sender_name: song.sender_name || '',
      output_upload_url: signed.signedUrl,
      output_path: objectPath,
      output_public_url: publicUrl,
      callback_url: CALLBACK_URL,
    }),
  });
  if (res.status !== 202) {
    const body = (await res.text()).slice(0, 200);
    await supabase.from('songs').update({ share_video_status: 'failed', share_video_error: `dispatch ${res.status}: ${body}` }).eq('id', song.id);
    return `dispatch ${res.status}`;
  }
  return null;
}

serve(async (req) => {
  let manualSongId = '';
  try {
    const body = await req.json();
    manualSongId = String(body?.song_id || '');
  } catch { /* cron calls have no body */ }

  try {
    let songs: SongRow[] = [];

    if (manualSongId) {
      const { data, error } = await supabase.from('songs')
        .select('id, audio_url, genre, image_url, recipient_name, sender_name, share_video_status, share_video_attempts')
        .eq('id', manualSongId).eq('paid', true).not('audio_url', 'is', null).limit(1);
      if (error) throw error;
      if (!data?.length) return json({ error: 'song not found or not paid' }, 404);
      songs = data as SongRow[];
    } else {
      const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
      const { data, error } = await supabase.from('songs')
        .select('id, audio_url, genre, image_url, recipient_name, sender_name, share_video_status, share_video_attempts, share_video_dispatched_at')
        .eq('paid', true)
        .is('share_video_url', null)
        .not('audio_url', 'is', null)
        .gte('paid_at', LAUNCH_CUTOFF)
        .lt('share_video_attempts', MAX_ATTEMPTS)
        .or(`share_video_status.is.null,share_video_status.eq.failed,and(share_video_status.eq.rendering,share_video_dispatched_at.lt.${staleBefore})`)
        .order('paid_at', { ascending: true })
        .limit(BATCH);
      if (error) throw error;
      songs = (data || []) as SongRow[];
    }

    const results: Record<string, string> = {};
    for (const song of songs) {
      try {
        const err = await dispatchSong(song);
        results[song.id] = err || 'dispatched';
      } catch (e) {
        results[song.id] = `error: ${(e as Error).message}`;
        console.error(`[render-share-videos] ${song.id}:`, (e as Error).message);
      }
    }
    console.log(`[render-share-videos] processed ${songs.length}:`, JSON.stringify(results));
    return json({ ok: true, processed: songs.length, results });
  } catch (e) {
    console.error('[render-share-videos] run failed:', (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
