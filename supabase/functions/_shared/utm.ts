// supabase/functions/_shared/utm.ts
//
// Tag marketing-email CTA links with UTM params so purchases can be attributed
// back to the exact email that drove them. The site already captures utm_* on
// landing (src/services/tracking.js, 30-day localStorage) and persists them onto
// songs.utm_campaign at checkout — this just stamps the outbound links.
//
// We rewrite ONLY links that point to our own sites, and NEVER the per-recipient
// {{UNSUB_URL}} placeholder or non-site links (mailto:, tel:, images, etc.).

const SITE_HOSTS = ['regalosquecantan.com', 'giftsthatsing.com'];

function isSiteHost(host: string): boolean {
  const h = host.toLowerCase();
  return SITE_HOSTS.some((s) => h === s || h.endsWith('.' + s));
}

/**
 * Append utm_source=email&utm_medium=marketing&utm_campaign=<campaignKey> to
 * every href on this email that points to our sites. Idempotent (skips links
 * already carrying a utm_campaign), fragment-safe, and query-string preserving.
 */
export function addUtm(html: string, campaignKey: string): string {
  if (!html || !campaignKey) return html;
  const params = `utm_source=email&utm_medium=marketing&utm_campaign=${encodeURIComponent(campaignKey)}`;

  return html.replace(/href=("|')(.*?)\1/gi, (match, quote, url) => {
    if (!url || url.includes('{{UNSUB_URL}}')) return match;      // never tag the unsubscribe link
    if (/utm_campaign=/i.test(url)) return match;                 // already tagged
    let host: string;
    try { host = new URL(url).hostname; } catch { return match; } // not an absolute URL — skip
    if (!isSiteHost(host)) return match;                          // external link — skip

    // Split off any #fragment so utm params land in the query string, not the hash.
    const hashIdx = url.indexOf('#');
    const base = hashIdx === -1 ? url : url.slice(0, hashIdx);
    const frag = hashIdx === -1 ? '' : url.slice(hashIdx);
    const sep = base.includes('?') ? '&' : '?';
    return `href=${quote}${base}${sep}${params}${frag}${quote}`;
  });
}
