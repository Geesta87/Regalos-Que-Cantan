-- 20260722120000_email_segments_expansion.sql
-- Expand the marketing email audience segments and re-sync the local schema with
-- what is already LIVE (production had drifted ahead of the migration files):
--   * v_marketing_audience_ext already carries is_buyer and includes non-buyers
--     (a songs row is created BEFORE payment, so unpaid = a lead who started but
--     never checked out). This migration re-declares it verbatim so a fresh
--     `db reset` reproduces production.
--   * enqueue_marketing_recipients / marketing_segment_counts already know the
--     buyer segments + 'nonbuyers'. This adds three NEW options:
--       - buyers_7d     : bought in the last 7 days
--       - buyers_30d    : bought in the last 30 days
--       - everyone_all  : buyers + non-buyers (the full 'es' list)
--
-- All additive + CREATE OR REPLACE. Nothing dropped, no data touched.

-- ---------------------------------------------------------------------------
-- Audience view (re-declared to match production: adds is_buyer, drops the
-- paid=true filter so non-buyers are included; suppression = unsubscribe + geo).
-- CREATE OR REPLACE only APPENDS the is_buyer column, so it is safe from either
-- the old 3-column local state or the live 4-column state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_marketing_audience_ext AS
SELECT lower(s.email)                              AS email,
       max(s.paid_at)                              AS last_paid_at,
       bool_or(COALESCE(s.has_video_addon, false)) AS has_video_addon,
       bool_or(s.paid = true)                      AS is_buyer
FROM public.songs s
WHERE s.email IS NOT NULL
  AND s.platform = 'es'
  AND lower(s.email) NOT IN (SELECT email FROM public.email_unsubscribes)
  AND lower(s.email) NOT IN (SELECT email FROM public.v_geo_excluded_emails)
GROUP BY lower(s.email);

-- ---------------------------------------------------------------------------
-- Segment-aware, A/B-aware recipient snapshot. Adds buyers_7d / buyers_30d /
-- everyone_all to the segments already supported live.
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
          WHEN 'buyers_7d'    THEN a.is_buyer AND a.last_paid_at >= now() - interval '7 days'
          WHEN 'buyers_30d'   THEN a.is_buyer AND a.last_paid_at >= now() - interval '30 days'
          WHEN 'video_buyers' THEN a.is_buyer AND a.has_video_addon = true
          WHEN 'no_video'     THEN a.is_buyer AND a.has_video_addon = false
          WHEN 'nonbuyers'    THEN a.is_buyer = false
          WHEN 'everyone_all' THEN true                 -- buyers + non-buyers
          ELSE                     a.is_buyer           -- 'all' = every buyer
        END
  ON CONFLICT (email_queue_id, email) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- Live segment sizes for the UI ("this email will go to N people").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketing_segment_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'all',          count(*) FILTER (WHERE is_buyer),
    'buyers_7d',    count(*) FILTER (WHERE is_buyer AND last_paid_at >= now() - interval '7 days'),
    'buyers_30d',   count(*) FILTER (WHERE is_buyer AND last_paid_at >= now() - interval '30 days'),
    'recent',       count(*) FILTER (WHERE is_buyer AND last_paid_at >= now() - interval '90 days'),
    'winback',      count(*) FILTER (WHERE is_buyer AND last_paid_at <  now() - interval '90 days'),
    'video_buyers', count(*) FILTER (WHERE is_buyer AND has_video_addon),
    'no_video',     count(*) FILTER (WHERE is_buyer AND NOT has_video_addon),
    'nonbuyers',    count(*) FILTER (WHERE NOT is_buyer),
    'everyone_all', count(*)
  )
  FROM public.v_marketing_audience_ext;
$$;
