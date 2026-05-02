-- Adds client_ip to songs so the per-IP rate limit on generate-song has a
-- column to filter against.
--
-- Why now: an abuser generated 88 unpaid songs in 36 hours by rotating
-- through 9 fake @myyahoo.com emails. The existing per-email cap (10
-- unpaid/24h) caught each individual email but couldn't stop the rotation.
-- Storing the client IP lets us cap by IP regardless of email and catch
-- this exact pattern.
--
-- Index is a partial — only on rows whose paid=false AND client_ip is set,
-- AND created in the last 24h. That keeps the index tiny because the
-- rate-limit check is the only query that looks at this column.

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS client_ip TEXT;

COMMENT ON COLUMN songs.client_ip IS
  'Forwarded client IP address captured at song generation time. Used by the per-IP rate limit in generate-song to defeat email rotation. NULL for rows older than the rate-limit feature.';

CREATE INDEX IF NOT EXISTS idx_songs_unpaid_ip_recent
  ON songs (client_ip, created_at)
  WHERE paid = false AND client_ip IS NOT NULL;
