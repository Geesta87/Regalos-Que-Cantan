-- Phase 4 upsells: synced lyric video + karaoke video ($9.99 each).
-- Additive + nullable — nothing reads these until the feature ships, so this
-- migration is safe to apply ahead of the code. Mirrors the existing
-- karaoke_url / karaoke_status columns (the instrumental-MP3 addon).
--
-- status lifecycle: NULL (not purchased) → 'pending' → 'ready' | 'failed'

ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyric_video_url     text;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyric_video_status  text;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS karaoke_video_url    text;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS karaoke_video_status text;
