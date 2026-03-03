-- Add coupon_code column to songs table if not exists
ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);

-- Add index for coupon lookups
CREATE INDEX IF NOT EXISTS idx_songs_coupon_code ON songs(coupon_code);
