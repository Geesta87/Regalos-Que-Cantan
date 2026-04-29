-- 20260428_mureka_credit_state.sql
-- Single-row table that tracks the admin's last-known Mureka credit balance,
-- anchored to a timestamp. The dashboard counts distinct mureka_job_id values
-- created since `anchored_at` and subtracts (multiplied by credits_per_generation)
-- to estimate the current balance.
--
-- Why this exists: useapi.net (our Mureka proxy) does not expose Mureka's
-- credit balance via API, so we can't read it live. Manual anchor + auto
-- deduction is the closest reliable signal we can build.
--
-- Design:
--   * Always exactly one row (id = 1, enforced by CHECK).
--   * Only the admin updates `balance` (when they top up at useapi.net).
--   * RLS denies all client access; reads/writes go through the
--     `mureka-credits` edge function which enforces admin role server-side.

CREATE TABLE IF NOT EXISTS mureka_credit_state (
  id                     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  balance                INT NOT NULL DEFAULT 0,
  anchored_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  credits_per_generation NUMERIC NOT NULL DEFAULT 1,
  low_threshold          INT NOT NULL DEFAULT 500,
  critical_threshold     INT NOT NULL DEFAULT 100,
  updated_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single row so the edge function always finds it.
INSERT INTO mureka_credit_state (id, balance, anchored_at)
VALUES (1, 0, now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE mureka_credit_state ENABLE ROW LEVEL SECURITY;
-- No policies → no client-side access. The edge function uses the service-role
-- key and applies its own role check before reading/writing.
