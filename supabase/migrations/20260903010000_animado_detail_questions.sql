-- "Ask the song": up to 3 questions generated from the customer's story + lyrics
-- (the facts the storyboard would otherwise invent), and the customer's answers.
-- Answers are injected into generate-storyboard as customer FACTS.
alter table public.story_video_orders
  add column if not exists detail_questions jsonb,
  add column if not exists detail_answers jsonb;
comment on column public.story_video_orders.detail_questions is 'animado-photo action=questions: [{id,text,hint,gap}] generated from story+lyrics; cached per order.';
comment on column public.story_video_orders.detail_answers is 'Customer answers [{id,question,answer}] from the upload step; generate-storyboard treats them as facts.';
