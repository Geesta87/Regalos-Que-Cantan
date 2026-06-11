-- Auto "Enviar Link" email on payment (auto-send-paid-email) — schema.
--
-- link_email_sent_at: dedupe stamp set when the song-link email for that
-- purchase goes out automatically. Backfilled for every already-paid song so
-- activation does NOT email historical customers.

alter table public.songs add column if not exists link_email_sent_at timestamptz;

update public.songs
   set link_email_sent_at = paid_at
 where paid_at is not null
   and link_email_sent_at is null;

-- Partial index keeps the per-minute candidate scan tiny (same pattern as
-- idx_songs_sms_pending / idx_songs_sale_push_pending).
create index if not exists idx_songs_link_email_pending
  on public.songs (paid_at)
  where paid_at is not null and link_email_sent_at is null;

-- ---------------------------------------------------------------------------
-- Operational setup applied alongside this migration (documented for parity):
--   * pg_cron job 'auto-send-paid-email' runs every minute and calls the edge
--     function via net.http_post (idempotent by job name).
-- ---------------------------------------------------------------------------
