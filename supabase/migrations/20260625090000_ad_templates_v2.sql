-- 20260625090000_ad_templates_v2.sql
-- Ad Templates v2 (2026-06-25): replace the generic v1 styles with 7 pro,
-- art-directed, scroll-stopping ad styles. Engine upgraded to gpt-image-2
-- (OPENAI_IMAGE_MODEL default in ad-templates fn; quality 'medium' for speed/
-- reliability via the OPENAI_IMAGE_QUALITY secret). The art direction in
-- style_prompt is what makes the output premium — not just the model.

DELETE FROM public.ad_templates;
INSERT INTO public.ad_templates (key, name, emoji, description, style_prompt, copy_guidance, sort_order) VALUES
('ugc-reaccion', 'UGC Reacción', '📱', 'Authentic phone-shot reaction — reads as native, not an ad.',
 'Authentic UGC-style vertical photo shot on an iPhone front camera: a real adult mid-reaction — laughing while crying, hand pressed to chest, overwhelmed with happy emotion — listening to a song. Slightly grainy, natural window light, candid and imperfect, looks filmed by a friend in a real living room, NOT a polished studio shot. Native social-feed authenticity, photoreal, vertical. Mature adults only.',
 'Lead with the raw reaction/disbelief in native conversational Spanish. CTA to regalosquecantan.com.', 1),
('frase-bold', 'Frase Bold', '✍️', 'Massive bold headline baked in — agency-grade typography ad.',
 'High-impact editorial advertising poster designed by a world-class creative agency. A massive bold condensed sans-serif SPANISH headline dominates the frame with perfect kerning and crisp flawless legibility, set over a moody, emotional, softly-blurred photo. Dramatic high contrast, sophisticated layout, premium paid-social look. Render the exact Spanish headline text perfectly and legibly.',
 'Give ONE punchy Spanish headline (<=6 words) to render as the hero, e.g. "La hizo llorar 😭", plus supporting primary_text + CTA.', 2),
('cine-momento', 'Cine Momento', '🎬', 'Cinematic film-still — premium, aspirational, gallery-quality.',
 'Cinematic film still, shot on 85mm f/1.4, shallow depth of field, golden-hour rim light, rich filmic color grade with subtle grain — an intimate emotional candid moment of an adult hearing their personalized song, eyes welling with happy tears. Editorial, premium, aspirational, gallery-quality lighting and composition. Mature adults only, tasteful framing.',
 'Sell the feeling; premium and emotional. Clear CTA.', 3),
('testimonio', 'Testimonio Real', '💬', 'Looks like a genuine review/text screenshot — high-trust social proof.',
 'A realistic social-proof ad styled like a genuine phone screenshot: a heartfelt Spanish text message or 5-star review (e.g. "mi mamá no paró de llorar 😭 gracias") beside a small warm photo, clean modern phone UI, feels 100% authentic and trustworthy, not designed-looking. Render the Spanish text crisply and naturally.',
 'Frame as authentic testimonial / social proof; let the screenshot copy carry it.', 4),
('comparacion', 'Flores vs Canción', '🥀', 'Bold visual comparison — the proven anniversary angle.',
 'Bold conceptual split-screen comparison ad: on one side wilting fading flowers (the forgettable gift); on the other a glowing phone playing a personalized song bathed in warm light (the gift that lasts). Dramatic studio lighting, premium agency design, a short crisp Spanish caption rendered cleanly. High contrast, scroll-stopping.',
 '"Las flores se marchitan, una canción queda para siempre" contrast. Romance / aniversario.', 5),
('producto-hero', 'Producto Hero', '🎼', 'Apple-style premium product shot of the song itself.',
 'Premium Apple-style product-hero shot: elegant hands holding a phone that displays a beautiful music-player screen for a personalized song (a name visible on screen), soft directional studio lighting, clean minimal premium background, crisp commercial quality, aspirational. Render any on-screen text cleanly.',
 'Make the personalized song feel like a premium, must-have product/gift.', 6),
('ocasion', 'Por la Ocasión', '🎉', 'Vibrant occasion-themed lifestyle ad — festive and timely.',
 'Vibrant festive occasion-themed lifestyle ad (Día de las Madres, aniversario, cumpleaños) — rich warm color, a joyful authentic adult celebration moment, the personalized song presented as the standout gift, premium lifestyle photography, dynamic and emotional. NEVER depict minors; for youth occasions show the proud parents/adults.',
 'Tie the copy to the chosen occasion and why a personalized song is the perfect gift.', 7)
ON CONFLICT (key) DO NOTHING;
