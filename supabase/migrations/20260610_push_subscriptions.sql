-- Web-push subscriptions for admin notifications (new inbound SMS, etc).
-- One row per browser/device that enabled notifications in the admin panel.
--
-- RLS is enabled with NO policies on purpose: only edge functions using the
-- service-role key (sms-admin, notify-admin-push) may touch this table.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
