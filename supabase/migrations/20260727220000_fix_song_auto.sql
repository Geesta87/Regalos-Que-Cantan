-- ───────────────────────────────────────────────────────────────────────────
-- Fix Song AUTO-WORKER (Phase 1) — state machine fields + kill switch
--
-- The fix-song-auto edge function (pg_cron) walks song_fix_requests through an
-- automated pipeline: link song → understand (FixSpec) → plan → generate →
-- validate takes → stage for human release. The HUMAN release gate is untouched:
-- automation only ever STAGES (status='awaiting_approval'); releasing to the
-- customer's live song remains a manual owner/Ivan action in song-fix-queue.
--
-- auto_status values (worker-internal; request.status stays 'pending' until staged):
--   linking | understanding | planning | generating | polling | validating
--   | staged | needs_human | failed | disabled
-- needs_human = the worker refuses to guess (ambiguous request, no confident
-- song match, no clean take after max rounds) and leaves the card for a person.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.song_fix_requests
  add column if not exists auto_status      text,
  add column if not exists fix_spec         jsonb,   -- {changes:[{type,before,after}], verify_phrases:[], confidence, open_questions:[], summary}
  add column if not exists auto_plan        jsonb,   -- {approvedLyrics, changes, verifyPhrases, mode:'section'|'full'} from fix-song-section plan
  add column if not exists auto_task_id     text,    -- current Kie task being polled
  add column if not exists auto_round       int not null default 0,
  add column if not exists auto_takes       jsonb,   -- per-take diagnostics: [{url, verdict, reason, trimAtS}]
  add column if not exists auto_error       text,    -- human-readable reason for needs_human/failed
  add column if not exists auto_updated_at  timestamptz;

-- Worker scan: open auto work, oldest first.
create index if not exists idx_song_fix_requests_auto
  on public.song_fix_requests (auto_status, auto_updated_at)
  where auto_status is not null;

-- Kill switch + knobs. Single row, service-role only (same pattern as
-- creative_posting_state). enabled=false ⇒ the cron worker exits immediately.
create table if not exists public.fix_auto_state (
  id             int primary key default 1 check (id = 1),
  enabled        boolean not null default false,
  max_rounds     int not null default 3,     -- Kie generations per request
  daily_cap      int not null default 40,    -- max Kie generations per day (budget guard)
  notify_numbers text,                       -- comma-separated WhatsApp E.164s to ping when a fix is staged (falls back to ALERT_WHATSAPP_TO secret)
  updated_at     timestamptz not null default now()
);
insert into public.fix_auto_state (id, enabled) values (1, false)
  on conflict (id) do nothing;

alter table public.fix_auto_state enable row level security;
