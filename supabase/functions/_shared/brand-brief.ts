// ---------------------------------------------------------------------------
// BRAND BRIEF — the "Business Brain" for Creative Studio.
//
// Single source of truth for what Regalos Que Cantan actually sells: the offer,
// the proof points that close the sale, and the upsell ladder. Injected into
// EVERY creative generator (creative-studio-daily, creative-chat, ad-templates)
// so the content doesn't just feel nice — it sells the real product and
// rotates through the real catalog.
//
// WHY THIS EXISTS: the art-director prompts used to say "sell the feeling, not
// the feature" and carried ZERO product facts — no "listen before you pay", no
// "ready in 3 minutes", no upsells. Beautiful mood pieces that never closed and
// never promoted the add-ons. This brief fixes that.
//
// TO UPDATE PRICES / OFFERS: edit OFFERS below. This is the accurate, code-owned
// catalog. The OWNER's seasonal push ("this week promote Día del Padre") lives
// in creative_studio_config.promo_notes and is layered on top at runtime via
// brandContext(promoNotes) — owners edit that live in the Creative Studio tab.
// ---------------------------------------------------------------------------

// The catalog, in one place. Update a price here and it flows to every generator.
export const OFFERS = {
  site: 'regalosquecantan.com',
  single: '$29.99',
  twoPack: '$39.99',
  threePack: '$49.99',
  videoAddon: '$9.99',
  lyricVideo: '$9.99',
};

export const BRAND_BRIEF = `THE BUSINESS — this is a REAL product with REAL advantages, not just a vibe. Keep every fact below true in every creative.

WHAT WE SELL: a personalized, studio-quality Spanish song written for ONE specific person and occasion, in the genre they love (corrido, banda, norteño, bachata, mariachi, cumbia…). Ordered online at ${OFFERS.site}.

PROOF POINTS — pair the EMOTION with ONE of these in each creative (emotion hooks the scroll, the proof point closes the sale — never lead cold with a feature, but don't leave it out either):
- "Escúchala GRATIS antes de pagar" — you hear the COMPLETE finished song first, then decide. This is our #1 objection-killer; almost no competitor can say it. Lean on it often.
- "Lista en ~3 minutos" — not days of waiting. An instant, last-minute-proof gift.
- "Tuya para siempre" — yours to keep, download and replay forever.
- "Hecha solo para esa persona" — their name, their story, their genre. One of a kind.

THE LADDER — feature EXACTLY ONE offer per creative, and ROTATE across the batch so a week of content teaches the whole catalog (mostly the core song, but regularly surface the add-ons and bundles so customers learn they exist):
- CORE — a personalized song, ${OFFERS.single}. The default hero offer.
- 2-PACK — ${OFFERS.twoPack} — two songs (e.g. one for mom AND one for dad). Use on "both parents" / couple / two-people angles.
- 3-PACK — ${OFFERS.threePack} — best-value bundle for a whole family.
- VIDEO ADD-ON — ${OFFERS.videoAddon} — turns the song into an animated photo video with a personal recorded message. Angle: "don't just send a song — send a keepsake video they'll cry over."
- LYRIC VIDEO — ${OFFERS.lyricVideo} — the song as a shareable lyric video, perfect for posting and sending on WhatsApp.
- INSTRUMENTAL VERSION — the song without vocals, to sing it yourself / karaoke at the party.

HOW TO DEPLOY IT:
- 'ad' creatives: every one carries ONE proof point + ONE clear offer + a CTA to ${OFFERS.site}.
- 'social' creatives: softer — lead with feeling and shareability, weave ONE proof point in lightly, no hard price push unless there's an active promo.
- Never cram the whole menu into one piece. One emotion, one occasion, one offer.`;

// Compose the brief with the owner's live seasonal push (creative_studio_config
// .promo_notes). Call this in each generator and append the result to SYSTEM.
export function brandContext(promoNotes?: string): string {
  const push = (promoNotes || '').trim();
  const pushBlock = push
    ? `\n\nOWNER'S CURRENT PUSH (this overrides the default rotation — bias this batch toward it):\n${push}`
    : '';
  return `${BRAND_BRIEF}${pushBlock}`;
}
