-- 20260513_affiliate_schema.sql
-- Captures the affiliate program schema that has been live in production
-- since early 2026 but was never tracked in version control. Everything is
-- IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is safe to run against the
-- existing production database — it will no-op for objects that already
-- exist and only add the new payout_method / payout_handle columns plus the
-- recorded_by column on payouts.
--
-- Tables:
--   affiliates         — one row per partner (login, code, coupon, %, status)
--   affiliate_events   — visit / checkout / purchase / refund per affiliate
--   affiliate_payouts  — record of money sent to each affiliate
--
-- RLS is ENABLED on all three tables with NO policies. All access goes
-- through service-role edge functions (admin-affiliates, affiliate-data,
-- admin-record-payout, affiliate-update-payout, create-affiliate). This is
-- intentional — the anon key in the browser bundle must never see these.

-- ─── AFFILIATES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  code            TEXT NOT NULL UNIQUE,            -- the ?ref=<code> token, lowercase
  password_hash   TEXT NOT NULL,                   -- SHA-256(pepper + password)
  coupon_code     TEXT,                            -- optional matching coupon (uppercase)
  commission_pct  NUMERIC NOT NULL DEFAULT 20,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  onboarded       BOOLEAN NOT NULL DEFAULT FALSE,
  instagram       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payout info captured during onboarding so we know where to send money.
-- payout_method  e.g. 'zelle' | 'venmo' | 'paypal' | 'bank'
-- payout_handle  the email / phone / @handle / account info per method
-- payout_notes   free-form extra detail (e.g. bank name + routing/SWIFT)
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS payout_method TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS payout_handle TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS payout_notes TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS payout_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS affiliates_code_idx ON affiliates(code);
CREATE INDEX IF NOT EXISTS affiliates_email_idx ON affiliates(email);
CREATE INDEX IF NOT EXISTS affiliates_active_idx ON affiliates(active) WHERE active = TRUE;

ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;

-- ─── AFFILIATE_EVENTS ───────────────────────────────────────────────────────
-- One row per tracked action. event_type values used by the app:
--   'visit'    — ?ref= landed (deduped per browser session in tracking.js)
--   'checkout' — Stripe Checkout session created
--   'purchase' — Stripe payment confirmed (idempotent: at most one per song)
--   'refund'   — charge.refunded webhook fired (amount stored as negative)
CREATE TABLE IF NOT EXISTS affiliate_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code  TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  song_id         UUID,
  amount          NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_events_code_idx       ON affiliate_events(affiliate_code);
CREATE INDEX IF NOT EXISTS affiliate_events_song_idx       ON affiliate_events(song_id);
CREATE INDEX IF NOT EXISTS affiliate_events_type_idx       ON affiliate_events(event_type);
CREATE INDEX IF NOT EXISTS affiliate_events_created_at_idx ON affiliate_events(created_at);

ALTER TABLE affiliate_events ENABLE ROW LEVEL SECURITY;

-- ─── AFFILIATE_PAYOUTS ──────────────────────────────────────────────────────
-- One row per payment sent to an affiliate. Inserted via the
-- admin-record-payout edge function (admin-gated, service-role write).
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code  TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  method          TEXT,                -- 'zelle' | 'venmo' | 'paypal' | 'bank' | 'other'
  note            TEXT,                -- free-form (transaction id, reference, etc.)
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by     UUID,                -- admin_users.user_id who recorded it
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- recorded_by is new — add it idempotently in case the table already exists
-- without it (production rows pre-date this column).
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS recorded_by UUID;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS note TEXT;

CREATE INDEX IF NOT EXISTS affiliate_payouts_code_idx    ON affiliate_payouts(affiliate_code);
CREATE INDEX IF NOT EXISTS affiliate_payouts_paid_at_idx ON affiliate_payouts(paid_at);

ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;
