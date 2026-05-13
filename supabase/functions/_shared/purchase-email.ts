// supabase/functions/_shared/purchase-email.ts
//
// Shared purchase-confirmation email template, used by:
//   - stripe-webhook       (fresh purchase + already-paid recovery)
//   - verify-payment       (success-page fallback)
//   - recover-song         (admin one-touch resend + /mi-cancion self-service)
//
// Goal: one template, one look. Whichever path the customer's email came
// through, the inbox-side experience is identical so support can say
// "click the orange button" and it always works.
//
// Design choices (see audit 2026-05-13):
//   - Subject + preheader lead with "descarga"/"pagada" so it doesn't get
//     confused with the free preview email.
//   - Button label is "DESCARGAR MI CANCIÓN" — not "Escuchar y Descargar".
//   - Button URL skips the /listen preview page and lands directly on:
//       * /song/<ids>            for audio-only orders
//       * /success?song_ids=...  for orders with the video addon
//     (mirrors what recover-song already does.)
//   - No fake play button. The song card is one piece of metadata, not a
//     decoy media control.
//   - Above the footer: a "Si pierdes este correo" block pointing at
//     /mi-cancion. This is the self-service safety net.

const SITE_URL = 'https://regalosquecantan.com';

export interface PurchaseEmailEntry {
  /** Song ids in this purchase. Bundles have more than one. */
  ids: string[];
  /** Recipient name for display, e.g. "María" or "María y Carlos". */
  recipientName: string;
  senderName?: string | null;
  songTitle?: string | null;
  genre?: string | null;
  occasion?: string | null;
  hasVideoAddon?: boolean;
}

export interface PurchaseEmailOptions {
  /** Sender first name used in the greeting. */
  firstName: string;
  /** One entry per purchase. recover-song's multi-bundle case can pass more. */
  entries: PurchaseEmailEntry[];
  /** Defaults to https://regalosquecantan.com — only override for testing. */
  baseUrl?: string;
  /** UTM campaign tag. Defaults to 'purchase_confirmation'. */
  utmCampaign?: string;
}

export interface PurchaseEmailParts {
  html: string;
  subject: string;
  preheader: string;
}

function encode(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Build the canonical download URL for one purchase entry. */
export function buildPurchaseListenUrl(
  entry: PurchaseEmailEntry,
  baseUrl: string = SITE_URL,
  utmCampaign: string = 'purchase_confirmation',
): string {
  const ids = entry.ids.join(',');
  const utm = `utm_source=email&utm_medium=transactional&utm_campaign=${utmCampaign}`;
  if (entry.hasVideoAddon) {
    return `${baseUrl}/success?song_ids=${ids}&${utm}`;
  }
  return `${baseUrl}/song/${ids}?${utm}`;
}

/** Renders the song-detail card. NO fake play button — see audit #6. */
function renderSongCard(entry: PurchaseEmailEntry): string {
  const songCount = entry.ids.length;
  const recipient = encode(entry.recipientName);
  const sender = entry.senderName ? encode(entry.senderName) : null;
  const title = entry.songTitle
    ? encode(entry.songTitle)
    : `Canci&oacute;n para ${recipient}`;
  const genre = entry.genre ? encode(entry.genre) : 'Musical';
  const occasion = entry.occasion ? encode(entry.occasion) : null;
  const badgeLabel = entry.hasVideoAddon
    ? (songCount > 1 ? `&#127909; CANCI&Oacute;N + VIDEO &middot; PAQUETE ${songCount}` : '&#127909; CANCI&Oacute;N + VIDEO')
    : (songCount > 1 ? `&#127911; PAQUETE DE ${songCount} CANCIONES` : '&#127911; TU CANCI&Oacute;N PERSONALIZADA');

  return `
    <tr><td style="background-color:#1a0e08;padding:0 30px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);border:1px solid rgba(255,107,53,0.25);border-radius:16px;">
        <tr><td style="padding:22px 24px;">
          <p style="color:#ff6b35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px;">${badgeLabel}</p>
          <p style="color:#ffffff;font-size:18px;font-weight:700;margin:0 0 10px;font-family:'Righteous',cursive;">${title}</p>
          <p style="color:#a67c52;font-size:13px;margin:0;line-height:1.6;">
            Para <strong style="color:#ffd23f;">${recipient}</strong>${sender ? ` &middot; De: ${sender}` : ''}<br>
            <span style="text-transform:capitalize;">${genre}</span>${occasion ? ` &middot; <span style="text-transform:capitalize;">${occasion}</span>` : ''}${songCount > 1 ? `<br><strong style="color:#ffd23f;">${songCount} versiones en el mismo enlace</strong>` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>`;
}

/** Renders one full "purchase block" — header + button + assurance + cards. */
function renderPurchaseBlock(
  entry: PurchaseEmailEntry,
  firstName: string,
  baseUrl: string,
  utmCampaign: string,
): string {
  const recipient = encode(entry.recipientName);
  const songCount = entry.ids.length;
  const listenUrl = buildPurchaseListenUrl(entry, baseUrl, utmCampaign);
  const buttonLabel = songCount > 1
    ? `&#11015;&#65039; DESCARGAR MIS ${songCount} CANCIONES`
    : '&#11015;&#65039; DESCARGAR MI CANCI&Oacute;N';
  const summaryLabel = songCount > 1
    ? `<strong style="color:#ffd23f;">${songCount} canciones</strong> para <strong style="color:#ffd23f;">${recipient}</strong>`
    : `Canci&oacute;n para <strong style="color:#ffd23f;">${recipient}</strong>`;

  return `
    <!-- Hero -->
    <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:36px 30px 24px;text-align:center;">
      <p style="color:#22c55e;font-size:12px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 14px;">&#9989; PAGADA &middot; LISTA PARA DESCARGAR</p>
      <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:28px;margin:0 0 6px;font-weight:400;line-height:1.25;">Hola${firstName ? `, ${encode(firstName)}` : ''}.</h1>
      <p style="color:#c9b99a;font-size:15px;margin:0;line-height:1.7;">${summaryLabel}</p>
    </td></tr>

    <!-- Download CTA — the only thing the customer needs to act on -->
    <tr><td style="background-color:#1a0e08;padding:8px 30px 12px;text-align:center;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
        <tr><td align="center" style="border-radius:50px;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);box-shadow:0 4px 20px rgba(255,107,53,0.4);">
          <a href="${listenUrl}" target="_blank" style="display:inline-block;padding:20px 48px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:20px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:50px;letter-spacing:0.3px;">
            ${buttonLabel}
          </a>
        </td></tr>
      </table>
    </td></tr>

    <!-- "Link never expires" assurance — moved up so it's right under the button -->
    <tr><td style="background-color:#1a0e08;padding:0 30px 20px;text-align:center;">
      <p style="color:#ffd23f;font-size:14px;font-weight:700;margin:0 0 4px;">&#128274; Este enlace NUNCA expira</p>
      <p style="color:#a67c52;font-size:12px;margin:0;">Gu&aacute;rdalo &mdash; descarga cuando quieras desde cualquier dispositivo</p>
    </td></tr>

    ${renderSongCard(entry)}
  `;
}

/** Recovery footer — a customer-visible safety net. */
function renderRecoveryFooter(): string {
  return `
    <tr><td style="background-color:#1a0e08;padding:16px 30px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,210,63,0.08);border:1px dashed rgba(255,210,63,0.35);border-radius:14px;">
        <tr><td style="padding:18px 22px;text-align:center;">
          <p style="color:#ffd23f;font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin:0 0 8px;">&#128190; Si pierdes este correo</p>
          <p style="color:#c9b99a;font-size:13px;margin:0 0 10px;line-height:1.6;">
            Recupera tu canci&oacute;n en cualquier momento con tu email de compra:
          </p>
          <a href="https://regalosquecantan.com/mi-cancion" style="display:inline-block;color:#ff8c42;font-weight:700;font-size:14px;text-decoration:underline;">regalosquecantan.com/mi-cancion</a>
        </td></tr>
      </table>
    </td></tr>`;
}

/** Main entry point — returns html, subject, preheader ready for SendGrid. */
export function buildPurchaseEmail(opts: PurchaseEmailOptions): PurchaseEmailParts {
  const baseUrl = opts.baseUrl || SITE_URL;
  const utmCampaign = opts.utmCampaign || 'purchase_confirmation';
  const entries = opts.entries;

  // Subject + preheader. Lead with "descarga" / "pagada" so the inbox preview
  // is unmistakable from the free preview email (which uses "está lista").
  let subject: string;
  let preheader: string;

  if (entries.length === 1) {
    const e = entries[0];
    const recipient = e.recipientName;
    const songCount = e.ids.length;
    if (songCount > 1) {
      subject = `✅ Tus ${songCount} canciones para ${recipient} — descárgalas aquí`;
      preheader = `Toca el botón para descargar tus ${songCount} canciones. Este enlace nunca expira — guarda este correo.`;
    } else {
      subject = `✅ Tu canción para ${recipient} está pagada — descárgala aquí`;
      preheader = `Toca el botón para descargar tu canción para ${recipient}. Este enlace nunca expira — guarda este correo.`;
    }
  } else {
    const totalSongs = entries.reduce((n, e) => n + e.ids.length, 0);
    subject = `✅ Tus canciones de RegalosQueCantan — ${totalSongs} listas para descargar`;
    preheader = `Aquí tienes los enlaces de descarga de tus canciones. Nunca expiran.`;
  }

  const blocks = entries
    .map((entry) => renderPurchaseBlock(entry, opts.firstName, baseUrl, utmCampaign))
    .join(`
    <!-- Divider between purchase blocks (multi-bundle recovery only) -->
    <tr><td style="background-color:#1a0e08;padding:8px 30px;">
      <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,107,53,0.3),transparent);"></div>
    </td></tr>
    `);

  // Inline preheader. The shared helper in _shared/email.ts injectPreheader()
  // is idempotent — when callers run buildEmailParts() on this html, it'll
  // detect this div and skip re-injecting. For callers that DON'T run
  // buildEmailParts (recover-song), the preheader still makes it to the inbox.
  const preheaderEsc = encode(preheader);
  const preheaderDiv = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#1a0e08;">${preheaderEsc}</div>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Righteous&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
  ${preheaderDiv}
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;padding:0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;max-width:600px;">

        <!-- Top accent bar -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        ${blocks}

        ${renderRecoveryFooter()}

        <!-- Spacer -->
        <tr><td style="background-color:#1a0e08;padding:8px 30px 0;"></td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Footer: contact + share invite -->
        <tr><td style="background-color:#1a0e08;padding:24px 30px 20px;text-align:center;">
          <p style="color:#c9b99a;font-size:13px;margin:0 0 12px;">&iquest;Te gust&oacute;? Sorprende a alguien m&aacute;s en <a href="https://regalosquecantan.com" style="color:#ff6b35;font-weight:700;text-decoration:none;">regalosquecantan.com</a></p>
          <p style="color:#a67c52;font-size:12px;margin:0 0 6px;">&iquest;Preguntas? <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;text-decoration:none;">hola@regalosquecantan.com</a></p>
          <p style="color:#4a2c1a;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} Regalos Que Cantan. Hecho con &#10084;&#65039; para ti.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, subject, preheader };
}

/** Hand-crafted plaintext alternative for accessibility / dark-mode clients. */
export function buildPurchaseEmailPlaintext(opts: PurchaseEmailOptions): string {
  const baseUrl = opts.baseUrl || SITE_URL;
  const utmCampaign = opts.utmCampaign || 'purchase_confirmation';
  const greeting = opts.firstName ? `Hola, ${opts.firstName}.` : 'Hola.';
  const lines: string[] = [
    '✅ PAGADA — LISTA PARA DESCARGAR',
    '',
    greeting,
    '',
  ];

  if (opts.entries.length === 1) {
    const e = opts.entries[0];
    if (e.ids.length > 1) {
      lines.push(`Tus ${e.ids.length} canciones para ${e.recipientName} ya son tuyas.`);
    } else {
      lines.push(`Tu canción para ${e.recipientName} ya es tuya.`);
    }
    lines.push('');
    lines.push('DESCARGAR:');
    lines.push(buildPurchaseListenUrl(e, baseUrl, utmCampaign));
  } else {
    lines.push('Aquí están tus canciones:');
    lines.push('');
    for (const e of opts.entries) {
      lines.push(`• Para ${e.recipientName}${e.hasVideoAddon ? ' (canción + video)' : ''}`);
      lines.push(`  ${buildPurchaseListenUrl(e, baseUrl, utmCampaign)}`);
      lines.push('');
    }
  }

  lines.push('');
  lines.push('🔒 Este enlace NUNCA expira — guarda este correo.');
  lines.push('');
  lines.push('💾 Si pierdes este correo, recupera tu canción aquí:');
  lines.push('https://regalosquecantan.com/mi-cancion');
  lines.push('');
  lines.push('¿Preguntas? hola@regalosquecantan.com');

  return lines.join('\n');
}
