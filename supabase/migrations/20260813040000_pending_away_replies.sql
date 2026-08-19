-- "Pending" inbox tab — who messaged while we were away and still needs a human.
--
-- While out-of-office is on the line goes quiet: the customer gets the away
-- auto-reply and nothing else (no AI bot, no drafts). That's correct, but it
-- leaves no worklist — Ivan opens the inbox in the morning and has to guess
-- which threads went unanswered overnight.
--
-- So stamp the conversation the moment an inbound lands while the toggle is on,
-- and clear the stamp when a HUMAN sends a reply. The Pending tab is then just
-- "awaiting_reply_since is not null", and the age of the stamp says how long
-- that customer has been waiting.
--
-- Set by _shared/out-of-office.ts (first away message only — the write is
-- guarded on `is null` so the timestamp keeps the ORIGINAL wait start).
-- Cleared by sms-admin actions 'send' and 'approve-draft'.

ALTER TABLE sms_conversations
  ADD COLUMN IF NOT EXISTS awaiting_reply_since timestamptz;

-- The Pending tab reads only the stamped rows, which are a small minority of a
-- large table. Partial index keeps that lookup cheap as the table grows.
CREATE INDEX IF NOT EXISTS sms_conversations_awaiting_reply_idx
  ON sms_conversations (awaiting_reply_since)
  WHERE awaiting_reply_since IS NOT NULL;
