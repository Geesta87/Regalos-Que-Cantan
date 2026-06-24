-- One-tap post-purchase secondary upsell (Animado / instrumental / gift).
--
-- The song checkout (create-checkout) now saves the card off-session, and
-- stripe-webhook stores the Stripe customer + payment method on the song so the
-- post-purchase upsell can charge it with a single tap — no second checkout.
--
-- The $9.99 photo-video upsell is intentionally untouched and keeps its own flow.

-- 1) Where the saved card lives, captured by stripe-webhook on the song payment.
--    stripe_card_last4 is shown in the one-tap UI ("se cobra a tu tarjeta ···· 4242").
alter table public.songs
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_card_last4 text;

-- 2) Every one-tap charge, for tracking + idempotency + refund mapping.
create table if not exists public.upsell_charges (
  id uuid primary key default gen_random_uuid(),
  song_id uuid references public.songs(id) on delete set null,
  item text not null,                         -- 'animado' | 'instrumental' | 'gift'
  amount_cents integer not null,
  stripe_payment_intent_id text,
  -- 'paid' | 'failed' | 'needs_action'
  status text not null default 'pending',
  buyer_email text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotency / anti-double-charge: at most ONE non-failed charge per (song,
-- item). charge-upsell inserts a 'pending' row BEFORE calling Stripe, so a
-- double-tap or retry race hits this unique index and is rejected before a
-- second PaymentIntent is ever created. A hard 'failed' row is excluded, so a
-- genuine retry after failure is still allowed.
create unique index if not exists upsell_charges_one_active_per_item
  on public.upsell_charges (song_id, item)
  where status <> 'failed';

-- Refund mapping + retrieval by PaymentIntent.
create index if not exists upsell_charges_payment_intent
  on public.upsell_charges (stripe_payment_intent_id);
