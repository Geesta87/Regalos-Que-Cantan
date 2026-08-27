-- 20260828000000_clonamivoz_prepay_full_render.sql
--
-- Pre-payment FULL-SONG render for Clona Mi Voz (owner decision 2026-08-27):
-- align with the main funnel's "song generates BEFORE payment" model. The
-- "preview" is now the COMPLETE real song; the customer hears a server-cut
-- 40-second teaser of the actual track (dispute armor: they heard exactly
-- what they bought), and payment unlocks instantly — nothing left to render.
--
-- genre_renders: per-genre map of the full renders made during genre A/B,
--   { "<slug>": { "suno": [..], "permanent": [..], "teaser": "url" } }
-- Needed because the delivered song is now the PRE-generated audio: when the
-- customer switches back to an already-rendered genre (set-genre fast path),
-- the row's primary audio fields must flip to THAT genre's files, or they
-- would pay for cumbia and receive corrido.

ALTER TABLE public.cloned_voice_songs
  ADD COLUMN IF NOT EXISTS genre_renders JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.cloned_voice_songs.genre_renders IS
  'Per-genre full renders from the pre-payment flow: {slug: {suno:[], permanent:[], teaser:url}}. set-genre copies the chosen entry into the primary audio columns.';
