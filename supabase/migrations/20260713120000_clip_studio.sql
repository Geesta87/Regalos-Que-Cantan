-- Clip Studio (Phase 1) — standalone AI captioning tool.
-- Deliberately ISOLATED from the RQC funnel: no FKs to songs / video_orders /
-- anything else, so the whole feature can be lifted into its own project later
-- by copying these two tables + the 'clip-studio' storage bucket.
--
-- Apply with: supabase db push  (or run in the SQL editor)
-- NOTE: the 'clip-studio' storage bucket must also exist (public) — created at
-- go-live, see the launch checklist.

-- One row per uploaded source video.
create table if not exists public.clip_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null default 'Untitled video',
  -- storage locations inside the 'clip-studio' bucket
  source_path text,                -- {id}/source.{ext}  (the uploaded video)
  source_url text,                 -- public URL of the source video
  audio_path text,                 -- {id}/audio.mp3     (extracted by the renderer for Whisper)
  duration_sec numeric,            -- probed by the renderer
  -- Whisper output: { text, language, duration, words:[{word,start,end}] }
  transcript jsonb,
  -- uploaded -> preparing -> transcribing -> ready | error
  status text not null default 'uploaded',
  error_message text
);

-- One row per rendered captioned clip.
create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.clip_projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text,                      -- optional friendly name shown in the UI
  start_sec numeric not null default 0,
  end_sec numeric,                 -- null = to the end of the source
  aspect text not null default '9:16',      -- '9:16' | '1:1' | '16:9'
  style text not null default 'boldpop',    -- caption style key (see renderer clip.js)
  -- rendering -> ready | failed
  status text not null default 'rendering',
  storage_path text,               -- {project_id}/clips/{id}.mp4
  video_url text,                  -- public URL of the finished clip
  render_seconds int,
  error_message text
);

create index if not exists clips_project_idx on public.clips (project_id, created_at desc);
create index if not exists clip_projects_created_idx on public.clip_projects (created_at desc);

-- Service-role only (all access goes through the clip-studio edge function,
-- which checks admin_users). No policies on purpose.
alter table public.clip_projects enable row level security;
alter table public.clips enable row level security;
