-- Banner QR performance: daily visits / orders / revenue per printed outdoor
-- banner. Banner QRs tag traffic with utm_campaign 'b-*' (utm_source=banner);
-- nothing else uses the b- prefix (Meta campaigns store numeric ids in the
-- same column). Days are Pacific — the owner reads these against a US calendar.
create or replace function banner_qr_performance(days int default 30)
returns table (code text, day date, visits bigint, orders bigint, revenue numeric)
language sql stable security definer set search_path = public as $$
  with bounds as (
    select ((now() at time zone 'America/Los_Angeles')::date - (days - 1)) as from_day
  ),
  -- one row per Stripe session: a 2-pack stamps the FULL total on BOTH song
  -- rows, so summing raw rows double-counts revenue
  paid as (
    select distinct on (s.stripe_session_id)
           s.utm_campaign as code,
           s.amount_paid,
           (s.paid_at at time zone 'America/Los_Angeles')::date as day
    from songs s, bounds b
    where s.paid = true
      and s.platform = 'es'
      and s.utm_campaign like 'b-%'
      and s.stripe_session_id is not null
      and (s.paid_at at time zone 'America/Los_Angeles')::date >= b.from_day
    order by s.stripe_session_id, s.amount_paid desc
  ),
  o as (
    select p.code, p.day, count(*)::bigint as orders, sum(p.amount_paid) as revenue
    from paid p
    group by 1, 2
  ),
  v as (
    select f.utm_campaign as code,
           (f.created_at at time zone 'America/Los_Angeles')::date as day,
           count(distinct f.session_id)::bigint as visits
    from funnel_events f, bounds b
    where f.utm_campaign like 'b-%'
      and (f.created_at at time zone 'America/Los_Angeles')::date >= b.from_day
    group by 1, 2
  )
  -- full outer join: a banner with scans and no orders yet is exactly the
  -- signal to surface; an inner join would hide it
  select coalesce(o.code, v.code) as code,
         coalesce(o.day, v.day) as day,
         coalesce(v.visits, 0) as visits,
         coalesce(o.orders, 0) as orders,
         coalesce(o.revenue, 0) as revenue
  from o full outer join v on o.code = v.code and o.day = v.day
  order by 2 desc, 5 desc;
$$;

revoke all on function banner_qr_performance(int) from public, anon;
grant execute on function banner_qr_performance(int) to authenticated, service_role;
