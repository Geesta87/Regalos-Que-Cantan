-- Scheduled gift-SMS upsell ($5): "send this song as a surprise text to a loved
-- one at a day/time I choose." One row per gift. Created (unpaid) by
-- create-gift-checkout AFTER it passes a Claude moderation pass; flipped to
-- 'scheduled' by stripe-webhook on payment; sent/handed-to-Twilio by the
-- every-minute send-scheduled-gift-sms cron.
--
-- COMPLIANCE: recipient_phone is a THIRD-PARTY number the buyer typed in. It is
-- transactional-only (one gift text) and must NEVER enter any A2P marketing
-- audience. marketing_excluded defaults true to document/enforce that intent.

create table if not exists public.scheduled_gift_messages (
  id                 uuid primary key default gen_random_uuid(),
  -- the paid song being gifted (link/short_code resolved at send time)
  song_id            uuid references public.songs(id),
  buyer_email        text,
  -- shown to the recipient — REQUIRED (the gift is never anonymous)
  buyer_name         text not null,
  recipient_name     text,
  -- E.164, transactional-only (see header)
  recipient_phone    text not null,
  personal_message   text,
  -- absolute send instant in UTC, derived from the buyer's local pick + tz
  send_at            timestamptz not null,
  buyer_timezone     text,
  -- awaiting_payment -> scheduled -> (processing) -> sent | failed | canceled
  --                                              \-> handed to Twilio (status stays
  --                                                  'scheduled' + twilio_scheduled=true)
  status             text not null default 'awaiting_payment',
  moderation_status  text not null default 'pending',   -- pending | approved | rejected
  moderation_reason  text,
  stripe_session_id  text,
  amount_cents       integer not null default 500,
  twilio_sid         text,
  -- true once handed to Twilio native scheduled-send (exact-second delivery);
  -- the cron then ignores the row so it can't double-send.
  twilio_scheduled   boolean not null default false,
  -- documents the "never into marketing" rule for this number
  marketing_excluded boolean not null default true,
  -- buyer ticked "this is a gift for someone who would welcome it"
  attestation_accepted boolean not null default false,
  sent_at            timestamptz,
  error_message      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Cron hot path: find paid, not-yet-handed gifts due within Twilio's window.
create index if not exists idx_sgm_status_send_at
  on public.scheduled_gift_messages (status, send_at);

-- Webhook idempotency / lookup by checkout session.
create index if not exists idx_sgm_stripe_session
  on public.scheduled_gift_messages (stripe_session_id);

-- Only the service role (edge functions) ever touches this table. RLS on with
-- no anon policies = the public anon key cannot read recipient phone numbers.
alter table public.scheduled_gift_messages enable row level security;
