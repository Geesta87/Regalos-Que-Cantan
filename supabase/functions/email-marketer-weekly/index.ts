// supabase/functions/email-marketer-weekly/index.ts
// ===========================================================================
// EMAIL MARKETER — weekly drafter (2-PASS DESIGN ENGINE)
// ===========================================================================
// Runs Monday morning via pg_cron. Drafts 2-3 designed promotional emails for
// the owner to review and send. Two AI passes per batch:
//
//   PASS 1 — STRATEGY & COPY:  research the week's reasons to send (holidays,
//     key dates, "just because" angles), write the Spanish copy for each, and
//     pick a DISTINCT visual style from the style library for each email. Pulls
//     the real product facts from the shared brand brief so the copy sells.
//
//   PASS 2 — DESIGN:  for each email, Claude acts as an elite email designer and
//     produces the FULL, email-safe HTML in the chosen style (palette, fonts,
//     layout, bulletproof button). One call per email.
//
//   SAFETY NET (code):  finalizeHtml() guarantees email-safe structure, strips
//     scripts, and ALWAYS injects the legally-required unsubscribe footer even
//     if the model forgets. If a design pass fails, we fall back to a clean
//     built-in template so a broken email is never stored.
//
// It does NOT send anything. verify_jwt = false (pg_cron). Reads ANTHROPIC_API_KEY.
// Deploy: supabase functions deploy email-marketer-weekly --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BRAND_BRIEF, OFFERS } from '../_shared/brand-brief.ts';
import { kiePhotoBytes, KIE_IMAGE_ENABLED } from '../_shared/kie-image.ts';
import { buildUnsubscribeHeaders, buildUnsubscribeUrl } from '../_shared/unsubscribe.ts';
import { buildEmailParts } from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Marketing-email HTML is templated work — Sonnet is plenty and ~5x cheaper than
// Opus. Override with the EMAIL_MARKETER_MODEL secret if you ever want Opus.
const MODEL = Deno.env.get('EMAIL_MARKETER_MODEL') || 'claude-sonnet-4-6';
const SITE = 'https://regalosquecantan.com';
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'Regalos Que Cantan';
// Owner-only recipient(s) for the "email me the current drafts" test utility.
// Hardcoded so this (verify_jwt=false) endpoint can never be used to spam others.
const OWNER_TEST_EMAILS = ['gerardoriverafinancial@gmail.com', 'hola@regalosquecantan.com'];
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// ===========================================================================
// STYLE LIBRARY — the full experimental range. Each is an art-direction brief
// the design pass renders into email-safe HTML. `font` carries a web font (for
// clients that support it, e.g. Apple Mail) AND a safe fallback stack that most
// inboxes (Gmail/Outlook) actually render — the layout & color carry the look
// regardless. To add a style: append here; pass 1 will start choosing it.
// ===========================================================================
type Style = {
  id: string; name: string; blurb: string;
  palette: { bg: string; surface: string; ink: string; sub: string; accent: string; accent2: string };
  fontHref: string; headingFont: string; bodyFont: string;
  treatment: string;
};

const STYLES: Style[] = [
  {
    id: 'dark_luxury', name: 'Dark Luxury', blurb: 'Cinematic blacks, gold accents',
    palette: { bg: '#0b0b0f', surface: '#15151c', ink: '#f7f4ea', sub: '#b8b2a3', accent: '#d4af37', accent2: '#8a6d1f' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Jost:wght@400;500&display=swap',
    headingFont: "'Cormorant Garamond', Georgia, 'Times New Roman', serif", bodyFont: "'Jost', Arial, Helvetica, sans-serif",
    treatment: 'Black canvas, generous negative space, thin gold hairline rules and a small gold-bordered wordmark. Large elegant serif headline in warm off-white. Gold gradient (with solid #d4af37 fallback) on the button. Feels like a luxury invitation. Restrained, expensive, never busy.',
  },
  {
    id: 'warm_editorial', name: 'Warm Editorial', blurb: 'Magazine quality, terracotta & cream',
    palette: { bg: '#f4ece2', surface: '#fffaf3', ink: '#2e2620', sub: '#6b5d4f', accent: '#c4622d', accent2: '#9a4a1f' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Inter:wght@400;500&display=swap',
    headingFont: "'Fraunces', Georgia, serif", bodyFont: "'Inter', Arial, Helvetica, sans-serif",
    treatment: 'Editorial magazine layout on warm cream. Terracotta accents, an oversized drop-style headline, a thin kicker/eyebrow label above it in small caps. Comfortable line length, refined serif headings. The button is terracotta with rounded corners. Tasteful, human, premium print feel.',
  },
  {
    id: 'bold_graphic', name: 'Bold Graphic', blurb: 'Electric contrast, design-studio energy',
    palette: { bg: '#101014', surface: '#1b1b22', ink: '#ffffff', sub: '#c4c4d0', accent: '#ff3d71', accent2: '#7b2cff' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500&display=swap',
    headingFont: "'Space Grotesk', 'Arial Black', Arial, sans-serif", bodyFont: "'Inter', Arial, Helvetica, sans-serif",
    treatment: 'High-contrast design-studio energy. Huge tight-tracked headline, a bold color block or angled accent bar, magenta-to-violet gradient (solid #ff3d71 fallback) on the button. Confident, modern, art-directed. Strong hierarchy, lots of weight contrast.',
  },
  {
    id: 'soft_premium', name: 'Soft Premium', blurb: 'Refined blush, elegant & airy',
    palette: { bg: '#faf6f6', surface: '#ffffff', ink: '#352b30', sub: '#8a7a80', accent: '#c77d8e', accent2: '#a85f72' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Mulish:wght@400;500&display=swap',
    headingFont: "'Playfair Display', Georgia, serif", bodyFont: "'Mulish', Arial, Helvetica, sans-serif",
    treatment: 'Airy and feminine-premium. Soft blush palette, lots of white space, a delicate serif headline, rounded card with a very soft shadow. Dusty-rose button. Gentle, gift-y, emotional. Perfect for romance / madres / aniversario angles.',
  },
  {
    id: 'clean_modern', name: 'Clean Modern', blurb: 'Apple/Linear clarity & precision',
    palette: { bg: '#f5f6f8', surface: '#ffffff', ink: '#0f172a', sub: '#64748b', accent: '#4f46e5', accent2: '#3730a3' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    headingFont: "'Inter', -apple-system, Arial, sans-serif", bodyFont: "'Inter', -apple-system, Arial, Helvetica, sans-serif",
    treatment: 'Crisp Apple/Linear-grade clarity. Pure white card on light gray, precise spacing, a confident sans headline, subtle indigo accent. Single accent color used sparingly. Feels like a top SaaS product email — trustworthy and sharp.',
  },
  {
    id: 'neon_retro', name: 'Neon Retro', blurb: 'Synthwave, 80s neon on deep purple',
    palette: { bg: '#1a0b2e', surface: '#241046', ink: '#f3e9ff', sub: '#b39ddb', accent: '#ff2e88', accent2: '#22d3ee' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Audiowide&family=Rajdhani:wght@400;500;600&display=swap',
    headingFont: "'Audiowide', 'Arial Black', Arial, sans-serif", bodyFont: "'Rajdhani', Arial, Helvetica, sans-serif",
    treatment: 'TASTEFUL synthwave on deep purple — moody and premium, not a clip-art arcade. ONE neon accent (magenta) used sparingly as a glow and on the button; deep purple does the heavy lifting with lots of negative space. A single thin horizon/grid accent line is fine; NO rainbow gradients, NO emoji rows. Use the Audiowide display face only for a small wordmark or short eyebrow label, never for long text. Electric but restrained and very readable.',
  },
  {
    id: 'earthy_organic', name: 'Earthy Organic', blurb: 'Natural, sustainable, warm greens',
    palette: { bg: '#f1f0e7', surface: '#fbfaf3', ink: '#2c3327', sub: '#5f6b54', accent: '#5a7a4a', accent2: '#3f5a33' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,500;0,600;1,500&family=Karla:wght@400;500&display=swap',
    headingFont: "'Spectral', Georgia, serif", bodyFont: "'Karla', Arial, Helvetica, sans-serif",
    treatment: 'Calm, natural, warm. Muted sage greens on a soft natural paper background. Organic serif headline, generous breathing room, a small leaf-simple wordmark. Grounded and sincere. Button in deep sage. Good for nostalgia / family / "just because" warmth.',
  },
  {
    id: 'royal_deep', name: 'Royal Deep', blurb: 'Deep navy, silver, commanding presence',
    palette: { bg: '#0d1b2a', surface: '#16263b', ink: '#eef3f8', sub: '#9fb3c8', accent: '#c9a227', accent2: '#1f6feb' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Marcellus&family=Mulish:wght@400;500&display=swap',
    headingFont: "'Marcellus', Georgia, serif", bodyFont: "'Mulish', Arial, Helvetica, sans-serif",
    treatment: 'Deep navy with a commanding, stately presence. Refined classical serif headline, thin gold/silver rules, a crest-like centered wordmark. Authoritative and premium, like a gala invitation. Gold button. Great for bodas / XV años / aniversarios.',
  },
  {
    id: 'vibrant_fiesta', name: 'Cálido Fiesta', blurb: 'Warm celebration — refined, not a party flyer',
    palette: { bg: '#fbf3e7', surface: '#fffdf9', ink: '#33223a', sub: '#8a6f72', accent: '#d9544e', accent2: '#e0922b' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Nunito+Sans:wght@400;500;600&display=swap',
    headingFont: "'Fraunces', Georgia, serif", bodyFont: "'Nunito Sans', Arial, Helvetica, sans-serif",
    treatment: 'A SOPHISTICATED warm celebration — think a boutique greeting-card brand, NOT a kids party or a promo blast. Warm cream base, a confident characterful serif headline, terracotta + marigold used as SPARING accents (a rule, the button, one emphasized word) against the calm cream. Absolutely NO emoji rows, NO confetti, NO rainbow gradient strips, NO loud full-width saturated bands. Joy expressed through warmth and elegance. Great for cumpleaños / celebrations / family moments.',
  },
  {
    id: 'minimal_zen', name: 'Minimal Zen', blurb: 'Japanese-inspired, ultra-minimal, serene',
    palette: { bg: '#fbfbf9', surface: '#ffffff', ink: '#1c1c1a', sub: '#7a7a73', accent: '#b45f4d', accent2: '#1c1c1a' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Cardo:wght@400;700&family=Outfit:wght@300;400;500&display=swap',
    headingFont: "'Cardo', Georgia, serif", bodyFont: "'Outfit', Arial, Helvetica, sans-serif",
    treatment: 'Ultra-minimal, serene, Japanese-inspired. Vast white space, one small terracotta accent mark, a quiet centered serif headline, very light body weight. Almost no chrome. Lets a single emotional line breathe. Understated, calm, gallery-grade restraint.',
  },
  {
    id: 'romantico_calido', name: 'Romántico Cálido', blurb: 'Sunset warmth, tender & heartfelt',
    palette: { bg: '#fdf1ec', surface: '#fff7f3', ink: '#3a241f', sub: '#8a665b', accent: '#e0654a', accent2: '#b83b6d' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Nunito+Sans:wght@400;500&display=swap',
    headingFont: "'Cormorant Garamond', Georgia, serif", bodyFont: "'Nunito Sans', Arial, Helvetica, sans-serif",
    treatment: 'Tender, heartfelt, sunset warmth. Peach-to-rose tones, a romantic italic-accented serif headline, soft rounded card. Emotional and intimate without being saccharine. Sunset-coral button. Built for love songs, aniversarios, "para esa persona especial".',
  },
  {
    id: 'midnight_serenade', name: 'Midnight Serenade', blurb: 'Moody indigo, spotlit & musical',
    palette: { bg: '#11091f', surface: '#1c1233', ink: '#f1ecff', sub: '#a99bd0', accent: '#f5b14c', accent2: '#7c5cff' },
    fontHref: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,500&family=Jost:wght@400;500&display=swap',
    headingFont: "'Playfair Display', Georgia, serif", bodyFont: "'Jost', Arial, Helvetica, sans-serif",
    treatment: 'Moody late-night serenade. Deep indigo canvas with a warm amber "spotlight" glow (soft radial/solid accent), an elegant serif headline catching the light. Musical and romantic. Amber button. The feeling of a song played under a window at night.',
  },
];

const styleById = (id?: string) => STYLES.find((s) => s.id === id) || STYLES[0];

// ===========================================================================
// DESIGN PHILOSOPHY + MANDATORY BLUEPRINT — shared by the design & refine
// passes. This is what separates a premium email from generic-template slop.
// ===========================================================================
const DESIGN_PHILOSOPHY = `DESIGN PHILOSOPHY — Regalos Que Cantan is a PREMIUM brand, and this is a SALES email that must CONVERT.
- Design a high-converting DTC PRODUCT email — a premium product page in an inbox, NOT a newsletter or an article. The reader is deciding whether to BUY, not to read.
- SELL, don't narrate. MINIMAL text. Big emotional hook, then the offer, the price, and the button. The whole email must be scannable in ~5 seconds and pull the eye straight to the CTA.
- REPEAT THE CTA (near the top AND at the bottom). Make the price and the "escúchala GRATIS antes de pagar" risk-reversal impossible to miss. Never make someone scroll back up to buy.
- Still PREMIUM, never tacky: like a great Apple / boutique-DTC product email — NEVER a generic promo blast, a MailChimp template, a party flyer, or a kids' card.
- NEGATIVE SPACE is still a tool — but in service of focus (hero + offer + buttons), not of a long quiet read. Confident, punchy, uncluttered.
- COLOR WITH RESTRAINT: anchor on a sophisticated base (the style's bg / surface / ink) and use the accent SPARINGLY for emphasis — one rule, the button, one highlighted word. Even "vibrant" styles must feel refined, not saturated all over. NEVER make a loud full-width gradient band the dominant element.
- NO RAINBOW or multi-color gradients/hairlines. Any gradient is subtle and 2-TONE, drawn only from the style's palette, used on at most the button plus one soft glow.
- EMOJI: at most ONE small, tasteful glyph in the entire email (or none). NEVER emoji rows, confetti strips, a giant hero emoji, or an emoji in every section. Prefer typographic flourishes (a small ♪, ✦, a short rule) over emoji.
- TYPOGRAPHY does the heavy lifting: a confident scale (headline ~38–46px), generous line-height (~1.7 on body), letter-spacing on small-caps labels, italic for emotional emphasis. Make ONE word or line the hero.
- Every decorative element must earn its place. If anything looks like clip-art or a default template, delete it. Taste over decoration.`;

const BLUEPRINT = `STRUCTURE — build a HIGH-CONVERTING product email (a great DTC promo / mini landing page in an inbox), all email-safe <table> layouts, in this order. Keep BODY TEXT MINIMAL throughout — mostly hero + offer + buttons.
1. Hidden preheader (preview text + &nbsp;‌ spacer entities).
2. HEADER: the "Regalos Que Cantan" wordmark, understated (small, a tiny ♪ or short rule) — not a loud banner.
3. HERO: an optional tiny eyebrow/kicker (uppercase, letter-spaced, accent); a LARGE emotional headline (~38–46px) with ONE italic/accent emphasis line; ONE short subhead line that turns the emotion into the offer. That's the whole hook — no paragraphs here.
4. PRIMARY CTA, HIGH (above the fold): a bold bulletproof pill button (solid color + subtle 2-tone gradient + soft shadow, generous padding), with a small risk-reversal line right under it: "Escúchala completa GRATIS antes de pagar."
5. OFFER / BENEFITS: 3 ultra-short benefits (≤6 words each) as a scannable row or tight list with SMALL tasteful markers (a dot/rule, not a big emoji each) — what they get. Minimal words.
6. TRUST strip: the real proof points as small badges — "GRATIS antes de pagar · Lista en ~3 min · Tuya para siempre". NO invented review counts, stars or testimonials.
7. PRICE: state it clearly and confidently as part of the value (e.g. "Desde $29.99" or the offer's price) — impossible to miss.
8. URGENCY line when there's a relevant date (centered, accent) — e.g. "Solo faltan 9 días para el Día del Padre."
9. SECONDARY CTA: repeat the pill button + the risk-reversal line — never make them scroll back up to buy.
10. FOOTER: small wordmark, a hairline, the compliance line, and the {{UNSUB_URL}} unsubscribe link.
Drive EVERY element toward the button. Include @media (max-width:620px) rules that scale the headline, reduce padding, and keep the buttons big and easy to tap.`;

// ===========================================================================
// PRODUCT CATALOG — the PROVEN, fulfillable products the emails may pitch. Each
// email features ONE (rotated across the batch). Animado/story-video is
// DELIBERATELY EXCLUDED: its render engine isn't deployed, so a purchase would
// never fulfill. Add it here only once STORY_RENDERER_URL is live.
// ===========================================================================
const GTS = 'https://giftsthatsing.com';
type Product = { label: string; price: string; url: string; english?: boolean; pitch: string };
const PRODUCTS: Record<string, Product> = {
  song:        { label: 'Canción personalizada', price: OFFERS.single,   url: SITE, pitch: 'Una canción original hecha para UNA persona, en su género (corrido, corrido tumbado, banda, norteño, mariachi, bachata, cumbia…). Escúchala GRATIS antes de pagar, lista en ~3 min, tuya para siempre.' },
  two_pack:    { label: '2-Pack de canciones',    price: OFFERS.twoPack,  url: SITE, pitch: 'Dos canciones (p. ej. una para mamá y otra para papá, o para la pareja). El mejor valor para dos personas.' },
  three_pack:  { label: '3-Pack de canciones',    price: OFFERS.threePack,url: SITE, pitch: 'Tres canciones — el paquete para toda la familia.' },
  video_addon: { label: 'Video con foto',         price: OFFERS.videoAddon,url: SITE, pitch: 'Convierte la canción en un video animado con SUS fotos y un mensaje grabado por ti — un recuerdo para llorar. (Nuestro complemento más vendido.)' },
  lyric_video: { label: 'Video con letra',        price: OFFERS.lyricVideo,url: SITE, pitch: 'La canción con la letra en pantalla, sincronizada — perfecta para compartir por WhatsApp y que todos la canten.' },
  karaoke:     { label: 'Pista instrumental',     price: '$7.99',         url: SITE, pitch: 'La canción sin voz, para cantarla tú mismo / karaoke en la fiesta.' },
  english_platform: { label: 'Gifts That Sing (en inglés)', price: '$29.99', url: GTS, english: true, pitch: 'Nuestra plataforma en INGLÉS: para regalar una canción en inglés a familiares o amigos que hablan inglés. Mismo proceso, en giftsthatsing.com. (El botón lleva a giftsthatsing.com, NO al sitio en español.)' },
};
const productById = (id?: string) => PRODUCTS[id || 'song'] || PRODUCTS.song;

// ===========================================================================
// LAYOUT ARCHETYPES — the structural "shape" of the email, on top of the style
// (color/type). Inspired by premium DTC best-seller / cross-sell emails.
// ===========================================================================
const LAYOUTS: Record<string, string> = {
  hero: 'SINGLE-PRODUCT HERO (default): big emotional headline → early CTA → 3 benefits → price → repeat CTA. One product.',
  feature_callout: `FEATURE-CALLOUT "best seller" layout (like a premium DTC "our best seller for a reason" email): a large CENTERED product hero (use the provided image if any; otherwise a tasteful framed block) with 3-4 short benefit LABELS arranged around/beside it, each connected to the hero by a THIN dashed line or a small "→" (email-safe: use thin bordered cells, dotted borders and small arrow glyphs — NOT SVG). A bold editorial headline above and a prominent CTA pill with the price below. Lots of negative space. The benefits are the callout labels.`,
  cross_sell: `CROSS-SELL STACK (like a bold "best sellers / game changer" email): a bold editorial headline + one short truthful trust line at the top, then a VERTICAL STACK of the PRODUCT LINEUP rows provided. Each row = a small square product thumb/accent on one side and, on the other, the product name, a one-line description, its price, and a small "Ver" button linking to its URL. A final primary CTA at the bottom. Show every product in the lineup.`,
  best_sellers: `BEST-SELLERS CATALOG: a bold editorial headline + subhead, then a clean 2-column grid of compact cards (the "most requested" genres/occasions listed in the copy), each card a label + tiny accent rule, and ONE primary CTA below the grid. Editorial and uncluttered.`,
};
const LAYOUT_IDS = Object.keys(LAYOUTS);

// A curated 3-product lineup for the cross_sell layout (all proven & fulfillable).
function crossSellLineup(): string {
  return ['song', 'video_addon', 'lyric_video'].map((id) => {
    const p = PRODUCTS[id];
    return `- ${p.label} — ${p.price} — ${p.pitch.split('.')[0]}. (button link: ${p.url})`;
  }).join('\n');
}

// ===========================================================================
// PASS 1 — STRATEGY & COPY (also picks a distinct style per email)
// ===========================================================================
const PASS1_TOOL = {
  name: 'emit_email_batch',
  description: "Emit this week's promotional emails with copy and a chosen visual style for each.",
  input_schema: {
    type: 'object',
    properties: {
      emails: {
        type: 'array',
        minItems: 3,
        maxItems: 4,
        description: 'Between 3 and 4 emails. Each a DIFFERENT reason/angle, a DIFFERENT featured product, and a DIFFERENT visual style. Rotate products across runs; feature the english_platform sometimes. At least one of the batch should have use_image=true.',
        items: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'The hook/occasion this email is built on (e.g. "Día del Padre is in 9 days", "Just because Monday", "Evergreen: gift yourself a corrido with your own name").' },
            featured_product: { type: 'string', enum: Object.keys(PRODUCTS), description: 'The ONE product this email pitches. Rotate across the batch so the week teaches the whole catalog: mostly "song", but regularly surface video_addon / lyric_video / karaoke / two_pack / three_pack, and occasionally "english_platform" (giftsthatsing.com). Each email a different product.' },
            style_id: { type: 'string', enum: STYLES.map((s) => s.id), description: 'The visual style (typography + color + sophistication) for this email, chosen so its MOOD complements the occasion. Each email in the batch must use a different style.' },
            layout: { type: 'string', enum: LAYOUT_IDS, description: 'The structural LAYOUT of the email. Vary it across the batch: hero (single product), feature_callout (a product with dashed benefit callouts), cross_sell (a stacked lineup of song + video + lyric video), best_sellers (a grid of the most-requested genres). Use cross_sell / best_sellers for round-ups, hero / feature_callout for a single occasion or product.' },
            use_image: { type: 'boolean', description: 'Whether this email has a photographic hero image. You MUST set use_image=true for AT LEAST HALF of the batch (e.g. 3 of 6), and provide an image_prompt for each of those. The rest are text-only (they look premium/editorial). Do NOT make the whole batch text-only.' },
            image_prompt: { type: 'string', description: 'If use_image is true: a photoreal, emotional image-generation prompt relevant to THIS product + occasion + emotion. Wholesome, warm, cinematic. Absolutely NO text, words, letters, logos or captions in the image. e.g. "warm cinematic photo, a Latino family gathered around a phone listening to music at a birthday party, golden hour, happy tears, shallow depth of field". Empty if use_image is false.' },
            occasion_theme: { type: 'string', description: 'The OCCASION color story + a tasteful motif for THIS reason/date, which drives the palette. E.g. "4 de Julio: deep navy + red + cream, one subtle star or thin stripe accent — elegant, NOT flag clip-art"; "Navidad: forest green + deep red + gold, a subtle pine/ornament"; "Día de Muertos: deep purple + marigold + magenta, subtle papel-picado". Leave EMPTY for evergreen / "just because" sends, where the style\'s own palette leads.' },
            subject: { type: 'string', description: 'Enticing Spanish subject line, <=55 chars, high open-rate. Emoji optional.' },
            preview_text: { type: 'string', description: 'Spanish preview/preheader, <=100 chars, complements the subject.' },
            headline: { type: 'string', description: 'Big emotional Spanish headline — the hook for the occasion. Short and punchy.' },
            subhead: { type: 'string', description: 'ONE short Spanish line that turns the emotion into the offer (e.g. "…regálale una canción hecha solo para él"). Not a label.' },
            body_md: { type: 'string', description: 'MINIMAL Spanish body — 1-2 SHORT punchy lines only (≤35 words total) that sell the feeling and the angle, then get out of the way. This is a SALES email, NOT a story. No long paragraphs, no recipient names.' },
            benefits: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3, description: 'Exactly 3 ultra-short scannable benefits (≤6 words each), truthful, e.g. ["Su nombre en cada verso","Lista en ~3 minutos","Tuya para siempre"].' },
            urgency: { type: 'string', description: 'Short Spanish urgency line tied to the date when relevant (e.g. "Solo faltan 9 días para el Día del Padre"). May be empty for evergreen/"just because" sends.' },
            cta_text: { type: 'string', description: 'Action-driven Spanish button text, e.g. "Crear su canción" or "Escuchar un ejemplo gratis".' },
          },
          required: ['reason', 'featured_product', 'style_id', 'subject', 'preview_text', 'headline', 'body_md', 'benefits', 'cta_text'],
        },
      },
    },
    required: ['emails'],
  },
};

const PASS1_SYSTEM = `You are the email marketing strategist for "Regalos Que Cantan" (regalosquecantan.com), a US-Hispanic brand selling personalized AI-generated Spanish songs as emotional gifts. You write the weekly promotional emails to past customers.

${BRAND_BRIEF}

Your job each week: find 3-4 genuinely good REASONS to email and write a designed promo email for each. Be creative:
- Upcoming holidays & key dates (Hispanic + US): Día de las Madres, Día del Padre, Día del Amor y la Amistad, 4 de Julio, cumpleaños season, aniversarios, bodas, XV años, graduaciones, Navidad, Año Nuevo, Día de los Abuelos, Día del Niño, Día de Muertos, etc.
- Cultural / emotional moments, "just because" angles, nostalgia, "the gift they'll never forget".
- If NOTHING notable is coming up, do EVERGREEN / creative product-led angles — a random day is a perfect surprise. e.g. "Regálate un corrido con TU propio nombre", "Sorpréndelo un martes cualquiera, sin razón", "El nombre de tu mamá suena increíble en una banda". Always have something worth sending.
- Always frame the offer as "the BEST gift to give" and explain WHY it wins. Weave in ONE real proof point per email (do not list them all).

PRODUCT ROTATION — feature EXACTLY ONE product per email and rotate across the batch so a week teaches the whole catalog. Set featured_product and pitch THAT product (its price/benefits/CTA adapt automatically). Available (all proven & fulfillable):
${Object.entries(PRODUCTS).map(([id, p]) => `- ${id} (${p.price}) — ${p.label}: ${p.pitch}`).join('\n')}
Rotation guidance: mostly the core "song", but regularly surface video_addon (top seller), lyric_video, karaoke, and the 2/3-pack bundles; and OCCASIONALLY (about 1 in 4-5 emails) feature "english_platform" — pitched IN Spanish, as "for your English-speaking family/friends, gift a song in English at giftsthatsing.com" (its CTA button goes to giftsthatsing.com, not the Spanish site). Do NOT mention Animado / película animada — it is not available.

For EACH email pick a visual style from this library whose MOOD complements the occasion (a different style per email). The style governs typography/layout/sophistication; the OCCASION governs the color story:
${STYLES.map((s) => `- ${s.id} — ${s.name}: ${s.blurb}`).join('\n')}

OCCASION-AWARE COLOR — be conscious of the actual date and what each email is FOR, and set occasion_theme to that occasion's real color story + a tasteful motif. Reference (adapt, keep it elegant — never flag/clip-art/stereotype):
- 4 de Julio / Independence Day: deep navy + red + cream, a subtle star or thin stripe.
- Navidad: forest green + deep red + gold; subtle pine/ornament/snow.
- Año Nuevo: midnight/black + gold; fine metallic sparkle.
- San Valentín / Amor y Amistad: deep red + rose + blush; a subtle heart.
- Día de las Madres: soft rose + cream + gold; delicate floral.
- Día del Padre: navy/charcoal + amber/tan; understated, warm.
- Día de Muertos: deep purple + marigold + magenta; subtle papel-picado.
- Halloween: charcoal + burnt orange + deep purple.
- Thanksgiving / otoño: rust + amber + cream + brown.
- Primavera / Pascua: soft pastels + fresh green.
- Graduación: navy + gold.
- Cumpleaños & "just because": leave occasion_theme EMPTY — let the style's own palette lead.
Pick a base style that WON'T fight the occasion colors (e.g. for 4 de Julio use a clean/bold/luxury style, not a warm terracotta one).

COPY CRAFT — write like a top DTC direct-response marketer, in natural US-Hispanic Spanish. These are SALES emails, not newsletters. MINIMAL text, maximum pull:
- HEADLINE: one emotional, benefit-driven hook tied to the occasion — make them FEEL it in one glance.
- SUBHEAD: ONE short line that turns the feeling into the offer ("…regálale una canción hecha solo para ella").
- BODY: 1-2 SHORT punchy lines only (≤35 words total). Sell the emotion and the angle, then get out of the way. NO story paragraphs — the reader is deciding to BUY, not to read.
- BENEFITS: exactly 3 ultra-short scannable benefits (≤6 words each). Concrete and truthful.
- URGENCY: a short line tied to the date when there is one ("Solo faltan 9 días para el Día del Padre"); empty for evergreen sends.
- RISK-REVERSAL is the hero proof point: lean on "Escúchala completa GRATIS antes de pagar" near the CTA.
- TRUTHFUL ONLY: use the real proof points (escúchala gratis antes de pagar / lista en ~3 min / hecha solo para esa persona / tuya para siempre). NEVER invent review counts, star ratings, testimonials or customer numbers.
- CTA: action + outcome ("Crear su canción", "Escuchar un ejemplo gratis"). Assume they're one tap from buying.

Tone: warm and emotional but PUNCHY and sales-driven — like a great Facebook ad + product page, in Mexican/US-Hispanic Spanish. No recipient names. Each email a distinct angle, emotion, and style.

Use the date you're given to anchor what's actually coming up this week and the next few weeks.`;

async function callAnthropic(payload: Record<string, unknown>): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// FEEDBACK LOOP — real results of recent campaigns, injected into Pass 1 so
// each Monday's strategist learns from what actually opened, clicked and SOLD
// instead of drafting blind. Opens/clicks from SendGrid category stats (per
// campaign_key), attributed revenue from the email_campaign_revenue RPC (UTM
// join to Stripe orders). Fails soft: any error returns '' and the batch
// drafts exactly as before.
async function pastPerformanceBlock(supabase: any): Promise<string> {
  try {
    const { data: rows } = await supabase.from('email_queue')
      .select('subject, reason, segment, campaign_key, recipients_sent, sent_at')
      .in('status', ['sent', 'sending']).not('campaign_key', 'is', null)
      .order('created_at', { ascending: false }).limit(8);
    const campaigns = rows || [];
    if (!campaigns.length) return '';

    const revByKey: Record<string, { orders: number; revenue: number }> = {};
    try {
      const { data: revRows } = await supabase.rpc('email_campaign_revenue');
      for (const r of revRows || []) revByKey[r.campaign_key] = { orders: Number(r.orders), revenue: Number(r.revenue) };
    } catch (e) { console.warn('email_campaign_revenue failed', e); }

    // SendGrid category stats, summed over each campaign's lifetime.
    const metrics: Record<string, { delivered: number; opens: number; clicks: number }> = {};
    if (SENDGRID_API_KEY) {
      const keys = campaigns.map((c: any) => c.campaign_key).filter(Boolean);
      const earliest = campaigns.reduce((min: string, c: any) => {
        const d = (c.sent_at || '').slice(0, 10);
        return d && (!min || d < min) ? d : min;
      }, '') || new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
      const end = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < keys.length; i += 10) {
        const qs = new URLSearchParams({ start_date: earliest, end_date: end, aggregated_by: 'day' });
        for (const k of keys.slice(i, i + 10)) qs.append('categories', k);
        try {
          const res = await fetch(`https://api.sendgrid.com/v3/categories/stats?${qs}`, {
            headers: { 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
          });
          if (!res.ok) continue;
          for (const day of (await res.json()) || []) {
            for (const s of day.stats || []) {
              const m = (metrics[s.name] ||= { delivered: 0, opens: 0, clicks: 0 });
              m.delivered += Number(s.metrics?.delivered || 0);
              m.opens += Number(s.metrics?.unique_opens || 0);
              m.clicks += Number(s.metrics?.unique_clicks || 0);
            }
          }
        } catch (e) { console.warn('sg stats chunk failed', e); }
      }
    }

    const lines = campaigns.map((c: any) => {
      const m = metrics[c.campaign_key];
      const openPct = m?.delivered ? `${Math.round((m.opens / m.delivered) * 100)}% open` : null;
      const clickPct = m?.delivered ? `${((m.clicks / m.delivered) * 100).toFixed(1)}% click` : null;
      const rev = revByKey[c.campaign_key];
      const parts = [
        `"${c.subject}"`,
        c.sent_at ? `sent ${String(c.sent_at).slice(0, 10)}` : 'sending',
        c.recipients_sent ? `${c.recipients_sent} delivered` : null,
        openPct, clickPct,
        rev && rev.orders ? `→ ${rev.orders} order(s), $${Math.round(rev.revenue)} attributed` : '→ $0 attributed',
      ].filter(Boolean);
      return `- ${parts.join(' · ')}${c.reason ? `  [angle: ${c.reason}]` : ''}`;
    });
    return `\n\nREAL RESULTS OF YOUR RECENT CAMPAIGNS (your own track record — read it before drafting):
${lines.join('\n')}
LEARN FROM IT: lean toward the subject styles, angles, occasions and featured products that opened, clicked and SOLD; avoid repeating what flopped; NEVER reuse a recent subject line. If everything shows $0 attributed, treat open/click as the signal.`;
  } catch (e) {
    console.warn('pastPerformanceBlock failed', e);
    return '';
  }
}

async function pass1Copy(weekOf: string, perfBlock = ''): Promise<any[]> {
  const data = await callAnthropic({
    model: MODEL, max_tokens: 12000, system: PASS1_SYSTEM, tools: [PASS1_TOOL],
    tool_choice: { type: 'tool', name: 'emit_email_batch' },
    messages: [{ role: 'user', content: `Today is ${weekOf}. Draft 3-4 promotional emails. Find the best reasons to send (upcoming holidays/dates in the next few weeks, plus a creative "just because"/evergreen angle), rotate the featured product (vary across song, video_addon, lyric_video, karaoke, a bundle, or english_platform), mark at least one with use_image=true (with an image_prompt), write genuinely enticing sales copy, and assign each a fitting, distinct visual style.${perfBlock}` }],
  });
  if (data.stop_reason === 'max_tokens') throw new Error('Pass 1 truncated (max_tokens) — raise max_tokens');
  const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
  if (!tu) throw new Error('Pass 1 returned no tool_use');
  // Defensive: the tool input is normally { emails: [...] }, but a truncated or
  // malformed call can yield a string or object — coerce to a clean array.
  let emails: any = tu.input?.emails;
  if (typeof emails === 'string') { try { emails = JSON.parse(emails); } catch { emails = []; } }
  return Array.isArray(emails) ? emails : [];
}

// ===========================================================================
// PASS 2 — DESIGN (full email-safe HTML per email, in the chosen style)
// ===========================================================================
const PASS2_TOOL = {
  name: 'emit_email_html',
  description: 'Emit the complete, email-safe HTML document for this email.',
  input_schema: {
    type: 'object',
    properties: { html: { type: 'string', description: 'The complete HTML document, from <!DOCTYPE html> to </html>.' } },
    required: ['html'],
  },
};

const EMAIL_SAFE_RULES = `EMAIL-SAFE HTML RULES (this renders in Gmail, Outlook, Apple Mail — NOT a browser):
- Layout MUST be <table role="presentation"> based, centered, max-width 600px. NO flexbox, NO grid, NO position, NO floats.
- ALL styling INLINE via style="" attributes. You may also include a <style> block in <head> for @font-face/web fonts and a couple of media queries, but never rely on it — inline styles must stand alone.
- Web fonts work only in some clients. For EVERY text element set font-family to the web font FIRST then a safe fallback stack, so Gmail/Outlook still look intentional.
- Gradients: Outlook ignores them. Always set a SOLID background-color first, then layer the gradient via background-image so it degrades gracefully. Same for the button.
- Use a bulletproof button: an <a> styled as a block with padding, solid background-color, border-radius, bold text. The CTA link href must be the site URL provided. Wrap each button in an Outlook VML fallback so Outlook renders it too:
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="BUTTON_URL" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="50%" stroke="f" fillcolor="ACCENT_COLOR"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">BUTTON_TEXT</center></v:roundrect><![endif]--><!--[if !mso]><!--> [the styled <a> button] <!--<![endif]-->
- DARK MODE: in the <style> block add @media (prefers-color-scheme: dark) overrides using !important, with classes on the outer background cell (dm-bg), the main content card (dm-card), primary text (dm-text) and the footer (dm-foot) — colors adapted from the style's own palette so Gmail/Apple Mail forced dark mode keeps the email on-brand (for already-dark styles keep the overrides close to the existing palette).
- Images are optional; if used, always include width, height and alt, and never make the email depend on an image loading. No background images for critical content.
- Include a hidden preheader div at the very top of <body> containing the preview text.
- Include a footer with the brand wordmark, the compliance line "Recibes este correo porque creaste una canción con Regalos Que Cantan." and an unsubscribe link whose href is EXACTLY {{UNSUB_URL}} (literal — it is replaced per recipient at send time). This footer is mandatory.
- No <script>, no external JS, no forms.
- Keep total HTML reasonable; do not pad with filler.`;

async function pass2Design(e: any, style: Style, imageUrl?: string | null): Promise<string> {
  const product = productById(e.featured_product);
  const system = `You are an elite email designer with impeccable taste — your work looks like a premium DTC / editorial brand, never a generic promo template. You design for "Regalos Que Cantan" (personalized Spanish songs as gifts, ${OFFERS.site}).

You will be given the finished Spanish COPY and a STYLE brief. Render ONE complete email-safe HTML document that brings the copy to life in that exact style and looks genuinely high-end. Output Spanish text exactly as given (you may fix obvious spacing only). The wordmark is the text "Regalos Que Cantan".

${DESIGN_PHILOSOPHY}

${BLUEPRINT}

${EMAIL_SAFE_RULES}

After composing, silently re-check your HTML against the philosophy, blueprint and rules above — delete anything that looks like clip-art, a party flyer, emoji spam, or a default template — then emit.`;

  const occasionBlock = (e.occasion_theme || '').trim()
    ? `OCCASION THEME (drives the COLOR STORY — this takes PRIORITY over the style's palette): ${e.occasion_theme}
→ Recolor the design around these occasion colors while KEEPING the style's typography, layout and premium restraint. Weave the motif in SUBTLY (one small star / heart / ornament / stripe accent — never clip-art, flags plastered everywhere, or stereotype). It must still look expensive.`
    : `No special occasion theme — use the style's own palette below.`;

  const styleBrief = `STYLE (typography + layout + sophistication): ${style.name} — ${style.blurb}
Art direction: ${style.treatment}
${occasionBlock}
Base palette (use as-is when there's no occasion theme; otherwise adapt to the occasion colors): background ${style.palette.bg}, surface/card ${style.palette.surface}, primary text ${style.palette.ink}, secondary text ${style.palette.sub}, accent ${style.palette.accent}, secondary accent ${style.palette.accent2}.
Heading font-family: ${style.headingFont}
Body font-family: ${style.bodyFont}
Web font <link> for <head> (include it): <link rel="preconnect" href="https://fonts.googleapis.com"><link href="${style.fontHref}" rel="stylesheet">`;

  const layoutId = LAYOUTS[e.layout] ? e.layout : 'hero';
  const layoutBlock = `LAYOUT (this OVERRIDES the default single-hero structure — build the email in this shape): ${LAYOUTS[layoutId]}${layoutId === 'cross_sell' ? `\nPRODUCT LINEUP (show each as a row):\n${crossSellLineup()}` : ''}`;
  const benefits = Array.isArray(e.benefits) ? e.benefits.filter(Boolean) : [];
  const imageBlock = imageUrl
    ? `HERO IMAGE (place near the top, e.g. under the wordmark / above or beside the headline): a full-card-width <img src="${imageUrl}"> with width, height (approx 600x340), rounded corners to match the card, and alt text describing the scene. IMPORTANT: the email must still fully sell if the image is blocked — keep the headline, price, benefits and CTA as live text, never inside the image.`
    : `NO hero image for this email — design it as a clean, premium text + type layout.`;
  const copy = `${layoutBlock}
FEATURED PRODUCT: ${product.label} — ${product.pitch}${product.english ? ' NOTE: the CTA button must link to giftsthatsing.com (the English site).' : ''}
${imageBlock}
SUBJECT: ${e.subject || ''}
PREVIEW TEXT (preheader): ${e.preview_text || ''}
HEADLINE: ${e.headline || ''}
SUBHEAD: ${e.subhead || ''}
BODY (keep minimal — 1-2 short lines): ${e.body_md || ''}
BENEFITS (render as the scannable 3-up offer row/list): ${benefits.length ? benefits.map((b: string) => `• ${b}`).join('  ') : '• Su nombre en cada verso  • Lista en ~3 minutos  • Tuya para siempre'}
TRUST BADGES (render as small proof strip): Escúchala GRATIS antes de pagar · Lista en ~3 min · Tuya para siempre
PRICE (show it clearly): ${product.price}
URGENCY (render only if non-empty): ${e.urgency || ''}
CTA BUTTON TEXT (use for BOTH the top and bottom buttons): ${e.cta_text || 'Crear su canción'}
CTA LINK (button href — use EXACTLY this): ${product.url}`;

  const data = await callAnthropic({
    model: MODEL, max_tokens: 8000, system, tools: [PASS2_TOOL],
    tool_choice: { type: 'tool', name: 'emit_email_html' },
    messages: [{ role: 'user', content: `${styleBrief}\n\n${copy}\n\nDesign and emit the complete HTML email now.` }],
  });
  const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
  if (!tu?.input?.html) throw new Error('Pass 2 returned no html');
  return tu.input.html;
}

// ===========================================================================
// PASS 3 — ART-DIRECTOR REFINE. Harshly critique the designed email and emit a
// polished, more premium version. This is the "second design pass" that lifts
// the quality floor so every style lands, not just the dark/elegant ones.
// ===========================================================================
async function pass3Refine(html: string, style: Style, e: any): Promise<string> {
  const occasionNote = (e?.occasion_theme || '').trim()
    ? `This email is themed for an OCCASION: ${e.occasion_theme}. PRESERVE those occasion colors and the subtle motif — do NOT revert to a generic palette; just make them more elegant.`
    : '';
  const layoutNote = e?.layout && e.layout !== 'hero'
    ? `This email uses a specific LAYOUT (${e.layout}): ${LAYOUTS[e.layout] || ''} PRESERVE this layout/structure — do NOT collapse it into a plain single-hero email; just make it more polished and premium.`
    : '';
  const system = `You are a world-class email ART DIRECTOR with impeccable, restrained taste, reviewing a PREMIUM but SALES-DRIVEN email for "Regalos Que Cantan". Your job: make it both more beautiful AND more likely to convert.

Critique the email HARSHLY and silently against the philosophy below — hunt for generic-template slop (emoji spam/rows/giant emoji, rainbow or multi-color gradients, loud saturated bands, weak hierarchy, cramped spacing, childish/bubble body fonts, clip-art) AND for weak selling (buried or single CTA, hidden price, no risk-reversal, too much text). Then emit ONE improved HTML email that fixes every issue: tighten copy, sharpen hierarchy toward the button, ensure the CTA appears near the TOP and again at the BOTTOM, and the price + "escúchala GRATIS antes de pagar" are unmissable.

HARD CONSTRAINTS: keep it email-safe (table-based, inline styles); keep the same style/typography and the occasion color story; keep ALL Spanish copy wording and the CTA link unchanged; keep the literal {{UNSUB_URL}} unsubscribe link in the footer; if there is a hero <img>, KEEP it and its exact src (never make critical info depend on it loading); do not add emoji. ${occasionNote} ${layoutNote}

${DESIGN_PHILOSOPHY}

${EMAIL_SAFE_RULES}

Style being refined: ${style.name} — ${style.treatment}`;

  const data = await callAnthropic({
    model: MODEL, max_tokens: 8000, system, tools: [PASS2_TOOL],
    tool_choice: { type: 'tool', name: 'emit_email_html' },
    messages: [{ role: 'user', content: `Here is the email to refine:\n\n${html}\n\nCritique it against the philosophy, then emit the improved, more premium HTML.` }],
  });
  const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
  if (!tu?.input?.html) throw new Error('Pass 3 returned no html');
  return tu.input.html;
}

// Generate a photographic hero image via Kie GPT Image 2, store it in the public
// creative-studio bucket, and return its URL. Returns null on any failure — the
// email then renders text-only (images are always an enhancement, never required).
async function generateHeroImage(supabase: any, prompt: string, key: string): Promise<string | null> {
  if (!KIE_IMAGE_ENABLED || !prompt) return null;
  try {
    const bytes = await kiePhotoBytes(`${prompt}. Photoreal, warm, cinematic, wholesome, tasteful. Absolutely NO text, words, letters, captions or logos anywhere in the image.`, '3:2');
    if (!bytes) return null;
    const path = `email/${key}.png`;
    const { error } = await supabase.storage.from('creative-studio').upload(path, bytes, { contentType: 'image/png', upsert: true });
    if (error) { console.error('hero image upload failed:', error.message); return null; }
    const { data } = supabase.storage.from('creative-studio').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.error('hero image gen failed:', String(err));
    return null;
  }
}

// Design one email end-to-end: (optional) hero image → design (pass 2) → refine
// (pass 3), each with a graceful fallback so one failure never blocks the batch.
async function designOne(e: any, style: Style, supabase: any): Promise<{ html: string; aiDesigned: boolean }> {
  let imageUrl: string | null = null;
  if (e.use_image && (e.image_prompt || '').trim()) {
    imageUrl = await generateHeroImage(supabase, e.image_prompt, `${e.style_id || 'img'}-${crypto.randomUUID().slice(0, 8)}`);
  }
  let html: string;
  try {
    html = await pass2Design(e, style, imageUrl);
  } catch (err) {
    console.error('design pass failed, using fallback template:', String(err));
    return { html: finalizeHtml(fallbackRender(e, style), e, style), aiDesigned: false };
  }
  try {
    html = await pass3Refine(html, style, e); // polish; keep pass-2 html if refine fails
  } catch (err) {
    console.error('refine pass failed, keeping pass-2 design:', String(err));
  }
  return { html: finalizeHtml(html, e, style), aiDesigned: true };
}

// ===========================================================================
// SAFETY NET — guarantee email-safe structure + mandatory unsubscribe footer.
// ===========================================================================
function esc(s: string) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function complianceFooter(style: Style): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${style.palette.bg};"><tr><td align="center" style="padding:24px 28px;">
  <div style="font-family:${style.bodyFont};color:${style.palette.sub};font-size:12px;line-height:1.7;max-width:600px;">
    <strong style="color:${style.palette.ink};">Regalos Que Cantan</strong><br>
    Recibes este correo porque creaste una canción con Regalos Que Cantan.<br>
    <a href="{{UNSUB_URL}}" style="color:${style.palette.sub};text-decoration:underline;">Cancelar suscripción</a>
  </div>
</td></tr></table>`;
}

function finalizeHtml(rawHtml: string, e: any, style: Style): string {
  let html = (rawHtml || '').trim();
  // Strip accidental markdown code fences.
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Remove any scripts (defensive — email clients strip them anyway).
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Ensure a full document.
  if (!/<html[\s>]/i.test(html)) {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:${style.palette.bg};">${html}</body></html>`;
  }
  // Mandatory unsubscribe footer: if the model omitted {{UNSUB_URL}}, append it before </body>.
  if (!html.includes('{{UNSUB_URL}}')) {
    html = html.replace(/<\/body>/i, `${complianceFooter(style)}</body>`);
    if (!html.includes('{{UNSUB_URL}}')) html += complianceFooter(style); // last resort
  }
  return html;
}

// Clean built-in fallback (used only if a design pass fails) — better than the
// old flat template, themed to the chosen style so the batch still looks varied.
function inline(s: string) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function mdToHtml(md: string, style: Style): string {
  return (md || '').split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => l.trim().startsWith('- '))) {
      return `<ul style="margin:0 0 16px;padding-left:20px;color:${style.palette.sub};font-size:16px;line-height:1.7;font-family:${style.bodyFont};">${lines.map((l) => `<li>${inline(l.trim().slice(2))}</li>`).join('')}</ul>`;
    }
    return `<p style="margin:0 0 16px;color:${style.palette.sub};font-size:16px;line-height:1.7;font-family:${style.bodyFont};">${inline(block.replace(/\n/g, '<br>'))}</p>`;
  }).join('');
}
function fallbackRender(e: any, style: Style): string {
  const p = style.palette;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="${style.fontHref}" rel="stylesheet"></head>
<body style="margin:0;background:${p.bg};">
  <div style="display:none;max-height:0;overflow:hidden;">${esc(e.preview_text || '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.bg};padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${p.surface};border-radius:16px;overflow:hidden;">
      <tr><td style="padding:20px 32px;border-bottom:1px solid ${p.accent}22;">
        <span style="font-family:${style.headingFont};color:${p.ink};font-size:18px;letter-spacing:.3px;">🎵 Regalos Que Cantan</span>
      </td></tr>
      <tr><td style="padding:34px 32px 6px;">
        <h1 style="margin:0 0 ${e.subhead ? '8' : '18'}px;color:${p.ink};font-family:${style.headingFont};font-size:30px;line-height:1.2;">${inline(e.headline || '')}</h1>
        ${e.subhead ? `<p style="margin:0 0 18px;color:${p.accent};font-family:${style.bodyFont};font-size:16px;">${inline(e.subhead)}</p>` : ''}
        ${mdToHtml(e.body_md || '', style)}
      </td></tr>
      <tr><td align="center" style="padding:6px 32px 34px;">
        <a href="${SITE}" style="display:inline-block;background:${p.accent};color:#fff;text-decoration:none;font-family:${style.bodyFont};font-size:17px;font-weight:bold;padding:15px 36px;border-radius:12px;">${esc(e.cta_text || 'Crear su canción')}</a>
      </td></tr>
    </table>
  </td></tr></table>
  ${complianceFooter(style)}
</body></html>`;
}

// ===========================================================================
// Send one draft as a [PRUEBA] test to the owner (SendGrid). {{UNSUB_URL}} is
// resolved per-recipient just like the real send path.
async function sendTest(to: string, subject: string, html: string) {
  if (!SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not set');
  const resolved = html.replace(/\{\{UNSUB_URL\}\}/g, await buildUnsubscribeUrl(to));
  const parts = buildEmailParts(resolved, ''); // multipart text+html, CAN-SPAM address
  const headers = await buildUnsubscribeHeaders(to);
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      // RFC 2046: text/plain MUST come before text/html.
      content: [{ type: 'text/plain', value: parts.text }, { type: 'text/html', value: parts.html }],
      categories: ['marketing_weekly_test'], headers,
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false }, subscription_tracking: { enable: false } },
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const json = (s: number, b: any) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Utility: email the current pending drafts to the owner as [PRUEBA] tests.
  let reqBody: any = {}; try { reqBody = await req.json(); } catch { reqBody = {}; }
  if (reqBody.action === 'send_tests') {
    const to = OWNER_TEST_EMAILS.includes((reqBody.to || '').toLowerCase()) ? reqBody.to.toLowerCase() : OWNER_TEST_EMAILS[0];
    const { data: rows } = await supabase.from('email_queue')
      .select('subject, body_html').eq('status', 'pending_approval')
      .order('created_at', { ascending: false }).limit(12);
    let sent = 0; const errors: string[] = [];
    for (const e of (rows || [])) {
      try { await sendTest(to, `[PRUEBA] ${e.subject}`, e.body_html); sent++; }
      catch (err) { errors.push(String((err as any)?.message || err).slice(0, 120)); }
    }
    return json(200, { success: true, sent, to, total: (rows || []).length, errors });
  }

  // Utility: return the past-performance block (the feedback data Pass 1 will
  // read) WITHOUT generating a batch. Service-role only — campaign stats are
  // not public.
  if (reqBody.action === 'preview_performance') {
    if ((req.headers.get('Authorization') || '') !== `Bearer ${SERVICE_ROLE}`) {
      return json(403, { success: false, error: 'forbidden' });
    }
    const block = await pastPerformanceBlock(supabase);
    return json(200, { success: true, performance_block: block || '(no sent campaigns yet)' });
  }

  if (Deno.env.get('EMAIL_MARKETER_ENABLED') === 'false') return json(200, { success: true, skipped: true });

  const weekOf = new Date().toISOString().slice(0, 10);

  // The full pipeline (pass 1 copy + per-email design→refine) can run well past
  // the 150s HTTP gateway idle limit. pg_cron doesn't read the response, so we
  // dispatch the work in the BACKGROUND and return immediately. Each email is
  // designed in parallel; design and refine are sequential within an email.
  const run = async () => {
    try {
      const perfBlock = await pastPerformanceBlock(supabase); // feedback loop (fail-soft)
      const emails = await pass1Copy(weekOf, perfBlock); // PASS 1 — copy + style selection
      if (!emails.length) throw new Error('empty batch');

      // Demo override: force specific layouts (one per email, in order) so we can
      // preview the new archetypes on demand. feature_callout needs a hero image.
      const demo = Array.isArray(reqBody.demo_layouts) ? reqBody.demo_layouts : null;
      if (demo) emails.forEach((e: any, i: number) => {
        e.layout = demo[i % demo.length];
        if (e.layout === 'feature_callout') e.use_image = true;
      });

      const results = await Promise.all(emails.map(async (e) => {
        const style = styleById(e.style_id);
        const product = productById(e.featured_product);
        const { html, aiDesigned } = await designOne(e, style, supabase); // (image) + PASS 2 + PASS 3
        const { error } = await supabase.from('email_queue').insert({
          week_of: weekOf,
          reason: `${e.reason ?? ''}${e.reason ? ' · ' : ''}${product.label} · ${e.layout || 'hero'} · ${style.name}${e.use_image ? ' · 📷' : ''}`.trim(),
          subject: e.subject || '(no subject)',
          preview_text: e.preview_text ?? null, body_html: html, cta_text: e.cta_text ?? null,
          cta_url: SITE, status: 'pending_approval',
        });
        return { ok: !error, aiDesigned };
      }));
      const saved = results.filter((r) => r.ok).length;
      const designed = results.filter((r) => r.aiDesigned).length;
      await supabase.from('agent_runs').insert({
        agent: 'email-marketer', status: 'ok', ok: true,
        summary: `Drafted ${saved} email(s) (${designed} AI-designed + refined) for week of ${weekOf}`,
        payload: { week_of: weekOf, saved, designed }, finished_at: new Date().toISOString(), execution_ms: Date.now() - start,
      });
    } catch (e: any) {
      await supabase.from('agent_runs').insert({ agent: 'email-marketer', status: 'error', ok: false, error: String(e?.message || e).slice(0, 600), finished_at: new Date().toISOString() }).then(() => {}, () => {});
    }
  };

  // @ts-ignore — EdgeRuntime is provided by the Supabase Deno runtime.
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(run());
    return json(200, { success: true, dispatched: true, week_of: weekOf });
  }
  await run();
  return json(200, { success: true, week_of: weekOf });
});
