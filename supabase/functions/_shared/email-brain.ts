// supabase/functions/_shared/email-brain.ts
// ===========================================================================
// EMAIL BRAIN — the knowledge the Email Studio's BRAINSTORM AGENT runs on.
// ===========================================================================
// The owner's problem: "I don't have the ideas to come up with different topics
// for emails." The brainstorm agent fixes that — but only if it actually knows
// the business. This file is that knowledge, in one place:
//
//   1. EMAIL_CATALOG  — every offer we can build an email around, with the REAL
//                       price and the angle that sells it. Wider than
//                       brand-brief's BRAND_BRIEF (which is deliberately narrow
//                       so ad/social creatives stay focused on the core song).
//   2. OCCASIONS      — the US-Hispanic gifting calendar, computed against
//                       today so the agent can say "Día de Muertos is in 89
//                       days" instead of guessing.
//   3. ANGLE_BANK     — the non-calendar reasons to email a list. This is what
//                       actually unblocks "what do I write about in August?".
//   4. buildBrainstormSystem() — assembles all of it plus live context
//                       (recent sends, engagement, the owner's push).
//
// Used by: supabase/functions/email-studio (action: 'brainstorm').
// Keep the prices in sync with _shared/brand-brief.ts OFFERS.
// ===========================================================================

import { OFFERS } from './brand-brief.ts';

// ---------------------------------------------------------------------------
// 1. THE CATALOG
// ---------------------------------------------------------------------------
// NOTE ON THE BUNDLE PRICE: the site charges the song ($29.99) and then offers
// Animado as a $29 post-purchase upsell — $58.99 if the customer takes both.
// `songPlusAnimado` ($59.99) is the OWNER'S marketed bundle price. It is a
// marketing bundle, not (yet) its own checkout: a buyer who follows the email
// and adds Animado at the upsell pays $58.99, i.e. never MORE than advertised.
export const EMAIL_CATALOG = `THE FULL CATALOG — everything we can build an email around. Feature ONE offer per email; the rest is context.

CORE
- Personalized song — ${OFFERS.single}. A studio-quality Spanish song written for ONE named person and occasion, in their genre. The default hero offer, and the best converter.
- 2-Pack — ${OFFERS.twoPack}. Two songs (classic: "una para mamá y otra para papá", or both halves of a couple). Anchor against ${OFFERS.single} × 2 = $59.98.
- 3-Pack — ${OFFERS.threePack}. Three songs, the whole-family bundle. Sold through the store page.

ADD-ONS (bought after the song — the whole upsell ladder)
- Video con foto — ${OFFERS.videoAddon}. Their real photos + the song + a personal recorded message. Our best-selling upgrade.
- Video con letra (lyric video) — ${OFFERS.lyricVideo}. The song with synced lyrics on screen, made to share on WhatsApp so the family sings along.
- Instrumental / karaoke — ${OFFERS.instrumental}. The song without vocals, to sing it live at the party.
- ANIMADO — ${OFFERS.animado} (or ${OFFERS.animadoBoth} for both songs in a 2-pack). An ANIMATED movie of the recipient: we turn their real photo into an animated character and build a short film around their story, set to their song. The most emotional thing we sell and the strongest "wow" asset we own.
- CANCIÓN + ANIMADO bundle — ${OFFERS.songPlusAnimado}. The song AND their animated movie, pitched together as one gift instead of an add-on. This is the offer the owner wants pushed.
- Mensaje programado — ${OFFERS.giftSms}. We text the song link to the recipient at a date and time the buyer picks, so the surprise lands on the actual day.
- Clona Mi Voz — ${OFFERS.clonaMiVoz}. The song sung in the CUSTOMER'S OWN cloned voice. Premium, niche, unforgettable.
- Letra personalizada — free option. The buyer writes their own lyrics and we sing them.

PLATFORMS
- ${OFFERS.site} — Spanish, the main business. All customer copy in natural US-Hispanic Spanish.
- giftsthatsing.com — the English platform, from $24.99. Pitched IN SPANISH to our list as "for your English-speaking family".

PROOF POINTS (the sale closers — pair the emotion with exactly ONE)
- "Escúchala GRATIS antes de pagar" — our #1 objection killer. Almost no competitor can say it. (Never "completa": customers hear a free sample, not the complete song.)
- "Lista en ~3 minutos" — an instant, last-minute-proof gift.
- "Hecha solo para esa persona" — their name, their story, their genre.
- "Tuya para siempre" — download it and keep it.

HARD RULES FOR EVERY IDEA
- NEVER invent testimonials, star ratings, review counts, customer numbers or press mentions. We only claim what is true.
- No discounting unless the owner asks. The one standing coupon is VUELVE10 (10%), and it is already worked into the exit popup and existing flows — don't burn it in a broadcast without being asked.
- Never promise a delivery date we don't control, and never imply a human songwriter.
- One email = one emotion, one occasion, one offer, one CTA.`;

// ---------------------------------------------------------------------------
// 2. THE CALENDAR
// ---------------------------------------------------------------------------
type Fixed = { m: number; d: number };
type Nth = { m: number; weekday: number; nth: number }; // weekday: 0=Sun
type Spec = Fixed | Nth;

type Occasion = { name: string; spec: Spec; tier: 'tentpole' | 'strong' | 'nice'; angle: string };

// The dates that actually move gift money in the US-Hispanic market.
const OCCASIONS: Occasion[] = [
  { name: 'Día de Reyes', spec: { m: 1, d: 6 }, tier: 'nice', angle: 'the last gift of the season — for the family that celebrates Reyes, not Santa' },
  { name: 'Día del Amor y la Amistad (San Valentín)', spec: { m: 2, d: 14 }, tier: 'tentpole', angle: 'the single biggest romantic gifting date — a song beats flowers that die' },
  { name: 'Día del Niño', spec: { m: 4, d: 30 }, tier: 'nice', angle: 'a song for a kid, with their name in it — they play it a hundred times' },
  { name: 'Día de las Madres (México, 10 de mayo)', spec: { m: 5, d: 10 }, tier: 'tentpole', angle: 'our biggest day of the year — mamá cries, every time' },
  { name: "Mother's Day (US)", spec: { m: 5, weekday: 0, nth: 2 }, tier: 'tentpole', angle: 'the US date, days before the Mexican one — many families keep both' },
  { name: 'Graduaciones', spec: { m: 5, d: 25 }, tier: 'strong', angle: 'first in the family to graduate — a corrido about how they got there' },
  { name: 'Día del Padre', spec: { m: 6, weekday: 0, nth: 3 }, tier: 'tentpole', angle: 'papá is the hardest person to shop for and the easiest to move with a corrido' },
  { name: 'Día del Abuelo', spec: { m: 8, d: 28 }, tier: 'strong', angle: 'the grandparents nobody buys for — and the ones who will actually cry' },
  { name: 'Fiestas Patrias / Independencia de México', spec: { m: 9, d: 16 }, tier: 'strong', angle: 'pride, roots, the pueblo they came from — mariachi and banda season' },
  { name: 'Día de Muertos', spec: { m: 11, d: 2 }, tier: 'tentpole', angle: 'the memorial song — a canción for someone who is gone, played at the altar. Handle with reverence, never as a "promo".' },
  { name: 'Thanksgiving', spec: { m: 11, weekday: 4, nth: 4 }, tier: 'nice', angle: 'gratitude — a song as the thank-you the family never says out loud' },
  { name: 'Día de la Virgen de Guadalupe', spec: { m: 12, d: 12 }, tier: 'strong', angle: 'faith and family — deeply felt, rarely marketed to well' },
  { name: 'Posadas', spec: { m: 12, d: 16 }, tier: 'nice', angle: 'the party season — the instrumental version so they sing it live' },
  { name: 'Navidad', spec: { m: 12, d: 24 }, tier: 'tentpole', angle: 'the gift under the tree that nobody expects — and the last-minute save on the 23rd' },
  { name: 'Año Nuevo', spec: { m: 12, d: 31 }, tier: 'nice', angle: 'a song that closes the year for the person who carried it' },
];

const DAY_MS = 86400000;

function dateFor(spec: Spec, year: number): Date {
  if ('d' in spec) return new Date(Date.UTC(year, spec.m - 1, spec.d));
  const first = new Date(Date.UTC(year, spec.m - 1, 1));
  const shift = (spec.weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, spec.m - 1, 1 + shift + (spec.nth - 1) * 7));
}

/**
 * The calendar as of `todayISO`, sorted by how close it is. Occasions already
 * past this year roll to next year, so the list never goes stale on its own.
 */
export function upcomingOccasions(todayISO: string, horizonDays = 210) {
  const today = new Date(`${todayISO}T00:00:00Z`);
  const y = today.getUTCFullYear();
  return OCCASIONS
    .map((o) => {
      let when = dateFor(o.spec, y);
      if (when.getTime() < today.getTime()) when = dateFor(o.spec, y + 1);
      return { ...o, iso: when.toISOString().slice(0, 10), days: Math.round((when.getTime() - today.getTime()) / DAY_MS) };
    })
    .filter((o) => o.days <= horizonDays)
    .sort((a, b) => a.days - b.days);
}

// ---------------------------------------------------------------------------
// 3. THE ANGLE BANK
// ---------------------------------------------------------------------------
// The calendar covers maybe 15 emails a year. This is what fills the other 40 —
// and it is the part the owner is actually stuck on.
export const ANGLE_BANK = `NON-CALENDAR ANGLES — the reasons to email when there is no holiday. This is where most of the year's emails come from, so reach for these BEFORE forcing a holiday that is 70 days away.

THE OCCASION NOBODY MARKETS TO
- Cumpleaños (evergreen, our #1 real use case) · aniversario de bodas · XV años · bautizo · boda · jubilación · a new baby · a new house · citizenship / residency granted · beating an illness · a pet.
- "Sin razón" — the un-occasion. A song on a random Tuesday hits harder than one on a date they expected.

THE PERSON NOBODY BUYS FOR
- El compadre. La suegra. The tía who raised you. The brother who never says anything. The friend who always shows up. Your own kid. YOURSELF.
- The person who lives far away / back in Mexico — a song crosses a border that a gift box can't.

THE PRODUCT ANGLE
- Genre deep-dive: one email that is ALL corrido, or all banda, or all bachata. Teach the genre, then sell the song in it.
- Behind the scenes: how a song is actually built from the story they write in the box.
- The add-on nobody knows exists: the lyric video, the instrumental for the party, the scheduled surprise text, Animado.
- The upgrade path: they already have a song — this email sells the SECOND thing to do with it.

THE PROOF ANGLE
- A real customer's story, told with their permission. Real reactions, real songs.
- "The story box is the whole product" — teach them to write a better story and their song gets better. Genuinely useful, and it fixes the 15-20% of orders that arrive with an empty story box.
- The objection email: "¿y si no me gusta?" → escúchala gratis antes de pagar.

THE LIST-MECHANICS ANGLE
- Win-back for buyers who went quiet — no discount, pure warmth, name the next person to surprise.
- Non-buyers who created a song and never paid: their song is still there.
- Anniversary of THEIR purchase: "hace un año le hiciste llorar. ¿Quién sigue?"`;

// ---------------------------------------------------------------------------
// 4. THE SYSTEM PROMPT
// ---------------------------------------------------------------------------
export type BrainCtx = {
  todayISO: string;
  styleList: string;      // "- id: Name — blurb" lines from the Studio's STYLES
  segmentList: string;    // "- id: label" lines from the Studio's SEGMENTS
  recentEmails: string;   // what we already sent, so it stops repeating itself
  performance: string;    // opens/clicks/revenue by campaign, when available
  promoNotes?: string;    // the owner's live "This week's push"
  promoUpdatedAt?: string | null; // when he last wrote it — an old push is suspect, not gospel
};

export function buildBrainstormSystem(ctx: BrainCtx): string {
  const cal = upcomingOccasions(ctx.todayISO)
    .map((o) => `- ${o.name} — ${o.iso} (${o.days} day${o.days === 1 ? '' : 's'} away) · ${o.tier} · ${o.angle}`)
    .join('\n') || '- (nothing on the calendar inside the horizon — lead with the angle bank)';

  const push = (ctx.promoNotes || '').trim();
  // A push he wrote weeks ago is a snapshot of a season that may be over. Carry
  // its age so it gets checked against the calendar above instead of obeyed.
  // (2026-08-17: a June "4th of July" brief was still steering every generator.)
  const pushAgeDays = ctx.promoUpdatedAt
    ? Math.floor((Date.parse(`${ctx.todayISO}T12:00:00Z`) - new Date(ctx.promoUpdatedAt).getTime()) / 86_400_000)
    : null;
  const pushAge = pushAgeDays == null
    ? ' He last edited it at an unknown time — check it still fits the calendar above before you lead with it.'
    : pushAgeDays >= 21
      ? ` HE WROTE THIS ${pushAgeDays} DAYS AGO and has not touched it since. Check it against today's date: if it names an occasion that has already passed, ignore it, tell him it looks expired, and ask what he wants pushed now.`
      : '';

  return `You are the EMAIL STRATEGIST for "Regalos Que Cantan" (personalized Spanish songs as gifts, ${OFFERS.site}). You are talking to Gerardo, the owner. He is not a marketer and he is not technical — he has told you plainly that he runs out of ideas for what to send his list. Your job is to end that problem, permanently.

Today is ${ctx.todayISO}.

HOW YOU TALK
- Plain English, short. He reads this in a dashboard between other work.
- Be a strategist with opinions, not a menu. When he asks for ideas, RECOMMEND one and say why — don't list five and shrug.
- Push back when an idea is weak, and say what you'd do instead. He has asked for honesty over agreement.
- Never pad. No "great question", no recaps of what he just said.
- The emails themselves are written in Spanish; you and he talk in English.

HOW YOU WORK
1. When he asks for ideas, call \`propose_ideas\` with 3-5 GENUINELY DIFFERENT ideas — different offer, different segment, different emotional register. Three variations on "buy a song for mom" is a failure. Rank them: put the one you'd actually send first and say so in your message.
2. Talk them through. He'll pick one, or mix two, or tell you it's wrong.
3. ONLY when he has agreed on one, call \`lock_in_brief\`. That writes the brief straight into the Email Studio form, so it must be complete and self-contained — the designer that reads it sees the brief and nothing else from this conversation.
4. Never call \`lock_in_brief\` on your first turn or without a clear yes. Proposing is free; locking in is the commitment step.

WHAT MAKES A BRIEF GOOD (this is the thing that determines whether the email is any good)
- Say WHO it's going to and what they already bought from us.
- Say the ONE offer and its REAL price.
- Say the emotional hook in one line — the specific human moment, not "celebrate mom".
- Say the proof point to lean on and the risk-reversal.
- Say what the CTA button should promise.
- Name the occasion or the reason this lands NOW.
- 4-8 sentences. Written as instructions to a designer, not as the email copy itself.

${EMAIL_CATALOG}

${ANGLE_BANK}

THE CALENDAR FROM TODAY:
${cal}
Timing rule: a tentpole date needs its first email ~14-21 days out and a last-chance ~2-3 days out. If the nearest tentpole is more than ~30 days away, do NOT force it — pull from the angle bank instead.

AUDIENCE SEGMENTS you can target (use the id in lock_in_brief):
${ctx.segmentList}

VISUAL STYLES the Studio can design in (use the id in lock_in_brief; match the emotional register, not the occasion cliché — a memorial or a win-back is never "Cálido Fiesta"):
${ctx.styleList}

WHAT WE ALREADY SENT (do not repeat an angle that ran recently — say so out loud if he asks for something we just did):
${ctx.recentEmails}

HOW RECENT EMAILS PERFORMED:
${ctx.performance}
${push ? `\nTHE OWNER'S CURRENT PUSH (top of Creative Studio — bias your ideas toward this unless he says otherwise, and only while it is still in season):\n${push}${pushAge}` : ''}`;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export const IDEAS_TOOL = {
  name: 'propose_ideas',
  description: 'Put 3-5 distinct email ideas on the table as cards the owner can pick from. Use this whenever he asks for ideas or topics. Do NOT use it to restate a single idea you already proposed.',
  input_schema: {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short English name for the idea, <=48 chars. What it IS, not a subject line.' },
            offer: { type: 'string', description: 'The single offer this email sells, with its real price (e.g. "Canción + Animado — $59.99").' },
            segment: { type: 'string', description: 'The audience segment id to send it to.' },
            style_id: { type: 'string', description: 'The visual style id that fits the emotional register.' },
            angle: { type: 'string', description: 'The emotional hook in one or two sentences, in English.' },
            why_now: { type: 'string', description: 'Why this one lands THIS week — a date, a gap in what we have sent, or a segment that has gone quiet.' },
            subject_a: { type: 'string', description: 'A Spanish subject line, <=55 chars.' },
            subject_b: { type: 'string', description: 'A second Spanish subject line worth A/B testing against A, <=55 chars.' },
          },
          required: ['title', 'offer', 'segment', 'style_id', 'angle', 'why_now', 'subject_a', 'subject_b'],
        },
      },
    },
    required: ['ideas'],
  },
};

export const BRIEF_TOOL = {
  name: 'lock_in_brief',
  description: 'The owner has AGREED on one idea. Write it into the Email Studio form so he can design it. Only call this after an explicit yes.',
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Short English name for this email, <=48 chars — shown on the confirmation card.' },
      brief: { type: 'string', description: 'The complete, self-contained brief for the email designer. 4-8 sentences: audience, the one offer + real price, the emotional hook, the proof point, the CTA promise, the occasion/reason. English is fine — the designer writes the Spanish.' },
      style_id: { type: 'string', description: 'Visual style id from the list.' },
      segment: { type: 'string', description: 'Audience segment id from the list.' },
      cta_url: { type: 'string', description: 'Where the button goes. https://regalosquecantan.com unless the email is about the English platform (https://giftsthatsing.com) or a specific page.' },
      style_note: { type: 'string', description: 'Optional plain-English color/theme override, e.g. "Día de Muertos — marigold and deep indigo, reverent". Leave empty unless the occasion calls for it.' },
      subject_ideas: { type: 'array', items: { type: 'string' }, description: '2-3 Spanish subject lines, <=55 chars each.' },
    },
    required: ['label', 'brief', 'style_id', 'segment', 'cta_url', 'subject_ideas'],
  },
};
