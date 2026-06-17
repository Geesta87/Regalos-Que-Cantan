-- 20260616_fathers_day_audience_view.sql
-- Audience for the Father's Day 2026 campaign (send-fathers-day-campaign).
-- Base: every distinct email that has ever created a song (the engaged list,
-- same source the Mother's Day campaign used).
-- Excludes: (1) anyone on the email_unsubscribes suppression list, and
--           (2) anyone who already bought a Father's Day song in the last 14
--               days (occasion dia_padre / dia-del-padre, paid) — no point
--               pestering someone who already gifted dad a song.
CREATE OR REPLACE VIEW v_fathers_day_audience AS
SELECT DISTINCT lower(s.email) AS email
FROM songs s
WHERE s.email IS NOT NULL
  AND s.email <> ''
  AND lower(s.email) NOT IN (SELECT email FROM email_unsubscribes)
  AND lower(s.email) NOT IN (
    SELECT lower(email)
    FROM songs
    WHERE paid = true
      AND occasion IN ('dia_padre', 'dia-del-padre')
      AND created_at > now() - interval '14 days'
      AND email IS NOT NULL
  );
