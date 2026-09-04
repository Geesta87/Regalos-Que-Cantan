-- The customer can flip "para / de" on the Animado upload screen when the song
-- form got them backwards (Alex el Chino wrote his story in his own voice).
-- Stored on the order only; the song row is untouched. generate-storyboard and
-- story-build-context prefer it over songs.recipient_name / sender_name.
alter table public.story_video_orders
  add column if not exists names_override jsonb;
comment on column public.story_video_orders.names_override is '{recipient, sender} chosen by the customer on the upload screen; overrides the song names for the video only.';
