// supabase/functions/notify-new-sales/index.ts
//
// 💰 New-sale web push for the admin's phone. Runs every minute via pg_cron,
// finds songs that became Stripe-confirmed-paid since the last run, and fans
// out one push per PURCHASE (bundle rows grouped by Stripe session) through
// notify-admin-push.
//
// FULLY ISOLATED from the payment path (same doctrine as send-song-ready-sms):
// it only reads/stamps songs and posts to notify-admin-push. It never touches
// stripe-webhook or checkout, so a push failure can never affect a payment.
//
// Dedupe: sale_push_sent_at (backfilled for all historical sales at migration
// time). The stamp is written BEFORE the push is sent — at-most-once: a rare
// failure means one missed notification, never a duplicate storm.
//
// verify_jwt = false (config.toml): invoked by pg_cron, which carries no JWT.
//
// Deploy with: supabase functions deploy notify-new-sales --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Same Stripe-confirmation rule as send-song-ready-sms: requires paid_at AND
// (real money or a Stripe payment id) — excludes abandoned and $0 orders.
function isStripeConfirmed(s: Record<string, unknown>): boolean {
  if (!s.paid_at) return false;
  if (s.paid !== true && s.payment_status !== 'paid') return false;
  const amt = s.amount_paid != null ? parseFloat(String(s.amount_paid)) : 0;
  return amt > 0 || !!s.stripe_payment_id;
}

serve(async () => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    // 24h window + the migration backfill keep this candidate set tiny; the
    // partial index idx_songs_sale_push_pending covers the scan.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await admin
      .from('songs')
      .select('id, sender_name, recipient_name, genre, amount_paid, email, stripe_session_id, stripe_payment_id, paid, payment_status, paid_at')
      .is('sale_push_sent_at', null)
      .not('paid_at', 'is', null)
      .gt('paid_at', dayAgo)
      .limit(50);
    if (error) throw new Error(`songs query failed: ${error.message}`);

    const paidRows = (rows || []).filter(isStripeConfirmed);

    // One push per purchase — a two-pack creates two rows on one session.
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of paidRows) {
      const key = String(r.stripe_session_id || r.stripe_payment_id || r.email || r.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    let sent = 0;
    let failed = 0;
    for (const [key, group] of groups) {
      const ids = group.map((g) => g.id as string);

      // Stamp BEFORE sending (at-most-once). If the stamp fails, skip — the
      // next run retries this group.
      const { error: stampErr } = await admin
        .from('songs')
        .update({ sale_push_sent_at: new Date().toISOString() })
        .in('id', ids)
        .is('sale_push_sent_at', null);
      if (stampErr) {
        failed++;
        console.error('notify-new-sales: stamp failed', key, stampErr.message);
        continue;
      }

      const primary = group[0];
      const amt = Math.max(
        ...group.map((g) => (g.amount_paid != null ? parseFloat(String(g.amount_paid)) || 0 : 0)),
      );
      const title = amt > 0 ? `💰 Nueva venta — $${amt.toFixed(2)}` : '💰 Nueva venta';
      const genre = String(primary.genre || '').trim();
      const recipient = String(primary.recipient_name || '').trim();
      const sender = String(primary.sender_name || '').trim();
      const pieces = [
        genre || 'Canción personalizada',
        recipient ? `para ${recipient}` : '',
      ].filter(Boolean);
      const body = pieces.join(' ') + (sender ? ` · de ${sender}` : '');

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-admin-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            title,
            body,
            url: '/admin/dashboard?tab=orders',
            tag: `sale-${key}`,
            // Sale pushes carry the $ amount — admins only. Assistants must
            // never receive pricing (same rule as the dashboard's redaction).
            audience: 'admin',
          }),
        });
        if (!res.ok) throw new Error(`notify-admin-push ${res.status}`);
        sent++;
      } catch (pushErr) {
        // Stamp already written — this sale's push is forfeited, not retried.
        failed++;
        console.error('notify-new-sales: push failed', key, pushErr);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, candidates: paidRows.length, purchases: groups.size, sent, failed }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('notify-new-sales error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
