-- Seed the VUELVE15 exit-intent coupon
-- This coupon gives 15% off and is used by the ExitIntentPopup component
INSERT INTO coupons (code, active, type, discount, max_uses, times_used, expires_at)
VALUES ('VUELVE15', true, 'percentage', 15, 10000, 0, '2027-12-31T23:59:59Z')
ON CONFLICT (code) DO UPDATE SET active = true, discount = 15, type = 'percentage';
