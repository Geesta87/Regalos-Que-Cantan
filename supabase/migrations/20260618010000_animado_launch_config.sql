-- Animado (story-video upsell) launch control.
-- A single-row config that gates whether the offer is shown to customers and
-- caps how many can be in-flight at once, so a soft launch can't outrun manual
-- fulfillment. Defaults to DISABLED — the offer stays invisible until an admin
-- flips enabled = true.

create table if not exists public.story_video_config (
  id              boolean primary key default true,    -- single-row guard (always true)
  enabled         boolean not null default false,      -- master on/off for the customer-facing offer
  max_in_progress integer not null default 12,         -- hide the offer once this many orders are unfinished
  price_one_cents integer not null default 4900,        -- $49.00  — one animated video
  price_both_cents integer not null default 6999,       -- $69.99 — both songs animated
  note            text,                                 -- free-text admin note
  updated_at      timestamptz not null default now(),
  constraint story_video_config_singleton check (id = true)
);

insert into public.story_video_config (id, enabled)
values (true, false)
on conflict (id) do nothing;

-- Read-only to anon (the availability check); only service role can change it.
alter table public.story_video_config enable row level security;
drop policy if exists story_video_config_read on public.story_video_config;
create policy story_video_config_read on public.story_video_config for select using (true);
