-- Saved teleprompter scripts for Clip Studio's Script Studio: generated
-- scripts were previously React-state only (lost on refresh). Service-role
-- access from the clip-studio edge fn; RLS on with no policies (same pattern
-- as the other admin-only clip tables).
-- (Already applied to the live db via execute_sql on 2026-07-20.)
create table if not exists clip_scripts (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  script text not null,
  hooks jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table clip_scripts enable row level security;
