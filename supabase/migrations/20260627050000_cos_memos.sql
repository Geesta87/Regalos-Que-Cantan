-- Sofía's weekly CEO memo — her unprompted Monday-morning analysis + 3 moves.
create table if not exists public.cos_memos (
  id uuid primary key default gen_random_uuid(),
  week_of date not null,
  headline text,
  summary text,
  body jsonb not null default '{}'::jsonb,   -- { headline, summary, moves:[{title,why,number,action,tab}], watch, metrics }
  status text not null default 'new',         -- new | read
  created_at timestamptz not null default now()
);
create index if not exists cos_memos_created_idx on public.cos_memos (created_at desc);
