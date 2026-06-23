-- CRON_SETUP.sql — run ONCE in the Supabase SQL editor at deploy time.
-- Not a migration (won't auto-apply) so it can't surprise production.
--
-- Registers the every-minute pg_cron job that drives send-scheduled-gift-sms,
-- the engine that makes the $5 gift text land at the buyer-chosen time. This is
-- the SAME pattern as the existing per-minute jobs (send-song-ready-sms,
-- auto-send-paid-email, notify-new-sales) — confirm against one of those with
--   SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
-- and mirror exactly how THOSE pass the function URL + auth header on this
-- project (vault secret name, header style). Adjust below if they differ.
--
-- Requires the pg_cron + pg_net extensions (already enabled for the other jobs).
--
-- NOTE: this project's per-minute jobs (send-song-ready-sms, notify-new-sales)
-- call their function with NO Authorization header — they rely on the function
-- being verify_jwt=false (pinned in config.toml). send-scheduled-gift-sms is also
-- verify_jwt=false, so we use the same headerless pattern.
--
-- Registered live on 2026-06-22 (cron job 'send-scheduled-gift-sms', jobid 25).

select cron.schedule(
  'send-scheduled-gift-sms',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/send-scheduled-gift-sms',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- To remove later:  select cron.unschedule('send-scheduled-gift-sms');
