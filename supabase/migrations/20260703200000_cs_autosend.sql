-- #2 graduated auto-send + #4 auto_sent tagging.
--
-- Auto-send is OFF by default and gated two ways: a master switch
-- (auto_send_enabled) AND a per-category allowlist (auto_categories). A draft
-- only sends itself when BOTH say yes for its category, it wasn't flagged for a
-- human, and the safety critic passed. The owner turns categories on from the
-- CS Insights dashboard once the numbers earn it. Money/complaints/changes can
-- never be added (enforced in code).

ALTER TABLE cs_agent_settings
  ADD COLUMN IF NOT EXISTS auto_send_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_categories   text[]  NOT NULL DEFAULT '{}';

-- Marks a message the bot sent on its own (no owner approval) so the inbox and
-- any digest can flag it.
ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS auto_sent boolean;
