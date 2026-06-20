-- Async "your extra is ready" notification de-dupe.
-- When a paid upsell (the $9.99 slideshow video or the karaoke sing-along video)
-- finishes — often minutes to DAYS after the song — notify-upsell-ready emails +
-- SMSes the customer one /success link with everything they bought. This timestamp
-- is the atomic de-dupe claim: if the video and karaoke finish close together the
-- customer gets ONE message, not two. Stays NULL until the first upsell completes.
alter table public.songs add column if not exists upsell_ready_notified_at timestamptz;
