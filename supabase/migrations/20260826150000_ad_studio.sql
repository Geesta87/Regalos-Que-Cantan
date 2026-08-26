-- 20260826150000_ad_studio.sql
-- AD STUDIO — owner-driven ad-video generator on Atlas Cloud (Seedance 2.5).
--
-- Productizes the 2026-08-19 "Podcast & Street" batch: spoken-dialogue ad
-- clips (Seedance 2.5 native audio + Spanish lip-sync) generated on Atlas
-- Cloud at $0.134/sec — ~57% cheaper than the same model on Kie. One row per
-- render in ad_studio_generations; the dashboard reaches it only through the
-- admin-gated ad-studio edge function.
--
-- Generation lifecycle (status):
--   generating — Atlas generateVideo fired, media not back yet ('list' finalizes)
--   ready      — media rehosted into the ad-studio bucket (Atlas URLs expire)
--   failed     — generation failed (error has detail)

CREATE TABLE IF NOT EXISTS public.ad_studio_generations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  format        TEXT NOT NULL DEFAULT 'custom',      -- podcast | street | reaction | custom
  brief         TEXT,                                -- owner's plain-language ask (what the AI script was written from)
  prompt        TEXT NOT NULL,                       -- exact prompt sent to Atlas (dialogue + scene + camera)
  model         TEXT NOT NULL,                       -- exact Atlas model slug used
  prediction_id TEXT,                                -- Atlas prediction id
  status        TEXT NOT NULL DEFAULT 'generating',
  media_url     TEXT,                                -- rehosted public URL once ready
  aspect_ratio  TEXT,
  duration      INTEGER,                             -- seconds
  resolution    TEXT,
  error         TEXT,
  meta          JSONB NOT NULL DEFAULT '{}',         -- generate_audio, finish, rawUrl, estCostUsd…
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_studio_generations_created
  ON public.ad_studio_generations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_studio_generations_status
  ON public.ad_studio_generations (status) WHERE status = 'generating';

ALTER TABLE public.ad_studio_generations ENABLE ROW LEVEL SECURITY;
-- No policies → service-role only (same pattern as studio_generations).

-- Public-read bucket for finished renders. Atlas output URLs are provider-hosted
-- and not permanent, so everything kept is rehosted here; writes are
-- service-role only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('ad-studio', 'ad-studio', true)
ON CONFLICT (id) DO NOTHING;
