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
 * One-shot helper: returns both pieces ready to drop into a SendGrid content[]
 * array.  Pass the result as:
 *   content: [
 *     { type: 'text/plain', value: parts.text },
 *     { type: 'text/html',  value: parts.html },
 *   ]
 */
export function buildEmailParts(html: string, preheader: string = ''): { html: string; text: string } {
  const finalHtml = injectPreheader(html, preheader);
  const finalText = htmlToPlaintext(finalHtml);
  return { html: finalHtml, text: finalText };
}
