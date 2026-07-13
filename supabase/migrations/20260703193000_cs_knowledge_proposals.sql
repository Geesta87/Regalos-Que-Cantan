-- Step 4: self-distilling knowledge.
--
-- cs-distill-knowledge (weekly cron) reads recent corrections/discards, and has
-- the LLM PROPOSE concise FAQ/knowledge additions that would prevent them. The
-- proposals land here as `pending`. The owner approves/rejects them in Bot
-- Training; approving appends the text to the editable knowledge doc. This takes
-- the owner OUT of the authoring seat — they curate instead of writing.

CREATE TABLE IF NOT EXISTS cs_knowledge_proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL DEFAULT 'faq',        -- faq | fact | rule
  title       text NOT NULL,                      -- short label for the owner
  proposal    text NOT NULL,                      -- the text to add to knowledge
  rationale   text,                               -- why (which gaps prompted it)
  status      text NOT NULL DEFAULT 'pending',    -- pending | approved | rejected
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS cs_knowledge_proposals_status_idx
  ON cs_knowledge_proposals (status, created_at DESC);
