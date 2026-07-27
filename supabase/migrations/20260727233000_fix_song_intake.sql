-- Fix Song INTAKE QUESTIONNAIRE (owner spec 2026-07-27) — future-only automation.
--
-- A request only enters the AUTO pipeline when a human completed the guided
-- intake (song tied via email/phone, paid confirmed, song(s) picked from a list,
-- customer request confirmed) AND it was created after fix_auto_state.active_since.
-- The pre-existing backlog stays 100% manual.

alter table public.song_fix_requests
  add column if not exists intake          jsonb,   -- {email, phone, paid, confirmed_request, sibling_group}
  add column if not exists intake_complete boolean not null default false;

-- Worker cutoff: set when automation is switched on; only requests created
-- AFTER this moment are eligible (pattern: CS_TRANSLATE_SINCE).
alter table public.fix_auto_state
  add column if not exists active_since timestamptz;
