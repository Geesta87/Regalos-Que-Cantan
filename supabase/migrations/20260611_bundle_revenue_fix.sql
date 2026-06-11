-- Fix bundle revenue double-count in the admin lifetime stats.
--
-- A 2-pack checkout stamps the FULL bundle total (e.g. $39.99) on BOTH song
-- rows. The previous get_admin_song_stats() summed amount_paid per row, so
-- every bundle was counted twice (~$28k lifetime over-count as of 2026-06-11).
--
-- Fix: count revenue ONCE per checkout (Stripe session) using the max price in
-- the session (within a session all non-null amounts are identical; null-amount
-- legacy rows fall back to the single price). Rows with no session id are
-- counted individually. Counts (totalSongs, paidOrders) still reflect songs;
-- only money is de-duplicated. Display-only — no payment data is modified.

create or replace function public.get_admin_song_stats(redact_revenue boolean default false)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with base as (
    select
      id,
      stripe_session_id,
      (
        paid = true
        or payment_status in ('paid','completed','succeeded')
        or stripe_payment_id is not null
        or paid_at is not null
        or (amount_paid is not null and amount_paid > 0)
      ) as is_paid_calc,
      case
        when redact_revenue then
          case when coupon_code = 'GRATIS100' then 0 else 29.99 end
        else
          case
            when amount_paid is not null then amount_paid
            when coupon_code = 'GRATIS100' then 0
            else 29.99
          end
      end as price,
      whatsapp_phone
    from songs
  ),
  paid_base as (
    select * from base where is_paid_calc
  ),
  -- One amount per checkout: group paid rows by session (null session => the
  -- row stands alone) and take the session's single total.
  per_purchase as (
    select coalesce(stripe_session_id, 'solo:' || id::text) as pkey,
           max(price) as purchase_price
    from paid_base
    group by coalesce(stripe_session_id, 'solo:' || id::text)
  )
  select json_build_object(
    'totalSongs', (select count(*) from base),
    'paidOrders', (select count(*) from paid_base),
    'pendingOrders', (select count(*) from base) - (select count(*) from paid_base),
    'totalRevenue', coalesce((select sum(purchase_price) from per_purchase), 0),
    'freeOrders', (select count(*) from per_purchase where purchase_price = 0),
    'whatsappContacts', (select count(distinct whatsapp_phone) from base where whatsapp_phone is not null)
  );
$function$;
