-- 20260501_admin_dismissed.sql
-- Adds an "admin has acknowledged this row, don't keep flagging it" timestamp.
--
-- Why this exists: the dashboard's "Stuck or failed songs" attention-summary
-- card was counting hundreds of historical abandoned signups (no audio_url,
-- never paid, older than a couple of hours). They are not actionable any
-- more — the customers walked away weeks/months ago. The admin reviewed
-- them once and wants the badge to go to zero so it only flags fresh issues.
--
-- We DON'T delete those rows: the historical signup data is still useful
-- for funnel analysis and remarketing. We just stamp this column so the
-- dashboard knows to skip them in the stuck count.
--
-- Going forward the column can be reused to dismiss any kind of admin
-- attention flag (the name is intentionally generic).

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS admin_dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN songs.admin_dismissed_at IS
  'Set by admin dashboard when an admin has acknowledged that this row no longer needs attention (e.g. an old abandoned-cart signup or a failed payment that has been handled). NULL = still flagged. Used by the "Stuck or failed songs" counter and any future similar attention queues.';
