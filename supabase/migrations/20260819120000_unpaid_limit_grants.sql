-- Per-customer "allow a few more songs" grants, consulted by generate-song.
--
-- The unpaid-song anti-abuse caps (10/email, 8/IP, 12/pair per 24h) sometimes
-- catch a legit customer who is still deciding (e.g. trying takes for a gift).
-- Before this table the only relief was the all-or-nothing ADMIN_OVERRIDE_PIN,
-- which can't be handed to a customer. A row here raises ALL THREE soft caps
-- by `extra_songs` for requests carrying this email, until `expires_at`.
--
-- Grants do NOT override the hard blocklists (blocked_ips / blocked_emails)
-- or the Cuba country gate — those are for confirmed fraud and stay absolute.
--
-- Rows are written by the admin-songs edge function (action
-- 'grant-extra-songs', admin role only) and read by generate-song with the
-- service-role key. RLS is enabled with no policies so the anon key can never
-- read customer emails out of it.

CREATE TABLE IF NOT EXISTS unpaid_limit_grants (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL,             -- lowercased buyer email
  extra_songs  INT         NOT NULL DEFAULT 6,   -- extra song ROWS (1 creation = 2 rows)
  expires_at   TIMESTAMPTZ NOT NULL,
  reason       TEXT,
  granted_by   TEXT,                             -- admin email that clicked the button
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS unpaid_limit_grants_email_active_idx
  ON unpaid_limit_grants (email, expires_at DESC);

ALTER TABLE unpaid_limit_grants ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE unpaid_limit_grants IS
  'Admin-issued temporary raises of the unpaid-song rate caps for one customer email. generate-song adds extra_songs to each soft cap while an unexpired row exists for the request email. Does not bypass blocked_ips/blocked_emails.';
