-- 20260625050000_chief_of_staff.sql
-- Chief of Staff agent (added 2026-06-25).
--
-- Runs each morning AFTER the other agents and folds everything into ONE
-- prioritized briefing: ad performance + real revenue, creatives awaiting
-- approval, email drafts to review, new competitor opportunities, and whether
-- each agent ran OK. Stored here + emailed; shown in the "Chief of Staff" tab.
-- RLS ON, service-role only (admin reaches it via chief-of-staff-admin).

CREATE TABLE IF NOT EXISTS public.cos_briefings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_for  DATE NOT NULL,
  gathered      JSONB,      -- the raw cross-agent snapshot
  analysis      JSONB,      -- Claude's synthesis (headline, top_actions, agent_health, snapshot)
  email_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cos_briefings_for ON public.cos_briefings (briefing_for);
ALTER TABLE public.cos_briefings ENABLE ROW LEVEL SECURITY;

-- Operational: pg_cron 'chief-of-staff-daily' ~16:45 UTC (≈9:45am Pacific,
-- after media-buyer-daily at 16:00) via net.http_post.
