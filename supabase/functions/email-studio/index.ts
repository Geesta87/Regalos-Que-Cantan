// supabase/functions/email-studio/index.ts
// ===========================================================================
// EMAIL STUDIO — on-demand AI email designer (ported from the owner's
// standalone "EmailForge" project into the Creative Studio).
// ===========================================================================
// Powers the Creative Studio "Email Studio" section. The owner picks an
// offering preset (or writes a free brief) + a visual style, and Claude
// designs a complete email-safe HTML marketing email. Actions:
//
//   generate    — one-pass design: brief + style → { subject, preview_text, html }
//   improve     — EmailForge's "critique & rewrite" pass: art-director polish
//   refine      — apply ONE natural-language instruction to the current HTML
//   send_test   — email the current draft to the logged-in admin ([PRUEBA])
//   queue       — drop the finished email into email_queue (pending_approval);
//                 the existing Emails section + email-marketer-send cron handle
//                 approval, audience snapshot, suppression and delivery.
//   upload_image— host an uploaded image in the creative-studio bucket (returns
//                 a public URL — inline base64 images don't render in Gmail).
//   gen_image   — generate a photographic hero image via Kie (KIE_IMAGE_ENABLED).
//
// Design assets carried over from EmailForge: the premium component reference
// library, Outlook MSO/VML bulletproof buttons, dark-mode CSS classes, and the
// two-pass generate→critique flow. Styles/philosophy stay the RQC-tuned ones so
// the studio matches the weekly engine's brand voice.
//
// Admin-only (spends API credits and can queue a list send). verify_jwt = true.
// Deploy: supabase functions deploy email-studio --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { brandContext, OFFERS } from '../_shared/brand-brief.ts';
import { kiePhotoBytes, KIE_IMAGE_ENABLED } from '../_shared/kie-image.ts';
import { buildUnsubscribeHeaders, buildUnsubscribeUrl } from '../_shared/unsubscribe.ts';
import { buildEmailParts } from '../_shared/email.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const MODEL = Deno.env.get('EMAIL_STUDIO_MODEL') || Deno.env.get('EMAIL_MARKETER_MODEL') || 'claude-sonnet-4-6';
const SITE = 'https://regalosquecantan.com';
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'Regalos Que Cantan';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

// ===========================================================================
// STYLE LIBRARY — same RQC-tuned art-direction briefs as email-marketer-weekly
// (kept self-contained here on purpose: the weekly cron file must stay
// independently deployable). To add a style: append in BOTH files.
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
// DESIGN PHILOSOPHY — same taste bar as the weekly engine, adapted for a
// studio where the OWNER's brief steers structure and intent.
// ===========================================================================
const DESIGN_PHILOSOPHY = `DESIGN PHILOSOPHY — Regalos Que Cantan is a PREMIUM brand. Unless the brief says otherwise, this is a SALES email that must CONVERT.
- Design a high-converting DTC PRODUCT email — a premium product page in an inbox, NOT a newsletter or an article. The reader is deciding whether to BUY, not to read.
- SELL, don't narrate. MINIMAL text. Big emotional hook, then the offer, the price, and the button. The whole email must be scannable in ~5 seconds and pull the eye straight to the CTA.
- REPEAT THE CTA (near the top AND at the bottom). Make the price and the "escúchala GRATIS antes de pagar" risk-reversal impossible to miss.
- Still PREMIUM, never tacky: like a great Apple / boutique-DTC product email — NEVER a generic promo blast, a MailChimp template, a party flyer, or a kids' card.
- COLOR WITH RESTRAINT: anchor on a sophisticated base (the style's bg / surface / ink) and use the accent SPARINGLY — one rule, the button, one highlighted word. NO rainbow or multi-color gradients; any gradient is subtle, 2-TONE, from the style's palette.
- EMOJI: at most ONE small, tasteful glyph in the entire email (or none). Prefer typographic flourishes (a small ♪, ✦, a short rule).
- TYPOGRAPHY does the heavy lifting: confident scale (headline ~38–46px), generous line-height (~1.7 body), letter-spacing on small-caps labels, italic for emotional emphasis. Make ONE word or line the hero.
- TRUTHFUL ONLY: real proof points (escúchala GRATIS antes de pagar · lista en ~3 min · hecha solo para esa persona · tuya para siempre). NEVER invent review counts, star ratings, testimonials or customer numbers.
- Every decorative element must earn its place. If anything looks like clip-art or a default template, delete it.`;

// ===========================================================================
// EMAIL-SAFE RULES — the weekly engine's rules PLUS the production polish
// carried over from EmailForge (Outlook MSO/VML button, dark-mode classes,
// hidden preheader, mobile media queries).
// ===========================================================================
const EMAIL_SAFE_RULES = `EMAIL-SAFE HTML RULES (this renders in Gmail, Outlook, Apple Mail — NOT a browser):
- Layout MUST be <table role="presentation"> based, centered, max-width 600px. NO flexbox, NO grid, NO position, NO floats.
- ALL styling INLINE via style="" attributes. You may also include a <style> block in <head> for web fonts, media queries and dark-mode overrides, but never rely on it — inline styles must stand alone.
- Web fonts work only in some clients. For EVERY text element set font-family to the web font FIRST then a safe fallback stack.
- Gradients: Outlook ignores them. Always set a SOLID background-color first, then layer the gradient via background-image so it degrades gracefully. Same for the button.
- BULLETPROOF CTA BUTTON with an Outlook VML fallback (adapt colors/text/href per email):
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="BUTTON_URL" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="50%" stroke="f" fillcolor="ACCENT_COLOR">
<w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">BUTTON_TEXT</center>
</v:roundrect><![endif]-->
<!--[if !mso]><!-->
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="ACCENT_COLOR" style="border-radius:50px;">
<a href="BUTTON_URL" style="display:inline-block;padding:15px 40px;font-weight:bold;color:#ffffff;text-decoration:none;">BUTTON_TEXT</a>
</td></tr></table>
<!--<![endif]-->
- DARK MODE: add this block to <style> and put class="dm-bg" on the outer background table cell, class="dm-card" on the main content card, class="dm-text" on primary text, class="dm-foot" on the footer — with colors adapted so the email stays on-palette when Gmail/Apple Mail force dark mode:
@media (prefers-color-scheme: dark) { .dm-bg{background-color:#17151a!important} .dm-card{background-color:#211e26!important} .dm-text{color:#f0edf2!important} .dm-foot{background-color:#131117!important} }
(For styles that are ALREADY dark, keep the dark-mode overrides close to the style's own palette instead.)
- MOBILE: include @media (max-width:620px) rules that scale the headline down, reduce section padding, and keep buttons big and easy to tap.
- Include a hidden preheader div at the very top of <body> containing the preview text plus &nbsp;&zwnj; spacer entities.
- Images: always include width, height and alt; never make the email depend on an image loading; use ONLY hosted https image URLs given to you (NEVER base64 data URIs — Gmail strips them). No background images for critical content.
- Include a footer with the brand wordmark, the compliance line "Recibes este correo porque creaste una canción con Regalos Que Cantan." and an unsubscribe link whose href is EXACTLY {{UNSUB_URL}} (literal — replaced per recipient at send time). This footer is mandatory.
- No <script>, no external JS, no forms.`;

// ===========================================================================
// COMPONENT REFERENCE LIBRARY — carried over from EmailForge. These are
// STRUCTURAL references: study the table craft, then re-skin every color and
// font to the chosen style's palette. Never copy the example colors verbatim.
// ===========================================================================
const COMPONENT_LIBRARY = `PREMIUM COMPONENT REFERENCE LIBRARY — structural patterns to adapt (RE-SKIN all colors/fonts to the chosen style's palette; these hexes are placeholders):

── CINEMATIC HERO WITH RADIAL GLOW (dark styles) ──
<tr><td align="center" bgcolor="#0a0806" style="padding:72px 44px 64px;background:linear-gradient(180deg,#0a0806,#0d0b08);">
  <div style="background:radial-gradient(ellipse 60% 50% at 50% 0%,rgba(201,169,110,0.16) 0%,transparent 70%);max-width:520px;margin:0 auto;">
    <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#c9a96e;">✦ EYEBROW LABEL ✦</p>
    <h1 style="margin:0 0 18px;font-size:44px;font-weight:700;line-height:1.1;letter-spacing:-0.02em;color:#ffffff;">Big Emotional<br><em style="color:#e8c97a;">Headline</em></h1>
    <p style="margin:0 0 34px;font-size:17px;line-height:1.7;color:rgba(255,255,255,0.68);max-width:400px;margin-left:auto;margin-right:auto;">One short subhead that turns the feeling into the offer.</p>
    [BULLETPROOF BUTTON HERE]
  </div>
</td></tr>

── 3-UP BENEFIT / STAT CARDS ──
<tr><td style="padding:40px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="33%" style="padding:0 4px;"><table role="presentation" width="100%"><tr><td class="dm-card" bgcolor="#SURFACE" style="border:1px solid #ACCENT33;border-radius:14px;padding:20px 14px;text-align:center;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#SUB;">LABEL</p>
    <p style="margin:0;font-size:16px;font-weight:700;color:#INK;">Benefit line</p>
  </td></tr></table></td>
  [repeat ×3]
</tr></table></td></tr>

── EDITORIAL PRODUCT SPLIT (light styles) ──
<tr><td bgcolor="#SURFACE" style="padding:48px 40px;border-top:4px solid #ACCENT;">
  <table role="presentation" width="100%"><tr>
    <td width="55%" valign="top" style="padding-right:24px;">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#ACCENT;">KICKER</p>
      <h2 style="margin:0 0 14px;font-size:30px;font-weight:700;font-style:italic;line-height:1.2;color:#INK;">Feature headline</h2>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.75;color:#SUB;">Short selling line.</p>
      [BUTTON]
    </td>
    <td width="45%" valign="top">[hosted <img> or a tastefully framed color block]</td>
  </tr></table>
</td></tr>

── ORNAMENTAL DIVIDER ──
<tr><td align="center" style="padding:26px 44px;"><table role="presentation" width="100%"><tr>
  <td style="border-top:1px solid #ACCENT40;font-size:0;">&nbsp;</td>
  <td align="center" style="padding:0 14px;white-space:nowrap;font-size:16px;color:#ACCENT;">✦</td>
  <td style="border-top:1px solid #ACCENT40;font-size:0;">&nbsp;</td>
</tr></table></td></tr>

── CALLOUT / RISK-REVERSAL BLOCK ──
<tr><td style="padding:0 28px 26px;"><table role="presentation" width="100%"><tr>
  <td style="border-left:4px solid #ACCENT;padding:16px 20px;background:#ACCENT0F;border-radius:0 10px 10px 0;">
    <p style="margin:0 0 5px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ACCENT;">SIN RIESGO</p>
    <p style="margin:0;font-size:15px;line-height:1.65;color:#INK;">Escúchala completa GRATIS antes de pagar.</p>
  </td>
</tr></table></td></tr>

── PRICE + TRUST STRIP ──
<tr><td align="center" style="padding:8px 28px 30px;">
  <p style="margin:0 0 6px;font-size:26px;font-weight:700;color:#INK;">Desde $29.99</p>
  <p style="margin:0;font-size:13px;color:#SUB;">GRATIS antes de pagar · Lista en ~3 min · Tuya para siempre</p>
</td></tr>`;

// ===========================================================================
// ANTHROPIC
// ===========================================================================
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

const EMIT_EMAIL_TOOL = {
  name: 'emit_email',
  description: 'Emit the finished marketing email.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Enticing Spanish subject line, <=55 chars (English only if the brief targets giftsthatsing.com).' },
      preview_text: { type: 'string', description: 'Preheader text, <=100 chars, complements the subject.' },
      html: { type: 'string', description: 'The complete email-safe HTML document, from <!DOCTYPE html> to </html>.' },
    },
    required: ['subject', 'preview_text', 'html'],
  },
};

const EMIT_HTML_TOOL = {
  name: 'emit_email_html',
  description: 'Emit the complete, email-safe HTML document for this email.',
  input_schema: {
    type: 'object',
    properties: { html: { type: 'string', description: 'The complete HTML document, from <!DOCTYPE html> to </html>.' } },
    required: ['html'],
  },
};

function styleBrief(style: Style): string {
  return `STYLE (typography + layout + sophistication): ${style.name} — ${style.blurb}
Art direction: ${style.treatment}
Palette: background ${style.palette.bg}, surface/card ${style.palette.surface}, primary text ${style.palette.ink}, secondary text ${style.palette.sub}, accent ${style.palette.accent}, secondary accent ${style.palette.accent2}.
Heading font-family: ${style.headingFont}
Body font-family: ${style.bodyFont}
Web font <link> for <head> (include it): <link rel="preconnect" href="https://fonts.googleapis.com"><link href="${style.fontHref}" rel="stylesheet">`;
}

// Optional free-form color/theme override from the owner. Takes precedence over
// the style's palette but keeps the style's typographic craft and every premium
// / email-safe guardrail — so "4th of July, red white & blue" re-skins the color
// story tastefully instead of turning into a clip-art flag flyer.
function styleNoteBlock(note?: unknown): string {
  const n = (note || '').toString().trim();
  if (!n) return '';
  return `\n\nTHEME / COLOR OVERRIDE (from the owner — this TAKES PRECEDENCE over the style's palette above): ${n}
Re-map the color story to honor this override — you MAY depart from the style's accent/background/surface hexes to achieve it. But KEEP the style's typographic craft, layout sophistication, premium restraint, and every email-safe rule. Interpret the theme tastefully: still a premium boutique-DTC email, never a clip-art flyer, flag emoji, confetti, or party-blast. If the override names an occasion (e.g. a holiday), use its colors as a SOPHISTICATED accent story against a refined base, not loud full-width saturated bands.`;
}

function generateSystem(promoNotes?: string): string {
  return `You are an elite email designer with impeccable taste — your work looks like a premium DTC / editorial brand, never a generic promo template. You design marketing emails for "Regalos Que Cantan" (personalized Spanish songs as gifts, ${OFFERS.site}). The wordmark is the text "Regalos Que Cantan". Customer-facing copy is in natural US-Hispanic Spanish (English ONLY when the brief targets the English platform giftsthatsing.com).

${brandContext(promoNotes)}

${DESIGN_PHILOSOPHY}

${COMPONENT_LIBRARY}

${EMAIL_SAFE_RULES}

You will receive a BRIEF from the owner plus a STYLE. Follow the brief for content and intent; follow the style for look; follow the rules above for craft. After composing, silently re-check your HTML against everything above — delete anything that looks like clip-art, a party flyer, emoji spam, or a default template — then emit via the tool.`;
}

// EmailForge's PASS 2 — the "senior designer critique & rewrite".
function improveSystem(style: Style, note?: string): string {
  const n = (note || '').toString().trim();
  const paletteRule = n
    ? `keep the current email's COLOR STORY, which follows the owner's theme override ("${n}") — do NOT revert it toward the style's default palette`
    : 'keep the same style and palette';
  return `You are a world-class email ART DIRECTOR with impeccable, restrained taste, reviewing a PREMIUM but SALES-DRIVEN email for "Regalos Que Cantan". Silently critique it HARSHLY across: visual hierarchy, typography scale/contrast, hero impact, CTA desirability (top AND bottom), whitespace rhythm, copy economy, color restraint, component refinement, dark-mode classes, and the Outlook VML button fallback. Then emit ONE improved HTML email that fixes every issue.

HARD CONSTRAINTS: keep it email-safe (table-based, inline styles); ${paletteRule}; keep ALL Spanish copy wording and every link href unchanged; keep the literal {{UNSUB_URL}} unsubscribe link in the footer; if there is a hero <img>, KEEP it and its exact src; do not add emoji.

${DESIGN_PHILOSOPHY}

${EMAIL_SAFE_RULES}

Style being refined: ${style.name} — ${style.treatment}${n ? `\n\nTHEME OVERRIDE IN EFFECT (honor it over the style's default palette): ${n}` : ''}`;
}

function refineSystem(style: Style): string {
  return `You are refining an existing HTML marketing email for "Regalos Que Cantan". The owner gives ONE specific instruction.
CRITICAL RULES:
1. Apply ONLY the requested change — do not redesign unrelated sections.
2. Preserve all existing layout, colors, fonts, links and content unless the instruction directly affects them.
3. Keep it email-safe (table-based, inline styles), keep dark-mode classes, the Outlook VML button and the literal {{UNSUB_URL}} footer link intact.
4. The result must be complete (<!DOCTYPE html> … </html>) and production-ready.

${EMAIL_SAFE_RULES}

Style context: ${style.name} — ${style.treatment}`;
}

// ===========================================================================
// SAFETY NET — same guarantees as the weekly engine: full document, no
// scripts, mandatory {{UNSUB_URL}} compliance footer.
// ===========================================================================
function complianceFooter(style: Style): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${style.palette.bg};"><tr><td align="center" style="padding:24px 28px;">
  <div style="font-family:${style.bodyFont};color:${style.palette.sub};font-size:12px;line-height:1.7;max-width:600px;">
    <strong style="color:${style.palette.ink};">Regalos Que Cantan</strong><br>
    Recibes este correo porque creaste una canción con Regalos Que Cantan.<br>
    <a href="{{UNSUB_URL}}" style="color:${style.palette.sub};text-decoration:underline;">Cancelar suscripción</a>
  </div>
</td></tr></table>`;
}

function finalizeHtml(rawHtml: string, style: Style): string {
  let html = (rawHtml || '').trim();
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  if (!/<html[\s>]/i.test(html)) {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:${style.palette.bg};">${html}</body></html>`;
  }
  if (!html.includes('{{UNSUB_URL}}')) {
    html = html.replace(/<\/body>/i, `${complianceFooter(style)}</body>`);
    if (!html.includes('{{UNSUB_URL}}')) html += complianceFooter(style);
  }
  return html;
}

// ===========================================================================
// SENDGRID — test sends only. Real list sends go through email_queue + the
// email-marketer-send cron (throttled, suppression-checked).
// ===========================================================================
async function sendTest(to: string, subject: string, html: string, preheader = '') {
  if (!SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not set');
  const resolved = html.replace(/\{\{UNSUB_URL\}\}/g, await buildUnsubscribeUrl(to));
  const parts = buildEmailParts(resolved, preheader); // multipart text+html, preheader, CAN-SPAM address
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
      categories: ['email_studio_test'], headers,
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false }, subscription_tracking: { enable: false } },
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Store image bytes in the public creative-studio bucket and return the URL.
async function storeImage(admin: any, bytes: Uint8Array, contentType: string): Promise<string> {
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const path = `email-studio/${crypto.randomUUID().slice(0, 12)}.${ext}`;
  const { error } = await admin.storage.from('creative-studio').upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  const { data } = admin.storage.from('creative-studio').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('no public URL');
  return data.publicUrl;
}

// ===========================================================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // Admin auth — same pattern as email-marketer-admin.
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
    if (roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const action = body.action || '';
    const style = styleById(body.style_id);

    if (action === 'generate') {
      const brief = (body.brief || '').toString().trim();
      if (!brief) return json({ success: false, error: 'Brief is required' }, 400);
      const imageBlock = body.image_url
        ? `HERO IMAGE (hosted — place near the top, full card width, with width/height ≈600x400, rounded corners, alt text; the email must still fully sell if it never loads): <img src="${body.image_url}">`
        : 'NO hero image — design a clean, premium text + type layout.';
      const noteBlock = styleNoteBlock(body.style_note);
      const ctaUrl = (body.cta_url || SITE).toString();
      // The owner's live "This week's push" (same box that steers ads & social)
      // biases studio emails too — one push, all channels.
      const { data: cfg } = await admin.from('creative_studio_config').select('promo_notes').eq('id', 1).single();
      const data = await callAnthropic({
        model: MODEL, max_tokens: 9000, system: generateSystem(cfg?.promo_notes),
        tools: [EMIT_EMAIL_TOOL], tool_choice: { type: 'tool', name: 'emit_email' },
        messages: [{ role: 'user', content: `${styleBrief(style)}${noteBlock}\n\n${imageBlock}\n\nCTA LINK (every button href — use EXACTLY this): ${ctaUrl}\n\nTHE OWNER'S BRIEF:\n${brief}\n\nDesign and emit the complete email now (subject + preview_text + full HTML).` }],
      });
      const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
      if (!tu?.input?.html) return json({ success: false, error: 'Model returned no HTML' }, 502);
      return json({
        success: true,
        subject: (tu.input.subject || '').toString(),
        preview_text: (tu.input.preview_text || '').toString(),
        html: finalizeHtml(tu.input.html, style),
      });
    }

    if (action === 'improve' || action === 'refine') {
      const html = (body.html || '').toString();
      if (!html) return json({ success: false, error: 'html is required' }, 400);
      const isRefine = action === 'refine';
      const instruction = (body.instruction || '').toString().trim();
      if (isRefine && !instruction) return json({ success: false, error: 'instruction is required' }, 400);
      const data = await callAnthropic({
        model: MODEL, max_tokens: 9000,
        system: isRefine ? refineSystem(style) : improveSystem(style, (body.style_note || '').toString()),
        tools: [EMIT_HTML_TOOL], tool_choice: { type: 'tool', name: 'emit_email_html' },
        messages: [{
          role: 'user',
          content: isRefine
            ? `Here is the current email HTML:\n\n${html}\n\n---\n\nInstruction to apply: "${instruction}"\n\nEmit the complete updated HTML.`
            : `Here is the email to review:\n\n${html}\n\nCritique it silently, then emit the improved, more premium HTML.`,
        }],
      });
      const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
      if (!tu?.input?.html) return json({ success: false, error: 'Model returned no HTML' }, 502);
      return json({ success: true, html: finalizeHtml(tu.input.html, style) });
    }

    if (action === 'send_test') {
      const html = (body.html || '').toString();
      const subject = (body.subject || 'Email Studio draft').toString();
      if (!html) return json({ success: false, error: 'html is required' }, 400);
      const to = (ud.user.email || '').toString();
      if (!to) return json({ success: false, error: 'Your account has no email address' }, 400);
      await sendTest(to, `[PRUEBA] ${subject}`, finalizeHtml(html, style), (body.preview_text || '').toString());
      return json({ success: true, sent_to: to });
    }

    if (action === 'queue') {
      const html = (body.html || '').toString();
      const subject = (body.subject || '').toString().trim();
      if (!html || !subject) return json({ success: false, error: 'html and subject are required' }, 400);
      // "Edit in Studio" save path: update an existing pending draft in place
      // (never a sent/sending email) instead of inserting a duplicate.
      // Optional A/B second subject + audience segment (validated).
      const SEGMENTS = ['all', 'recent', 'winback', 'video_buyers', 'no_video', 'nonbuyers'];
      const segment = SEGMENTS.includes((body.segment || '').toString()) ? body.segment.toString() : 'all';
      const subjectB = (body.subject_b || '').toString().trim() || null;
      if (body.id) {
        const { data: existing } = await admin.from('email_queue').select('id, status').eq('id', body.id).single();
        if (!existing) return json({ success: false, error: 'Draft not found' }, 404);
        if (existing.status !== 'pending_approval') return json({ success: false, error: `Not editable (status=${existing.status})` }, 409);
        const { error } = await admin.from('email_queue').update({
          subject,
          subject_b: subjectB,
          segment,
          preview_text: (body.preview_text || '').toString() || null,
          body_html: finalizeHtml(html, style),
          cta_text: (body.cta_text || '').toString() || null,
          cta_url: (body.cta_url || SITE).toString(),
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
        if (error) return json({ success: false, error: error.message }, 500);
        return json({ success: true, id: existing.id, updated: true });
      }
      const { data: row, error } = await admin.from('email_queue').insert({
        week_of: new Date().toISOString().slice(0, 10),
        reason: `Email Studio · ${style.name}`,
        subject,
        subject_b: subjectB,
        segment,
        preview_text: (body.preview_text || '').toString() || null,
        body_html: finalizeHtml(html, style),
        cta_text: (body.cta_text || '').toString() || null,
        cta_url: (body.cta_url || SITE).toString(),
        status: 'pending_approval',
      }).select('id').single();
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, id: row?.id });
    }

    if (action === 'upload_image') {
      const dataUrl = (body.image || '').toString();
      const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
      if (!m) return json({ success: false, error: 'image must be a png/jpeg/webp data URL' }, 400);
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      if (bytes.length > 4 * 1024 * 1024) return json({ success: false, error: 'Image too large (max 4MB)' }, 400);
      const url = await storeImage(admin, bytes, m[1]);
      return json({ success: true, url });
    }

    if (action === 'gen_image') {
      if (!KIE_IMAGE_ENABLED) return json({ success: false, error: 'Image generation is not enabled (KIE_IMAGE_ENABLED)' }, 400);
      const prompt = (body.prompt || '').toString().trim();
      if (!prompt) return json({ success: false, error: 'prompt is required' }, 400);
      const bytes = await kiePhotoBytes(`${prompt}. Photoreal, warm, cinematic, wholesome, tasteful. Absolutely NO text, words, letters, captions or logos anywhere in the image.`, '3:2');
      if (!bytes) return json({ success: false, error: 'Image generation failed' }, 502);
      const url = await storeImage(admin, bytes, 'image/png');
      return json({ success: true, url });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('email-studio error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
