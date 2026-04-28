// Email validation with typo detection.
// Real bounces from production seen on @iclod.com, @yahoo.comRumaga48, @3gmail.com, etc.

const COMMON_DOMAIN_TYPOS = {
  // iCloud
  'iclod.com': 'icloud.com',
  'iclud.com': 'icloud.com',
  'icoud.com': 'icloud.com',
  'iclou.com': 'icloud.com',
  'icoul.com': 'icloud.com',
  'icluod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
  'icloud.cm': 'icloud.com',
  'icloud.con': 'icloud.com',
  'icloud.om': 'icloud.com',
  // Gmail
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmali.com': 'gmail.com',
  'gemail.com': 'gmail.com',
  '3gmail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.om': 'gmail.com',
  // Yahoo
  'yhoo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yhaoo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahoo.cm': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'yahoo.om': 'yahoo.com',
  // Hotmail
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmaill.com': 'hotmail.com',
  'hotmali.com': 'hotmail.com',
  'hotnail.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.cm': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmail.om': 'hotmail.com',
  // Outlook
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'outloook.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'outlook.cm': 'outlook.com',
  'outlook.con': 'outlook.com',
  // Live
  'live.co': 'live.com',
  'live.cm': 'live.com',
  'live.con': 'live.com',
  // AOL
  'aol.co': 'aol.com',
  'aol.cm': 'aol.com',
  'aol.con': 'aol.com',
};

const KNOWN_DOMAINS = [
  'gmail.com', 'icloud.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'live.com', 'me.com', 'aol.com', 'msn.com',
  'yahoo.com.mx', 'hotmail.es', 'yahoo.es', 'live.com.mx',
];

/**
 * Validates an email address and detects common domain typos.
 * @param {string} value - the raw email input
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkEmail(value) {
  const trimmed = (value || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, message: 'Por favor ingresa un email válido' };
  }

  const domain = trimmed.split('@')[1].toLowerCase();

  // Catch garbage characters appended to a real domain (e.g. "yahoo.comRumaga48")
  // but allow legitimate ccTLD continuations like "yahoo.com.mx" — those have a
  // dot immediately after the known domain. Anything else is junk.
  for (const knownDomain of KNOWN_DOMAINS) {
    if (domain.startsWith(knownDomain) && domain !== knownDomain) {
      const nextChar = domain[knownDomain.length];
      if (nextChar !== '.') {
        return {
          ok: false,
          message: `Tu correo tiene caracteres extra al final. ¿Quisiste decir @${knownDomain}?`,
        };
      }
    }
  }

  if (COMMON_DOMAIN_TYPOS[domain]) {
    return {
      ok: false,
      message: `¿Quisiste decir @${COMMON_DOMAIN_TYPOS[domain]}? Por favor corrige tu email.`,
    };
  }

  return { ok: true };
}
