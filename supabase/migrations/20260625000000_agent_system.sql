-- 20260625000000_agent_system.sql
-- Foundation tables for the autonomous "AI staff" agents (added 2026-06-25).
--
-- Three daily agents are being built on the existing cron + edge-function
-- stack, each fully isolated from stripe-webhook / the payment funnel:
--   1. media-buyer-daily   — analyzes Meta ads, emails a recommend-only brief
--   2. creative-studio-daily — generates social/ad creatives → approval queue
--   3. chief-of-staff-daily  — folds everything into ONE morning briefing
--
-- This migration only adds the shared audit log + the Media Buyer's report
-- store. The Creative Studio's queue table ships with that agent's commit.
--
-- Security model mirrors social_pipeline_state: RLS ON, NO client policies.
-- Only the edge functions (service-role key) read/write these tables; the
-- admin dashboard reaches them through an admin-gated edge function, never
-- directly. No customer PII beyond what songs already holds.

-- ---------------------------------------------------------------------------
-- agent_runs — one row per agent execution. Shared audit trail so every
-- agent's activity (and failures) is inspectable from one place.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent         TEXT NOT NULL,                 -- 'media-buyer' | 'creative-studio' | 'chief-of-staff'
  status        TEXT NOT NULL DEFAULT 'running', -- 'running' | 'ok' | 'skipped' | 'error'
  ok            BOOLEAN,
  summary       TEXT,                          -- short human-readable outcome
  payload       JSONB,                         -- structured detail (metrics, counts, etc.)
  error         TEXT,
  execution_ms  INTEGER,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started
  ON public.agent_runs (agent, started_at DESC);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
-- No policies → service-role only.

-- ---------------------------------------------------------------------------
-- media_buyer_reports — one row per day. Stores the raw metrics the agent
-- pulled (Meta + real revenue cross-check) AND the AI analysis, so the brief
-- is reproducible and the Chief of Staff can read the latest without re-running.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_buyer_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_for     DATE NOT NULL,               -- the day analyzed (yesterday at run time)
  account_id     TEXT NOT NULL,
  metrics        JSONB,                        -- account + per-campaign numbers, revenue cross-check
  analysis       JSONB,                        -- Claude's structured brief (headline, verdicts, recs)
  email_sent     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_buyer_reports_for_account
  ON public.media_buyer_reports (report_for, account_id);

ALTER TABLE public.media_buyer_reports ENABLE ROW LEVEL SECURITY;
-- No policies → service-role only.

-- ---------------------------------------------------------------------------
-- Operational setup applied alongside this migration (documented for parity,
-- same convention as auto-send-paid-email / send-song-ready-sms):
--
--   * pg_cron job 'media-buyer-daily' runs once each morning and calls the
--     edge function via net.http_post. Applied out-of-band because it carries
--     the service-role bearer + function URL. Ready-to-run snippet:
--
--   SELECT cron.schedule(
--     'media-buyer-daily',
--     '0 13 * * *',  -- 13:00 UTC ≈ 8am Central; adjust to owner's morning
--     $$
--       SELECT net.http_post(
--         url     := 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/media-buyer-daily',
--         headers := jsonb_build_object(
--           'Content-Type','application/json',
--           'Authorization','Bearer ' || current_setting('app.service_role_key', true)
--         ),
--         body    := '{}'::jsonb
--       );
--     $$
--   );
--
-- (cron.schedule is idempotent by job name — re-running is safe.)
-- ---------------------------------------------------------------------------
