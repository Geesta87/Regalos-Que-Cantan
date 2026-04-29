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
  -- Mureka pricing: 10 Gold = 1 song. One useapi.net generation produces
  -- TWO song variations, so it deducts 20 Gold per generation (verified
  -- live on 2026-04-28: balance went from 12864 → 12844 after one
  -- successful create-advanced call). Pricing references on Mureka's site:
  -- Add Gold packs (4000/400, 8000/800, 16000/1600), Premier subscription
  -- (20000/2000) — all converge on 10 Gold per song = 20 Gold per generation.
  credits_per_generation NUMERIC NOT NULL DEFAULT 20,
  -- Thresholds in Gold. 2000 Gold = 100 generations left = 200 songs.
  -- 500 Gold = 25 generations = 50 songs.
  low_threshold          INT NOT NULL DEFAULT 2000,
  critical_threshold     INT NOT NULL DEFAULT 500,
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
