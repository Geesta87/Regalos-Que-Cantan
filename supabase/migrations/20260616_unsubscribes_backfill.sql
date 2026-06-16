-- 20260616_unsubscribes_backfill.sql
-- One-shot backfill of everyone who asked to unsubscribe BEFORE the automated
-- unsubscribe flow (functions/unsubscribe + email_unsubscribes) went live.
--
-- Sources merged here:
--   * 'inbox-backfill'    — "unsubscribe"-subject emails sitting unprocessed in
--                           the hola@regalosquecantan.com inbox. Captured from
--                           owner screenshots (2026-05-13 + 2026-06-16 snapshots).
--                           Dates approximated to the calendar day shown in the
--                           inbox UI (UTC midday); the day is what matters for
--                           audit logs. Undated newest entries are stamped
--                           2026-06-15 (just before the 2026-06-16 snapshot).
--   * 'db-newsletter-flag'— rows previously flagged via songs.newsletter_unsubscribed
--                           by the legacy newsletter-unsubscribe function.
--
-- NOTE: one inbox entry showed only the name "susy gallegos" with no visible
-- email address and is intentionally omitted — it must be added manually once
-- the address is recovered.
--
-- Idempotency: ON CONFLICT DO NOTHING — re-running is a safe no-op, and the
-- PRIMARY KEY (email) keeps the earliest recorded timestamp authoritative.

INSERT INTO email_unsubscribes (email, source, unsubscribed_at, reason) VALUES
  -- newest inbox entries (undated in snapshot; stamped just before 2026-06-16 capture)
  ('keisyzelaya1986@gmail.com',    'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('lyazmin@icloud.com',           'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('solisj4@gmail.com',            'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('kassandra_s98@icloud.com',     'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('esandoval017@gmail.com',       'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('periveca@gmail.com',           'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('normatortuga@yahoo.com',       'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('salazryulissa@gmail.com',      'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('jaimemolina152.jm@gmail.com',  'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('douglass2021@icloud.com',      'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('vianney2093@icloud.com',       'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('darlyndeltoro15@gmail.com',    'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('blanca.soriano1976@gmail.com', 'inbox-backfill', '2026-06-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  -- dated inbox entries
  ('carmelasotelo22@gmail.com',    'inbox-backfill', '2026-06-02 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('rsilvajr4524@gmail.com',       'inbox-backfill', '2026-06-01 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('josecancino665@gmail.com',     'inbox-backfill', '2026-05-30 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('melvinacabal1983@icloud.com',  'inbox-backfill', '2026-05-29 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('tuliomt0980@gmail.com',        'inbox-backfill', '2026-05-29 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('cynthia.gauna@icloud.com',     'inbox-backfill', '2026-05-27 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('chocsoila267@icloud.com',      'inbox-backfill', '2026-05-27 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('waldy76@icloud.com',           'inbox-backfill', '2026-05-20 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('gomezsergio2271@gmail.com',    'inbox-backfill', '2026-05-19 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('kenia865@gmail.com',           'inbox-backfill', '2026-05-16 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('alexisfernandez461@gmail.com', 'inbox-backfill', '2026-05-14 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('toverasil@gmail.com',          'inbox-backfill', '2026-05-14 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('salazarcoating@gmail.com',     'inbox-backfill', '2026-05-13 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('franjagovi@icloud.com',        'inbox-backfill', '2026-05-13 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('max.diaz@ymail.com',           'inbox-backfill', '2026-05-12 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('richie197283@gmail.com',       'inbox-backfill', '2026-05-12 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('djcruwel@yahoo.com',           'inbox-backfill', '2026-05-10 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('smasaya35@gmail.com',          'inbox-backfill', '2026-05-09 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('glicona81@gmail.com',          'inbox-backfill', '2026-05-09 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('mateommp1@gmail.com',          'inbox-backfill', '2026-05-06 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('diana.gonzalez@nobletx.com',   'db-newsletter-flag', '2026-05-05 16:02:29+00', 'legacy songs.newsletter_unsubscribed flag'),
  ('josecartagena503@icloud.com',  'inbox-backfill', '2026-04-29 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('carlos.rentru@icloud.com',     'inbox-backfill', '2026-04-22 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('imslewis@gmail.com',           'db-newsletter-flag', '2026-04-21 05:32:57+00', 'legacy songs.newsletter_unsubscribed flag'),
  ('marcelo408@icloud.com',        'inbox-backfill', '2026-04-20 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('sinaihannia@gmail.com',        'inbox-backfill', '2026-04-15 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('ryanponce57@icloud.com',       'inbox-backfill', '2026-03-30 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('braulio_fp@yahoo.com',         'inbox-backfill', '2026-03-25 12:00:00+00', 'mailto unsubscribe pre-automation backfill'),
  ('torrotorro.180375@gmail.com',  'db-newsletter-flag', '2026-06-13 13:51:23+00', 'legacy songs.newsletter_unsubscribed flag')
ON CONFLICT (email) DO NOTHING;
