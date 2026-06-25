-- 20260625040000_competitor_ads.sql
-- Competitors agent (added 2026-06-25).
--
-- competitor-scan pulls personalized-song competitors' ACTIVE ads from the
-- Facebook Ad Library (via the ScrapeCreators API) across ES + EN keywords,
-- Claude rates each (hook / angle / why it works / how long it's run = winner
-- signal / fit for RQC + a suggested RQC angle), and stores them here. The
-- Creative Studio "Competitors" section shows them ranked with a "Make our
-- version" button that generates an ORIGINAL Regalos ad from the winning
-- CONCEPT (never copying the competitor's assets/text). RLS ON, service-role only.

CREATE TABLE IF NOT EXISTS public.competitor_ads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_archive_id       TEXT UNIQUE,
  page_name           TEXT,
  lang                TEXT,
  media_type          TEXT,
  image_url           TEXT,
  video_url           TEXT,
  body_text           TEXT,
  cta_text            TEXT,
  is_active           BOOLEAN,
  ad_start            TIMESTAMPTZ,
  active_days         INTEGER,
  publisher_platforms TEXT[],
  score               INTEGER,
  analysis            JSONB,
  status              TEXT NOT NULL DEFAULT 'new',
  cloned_creative_id  UUID,
  scanned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_rank
  ON public.competitor_ads (status, score DESC NULLS LAST, active_days DESC NULLS LAST);
ALTER TABLE public.competitor_ads ENABLE ROW LEVEL SECURITY;

-- Operational: pg_cron 'competitor-scan' weekly (e.g. Mon '30 15 * * 1'),
-- calls the edge function via net.http_post. Uses the SCRAPECREATORS_API_KEY
-- secret (~6 credits/scan).
