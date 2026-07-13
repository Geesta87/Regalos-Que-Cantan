-- Clip Studio Phase 2: AI clip suggestions.
-- Claude reads the transcript and proposes the best 3-5 moments; they persist
-- here so the panel survives reloads. Shape:
--   { generated_at, model, suggestions: [{ start_sec, end_sec, title, reason, score }] }
alter table public.clip_projects add column if not exists ai_suggestions jsonb;
