-- Upsell email drip — post-purchase two-touch offer to song-only buyers.
--
-- Targets customers who bought a song (platform 'es') but no add-on, and nudges
-- them to turn it into a photo-video / animado / lyric video / instrumental / SMS
-- gift. Every CTA deep-links to THEIR /success page (song_ids + session_id), so
-- the existing saved-card one-tap upsell charges against the exact song.
--
-- Two touches, both at-most-once (stamp-first, like video_photo_reminder):
--   • upsell_email_1_sent_at  — sent ~30 min after purchase.
--   • upsell_email_2_sent_at  — "última oportunidad", ~3 h after email 1, and
--     only if they still haven't added anything.
--
-- This migration is SCHEMA-ONLY. It adds nothing to pg_cron, so applying it
-- sends zero email. Scheduling (activation) is a separate, deliberate step:
--
--   select cron.schedule(
--     'upsell-email-drip',
--     '*/15 * * * *',
--     $$ select net.http_post(
--          url:='https://yzbvajungshqcpusfiia.supabase.co/functions/v1/upsell-email-drip',
--          headers:='{"Content-Type":"application/json"}'::jsonb,
--          body:='{}'::jsonb
--        ); $$
--   );

alter table public.songs
  add column if not exists upsell_email_1_sent_at timestamptz,
  add column if not exists upsell_email_2_sent_at timestamptz;

-- Candidate scan for email 1: recently paid, not yet touched.
create index if not exists idx_songs_upsell_drip1
  on public.songs (paid_at)
  where paid = true and upsell_email_1_sent_at is null;

-- Candidate scan for email 2: touched once, awaiting the last-chance follow-up.
create index if not exists idx_songs_upsell_drip2
  on public.songs (upsell_email_1_sent_at)
  where paid = true and upsell_email_1_sent_at is not null and upsell_email_2_sent_at is null;
