-- CS inbox: cached English translation of each message (reading aid for a
-- non-Spanish-speaking assistant).
--
-- Customers are always messaged in Spanish; nothing about the outbound content
-- changes. This column just stores an English gloss of a message's `body` so the
-- admin inbox can show it under the Spanish. It's filled once (lazily by
-- sms-admin on load, and up front by cs-agent for its drafts) and then cached —
-- so each message is only ever translated a single time.
--
-- NULL = not translated yet (or a media-only message with no text to translate).

alter table public.sms_messages
  add column if not exists body_en text;
