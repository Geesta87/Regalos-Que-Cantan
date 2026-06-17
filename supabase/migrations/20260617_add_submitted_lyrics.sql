-- Persist exactly what the customer submitted in "write my own lyrics" mode,
-- plus a flag for which input path they used. Lets us later compare
-- "what they submitted" vs "what was produced" with certainty (closes the gap
-- exposed by a 2026-06-17 dispute where a customer's original lyrics weren't
-- recoverable because only the final/used lyrics were stored).
ALTER TABLE songs ADD COLUMN IF NOT EXISTS submitted_lyrics text;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS used_custom_lyrics boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN songs.submitted_lyrics IS 'Immutable copy of the exact lyrics the customer pasted in "write my own lyrics" mode. Never overwritten — used to audit/compare what they submitted vs what was produced.';
COMMENT ON COLUMN songs.used_custom_lyrics IS 'True when the customer used the "write my own lyrics" tab (sung verbatim, AI skipped). False = story mode (AI wrote the lyrics from details).';
