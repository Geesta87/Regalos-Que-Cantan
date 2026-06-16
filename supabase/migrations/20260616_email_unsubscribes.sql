-- 20260616_email_unsubscribes.sql
-- Email-suppression table for marketing/drip emails.
--
-- Background: every customer email today includes a List-Unsubscribe header
-- pointing at mailto:hola@regalosquecantan.com?subject=unsubscribe. When a
-- recipient clicks "Unsubscribe" in Gmail/Yahoo, the resulting email lands
-- in a human inbox and nothing automated processes it — the recipient keeps
-- getting marketing emails. That's a CAN-SPAM / CASL / GDPR exposure plus a
-- deliverability liability (repeated complaints against hola@ tank sender
-- reputation for ALL flows, including the order confirmations).
--
-- This table is the source of truth for "do not email this address for
-- marketing purposes". The unsubscribe edge function inserts here when
-- triggered by one-click (RFC 8058 POST), GET link, admin action, or
-- SendGrid bounce/complaint webhook. Marketing emails (newsletters,
-- campaigns, promo/upsell) MUST query this before sending. Transactional
-- emails (purchase confirmation, song/video delivery, self-service recovery,
-- affiliate welcome credentials) are NOT gated on this table — opt-out
-- customers still receive the product they paid for.
--
-- Email canonicalization: rows are stored lowercased. The check constraint
-- enforces this so callers can't accidentally insert mixed-case duplicates.

CREATE TABLE IF NOT EXISTS email_unsubscribes (
  email             TEXT        PRIMARY KEY CHECK (email = lower(email)),
  unsubscribed_at   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  source            TEXT        NOT NULL,
  reason            TEXT,
  ip                TEXT,
  user_agent        TEXT
);

CREATE INDEX IF NOT EXISTS email_unsubscribes_unsubscribed_at_idx
  ON email_unsubscribes (unsubscribed_at DESC);

COMMENT ON TABLE email_unsubscribes IS
  'Email-suppression list for marketing/drip emails. Marketing senders must check this before sending; transactional senders (purchase confirmation, song/video delivery) do not.';

COMMENT ON COLUMN email_unsubscribes.source IS
  'How the unsubscribe was recorded: one-click | web | admin | inbox-backfill | sendgrid-bounce | sendgrid-spamreport | sendgrid-dropped | manual.';

-- RLS — locked down. Only service-role (edge functions) reads/writes.
ALTER TABLE email_unsubscribes ENABLE ROW LEVEL SECURITY;
-- No policies = anon/authenticated keys cannot touch this table.
