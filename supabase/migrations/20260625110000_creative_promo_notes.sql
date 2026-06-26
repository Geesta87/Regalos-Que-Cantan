-- 20260625110000_creative_promo_notes.sql
-- Creative Studio "Business Brain" — live promo box (added 2026-06-25).
--
-- The accurate offer catalog + selling points live in code (_shared/brand-brief.ts)
-- and are injected into every creative generator. This column holds the OWNER's
-- seasonal/weekly push ("this week promote Día del Padre + the video add-on"),
-- editable live from the Creative Studio tab. brandContext() layers it on top of
-- the code-owned brief so it overrides the default offer rotation when set.
ALTER TABLE public.creative_studio_config
  ADD COLUMN IF NOT EXISTS promo_notes TEXT NOT NULL DEFAULT '';
