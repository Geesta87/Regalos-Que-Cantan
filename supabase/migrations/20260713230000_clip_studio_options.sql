-- Clip Studio Phase 3: per-clip render options.
-- { framing: 'left'|'center'|'right', remove_silences: bool, zoom: bool, hook_title: bool }
alter table public.clips add column if not exists options jsonb not null default '{}';
