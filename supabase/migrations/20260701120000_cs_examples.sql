-- ───────────────────────────────────────────────────────────────────────────
-- CS agent learning loop — cs_examples
--
-- Every reply the owner APPROVES or SENDS becomes a "good answer" example. The
-- cs-agent injects the most recent examples into each new draft so it learns the
-- owner's voice/tone and repeats corrections. Edited approvals (was_edited=true)
-- are stronger signals — the AI got it wrong and the owner fixed it.
--
-- PRIVACY: links / emails / phones are stripped before storing (see
-- _shared/cs-redact.ts). Examples are used for TONE/STYLE only; real order data
-- always comes from the look_up_my_order tool, never from an example.
--
-- RLS on, no policies → service-role (edge functions) only, like the inbox tables.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.cs_examples (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  channel      text,                                 -- 'sms' | 'whatsapp'
  customer_msg text,                                 -- the inbound it replied to (redacted)
  reply        text not null,                        -- the owner-approved reply (redacted)
  was_edited   boolean not null default false,       -- owner edited the AI draft (a correction)
  source       text not null default 'approve'       -- 'approve' | 'manual'
);

create index if not exists idx_cs_examples_created on public.cs_examples (created_at desc);

alter table public.cs_examples enable row level security;
