-- ───────────────────────────────────────────────────────────────────────────
-- phone_added_at: when did a phone number get ATTACHED to this song?
--
-- WHY: ~1-4 paid orders per day never get the automated song-ready WhatsApp/SMS
-- because their phone number only reaches the songs row AFTER purchase, via a
-- side channel (Animado photo-upload form, staff linking a number in the SMS
-- inbox). send-song-ready-whatsapp only looked at orders with paid_at in the
-- last 24h, so by the time the phone existed the window had passed — the order
-- then sat in the admin "Pending to Send" tab forever (verified 2026-08-05:
-- all 60 stuck purchases of the prior 30 days had no sms_consent_at, i.e. the
-- phone never came through the consent-stamping checkout/comparison RPC).
--
-- A trigger (not per-writer stamping) so EVERY current and future writer is
-- covered — the deployed animado-photo is ahead of the repo (cast-locking) and
-- must not be redeployed from this tree, so it could not be edited directly.
--
-- send-song-ready-whatsapp now treats "phone_added_at within 24h" the same as
-- "paid_at within 24h". Pre-existing rows keep phone_added_at NULL, so this can
-- never blast the historical backlog.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.songs add column if not exists phone_added_at timestamptz;

create or replace function public.stamp_phone_added_at()
returns trigger
language plpgsql
as $$
begin
  if (old.whatsapp_phone is null or old.whatsapp_phone = '')
     and new.whatsapp_phone is not null and new.whatsapp_phone <> '' then
    new.phone_added_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_phone_added_at on public.songs;
create trigger trg_stamp_phone_added_at
  before update of whatsapp_phone on public.songs
  for each row
  when (old.whatsapp_phone is distinct from new.whatsapp_phone)
  execute function public.stamp_phone_added_at();
