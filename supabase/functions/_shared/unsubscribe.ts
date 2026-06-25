// supabase/functions/_shared/unsubscribe.ts
//
// Email-suppression helpers shared across every email-sending edge function.
//
// Three responsibilities:
//   1. signUnsubscribeToken(email)    — produces an HMAC token bound to the
//      lowercased email. The token-in-URL pattern means we can verify
//      unsubscribe requests without a DB lookup and without per-email
//      database state, and an attacker who doesn't have the secret cannot
//      unsubscribe arbitrary addresses.
//   2. buildUnsubscribeHeaders(email) — returns the List-Unsubscribe +
//      List-Unsubscribe-Post headers ready to spread into a SendGrid call.
//      HTTPS one-click link comes first, mailto: comes second as fallback
//      (RFC 2369 allows multiple).
//   3. isMarketingSuppressed(supabase, email) — checks email_unsubscribes.
//      MUST be called by marketing/drip senders before each fetch. Should
//      NOT be called by transactional senders (purchase confirmation,
//      song/video delivery, self-service recovery, affiliate credentials).
//
// Required env var:
//   UNSUBSCRIBE_SECRET — random 32+ byte secret. Set this once with:
//     supabase secrets set UNSUBSCRIBE_SECRET=$(openssl rand -hex 32) \
//       --project-ref yzbvajungshqcpusfiia
//
// If UNSUBSCRIBE_SECRET is missing at runtime, header generation falls back
// to the legacy mailto:-only form so emails still send. Console error is
// logged. The unsubscribe edge function refuses to verify if the secret is
// missing — it never auto-trusts.

const UNSUBSCRIBE_SECRET = Deno.env.get('UNSUBSCRIBE_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const MAILTO_FALLBACK = 'mailto:hola@regalosquecantan.com?subject=unsubscribe';

// Encode bytes as URL-safe base64 (no padding) — RFC 4648 §5.
function base64UrlEncode(bytes: Uint8Array): string {
  // btoa on Deno only handles binary strings; build that first.
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time string comparison. Defeats timing side-channels in token
 *  verification. Both strings must be ASCII. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}

/** Canonical lowercased + trimmed form. Token + table key both use this. */
export function canonicalEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

/**
 * Sign an unsubscribe token for `email`. Deterministic per email — the same
 * token is valid forever (so old emails keep working) but only emails the
 * secret has signed can pass verification. If the secret is rotated, all
 * outstanding tokens become invalid (the function returns 400, then user
 * either reclicks from a newer email or contacts support).
 */
export async function signUnsubscribeToken(email: string): Promise<string> {
  if (!UNSUBSCRIBE_SECRET) return '';
  const sig = await hmacSha256(UNSUBSCRIBE_SECRET, canonicalEmail(email));
  return base64UrlEncode(sig);
}

/** Verify a token presented by an inbox/user against the lowercased email. */
export async function verifyUnsubscribeToken(email: string, token: string): Promise<boolean> {
  if (!UNSUBSCRIBE_SECRET || !email || !token) return false;
  const expected = await signUnsubscribeToken(email);
  if (!expected) return false;
  return timingSafeEqual(expected, token);
}

/**
 * Headers ready to spread into SendGrid's `headers` field for any email.
 * HTTPS one-click goes first (preferred by Gmail/Yahoo bulk-sender rules),
 * mailto: stays as a secondary fallback for older clients.
 *
 * When UNSUBSCRIBE_SECRET is not set, falls back to the legacy mailto-only
 * form so deploys never break. Logs once per missing-secret call so the
 * outage is visible in logs.
 */
export async function buildUnsubscribeHeaders(email: string): Promise<Record<string, string>> {
  const canon = canonicalEmail(email);
  if (!UNSUBSCRIBE_SECRET || !SUPABASE_URL || !canon) {
    if (!UNSUBSCRIBE_SECRET) {
      console.warn('[unsubscribe] UNSUBSCRIBE_SECRET not set — falling back to mailto-only List-Unsubscribe');
    }
    return {
      'List-Unsubscribe': `<${MAILTO_FALLBACK}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  const token = await signUnsubscribeToken(canon);
  const link = `${SUPABASE_URL}/functions/v1/unsubscribe?email=${encodeURIComponent(canon)}&token=${token}`;
  return {
    'List-Unsubscribe': `<${link}>, <${MAILTO_FALLBACK}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * The visible one-click unsubscribe URL for `email` (same link used inside the
 * List-Unsubscribe header). Drop into an email body's "unsubscribe" anchor.
 * Falls back to the mailto: form when the secret/url is unavailable.
 */
export async function buildUnsubscribeUrl(email: string): Promise<string> {
  const canon = canonicalEmail(email);
  if (!UNSUBSCRIBE_SECRET || !SUPABASE_URL || !canon) return MAILTO_FALLBACK;
  const token = await signUnsubscribeToken(canon);
  return `${SUPABASE_URL}/functions/v1/unsubscribe?email=${encodeURIComponent(canon)}&token=${token}`;
}

/**
 * Returns true if `email` is on the suppression list and should NOT receive
 * marketing/drip emails. Caller passes a service-role Supabase client so
 * this hits the table directly (RLS-protected — anon keys cannot read it).
 *
 * Designed to never throw: a DB error logs and returns false (fail-open) so
 * a Supabase outage doesn't silently block customer emails. The trade-off
 * is acceptable for marketing flows; the alternative (fail-closed) would
 * mean a brief DB hiccup halts the entire drip pipeline.
 */
export async function isMarketingSuppressed(
  supabase: any,
  email: string,
): Promise<boolean> {
  const canon = canonicalEmail(email);
  if (!canon) return false;
  try {
    const { data, error } = await supabase
      .from('email_unsubscribes')
      .select('email')
      .eq('email', canon)
      .maybeSingle();
    if (error) {
      console.error('[unsubscribe] suppression lookup failed:', error.message);
      return false; // fail-open
    }
    return !!data;
  } catch (e: any) {
    console.error('[unsubscribe] suppression lookup threw:', e?.message || e);
    return false; // fail-open
  }
}
