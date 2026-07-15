-- Traffic-source scoreboard for the admin dashboard.
--
-- Aggregates visits (funnel_events) and purchases+revenue (songs) per marketing
-- source, IN SQL so we never pull the ~42k-row songs table to the browser (see
-- the songs-table-scale rule). Two design points:
--
--   1. Source NORMALIZATION. Real utm_source data is messy — affiliates and ad
--      links have produced values like 'tikt', 'tiktok clave para el descuento
--      👇 roly 10', 'fb-websitekeyinfo', 'meta'. normalize_traffic_source()
--      collapses these into canonical buckets (tiktok / facebook / instagram /
--      google / email / organic) so the scoreboard is signal, not noise.
--
--   2. Purchase DEDUP. A 2-pack stamps the full order total on BOTH song rows
--      (bundle-amount model), so revenue is summed per stripe_session_id using
--      MAX(amount_paid), then rolled up by source. Live funnel only: platform='es'.

create or replace function public.normalize_traffic_source(raw text)
returns text
language sql
immutable
as $$
  select case
    when s like 'tiktok%' or s like 'tikt%' or s = 'tt'                 then 'tiktok'
    when s in ('fb','facebook','meta') or s like 'fb-%'
      or s like 'facebook%'                                            then 'facebook'
    when s in ('ig','instagram') or s like 'instagram%'                then 'instagram'
    when s like 'google%'                                             then 'google'
    when s = 'email'                                                  then 'email'
    when s is null or s = '' or s = 'organic'                         then 'organic'
    else s
  end
  from (select lower(trim(raw)) as s) t;
$$;

create or replace function public.get_source_scoreboard(days integer default 30)
returns table(source text, visits bigint, purchases bigint, revenue numeric)
language sql
stable
as $$
  with visits as (
    select public.normalize_traffic_source(s) as source, count(*) as visits
    from (
      -- one canonical source per browsing session
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
      -- dedup: one amount per checkout session (MAX handles the 2-pack double-stamp)
      select utm_source as s, max(amount_paid) as sess_amount
      from songs
      where paid = true
        and platform = 'es'
        and stripe_session_id is not null
        and paid_at >= now() - make_interval(days => days)
      group by stripe_session_id, utm_source
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
$$;
