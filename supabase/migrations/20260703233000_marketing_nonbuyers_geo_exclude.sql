-- 20260703233000_marketing_nonbuyers_geo_exclude.sql
-- Email marketing — two changes, both self-maintaining (live views over songs,
-- snapshotted at approval time, so every segment keeps growing on its own):
--
--   1. NEW "nonbuyers" segment — people who created a song but never paid
--      (~11k warm leads that were previously excluded from ALL campaigns).
--   2. GEO EXCLUSION — drop non-servable-country emails (Cuba) from EVERY
--      segment. Cuba can't pay under the US embargo (Stripe/OFAC); Roly's
--      viral video drove a wave of Cuban signups that are pure junk on any list.
--
-- Detection is IP-only, reusing the exact zero-spillover Cuba IPv4 blocks from
-- generate-song's country gate (_shared/cuba-ip-block.ts). We deliberately do
-- NOT use phone country code: phone numbers are stored as bare national digits
-- with NO "+"/country code, so a number starting "53" is a US area code
-- (530 = California, etc.), not Cuba's +53 — the phone signal would wrongly
-- drop real US customers. IP catches all 170 Cuban emails, and every one of
-- them is a non-buyer (0 paying customers removed).
--
-- All additive / CREATE OR REPLACE. Existing "all" segment keeps its exact
-- meaning (paying buyers only, ~3,297) — no customer is lost.

-- ---------------------------------------------------------------------------
-- 0 — Cuba IPv4 detection in SQL (mirror of _shared/cuba-ip-block.ts).
-- Bulletproof: regex-guards the cast and swallows any parse error (fail-open,
-- never mis-classify on bad data). 14 LACNIC/ETECSA blocks, cross-checked
-- 2026-07-02 against 3 geo databases. Cuba ONLY, zero spillover.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_cuba_ip(ip text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a inet;
BEGIN
  IF ip IS NULL OR ip !~ '^(\d{1,3}\.){3}\d{1,3}$' THEN RETURN false; END IF;
  a := ip::inet;
  RETURN a <<= '152.206.0.0/15'::inet     -- ETECSA
      OR a <<= '169.158.0.0/16'::inet     -- ETECSA
      OR a <<= '181.225.224.0/19'::inet
      OR a <<= '190.6.64.0/19'::inet
      OR a <<= '190.15.144.0/20'::inet
      OR a <<= '190.92.112.0/20'::inet
      OR a <<= '190.107.0.0/20'::inet
      OR a <<= '200.0.16.0/24'::inet
      OR a <<= '200.0.24.0/22'::inet
      OR a <<= '200.5.12.0/22'::inet
      OR a <<= '200.13.144.0/21'::inet
      OR a <<= '200.14.48.0/21'::inet
      OR a <<= '200.55.128.0/18'::inet    -- ETECSA
      OR a <<= '201.220.192.0/19'::inet;
EXCEPTION WHEN others THEN RETURN false;
END $$;

-- ---------------------------------------------------------------------------
-- 1 — reusable geo-exclusion list. Any email that EVER generated from a Cuban
-- IP is excluded from every marketing list. One place to extend later.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_geo_excluded_emails AS
SELECT DISTINCT lower(s.email) AS email
FROM public.songs s
WHERE s.email IS NOT NULL
  AND s.platform = 'es'
  AND public.is_cuba_ip(s.client_ip);

-- ---------------------------------------------------------------------------
-- 2 — master audience view: now covers BUYERS AND NON-BUYERS, geo-excluded.
-- Adds is_buyer so the RPC can carve segments. New column appended LAST so
-- CREATE OR REPLACE is happy. Non-buyers have last_paid_at = NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_marketing_audience_ext AS
SELECT lower(s.email)                              AS email,
       MAX(s.paid_at)                              AS last_paid_at,
       bool_or(COALESCE(s.has_video_addon, false)) AS has_video_addon,
       bool_or(s.paid = true)                      AS is_buyer
FROM public.songs s
WHERE s.email IS NOT NULL
  AND s.platform = 'es'
  AND lower(s.email) NOT IN (SELECT email FROM public.email_unsubscribes)
  AND lower(s.email) NOT IN (SELECT email FROM public.v_geo_excluded_emails)
GROUP BY lower(s.email);

-- Keep the legacy paid-only view consistent (geo-excluded too), in case any
-- future/ad-hoc query still reads it. Not on the live send path.
CREATE OR REPLACE VIEW public.v_marketing_audience AS
SELECT DISTINCT lower(s.email) AS email
FROM public.songs s
WHERE s.paid = true
  AND s.email IS NOT NULL
  AND s.platform = 'es'
  AND lower(s.email) NOT IN (SELECT email FROM public.email_unsubscribes)
  AND lower(s.email) NOT IN (SELECT email FROM public.v_geo_excluded_emails);

-- ---------------------------------------------------------------------------
-- 3 — segment-aware recipient snapshot. Buyer segments now gate on is_buyer;
-- 'all' keeps its exact prior meaning (buyers only). NEW 'nonbuyers' segment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_marketing_recipients(qid UUID, seg TEXT DEFAULT 'all')
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n INTEGER;
  has_b BOOLEAN;
BEGIN
  SELECT (subject_b IS NOT NULL AND length(btrim(subject_b)) > 0)
    INTO has_b FROM public.email_queue WHERE id = qid;

  INSERT INTO public.email_recipients (email_queue_id, email, variant)
  SELECT qid,
         a.email,
         CASE
           WHEN COALESCE(has_b, false)
                AND (('x' || substr(md5(a.email), 1, 8))::bit(32)::int % 2) <> 0
           THEN 'b' ELSE 'a'
         END
  FROM public.v_marketing_audience_ext a
  WHERE CASE seg
          WHEN 'recent'       THEN a.is_buyer AND a.last_paid_at >= now() - interval '90 days'
          WHEN 'winback'      THEN a.is_buyer AND a.last_paid_at <  now() - interval '90 days'
          WHEN 'video_buyers' THEN a.is_buyer AND a.has_video_addon = true
          WHEN 'no_video'     THEN a.is_buyer AND a.has_video_addon = false
          WHEN 'nonbuyers'    THEN a.is_buyer = false
          ELSE                     a.is_buyer          -- 'all' = paying buyers (unchanged)
        END
  ON CONFLICT (email_queue_id, email) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- 4 — live segment sizes for the UI. Buyer segments gate on is_buyer; add
-- the nonbuyers count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketing_segment_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'all',          count(*) FILTER (WHERE is_buyer),
    'recent',       count(*) FILTER (WHERE is_buyer AND last_paid_at >= now() - interval '90 days'),
    'winback',      count(*) FILTER (WHERE is_buyer AND last_paid_at <  now() - interval '90 days'),
    'video_buyers', count(*) FILTER (WHERE is_buyer AND has_video_addon),
    'no_video',     count(*) FILTER (WHERE is_buyer AND NOT has_video_addon),
    'nonbuyers',    count(*) FILTER (WHERE NOT is_buyer)
  )
  FROM public.v_marketing_audience_ext;
$$;
