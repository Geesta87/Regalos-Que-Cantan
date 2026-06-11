-- New-sale push notifications (notify-new-sales) — supporting schema.
--
-- sale_push_sent_at: dedupe stamp set after the admin web-push for that sale
-- goes out. Backfilled for every already-paid song so activation does NOT
-- replay thousands of historical sales as notifications.

alter table public.songs add column if not exists sale_push_sent_at timestamptz;

-- One-time backfill: everything paid before this feature existed counts as
-- already notified.
update public.songs
   set sale_push_sent_at = paid_at
 where paid_at is not null
   and sale_push_sent_at is null;

-- Partial index keeps the per-minute candidate scan tiny as songs grows
-- (same pattern as idx_songs_sms_pending).
create index if not exists idx_songs_sale_push_pending
  on public.songs (paid_at)
  where paid_at is not null and sale_push_sent_at is null;

-- ---------------------------------------------------------------------------
-- Operational setup applied alongside this migration (documented for parity):
--   * pg_cron job 'notify-new-sales' runs every minute and calls the edge
--     function via net.http_post (idempotent by job name).
-- ---------------------------------------------------------------------------
