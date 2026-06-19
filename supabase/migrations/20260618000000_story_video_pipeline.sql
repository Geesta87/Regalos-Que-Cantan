-- Story-video automation pipeline (Phase 1)
-- One row per animated-story-video order. Drives the state machine + the two
-- admin approval gates (likeness pick, final review).
-- NOT YET APPLIED — review before running via: supabase db push (or apply_migration).

create table if not exists public.story_video_orders (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- links
  song_id            uuid references public.songs(id),
  video_order_id     uuid references public.video_orders(id),
  stripe_session_id  text,
  amount_cents       integer,
  tier               text not null default 'animado',   -- 'animado' | (future) 'cinematografico'

  -- customer input
  recipient_photo_url text,                              -- the good front photo they upload

  -- pipeline state machine
  state              text not null default 'awaiting_photo',
  -- awaiting_photo -> generating_likeness -> likeness_review (GATE 1)
  --   -> building -> final_review (GATE 2) -> delivered ; or failed

  -- GATE 1: likeness
  character_options  jsonb,        -- [{media_id, url}] the 2 auto-generated likeness options
  approved_character_url text,     -- the chosen cartoon
  approved_character_by  text,     -- admin email/name
  approved_character_at  timestamptz,

  -- build artifacts
  storyboard         jsonb,        -- Claude auto-storyboard output
  scene_assets       jsonb,        -- [{idx, prompt, taskId, status, url}]
  hero_assets        jsonb,        -- [{idx, taskId, status, url}]
  morph_asset        jsonb,        -- {taskId, status, url}
  render_task_id     text,
  video_url          text,         -- final mp4 in storage

  -- GATE 2: final review + delivery
  final_approved     boolean not null default false,
  final_approved_by  text,
  final_approved_at  timestamptz,
  delivered_at       timestamptz,

  -- ops
  error              text,
  cost_credits       integer not null default 0
);

create index if not exists story_video_orders_state_idx     on public.story_video_orders (state);
create index if not exists story_video_orders_song_idx      on public.story_video_orders (song_id);
create index if not exists story_video_orders_created_idx   on public.story_video_orders (created_at desc);

-- keep updated_at fresh
create or replace function public.touch_story_video_orders() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_touch_story_video_orders on public.story_video_orders;
create trigger trg_touch_story_video_orders before update on public.story_video_orders
  for each row execute function public.touch_story_video_orders();

-- The admin "Needs Approval" tab reads from here.
create or replace view public.story_videos_needs_approval as
  select id, song_id, state, recipient_photo_url, character_options,
         approved_character_url, video_url, created_at, updated_at
  from public.story_video_orders
  where state in ('likeness_review', 'final_review')
  order by created_at asc;

-- Service-role only by default (edge functions). Admin UI reads via the dashboard's
-- existing authenticated/admin path — add RLS policies to match your admin model.
alter table public.story_video_orders enable row level security;
