// supabase/functions/_shared/is-paid.ts
//
// THE definition of "this order is paid". One copy, imported everywhere.
//
// WHY THIS FILE EXISTS
// This predicate was copy-pasted into six edge functions (send-song-ready-sms,
// send-song-ready-whatsapp, auto-send-paid-email, notify-new-sales,
// notify-upsell-ready, cs-copilot) plus the cs_customer_lookup view. Five of the
// copies were even called `isStripeConfirmed`, which quietly encoded the wrong
// assumption: that Stripe is the only way we get paid.
//
// It isn't. The admin dashboard has a manual mark-paid (admin-songs 'mark-paid')
// used for Zelle and cash. It sets paid / payment_status / paid_at /
// payment_method and stamps marked_paid_at, but DELIBERATELY leaves amount_paid
// NULL so manual payments don't inflate revenue reports — and of course there is
// no stripe_payment_id. So the old third clause
//
//     amount_paid > 0 OR stripe_payment_id IS NOT NULL
//
// could never be true for a manual payment. Every Zelle customer read as UNPAID:
// the CS bot told them they hadn't paid and withheld their download link, and
// none of the automated deliveries ever fired for them (verified 2026-08-05 —
// 10 orders back to 2026-06-24, all with whatsapp_sent_at / link_email_sent_at
// NULL; the owner had been delivering each one by hand).
//
// WHAT THE THIRD CLAUSE IS ACTUALLY FOR
// It excludes rows that look paid but have no evidence behind them: abandoned
// checkouts and $0 free orders. A `marked_paid_at` is written only by the
// authenticated-admin mark-paid action — a human explicitly asserting the money
// arrived — which is at least as strong as an amount. So it belongs in the same
// clause, and the guard still rejects what it was written to reject.
//
// Keep this in sync with public.cs_customer_lookup.is_paid (migration
// 20260805210000_cs_lookup_honours_manual_zelle_paid.sql).

export interface PaidFields {
  paid?: unknown;
  payment_status?: unknown;
  paid_at?: unknown;
  amount_paid?: unknown;
  stripe_payment_id?: unknown;
  marked_paid_at?: unknown;
}

/**
 * Is this order really paid — by Stripe OR by a manual Zelle/cash mark?
 *
 * Requires all three:
 *   1. paid_at is set                      (not an abandoned checkout)
 *   2. paid = true or payment_status='paid'
 *   3. real evidence: money, a Stripe payment id, or an admin's manual mark
 */
export function isPaidSong(s: PaidFields | null | undefined): boolean {
  if (!s) return false;
  if (!s.paid_at) return false;
  if (s.paid !== true && s.payment_status !== 'paid') return false;
  const amt = s.amount_paid != null ? parseFloat(String(s.amount_paid)) : 0;
  return amt > 0 || !!s.stripe_payment_id || !!s.marked_paid_at;
}

/** Was this order paid outside Stripe (Zelle/cash), i.e. no automatic webhook? */
export function isManuallyMarkedPaid(s: PaidFields | null | undefined): boolean {
  return !!s?.marked_paid_at;
}

/**
 * Columns every caller must SELECT for isPaidSong() to evaluate correctly.
 * Forgetting `marked_paid_at` silently reintroduces the Zelle bug, so select
 * this constant rather than hand-listing the fields.
 */
export const PAID_FIELDS = 'paid, payment_status, paid_at, amount_paid, stripe_payment_id, marked_paid_at';
