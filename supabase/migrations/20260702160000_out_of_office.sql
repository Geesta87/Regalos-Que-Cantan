-- Out-of-office auto-reply for the SMS/WhatsApp inbox.
--
-- When the owner leaves the office they flip a toggle in the "💬 Messages" tab.
-- While it's on, the inbound webhooks (twilio-sms-webhook / whatsapp-webhook)
-- auto-reply ONCE to each customer with a friendly "we're away, we'll answer
-- when we're back" message — so nobody is left on read overnight.
--
-- State lives on the existing cs_agent_settings singleton (id = 1), next to the
-- AI bot master switch. Throttling lives per-conversation so a customer who
-- sends 5 texts in a row only gets ONE auto-reply.

-- Toggle + editable message (customer-facing, Spanish).
ALTER TABLE cs_agent_settings
  ADD COLUMN IF NOT EXISTS out_of_office         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS out_of_office_message text;

-- When we last auto-replied on this conversation, so we don't spam. The webhook
-- only auto-replies again once this is older than the throttle window.
ALTER TABLE sms_conversations
  ADD COLUMN IF NOT EXISTS oo_auto_replied_at timestamptz;
