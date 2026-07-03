-- TEAM FEED — how the AI staff talk to each other.
--
-- Any agent can post; agents read entries addressed to them before working:
--   • media-buyer posts 'request' rows to creative-studio ("creative fatigue on
--     campaign X — need fresh variations")
--   • competitor-scan posts 'insight' rows ("this angle is working for a rival")
--   • creative-studio reads its open requests/insights each run, addresses
--     them, marks requests done, and posts a 'result'
--
-- Service-role only (RLS on, no policies).

create table if not exists public.team_feed (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author text not null,              -- 'media-buyer' | 'competitor-scan' | 'creative-studio' | 'chief-of-staff' | 'owner'
  kind text not null check (kind in ('request', 'insight', 'result', 'status')),
  audience text[],                   -- agents this is for; null = everyone
  title text not null,
  body text,
  ref jsonb,                         -- linked ids (campaign, competitor ad, creative_queue rows…)
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  resolved_at timestamptz
);

create index if not exists team_feed_audience_open_idx
  on public.team_feed using gin (audience) where status = 'open';
create index if not exists team_feed_created_idx on public.team_feed (created_at desc);

alter table public.team_feed enable row level security;
