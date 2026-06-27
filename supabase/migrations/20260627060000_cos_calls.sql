-- Sofía's track record — every recommendation/action she makes is logged as a
-- "call", the owner (or a later auto-resolver) marks it right or wrong, and her
-- rolling accuracy EARNS her more autonomy over time. The scoreboard behind the
-- "high-paying employee who proves out" idea.
create table if not exists public.cos_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null default 'weekly_memo',   -- weekly_memo | chat_action | manual
  kind text not null default 'recommendation',  -- scale | cut | budget | creative | recommendation
  subject text,                                  -- the campaign / what it's about
  subject_ref text,                              -- campaign id if known
  call text not null,                            -- the recommendation she made
  rationale text,
  metric_at_call jsonb not null default '{}'::jsonb,
  horizon_days int not null default 7,
  status text not null default 'open',           -- open | correct | wrong | unclear | dismissed
  resolved_at timestamptz,
  outcome text
);
create index if not exists cos_calls_status_idx on public.cos_calls (status, created_at desc);