-- Dedupe flag for the "come upload your photos" reminder email.
-- Set the moment remind-upload-photos dispatches a reminder for a song so the
-- cron never double-sends. NULL = no reminder sent yet.
alter table public.songs
  add column if not exists video_photo_reminder_sent_at timestamptz;

comment on column public.songs.video_photo_reminder_sent_at is
  'When the photo-upload reminder was sent for this video-addon order (remind-upload-photos). NULL = not sent.';
