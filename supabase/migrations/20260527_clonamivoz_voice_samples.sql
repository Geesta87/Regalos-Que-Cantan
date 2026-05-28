-- 20260527_clonamivoz_voice_samples.sql
--
-- Adds support for the Clone Mi Voz feature (regalosquecantan.com/clonamivoz).
--
-- A separate, opt-in flow where a customer records a 45-90s voice sample, our
-- AI partners (Claude for lyrics, Suno via Kie.ai for music) generate a song
-- that's sung in THEIR voice. This is launched as a standalone route, NOT
-- integrated into the existing genre/voice funnel — that integration can come
-- later. Today's scope: route + tables + edge functions, no Stripe, no email,
-- no funnel touch.
--
-- Tables created (both new, no existing rows touched):
--   public.voice_samples       — uploaded customer voice files
--   public.cloned_voice_songs  — orders + generated songs for this tier
--
-- Privacy:
--   voice_samples.delete_at defaults to (now() + 30 days). The pg_cron
--   job 'purge-old-clonamivoz-voice-samples' marks them deleted_at = now()
--   when delete_at passes. The Storage file itself is purged by an
--   edge function that reads voice_samples WHERE deleted_at IS NOT NULL
--   AND storage_path IS NOT NULL (delete from Storage, then NULL the path).
--   That purge function lives in upload-customer-voice OR a separate
--   cron-callable function — TBD in a later commit.
--
-- All operations are additive. The existing public.songs table is NOT touched.
-- Existing customers ordering through the regular funnel are unaffected.

-- ---------------------------------------------------------------------------
-- voice_samples — customer voice uploads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voice_samples (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Path inside the 'customer-voices' Storage bucket. Combined with the
  -- bucket name, this is enough to fetch / delete the file.
  storage_path    TEXT         NOT NULL,
  -- Public-fetchable URL we passed to Suno/Kie. May be a signed URL with
  -- TTL; we keep it for diagnostics. NULL if we use a signed URL per request.
  public_url      TEXT,
  duration_seconds NUMERIC,
  source_mime     TEXT,
  source_size_bytes BIGINT,
  -- Customer email is the only identifier we keep — no auth account model
  -- in Phase 1 (matches RQC's existing pattern for the regular funnel).
  customer_email  TEXT,
  -- 30-day retention by default; purge cron marks deleted_at when delete_at passes.
  delete_at       TIMESTAMPTZ  NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  deleted_at      TIMESTAMPTZ
);

-- Partial index used by the purge cron (only scans live samples).
CREATE INDEX IF NOT EXISTS voice_samples_delete_at_idx
  ON public.voice_samples (delete_at)
  WHERE deleted_at IS NULL;

-- Look up a customer's past samples without scanning the whole table.
CREATE INDEX IF NOT EXISTS voice_samples_customer_email_idx
  ON public.voice_samples (customer_email)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE  public.voice_samples              IS 'Clone Mi Voz: raw customer voice uploads. 30-day auto-purge via pg_cron + edge function.';
COMMENT ON COLUMN public.voice_samples.storage_path IS 'Path in the customer-voices Storage bucket, e.g. <uuid>.mp3';
COMMENT ON COLUMN public.voice_samples.public_url   IS 'Public/signed URL used to pass voice to Suno. May expire; storage_path is the canonical reference.';
COMMENT ON COLUMN public.voice_samples.delete_at    IS 'When this sample should be auto-deleted from Storage (30 days from upload by default).';
COMMENT ON COLUMN public.voice_samples.deleted_at   IS 'Set by purge cron when delete_at passes. The Storage file is then dropped by the purge edge function.';


-- ---------------------------------------------------------------------------
-- cloned_voice_songs — orders + generated audio for Clone Mi Voz tier
-- ---------------------------------------------------------------------------
-- Intentionally a separate table from public.songs. Rationale:
--   * Different generation backend (Suno via Kie, not Mureka)
--   * No Stripe yet, no checkout coupling, no shipping/email flow
--   * Isolation: any bug here can't corrupt the main songs table or its
--     payment-confirmation reconciliation pipeline
-- If/when we promote cloned voice into the regular funnel later, we can add
-- a tier column to public.songs and migrate these rows. For now, fully
-- isolated.
CREATE TABLE IF NOT EXISTS public.cloned_voice_songs (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Reference to the voice file used to generate this song. SET NULL on
  -- voice_samples delete so the order history survives even after the
  -- voice file is purged.
  voice_sample_id     UUID         REFERENCES public.voice_samples(id) ON DELETE SET NULL,

  -- Customer details (free-form from the story form; not validated against
  -- any account or contact list).
  customer_email      TEXT,
  recipient_name      TEXT,
  occasion            TEXT,
  relationship        TEXT,
  story               TEXT,
  -- Genre slug. Starts with the 6 launch genres validated in the test app:
  -- romantico, balada, banda, corrido, ranchera, mariachi. Free-form to
  -- avoid schema churn as we add more.
  genre_slug          TEXT,
  language            TEXT         DEFAULT 'es',

  -- Outputs from Claude lyric generation.
  title               TEXT,
  lyrics              TEXT,
  emotional_modifiers TEXT,
  lyrics_model_used   TEXT,  -- which Claude model produced the lyrics (Sonnet vs Haiku fallback)

  -- Outputs from Suno/Kie generation.
  kie_task_id         TEXT,
  suno_audio_urls     TEXT[],  -- typically 2 variants per generation

  -- Lifecycle.
  status              TEXT         NOT NULL DEFAULT 'pending',
  error_message       TEXT,
  completed_at        TIMESTAMPTZ
);

-- Enforce valid status values.
ALTER TABLE public.cloned_voice_songs
  DROP CONSTRAINT IF EXISTS cloned_voice_songs_status_check;

ALTER TABLE public.cloned_voice_songs
  ADD CONSTRAINT cloned_voice_songs_status_check
  CHECK (status IN (
    'pending',                -- row created, voice/lyrics not yet started
    'generating_lyrics',      -- Claude call in flight
    'generating_song',        -- Suno call in flight
    'success',                -- songs available in suno_audio_urls
    'failed'                  -- error_message populated
  ));

-- Ops queries: "which jobs are stuck?", "recent successes today", etc.
CREATE INDEX IF NOT EXISTS cloned_voice_songs_status_created_idx
  ON public.cloned_voice_songs (status, created_at DESC);

-- Look up by Kie task id (for the polling endpoint).
CREATE INDEX IF NOT EXISTS cloned_voice_songs_kie_task_id_idx
  ON public.cloned_voice_songs (kie_task_id)
  WHERE kie_task_id IS NOT NULL;

COMMENT ON TABLE  public.cloned_voice_songs                 IS 'Clone Mi Voz: customer orders + AI-generated songs in their own voice. Separate from public.songs to isolate from the main Mureka/Stripe pipeline.';
COMMENT ON COLUMN public.cloned_voice_songs.voice_sample_id IS 'Voice file used. SET NULL when sample is purged so the order history survives.';
COMMENT ON COLUMN public.cloned_voice_songs.genre_slug      IS 'Slug of the chosen genre. Launch set: romantico, balada, banda, corrido, ranchera, mariachi.';
COMMENT ON COLUMN public.cloned_voice_songs.status          IS 'Lifecycle: pending → generating_lyrics → generating_song → success | failed.';


-- ---------------------------------------------------------------------------
-- pg_cron: daily voice sample purge
-- ---------------------------------------------------------------------------
-- Marks samples past delete_at as deleted_at = now(). The actual Storage
-- file deletion happens out-of-band via an edge function (added in a later
-- commit) that reads `WHERE deleted_at IS NOT NULL AND storage_path IS NOT NULL`
-- and processes them in batches.
--
-- Uses cron.schedule's UPSERT semantics — re-running this migration won't
-- create duplicate cron jobs.
SELECT cron.schedule(
  'purge-old-clonamivoz-voice-samples',
  '0 3 * * *',  -- daily 3am
  $$
    UPDATE public.voice_samples
       SET deleted_at = now()
     WHERE delete_at < now()
       AND deleted_at IS NULL;
  $$
);
