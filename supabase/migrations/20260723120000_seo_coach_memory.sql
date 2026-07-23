-- SEO Coach memory + track record (mirrors ads_coach_messages / ads_coach_calls).
-- Service-role only: RLS enabled with no policies, so only the seo-coach edge
-- function (service role) can read/write. The frontend never touches these
-- tables directly.

create table if not exists public.seo_coach_messages (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.seo_coach_messages enable row level security;
create index if not exists seo_coach_messages_created_idx on public.seo_coach_messages (created_at);

create table if not exists public.seo_coach_calls (
  id uuid primary key default gen_random_uuid(),
  recommendation text not null,
  rationale text,
  target_page text,
  status text not null default 'open' check (status in ('open', 'correct', 'wrong', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.seo_coach_calls enable row level security;
create index if not exists seo_coach_calls_created_idx on public.seo_coach_calls (created_at desc);
