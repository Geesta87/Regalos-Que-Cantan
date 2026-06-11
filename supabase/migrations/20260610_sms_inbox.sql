-- ───────────────────────────────────────────────────────────────────────────
-- SMS Inbox — two-way Twilio A2P texting
--
-- Backs the admin dashboard "💬 Mensajes SMS" tab (sms-admin edge function)
-- and the inbound receiver (twilio-sms-webhook). Two tables:
--   • sms_conversations — one row per customer phone number (the "thread")
--   • sms_messages      — every individual text, inbound or outbound
--
-- Both tables have RLS ENABLED with NO policies, so neither the anon key nor a
-- logged-in user can read them from the browser — exactly like we locked down
-- direct `songs` reads. All access goes through edge functions using the
-- service-role key (which bypasses RLS). The admin/assistant gate lives in
-- sms-admin (admin_users role lookup), not in the database.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.sms_conversations (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique,                  -- E.164, e.g. +12135550142
  customer_name   text,                                  -- best-effort, from matching order
  order_id        text,                                  -- optional link to a songs row / session
  unread          integer not null default 0,            -- inbound messages not yet seen in the dashboard
  opted_out       boolean not null default false,        -- true after a STOP keyword
  opted_out_at    timestamptz,
  last_message_at timestamptz not null default now(),    -- drives the inbox sort order
  created_at      timestamptz not null default now()
);

create table if not exists public.sms_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sms_conversations(id) on delete cascade,
  direction       text not null check (direction in ('inbound', 'outbound')),
  body            text not null,
  -- queued|sent|delivered|failed for outbound; received for inbound
  status          text not null default 'received',
  twilio_sid      text,                                  -- Twilio Message SID for status reconciliation
  created_at      timestamptz not null default now()
);

-- Thread view: newest message first within a conversation.
create index if not exists idx_sms_messages_conversation
  on public.sms_messages (conversation_id, created_at);

-- Inbox list: most-recently-active conversations first.
create index if not exists idx_sms_conversations_last_message
  on public.sms_conversations (last_message_at desc);

-- Lock the tables to service-role only (RLS on, no policies).
alter table public.sms_conversations enable row level security;
alter table public.sms_messages      enable row level security;
