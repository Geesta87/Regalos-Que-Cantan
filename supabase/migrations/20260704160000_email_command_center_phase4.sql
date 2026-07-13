-- ============================================================================
-- Email Command Center — Phase 4 depth
--   1) Attribute UPSELL CHARGES (not just song purchases) so upsell campaigns
--      get real revenue credit.
--   2) Helper functions for the console: send-time heatmap, A/B tests,
--      dormant-buyer segment.
-- All read-only; never touches the payment funnel.
-- ============================================================================

-- 1) Rebuild: revenue = song purchases (dedup per session) + paid upsell charges,
--    each attributed last-touch to the email that preceded it within the window.
create or replace function public.rebuild_email_campaign_daily(
  p_lookback_days int default 220,
  p_window_days   int default 7
) returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare n int;
begin
  insert into public.campaign_catalog (key, display_name, family, kind)
  select distinct s.campaign_key,
         s.campaign_key,
         case when s.campaign_key like 'em\_%' then 'newsletter' else 'other' end,
         case when s.campaign_key like 'em\_%' then 'blast' else 'flow' end
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
  revenue_events as (
    -- song purchases, one row per checkout session (bundle-safe)
    select lower(email) as email, paid_at, (amount_paid * 100)::numeric as cents
    from (
      select distinct on (stripe_session_id) stripe_session_id, email, paid_at, amount_paid
      from public.songs
      where paid and platform = 'es' and stripe_session_id is not null and email is not null
        and paid_at >= now() - make_interval(days => p_lookback_days)
      order by stripe_session_id, amount_paid desc nulls last
    ) s
    union all
    -- paid post-purchase upsell add-ons (animado / video / instrumental / lyric / gift)
    select lower(coalesce(uc.buyer_email, so.email)) as email,
           coalesce(uc.updated_at, uc.created_at) as paid_at,
           uc.amount_cents::numeric as cents
    from public.upsell_charges uc
    left join public.songs so on so.id = uc.song_id
    where uc.status = 'paid'
      and coalesce(uc.buyer_email, so.email) is not null
      and coalesce(uc.updated_at, uc.created_at) >= now() - make_interval(days => p_lookback_days)
  ),
  attr as (
    select lt.campaign_key, lt.sent_at::date as day, re.cents
    from revenue_events re
    cross join lateral (
      select s.campaign_key, s.sent_at
      from public.v_email_sends s
      where s.email = re.email and s.status = 'sent'
        and s.sent_at <= re.paid_at
        and s.sent_at >  re.paid_at - make_interval(days => p_window_days)
      order by s.sent_at desc
      limit 1
    ) lt
  ),
  rev as (
    select campaign_key, day, count(*) as purchases, sum(coalesce(cents,0))::bigint as revenue_cents
    from attr where campaign_key is not null group by 1, 2
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

-- 2) Send-time heatmap — unique opens by day-of-week (0=Sun) × hour, last 90d.
create or replace function public.email_sendtime_heatmap()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'opens', opens)), '[]'::jsonb)
  from (
    select extract(dow from ts)::int as dow, extract(hour from ts)::int as hour, count(distinct email) as opens
    from public.email_events
    where event = 'open' and ts >= now() - interval '90 days'
    group by 1, 2
  ) t;
$$;

-- 3) A/B subject tests — per queued blast with a B subject: sent + purchases by variant.
create or replace function public.email_ab_tests()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select eq.campaign_key, eq.subject as subject_a, eq.subject_b, eq.sent_at::date as day,
      count(*) filter (where coalesce(er.variant,'a') = 'a') as sent_a,
      count(*) filter (where er.variant = 'b') as sent_b,
      count(*) filter (where coalesce(er.variant,'a') = 'a' and exists (
        select 1 from public.songs p where lower(p.email) = lower(er.email) and p.paid and p.platform='es'
          and p.paid_at between eq.sent_at and eq.sent_at + interval '7 days')) as purch_a,
      count(*) filter (where er.variant = 'b' and exists (
        select 1 from public.songs p where lower(p.email) = lower(er.email) and p.paid and p.platform='es'
          and p.paid_at between eq.sent_at and eq.sent_at + interval '7 days')) as purch_b
    from public.email_queue eq
    join public.email_recipients er on er.email_queue_id = eq.id
    where eq.subject_b is not null and eq.status = 'sent'
    group by eq.id, eq.campaign_key, eq.subject, eq.subject_b, eq.sent_at
    order by eq.sent_at desc
  ) t;
$$;

-- 4) Dormant-buyer segment — buyers whose last purchase is older than N days
--    (win-back opportunity size). Excludes unsubscribers.
create or replace function public.email_dormant_segment(p_days int default 60)
returns jsonb language sql security definer set search_path = public as $$
  with sess as (
    select distinct on (stripe_session_id) lower(email) as email, paid_at, amount_paid
    from public.songs
    where paid and platform='es' and stripe_session_id is not null and email is not null
    order by stripe_session_id, amount_paid desc nulls last
  ),
  buyers as (select email, max(paid_at) as last_paid, sum(amount_paid) as ltv from sess group by email)
  select jsonb_build_object(
    'dormant_days', p_days,
    'dormant_buyers', count(*),
    'revenue_at_risk', round(coalesce(sum(ltv),0))
  )
  from buyers
  where last_paid < now() - make_interval(days => p_days)
    and not exists (select 1 from public.email_unsubscribes e where e.email = buyers.email);
$$;
