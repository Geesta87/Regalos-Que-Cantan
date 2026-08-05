-- cs_customer_lookup: treat a MANUAL (Zelle/cash) paid mark as paid.
--
-- BUG: every Zelle customer looked UNPAID to the customer-service agent.
--
-- admin-songs' mark-paid deliberately leaves `amount_paid` NULL, so manual
-- payments don't inflate revenue reports, and there is obviously no
-- stripe_payment_id. But is_paid required one of exactly those two:
--
--     paid_at is not null
--     and (paid = true or payment_status = 'paid')
--     and (amount_paid > 0 or stripe_payment_id is not null)   <-- always false
--
-- So all 8 manually-marked songs evaluated to is_paid = false. The bot would
-- have told a customer who paid by Zelle that they hadn't paid, refused their
-- download link, and pushed them to buy again.
--
-- `marked_paid_at` is set only by admin-songs' mark-paid action, which requires
-- an authenticated admin — a human explicitly asserting payment. That is at
-- least as strong as an amount, so it belongs in the same clause. The clause
-- still rejects the case it was written for: a row with paid=true but no
-- evidence of money and no human sign-off.

create or replace view public.cs_customer_lookup as
select
  id,
  right(regexp_replace(coalesce(whatsapp_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) as phone_last10,
  recipient_name,
  sender_name,
  occasion,
  coalesce(genre_name, genre) as genre,
  short_code,
  status as song_status,
  audio_url is not null and audio_url <> ''::text as song_ready,
  has_video_addon,
  karaoke_video_status,
  karaoke_status,
  created_at,
  paid_at,
  paid_at is not null
    and (paid = true or payment_status = 'paid'::text)
    and (
      coalesce(amount_paid, 0::numeric) > 0::numeric
      or stripe_payment_id is not null
      -- Manual Zelle/cash mark by an admin (admin-songs 'mark-paid').
      or marked_paid_at is not null
    ) as is_paid,
  lower(trim(email)) as email,
  lower(split_part(trim(email), '@', 1)) as email_local,
  lower(trim(recipient_name)) as recipient_name_lc
from songs s;

comment on view public.cs_customer_lookup is
  'Safe, read-only customer-facing projection of songs for the CS agent. Exposes ONLY fields a customer may see about their own order. is_paid counts Stripe payments AND manual Zelle/cash marks (marked_paid_at). Resolvable by phone_last10, email, email_local (typo-tolerant) or recipient_name_lc — see _shared/cs-customer-resolve.ts, the single resolver both the situation snapshot and the look_up_my_order tool go through.';
