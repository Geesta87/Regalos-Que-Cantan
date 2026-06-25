-- 20260625010000_creative_queue.sql
-- AGENT 2 — Creative Studio queue (added 2026-06-25).
--
-- The Creative Studio agent generates a daily batch of social + paid-ad
-- creatives (5 videos + 5 visuals), each with ad copy + captions, and parks
-- them here for the owner to APPROVE before anything posts. On approval the
-- existing post-to-ghl plumbing publishes them (respecting the
-- social_pipeline_state pause switch). Nothing auto-posts without approval.
--
-- Lifecycle (status):
--   generating       — Kie createTask fired, media not back yet (poller finalizes)
--   ready            — media stored, copy written, awaiting owner approval
--   failed           — generation failed (error has detail)
--   approved         — owner approved; queued for posting
--   posted           — pushed to GHL (ghl_post_id set)
--   rejected         — owner dismissed it
--
-- Security: RLS ON, NO client policies (service-role only). The admin dashboard
-- reaches this through an admin-gated edge function, never directly.

CREATE TABLE IF NOT EXISTS public.creative_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_date      DATE NOT NULL,                 -- the day this batch was generated
  kind            TEXT NOT NULL,                 -- 'image' | 'video'
  intended_use    TEXT NOT NULL DEFAULT 'social',-- 'social' | 'ad'
  occasion        TEXT,                          -- e.g. 'cumpleaños', 'aniversario', 'día de las madres'
  persuasion_angle TEXT,                         -- the emotional/persuasive hook (esp. for ads)
  concept         TEXT,                          -- short human description of the idea
  gen_prompt      TEXT,                          -- the exact prompt sent to Kie
  -- copy, ready to publish (Spanish, no recipient names — evergreen):
  headline        TEXT,
  primary_text    TEXT,                          -- ad primary text / post body
  caption         TEXT,                          -- platform caption
  hashtags        TEXT[],
  score           INTEGER,                       -- Creative Director self-rating 0-100 (for ordering)
  -- generation + lifecycle:
  status          TEXT NOT NULL DEFAULT 'generating',
  kie_task_id     TEXT,
  media_url       TEXT,                          -- stored public URL once ready
  error           TEXT,
  ghl_post_id     TEXT,
  approved_at     TIMESTAMPTZ,
  posted_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Poller scans 'generating' rows; dashboard scans 'ready'. Keep both fast.
CREATE INDEX IF NOT EXISTS idx_creative_queue_status_created
  ON public.creative_queue (status, created_at DESC);

ALTER TABLE public.creative_queue ENABLE ROW LEVEL SECURITY;
-- No policies → service-role only.

-- Public bucket for the finished creatives (images + videos). Public-read so the
-- approval UI + GHL can fetch by URL; writes are service-role only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('creative-studio', 'creative-studio', true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Operational (documented for parity — applied out-of-band like the others):
--   * pg_cron 'creative-studio-daily' — once each morning, generates the batch.
--       '0 11 * * *'  (≈ before the owner's day; adjust)
--   * pg_cron 'poll-creative-queue'   — every 2 min, finalizes 'generating' rows.
--       '*/2 * * * *'
--   Both call their edge function via net.http_post (idempotent by job name).
-- ---------------------------------------------------------------------------
