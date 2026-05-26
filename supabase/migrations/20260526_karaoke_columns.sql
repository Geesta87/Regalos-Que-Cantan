-- 20260526_karaoke_columns.sql
--
-- Adds support for the optional karaoke (instrumental-only) add-on.
--
-- Customers can purchase a $7.99 karaoke version of their song. When paid,
-- the fetch-karaoke edge function pulls the instrumental stem from useapi.net
-- (free per Mureka docs), transcodes to MP3, uploads to Supabase Storage,
-- and writes karaoke_url here. karaoke_status drives the UI state.
--
-- Status semantics:
--   NULL       — customer hasn't bought karaoke (default state)
--   'pending'  — customer paid; fetch-karaoke is working on it
--   'ready'    — karaoke_url is populated and playable
--   'failed'   — fetch failed; karaoke_url stays NULL; ops can retry
--
-- All columns are nullable + additive. No existing query or function is
-- affected — old code that doesn't know about karaoke simply ignores them.

ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS karaoke_url    TEXT,
  ADD COLUMN IF NOT EXISTS karaoke_status TEXT;

-- Enforce the four valid status values (NULL still allowed for "not requested").
ALTER TABLE public.songs
  DROP CONSTRAINT IF EXISTS songs_karaoke_status_check;

ALTER TABLE public.songs
  ADD CONSTRAINT songs_karaoke_status_check
  CHECK (karaoke_status IS NULL OR karaoke_status IN ('pending', 'ready', 'failed'));

-- Small partial index for ops queries like "show me stuck pending karaoke
-- jobs older than 5 min." Cheap because the partial filter keeps it tiny.
CREATE INDEX IF NOT EXISTS songs_karaoke_status_pending_idx
  ON public.songs (karaoke_status)
  WHERE karaoke_status = 'pending';

COMMENT ON COLUMN public.songs.karaoke_url    IS 'Supabase Storage URL of the karaoke (instrumental) MP3. NULL until customer pays for the karaoke add-on and fetch-karaoke completes.';
COMMENT ON COLUMN public.songs.karaoke_status IS 'Lifecycle of the karaoke add-on: NULL=not purchased, pending=fetching, ready=playable, failed=fetch error.';
