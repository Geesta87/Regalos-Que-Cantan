-- 20260813120000_character_studio.sql
-- CHARACTER STUDIO — in-house AI influencer / brand-character builder
-- (the "build it ourselves" answer to Eromify-style tools, 2026-08-13).
--
-- One row per character in studio_characters; every render (portrait candidate,
-- image, video) is a studio_generations row. Identity consistency comes from
-- the proven Ace/CENZO recipe: pick a portrait once, then every later render
-- passes it (plus optional extra reference stills) to google/nano-banana-edit /
-- bytedance/seedance-2 as reference images. No model training, no per-seat SaaS.
--
-- Character lifecycle (status):
--   draft    — created, portrait candidates generating / awaiting the pick
--   active   — portrait chosen; can generate content
--   archived — hidden from the picker (rows + media kept)
--
-- Generation lifecycle (status):
--   generating — Kie createTask fired, media not back yet ('sync' finalizes)
--   ready      — media rehosted into the character-studio bucket
--   failed     — generation failed (error has detail)
--
-- Security: RLS ON, NO client policies (service-role only). The dashboard
-- reaches these tables through the admin-gated character-studio edge function,
-- never directly — same pattern as creative_queue.

CREATE TABLE IF NOT EXISTS public.studio_characters (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  style          TEXT NOT NULL DEFAULT 'photoreal', -- photoreal | pixar | illustrated | anime | custom
  description    TEXT NOT NULL,                     -- the identity: looks, age, styling (reused in every prompt)
  image_model    TEXT,                              -- Kie slug for from-scratch renders (default google/nano-banana)
  portrait_url   TEXT,                              -- chosen identity anchor (rehosted public URL)
  reference_urls JSONB NOT NULL DEFAULT '[]',       -- extra identity stills (rehosted URLs, max ~9 with portrait)
  status         TEXT NOT NULL DEFAULT 'draft',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.studio_generations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES public.studio_characters(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                       -- portrait | image | video
  prompt       TEXT NOT NULL,                       -- exact prompt sent to Kie
  model        TEXT NOT NULL,                       -- exact Kie model slug used
  kie_task_id  TEXT,
  status       TEXT NOT NULL DEFAULT 'generating',
  media_url    TEXT,                                -- rehosted public URL once ready
  aspect_ratio TEXT,
  duration     INTEGER,                             -- seconds (video only)
  error        TEXT,
  meta         JSONB NOT NULL DEFAULT '{}',         -- fromImageUrl, loop, resolution, creditsConsumed…
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 'sync' scans generating rows per character; the gallery lists by character.
CREATE INDEX IF NOT EXISTS idx_studio_generations_char_created
  ON public.studio_generations (character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_generations_status
  ON public.studio_generations (status) WHERE status = 'generating';

ALTER TABLE public.studio_characters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_generations ENABLE ROW LEVEL SECURITY;
-- No policies → service-role only.

-- Public-read bucket for finished renders (portraits, images, videos). Kie's
-- source URLs expire (~14 days), so everything kept is rehosted here; writes
-- are service-role only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('character-studio', 'character-studio', true)
ON CONFLICT (id) DO NOTHING;
