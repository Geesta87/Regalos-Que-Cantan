-- 20260506_email_sent_tracking.sql
-- Adds an "we delivered the song link via email" timestamp so the admin
-- dashboard can show a small "email sent?" checkbox next to the customer's
-- email — used when there's no WhatsApp number on file and the song link is
-- being delivered manually via the Mi Canción recovery flow.
--
-- Mirrors the whatsapp_sent_at column added in 20260430. Same shape so the
-- two delivery channels can co-exist on a single row without coupling.
--
-- Backfill policy: NULL = "not yet sent" for every historical row. We do NOT
-- auto-populate this from email_logs because email_logs covers automated
-- order confirmations too — we only want to track manual recovery sends here.

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN songs.email_sent_at IS
  'Set by admin dashboard when the song link has been delivered manually via email (Mi Canción recovery flow). NULL = pending. Used by the small "email sent?" checkbox next to the email address on paid orders without a WhatsApp number.';
