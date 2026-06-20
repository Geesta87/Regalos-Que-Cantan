-- Bounded auto-retry for stuck in-house renders.
-- poll-pending-videos re-dispatches an order stuck in 'processing' (a render that
-- died on Cloud Run without ever firing a callback). Without a counter it would
-- re-dispatch forever and never surface the failure — a paid order could churn
-- silently for hours (Tere Espinoza, 2026-06-20). This counter lets the cron give
-- up after a few tries and mark the order 'failed' + push-alert the owner instead.
alter table public.video_orders add column if not exists render_attempts integer not null default 0;
