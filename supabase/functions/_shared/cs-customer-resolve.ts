// supabase/functions/_shared/cs-customer-resolve.ts
//
// THE single way the customer-service agent finds out who it is talking to.
//
// WHY THIS FILE EXISTS
// Before this, cs-agent had TWO independent lookups that disagreed with each
// other. The "situation snapshot" queried `songs` directly and could match on
// email; the `look_up_my_order` tool queried the `cs_customer_lookup` view,
// which had no email column and could only match on phone. So the model was
// routinely handed "customer IDENTIFIED, here is their paid link" by one path
// and "orders: []" by the other, in the same turn. It hedged, and wrote
// "I couldn't find your order" to customers whose order was sitting right there.
// Measured: 88 not-found drafts in 45 days, 57 of them (65%) wrong.
//
// Both callers now go through resolveCustomerOrders(). One query set, one answer,
// no contradiction possible.
//
// SAFETY — read this before widening the match rules:
//   • Everything reads the cs_customer_lookup VIEW, never `songs`. The view
//     exposes only fields a customer may see about their own order.
//   • A DOWNLOAD link is only ever built for a PAID order (buildOrderLink is
//     only called behind an is_paid check by callers; see assertions below).
//   • A recipient-NAME match is deliberately treated as LOW CONFIDENCE and
//     flagged `needsConfirmation`. Names are not unique — "María" resolves to
//     hundreds of orders — so a name-only match must never auto-hand out a link
//     to somebody else's song. Callers must ask the customer to confirm first.

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface CsOrder {
  id: string;
  phone_last10: string | null;
  recipient_name: string | null;
  sender_name: string | null;
  occasion: string | null;
  genre: string | null;
  short_code: string | null;
  song_status: string | null;
  song_ready: boolean;
  has_video_addon: boolean | null;
  karaoke_video_status: string | null;
  karaoke_status: string | null;
  created_at: string;
  paid_at: string | null;
  is_paid: boolean;
  email: string | null;
}

export type MatchKind = 'phone' | 'email' | 'email_local' | 'recipient_name';

export interface ResolvedCustomer {
  orders: CsOrder[];
  /** Which strategies actually produced rows, strongest first. */
  matchedBy: MatchKind[];
  /**
   * True when the ONLY thing that matched was a recipient name. The caller must
   * confirm identity with the customer before sharing any link.
   */
  needsConfirmation: boolean;
}

const VIEW_COLS =
  'id, phone_last10, recipient_name, sender_name, occasion, genre, short_code, ' +
  'song_status, song_ready, has_video_addon, karaoke_video_status, karaoke_status, ' +
  'created_at, paid_at, is_paid, email';

/** Cap per strategy — a customer with more orders than this is vanishingly rare. */
const PER_QUERY_LIMIT = 8;
/** Hard cap on a name-only match, which can legitimately hit many strangers. */
const NAME_MATCH_LIMIT = 4;

/** Pull email addresses out of free text the CUSTOMER wrote. */
export function extractEmails(texts: string[]): string[] {
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const found = new Set<string>();
  for (const t of texts) {
    const matches = String(t || '').match(re);
    if (matches) for (const m of matches) found.add(m.toLowerCase().trim());
  }
  return [...found];
}

/** Last 10 digits of a phone, the form cs_customer_lookup indexes on. */
export function phoneLast10(raw: unknown): string {
  return String(raw || '').replace(/\D/g, '').slice(-10);
}

/**
 * Is this order paid? The view already computes it consistently with the rest of
 * the codebase (paid_at set AND paid/payment_status AND a real amount or a
 * Stripe id). Kept as a helper so callers never re-derive it and drift.
 */
export function isPaid(o: Pick<CsOrder, 'is_paid'>): boolean {
  return o.is_paid === true;
}

/**
 * The customer-facing link for ONE order.
 *
 * CALLER CONTRACT: only ever call this for a PAID order when the result will be
 * shown as a download. For unpaid orders use buildPreviewLink(), which points at
 * /listen where playback works but download stays locked.
 */
export function buildOrderLink(o: Partial<CsOrder>, site: string): string {
  const isUpsell =
    o.has_video_addon === true ||
    o.karaoke_video_status != null ||
    o.karaoke_status != null;
  if (isUpsell) return `${site}/success?song_id=${o.id}`;
  if (o.short_code) return `${site}/s/${o.short_code}`;
  return `${site}/success?song_id=${o.id}`;
}

/** One /listen link covering every unpaid song — hear it, download stays locked. */
export function buildPreviewLink(unpaid: CsOrder[], site: string): string | null {
  if (!unpaid.length) return null;
  return `${site}/listen?song_ids=${unpaid.map((o) => o.id).join(',')}`;
}

async function queryView(
  admin: Admin,
  apply: (q: unknown) => unknown,
  limit = PER_QUERY_LIMIT,
): Promise<CsOrder[]> {
  try {
    // deno-lint-ignore no-explicit-any
    let q: any = admin.from('cs_customer_lookup').select(VIEW_COLS);
    q = apply(q);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) {
      console.warn('cs-customer-resolve: query failed', error.message);
      return [];
    }
    return (data || []) as CsOrder[];
  } catch (e) {
    console.warn('cs-customer-resolve: query threw', e);
    return [];
  }
}

/**
 * Find every order belonging to the person in this conversation.
 *
 * Strategies run strongest-first and STOP EARLY: if the phone resolves them, we
 * never fall back to a fuzzy name match. Each strategy that contributes rows is
 * reported in `matchedBy` so the caller can explain itself to the model.
 */
export async function resolveCustomerOrders(
  admin: Admin,
  opts: {
    phoneLast10?: string;
    emails?: string[];
    /** Names the customer offered for "who is the song for" — LAST resort. */
    recipientNames?: string[];
  },
): Promise<ResolvedCustomer> {
  const byId = new Map<string, CsOrder>();
  const matchedBy: MatchKind[] = [];

  const absorb = (rows: CsOrder[], kind: MatchKind): number => {
    let added = 0;
    for (const r of rows) {
      if (!byId.has(String(r.id))) {
        byId.set(String(r.id), r);
        added++;
      }
    }
    if (added > 0 && !matchedBy.includes(kind)) matchedBy.push(kind);
    return added;
  };

  // 1. PHONE — strongest signal: they are messaging us from it.
  const last10 = (opts.phoneLast10 || '').replace(/\D/g, '').slice(-10);
  if (last10.length === 10) {
    absorb(await queryView(admin, (q) => (q as any).eq('phone_last10', last10)), 'phone');
  }

  // 2. EMAIL — exact match on anything the customer typed in the thread.
  const emails = (opts.emails || []).map((e) => e.toLowerCase().trim()).filter(Boolean).slice(0, 3);
  if (emails.length) {
    absorb(await queryView(admin, (q) => (q as any).in('email', emails)), 'email');

    // 2b. EMAIL LOCAL-PART — domain-typo tolerance ("glail.com" → "gmail.com").
    // Only worth trying when the exact match found nothing for that address.
    const locals = emails
      .map((e) => e.split('@')[0].replace(/[%,()*]/g, ''))
      .filter((l) => l.length >= 4);
    if (locals.length && !matchedBy.includes('email')) {
      absorb(await queryView(admin, (q) => (q as any).in('email_local', locals)), 'email_local');
    }
  }

  // 3. RECIPIENT NAME — last resort, and ONLY when nothing else matched at all.
  // Deliberately narrow: this can hit strangers with the same name.
  let nameOnly = false;
  if (!byId.size) {
    const names = (opts.recipientNames || [])
      .map((n) => n.toLowerCase().trim())
      .filter((n) => n.length >= 3)
      .slice(0, 3);
    if (names.length) {
      const added = absorb(
        await queryView(admin, (q) => (q as any).in('recipient_name_lc', names), NAME_MATCH_LIMIT),
        'recipient_name',
      );
      nameOnly = added > 0;
    }
  }

  const orders = [...byId.values()].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );

  return { orders, matchedBy, needsConfirmation: nameOnly };
}

// ── Beyond the song: what else is in flight for this customer ───────────────
// The snapshot used to see ONLY songs, so any thread about a photo video, an
// Animado story video, or a pending correction was answered blind. Several
// discarded drafts in the audit were the bot confidently answering the wrong
// question because it could not see a video order mid-flight.

export interface OrderExtras {
  /** Photo/lyric video add-ons, by song id. */
  videos: { song_id: string; status: string | null; paid: boolean; photo_count: number | null; video_url: string | null }[];
  /** Animado story videos, by song id. */
  storyVideos: { song_id: string; state: string | null; video_url: string | null }[];
  /** Open correction requests, by song id. */
  fixes: { song_id: string; status: string | null; customer_request: string | null; created_at: string }[];
}

export async function fetchOrderExtras(admin: Admin, songIds: string[]): Promise<OrderExtras> {
  const empty: OrderExtras = { videos: [], storyVideos: [], fixes: [] };
  const ids = songIds.filter(Boolean).slice(0, 8);
  if (!ids.length) return empty;

  const [v, sv, fx] = await Promise.all([
    admin.from('video_orders')
      .select('song_id, status, paid, photo_count, video_url')
      .in('song_id', ids).order('created_at', { ascending: false }).limit(8)
      .then((r: { data: unknown }) => r.data || []).catch(() => []),
    admin.from('story_video_orders')
      .select('song_id, state, video_url')
      .in('song_id', ids).order('created_at', { ascending: false }).limit(8)
      .then((r: { data: unknown }) => r.data || []).catch(() => []),
    // Explicit allowlist of OPEN states, not a denylist — 'rejected' must not
    // read as "the team has it", or the bot promises a fix that was declined.
    admin.from('song_fix_requests')
      .select('song_id, status, customer_request, created_at')
      .in('song_id', ids).in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false }).limit(8)
      .then((r: { data: unknown }) => r.data || []).catch(() => []),
  ]);

  return {
    videos: v as OrderExtras['videos'],
    storyVideos: sv as OrderExtras['storyVideos'],
    fixes: fx as OrderExtras['fixes'],
  };
}
