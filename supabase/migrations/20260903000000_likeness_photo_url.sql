-- The photo the approved likeness was generated FROM (a crop of the recipient
-- or the couple). The story builder opens the video on this photo and morphs it
-- into the cartoon. recipient_photo_url stays the family photo for group scenes.
-- 2026-09-02, Alex el Chino (56b175ba): the morph went from the 12-person
-- family photo into a 2-person cartoon because only recipient_photo_url existed.
alter table public.story_video_orders
  add column if not exists likeness_photo_url text;

comment on column public.story_video_orders.likeness_photo_url is
  'Photo the approved likeness was generated from; the story builder opens the video on it (morph source). Null on orders before 2026-09-03.';
