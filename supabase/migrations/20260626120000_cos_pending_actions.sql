-- Chief of Staff: proposed Meta-ads actions that require explicit owner approval.
-- Sofía/COS NEVER execute directly — a row lands here as 'pending', the dashboard
-- shows a Confirm/Cancel card, and only on Confirm does cos-assistant run the
-- Marketing API write (pause/resume/budget) or the creative hand-off. Service-role
-- only (reached via the admin-gated cos-assistant edge function).
create table if not exists public.cos_pending_actions (
  id           uuid primary key default gen_random_uuid(),
  action_type  text not null check (action_type in ('pause','resume','set_budget','extract_creative')),
  target_type  text not null check (target_type in ('campaign','adset','ad')),
  target_id    text,
  target_name  text,
  params       jsonb not null default '{}'::jsonb,   -- e.g. {"daily_budget_usd":75} or {"image_url":"…","copy":"…"}
  summary      text,                                  -- human-readable: "⏸ Pause campaign 'Corrido Heroes' ($50/day)"
  status       text not null default 'pending' check (status in ('pending','confirmed','done','failed','cancelled')),
  result       text,                                  -- execution outcome / error
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table public.cos_pending_actions enable row level security;
create index if not exists idx_cos_pending_actions_status on public.cos_pending_actions (status, created_at desc);
