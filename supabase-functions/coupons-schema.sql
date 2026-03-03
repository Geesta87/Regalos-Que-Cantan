-- Coupons Table for RegalosQueCantan
-- Run this in Supabase SQL Editor

-- Create coupons table
CREATE TABLE IF NOT EXISTS coupons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('percentage', 'fixed', 'free')),
  discount DECIMAL(10,2) DEFAULT 0, -- percentage (e.g., 50 for 50%) or fixed amount
  description TEXT,
  active BOOLEAN DEFAULT true,
  max_uses INTEGER, -- NULL means unlimited
  times_used INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Add index for fast lookup
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(active);

-- Add regenerate_count to songs table if not exists
ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS regenerate_count INTEGER DEFAULT 0;

ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS parent_song_id UUID REFERENCES songs(id);

-- Example coupons to insert:

-- 100% FREE coupon
INSERT INTO coupons (code, type, discount, description, max_uses)
VALUES ('GRATIS100', 'free', 100, 'Canción gratis', 10)
ON CONFLICT (code) DO NOTHING;

-- 50% OFF coupon
INSERT INTO coupons (code, type, discount, description, max_uses)
VALUES ('MITAD50', 'percentage', 50, '50% de descuento', 50)
ON CONFLICT (code) DO NOTHING;

-- $10 OFF coupon
INSERT INTO coupons (code, type, discount, description)
VALUES ('AHORRA10', 'fixed', 10, '$10 de descuento')
ON CONFLICT (code) DO NOTHING;

-- VIP unlimited free coupon (for you/influencers)
INSERT INTO coupons (code, type, discount, description, max_uses)
VALUES ('VIPREGALOS', 'free', 100, 'VIP - Canciones gratis ilimitadas', NULL)
ON CONFLICT (code) DO NOTHING;

-- 25% OFF launch coupon
INSERT INTO coupons (code, type, discount, description, max_uses, expires_at)
VALUES ('LANZAMIENTO25', 'percentage', 25, '25% off - Lanzamiento', 100, NOW() + INTERVAL '30 days')
ON CONFLICT (code) DO NOTHING;

-- Function to increment coupon usage
CREATE OR REPLACE FUNCTION increment_coupon_usage(coupon_code TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE coupons 
  SET times_used = times_used + 1 
  WHERE code = coupon_code;
END;
$$ LANGUAGE plpgsql;

-- View to see coupon stats
CREATE OR REPLACE VIEW coupon_stats AS
SELECT 
  code,
  type,
  discount,
  description,
  active,
  max_uses,
  times_used,
  CASE 
    WHEN max_uses IS NULL THEN 'Unlimited'
    ELSE (max_uses - times_used)::TEXT 
  END as remaining_uses,
  expires_at,
  CASE 
    WHEN expires_at IS NULL THEN 'No expiry'
    WHEN expires_at > NOW() THEN 'Active'
    ELSE 'Expired'
  END as expiry_status
FROM coupons
ORDER BY created_at DESC;

-- Grant permissions
GRANT SELECT ON coupons TO anon;
GRANT SELECT ON coupon_stats TO authenticated;
