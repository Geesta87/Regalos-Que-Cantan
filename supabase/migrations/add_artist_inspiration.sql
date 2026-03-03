-- Add new columns to songs table for artist inspiration and sub-genre features
ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS voice_type VARCHAR(20) DEFAULT 'male';

ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS sub_genre VARCHAR(50);

ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS artist_inspiration TEXT;

ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS style_used TEXT;

-- Create indexes for analytics
CREATE INDEX IF NOT EXISTS idx_songs_voice_type ON songs(voice_type);
CREATE INDEX IF NOT EXISTS idx_songs_sub_genre ON songs(sub_genre);
CREATE INDEX IF NOT EXISTS idx_songs_artist_inspiration ON songs(artist_inspiration) WHERE artist_inspiration IS NOT NULL;
