-- ============================================================================
-- Email Command Center — Phase 1 foundation
-- Capture layer (email_events) + campaign registry + pre-aggregated rollup +
-- last-touch revenue attribution. Read-only over songs; never touches payments.
-- ============================================================================

-- 1) Raw engagement events from the SendGrid Event Webhook -------------------
create table if not exists public.email_events (
  id            bigint generated always as identity primary key,
  sg_event_id   text unique,                 -- idempotency (SendGrid retries)
  sg_message_id text,                         -- groups events for one send
  email         text,
  event         text not null,               -- delivered|open|click|bounce|dropped|deferred|spamreport|unsubscribe|group_unsubscribe|processed
  campaign_key  text,                         -- resolved from categories
  categories    text[],
  url           text,                         -- click target
  ip            text,
  user_agent    text,
  reason        text,                         -- bounce/drop reason
  ts            timestamptz,                  -- event time
  created_at    timestamptz not null default now(),
  raw           jsonb
);
create index if not exists idx_email_events_campaign on public.email_events (campaign_key, event, ts);
create index if not exists idx_email_events_email    on public.email_events (lower(email));
create index if not exists idx_email_events_msg      on public.email_events (sg_message_id);

-- 2) Canonical campaign registry (groups + labels every campaign) ------------
create table if not exists public.campaign_catalog (
  key          text primary key,
  display_name text not null,
  family       text not null default 'other',  -- win_back|upsell|seasonal|newsletter|transactional|other
  kind         text not null default 'flow',    -- flow|blast
  active       boolean not null default true,
  description  text,
  sort         int not null default 100,
  created_at   timestamptz not null default now()
);

insert into public.campaign_catalog (key, display_name, family, kind, sort) values
  ('abandoned_15min','Abandoned cart · 15 min','win_back','flow',10),
  ('abandoned_1hr','Abandoned cart · 1 hour','win_back','flow',11),
  ('abandoned_24hr','Abandoned cart · 24 hour','win_back','flow',12),
  ('followup_3day','Follow-up · 3 day','win_back','flow',13),
  ('checkout_recovery','Checkout recovery','win_back','flow',14),
  ('purchase_reminder_30min','Purchase reminder · 30 min','win_back','flow',15),
  ('upsell_offer_1','Upsell drip · touch 1','upsell','flow',20),
  ('upsell_offer_2','Upsell drip · last chance','upsell','flow',21),
  ('photo_upload_reminder','Photo-upload reminder','upsell','flow',22),
  ('fathers_day_1_launch','Father''s Day · launch','seasonal','blast',30),
  ('fathers_day_2026','Father''s Day 2026','seasonal','blast',31),
  ('mothers_day_week_1','Mother''s Day · week 1','seasonal','blast',40),
  ('mothers_day_week_2','Mother''s Day · week 2','seasonal','blast',41),
  ('mothers_day_week_3','Mother''s Day · week 3','seasonal','blast',42),
  ('mothers_day_week_4','Mother''s Day · week 4','seasonal','blast',43),
  ('mothers_day_week_5','Mother''s Day · week 5','seasonal','blast',44),
  ('newsletter','Newsletter','newsletter','blast',50),
  ('purchase_confirmation','Purchase confirmation','transactional','flow',90),
  ('test','Test sends','other','blast',200)
on conflict (key) do nothing;

-- 3) Pre-aggregated rollup the dashboard reads (small; full rebuild each run) -
create table if not exists public.email_campaign_daily (
  campaign_key  text not null,
  day           date not null,
  sent          int not null default 0,
  delivered     int not null default 0,
  opens         int not null default 0,
  unique_opens  int not null default 0,
  clicks        int not null default 0,
  unique_clicks int not null default 0,
  unsubs        int not null default 0,
  spam          int not null default 0,
  bounces       int not null default 0,
  purchases     int not null default 0,
  revenue_cents bigint not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (campaign_key, day)
);

-- 4) Insights / alerts -------------------------------------------------------
create table if not exists public.email_insights (
  id           bigint generated always as identity primary key,
  kind         text not null,
  severity     text not null default 'info',   -- info|good|warn|critical
  campaign_key text,
  title        text not null,
  detail       text,
  metric       jsonb,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 5) Meta (capture_started_at, last_refresh) ---------------------------------
create table if not exists public.analytics_meta (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);
insert into public.analytics_meta (key, value)
  values ('capture_started_at', to_jsonb(now()::text))
on conflict (key) do nothing;

-- 6) Unified sends view (email_logs flows + email_recipients blasts) ---------
create or replace view public.v_email_sends as
  select email_type as campaign_key, lower(email) as email, created_at as sent_at,
         null::text as variant, status, song_id
  from public.email_logs
  where email is not null
  union all
  select eq.campaign_key, lower(er.email) as email,
         coalesce(er.sent_at, eq.sent_at) as sent_at,
         er.variant, er.status, null::uuid as song_id
  from public.email_recipients er
  join public.email_queue eq on eq.id = er.email_queue_id
  where er.email is not null and eq.campaign_key is not null;

-- 7) Attribution indexes -----------------------------------------------------
create index if not exists idx_songs_paid_at            on public.songs (paid_at) where paid;
create index if not exists idx_songs_lower_email_paid   on public.songs (lower(email), paid_at) where paid;
create index if not exists idx_email_logs_email_created on public.email_logs (lower(email), created_at);
create index if not exists idx_email_recipients_email   on public.email_recipients (lower(email), sent_at);

-- 8) Rebuild function: engagement rollup + last-touch revenue attribution ----
-- Full rebuild each run (table is campaigns × days ~ a few thousand rows).
create or replace function public.rebuild_email_campaign_daily(
  p_lookback_days int default 220,
  p_window_days   int default 7
) returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n int;
begin
  -- Auto-register any campaign key seen in sends but missing from the catalog.
  insert into public.campaign_catalog (key, display_name, family, kind)
  select distinct s.campaign_key, s.campaign_key, 'other', 'flow'
  from public.v_email_sends s
  where s.campaign_key is not null
    and not exists (select 1 from public.campaign_catalog c where c.key = s.campaign_key)
  on conflict (key) do nothing;

  truncate public.email_campaign_daily;

  with sends as (
    select campaign_key, sent_at::date as day, count(*) as sent
    from public.v_email_sends
    where status = 'sent' and sent_at >= now() - make_interval(days => p_lookback_days)
    group by 1, 2
  ),
  ev as (
    select campaign_key, ts::date as day,
      count(*) filter (where event = 'delivered')                        as delivered,
      count(*) filter (where event = 'open')                             as opens,
      count(distinct email) filter (where event = 'open')                as unique_opens,
      count(*) filter (where event = 'click')                            as clicks,
      count(distinct email) filter (where event = 'click')               as unique_clicks,
      count(*) filter (where event in ('unsubscribe','group_unsubscribe')) as unsubs,
      count(*) filter (where event = 'spamreport')                       as spam,
      count(*) filter (where event in ('bounce','dropped'))              as bounces
    from public.email_events
    where campaign_key is not null and ts >= now() - make_interval(days => p_lookback_days)
    group by 1, 2
  ),
  paid as (
    select distinct on (stripe_session_id)
           stripe_session_id, lower(email) as email, paid_at, amount_paid
    from public.songs
    where paid and platform = 'es' and stripe_session_id is not null and email is not null
      and paid_at >= now() - make_interval(days => p_lookback_days)
    order by stripe_session_id, amount_paid desc nulls last
  ),
  attr as (
    select lt.campaign_key, lt.sent_at::date as day, p.amount_paid
    from paid p
    cross join lateral (
      select s.campaign_key, s.sent_at
      from public.v_email_sends s
      where s.email = p.email and s.status = 'sent'
        and s.sent_at <= p.paid_at
        and s.sent_at >  p.paid_at - make_interval(days => p_window_days)
      order by s.sent_at desc
      limit 1
    ) lt
  ),
  rev as (
    select campaign_key, day,
           count(*) as purchases,
           sum(coalesce(amount_paid,0) * 100)::bigint as revenue_cents
    from attr where campaign_key is not null
    group by 1, 2
  ),
  keys as (
    select campaign_key, day from sends
    union select campaign_key, day from ev
    union select campaign_key, day from rev
  )
  insert into public.email_campaign_daily
    (campaign_key, day, sent, delivered, opens, unique_opens, clicks, unique_clicks,
     unsubs, spam, bounces, purchases, revenue_cents, updated_at)
  select k.campaign_key, k.day,
    coalesce(s.sent,0), coalesce(e.delivered,0), coalesce(e.opens,0), coalesce(e.unique_opens,0),
    coalesce(e.clicks,0), coalesce(e.unique_clicks,0), coalesce(e.unsubs,0), coalesce(e.spam,0),
    coalesce(e.bounces,0), coalesce(r.purchases,0), coalesce(r.revenue_cents,0), now()
  from keys k
  left join sends s on s.campaign_key = k.campaign_key and s.day = k.day
  left join ev    e on e.campaign_key = k.campaign_key and e.day = k.day
  left join rev   r on r.campaign_key = k.campaign_key and r.day = k.day;

  get diagnostics n = row_count;

  insert into public.analytics_meta (key, value, updated_at)
  values ('last_refresh', to_jsonb(now()::text), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return n;
end;
$fn$;
