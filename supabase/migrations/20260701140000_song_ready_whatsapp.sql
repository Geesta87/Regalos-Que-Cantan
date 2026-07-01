-- ───────────────────────────────────────────────────────────────────────────
-- WhatsApp song-ready confirmation (sent ALONGSIDE the existing SMS one)
--
-- • song_wa_sent_at — dedup flag for the WhatsApp confirmation, SEPARATE from
--   song_sms_sent_at (the SMS dedup) so a customer gets each channel once.
-- • song_wa_autosend — master on/off toggle on cs_agent_settings (defaults OFF).
--
-- The sender (send-song-ready-whatsapp) only targets customers PAID in the last
-- 24h (so enabling it never blasts the historical backlog — old buyers already
-- have their song). New buyers going forward get the WhatsApp confirmation
-- within a couple minutes, in addition to the SMS.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.songs
  add column if not exists song_wa_sent_at timestamptz;

alter table public.cs_agent_settings
  add column if not exists song_wa_autosend boolean not null default false;
