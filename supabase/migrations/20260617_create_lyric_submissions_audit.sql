-- Append-only audit of exactly what the customer submitted, written at
-- generate-song intake BEFORE any AI/Suno generation runs. Guarantees the
-- customer's words are preserved even if generation later fails or the song
-- row is never inserted. Source of truth for "what did the customer actually
-- submit" disputes (motivated by a 2026-06-17 case where a customer's original
-- lyrics could not be recovered).
CREATE TABLE IF NOT EXISTS lyric_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  email text,
  recipient_name text,
  sender_name text,
  occasion text,
  genre text,
  session_id text,
  used_custom_lyrics boolean NOT NULL DEFAULT false,
  submitted_lyrics text,
  submitted_details text
);
CREATE INDEX IF NOT EXISTS idx_lyric_submissions_email ON lyric_submissions (email);
CREATE INDEX IF NOT EXISTS idx_lyric_submissions_created_at ON lyric_submissions (created_at DESC);
COMMENT ON TABLE lyric_submissions IS 'Immutable record of customer lyric/story submissions, written at generate-song intake before any generation. Source of truth for "what did the customer actually submit" disputes.';
