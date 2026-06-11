-- Transactional song-ready SMS auto-send (send-song-ready-sms) — supporting schema.
--
-- Applied directly to production on 2026-06-10/11; recorded here so the repo
-- matches what is live. All statements are idempotent (IF NOT EXISTS / OR
-- REPLACE) so re-running on a fresh database is safe.

-- Columns on public.songs that drive the auto-send.
--   sms_consent_at   : set when the customer saves their phone under the live
--                      SMS disclosure at checkout = the consent record.
--   song_sms_sent_at : set after the song-ready text goes out = dedupe guard.
--   short_code       : code behind the branded /s/<code> link in the text.
alter table public.songs add column if not exists sms_consent_at   timestamptz;
alter table public.songs add column if not exists song_sms_sent_at timestamptz;
alter table public.songs add column if not exists short_code       text;

-- Stamp SMS consent the moment a customer saves their phone at checkout.
-- coalesce() keeps the FIRST consent timestamp if the phone is re-saved.
create or replace function public.save_whatsapp_phone(song_id uuid, phone text)
  returns void
  language plpgsql
  security definer
as $function$
begin
  update public.songs
     set whatsapp_phone = phone,
         sms_consent_at = coalesce(sms_consent_at, now())
   where id = song_id;
end;
$function$;

-- Partial index for the per-minute auto-send query: only consented, un-texted
-- rows are ever scanned, so the cron stays cheap as songs grows.
create index if not exists idx_songs_sms_pending
  on public.songs (paid_at)
  where sms_consent_at is not null and song_sms_sent_at is null;

-- Unique short code for the branded /s/<code> SMS link.
create unique index if not exists idx_songs_short_code
  on public.songs (short_code) where short_code is not null;

-- ---------------------------------------------------------------------------
-- Operational setup applied outside this migration (documented for parity, not
-- executed here because it is environment config, not schema):
--   * pg_cron job 'send-song-ready-sms' runs every minute and calls the edge
--     function via net.http_post (cron.schedule is idempotent by job name).
--   * Edge function secret TWILIO_MESSAGING_SERVICE_SID =
--     MGd63058f3e4536ada8aeff95f5092bded (the Regalos messaging service /
--     818-306-5193), so texts attach to the approved A2P campaign.
-- ---------------------------------------------------------------------------
