-- Pin important SMS/WhatsApp conversations to the top of the admin inbox.
-- NULL = not pinned; a timestamp = when the owner pinned it.
-- Used by sms-admin (action: 'set-pinned') and SmsInboxTab.jsx sorting.
alter table public.sms_conversations
  add column if not exists pinned_at timestamptz;
