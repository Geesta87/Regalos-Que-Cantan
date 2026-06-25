-- 3-song pack ("Paquete de 3 canciones") support on the coupons table.
-- A pack purchase mints a personal NOMBRE-### code worth 3 free single-song
-- redemptions. These columns are additive + nullable/defaulted, so existing
-- coupons (VUELVE15, affiliate codes, comps) are unaffected.
--
--   single_song_only : the code may only be applied to a 1-song order, so a
--                      100%-off pack code can't free an entire multi-song cart
--                      in a single use (enforced in create-checkout).
--   buyer_email      : who bought the pack (for support + tracking).
--   stripe_session_id: the pack purchase that minted it — used as the
--                      idempotency key in stripe-webhook so a retried webhook
--                      doesn't mint a second code.
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS single_song_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS buyer_email text,
  ADD COLUMN IF NOT EXISTS stripe_session_id text;

-- Fast idempotency lookup by the minting session.
CREATE INDEX IF NOT EXISTS coupons_stripe_session_id_idx ON coupons (stripe_session_id);
