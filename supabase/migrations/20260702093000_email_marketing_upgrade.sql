-- 20260702093000_email_marketing_upgrade.sql
-- Email marketing upgrade — "do first" list.
--   1. UTM campaign key + per-campaign revenue attribution (read from songs).
--   2. Per-email audience segments (recent / winback / video buyers / no-video).
--   3. (deliverability multipart handled in the edge functions.)
--   4. Subject-line A/B (subject_b + per-recipient variant).
--
-- All additive: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Nothing dropped.

-- ---------------------------------------------------------------------------
-- 1 + 4 — new columns on the queue + per-recipient variant
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_queue
  ADD COLUMN IF NOT EXISTS campaign_key TEXT,          -- e.g. em_20260702_ab12cd (also the utm_campaign + SendGrid category)
  ADD COLUMN IF NOT EXISTS segment      TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS subject_b    TEXT;          -- optional A/B second subject

ALTER TABLE public.email_recipients
  ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'a'; -- 'a' | 'b' (A/B split)

-- Defensive: the attribution columns are written by create-checkout / stripe-webhook
-- but never had an explicit migration. Ensure they exist so the revenue read works.
ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS utm_source         TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium         TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign       TEXT,
  ADD COLUMN IF NOT EXISTS from_email_campaign TEXT;

-- Revenue attribution reads paid songs by email campaign key — index for it.
CREATE INDEX IF NOT EXISTS idx_songs_email_campaign
  ON public.songs (utm_campaign)
  WHERE paid = true AND utm_campaign IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2 — richer audience view with the attributes we segment on
-- ---------------------------------------------------------------------------
-- One row per distinct paid, non-suppressed RQC ('es') customer, aggregated
-- across all their songs. Keeps the same eligibility rules as v_marketing_audience.
CREATE OR REPLACE VIEW public.v_marketing_audience_ext AS
SELECT lower(s.email)                            AS email,
       MAX(s.paid_at)                            AS last_paid_at,
       bool_or(COALESCE(s.has_video_addon, false)) AS has_video_addon
FROM public.songs s
WHERE s.paid = true
  AND s.email IS NOT NULL
  AND s.platform = 'es'
  AND lower(s.email) NOT IN (SELECT email FROM public.email_unsubscribes)
GROUP BY lower(s.email);

-- ---------------------------------------------------------------------------
-- 2 + 4 — segment-aware, A/B-aware recipient snapshot
-- ---------------------------------------------------------------------------
-- Snapshots the chosen SEGMENT of the audience into email_recipients and, when
-- the email has a subject_b, deterministically splits recipients 50/50 into
-- variant 'a'/'b' by a hash of the email (stable, no randomness).
-- Replaces the old 1-arg version (dropped below to avoid an ambiguous overload;
-- the new signature's DEFAULT 'all' keeps any 1-arg call working unchanged).
DROP FUNCTION IF EXISTS public.enqueue_marketing_recipients(UUID);
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
          WHEN 'recent'       THEN a.last_paid_at >= now() - interval '90 days'
          WHEN 'winback'      THEN a.last_paid_at <  now() - interval '90 days'
          WHEN 'video_buyers' THEN a.has_video_addon = true
          WHEN 'no_video'     THEN a.has_video_addon = false
          ELSE true                                 -- 'all' (default)
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
    'all',          count(*),
    'recent',       count(*) FILTER (WHERE last_paid_at >= now() - interval '90 days'),
    'winback',      count(*) FILTER (WHERE last_paid_at <  now() - interval '90 days'),
    'video_buyers', count(*) FILTER (WHERE has_video_addon),
    'no_video',     count(*) FILTER (WHERE NOT has_video_addon)
  )
  FROM public.v_marketing_audience_ext;
$$;

-- ---------------------------------------------------------------------------
-- 1 — attributed revenue per email campaign, deduped per Stripe session.
-- A 2-pack stamps the FULL total on BOTH song rows, so revenue must be counted
-- once per stripe_session_id (MAX(amount_paid)). Keyed by the campaign_key we
-- stamp on the CTA links (utm_campaign starts with 'em_').
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_campaign_revenue()
RETURNS TABLE(campaign_key TEXT, orders BIGINT, revenue NUMERIC)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH ord AS (
    SELECT stripe_session_id,
           MAX(utm_campaign) AS campaign_key,
           MAX(amount_paid)  AS amt
    FROM public.songs
    WHERE paid = true
      AND utm_campaign IS NOT NULL
      AND starts_with(utm_campaign, 'em_')
      AND stripe_session_id IS NOT NULL
    GROUP BY stripe_session_id)
  SELECT campaign_key, count(*)::bigint AS orders, COALESCE(sum(amt), 0) AS revenue
  FROM ord
  GROUP BY campaign_key;
$$;
