-- 20260827200000_ad_studio_stats.sql
-- AD STUDIO Tier 2 — per-ad sales attribution.
--
-- Every Ad Studio render gets a tracked link carrying utm_campaign
-- 'ad-<first 8 hex of the generation id>' (the funnel already persists
-- utm_campaign onto songs; the 'ad-<hex8>' shape cannot collide with Banner
-- QR's reserved 'b-*' or Meta's free-text campaign names). This function
-- rolls paid songs up per tag, deduping bundle rows per stripe_session_id
-- with MAX(amount_paid) — the 2-pack stamps the FULL total on BOTH rows
-- (see project_bundle_amount_model), so a session counts once.
--
-- Numbers are a FLOOR, not a full count: a buyer who clicks the ad but
-- converts later from a bare link arrives untagged (same caveat as the
-- Banner QR numbers).

CREATE OR REPLACE FUNCTION public.ad_studio_stats()
RETURNS TABLE(tag text, orders bigint, revenue numeric)
LANGUAGE sql STABLE AS $$
  WITH sessions AS (
    SELECT utm_campaign AS tag,
           COALESCE(stripe_session_id, id::text) AS sess,
           MAX(amount_paid) AS amt
    FROM public.songs
    WHERE paid = true AND utm_campaign ~ '^ad-[0-9a-f]{8}$'
    GROUP BY 1, 2
  )
  SELECT tag, COUNT(*)::bigint AS orders, COALESCE(SUM(amt), 0) AS revenue
  FROM sessions GROUP BY tag;
$$;
