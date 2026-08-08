-- Clona Mi Voz: Suno Voice (real cloning) enrollment state — 2026-08-08.
--
-- The pilot proved Kie's Suno Voice APIs end-to-end (see memory
-- project_suno_voice_clone_pilot). Enrollment lives on voice_samples:
-- one sample = at most one enrollment attempt chain. The Kie
-- voice-creation TASK ID doubles as the personaId for /api/v1/generate
-- (Kie's record-info voiceId field never populates — their bug).
--
-- voice_status lifecycle:
--   none            → no enrollment attempted (default, all legacy rows)
--   phrase_pending  → /voice/validate submitted, waiting for phrase
--   phrase_ready    → phrase available, customer must record it (~15 min TTL)
--   verifying       → /voice/generate submitted with the phrase recording
--   ready           → voice created + check-voice isAvailable=true
--   failed          → terminal failure (customer can restart → new task)

alter table public.voice_samples
  add column if not exists kie_voice_task_id text,
  add column if not exists voice_phrase text,
  add column if not exists voice_status text not null default 'none',
  add column if not exists voice_ready_at timestamptz,
  add column if not exists verify_sample_id uuid references public.voice_samples(id);

create index if not exists idx_voice_samples_voice_task
  on public.voice_samples (kie_voice_task_id)
  where kie_voice_task_id is not null;

-- Which enrolled voice (Kie voice task id) a song was generated with.
-- NULL = legacy upload-cover engine.
alter table public.cloned_voice_songs
  add column if not exists voice_task_id text;
