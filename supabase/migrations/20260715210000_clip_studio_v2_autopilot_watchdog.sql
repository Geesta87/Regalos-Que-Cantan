-- Clip Studio v2 (additive only): auto-pilot, stuck-render recovery, storage purge
-- Applied to production 2026-07-15 via MCP execute_sql.
alter table clip_projects
  add column if not exists auto_pilot boolean not null default false,
  add column if not exists auto_pilot_state text,
  add column if not exists source_purged_at timestamptz;

alter table clips
  add column if not exists attempts int not null default 0,
  add column if not exists dispatched_at timestamptz,
  add column if not exists render_job jsonb;

-- Existing rows: treat creation time as dispatch time so the watchdog can
-- see pre-v2 stalls (the 2026-07-14 stuck teasers).
update clips set dispatched_at = created_at where dispatched_at is null;
