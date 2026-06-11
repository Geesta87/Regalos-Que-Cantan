// supabase/functions/send-song-ready-sms/index.ts
//
// Transactional auto-send: texts the song-ready link to newly-paid customers
// who consented to SMS at checkout. Runs every minute via pg_cron.
//
// FULLY ISOLATED from the payment path: it only reads/updates the songs table
// and sends via Twilio. It never touches stripe-webhook or the checkout, so an
// SMS failure here can never affect a payment.
//
// Eligibility (all must hold):
//   - sms_consent_at IS NOT NULL  → customer provided their number under the
//     live SMS disclosure (consent recorded by save_whatsapp_phone)
//   - sms_consent_at within 30 days → never reach back into pre-consent history
//   - song_sms_sent_at IS NULL     → not already auto-texted
//   - whatsapp_phone present
//   - the order is paid (checked in code, mirroring the dashboard's isPaid)
//
// On success it stamps song_sms_sent_at (dedupe) and whatsapp_sent_at (so the
// order also drops out of the "Pending to Send" queue), and logs the outbound
// message to the SMS inbox so the conversation threads correctly.
//
// verify_jwt = false (config.toml): invoked by pg_cron, which carries no JWT.
//
// Deploy with: supabase functions deploy send-song-ready-sms --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE = 'https://regalosquecantan.com';
const WA_SUPPORT = 'https://wa.me/12136666619';

// Only orders GENUINELY confirmed paid via Stripe. The stripe-webhook sets
// paid=true + payment_status='paid' + paid_at on confirmation; verify-payment
// sets stripe_payment_id. We require a confirmation timestamp (paid_at) AND
// either real money paid or a Stripe payment id — which excludes abandoned
// checkouts (no paid_at) and $0 free orders (no money, no Stripe payment).
function isStripeConfirmed(s: Record<string, unknown>): boolean {
  if (!s.paid_at) return false;
  if (s.paid !== true && s.payment_status !== 'paid') return false;
  const amt = s.amount_paid != null ? parseFloat(String(s.amount_paid)) : 0;
  return amt > 0 || !!s.stripe_payment_id;
}

function toE164(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}

// Short, unambiguous code for the branded /s/<code> link (no 0/O/1/l/I).
function genShortCode(len = 6): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

serve(async () => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    // Candidate set is tiny (consented + not-yet-texted); filter paid in code.
    const { data: rows, error } = await admin
      .from('songs')
      .select('id, whatsapp_phone, sender_name, recipient_name, short_code, paid, payment_status, stripe_payment_id, paid_at, amount_paid')
      .is('song_sms_sent_at', null)
      .not('sms_consent_at', 'is', null)
      .gt('sms_consent_at', thirtyDaysAgo)
      .not('whatsapp_phone', 'is', null)
      .not('paid_at', 'is', null)
      .limit(100);
    if (error) throw new Error(`songs query failed: ${error.message}`);

    const paidRows = (rows || []).filter((r) => isStripeConfirmed(r) && (r.whatsapp_phone || '').trim() !== '');

    // Compliance: never text anyone who replied STOP. opted_out is tracked per
    // phone (E.164) in sms_conversations by the inbound webhook.
    const { data: optedOutRows } = await admin
      .from('sms_conversations')
      .select('phone')
      .eq('opted_out', true);
    const optedOut = new Set((optedOutRows || []).map((o) => String(o.phone)));

    // One text per customer per run — group by phone (covers bundle orders).
    const byPhone = new Map<string, Record<string, unknown>[]>();
    for (const r of paidRows) {
      const key = String(r.whatsapp_phone);
      if (!byPhone.has(key)) byPhone.set(key, []);
      byPhone.get(key)!.push(r);
    }

    let sent = 0;
    let failed = 0;

    for (const [phone, group] of byPhone) {
      const to = toE164(phone);
      const ids = group.map((g) => g.id as string);
      if (!to) { failed++; continue; }

      // Respect STOP — mark handled so we stop reconsidering, but never send.
      if (optedOut.has(to)) {
        await admin.from('songs').update({ song_sms_sent_at: new Date().toISOString() }).in('id', ids);
        continue;
      }

      const primary = group[0];
      const name = String(primary.sender_name || '').trim();
      const greet = name ? `¡Gracias ${name}!` : '¡Gracias!';

      // Short branded link. Generate a code for the primary song if it has none;
      // fall back to the full URL on any issue so a customer always gets a link.
      let code = primary.short_code as string | undefined;
      if (!code) {
        code = genShortCode();
        const { error: codeErr } = await admin
          .from('songs').update({ short_code: code }).eq('id', primary.id).is('short_code', null);
        if (codeErr) code = undefined;
      }
      const link = code ? `${SITE}/s/${code}` : `${SITE}/success?song_id=${primary.id}`;
      const recipient = String(primary.recipient_name || '').trim();
      const songLine = recipient ? `Tu canción para ${recipient} ya está lista` : 'Tu canción ya está lista';
      const body = `${greet} ❤️\n🎵 ${songLine}: ${link}\n¿Preguntas? Escríbenos por WhatsApp: ${WA_SUPPORT}\nregalosquecantan.com\nResponde STOP para dejar de recibir mensajes.`;

      const result = await sendSms(to, body);
      const nowIso = new Date().toISOString();

      if (!result.ok) {
        failed++;
        console.error('send-song-ready-sms: send failed', phone, result.error);
        continue;
      }
      sent++;

      // Mark delivered. song_sms_sent_at = dedupe; whatsapp_sent_at (only if
      // still null) also clears the Pending to Send queue.
      await admin.from('songs').update({ song_sms_sent_at: nowIso }).in('id', ids);
      await admin.from('songs').update({ whatsapp_sent_at: nowIso }).in('id', ids).is('whatsapp_sent_at', null);

      // Best-effort: log to the SMS inbox so the auto-send threads with replies.
      try {
        const { data: convo } = await admin
          .from('sms_conversations')
          .select('id')
          .eq('phone', to)
          .maybeSingle();
        let conversationId = convo?.id as string | undefined;
        if (!conversationId) {
          const { data: created } = await admin
            .from('sms_conversations')
            .insert({ phone: to, customer_name: name || null, order_id: primary.id, last_message_at: nowIso })
            .select('id')
            .single();
          conversationId = created?.id as string | undefined;
        } else {
          await admin.from('sms_conversations').update({ last_message_at: nowIso }).eq('id', conversationId);
        }
        if (conversationId) {
          await admin.from('sms_messages').insert({
            conversation_id: conversationId,
            direction: 'outbound',
            body,
            status: result.status || 'sent',
            twilio_sid: result.sid || null,
          });
        }
      } catch (logErr) {
        console.warn('send-song-ready-sms: inbox log skipped', logErr);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, candidates: paidRows.length, customers: byPhone.size, sent, failed }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('send-song-ready-sms error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : JSON.stringify(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
