-- Soft-delete for Animado orders: an X'd likeness moves to the Deleted sub-tab
-- (state = 'deleted') instead of vanishing, and can be restored to the exact
-- state it was removed from. Rows and their uploaded photos are kept.
alter table public.story_video_orders
  add column if not exists deleted_at         timestamptz,
  add column if not exists deleted_by         text,
  add column if not exists deleted_from_state text;
