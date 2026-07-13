-- ───────────────────────────────────────────────────────────────────────────
-- Song Fix Requests — the "pending customer songs to be fixed" queue
--
-- Backs the admin dashboard "Fix Song" tab queue (song-fix-queue edge function)
-- and is fed by the CS AI agent: when a customer asks (over SMS/WhatsApp) for a
-- change to a song we already delivered, the agent proposes a fix request on its
-- draft. The owner approving that draft in the Messages inbox inserts a row here
-- (see sms-admin approve-draft), carrying the customer's own words + a link back
-- to the conversation.
--
-- WORKFLOW (status transitions):
--   pending            → just queued, nobody working it yet
--   in_progress        → the owner or an assistant claimed it and is fixing it
--   awaiting_approval  → the fix is done and a CANDIDATE audio is STAGED (hosted
--                        but NOT swapped into the customer's live song); waits
--                        for the OWNER to confirm it is correct
--   done               → the owner released it: the candidate is now the live song
--   rejected           → the owner (or team) decided not to change the song
--
-- The candidate audio lives at candidate_audio_url (a stable, hosted MP3 in the
-- `audio` bucket). Nothing is ever swapped into public.songs until the owner
-- releases the request — that release is the second, owner-only approval gate.
--
-- RLS is ENABLED with NO policies, exactly like sms_conversations / sms_messages
-- and public.songs: neither the anon key nor a logged-in user can read this from
-- the browser. All access goes through the song-fix-queue / sms-admin edge
-- functions using the service-role key. The admin/assistant gate (and the
-- owner-only release check) lives in those functions, not in the database.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.song_fix_requests (
  id                 uuid primary key default gen_random_uuid(),

  -- Which song to fix. Nullable because the AI may not always resolve the exact
  -- song from the conversation — the person working the queue links it then.
  song_id            uuid references public.songs(id) on delete set null,

  -- Where the request came from, so the queue can link "open the conversation".
  conversation_id    uuid references public.sms_conversations(id) on delete set null,

  -- The customer's request, in their own words (or a faithful summary of it).
  customer_request   text not null,

  -- Snapshot of who/what this is about, so the queue reads well without joins:
  -- { customer_name, phone, recipient_name, source ('cs-agent'|'owner'|...),
  --   source_message } — best-effort, never load-bearing.
  context            jsonb,

  status             text not null default 'pending'
                       check (status in ('pending','in_progress','awaiting_approval','done','rejected')),

  -- The STAGED fix (set when status = awaiting_approval). A hosted MP3 URL in the
  -- `audio` bucket that is NOT live until the owner releases it, plus the lyrics /
  -- summary / metadata the release needs to swap it in.
  candidate_audio_url text,
  candidate_lyrics    text,
  candidate_summary   text,
  candidate_meta      jsonb,               -- { mode:'section'|'full', corrections:[...], change_marks:[...] }

  -- Audit trail — who did what.
  created_by         text,                 -- 'cs-agent' | owner/assistant email | 'owner'
  worked_by          text,                 -- who staged the fix
  approved_by        text,                 -- who released (owner) or rejected it
  reject_reason      text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  staged_at          timestamptz,          -- when a candidate was staged
  resolved_at        timestamptz           -- when released (done) or rejected
);

-- Queue list: open items first, newest first within a status.
create index if not exists idx_song_fix_requests_status
  on public.song_fix_requests (status, created_at desc);

-- Find existing open requests for a song/conversation (dedupe on insert).
create index if not exists idx_song_fix_requests_song
  on public.song_fix_requests (song_id);
create index if not exists idx_song_fix_requests_conversation
  on public.song_fix_requests (conversation_id);

-- Keep updated_at fresh on every change.
create or replace function public.touch_song_fix_requests_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_song_fix_requests_updated_at on public.song_fix_requests;
create trigger trg_song_fix_requests_updated_at
  before update on public.song_fix_requests
  for each row execute function public.touch_song_fix_requests_updated_at();

-- Lock the table to service-role only (RLS on, no policies).
alter table public.song_fix_requests enable row level security;
