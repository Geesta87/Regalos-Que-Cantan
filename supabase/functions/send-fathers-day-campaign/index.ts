// supabase/functions/send-fathers-day-campaign/index.ts
//
// Sends the Father's Day 2026 campaign. Four emails, fired one at a time via a
// POST that names which email to send. Mirrors the proven Mother's Day sender
// structure with two upgrades:
//   - shared unsubscribe helper (List-Unsubscribe headers + signed token link)
//   - resumable sends (dedup against email_logs so a re-run never double-sends)
//
// The four warm-orange email designs are ported BYTE-FOR-BYTE from
// email-previews/fathers__{1,3,4,5}.html. Only two substitutions are made per
// template: the primary CTA href and the footer "Darme de baja" href.
//
// === AUTH ===
// verify_jwt is FALSE at the gateway for this function (it is triggered by an
// operator / scheduler, not a logged-in browser), so the handler authenticates
// itself: it requires header 'x-campaign-secret' to equal CAMPAIGN_TRIGGER_SECRET.
//
// === DEPLOY (do NOT run from this task) ===
// 1. Add a [functions.send-fathers-day-campaign] block with verify_jwt = false
//    to supabase/config.toml in the SAME commit (see CLAUDE.md §3.2).
// 2. supabase functions deploy send-fathers-day-campaign --project-ref yzbvajungshqcpusfiia
//
// === USAGE ===
//   POST { emailNumber: 1|3|4|5 }                         -> send to all not-yet-sent
//   POST { emailNumber: 1, dryRun: true }                 -> report only, send nothing
//   POST { emailNumber: 1, testEmail: "you@email.com" }   -> send one sample
// All require header: x-campaign-secret: <CAMPAIGN_TRIGGER_SECRET>

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildUnsubscribeHeaders,
  signUnsubscribeToken,
  canonicalEmail,
} from '../_shared/unsubscribe.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;
const CAMPAIGN_TRIGGER_SECRET = Deno.env.get('CAMPAIGN_TRIGGER_SECRET') || '';

const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';
const SITE_URL = 'https://regalosquecantan.com/';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-campaign-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ===========================================================================
// TEMPLATES — ported byte-for-byte from email-previews/fathers__*.html.
// Only two substitutions per template:
//   1. primary CTA href  ("#" -> ${ctaUrl})   — both the MSO roundrect and the
//      non-MSO <a> share the same destination.
//   2. footer "Darme de baja" href ("#" -> ${unsubUrl}).
// Everything else is identical to the approved warm-orange design.
// ===========================================================================

// Shared SVG hero block — identical across all four templates.
const HERO_SVG = `<!--[if !mso]><!-->
              <div style="width:100%;max-width:340px;margin:0 auto;">
                <svg width="100%" viewBox="0 0 340 176" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Onda de sonido Regalos Que Cantan" style="display:block;">
                  <defs>
                    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
                      <stop offset="0" stop-color="#4f93dd" stop-opacity="0.55"/>
                      <stop offset="0.42" stop-color="#2f6fb5" stop-opacity="0.22"/>
                      <stop offset="1" stop-color="#141b27" stop-opacity="0"/>
                    </radialGradient>
                    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#d6e6fb"/>
                      <stop offset="0.45" stop-color="#4f93dd"/>
                      <stop offset="1" stop-color="#2f6fb5"/>
                    </linearGradient>
                    <linearGradient id="barSoft" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#4f93dd" stop-opacity="0.85"/>
                      <stop offset="1" stop-color="#1d4f88" stop-opacity="0.85"/>
                    </linearGradient>
                    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stop-color="#2f6fb5" stop-opacity="0"/>
                      <stop offset="0.5" stop-color="#4f93dd" stop-opacity="0.9"/>
                      <stop offset="1" stop-color="#2f6fb5" stop-opacity="0"/>
                    </linearGradient>
                  </defs>

                  <!-- soft radial glow behind the wave -->
                  <ellipse cx="170" cy="88" rx="150" ry="80" fill="url(#glow)"/>

                  <!-- symmetric waveform (mirrored around centre line y=88) -->
                  <g fill="url(#bar)">
                    <rect x="54"  y="78"  width="4" height="20"  rx="2"/>
                    <rect x="68"  y="68"  width="4" height="40"  rx="2"/>
                    <rect x="82"  y="56"  width="4" height="64"  rx="2"/>
                    <rect x="96"  y="72"  width="4" height="32"  rx="2"/>
                    <rect x="110" y="46"  width="4" height="84"  rx="2"/>
                    <rect x="124" y="62"  width="4" height="52"  rx="2"/>
                    <rect x="138" y="34"  width="4" height="108" rx="2"/>
                    <rect x="152" y="58"  width="4" height="60"  rx="2"/>
                    <rect x="166" y="26"  width="4" height="124" rx="2"/>
                    <rect x="180" y="50"  width="4" height="76"  rx="2"/>
                    <rect x="194" y="38"  width="4" height="100" rx="2"/>
                    <rect x="208" y="64"  width="4" height="48"  rx="2"/>
                    <rect x="222" y="48"  width="4" height="80"  rx="2"/>
                  </g>
                  <g fill="url(#barSoft)">
                    <rect x="236" y="60"  width="4" height="56"  rx="2"/>
                    <rect x="250" y="70"  width="4" height="36"  rx="2"/>
                    <rect x="264" y="58"  width="4" height="60"  rx="2"/>
                    <rect x="278" y="74"  width="4" height="28"  rx="2"/>
                    <rect x="292" y="80"  width="4" height="16"  rx="2"/>
                  </g>

                  <!-- delicate underline flourish -->
                  <path d="M54 150 C120 162 220 162 296 150" fill="none" stroke="url(#line)" stroke-width="1.2"/>

                  <!-- tiny accent dots -->
                  <circle cx="40"  cy="88" r="1.8" fill="#4f93dd"/>
                  <circle cx="300" cy="88" r="1.8" fill="#4f93dd"/>
                </svg>
              </div>
              <!--<![endif]-->
              <!--[if mso]>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" style="font-family:Georgia,serif;font-size:34px;color:#4f93dd;line-height:1;">&#9834;</td></tr></table>
              <![endif]-->`;

// Hero video mockup — "tu canción + tus fotos en video" preview. Used by the
// urgency emails (Tomorrow + Sameday) in place of the plain waveform hero.
const HERO_VIDEO_SVG = `<!--[if !mso]><!-->
              <div style="width:100%;max-width:440px;margin:0 auto;">
                <svg width="100%" viewBox="0 0 440 268" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vista previa: tu canci&oacute;n con tus fotos en video" style="display:block;">
                  <defs>
                    <linearGradient id="vScreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#1a2436"/>
                      <stop offset="1" stop-color="#0d1320"/>
                    </linearGradient>
                    <radialGradient id="vGlow" cx="50%" cy="42%" r="62%">
                      <stop offset="0" stop-color="#4f93dd" stop-opacity="0.30"/>
                      <stop offset="1" stop-color="#0d1320" stop-opacity="0"/>
                    </radialGradient>
                    <linearGradient id="vFrame" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stop-color="#28323f"/>
                      <stop offset="0.5" stop-color="#4f93dd"/>
                      <stop offset="1" stop-color="#1d4f88"/>
                    </linearGradient>
                    <linearGradient id="photoA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#d8bca0"/>
                      <stop offset="1" stop-color="#b98e6e"/>
                    </linearGradient>
                    <linearGradient id="photoB" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#cdb094"/>
                      <stop offset="1" stop-color="#a07a5c"/>
                    </linearGradient>
                    <linearGradient id="photoC" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#a8c2dc"/>
                      <stop offset="1" stop-color="#8fa9c4"/>
                    </linearGradient>
                    <clipPath id="clipScreen"><rect x="20" y="16" width="400" height="200" rx="16"/></clipPath>
                  </defs>

                  <!-- player frame -->
                  <rect x="13" y="9" width="414" height="214" rx="22" fill="url(#vFrame)" opacity="0.55"/>
                  <rect x="16" y="12" width="408" height="208" rx="20" fill="#141b27"/>
                  <rect x="20" y="16" width="400" height="200" rx="16" fill="url(#vScreen)"/>

                  <g clip-path="url(#clipScreen)">
                    <rect x="20" y="16" width="400" height="200" fill="url(#vGlow)"/>

                    <!-- photo collage: three family snapshots -->
                    <!-- left photo -->
                    <g transform="translate(44,52)">
                      <rect x="-3" y="-3" width="114" height="128" rx="12" fill="#0d1320" opacity="0.55"/>
                      <rect width="108" height="122" rx="10" fill="url(#photoB)"/>
                      <g fill="#5f4633" opacity="0.92">
                        <circle cx="54" cy="44" r="21"/>
                        <path d="M18 122 C18 92 38 76 54 76 C70 76 90 92 90 122 Z"/>
                      </g>
                      <rect width="108" height="122" rx="10" fill="none" stroke="#eef3fa" stroke-width="2" opacity="0.5"/>
                    </g>
                    <!-- center photo (raised, hero) -->
                    <g transform="translate(166,38)">
                      <rect x="-3" y="-3" width="114" height="150" rx="12" fill="#0d1320" opacity="0.6"/>
                      <rect width="108" height="144" rx="10" fill="url(#photoA)"/>
                      <g fill="#6e503a" opacity="0.92">
                        <circle cx="54" cy="50" r="24"/>
                        <path d="M14 144 C14 108 38 90 54 90 C70 90 94 108 94 144 Z"/>
                      </g>
                      <rect width="108" height="144" rx="10" fill="none" stroke="#eef3fa" stroke-width="2" opacity="0.55"/>
                    </g>
                    <!-- right photo -->
                    <g transform="translate(288,52)">
                      <rect x="-3" y="-3" width="114" height="128" rx="12" fill="#0d1320" opacity="0.55"/>
                      <rect width="108" height="122" rx="10" fill="url(#photoC)"/>
                      <g fill="#46586b" opacity="0.9">
                        <circle cx="54" cy="44" r="21"/>
                        <path d="M18 122 C18 92 38 76 54 76 C70 76 90 92 90 122 Z"/>
                      </g>
                      <rect width="108" height="122" rx="10" fill="none" stroke="#eef3fa" stroke-width="2" opacity="0.5"/>
                    </g>

                    <!-- warm accents -->
                    <path d="M132 44 c-4 -7 -15 -4 -15 4 c0 6 9 11 15 16 c6 -5 15 -10 15 -16 c0 -8 -11 -11 -15 -4 z" fill="#f0d8c0" opacity="0.85"/>
                    <g fill="#9cc4f2" opacity="0.85">
                      <circle cx="300" cy="40" r="3.4"/>
                      <rect x="302" y="24" width="2.4" height="18" rx="1.2"/>
                      <path d="M302 24 h11 v4 h-11 z"/>
                    </g>
                  </g>

                  <!-- play button -->
                  <circle cx="220" cy="116" r="38" fill="#0d1320" opacity="0.42"/>
                  <circle cx="220" cy="116" r="31" fill="#eef3fa"/>
                  <circle cx="220" cy="116" r="31" fill="none" stroke="#4f93dd" stroke-width="2" opacity="0.6"/>
                  <path d="M211 100 L238 116 L211 132 Z" fill="#1d4f88"/>

                  <!-- now-playing bar -->
                  <g transform="translate(20,180)">
                    <rect x="0" y="0" width="400" height="36" rx="0" fill="#0d1320" opacity="0.62"/>
                    <!-- progress track -->
                    <rect x="20" y="11" width="300" height="3" rx="1.5" fill="#28323f"/>
                    <rect x="20" y="11" width="96" height="3" rx="1.5" fill="#4f93dd"/>
                    <circle cx="116" cy="12.5" r="4" fill="#9cc4f2"/>
                    <!-- equalizer -->
                    <g fill="#4f93dd">
                      <rect x="332" y="9" width="3" height="9" rx="1.5"/>
                      <rect x="338" y="5" width="3" height="13" rx="1.5"/>
                      <rect x="344" y="11" width="3" height="7" rx="1.5"/>
                      <rect x="350" y="3" width="3" height="15" rx="1.5"/>
                      <rect x="356" y="8" width="3" height="10" rx="1.5"/>
                      <rect x="362" y="12" width="3" height="6" rx="1.5"/>
                      <rect x="368" y="6" width="3" height="12" rx="1.5"/>
                    </g>
                    <!-- label -->
                    <text x="20" y="30" fill="#aebccd" font-family="Inter, Arial, sans-serif" font-size="10" letter-spacing="0.4">Para Pap&aacute; &middot; 0:12 / 3:04</text>
                  </g>
                </svg>
                <div style="text-align:center;font-family:'Inter',Arial,sans-serif;font-size:11px;font-weight:300;color:#5d6b7e;letter-spacing:.4px;padding-top:12px;">As&iacute; se ve: tu canci&oacute;n + tus fotos en video</div>
              </div>
              <!--<![endif]-->
              <!--[if mso]>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" style="font-family:Georgia,serif;font-size:13px;color:#aebccd;line-height:1.5;">&#9654;&nbsp;Tu canci&oacute;n + tus fotos en video</td></tr></table>
              <![endif]-->`;

// Shared footer block — identical across all four templates except the unsub href.
function footerBlock(unsubUrl: string): string {
  return `<!-- ====== FOOTER ====== -->
          <tr>
            <td align="center" class="px serif" style="padding:26px 56px 0;">
              <span style="font-size:17px;font-weight:600;letter-spacing:.3px;color:#aebccd;">Regalos<span style="color:#2f6fb5;font-style:italic;">Que</span>Cantan</span>
            </td>
          </tr>
          <tr>
            <td align="center" class="px-sm sans" style="padding:12px 56px 0;">
              <p style="margin:0;font-size:11px;font-weight:300;color:#5d6b7e;line-height:1.9;letter-spacing:.4px;">
                Regalos Que Cantan · Los Angeles, CA 91324, USA<br>
                <a href="mailto:hola@regalosquecantan.com" style="color:#aebccd;text-decoration:none;border-bottom:1px solid rgba(174,188,205,0.4);">hola@regalosquecantan.com</a>
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" class="px-sm sans" style="padding:16px 56px 44px;">
              <p style="margin:0;font-size:10.5px;font-weight:300;color:#5d6b7e;letter-spacing:.3px;">
                Recibes este correo porque te suscribiste a Regalos Que Cantan.<br>
                <a href="${unsubUrl}" style="color:#5d6b7e;text-decoration:underline;">Darme de baja</a>
              </p>
            </td>
          </tr>

          <!-- bottom orange rule -->
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:#4f93dd;
              background-image:linear-gradient(90deg,#1d4f88 0%,#4f93dd 32%,#d6e6fb 50%,#4f93dd 68%,#1d4f88 100%);">&nbsp;</td>
          </tr>

        </table>
        <!-- ============ /CARD ============ -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}

// --- Email 1: launch (fathers__1-launch.html) ---
function templateLaunch(ctaUrl: string, unsubUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Faltan 5 días para el Día del Padre</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<!--[if mso]>
<style type="text/css">
  .serif, .sans, h1, h2, p, span, a, td { font-family: Georgia, 'Times New Roman', serif !important; }
</style>
<![endif]-->
<style type="text/css">
  body { margin:0; padding:0; background:#0b0f17; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  .serif { font-family:'Fraunces', Georgia, 'Times New Roman', serif; }
  .sans  { font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  @media only screen and (max-width:620px){
    .container { width:100% !important; }
    .px   { padding-left:28px !important; padding-right:28px !important; }
    .px-sm{ padding-left:24px !important; padding-right:24px !important; }
    .h1   { font-size:38px !important; line-height:1.12 !important; }
    .hero-pad { padding-top:36px !important; padding-bottom:6px !important; }
    .card-pad { padding:26px 22px !important; }
    .cta a { padding-left:40px !important; padding-right:40px !important; }
    .stack { display:block !important; width:100% !important; }
    .stack-pl { padding-left:0 !important; padding-top:18px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0b0f17;">

  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:#0b0f17;font-size:1px;line-height:1px;">
    El Día del Padre es el domingo 21 de junio. Su canción se entrega en minutos.
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0f17;">
    <tr>
      <td align="center" style="padding:30px 12px;">

        <!-- ============ CARD / FRAME ============ -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#141b27;">

          <!-- top orange rule -->
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:#4f93dd;
              background-image:linear-gradient(90deg,#1d4f88 0%,#4f93dd 32%,#d6e6fb 50%,#4f93dd 68%,#1d4f88 100%);">&nbsp;</td>
          </tr>

          <!-- ====== HEADER (wordmark only) ====== -->
          <tr>
            <td align="center" class="px" style="padding:40px 56px 0;">
              <span class="serif" style="font-size:27px;font-weight:600;letter-spacing:.2px;color:#eef3fa;">Regalos<span style="color:#4f93dd;font-style:italic;">Que</span>Cantan</span>
            </td>
          </tr>

          <!-- ====== ORNAMENTAL HERO: warm orange radial glow + waveform ====== -->
          <tr>
            <td align="center" class="hero-pad" style="padding:36px 40px 4px;">
              ${HERO_SVG}
            </td>
          </tr>

          <!-- ====== EYEBROW + HEADLINE ====== -->
          <tr>
            <td align="center" class="px sans" style="padding:16px 56px 0;">
              <span style="font-size:10.5px;font-weight:600;letter-spacing:4.5px;text-transform:uppercase;color:#4f93dd;">Día del Padre · Domingo 21 de junio</span>
            </td>
          </tr>
          <tr>
            <td align="center" class="px serif" style="padding:14px 44px 0;">
              <h1 class="h1" style="margin:0;font-size:44px;line-height:1.1;font-weight:500;color:#eef3fa;letter-spacing:.1px;">
                Faltan 5 días.<br>
                <span style="font-style:italic;color:#9cc4f2;">¿Ya sabes qué le vas a dar?</span>
              </h1>
            </td>
          </tr>
          <tr>
            <td align="center" class="px sans" style="padding:20px 64px 0;">
              <p style="margin:0;font-size:15px;line-height:1.85;font-weight:300;color:#aebccd;letter-spacing:.2px;">
                Una canción hecha con su historia — su nombre, sus recuerdos, su género favorito. Lista en minutos.
              </p>
            </td>
          </tr>

          <!-- ====== CTA (single primary) ====== -->
          <tr>
            <td align="center" class="cta" style="padding:32px 48px 0;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${ctaUrl}" style="height:54px;v-text-anchor:middle;width:300px;" arcsize="50%" stroke="f" fillcolor="#4f93dd">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Georgia,serif;font-size:15px;font-weight:bold;letter-spacing:1px;">Crear su canción</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:40px;background:#4f93dd;background-image:linear-gradient(180deg,#9cc4f2 0%,#4f93dd 52%,#2f6fb5 100%);box-shadow:0 8px 22px rgba(79,147,221,0.40);">
                    <a href="${ctaUrl}" class="sans" style="display:inline-block;padding:18px 54px;font-size:14px;font-weight:600;letter-spacing:2.2px;text-transform:uppercase;color:#ffffff;">Crear su canción</a>
                  </td>
                </tr>
              </table>
              <!--<![endif]-->
            </td>
          </tr>
          <tr>
            <td align="center" class="px sans" style="padding:14px 56px 0;">
              <p style="margin:0;font-size:11.5px;font-weight:300;color:#5d6b7e;letter-spacing:1px;">Lista en ~10 minutos · perfecta de última hora</p>
            </td>
          </tr>

          <!-- ====== OFFER CARD ====== -->
          <tr>
            <td class="px" style="padding:34px 48px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#1a2332;background-image:linear-gradient(180deg,#1a2332 0%,#141b27 100%);border:1px solid #28323f;border-radius:16px;">
                <tr><td style="height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,rgba(79,147,221,0.6) 50%,rgba(79,147,221,0) 100%);">&nbsp;</td></tr>
                <tr>
                  <td class="card-pad" style="padding:30px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <!-- single song -->
                        <td class="stack" valign="middle" style="vertical-align:middle;width:50%;text-align:center;">
                          <span class="sans" style="font-size:9.5px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#aebccd;">Una canción</span>
                          <p class="serif" style="margin:9px 0 0;font-size:34px;font-weight:600;color:#eef3fa;line-height:1;">$29.99</p>
                        </td>
                        <!-- pack of two -->
                        <td class="stack stack-pl" valign="middle" style="vertical-align:middle;width:50%;text-align:center;border-left:1px solid #28323f;">
                          <span class="sans" style="font-size:9.5px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#9cc4f2;">Pack de dos</span>
                          <p class="serif" style="margin:9px 0 0;font-size:34px;font-weight:600;color:#eef3fa;line-height:1;">$39.99</p>
                          <p class="sans" style="margin:8px 0 0;font-size:11px;font-weight:500;letter-spacing:.5px;color:#aebccd;">ahorra $19.99</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,rgba(79,147,221,0.6) 50%,rgba(79,147,221,0) 100%);">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <!-- divider -->
          <tr>
            <td align="center" class="px" style="padding:36px 56px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:100px;height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,#1d4f88 100%);">&nbsp;</td>
                  <td style="padding:0 12px;font-size:9px;color:#2f6fb5;line-height:1;">&#9834;</td>
                  <td style="width:100px;height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,#1d4f88 0%,rgba(79,147,221,0) 100%);">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ====== CLOSING NOTE ====== -->
          <tr>
            <td align="center" class="px serif" style="padding:24px 62px 0;">
              <p style="margin:0;font-size:18px;font-style:italic;font-weight:400;color:#aebccd;line-height:1.6;">
                «Un regalo que él recordará mucho después de que termine el domingo.»
              </p>
            </td>
          </tr>

          <!-- ====== FOOTER ====== -->
          <tr>
            <td align="center" class="px" style="padding:44px 56px 0;">
              <div style="height:1px;line-height:1px;font-size:0;background:#28323f;">&nbsp;</div>
            </td>
          </tr>
          ${footerBlock(unsubUrl)}`;
}

// --- Email 3: weekend (fathers__3-weekend.html) ---
function templateWeekend(ctaUrl: string, unsubUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Este fin de semana es el momento</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<!--[if mso]>
<style type="text/css">
  .serif, .sans, h1, h2, p, span, a, td { font-family: Georgia, 'Times New Roman', serif !important; }
</style>
<![endif]-->
<style type="text/css">
  body { margin:0; padding:0; background:#0b0f17; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  .serif { font-family:'Fraunces', Georgia, 'Times New Roman', serif; }
  .sans  { font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  @media only screen and (max-width:620px){
    .container { width:100% !important; }
    .px   { padding-left:28px !important; padding-right:28px !important; }
    .px-sm{ padding-left:24px !important; padding-right:24px !important; }
    .h1   { font-size:38px !important; line-height:1.12 !important; }
    .hero-pad { padding-top:36px !important; padding-bottom:6px !important; }
    .card-pad { padding:26px 22px !important; }
    .cta a { padding-left:40px !important; padding-right:40px !important; }
    .stack { display:block !important; width:100% !important; }
    .stack-pl { padding-left:0 !important; padding-top:18px !important; }
    .step-num { padding-bottom:14px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0b0f17;">

  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:#0b0f17;font-size:1px;line-height:1px;">
    El domingo es el Día del Padre. Empieza su canción hoy y tenla lista sin prisas.
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0f17;">
    <tr>
      <td align="center" style="padding:30px 12px;">

        <!-- ============ CARD / FRAME ============ -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#141b27;">

          <!-- top orange rule -->
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:#4f93dd;
              background-image:linear-gradient(90deg,#1d4f88 0%,#4f93dd 32%,#d6e6fb 50%,#4f93dd 68%,#1d4f88 100%);">&nbsp;</td>
          </tr>

          <!-- ====== HEADER (wordmark only) ====== -->
          <tr>
            <td align="center" class="px" style="padding:40px 56px 0;">
              <span class="serif" style="font-size:27px;font-weight:600;letter-spacing:.2px;color:#eef3fa;">Regalos<span style="color:#4f93dd;font-style:italic;">Que</span>Cantan</span>
            </td>
          </tr>

          <!-- ====== ORNAMENTAL HERO: warm orange radial glow + waveform ====== -->
          <tr>
            <td align="center" class="hero-pad" style="padding:36px 40px 4px;">
              ${HERO_SVG}
            </td>
          </tr>

          <!-- ====== EYEBROW + HEADLINE ====== -->
          <tr>
            <td align="center" class="px sans" style="padding:16px 56px 0;">
              <span style="font-size:10.5px;font-weight:600;letter-spacing:4.5px;text-transform:uppercase;color:#4f93dd;">Último fin de semana</span>
            </td>
          </tr>
          <tr>
            <td align="center" class="px serif" style="padding:14px 44px 0;">
              <h1 class="h1" style="margin:0;font-size:44px;line-height:1.1;font-weight:500;color:#eef3fa;letter-spacing:.1px;">
                Este fin de semana<br>
                <span style="font-style:italic;color:#9cc4f2;">es el momento.</span>
              </h1>
            </td>
          </tr>
          <tr>
            <td align="center" class="px sans" style="padding:20px 64px 0;">
              <p style="margin:0;font-size:15px;line-height:1.85;font-weight:300;color:#aebccd;letter-spacing:.2px;">
                El domingo es el Día del Padre. Empieza su canción hoy y tenla lista sin prisas.
              </p>
            </td>
          </tr>

          <!-- ====== CTA (single primary) ====== -->
          <tr>
            <td align="center" class="cta" style="padding:32px 48px 0;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${ctaUrl}" style="height:54px;v-text-anchor:middle;width:300px;" arcsize="50%" stroke="f" fillcolor="#4f93dd">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Georgia,serif;font-size:15px;font-weight:bold;letter-spacing:1px;">Empezar su canción</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:40px;background:#4f93dd;background-image:linear-gradient(180deg,#9cc4f2 0%,#4f93dd 52%,#2f6fb5 100%);box-shadow:0 8px 22px rgba(79,147,221,0.40);">
                    <a href="${ctaUrl}" class="sans" style="display:inline-block;padding:18px 54px;font-size:14px;font-weight:600;letter-spacing:2.2px;text-transform:uppercase;color:#ffffff;">Empezar su canción</a>
                  </td>
                </tr>
              </table>
              <!--<![endif]-->
            </td>
          </tr>
          <tr>
            <td align="center" class="px sans" style="padding:14px 56px 0;">
              <p style="margin:0;font-size:11.5px;font-weight:300;color:#5d6b7e;letter-spacing:1px;">Lista en ~10 minutos · sin esperas</p>
            </td>
          </tr>

          <!-- ====== HOW IT WORKS · 3 STEPS CARD ====== -->
          <tr>
            <td class="px" style="padding:34px 48px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#1a2332;background-image:linear-gradient(180deg,#1a2332 0%,#141b27 100%);border:1px solid #28323f;border-radius:16px;">
                <tr><td style="height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,rgba(79,147,221,0.6) 50%,rgba(79,147,221,0) 100%);">&nbsp;</td></tr>
                <tr>
                  <td class="card-pad" style="padding:28px 30px;">
                    <p class="sans" style="margin:0 0 22px;font-size:9.5px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#aebccd;text-align:center;">Cómo funciona · 3 pasos</p>

                    <!-- step 1 -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td class="step-num" width="52" valign="top" style="vertical-align:top;padding-right:18px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                            <td align="center" valign="middle" width="44" height="44" style="width:44px;height:44px;background:#1a2332;background-image:linear-gradient(180deg,#28323f 0%,#141b27 100%);border:1px solid #28323f;border-radius:50%;text-align:center;vertical-align:middle;">
                              <span class="serif" style="font-size:18px;font-weight:600;color:#9cc4f2;line-height:44px;">1</span>
                            </td>
                          </tr></table>
                        </td>
                        <td valign="middle" style="vertical-align:middle;">
                          <p class="sans" style="margin:0;font-size:14px;font-weight:500;color:#eef3fa;line-height:1.5;">Cuéntanos su historia</p>
                          <p class="sans" style="margin:3px 0 0;font-size:12px;font-weight:300;color:#aebccd;line-height:1.5;">Su nombre, sus recuerdos, lo que lo hace especial.</p>
                        </td>
                      </tr>
                    </table>
                    <!-- step divider -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:1px;line-height:1px;font-size:0;padding:18px 0;"><div style="height:1px;background:#28323f;">&nbsp;</div></td></tr></table>
                    <!-- step 2 -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td class="step-num" width="52" valign="top" style="vertical-align:top;padding-right:18px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                            <td align="center" valign="middle" width="44" height="44" style="width:44px;height:44px;background:#1a2332;background-image:linear-gradient(180deg,#28323f 0%,#141b27 100%);border:1px solid #28323f;border-radius:50%;text-align:center;vertical-align:middle;">
                              <span class="serif" style="font-size:18px;font-weight:600;color:#9cc4f2;line-height:44px;">2</span>
                            </td>
                          </tr></table>
                        </td>
                        <td valign="middle" style="vertical-align:middle;">
                          <p class="sans" style="margin:0;font-size:14px;font-weight:500;color:#eef3fa;line-height:1.5;">Elige el género</p>
                          <p class="sans" style="margin:3px 0 0;font-size:12px;font-weight:300;color:#aebccd;line-height:1.5;">Bachata, corrido, norteño, balada — su favorito.</p>
                        </td>
                      </tr>
                    </table>
                    <!-- step divider -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:1px;line-height:1px;font-size:0;padding:18px 0;"><div style="height:1px;background:#28323f;">&nbsp;</div></td></tr></table>
                    <!-- step 3 -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td class="step-num" width="52" valign="top" style="vertical-align:top;padding-right:18px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                            <td align="center" valign="middle" width="44" height="44" style="width:44px;height:44px;background:#1a2332;background-image:linear-gradient(180deg,#28323f 0%,#141b27 100%);border:1px solid #28323f;border-radius:50%;text-align:center;vertical-align:middle;">
                              <span class="serif" style="font-size:18px;font-weight:600;color:#9cc4f2;line-height:44px;">3</span>
                            </td>
                          </tr></table>
                        </td>
                        <td valign="middle" style="vertical-align:middle;">
                          <p class="sans" style="margin:0;font-size:14px;font-weight:500;color:#eef3fa;line-height:1.5;">Recíbela en minutos</p>
                          <p class="sans" style="margin:3px 0 0;font-size:12px;font-weight:300;color:#aebccd;line-height:1.5;">Lista en ~10 minutos, directo a tu teléfono.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,rgba(79,147,221,0.6) 50%,rgba(79,147,221,0) 100%);">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <!-- divider -->
          <tr>
            <td align="center" class="px" style="padding:36px 56px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:100px;height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,#1d4f88 100%);">&nbsp;</td>
                  <td style="padding:0 12px;font-size:9px;color:#2f6fb5;line-height:1;">&#9834;</td>
                  <td style="width:100px;height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,#1d4f88 0%,rgba(79,147,221,0) 100%);">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ====== FOOTER ====== -->
          <tr>
            <td align="center" class="px" style="padding:30px 56px 0;">
              <div style="height:1px;line-height:1px;font-size:0;background:#28323f;">&nbsp;</div>
            </td>
          </tr>
          ${footerBlock(unsubUrl)}`;
}

// --- Email 4: tomorrow (fathers__4-tomorrow.html) ---
function templateTomorrow(ctaUrl: string, unsubUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Mañana es el Día del Padre</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<!--[if mso]>
<style type="text/css">
  .serif, .sans, h1, h2, p, span, a, td { font-family: Georgia, 'Times New Roman', serif !important; }
</style>
<![endif]-->
<style type="text/css">
  body { margin:0; padding:0; background:#0b0f17; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  .serif { font-family:'Fraunces', Georgia, 'Times New Roman', serif; }
  .sans  { font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  @media only screen and (max-width:620px){
    .container { width:100% !important; }
    .px   { padding-left:28px !important; padding-right:28px !important; }
    .px-sm{ padding-left:24px !important; padding-right:24px !important; }
    .h1   { font-size:38px !important; line-height:1.12 !important; }
    .hero-pad { padding-top:36px !important; padding-bottom:6px !important; }
    .card-pad { padding:26px 22px !important; }
    .cta a { padding-left:40px !important; padding-right:40px !important; }
    .stack { display:block !important; width:100% !important; }
    .stack-pl { padding-left:0 !important; padding-top:18px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0b0f17;">

  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:#0b0f17;font-size:1px;line-height:1px;">
    Todavía estás a tiempo — su canción se entrega en minutos, directo a tu teléfono.
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0f17;">
    <tr>
      <td align="center" style="padding:30px 12px;">

        <!-- ============ CARD / FRAME ============ -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#141b27;">

          <!-- top orange rule -->
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:#4f93dd;
              background-image:linear-gradient(90deg,#1d4f88 0%,#4f93dd 32%,#d6e6fb 50%,#4f93dd 68%,#1d4f88 100%);">&nbsp;</td>
          </tr>

          <!-- ====== HEADER (wordmark only) ====== -->
          <tr>
            <td align="center" class="px" style="padding:40px 56px 0;">
              <span class="serif" style="font-size:27px;font-weight:600;letter-spacing:.2px;color:#eef3fa;">Regalos<span style="color:#4f93dd;font-style:italic;">Que</span>Cantan</span>
            </td>
          </tr>

          <!-- ====== HERO: video-of-your-photos product mockup ====== -->
          <tr>
            <td align="center" class="hero-pad" style="padding:36px 40px 4px;">
              ${HERO_VIDEO_SVG}
            </td>
          </tr>

          <!-- ====== EYEBROW + HEADLINE ====== -->
          <tr>
            <td align="center" class="px sans" style="padding:16px 56px 0;">
              <span style="font-size:10.5px;font-weight:600;letter-spacing:4.5px;text-transform:uppercase;color:#4f93dd;">Mañana es el día</span>
            </td>
          </tr>
          <tr>
            <td align="center" class="px serif" style="padding:14px 44px 0;">
              <h1 class="h1" style="margin:0;font-size:44px;line-height:1.1;font-weight:500;color:#eef3fa;letter-spacing:.1px;">
                Mañana es el<br>
                <span style="font-style:italic;color:#9cc4f2;">Día del Padre.</span>
              </h1>
            </td>
          </tr>
          <tr>
            <td align="center" class="px sans" style="padding:20px 64px 0;">
              <p style="margin:0;font-size:15px;line-height:1.85;font-weight:300;color:#aebccd;letter-spacing:.2px;">
                Reg&aacute;lale su canci&oacute;n personalizada &mdash; y convi&eacute;rtela en un video con tus fotos favoritas. Listo en minutos, directo a tu tel&eacute;fono.
              </p>
            </td>
          </tr>

          <!-- ====== DISCOUNT BADGE ====== -->
          <tr>
            <td align="center" class="px sans" style="padding:24px 56px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                <tr><td style="background:#13233a;border:1px solid #2f6fb5;border-radius:8px;padding:11px 20px;">
                  <span style="font-size:12.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9cc4f2;font-family:'Inter',Arial,sans-serif;">10% de descuento &mdash; hoy y ma&ntilde;ana</span>
                </td></tr>
              </table>
              <p style="margin:9px 0 0;font-size:11.5px;color:#5d6b7e;font-family:'Inter',Arial,sans-serif;">Se aplica autom&aacute;ticamente al pagar &middot; c&oacute;digo PAPA10</p>
            </td>
          </tr>

          <!-- ====== CTA (single primary) ====== -->
          <tr>
            <td align="center" class="cta" style="padding:32px 48px 0;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${ctaUrl}" style="height:54px;v-text-anchor:middle;width:320px;" arcsize="50%" stroke="f" fillcolor="#4f93dd">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Georgia,serif;font-size:15px;font-weight:bold;letter-spacing:1px;">Hacer su canción ahora</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:40px;background:#4f93dd;background-image:linear-gradient(180deg,#9cc4f2 0%,#4f93dd 52%,#2f6fb5 100%);box-shadow:0 8px 22px rgba(79,147,221,0.40);">
                    <a href="${ctaUrl}" class="sans" style="display:inline-block;padding:18px 50px;font-size:14px;font-weight:600;letter-spacing:2.2px;text-transform:uppercase;color:#ffffff;">Hacer su canción ahora</a>
                  </td>
                </tr>
              </table>
              <!--<![endif]-->
            </td>
          </tr>
          <tr>
            <td align="center" class="px sans" style="padding:14px 56px 0;">
              <p style="margin:0;font-size:11.5px;font-weight:300;color:#5d6b7e;letter-spacing:1px;">Lista esta misma noche · sin imprenta, sin envíos</p>
            </td>
          </tr>

          <!-- ====== REASSURANCE / URGENCY CARD ====== -->
          <tr>
            <td class="px" style="padding:34px 48px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#1a2332;background-image:linear-gradient(180deg,#1a2332 0%,#141b27 100%);border:1px solid #28323f;border-radius:16px;">
                <tr><td style="height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,rgba(79,147,221,0.6) 50%,rgba(79,147,221,0) 100%);">&nbsp;</td></tr>
                <tr>
                  <td class="card-pad" style="padding:30px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <!-- delivery seal -->
                        <td class="stack" width="78" valign="middle" style="vertical-align:middle;padding-right:20px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                            <td align="center" valign="middle" width="64" height="64" style="width:64px;height:64px;background:#1a2332;background-image:linear-gradient(180deg,#28323f 0%,#141b27 100%);border:1px solid #28323f;border-radius:50%;text-align:center;vertical-align:middle;">
                              <span style="font-size:24px;color:#9cc4f2;line-height:64px;">&#9201;</span>
                            </td>
                          </tr></table>
                        </td>
                        <!-- copy -->
                        <td class="stack stack-pl" valign="middle" style="vertical-align:middle;">
                          <span class="sans" style="font-size:9.5px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#aebccd;">EL REGALO PERFECTO</span>
                          <p class="serif" style="margin:7px 0 8px;font-size:22px;font-weight:600;color:#eef3fa;line-height:1.2;">Canci&oacute;n + video con tus fotos</p>
                          <p class="sans" style="margin:0;font-size:13px;font-weight:300;color:#aebccd;line-height:1.6;letter-spacing:.3px;">
                            Su historia hecha canci&oacute;n, con tus fotos en video. Entrega en ~10 minutos &mdash; a tiempo para ma&ntilde;ana.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,rgba(79,147,221,0.6) 50%,rgba(79,147,221,0) 100%);">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <!-- divider -->
          <tr>
            <td align="center" class="px" style="padding:36px 56px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:100px;height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,#1d4f88 100%);">&nbsp;</td>
                  <td style="padding:0 12px;font-size:9px;color:#2f6fb5;line-height:1;">&#9834;</td>
                  <td style="width:100px;height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,#1d4f88 0%,rgba(79,147,221,0) 100%);">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ====== FOOTER ====== -->
          <tr>
            <td align="center" class="px" style="padding:30px 56px 0;">
              <div style="height:1px;line-height:1px;font-size:0;background:#28323f;">&nbsp;</div>
            </td>
          </tr>
          ${footerBlock(unsubUrl)}`;
}

// --- Email 5: sameday (fathers__5-sameday.html) ---
function templateSameday(ctaUrl: string, unsubUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Hoy es el Día del Padre — todavía estás a tiempo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<!--[if mso]>
<style type="text/css">
  .serif, .sans, h1, h2, p, span, a, td { font-family: Georgia, 'Times New Roman', serif !important; }
</style>
<![endif]-->
<style type="text/css">
  body { margin:0; padding:0; background:#0b0f17; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  .serif { font-family:'Fraunces', Georgia, 'Times New Roman', serif; }
  .sans  { font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  @media only screen and (max-width:620px){
    .container { width:100% !important; }
    .px   { padding-left:28px !important; padding-right:28px !important; }
    .px-sm{ padding-left:24px !important; padding-right:24px !important; }
    .h1   { font-size:38px !important; line-height:1.12 !important; }
    .hero-pad { padding-top:36px !important; padding-bottom:6px !important; }
    .card-pad { padding:26px 22px !important; }
    .cta a { padding-left:40px !important; padding-right:40px !important; }
    .stack { display:block !important; width:100% !important; }
    .stack-pl { padding-left:0 !important; padding-top:18px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0b0f17;">

  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:#0b0f17;font-size:1px;line-height:1px;">
    Hoy es el Día del Padre y tu canción llega en minutos. El mejor regalo de última hora.
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0f17;">
    <tr>
      <td align="center" style="padding:30px 12px;">

        <!-- ============ CARD / FRAME ============ -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#141b27;">

          <!-- top orange rule -->
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:#4f93dd;
              background-image:linear-gradient(90deg,#1d4f88 0%,#4f93dd 32%,#d6e6fb 50%,#4f93dd 68%,#1d4f88 100%);">&nbsp;</td>
          </tr>

          <!-- ====== HEADER (wordmark only) ====== -->
          <tr>
            <td align="center" class="px" style="padding:40px 56px 0;">
              <span class="serif" style="font-size:27px;font-weight:600;letter-spacing:.2px;color:#eef3fa;">Regalos<span style="color:#4f93dd;font-style:italic;">Que</span>Cantan</span>
            </td>
          </tr>

          <!-- ====== HERO: video-of-your-photos product mockup ====== -->
          <tr>
            <td align="center" class="hero-pad" style="padding:36px 40px 4px;">
              ${HERO_VIDEO_SVG}
            </td>
          </tr>

          <!-- ====== EYEBROW + HEADLINE ====== -->
          <tr>
            <td align="center" class="px sans" style="padding:16px 56px 0;">
              <span style="font-size:10.5px;font-weight:600;letter-spacing:4.5px;text-transform:uppercase;color:#4f93dd;">Hoy · Día del Padre</span>
            </td>
          </tr>
          <tr>
            <td align="center" class="px serif" style="padding:14px 44px 0;">
              <h1 class="h1" style="margin:0;font-size:44px;line-height:1.1;font-weight:500;color:#eef3fa;letter-spacing:.1px;">
                Todavía estás<br>
                <span style="font-style:italic;color:#9cc4f2;">a tiempo.</span>
              </h1>
            </td>
          </tr>
          <tr>
            <td align="center" class="px sans" style="padding:20px 64px 0;">
              <p style="margin:0;font-size:15px;line-height:1.85;font-weight:300;color:#aebccd;letter-spacing:.2px;">
                Hoy es el D&iacute;a del Padre. Su canci&oacute;n personalizada &mdash; con un video de tus fotos &mdash; llega en minutos. El regalo perfecto de &uacute;ltima hora.
              </p>
            </td>
          </tr>

          <!-- ====== DISCOUNT BADGE ====== -->
          <tr>
            <td align="center" class="px sans" style="padding:24px 56px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                <tr><td style="background:#13233a;border:1px solid #2f6fb5;border-radius:8px;padding:11px 20px;">
                  <span style="font-size:12.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9cc4f2;font-family:'Inter',Arial,sans-serif;">10% de descuento &mdash; solo hoy</span>
                </td></tr>
              </table>
              <p style="margin:9px 0 0;font-size:11.5px;color:#5d6b7e;font-family:'Inter',Arial,sans-serif;">Se aplica autom&aacute;ticamente al pagar &middot; c&oacute;digo PAPA10</p>
            </td>
          </tr>

          <!-- ====== CTA (single primary) ====== -->
          <tr>
            <td align="center" class="cta" style="padding:32px 48px 0;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${ctaUrl}" style="height:54px;v-text-anchor:middle;width:320px;" arcsize="50%" stroke="f" fillcolor="#4f93dd">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Georgia,serif;font-size:15px;font-weight:bold;letter-spacing:1px;">Crear su canción ahora</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:40px;background:#4f93dd;background-image:linear-gradient(180deg,#9cc4f2 0%,#4f93dd 52%,#2f6fb5 100%);box-shadow:0 8px 22px rgba(79,147,221,0.40);">
                    <a href="${ctaUrl}" class="sans" style="display:inline-block;padding:18px 50px;font-size:14px;font-weight:600;letter-spacing:2.2px;text-transform:uppercase;color:#ffffff;">Crear su canción ahora</a>
                  </td>
                </tr>
              </table>
              <!--<![endif]-->
            </td>
          </tr>
          <tr>
            <td align="center" class="px sans" style="padding:14px 56px 0;">
              <p style="margin:0;font-size:11.5px;font-weight:300;color:#5d6b7e;letter-spacing:1px;">A tiempo para hoy · sin esperas</p>
            </td>
          </tr>

          <!-- ====== URGENCY CARD ====== -->
          <tr>
            <td class="px" style="padding:34px 48px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#1a2332;background-image:linear-gradient(180deg,#1a2332 0%,#141b27 100%);border:1px solid #28323f;border-radius:16px;">
                <tr><td style="height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,rgba(79,147,221,0.6) 50%,rgba(79,147,221,0) 100%);">&nbsp;</td></tr>
                <tr>
                  <td class="card-pad" style="padding:30px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <!-- bolt seal -->
                        <td class="stack" width="78" valign="middle" style="vertical-align:middle;padding-right:20px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                            <td align="center" valign="middle" width="64" height="64" style="width:64px;height:64px;background:#1a2332;background-image:linear-gradient(180deg,#28323f 0%,#141b27 100%);border:1px solid #28323f;border-radius:50%;text-align:center;vertical-align:middle;">
                              <span style="font-size:26px;color:#9cc4f2;line-height:64px;">&#9889;</span>
                            </td>
                          </tr></table>
                        </td>
                        <!-- copy -->
                        <td class="stack stack-pl" valign="middle" style="vertical-align:middle;">
                          <span class="sans" style="font-size:9.5px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#aebccd;">EL REGALO PERFECTO</span>
                          <p class="serif" style="margin:7px 0 8px;font-size:22px;font-weight:600;color:#eef3fa;line-height:1.2;">Canci&oacute;n + video con tus fotos</p>
                          <p class="sans" style="margin:0;font-size:13px;font-weight:300;color:#aebccd;line-height:1.6;letter-spacing:.3px;">
                            Su historia hecha canci&oacute;n, con tus fotos en video. Entrega instant&aacute;nea &mdash; hazla ahora mismo.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,rgba(79,147,221,0.6) 50%,rgba(79,147,221,0) 100%);">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <!-- divider -->
          <tr>
            <td align="center" class="px" style="padding:36px 56px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:100px;height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,rgba(79,147,221,0) 0%,#1d4f88 100%);">&nbsp;</td>
                  <td style="padding:0 12px;font-size:9px;color:#2f6fb5;line-height:1;">&#9834;</td>
                  <td style="width:100px;height:1px;line-height:1px;font-size:0;background-image:linear-gradient(90deg,#1d4f88 0%,rgba(79,147,221,0) 100%);">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ====== FOOTER ====== -->
          <tr>
            <td align="center" class="px" style="padding:30px 56px 0;">
              <div style="height:1px;line-height:1px;font-size:0;background:#28323f;">&nbsp;</div>
            </td>
          </tr>
          ${footerBlock(unsubUrl)}`;
}

// ===========================================================================
// EMAIL CONFIG — emailNumber -> everything that varies per send.
// ===========================================================================

type EmailKey = 'launch' | 'weekend' | 'tomorrow' | 'sameday';

interface EmailConfig {
  key: EmailKey;
  subject: string;
  emailType: string;
  utmContent: string;
  // Optional coupon code appended to the CTA URL (?coupon=...). The frontend
  // captures it on landing and auto-applies it at checkout. Only the two
  // urgency emails (tomorrow / sameday) carry the time-boxed PAPA10 10%-off.
  coupon?: string;
  template: (ctaUrl: string, unsubUrl: string) => string;
}

const EMAILS: Record<number, EmailConfig> = {
  1: {
    key: 'launch',
    subject: 'Faltan 5 días para el Día del Padre',
    emailType: 'fathers_day_1_launch',
    utmContent: 'launch',
    template: templateLaunch,
  },
  3: {
    key: 'weekend',
    subject: 'Este fin de semana es el momento — Día del Padre',
    emailType: 'fathers_day_3_weekend',
    utmContent: 'weekend',
    template: templateWeekend,
  },
  4: {
    key: 'tomorrow',
    subject: 'Mañana es el Día del Padre — 10% de descuento hoy y mañana',
    emailType: 'fathers_day_4_tomorrow',
    utmContent: 'tomorrow',
    coupon: 'PAPA10',
    template: templateTomorrow,
  },
  5: {
    key: 'sameday',
    subject: 'Hoy es el Día del Padre — 10% de descuento solo hoy',
    emailType: 'fathers_day_5_sameday',
    utmContent: 'sameday',
    coupon: 'PAPA10',
    template: templateSameday,
  },
};

function ctaUrlFor(utmContent: string, coupon?: string): string {
  const base = `${SITE_URL}?utm_source=email&utm_medium=campaign&utm_campaign=fathers_day_2026&utm_content=${utmContent}`;
  return coupon ? `${base}&coupon=${encodeURIComponent(coupon)}` : base;
}

// ===========================================================================
// AUDIENCE
// ===========================================================================

// Pull every target email from the v_fathers_day_audience view. The view
// already excludes unsubscribers + recent Father's Day buyers. We paginate so
// a large audience never overruns the edge runtime (see songs-table-scale rule).
async function fetchAudience(supabase: any): Promise<string[]> {
  const BATCH = 1000;
  const emails: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('v_fathers_day_audience')
      .select('email')
      .range(offset, offset + BATCH - 1);

    if (error) throw new Error(`audience query failed: ${error.message}`);

    const rows = data ?? [];
    for (const r of rows) {
      const e = canonicalEmail(r.email);
      if (e) emails.push(e);
    }

    if (rows.length < BATCH) break;
    offset += BATCH;
  }

  // De-dupe in case the view returns the same address more than once.
  return Array.from(new Set(emails));
}

// Build the set of emails already sent THIS specific email_type (status=sent),
// so re-runs are safe and resumable. Paginates to cover large send histories.
async function fetchAlreadySent(supabase: any, emailType: string): Promise<Set<string>> {
  const BATCH = 1000;
  const sent = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('email_logs')
      .select('email')
      .eq('email_type', emailType)
      .eq('status', 'sent')
      .range(offset, offset + BATCH - 1);

    if (error) throw new Error(`email_logs query failed: ${error.message}`);

    const rows = data ?? [];
    for (const r of rows) {
      const e = canonicalEmail(r.email);
      if (e) sent.add(e);
    }

    if (rows.length < BATCH) break;
    offset += BATCH;
  }

  return sent;
}

// ===========================================================================
// SENDING
// ===========================================================================

async function buildHtmlFor(cfg: EmailConfig, email: string): Promise<string> {
  const token = await signUnsubscribeToken(email);
  const unsubUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?email=${encodeURIComponent(
    canonicalEmail(email),
  )}&token=${token}`;
  return cfg.template(ctaUrlFor(cfg.utmContent, cfg.coupon), unsubUrl);
}

async function sendOne(cfg: EmailConfig, email: string): Promise<void> {
  const unsubHeaders = await buildUnsubscribeHeaders(email);
  const html = await buildHtmlFor(cfg, email);

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject: cfg.subject,
      content: [{ type: 'text/html', value: html }],
      categories: ['fathers_day_2026', cfg.emailType, 'rqc'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false },
      },
      headers: { ...unsubHeaders },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SendGrid ${response.status}: ${text}`);
  }
}

async function logSend(
  supabase: any,
  email: string,
  cfg: EmailConfig,
  status: 'sent' | 'failed',
  errorMessage?: string,
): Promise<void> {
  await supabase.from('email_logs').insert({
    email,
    email_type: cfg.emailType,
    subject: cfg.subject,
    status,
    recipient_name: 'campaign',
    song_ids: [],
    ...(errorMessage ? { error_message: errorMessage } : {}),
  });
}

// ===========================================================================
// HANDLER
// ===========================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- Auth guard: verify_jwt is false at the gateway, so authenticate here. ---
    // Two accepted credentials:
    //   1. x-campaign-secret == CAMPAIGN_TRIGGER_SECRET  (operator / manual triggers)
    //   2. Authorization: Bearer <SUPABASE_ANON_KEY>     (pg_cron jobs — the anon
    //      key is public, so it is safe to embed in cron.job, mirroring the
    //      Mother's Day campaign cron pattern)
    const presentedSecret = req.headers.get('x-campaign-secret') || '';
    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const secretOk = !!CAMPAIGN_TRIGGER_SECRET && presentedSecret === CAMPAIGN_TRIGGER_SECRET;
    const anonOk = !!ANON_KEY && bearer === ANON_KEY;
    if (!secretOk && !anonOk) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: { emailNumber?: number; dryRun?: boolean; testEmail?: string } = {};
    try {
      body = await req.json();
    } catch {
      /* tolerate empty/malformed body — validated below */
    }

    const cfg = EMAILS[body.emailNumber as number];
    if (!cfg) {
      return new Response(
        JSON.stringify({ error: 'emailNumber must be one of 1, 3, 4, 5' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- Test mode: send a single sample, no audience query, no logging. ---
    if (body.testEmail) {
      const testEmail = canonicalEmail(body.testEmail);
      await sendOne(cfg, testEmail);
      return new Response(
        JSON.stringify({
          test: true,
          emailNumber: body.emailNumber,
          subject: cfg.subject,
          sentTo: testEmail,
        }, null, 2),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // --- Resolve who we'd send to: audience minus already-sent. ---
    const audience = await fetchAudience(supabase);
    const alreadySent = await fetchAlreadySent(supabase, cfg.emailType);
    const toSend = audience.filter((e) => !alreadySent.has(e));

    // --- Dry run: report, send nothing. ---
    if (body.dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          emailNumber: body.emailNumber,
          subject: cfg.subject,
          audienceSize: audience.length,
          alreadySent: alreadySent.size,
          wouldSend: toSend.length,
        }, null, 2),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // --- Real send. ---
    let sentNow = 0;
    let failed = 0;
    const errors: string[] = [];
    let i = 0;

    for (const email of toSend) {
      try {
        await sendOne(cfg, email);
        sentNow++;
        await logSend(supabase, email, cfg, 'sent');
      } catch (err) {
        failed++;
        const msg = (err as Error).message || String(err);
        if (errors.length < 10) errors.push(`${email}: ${msg}`);
        console.error(`[send-fathers-day-campaign] send failed for ${email}:`, msg);
        await logSend(supabase, email, cfg, 'failed', msg);
      }

      // Rate limit: pause 1s every 50 sends.
      i++;
      if (i % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        emailNumber: body.emailNumber,
        subject: cfg.subject,
        audienceSize: audience.length,
        alreadySentBefore: alreadySent.size,
        sentNow,
        failed,
        errors,
      }, null, 2),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error)?.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
