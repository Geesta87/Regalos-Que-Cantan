-- Creative Studio's OWN posting switch, independent of social_pipeline_state
-- (which gates the song social-clip pipeline). Lets the owner enable Creative
-- Studio auto-posting without un-pausing the song-clip pipeline. Seeded ON.
CREATE TABLE IF NOT EXISTS public.creative_posting_state (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.creative_posting_state (id, enabled) VALUES (1, TRUE) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.creative_posting_state ENABLE ROW LEVEL SECURITY;
