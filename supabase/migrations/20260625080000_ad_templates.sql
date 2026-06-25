-- 20260625080000_ad_templates.sql
-- Ad Templates (added 2026-06-25). A library of proven ad-style templates the
-- owner picks from; "Generar 5" renders 5 variations in that style via
-- gpt-image-1 into the Ads queue. RLS ON, service-role only (admin reaches it
-- via ad-templates fn).

CREATE TABLE IF NOT EXISTS public.ad_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  emoji         TEXT,
  description   TEXT,
  style_prompt  TEXT NOT NULL,
  copy_guidance TEXT,
  thumbnail_url TEXT,
  sort_order    INTEGER DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_templates ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ad_templates (key, name, emoji, description, style_prompt, copy_guidance, sort_order) VALUES
('reaccion-real', 'Reacción Real', '🎬', 'The emotional first-listen reaction — your #1 converting angle.',
 'Candid, authentic, documentary-style photo of an adult reacting with raw emotion — hand over heart, happy tears, surprised joyful smile — while listening to a song on a phone held to their ear or watching a screen. Real and unposed, warm natural light, shallow depth of field, feels like a genuine captured moment, NOT a stock photo. Mature adults only.',
 'Hook leads with the reaction / disbelief: e.g. "No podía creer que la canción hablara de ella". Short, emotional, CTA to regalosquecantan.com.', 1),
('momento-regalo', 'El Momento del Regalo', '🎁', 'Warm photoreal gift hand-off, tears of joy.',
 'Warm cinematic photoreal scene of an adult giving or showing a personalized song to a loved one on a phone, golden-hour lighting, cozy home setting, genuine emotion and happy tears, soft bokeh background, premium gifting feel. Mature adults only, wide tasteful framing.',
 'Sell the feeling of the moment + that a song is the best gift. e.g. "El regalo que la hizo llorar de felicidad".', 2),
('frase-impacta', 'Frase que Impacta', '✍️', 'Bold headline baked into the image — gpt-image-1''s superpower.',
 'Bold modern direct-response ad graphic: a large, beautifully typeset SPANISH headline is the hero, set over an emotional softly-blurred photo background. Clean professional typography, high contrast, elegant layout, looks like a polished paid ad. Render the exact Spanish headline text crisply and correctly in the image.',
 'Provide ONE punchy Spanish headline to render in the image (<=7 words), plus a supporting primary_text and CTA. e.g. headline "La canción que la hizo llorar 😭".', 3),
('flores-vs-cancion', 'Flores vs Canción', '🥀', 'The proven anniversary comparison angle.',
 'Conceptual comparison ad visual, split composition: on one side wilting/fading flowers (the forgettable gift), on the other a glowing phone playing a personalized song with warm light (the lasting gift). Elegant, emotional, premium ad design with a short Spanish caption rendered cleanly.',
 'Lean on "las flores se marchitan, una canción queda para siempre" style contrast. Romantic / aniversario angle.', 4),
('por-la-ocasion', 'Por la Ocasión', '🎉', 'Styled to a specific occasion — festive and timely.',
 'Festive, occasion-themed photoreal ad image celebrating a specific Latino milestone (Día de las Madres, aniversario, quinceañera-as-celebrated-by-adults, cumpleaños) — warm celebratory setting, joyful family moment, the personalized song presented as the gift. Warm tones, premium feel. NEVER depict minors; for youth occasions show the proud parents/adults.',
 'Tie the copy to the chosen occasion and why a personalized song is the perfect gift for it.', 5)
ON CONFLICT (key) DO NOTHING;
