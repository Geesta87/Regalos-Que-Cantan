-- 20260428_social_pipeline_state.sql
-- Single-row table that controls whether the GHL social-posting pipeline is
-- active. Admin flips this from the dashboard to pause posting (e.g. while
-- iterating on captions or dealing with a platform issue) and flip it back
-- on when ready. Replaces the SOCIAL_CLIPS_ENABLED env-var-only kill switch
-- with a DB-backed flag that doesn't need a redeploy to change.
--
-- Both render-social-clip and post-to-ghl read this row at the start of
-- every invocation. The env var stays as a second safety net (env=false
-- still wins, even if db.enabled=true) so secrets-level kill remains.
--
-- Design:
--   * Exactly one row (id = 1, enforced by CHECK).
--   * Read via service-role only — RLS denies client access. Edge functions
--     gate writes by admin_users.role server-side, same as mureka_credit_state.

CREATE TABLE IF NOT EXISTS social_pipeline_state (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single row so the edge function always finds it.
INSERT INTO social_pipeline_state (id, enabled)
VALUES (1, TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE social_pipeline_state ENABLE ROW LEVEL SECURITY;
-- No policies → no client-side access. The edge function uses the service-role
-- key and applies its own role check before reading/writing.
