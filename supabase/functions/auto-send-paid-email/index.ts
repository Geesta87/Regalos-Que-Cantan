// supabase/functions/auto-send-paid-email/index.ts
//
// Automates the admin dashboard's "📤 Enviar Link" button. Runs every minute
// via pg_cron, finds purchases newly confirmed paid, and asks recover-song to
// send the EXACT same "🎵 Aquí está tu canción" email the button sends
// (action='send', which='paid', group_key=<purchase>). The owner observed
// that this email reaches customer inboxes more reliably than the automatic
// purchase confirmation, so it now goes out for every sale automatically.
//
// FULLY ISOLATED from the payment path (same doctrine as send-song-ready-sms
// and notify-new-sales): reads/stamps songs and calls recover-song only.
//
// Safety rails:
//   - link_email_sent_at stamp, backfilled for all historical sales — never
//     replays old purchases. Stamped BEFORE sending (at-most-once).
//   - Skips purchases the admin already emailed manually (email_sent_at set).
//   - Waits until paid_at is ≥2 minutes old so both rows of a two-song
//     bundle are settled before the email is composed (avoids a bundle email
//     that only lists one song).
//   - On success also stamps email_sent_at (if null) so the dashboard button
//     flips to its "already sent" state and nobody double-clicks out of habit.
//   - recover-song is called with the anon key as Bearer (gateway requirement)
//     plus x-internal-auth=<service-role> to bypass only its per-IP limit.
//
// verify_jwt = false (config.toml): invoked by pg_cron, which carries no JWT.
//
// Deploy with: supabase functions deploy auto-send-paid-email --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Same Stripe-confirmation rule as send-song-ready-sms / notify-new-sales.
function isStripeConfirmed(s: Record<string, unknown>): boolean {
  if (!s.paid_at) return false;
  if (s.paid !== true && s.payment_status !== 'paid') return false;
  const amt = s.amount_paid != null ? parseFloat(String(s.amount_paid)) : 0;
  return amt > 0 || !!s.stripe_payment_id;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

serve(async () => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data: rows, error } = await admin
      .from('songs')
      .select('id, email, email_sent_at, stripe_session_id, stripe_payment_id, paid, payment_status, paid_at, amount_paid')
      .is('link_email_sent_at', null)
      .not('paid_at', 'is', null)
      .gt('paid_at', dayAgo)
      .lt('paid_at', twoMinAgo)
      .limit(50);
    if (error) throw new Error(`songs query failed: ${error.message}`);

    const paidRows = (rows || []).filter(isStripeConfirmed);

    // One email per purchase — two-pack rows share the checkout session.
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of paidRows) {
      const key = String(r.stripe_payment_id || r.stripe_session_id || r.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const nowIso = new Date().toISOString();

    for (const [groupKey, group] of groups) {
      const ids = group.map((g) => g.id as string);
      const primary = group[0];
      const email = String(primary.email || '').trim().toLowerCase();

      // Stamp first (at-most-once) — a stamp failure means retry next run.
      const { error: stampErr } = await admin
        .from('songs')
        .update({ link_email_sent_at: nowIso })
        .in('id', ids)
        .is('link_email_sent_at', null);
      if (stampErr) {
        failed++;
        console.error('auto-send-paid-email: stamp failed', groupKey, stampErr.message);
        continue;
      }

      // Admin already sent this one manually, or there is no usable email.
      if (group.some((g) => g.email_sent_at) || !isValidEmail(email)) {
        skipped++;
        continue;
      }

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/recover-song`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'x-internal-auth': SUPABASE_SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({
            email,
            action: 'send',
            which: 'paid',
            group_key: primary.stripe_payment_id || primary.stripe_session_id || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.emailSent) {
          throw new Error(`recover-song ${res.status} emailSent=${data?.emailSent}`);
        }
        sent++;
        // Mirror the manual flow: the dashboard's "Enviar Link" button shows
        // its already-sent state via email_sent_at.
        await admin
          .from('songs')
          .update({ email_sent_at: nowIso })
          .in('id', ids)
          .is('email_sent_at', null);
      } catch (sendErr) {
        // Stamp already written — this purchase's auto-email is forfeited
        // (admin can still send manually from the dashboard).
        failed++;
        console.error('auto-send-paid-email: send failed', groupKey, sendErr);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, candidates: paidRows.length, purchases: groups.size, sent, skipped, failed }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('auto-send-paid-email error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
