-- 20260625070000_cos_persona.sql
-- Chief of Staff persona + chat (added 2026-06-25).
--
-- Powers the personified, interactive Chief of Staff: a named/faced/voiced
-- assistant you chat with (cos-assistant edge fn). cos_persona holds its
-- identity (name, vibe, avatar, ElevenLabs voice); cos_chat_messages is the
-- transcript; cos-audio bucket stores TTS clips. RLS ON, service-role only.

CREATE TABLE IF NOT EXISTS public.cos_persona (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name        TEXT NOT NULL DEFAULT 'Sofía',
  vibe        TEXT NOT NULL DEFAULT 'warm',
  avatar_url  TEXT,
  voice_id    TEXT,
  voice_name  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.cos_persona (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.cos_persona ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cos_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  audio_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cos_chat_created ON public.cos_chat_messages (created_at);
ALTER TABLE public.cos_chat_messages ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('cos-audio', 'cos-audio', true) ON CONFLICT (id) DO NOTHING;
