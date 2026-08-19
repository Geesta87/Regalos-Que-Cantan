-- CRON_SETUP.sql — run ONCE in the Supabase SQL editor at deploy time.
-- Not a migration (won't auto-apply) so it can't surprise production.
--
-- Registers the every-2-minutes pg_cron tick that drives fix-song-auto, the
-- worker that turns chat-intake fix requests into STAGED candidates (human
-- release gate unchanged). The function is verify_jwt=false (pinned in
-- config.toml), so the call is headerless like the other cron jobs here.
--
-- ALREADY REGISTERED LIVE as jobid 48 ('fix-song-auto-tick', 2026-08-09). This
-- file exists so a database restore or project rebuild can reconstruct the job
-- — before it, the schedule lived ONLY in the production database. Verify with:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'fix-song-auto-tick';
--
-- The worker also honors the fix_auto_state.enabled kill switch (toggleable
-- from the Fix Song tab since 2026-08-10), so an active cron with the switch
-- off does nothing.

select cron.schedule(
  'fix-song-auto-tick',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/fix-song-auto',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"action":"tick"}'::jsonb
  );
  $$
);

-- To remove later:  select cron.unschedule('fix-song-auto-tick');
