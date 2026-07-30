-- Audit trail for campaigns created from the Ads Coach.
-- Every row = one owner-approved, PAUSED campaign + ad set created in Meta.
-- Applied to production 2026-07-30.
create table if not exists public.ads_coach_campaigns (
  id                  bigserial primary key,
  campaign_id         text not null,
  campaign_name       text,
  adset_id            text,
  adset_name          text,
  daily_budget_usd    numeric,
  objective           text,
  template_adset_id   text,
  template_adset_name text,
  created_by          text,
  created_at          timestamptz not null default now()
);

-- Service-role only, same posture as ads_coach_ads: RLS on with no policies,
-- so anon/authenticated get nothing and the edge function (service role) bypasses.
alter table public.ads_coach_campaigns enable row level security;

create index if not exists ads_coach_campaigns_created_at_idx
  on public.ads_coach_campaigns (created_at desc);
