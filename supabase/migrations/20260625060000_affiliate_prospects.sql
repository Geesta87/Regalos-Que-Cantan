-- 20260625060000_affiliate_prospects.sql
-- Affiliate Recruiter agent (added 2026-06-25).
--
-- affiliate-recruiter discovers Latino creators/vendors via ScrapeCreators
-- (TikTok/Instagram search), Claude scores their fit + drafts a Spanish outreach
-- DM, and stores them here. The dashboard "Recruit Partners" panel shows them
-- ranked; the owner sends the DM, and on a reply converts them via the existing
-- create-affiliate flow. RLS ON, service-role only (admin reaches it via
-- affiliate-recruiter-admin).

CREATE TABLE IF NOT EXISTS public.affiliate_prospects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            TEXT NOT NULL,        -- 'tiktok' | 'instagram'
  handle              TEXT NOT NULL,
  display_name        TEXT,
  profile_url         TEXT,
  followers           INTEGER,
  videos              INTEGER,
  likes               BIGINT,
  verified            BOOLEAN,
  niche               TEXT,                 -- the search term that surfaced them
  fit_score           INTEGER,              -- Claude 0-100
  fit_reason          TEXT,
  suggested_commission INTEGER,
  outreach_draft      TEXT,                 -- ready-to-send Spanish DM
  status              TEXT NOT NULL DEFAULT 'new',  -- new | contacted | responded | converted | dismissed
  affiliate_code      TEXT,                 -- set on conversion
  notes               TEXT,
  scanned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, handle)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_prospects_rank
  ON public.affiliate_prospects (status, fit_score DESC NULLS LAST, followers DESC NULLS LAST);
ALTER TABLE public.affiliate_prospects ENABLE ROW LEVEL SECURITY;

-- Operational: pg_cron 'affiliate-recruiter' weekly via net.http_post
-- (~1 credit per niche search; uses SCRAPECREATORS_API_KEY).
