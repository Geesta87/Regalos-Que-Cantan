-- CS agent: approval-gated side actions on drafts.
--
-- The cs-agent may now PROPOSE one side action on a draft (v1: re-send the
-- customer's paid song link by email via recover-song). Nothing executes at
-- draft time — sms-admin runs the action only when the owner APPROVES the
-- draft, keeping the "owner approves every side effect" safety model intact.
--
-- Shape: { "type": "resend_email", "email": "customer@example.com" }

alter table public.sms_messages
  add column if not exists proposed_action jsonb;
