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
import { renderAd, cropPhoto } from '../_shared/render-ad.ts';
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
- Every decorative element must earn its place. If anything looks like clip-art or a default template, delete it.

STRUCTURE — this is what separates a PREMIUM email from a basic one. A basic email is one block: headline, paragraph, button, footer. A premium DTC email is MODULAR and STACKED — 6 to 9 distinct sections, each with its own job, its own background surface, and its own visual rhythm. Build that.
- Compose from the COMPONENT LIBRARY below. Pick 6-9 modules and STACK them. Never ship a 3-section email.
- A strong default running order (adapt it, don't recite it): announcement bar → brand header → hero → price + risk-reversal → proof strip → how-it-works or collection tiles → a second emotional beat → final CTA → footer.
- ALTERNATE THE SURFACES. Consecutive sections must not share the same background. Go dark → light → dark, or full-bleed image → padded cream card. That alternation IS the premium feel; a single flat background for 800px is what makes an email look cheap.
- VARY THE WIDTH. Mix full-bleed edge-to-edge bands with inset padded cards. Never let every section have identical 28px padding.
- Give the email VERTICAL LENGTH. These emails are meant to be scrolled. Short is not the same as premium — RESTRAINED is. Density of craft, not density of words.
- ONE hero moment only. Exactly one 40px+ headline. Every other heading steps down hard (28px, then 18px). Flat type scale = amateur.

IMAGE DISCIPLINE — when images are supplied, they are STRUCTURE, not decoration.
- Use every image you are given. A supplied image that goes unused is a wasted asset.
- Full-bleed the hero to the email's edge (no side padding, no rounded corners on a true full-bleed band) — that edge-to-edge photo is the single strongest "premium brand" signal in an inbox.
- EVERY <img> needs width, height and real alt text, and the email must still fully sell with images OFF. Roughly a third of inboxes block images by default. Never put the price, the offer, the headline, or the only CTA exclusively inside an image — always repeat them as live HTML text.
- Never stretch an image to a wrong aspect. Never use an image as a background behind critical text.`;

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
</td></tr>

── ANNOUNCEMENT BAR (very top, above the brand header — sets a premium retail tone instantly) ──
<tr><td align="center" bgcolor="#ACCENT" style="padding:11px 20px;">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#INK_ON_ACCENT;">Escúchala gratis antes de pagar · Lista en 3 minutos</p>
</td></tr>

── FULL-BLEED DESIGNED BANNER HERO (use when a BANNER image is supplied — the headline is already typeset INTO that image) ──
Place it edge-to-edge as the FIRST thing under the header: no side padding, no rounded corners, no border.
The alt text MUST repeat the banner's headline verbatim, and a live HTML headline + button MUST follow underneath so the email still sells with images blocked.
<tr><td align="center" bgcolor="#BG" style="padding:0;font-size:0;line-height:0;">
  <a href="BUTTON_URL" style="display:block;text-decoration:none;">
    <img src="BANNER_URL" width="600" height="375" alt="[repeat the banner headline here, word for word]" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
  </a>
</td></tr>

── FULL-BLEED PHOTO BAND (an undesigned photo — let it run edge to edge, then typeset over/under it in HTML) ──
<tr><td align="center" bgcolor="#BG" style="padding:0;font-size:0;line-height:0;">
  <img src="IMG_URL" width="600" height="340" alt="[describe the scene]" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
</td></tr>

── PHOTO TILE GRID — "explora por estilo / por ocasión" (2-up; the module that reads most like a premium shop email) ──
Give each tile a real photo, a short label and its own link. On mobile the two tiles stack (class="stack" + the media query below).
<tr><td style="padding:34px 24px 10px;">
  <p style="margin:0 0 18px;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#ACCENT;">EXPLORA POR ESTILO</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td class="stack" width="50%" valign="top" style="padding:0 7px 14px 0;">
      <a href="BUTTON_URL" style="text-decoration:none;">
        <img src="IMG_URL" width="276" height="200" alt="[estilo]" style="display:block;width:100%;height:auto;border-radius:12px 12px 0 0;border:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#SURFACE" style="padding:13px 16px;border-radius:0 0 12px 12px;">
          <p style="margin:0;font-size:15px;font-weight:700;color:#INK;">Corrido</p>
          <p style="margin:3px 0 0;font-size:12px;color:#SUB;">Para el que se la rifa</p>
        </td></tr></table>
      </a>
    </td>
    <td class="stack" width="50%" valign="top" style="padding:0 0 14px 7px;">[second tile, same structure]</td>
  </tr></table>
</td></tr>
Mobile stacking rule for the <style> block: @media (max-width:620px){ .stack{display:block!important;width:100%!important;padding:0 0 14px 0!important} }

── COUPON / CODE CHIP (only when the brief actually gives a real code — never invent one) ──
<tr><td align="center" style="padding:6px 28px 26px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td align="center" style="border:2px dashed #ACCENT;border-radius:10px;padding:14px 30px;background:#ACCENT0F;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#SUB;">CÓDIGO</p>
      <p style="margin:0;font-size:24px;font-weight:700;letter-spacing:0.18em;color:#INK;font-family:'Courier New',Courier,monospace;">CODIGO25</p>
    </td>
  </tr></table>
</td></tr>

── VIDEO / GIF BLOCK (a linked still or animated GIF with the play glyph baked into the image) ──
Outlook shows only the FIRST frame of a GIF — that frame must stand alone.
<tr><td align="center" style="padding:8px 24px 30px;">
  <a href="BUTTON_URL" style="display:block;text-decoration:none;">
    <img src="IMG_URL" width="552" height="310" alt="Escucha un ejemplo — reproducir" style="display:block;width:100%;max-width:552px;height:auto;border-radius:14px;border:0;">
  </a>
  <p style="margin:12px 0 0;font-size:13px;color:#SUB;">Escucha un ejemplo de 30 segundos</p>
</td></tr>

── NOW-PLAYING CARD (our product IS a song — this is the closest thing we have to a product shot; use it often) ──
<tr><td style="padding:6px 24px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td bgcolor="#SURFACE" style="border:1px solid #ACCENT33;border-radius:16px;padding:20px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="46" valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="42" height="42" align="center" valign="middle" bgcolor="#ACCENT" style="border-radius:21px;font-size:16px;color:#INK_ON_ACCENT;">&#9654;</td></tr></table>
      </td>
      <td valign="middle" style="padding-left:14px;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#INK;">Para mi mamá, Rosa</p>
        <p style="margin:3px 0 0;font-size:12px;color:#SUB;">Corrido · 2:58</p>
      </td>
      <td align="right" valign="middle" style="font-size:0;line-height:0;">
        <!-- waveform: tiny colored cells, no image needed -->
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="3" height="10" bgcolor="#ACCENT" style="font-size:0;line-height:0;">&nbsp;</td><td width="4">&nbsp;</td>
          <td width="3" height="22" bgcolor="#ACCENT" style="font-size:0;line-height:0;">&nbsp;</td><td width="4">&nbsp;</td>
          <td width="3" height="16" bgcolor="#ACCENT" style="font-size:0;line-height:0;">&nbsp;</td><td width="4">&nbsp;</td>
          <td width="3" height="28" bgcolor="#ACCENT" style="font-size:0;line-height:0;">&nbsp;</td><td width="4">&nbsp;</td>
          <td width="3" height="13" bgcolor="#ACCENT" style="font-size:0;line-height:0;">&nbsp;</td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>
</table></td></tr>

── NUMBERED HOW-IT-WORKS ROWS (3 steps — the module that kills "is this legit?" hesitation) ──
<tr><td style="padding:30px 30px 12px;">
  <p style="margin:0 0 20px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#ACCENT;">CÓMO FUNCIONA</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="44" valign="top">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="34" height="34" align="center" valign="middle" bgcolor="#ACCENT" style="border-radius:17px;font-size:15px;font-weight:700;color:#INK_ON_ACCENT;">1</td></tr></table>
      </td>
      <td valign="top" style="padding:4px 0 22px;">
        <p style="margin:0 0 3px;font-size:16px;font-weight:700;color:#INK;">Cuéntanos de esa persona</p>
        <p style="margin:0;font-size:14px;line-height:1.65;color:#SUB;">Su nombre, su historia, lo que la hace única.</p>
      </td>
    </tr>
    [repeat rows 2 and 3]
  </table>
</td></tr>

── FULL-WIDTH OFFER BAR (mid-email accent band — breaks up two light sections and re-states the offer) ──
<tr><td align="center" bgcolor="#ACCENT" style="padding:18px 26px;">
  <p style="margin:0;font-size:15px;font-weight:700;color:#INK_ON_ACCENT;">2 canciones por $39.99 &nbsp;·&nbsp; <a href="BUTTON_URL" style="color:#INK_ON_ACCENT;text-decoration:underline;">Aprovecha</a></p>
</td></tr>`;

// ===========================================================================
// WORKED EXAMPLE — the composition of an email the owner reviewed and approved
// (July 2026, Dark Luxury). Describing "premium structure" in the abstract is
// not enough; showing one real running order is what makes it repeatable.
// Deliberately a SKELETON, not markup — the component library above already
// holds the HTML, and pasting a full email here would only invite cloning.
// ===========================================================================
const EXEMPLAR = `APPROVED COMPOSITION — study the RHYTHM, then compose your own. Never copy its wording, colors or headline.

  #   SECTION                SURFACE     WHAT IT DOES
  1   announcement bar       ACCENT      one 11px uppercase promise line, letterspaced
  2   brand header           BG          wordmark only, 0.34em tracking, nothing else
  3   designed banner        BG          full-bleed 600x375, zero padding, zero radius
  4   headline + CTA         BG          42px serif over 2 lines, accent italic on line 2, 16px sub, pill button
  5   price + trust strip    BG          30px price, then one 13px middot-separated trust line
  6   now-playing card       BG          card sits on SURFACE with a 1px accent border
  7   ornamental divider     BG          hairline rule with a single small glyph
  8   how it works           SURFACE     <- first surface flip; 3 numbered rows
  9   offer bar              ACCENT      <- saturated full-width band, one line + inline link
 10   editorial split        BG          52/48 text beside a cropped photo
 11   final CTA              SURFACE     <- flips again; restates the risk reversal
 12   footer                 BG          wordmark, compliance line, unsubscribe

The lesson is the RHYTHM: a long BG run, then SURFACE, then a saturated ACCENT band, then BG, then SURFACE again. Three surface changes in the back half are what make an email read as designed rather than merely long. Twelve sections, and only ONE headline above 40px.

Vary it. A different email might open on the brand header with no announcement bar, put the tile grid where the how-it-works sits, or end on a full accent band instead of SURFACE. What must not vary: 6-9+ sections, no two consecutive sections sharing a background, and exactly one hero headline.`;

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

${EXEMPLAR}

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

HARD CONSTRAINTS: keep it email-safe (table-based, inline styles); ${paletteRule}; keep ALL Spanish copy wording and every link href unchanged; keep the literal {{UNSUB_URL}} unsubscribe link in the footer; KEEP EVERY <img> and its exact src — never drop, swap or invent an image URL; a full-bleed banner stays full-bleed (do not add padding or rounded corners to it); do not add emoji.

Push the STRUCTURE hard in this pass: if the email is only 3 or 4 flat sections on one background, that is the main defect — rebuild it as 6-9 stacked modules with alternating surfaces and a real type hierarchy.

${DESIGN_PHILOSOPHY}

${EXEMPLAR}

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

// Art direction for every photo we generate for an email. Text-free on purpose —
// the design layer (render-ad.ts) typesets the headline, and baked AI text is the
// #1 "AI slop" tell. Casting is explicit: our customers are US-Hispanic families.
const PHOTO_RULES = 'Photoreal, warm, cinematic, wholesome, tasteful. The people must be authentically Mexican/Latino — real US-Hispanic families, couples and friends, including adults 30-45 — never generic stock casting. Natural light, real homes and real celebrations. Leave calm negative space across the middle of the frame so a headline can sit over it. Absolutely NO text, words, letters, captions, watermarks or logos anywhere in the image.';

// Pick black or white for text sitting ON the accent color, so a pale accent
// (blush, cream) doesn't end up with unreadable white type on the banner pill.
function inkOnAccent(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return '#141414';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Relative luminance (sRGB coefficients) — >0.6 means a light accent.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#141414' : '#FFFFFF';
}

// Email photo tiles: 270x196 CSS px at 2x retina.
const TILE_W = 540, TILE_H = 392;
const tileFocus = (f: unknown): 'top' | 'center' | 'bottom' =>
  (f === 'top' || f === 'bottom') ? f : 'center';

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
      // Image supply: a designed banner (headline already typeset in), a plain
      // hero photo, and/or a gallery for the tile grid + editorial splits.
      const tiles: string[] = (Array.isArray(body.image_urls) ? body.image_urls : [])
        .filter((u: unknown) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 6);
      const bannerUrl = (body.banner_url || '').toString().trim();
      const blocks: string[] = [];
      if (bannerUrl) {
        blocks.push(`DESIGNED BANNER HERO (hosted, 600x375 — the headline is ALREADY typeset INTO this image): ${bannerUrl}
Use the FULL-BLEED DESIGNED BANNER HERO module: place it edge-to-edge as the first element under the brand header, with NO side padding, NO rounded corners and NO border. Repeat the banner's headline verbatim in its alt text, and put a live HTML headline + CTA button directly beneath it so the email still sells when images are blocked.`);
      }
      if (body.image_url) {
        blocks.push(`HERO PHOTO (hosted): ${body.image_url}
${bannerUrl ? 'The banner above is the hero — use this photo further down instead, in an editorial split or a full-bleed band.' : 'Run it FULL-BLEED edge-to-edge near the top (or in an editorial split), with width/height and real alt text.'}`);
      }
      if (tiles.length) {
        blocks.push(`GALLERY IMAGES (hosted) — use EVERY one of these, in the PHOTO TILE GRID and/or editorial splits. Do not leave any unused:
${tiles.map((u, i) => `  ${i + 1}. ${u}`).join('\n')}`);
      }
      const imageBlock = blocks.length
        ? `${blocks.join('\n\n')}\n\nUse ONLY these hosted URLs. Never invent an image URL, and never use a base64 data URI.`
        : 'NO images supplied — design a clean, premium type-led layout. Compensate for the missing imagery with stronger typographic structure: alternating surfaces, an announcement bar, the now-playing card, and the how-it-works rows.';
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
      const SEGMENTS = ['all', 'buyers_7d', 'buyers_30d', 'recent', 'winback', 'video_buyers', 'no_video', 'nonbuyers', 'everyone_all'];
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
      // Tiles must be pre-cropped to landscape — Outlook ignores object-fit, so
      // an uncropped portrait photo arrives squashed.
      if (body.role === 'tile') {
        const cropped = await cropPhoto({ imageBytes: bytes }, TILE_W, TILE_H, tileFocus(body.focus));
        if (cropped) return json({ success: true, url: await storeImage(admin, cropped, 'image/png'), cropped: true });
      }
      const url = await storeImage(admin, bytes, m[1]);
      return json({ success: true, url });
    }

    // ---- The house photo library (creative-studio/photo-lab) ----
    // These are the text-free, art-directed shots the ad lab already produced
    // and the owner already approved. Picking one costs nothing; generating a
    // fresh photo spends image credits — so the picker is the default path.
    if (action === 'list_photos') {
      const folder = ['photo-lab', 'email-studio'].includes(body.folder) ? body.folder : 'photo-lab';
      const { data, error } = await admin.storage.from('creative-studio')
        .list(folder, { limit: 200, sortBy: { column: 'name', order: 'asc' } });
      if (error) return json({ success: false, error: error.message }, 500);
      const photos = (data || [])
        .filter((o: any) => /\.(png|jpe?g|webp)$/i.test(o.name || ''))
        .map((o: any) => ({
          name: (o.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/^[a-z]\d+-/i, '').replace(/-/g, ' '),
          url: admin.storage.from('creative-studio').getPublicUrl(`${folder}/${o.name}`).data.publicUrl,
        }));
      return json({ success: true, folder, photos });
    }

    // Adopt a library photo. A hero is used as-is (already hosted); a tile gets
    // cropped to landscape first and re-hosted.
    if (action === 'use_photo') {
      const url = (body.url || '').toString().trim();
      if (!/^https?:\/\//.test(url)) return json({ success: false, error: 'A photo url is required' }, 400);
      if (body.role !== 'tile') return json({ success: true, url });
      const cropped = await cropPhoto({ imageUrl: url }, TILE_W, TILE_H, tileFocus(body.focus));
      if (!cropped) return json({ success: false, error: 'Could not crop that photo' }, 502);
      return json({ success: true, url: await storeImage(admin, cropped, 'image/png'), cropped: true });
    }

    if (action === 'gen_image') {
      if (!KIE_IMAGE_ENABLED) return json({ success: false, error: 'Image generation is not enabled (KIE_IMAGE_ENABLED)' }, 400);
      const prompt = (body.prompt || '').toString().trim();
      if (!prompt) return json({ success: false, error: 'prompt is required' }, 400);
      const bytes = await kiePhotoBytes(`${prompt}. ${PHOTO_RULES}`, '3:2');
      if (!bytes) return json({ success: false, error: 'Image generation failed' }, 502);
      const url = await storeImage(admin, bytes, 'image/png');
      return json({ success: true, url });
    }

    // ---- Designed banner hero — the "premium DTC" look ----
    // Same two-layer technique as our Meta ads (text-free photo + a real typeset
    // design layer rendered with resvg), but on a WIDE 1200x750 email canvas and
    // in the chosen email style's accent color, so banner and email match.
    // Source photo: an existing hosted URL, or generated from a prompt.
    if (action === 'banner_hero') {
      const headline = (body.headline || '').toString().trim();
      if (!headline) return json({ success: false, error: 'headline is required' }, 400);
      let bytes: Uint8Array | null = null;
      const photoUrl = (body.photo_url || '').toString().trim();
      if (photoUrl) {
        const r = await fetch(photoUrl);
        if (!r.ok) return json({ success: false, error: `Could not fetch that photo (${r.status})` }, 400);
        bytes = new Uint8Array(await r.arrayBuffer());
      } else {
        const prompt = (body.prompt || '').toString().trim();
        if (!prompt) return json({ success: false, error: 'photo_url or prompt is required' }, 400);
        if (!KIE_IMAGE_ENABLED) return json({ success: false, error: 'Image generation is not enabled (KIE_IMAGE_ENABLED) — upload a photo instead' }, 400);
        bytes = await kiePhotoBytes(`${prompt}. ${PHOTO_RULES}`, '3:2');
        if (!bytes) return json({ success: false, error: 'Image generation failed' }, 502);
      }
      // "Line one | line two" or newlines → up to 3 typeset lines.
      const lines = headline.split(/\n|\s*\|\s*/).map((s: string) => s.trim()).filter(Boolean).slice(0, 3);
      const png = await renderAd({
        template: 'emailhero',
        imageBytes: bytes,
        headlineLines: lines,
        kicker: (body.kicker || '').toString().trim() || undefined,
        accent: (body.accent || '').toString().trim() || undefined,
        sub: (body.sub || '').toString().trim() || undefined,
        cta: (body.cta || '').toString().trim() || undefined,
        accentHex: style.palette.accent,
        inkHex: inkOnAccent(style.palette.accent),
        align: body.align === 'left' ? 'left' : 'center',
        focus: ['top', 'bottom'].includes(body.focus) ? body.focus : 'center',
      });
      if (!png) return json({ success: false, error: 'Banner render failed' }, 502);
      const url = await storeImage(admin, png, 'image/png');
      return json({ success: true, url, headline_lines: lines });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('email-studio error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
