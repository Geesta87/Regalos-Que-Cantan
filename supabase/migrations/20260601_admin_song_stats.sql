-- Lifetime dashboard stats computed in Postgres so admin-songs never has to
-- pull the whole songs table (40k+ rows) into the edge function — that blew
-- past the 256 MB worker limit and returned HTTP 546, breaking the admin
-- dashboard (2026-06-01). Logic mirrors AdminDashboard.jsx isPaid()/
-- getSongPrice() exactly. `redact_revenue` reproduces the assistant (Ivan)
-- role: amount_paid is hidden, so revenue is computed on a flat 29.99 /
-- GRATIS100=0 estimate basis — never the real per-order amounts. The true
-- revenue total only reaches the admin role.
create or replace function public.get_admin_song_stats(redact_revenue boolean default false)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
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
  )
  select json_build_object(
    'totalSongs', count(*),
    'paidOrders', count(*) filter (where is_paid_calc),
    'pendingOrders', count(*) - count(*) filter (where is_paid_calc),
    'totalRevenue', coalesce(sum(price) filter (where is_paid_calc), 0),
    'freeOrders', count(*) filter (where is_paid_calc and price = 0),
    'whatsappContacts', count(distinct whatsapp_phone) filter (where whatsapp_phone is not null)
  )
  from base;
$$;

grant execute on function public.get_admin_song_stats(boolean) to service_role;
