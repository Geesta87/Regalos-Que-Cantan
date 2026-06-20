-- Admin can dismiss a video order from the "Problemas" list in the Videos tab
-- (e.g. old abandoned/stuck orders) without deleting it. Excluded from the
-- problems query when true.
alter table public.video_orders add column if not exists admin_dismissed boolean not null default false;
