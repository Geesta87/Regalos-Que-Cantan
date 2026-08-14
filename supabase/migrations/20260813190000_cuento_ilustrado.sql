-- Cuento Ilustrado — illustrated-storybook upsell (test phase 2026-08-13).
-- One row per generated book. Pages are stanzas of the song's own lyrics,
-- illustrated with identity-consistent nano-banana renders (Character Studio
-- recipe). Service-role only (RLS on, no policies): the public /cuento/:token
-- page reads through generate-cuento's 'public' action, never the table.

CREATE TABLE IF NOT EXISTS cuentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'standard',           -- 'standard' | 'likeness' (future)
  status text NOT NULL DEFAULT 'planning',         -- planning|generating|ready|failed
  share_token text UNIQUE NOT NULL,                 -- unguessable, set by generate-cuento
  character_sheet text,                             -- reusable character description
  stanzas jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{n, text, scene}]
  cover_url text,
  page_urls jsonb NOT NULL DEFAULT '[]'::jsonb,     -- rehosted bucket URLs, aligned with stanzas
  kie_tasks jsonb NOT NULL DEFAULT '{}'::jsonb,     -- {anchor, pages:{n:taskId}, retries:{n:count}}
  dedication text,
  paid boolean NOT NULL DEFAULT false,              -- false = internal/test book
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

ALTER TABLE cuentos ENABLE ROW LEVEL SECURITY;      -- no policies: service-role only

CREATE INDEX IF NOT EXISTS cuentos_song_idx ON cuentos (song_id);
CREATE INDEX IF NOT EXISTS cuentos_status_idx ON cuentos (status);

-- Public-read bucket for finished pages. Kie's result URLs expire, so every
-- finished PNG is rehosted here immediately; writes are service-role only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('cuentos', 'cuentos', true)
ON CONFLICT (id) DO NOTHING;
