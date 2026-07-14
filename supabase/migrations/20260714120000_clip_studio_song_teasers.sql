-- Clip Studio: song teasers.
-- kind 'video' = uploaded footage (default); 'song_teaser' = a catalog song
-- turned into a karaoke-caption teaser (audio window + cover-art background).
-- meta carries { song_id, cover_url } for teaser projects.
alter table public.clip_projects add column if not exists kind text not null default 'video';
alter table public.clip_projects add column if not exists meta jsonb;

-- Phase 2 pool: songs the owner has cleared for marketing use (samples,
-- bake-off tracks, demo songs). The daily factory rotates through ACTIVE rows.
create table if not exists public.marketing_song_pool (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null unique,
  note text,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.marketing_song_pool enable row level security;
