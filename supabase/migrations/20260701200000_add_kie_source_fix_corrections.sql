-- Multi-part surgical song fix support.
--
-- kie_source: the ORIGINAL Kie voice-track for a song ({ "taskId", "audioId" }),
--   captured the first time a surgical fix runs. It NEVER gets nulled by an
--   apply (unlike kie_task_id / kie_payload, which point at the current audio and
--   are cleared when a spliced fix is applied). This is what lets a SECOND or
--   multi-part surgical fix keep re-singing from the same original voice instead
--   of falling back to a full re-roll. Only useful while Kie still retains the
--   audio (~14 days after the song was made).
--
-- fix_corrections: the list of corrections applied to the song so far
--   ([{ "label", "note", "approvedLyrics" }, ...]). Lets the multi-part fix UI
--   pre-load prior corrections so re-deriving the song from the pristine original
--   never drops an earlier fix.

ALTER TABLE songs ADD COLUMN IF NOT EXISTS kie_source jsonb;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS fix_corrections jsonb;

COMMENT ON COLUMN songs.kie_source IS 'Original Kie voice-track {taskId,audioId} for surgical re-fixes; survives applies (~14d Kie retention).';
COMMENT ON COLUMN songs.fix_corrections IS 'List of applied surgical corrections [{label,note,approvedLyrics}] for multi-part re-derivation.';
