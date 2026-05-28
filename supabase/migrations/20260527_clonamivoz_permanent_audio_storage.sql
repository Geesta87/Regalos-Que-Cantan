-- 20260527_clonamivoz_permanent_audio_storage.sql
--
-- Follow-up to 20260527_clonamivoz_voice_samples.sql.
--
-- Why this exists
-- ---------------
-- Suno (via Kie.ai) returns playable audio URLs that point at Suno's CDN.
-- Those URLs expire after ~15-30 days. If a customer comes back a month
-- later to re-download their song, the original URL is dead.
--
-- This migration:
--   1. Adds public.cloned_voice_songs.permanent_audio_urls — the URLs of
--      the audio files we copied into OUR Supabase Storage.
--   2. Creates a public Storage bucket 'cloned-voice-songs' to hold them.
--   3. Lets anyone with the URL play the file (public bucket, unguessable
--      UUID-based path). Service role writes.
--
-- The cloned-voice-status edge function does the actual copy: on the first
-- poll that detects Kie SUCCESS, it downloads each Suno MP3 and uploads it
-- to this bucket. The status response prefers permanent URLs, falls back
-- to the original Suno URLs if the copy failed for any reason — so the
-- customer always gets SOMETHING playable.
--
-- Why a separate bucket from customer-voices
-- ------------------------------------------
-- - customer-voices is PRIVATE + auto-purged after 30 days (biometric data).
-- - cloned-voice-songs is PUBLIC + never auto-purged (the finished gift,
--   the thing the customer actually paid for).
-- Different lifecycle, different audience, different bucket.

-- ---------------------------------------------------------------------------
-- 1. New column on the orders table
-- ---------------------------------------------------------------------------
ALTER TABLE public.cloned_voice_songs
  ADD COLUMN IF NOT EXISTS permanent_audio_urls TEXT[];

COMMENT ON COLUMN public.cloned_voice_songs.permanent_audio_urls IS
  'URLs of audio files copied from Suno into our cloned-voice-songs Storage bucket. Never expire. NULL if the copy hasn''t happened yet or failed; callers should fall back to suno_audio_urls in that case.';


-- ---------------------------------------------------------------------------
-- 2. Public Storage bucket for the finished songs
-- ---------------------------------------------------------------------------
-- Public = anyone with the URL can play it. The path is <uuid>/v<N>.mp3
-- where the uuid is the cloned_voice_song_id — unguessable, but we still
-- treat the URL as semi-secret (we don't list contents anywhere).
--
-- 25 MB cap is generous for a single 4-min MP3 (typical 2-4 MB).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cloned-voice-songs',
  'cloned-voice-songs',
  true,
  25 * 1024 * 1024,
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/x-m4a']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- 3. RLS policies on storage.objects for this bucket
-- ---------------------------------------------------------------------------
-- Public read (anyone can SELECT / play). Service role writes (no policy
-- needed — service role bypasses RLS). This matches how Supabase Storage
-- handles public buckets generally; we add the policy explicitly so it's
-- visible in the dashboard.

DROP POLICY IF EXISTS "Public read access to cloned-voice-songs" ON storage.objects;

CREATE POLICY "Public read access to cloned-voice-songs"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'cloned-voice-songs');
