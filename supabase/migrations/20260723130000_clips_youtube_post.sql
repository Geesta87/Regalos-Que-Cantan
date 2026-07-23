-- Track the manual "Post to YouTube" action on a Clip Studio clip so the button
-- can show "Posted" and prevent double-posting. Additive, nullable — no backfill.
alter table public.clips add column if not exists youtube_post_id text;
alter table public.clips add column if not exists youtube_posted_at timestamptz;
