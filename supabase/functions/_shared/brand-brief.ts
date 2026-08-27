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
// brandContext(promoNotes, promoUpdatedAt) — owners edit that live in the
// Creative Studio tab.
//
// brandContext() ALSO stamps today's date into every prompt. That is not
// decoration: see the note on todayBlock() below — without it the generators
// have no clock and keep selling holidays that already happened.
// ---------------------------------------------------------------------------

// The catalog, in one place. Update a price here and it flows to every generator.
export const OFFERS = {
  site: 'regalosquecantan.com',
  single: '$29.99',
  twoPack: '$39.99',
  threePack: '$59.98', // "paga 2, la 3ª GRATIS" (2 × $29.99)
  fivePack: '$89.97',  // "paga 3, 2 GRATIS"
  tenPack: '$149.95',  // "5 GRATIS · al 1×1"
  videoAddon: '$9.99',
  lyricVideo: '$9.99',
  // Added for the Email Studio brainstorm agent + the Animado preset. Purely
  // additive — the BRAND_BRIEF ladder below is unchanged, so ad/social rotation
  // behaves exactly as before. The full catalog narrative lives in
  // _shared/email-brain.ts (email surfaces only).
  instrumental: '$7.99',
  animado: '$29',
  animadoBoth: '$44.99',
  songPlusAnimado: '$59.99',
  clonaMiVoz: '$69',
  giftSms: '$5',
};

export const BRAND_BRIEF = `THE BUSINESS — this is a REAL product with REAL advantages, not just a vibe. Keep every fact below true in every creative.

WHAT WE SELL: a personalized, studio-quality Spanish song written for ONE specific person and occasion, in the genre they love (corrido, banda, norteño, bachata, mariachi, cumbia…). Ordered online at ${OFFERS.site}.

PROOF POINTS — pair the EMOTION with ONE of these in each creative (emotion hooks the scroll, the proof point closes the sale — never lead cold with a feature, but don't leave it out either):
- "Escúchala GRATIS antes de pagar" — you listen first, then decide. This is our #1 objection-killer; almost no competitor can say it. Lean on it often. NEVER write "completa" (customers hear a free sample before paying, not the complete song — the full 3-4 min song unlocks at purchase).
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

// A seasonal push older than this is treated as suspect rather than obeyed.
const STALE_PUSH_DAYS = 21;

// TODAY, in the owner's real calendar day (Pacific). Every generator that calls
// brandContext() gets this.
//
// WHY: a model with no clock invents the season. On 2026-08-17 the Ads Coach was
// still pitching a 4th of July angle, and could not fix itself when the owner
// said "4th of july past already" — nothing in its prompt said what day it was,
// so "past" was not a fact it could check. Never remove this block.
function todayBlock(now: Date): string {
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(now);
  return `TODAY IS ${today} (the owner's Pacific calendar day — this is the real current date, trust it over any assumption).
- NEVER propose, build, or lead with an occasion, holiday or season that has ALREADY PASSED. Check it against the date above before you name it.
- If ANY instruction you were given — including the owner's push below — names a holiday, date or season that is already past, it has EXPIRED: do not follow it. Say plainly that it looks out of date and ask what to push instead.
- When an occasion is genuinely ahead, anchor to how far away it is, and remember buyers order days before the date, not on it.`;
}

// Compose the brief with today's date + the owner's live seasonal push
// (creative_studio_config.promo_notes, written at promo_updated_at). Call this in
// each generator and append the result to SYSTEM.
//
// Pass promoUpdatedAt whenever you have it: the push carries its own age so a
// months-old brief gets questioned instead of obeyed forever.
export function brandContext(promoNotes?: string, promoUpdatedAt?: string | Date | null, now: Date = new Date()): string {
  const push = (promoNotes || '').trim();

  let pushBlock: string;
  if (!push) {
    pushBlock = `\n\nNO SEASONAL PUSH IS SET right now. Use the default rotation in THE LADDER above and choose the occasion/angle yourself from what the business and the live data call for. Do not invent a holiday campaign just to have one.`;
  } else {
    const ts = promoUpdatedAt ? new Date(promoUpdatedAt) : null;
    const ageDays = ts && !Number.isNaN(ts.getTime())
      ? Math.floor((now.getTime() - ts.getTime()) / 86_400_000)
      : null;
    const written = ts && !Number.isNaN(ts.getTime())
      ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' }).format(ts)
      : null;
    const age = ageDays == null
      ? `The owner last edited this at an unknown time — VERIFY it still matches the date above before you lead with it.`
      : ageDays >= STALE_PUSH_DAYS
        ? `WARNING — the owner wrote this ${ageDays} days ago (${written}) and has not touched it since. That is old enough to be stale. Check it against TODAY: if it names an occasion that has passed, IGNORE it entirely, tell the owner it looks expired, and ask what to push now. Do not quietly build to an out-of-date brief.`
        : `The owner wrote this ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`} (${written}) — current.`;
    pushBlock = `\n\nOWNER'S CURRENT PUSH (biases the rotation — but only while it is still in season):\n${push}\n\n${age}`;
  }

  return `${todayBlock(now)}\n\n${BRAND_BRIEF}${pushBlock}`;
}
