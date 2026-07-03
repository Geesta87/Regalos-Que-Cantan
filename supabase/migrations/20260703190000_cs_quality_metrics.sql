-- Step 5: measurement — per-draft tagging so we can see quality BY question type.
--
-- `category`  : the question type cs-agent classified the incoming message as
--               (price, locate_song, change_request, …). Set on the AI draft.
-- `was_edited`: whether the owner changed the draft before approving it. Set by
--               sms-admin on approve. Together with status/needs_human this lets
--               the dashboard compute, per category: sent-as-is / edited /
--               discarded / escalated — the numbers that gate auto-send.

ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS category   text,
  ADD COLUMN IF NOT EXISTS was_edited boolean;

-- Fast filtering of AI drafts by category/time for the dashboard aggregates.
CREATE INDEX IF NOT EXISTS sms_messages_ai_category_idx
  ON sms_messages (created_at)
  WHERE ai_generated = true;

-- ── Dashboard aggregates (heavy lifting stays in SQL) ──────────────────────
-- Outcome model for an AI draft: approved-as-is / approved-edited / discarded /
-- (still) pending, plus an escalated flag (needs_human, can overlap).

CREATE OR REPLACE FUNCTION cs_metrics_overview(days int DEFAULT 30)
RETURNS json LANGUAGE sql STABLE AS $$
  WITH d AS (
    SELECT status,
           coalesce(was_edited, false)  AS edited,
           coalesce(needs_human, false) AS human
    FROM sms_messages
    WHERE ai_generated = true
      AND created_at > now() - (days || ' days')::interval
  )
  SELECT json_build_object(
    'total',      (SELECT count(*) FROM d),
    'pending',    (SELECT count(*) FROM d WHERE status = 'draft'),
    'as_is',      (SELECT count(*) FROM d WHERE status NOT IN ('draft','discarded') AND NOT edited),
    'edited',     (SELECT count(*) FROM d WHERE status NOT IN ('draft','discarded') AND edited),
    'discarded',  (SELECT count(*) FROM d WHERE status = 'discarded'),
    'escalated',  (SELECT count(*) FROM d WHERE human)
  );
$$;

CREATE OR REPLACE FUNCTION cs_metrics_by_category(days int DEFAULT 30)
RETURNS TABLE(category text, total bigint, as_is bigint, edited bigint, discarded bigint, escalated bigint)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(category, '(sin clasificar)') AS category,
         count(*) AS total,
         count(*) FILTER (WHERE status NOT IN ('draft','discarded') AND NOT coalesce(was_edited,false)) AS as_is,
         count(*) FILTER (WHERE status NOT IN ('draft','discarded') AND coalesce(was_edited,false))     AS edited,
         count(*) FILTER (WHERE status = 'discarded')                                                   AS discarded,
         count(*) FILTER (WHERE coalesce(needs_human,false))                                            AS escalated
  FROM sms_messages
  WHERE ai_generated = true
    AND created_at > now() - (days || ' days')::interval
  GROUP BY 1
  ORDER BY total DESC;
$$;

CREATE OR REPLACE FUNCTION cs_metrics_trend(weeks int DEFAULT 8)
RETURNS TABLE(week date, resolved bigint, as_is bigint)
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('week', created_at)::date AS week,
         count(*) FILTER (WHERE status <> 'draft') AS resolved,
         count(*) FILTER (WHERE status NOT IN ('draft','discarded') AND NOT coalesce(was_edited,false)) AS as_is
  FROM sms_messages
  WHERE ai_generated = true
    AND created_at > now() - (weeks || ' weeks')::interval
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION cs_metrics_volume(days int DEFAULT 30)
RETURNS json LANGUAGE sql STABLE AS $$
  SELECT json_build_object(
    'inbound',       (SELECT count(*) FROM sms_messages WHERE direction='inbound' AND created_at > now()-(days||' days')::interval),
    'conversations', (SELECT count(DISTINCT conversation_id) FROM sms_messages WHERE direction='inbound' AND created_at > now()-(days||' days')::interval),
    'drafts',        (SELECT count(*) FROM sms_messages WHERE ai_generated=true AND created_at > now()-(days||' days')::interval)
  );
$$;
