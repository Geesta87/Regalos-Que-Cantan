-- Partner call bookings — "schedule a no-commitment call" on /partners.
-- Written by book-partner-call (public page), read/managed by
-- affiliate-recruiter-admin (Recruit Partners → Scheduled Calls sub-tab).
create table if not exists public.partner_call_bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  preferred_date date not null,
  preferred_time text not null,
  -- pending | confirmed | done | no_show | cancelled
  status text not null default 'pending',
  notes text,
  source text not null default 'partners_page'
);

create index if not exists partner_call_bookings_date_idx
  on public.partner_call_bookings (preferred_date);

-- Service-role only (edge functions). No anon/authenticated policies on purpose.
alter table public.partner_call_bookings enable row level security;
