-- Animado fulfillment tracking: when we last nudged a customer for their photo
-- (so the reminder cron doesn't spam), and a phone captured at upload time.
alter table public.story_video_orders
  add column if not exists photo_reminder_at timestamptz,
  add column if not exists customer_phone text;

-- Hourly reminder cron (chases paid-but-no-photo orders via animado-notify).
-- Scheduled separately via cron.schedule('animado-photo-reminders', '0 * * * *', ...).
