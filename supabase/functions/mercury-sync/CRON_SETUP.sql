-- CRON_SETUP.sql — run ONCE in the Supabase SQL editor at deploy time.
-- Not a migration (won't auto-apply) so it can't surprise production.
--
-- Registers the nightly pg_cron tick for mercury-sync, which pulls the
-- Mercury bank account's transactions into mercury_transactions (Finance
-- tab / P&L). 10:15 UTC = 03:15 America/Los_Angeles during PDT — after the
-- banking day fully settles, before the morning briefings run.
--
-- The nightly hit also keeps the Mercury API token alive (Mercury deletes
-- tokens unused for 45 days). The function is verify_jwt=false (pinned in
-- config.toml), so the call is headerless like the other cron jobs here.
--
-- Verify with:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'mercury-sync-nightly';

select cron.schedule(
  'mercury-sync-nightly',
  '15 10 * * *',
  $$
  select net.http_post(
    url     := 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/mercury-sync',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"source":"cron"}'::jsonb
  );
  $$
);

-- To remove later:  select cron.unschedule('mercury-sync-nightly');
