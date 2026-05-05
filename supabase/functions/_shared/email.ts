// supabase/functions/_shared/email.ts
//
// Shared deliverability helpers for every customer-facing email.
//
// Inboxes (Gmail, Yahoo, Outlook) heavily favor multipart/alternative emails
// that include both text/plain AND text/html, plus a hidden preheader. These
// helpers add both with no per-template work needed.
//
// Usage:
//   import { htmlToPlaintext, injectPreheader } from '../_shared/email.ts';
//
//   const finalHtml = injectPreheader(rawHtml, 'Optional preheader text');
//   const finalText = htmlToPlaintext(finalHtml);
//   sendgridContent: [
//     { type: 'text/plain', value: finalText },
//     { type: 'text/html', value: finalHtml },
//   ]
//
// Note RFC 2046: text/plain MUST come BEFORE text/html in the content array.

const ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&middot;': '·',
  '&iexcl;': '¡',
  '&iquest;': '¿',
  '&copy;': '©',
  '&aacute;': 'á',
  '&eacute;': 'é',
  '&iacute;': 'í',
  '&oacute;': 'ó',
  '&uacute;': 'ú',
  '&ntilde;': 'ñ',
  '&Aacute;': 'Á',
  '&Eacute;': 'É',
  '&Iacute;': 'Í',
  '&Oacute;': 'Ó',
  '&Uacute;': 'Ú',
  '&Ntilde;': 'Ñ',
};

/**
 * Strip HTML tags + decode common entities into a readable plaintext string.
 * Quality is "good enough" for deliverability — what matters most is that a
 * text/plain part exists at all. Inboxes don't grade plaintext content quality
 * the way they grade HTML.
 */
export function htmlToPlaintext(html: string): string {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Hidden preheader divs shouldn't appear in plaintext (they're a hack).
    .replace(/<div[^>]*display:\s*none;[\s\S]*?<\/div>/gi, '')
    .replace(/<\/(p|div|tr|td|h[1-6]|li)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  for (const [entity, replacement] of Object.entries(ENTITY_MAP)) {
    text = text.replaceAll(entity, replacement);
  }

  text = text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/**
 * Insert a hidden preheader div as the first child of <body>. This is the
 * gray text Gmail / Outlook show in the inbox preview right after the subject
 * line. It won't render in the email body itself.
 *
 * No-ops if the HTML already contains a preheader-shaped div.
 */
export function injectPreheader(html: string, preheader: string): string {
  if (!preheader) return html;
  if (/display:\s*none;[^"]*max-height:\s*0/i.test(html)) return html;

  const safe = preheader
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const preheaderDiv =
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#1a0e08;">${safe}</div>`;

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${preheaderDiv}`);
  }
  // No body tag — prepend.
  return preheaderDiv + html;
}

/**
 * CAN-SPAM requires a physical mailing address in every commercial email.
 * Without it, Gmail/Yahoo spam filters score the message negatively.
 * This is injected automatically by buildEmailParts into every email that
 * goes through the shared helper — no per-template work needed.
 */
const CAN_SPAM_ADDRESS_HTML = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;">
  <tr><td align="center" style="padding:0 0 16px;">
    <p style="color:#888888;font-size:11px;margin:0;line-height:1.5;font-family:'Helvetica Neue',Arial,sans-serif;">
      Regalos Que Cantan &bull; San Antonio, TX 78201, USA<br>
      <a href="mailto:hola@regalosquecantan.com" style="color:#888888;text-decoration:underline;">hola@regalosquecantan.com</a>
    </p>
  </td></tr>
</table>`;

function injectCanSpamAddress(html: string): string {
  // Skip if address already present (e.g. recover-song builds its own footer).
  if (html.includes('San Antonio') || html.includes('CAN-SPAM') || html.includes('can-spam')) return html;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${CAN_SPAM_ADDRESS_HTML}</body>`);
  }
  return html + CAN_SPAM_ADDRESS_HTML;
}

/**
 * One-shot helper: returns both pieces ready to drop into a SendGrid content[]
 * array.  Pass the result as:
 *   content: [
 *     { type: 'text/plain', value: parts.text },
 *     { type: 'text/html',  value: parts.html },
 *   ]
 */
export function buildEmailParts(html: string, preheader: string = ''): { html: string; text: string } {
  const withAddress = injectCanSpamAddress(html);
  const finalHtml = injectPreheader(withAddress, preheader);
  const finalText = htmlToPlaintext(finalHtml);
  return { html: finalHtml, text: finalText };
}
