-- FIX: normalize_traffic_source() mapped NULL/'' -> 'organic', so every order we
-- simply had no source for was REPORTED as organic. Measured at the time of this
-- change: 880 purchases / $29,095.75 in 30 days (60.7% of $47,955.67 total revenue) were being
-- credited to "organic" when the true answer was "we don't know".
-- NULL now means 'unknown'. Genuine organic is identified by the referrer
-- captured at landing ('google-organic' etc.), never by absence of data.
--
-- Also keeps referrer-derived channels distinct instead of collapsing them into
-- the paid buckets -- 'google-organic' must never merge into paid 'google'.
create or replace function public.normalize_traffic_source(raw text)
 returns text
 language sql
 immutable
as $function$
  select case
    -- Referrer-derived channels (captured at landing): keep as-is, and match
    -- these FIRST so 'google-organic' never falls through to paid 'google'.
    when s like '%-organic'                                          then s
    when s like '%-referral'                                         then s
    when s like 'referral:%'                                         then s
    -- Paid / tagged campaign sources.
    when s like 'tiktok%' or s like 'tikt%' or s = 'tt'              then 'tiktok'
    when s in ('fb','facebook','meta') or s like 'fb-%'
      or s like 'facebook%'                                          then 'facebook'
    when s in ('ig','instagram') or s like 'instagram%'              then 'instagram'
    when s like 'google%'                                            then 'google'
    when s = 'email'                                                 then 'email'
    when s = 'direct'                                                then 'direct'
    -- An explicit legacy 'organic' tag stays organic.
    when s = 'organic'                                               then 'organic'
    -- No data at all. Previously (wrongly) reported as 'organic'.
    when s is null or s = ''                                         then 'unknown'
    else s
  end
  from (select lower(trim(raw)) as s) t;
$function$;

-- Teach the scoreboard to use the referrer fallback for PURCHASES, so real
-- organic revenue shows up instead of vanishing into 'unknown'.
-- NOTE: `visits` still comes from funnel_events, which only stores utm_source,
-- so a referrer-attributed source can show purchases with 0 visits until the
-- referrer is also recorded on funnel events. Revenue is the trustworthy column.
create or replace function public.get_source_scoreboard(days integer DEFAULT 30)
 returns TABLE(source text, visits bigint, purchases bigint, revenue numeric)
 language sql
 stable
as $function$
  with visits as (
    select public.normalize_traffic_source(s) as source, count(*) as visits
    from (
      select max(utm_source) as s
      from funnel_events
      where created_at >= now() - make_interval(days => days)
      group by session_id
    ) fe
    group by 1
  ),
  purch as (
    select public.normalize_traffic_source(s) as source,
           count(*) as purchases,
           sum(sess_amount) as revenue
    from (
      select coalesce(utm_source, referrer_source) as s, max(amount_paid) as sess_amount
      from songs
      where paid = true
        and platform = 'es'
        and stripe_session_id is not null
        and paid_at >= now() - make_interval(days => days)
      group by stripe_session_id, coalesce(utm_source, referrer_source)
    ) sp
    group by 1
  )
  select
    coalesce(v.source, p.source)  as source,
    coalesce(v.visits, 0)         as visits,
    coalesce(p.purchases, 0)      as purchases,
    round(coalesce(p.revenue, 0)::numeric, 2) as revenue
  from visits v
  full outer join purch p on v.source = p.source
  order by revenue desc, visits desc;
$function$;
