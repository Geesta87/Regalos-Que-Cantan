-- CRON_SETUP.sql — run ONCE in the Supabase SQL editor at deploy time.
-- Not a migration (won't auto-apply) so it can't surprise production.
--
-- Registers the every-2-minutes pg_cron tick for poll-cloned-voice-songs,
-- the sweeper that finishes Clone Mi Voz songs server-side (rehost + status
-- flip + delivery email) after the customer closes the tab. Without it a
-- paid song only completes while the browser keeps polling — see the
-- 2026-08-27 audit / lost-audio incident notes in the function header.
--
-- The function is verify_jwt=false (pinned in config.toml), so the call is
-- headerless like the other cron jobs here.
--
-- Verify with:
--   SELECT jobid, jobname, schedule, active FROM cron.job
--   WHERE jobname = 'poll-cloned-voice-songs-tick';

select cron.schedule(
  'poll-cloned-voice-songs-tick',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/poll-cloned-voice-songs',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"source":"pg_cron"}'::jsonb
  );
  $$
);

-- To remove later:  select cron.unschedule('poll-cloned-voice-songs-tick');
