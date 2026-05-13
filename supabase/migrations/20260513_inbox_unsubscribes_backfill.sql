-- 20260513_inbox_unsubscribes_backfill.sql
-- One-shot backfill of customers who replied to the legacy List-Unsubscribe
-- mailto:hola@regalosquecantan.com?subject=unsubscribe between roughly
-- 2026-03-25 and 2026-05-13 — i.e. before the unsubscribe automation
-- (migration 20260513_email_unsubscribes.sql + functions/unsubscribe) was
-- deployed. Each "unsubscribe"-subject email arriving in the hola@ inbox
-- never got recorded; this catches up that backlog so the suppression list
-- has them from day one.
--
-- Source: hola@regalosquecantan.com inbox search for subject "unsubscribe",
-- captured 2026-05-13 by the owner. Timestamps are approximated to the date
-- shown in the inbox (UTC midday) — exact send time isn't recoverable from
-- the inbox UI but the calendar day is what matters for audit logs.
--
-- Idempotency: ON CONFLICT DO NOTHING means re-running this migration is a
-- safe no-op. The PRIMARY KEY is `email`, so once a customer is recorded
-- their original unsubscribe stays the authoritative timestamp even if
-- they receive (and re-decline) a future email.
--
-- Source-tag = 'inbox-backfill' so future audits can see which entries
-- came from this one-time import vs the live automation.

INSERT INTO email_unsubscribes (email, source, unsubscribed_at, reason)
VALUES
  ('salazarcoating@gmail.com',     'inbox-backfill', '2026-05-13 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('franjagovi@icloud.com',        'inbox-backfill', '2026-05-13 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('max.diaz@ymail.com',           'inbox-backfill', '2026-05-12 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('richie197283@gmail.com',       'inbox-backfill', '2026-05-12 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('djcruwel@yahoo.com',           'inbox-backfill', '2026-05-10 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('smasaya35@gmail.com',          'inbox-backfill', '2026-05-09 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('glicona81@gmail.com',          'inbox-backfill', '2026-05-09 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('mateommp1@gmail.com',          'inbox-backfill', '2026-05-06 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('josecartagena503@icloud.com',  'inbox-backfill', '2026-04-29 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('carlos.rentru@icloud.com',     'inbox-backfill', '2026-04-22 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('marcelo408@icloud.com',        'inbox-backfill', '2026-04-20 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('sinaihannia@gmail.com',        'inbox-backfill', '2026-04-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('ryanponce57@icloud.com',       'inbox-backfill', '2026-03-30 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('braulio_fp@yahoo.com',         'inbox-backfill', '2026-03-25 12:00:00+00', 'mailto unsubscribe pre-automation backfill')
ON CONFLICT (email) DO NOTHING;
