-- 20260625030000_email_marketer.sql
-- Weekly Email Marketer agent (added 2026-06-25).
--
-- The agent researches each week's holidays / key dates / "just because"
-- angles and drafts 2-3 designed promotional emails. The owner reviews them in
-- the Creative Studio "Emails" section and approves; on approval the audience is
-- snapshotted and the email is sent in throttled batches (per-recipient, with
-- one-click unsubscribe + suppression honored — see _shared/unsubscribe.ts).
--
-- RLS ON, service-role only.

CREATE TABLE IF NOT EXISTS public.email_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of          DATE NOT NULL,
  reason           TEXT,              -- the occasion / hook the agent chose
  subject          TEXT NOT NULL,
  preview_text     TEXT,
  body_html        TEXT NOT NULL,
  cta_text         TEXT,
  cta_url          TEXT NOT NULL DEFAULT 'https://regalosquecantan.com',
  status           TEXT NOT NULL DEFAULT 'pending_approval',
                   -- pending_approval | approved | sending | sent | rejected | failed
  recipients_total INTEGER NOT NULL DEFAULT 0,
  recipients_sent  INTEGER NOT NULL DEFAULT 0,
  approved_at      TIMESTAMPTZ,
  sending_started_at TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON public.email_queue (status, created_at DESC);
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;

-- Per-recipient send ledger (idempotent, resumable across cron runs).
CREATE TABLE IF NOT EXISTS public.email_recipients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_queue_id UUID NOT NULL REFERENCES public.email_queue(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  sent_at        TIMESTAMPTZ,
  error          TEXT,
  UNIQUE (email_queue_id, email)
);
CREATE INDEX IF NOT EXISTS idx_email_recipients_pending
  ON public.email_recipients (email_queue_id) WHERE status = 'pending';
ALTER TABLE public.email_recipients ENABLE ROW LEVEL SECURITY;

-- Marketing audience: distinct paid RQC customers, minus the suppression list.
CREATE OR REPLACE VIEW public.v_marketing_audience AS
SELECT DISTINCT lower(s.email) AS email
FROM public.songs s
WHERE s.paid = true
  AND s.email IS NOT NULL
  AND s.platform = 'es'
  AND lower(s.email) NOT IN (SELECT email FROM public.email_unsubscribes);

-- Snapshot the audience into email_recipients for a queued email. Returns the
-- count enqueued. SECURITY DEFINER so it runs server-side in one statement.
CREATE OR REPLACE FUNCTION public.enqueue_marketing_recipients(qid UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.email_recipients (email_queue_id, email)
  SELECT qid, email FROM public.v_marketing_audience
  ON CONFLICT (email_queue_id, email) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- Operational (applied out-of-band, same convention as the other crons):
--   * pg_cron 'email-marketer-weekly' — Monday morning, drafts the week's emails.
--       '0 15 * * 1'  (Mon 15:00 UTC ≈ 8am Pacific)
--   * pg_cron 'email-marketer-send'   — every minute, sends the next batch for
--       any email in 'sending'.  '* * * * *'
-- ---------------------------------------------------------------------------
