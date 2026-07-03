-- Image attachments for the SMS/WhatsApp inbox.
--
-- The owner can paste/drag/attach a screenshot into a chat and it goes out as
-- media (MMS on SMS, an image message on WhatsApp). The file lives in a PRIVATE
-- storage bucket; we only ever hand out short-lived signed URLs — to Twilio at
-- send time, and to the admin thread on each load.
--
-- We store the storage PATH (not a URL) so the URL can always be re-signed and
-- never goes stale.

ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_type text;

-- Private bucket for customer-service media. Service-role (sms-admin) is the
-- only writer/reader; nothing is publicly listable. 5MB cap, images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cs-media', 'cs-media', false, 5242880,
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;
