-- 20260827200000_clonamivoz_delivery_pipeline.sql
--
-- Clona Mi Voz delivery pipeline (2026-08-27 audit fix).
--
-- Why this exists
-- ---------------
-- Until now a paid Clone Mi Voz song only completed if the CUSTOMER kEPT THE
-- BROWSER TAB OPEN: rehosting to permanent storage and the status flip both
-- lived exclusively in the cloned-voice-status polling endpoint, which only
-- the frontend calls. Close the tab -> the row sits in 'generating_song'
-- forever and the Suno CDN URLs expire in ~14 days. This is not theoretical:
-- the 2026-08-08 paid test order (f1a5c72c) lost BOTH full-song MP3s exactly
-- this way.
--
-- The fix is the poll-cloned-voice-songs sweeper (pg_cron, every 2 min) plus
-- delivery/confirmation emails. This migration adds the bookkeeping columns
-- those need:
--
--   delivery_email_sent_at  "tu cancion esta lista" email idempotency claim.
--                           Set BEFORE the SendGrid call (atomic claim),
--                           reset to NULL if the send fails so it retries.
--   paid_email_sent_at      same, for the "pago recibido" confirmation email.
--   sweeper_alerted_at      the sweeper alerts the owner AT MOST ONCE per row
--                           (stuck-too-long / failed-paid / dead-audio cases).
--   sweeper_retry_count     how many times the sweeper auto-retried a stalled
--                           step (e.g. re-triggering generation for a row that
--                           got stuck in status='paid'). Capped in code at 1.

ALTER TABLE public.cloned_voice_songs
  ADD COLUMN IF NOT EXISTS delivery_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sweeper_alerted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sweeper_retry_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cloned_voice_songs.delivery_email_sent_at IS
  'When the "tu cancion esta lista" delivery email was sent (claimed before send, reset on failure). NULL = not sent yet.';
COMMENT ON COLUMN public.cloned_voice_songs.paid_email_sent_at IS
  'When the "pago recibido" confirmation email was sent. NULL = not sent yet.';
COMMENT ON COLUMN public.cloned_voice_songs.sweeper_alerted_at IS
  'When poll-cloned-voice-songs last alerted the owner about this row. Alerts fire at most once per row.';
COMMENT ON COLUMN public.cloned_voice_songs.sweeper_retry_count IS
  'How many times the sweeper auto-retried a stalled step for this row. Code caps at 1.';

-- The sweeper scans by status every 2 minutes. The table is tiny today, but
-- this keeps the scan index-backed as the tier grows.
CREATE INDEX IF NOT EXISTS idx_cloned_voice_songs_status
  ON public.cloned_voice_songs (status);
