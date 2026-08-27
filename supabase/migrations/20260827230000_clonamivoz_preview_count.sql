-- 20260827230000_clonamivoz_preview_count.sql
--
-- Genre A/B previews (owner request 2026-08-27): the preview screen now lets
-- the customer re-render the preview in other genres with the same voice.
-- Those re-renders ride the retry path (same row), which is exempt from the
-- per-voice-sample daily rate limit — so cap Kie preview submissions PER ROW
-- instead. generate-cloned-voice-preview increments this on every Kie submit
-- and refuses past 8 (≈ all the genre curiosity a buyer needs, bounded spend).

ALTER TABLE public.cloned_voice_songs
  ADD COLUMN IF NOT EXISTS preview_generation_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cloned_voice_songs.preview_generation_count IS
  'How many Kie preview generations this row has submitted (first + retries + genre A/B). Capped at 8 in generate-cloned-voice-preview.';
