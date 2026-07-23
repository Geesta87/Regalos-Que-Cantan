-- Owner-managed availability for the /partners call calendar.
-- Single row (id=1), edited from Recruit Partners → Scheduled Calls → Availability.
create table if not exists public.partner_call_settings (
  id int primary key default 1 check (id = 1),
  -- ISO weekdays: 1=Mon .. 7=Sun
  days int[] not null default '{1,2,3,4,5}',
  slots text[] not null default '{"10:00 AM","11:00 AM","12:00 PM","2:00 PM","4:00 PM","5:00 PM","6:00 PM"}',
  blocked_dates date[] not null default '{}',
  updated_at timestamptz not null default now()
);

insert into public.partner_call_settings (id) values (1) on conflict do nothing;

-- Service-role only (edge functions), same as partner_call_bookings.
alter table public.partner_call_settings enable row level security;
