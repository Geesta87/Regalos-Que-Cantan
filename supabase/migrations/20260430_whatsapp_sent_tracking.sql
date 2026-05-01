-- 20260430_whatsapp_sent_tracking.sql
-- Adds an explicit "we delivered the song via WhatsApp" timestamp so the
-- admin dashboard can show a "Por Enviar" (Pending to Send) queue and stop
-- relying on guesswork.
--
-- Why a single timestamp column (and not a separate deliveries table)?
--   * Each paid song with a phone number gets sent once per buyer; we don't
--     need a multi-row delivery history right now.
--   * One nullable column keeps the schema simple and the dashboard query
--     trivial: WHERE paid AND whatsapp_phone IS NOT NULL AND whatsapp_sent_at IS NULL.
--   * If we ever need a full audit trail we can add a song_deliveries table
--     later; this column will become the "first sent" anchor.
--
-- Backfill policy: NULL means "not yet sent" for all historical rows. The
-- dashboard exposes an admin-only one-click backfill action that marks every
-- paid song created before a chosen cutoff as already sent (timestamp = now)
-- so the queue isn't flooded on day one. We DON'T auto-backfill here because
-- there's no way to know from the DB alone which historical paid songs we
-- actually delivered by WhatsApp vs. by email-only.

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN songs.whatsapp_sent_at IS
  'Set by admin dashboard when the song link has been delivered to the buyer via WhatsApp. NULL = pending delivery. Used by the "Por Enviar" queue.';

-- Partial index: only paid songs with a phone number that haven't been sent
-- yet. This is the exact predicate of the "Por Enviar" tab and keeps the
-- index tiny (typically <1% of the table).
CREATE INDEX IF NOT EXISTS idx_songs_pending_whatsapp
  ON songs (created_at)
  WHERE paid = true
    AND whatsapp_phone IS NOT NULL
    AND whatsapp_sent_at IS NULL;
