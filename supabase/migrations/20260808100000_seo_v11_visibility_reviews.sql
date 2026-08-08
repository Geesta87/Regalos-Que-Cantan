-- SEO agent v1.1 — AI-answer visibility tracking + real customer reviews.
--
-- • seo_ai_visibility — weekly log of "does ChatGPT/Claude/Perplexity name us?"
--   The weekly agent asks realistic buyer questions through the Anthropic API
--   (with web search) and records who got recommended. Service-role only.
-- • song_reviews — REAL customer ratings (1-5) so we can legitimately put
--   star ratings back into Google results (the fabricated ones were removed
--   2026-07-23). Inserts go through the submit-review edge function (which
--   validates the song); approved rows are publicly readable because they are
--   published as testimonials/schema on the site anyway.

create table if not exists public.seo_ai_visibility (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  engine text not null,                      -- e.g. 'claude+websearch', 'perplexity'
  prompt text not null,                      -- the buyer question asked
  rqc_mentioned boolean not null default false,
  brands_mentioned text[] not null default '{}',
  answer_excerpt text
);
alter table public.seo_ai_visibility enable row level security;
create index if not exists seo_ai_visibility_run_idx on public.seo_ai_visibility (run_at desc);

create table if not exists public.song_reviews (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null,
  rating int not null check (rating between 1 and 5),
  comment text,
  reviewer_name text,
  approved boolean not null default true,
  created_at timestamptz not null default now(),
  unique (song_id)                           -- one review per song
);
alter table public.song_reviews enable row level security;
-- Approved reviews are public content (testimonials + schema on the site).
create policy song_reviews_public_read on public.song_reviews
  for select using (approved = true);
create index if not exists song_reviews_created_idx on public.song_reviews (created_at desc);
