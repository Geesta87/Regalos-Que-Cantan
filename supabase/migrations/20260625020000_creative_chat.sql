-- 20260625020000_creative_chat.sql
-- Creative Studio art-director CHAT (added 2026-06-25).
--
-- Backs the in-dashboard chat where the owner talks to Claude (the art
-- director): brainstorm, generate visuals on demand, save style preferences,
-- and tweak specific creatives. RLS ON, service-role only (admin reaches it
-- through the creative-chat edge function).

-- Persistent style direction the owner sets in chat ("always warmer light",
-- "lean animated for kids"). creative-studio-daily AND creative-chat read this
-- and append it to the art-director system prompt so every future generation
-- follows it.
CREATE TABLE IF NOT EXISTS public.creative_studio_config (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  style_notes TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.creative_studio_config (id, style_notes)
VALUES (1, '') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.creative_studio_config ENABLE ROW LEVEL SECURITY;

-- Durable chat transcript. creative_ids = creatives generated during that turn
-- (so the UI can render them inline once the poller finishes them).
CREATE TABLE IF NOT EXISTS public.creative_chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role         TEXT NOT NULL,           -- 'user' | 'assistant'
  content      TEXT NOT NULL DEFAULT '',
  creative_ids UUID[],
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creative_chat_created
  ON public.creative_chat_messages (created_at);
ALTER TABLE public.creative_chat_messages ENABLE ROW LEVEL SECURITY;
