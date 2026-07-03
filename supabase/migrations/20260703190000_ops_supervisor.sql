-- Supervisor alarm for the AI staff (health-check upgrade + morning digest).
--
-- 1) ops_alert_state: throttle table so a persistent condition (e.g. "42 SMS
--    drafts older than 24h") alerts once per window instead of every 10-minute
--    health-check run.
-- 2) get_agent_cron_status(): SECURITY DEFINER window into cron.job /
--    cron.job_run_details for the agent jobs only, so the health-check edge
--    function (PostgREST can't see the cron schema) can detect a disabled or
--    failing agent cron. Locked to service role.

create table if not exists public.ops_alert_state (
  key text primary key,
  last_alerted_at timestamptz not null default now()
);

alter table public.ops_alert_state enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) uses it.

create or replace function public.get_agent_cron_status()
returns table (
  jobname text,
  schedule text,
  active boolean,
  last_status text,
  last_run timestamptz
)
language sql
security definer
set search_path = public, cron
as $$
  select
    j.jobname::text,
    j.schedule::text,
    j.active,
    (select d.status::text from cron.job_run_details d
      where d.jobid = j.jobid order by d.start_time desc limit 1),
    (select d.start_time from cron.job_run_details d
      where d.jobid = j.jobid order by d.start_time desc limit 1)
  from cron.job j
  where j.jobname = any (array[
    'media-buyer-daily',
    'chief-of-staff-daily',
    'creative-studio-daily',
    'email-marketer-weekly',
    'email-marketer-send',
    'competitor-scan',
    'affiliate-recruiter',
    'cos-weekly-memo',
    'poll-creative-queue',
    'cos-morning-digest'
  ]);
$$;

revoke all on function public.get_agent_cron_status() from public;
revoke all on function public.get_agent_cron_status() from anon;
revoke all on function public.get_agent_cron_status() from authenticated;
