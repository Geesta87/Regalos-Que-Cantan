-- ───────────────────────────────────────────────────────────────────────────
-- Customer-Service AI Agent — Phase 1 (draft-and-approve)
--
-- Adds the pieces the CS bot needs WITHOUT giving it any way to write, change,
-- or delete anything:
--   1. a `channel` column on the SMS inbox tables ('sms' | 'whatsapp') so one
--      inbox can hold both channels with a sub-tab per channel
--   2. draft-message metadata on sms_messages (ai_generated, needs_human) so the
--      dashboard can surface AI drafts that are waiting for the owner's approval
--   3. cs_customer_lookup — a READ-ONLY view exposing ONLY safe columns. This is
--      the ONLY thing the bot's lookup tool reads. It cannot see emails, payment
--      amounts, Stripe ids, lyrics, coupons, or any other table. It computes
--      is_paid as a boolean so the raw amount is never exposed.
--   4. cs_agent_settings — a single-row master switch. `enabled` defaults FALSE
--      (nothing auto-drafts until the owner turns it on); `draft_only` defaults
--      TRUE (every reply must be human-approved — the Phase 1 guarantee).
--
-- SECURITY NOTES
--   • The bot has NO write/delete tool anywhere — see cs-agent/index.ts. The
--     only database access it has is SELECT on cs_customer_lookup, filtered to
--     the phone number of the conversation it is replying to (pinned in code,
--     never taken from the AI). A customer can therefore only ever retrieve
--     their OWN order, and only the safe fields below.
--   • A Postgres view runs with its OWNER's privileges by default, which would
--     bypass RLS on the underlying songs table. So we REVOKE all access to the
--     view from anon + authenticated — only the service-role (edge functions)
--     may read it, exactly like the songs table itself.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Channel on the two inbox tables ---------------------------------------
alter table public.sms_conversations
  add column if not exists channel text not null default 'sms';

alter table public.sms_messages
  add column if not exists channel text not null default 'sms';

-- Backfill is unnecessary — every existing row is SMS and the default handles it.
-- Constrain to the two supported channels (guard against typos in code).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sms_conversations_channel_chk'
  ) then
    alter table public.sms_conversations
      add constraint sms_conversations_channel_chk check (channel in ('sms', 'whatsapp'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'sms_messages_channel_chk'
  ) then
    alter table public.sms_messages
      add constraint sms_messages_channel_chk check (channel in ('sms', 'whatsapp'));
  end if;
end $$;

-- 2. Draft metadata on messages --------------------------------------------
-- status already accepts free text; AI drafts use status='draft' and, once the
-- owner approves, flip to the normal outbound status ('sent'/'queued'/'failed').
-- Discarded drafts use status='discarded'.
alter table public.sms_messages
  add column if not exists ai_generated boolean not null default false,
  add column if not exists needs_human  boolean not null default false;

-- 3. The read-only lookup window the bot can see ----------------------------
create or replace view public.cs_customer_lookup as
select
  s.id,
  -- last-10 digits of the order's phone, for matching to a conversation's phone.
  right(regexp_replace(coalesce(s.whatsapp_phone, ''), '[^0-9]', '', 'g'), 10) as phone_last10,
  s.recipient_name,
  s.sender_name,
  s.occasion,
  coalesce(s.genre_name, s.genre) as genre,
  s.short_code,
  s.status                          as song_status,
  (s.audio_url is not null and s.audio_url <> '') as song_ready,
  s.has_video_addon,
  s.karaoke_video_status,
  s.karaoke_status,
  s.created_at,
  s.paid_at,
  -- Computed paid flag — mirrors isStripeConfirmed() in the edge functions.
  -- Exposing the boolean (not the amount) keeps revenue figures out of the bot.
  (
    s.paid_at is not null
    and (s.paid = true or s.payment_status = 'paid')
    and (coalesce(s.amount_paid, 0) > 0 or s.stripe_payment_id is not null)
  ) as is_paid
from public.songs s;

-- Only edge functions (service_role) may read this. Never the browser.
revoke all on public.cs_customer_lookup from anon, authenticated;

-- 4. Master switch (single row) --------------------------------------------
create table if not exists public.cs_agent_settings (
  id          smallint primary key default 1,
  enabled     boolean not null default false,  -- master on/off for the whole bot
  draft_only  boolean not null default true,   -- true = every reply needs approval (Phase 1)
  updated_at  timestamptz not null default now(),
  constraint cs_agent_settings_singleton check (id = 1)
);

insert into public.cs_agent_settings (id, enabled, draft_only)
  values (1, false, true)
  on conflict (id) do nothing;

alter table public.cs_agent_settings enable row level security;
-- RLS on with no policies → service-role only, same as the inbox tables.
