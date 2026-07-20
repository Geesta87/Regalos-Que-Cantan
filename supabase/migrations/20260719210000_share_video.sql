-- Share video: auto-rendered branded gift video per paid song (replaces the
-- audio player on the /song/:id share page). Future songs only — the
-- render-share-videos dispatcher applies a paid_at cutoff.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS share_video_url text;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS share_video_status text; -- rendering | completed | failed
ALTER TABLE songs ADD COLUMN IF NOT EXISTS share_video_attempts int NOT NULL DEFAULT 0;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS share_video_dispatched_at timestamptz;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS share_video_error text;

-- The dispatcher cron scans "paid, no share video yet, recent" — keep that scan
-- off the 42k-row table's back. Partial index stays tiny (only pending rows).
CREATE INDEX IF NOT EXISTS idx_songs_share_video_pending
  ON songs (paid_at)
  WHERE paid = true AND share_video_url IS NULL;
