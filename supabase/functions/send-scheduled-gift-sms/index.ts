// supabase/functions/send-scheduled-gift-sms/index.ts
//
// Delivers the $5 scheduled gift texts at the buyer-chosen time. Runs every
// minute via pg_cron. FULLY ISOLATED from the payment path — it only reads/writes
// scheduled_gift_messages (+ a read of songs for the link and sms_conversations
// for STOP) and sends via Twilio.
//
// Timing strategy (buyer chose "exact second"):
//   - In Twilio's native window (~16 min .. 7 days out): hand the message to
//     Twilio's scheduled-send. Twilio delivers it at the exact second; we flag
//     twilio_scheduled=true so we never touch it again.
//   - Due now / in the past (<= ~1 min away): send immediately.
//   - Too soon for Twilio but not due yet (1 min .. 16 min): leave it; a later
//     run sends it immediately when it comes due.
//   - Too far out (> 7 days): excluded by the query horizon; picked up once it
//     drifts into the window.
//
// Safety: respects STOP (sms_conversations.opted_out), always names the sender
// and includes the STOP line, and claims each row atomically (scheduled ->
// processing) so a row can never be sent twice.
//
// verify_jwt = false (config.toml): invoked by pg_cron, which carries no JWT.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms, scheduleSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE = 'https://regalosquecantan.com';

// Twilio native scheduling accepts ~15 min .. 7 days ahead. Use 16 min as a
// safe lower edge and 7 days as the upper edge.
const TWILIO_MIN_LEAD_MS = 16 * 60 * 1000;
const TWILIO_MAX_LEAD_MS = 7 * 24 * 3600 * 1000;
// "Due now" tolerance — send immediately within this of the target.
const DUE_NOW_MS = 60 * 1000;
// Reclaim rows stuck in 'processing' (function crashed mid-flight) after this.
const STUCK_MS = 5 * 60 * 1000;

function toE164(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}

function buildBody(buyerName: string, message: string, link: string): string {
  const note = message ? `«${message}»\n` : '';
  return (
    `🎵 ${buyerName} te mandó una canción a través de Regalos Que Cantan 💝\n` +
    `${note}${link}\n` +
    `Responde STOP para no recibir más.`
  );
}

serve(async () => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const nowIso = new Date().toISOString();
  let scheduledViaTwilio = 0;
  let sentNow = 0;
  let failed = 0;
  let canceled = 0;

  try {
    // Self-heal: free rows that got stuck mid-flight on a previous run.
    const stuckBefore = new Date(Date.now() - STUCK_MS).toISOString();
    await admin
      .from('scheduled_gift_messages')
      .update({ status: 'scheduled', updated_at: nowIso })
      .eq('status', 'processing')
      .lt('updated_at', stuckBefore);

    // Actionable rows: paid + scheduled, not yet handed to Twilio, due within the
    // Twilio window (too-far rows are left for a later run).
    const horizon = new Date(Date.now() + TWILIO_MAX_LEAD_MS).toISOString();
    const { data: rows, error } = await admin
      .from('scheduled_gift_messages')
      .select('id, song_id, buyer_name, recipient_name, recipient_phone, personal_message, send_at')
      .eq('status', 'scheduled')
      .eq('twilio_scheduled', false)
      .lte('send_at', horizon)
      .order('send_at', { ascending: true })
      .limit(100);
    if (error) throw new Error(`query failed: ${error.message}`);

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, candidates: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // STOP list — never text anyone who opted out (per E.164 phone).
    const { data: optedOutRows } = await admin
      .from('sms_conversations')
      .select('phone')
      .eq('opted_out', true);
    const optedOut = new Set((optedOutRows || []).map((o) => String(o.phone)));

    for (const row of rows) {
      const to = toE164(String(row.recipient_phone || ''));
      if (!to) {
        await admin
          .from('scheduled_gift_messages')
          .update({ status: 'failed', error_message: 'invalid_phone', updated_at: new Date().toISOString() })
          .eq('id', row.id);
        failed++;
        continue;
      }

      // Atomic claim: scheduled -> processing. If another worker took it, skip.
      const { data: claimed } = await admin
        .from('scheduled_gift_messages')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'scheduled')
        .select('id')
        .maybeSingle();
      if (!claimed) continue;

      // Respect STOP — never send; mark canceled with a reason.
      if (optedOut.has(to)) {
        await admin
          .from('scheduled_gift_messages')
          .update({ status: 'canceled', error_message: 'recipient_opted_out', updated_at: new Date().toISOString() })
          .eq('id', row.id);
        canceled++;
        continue;
      }

      // Resolve the share link (branded /s/<code> when available).
      let link = `${SITE}/song/${row.song_id}`;
      try {
        const { data: s } = await admin
          .from('songs')
          .select('short_code')
          .eq('id', row.song_id)
          .maybeSingle();
        if (s?.short_code) link = `${SITE}/s/${s.short_code}`;
      } catch { /* fall back to /song/<id> */ }

      const buyerName = String(row.buyer_name || '').trim() || 'Alguien';
      const message = String(row.personal_message || '').trim();
      const body = buildBody(buyerName, message, link);

      const msUntil = new Date(row.send_at).getTime() - Date.now();

      try {
        if (msUntil <= DUE_NOW_MS) {
          // Due now (or slightly past) → send immediately.
          const r = await sendSms(to, body);
          if (r.ok) {
            await admin
              .from('scheduled_gift_messages')
              .update({ status: 'sent', sent_at: new Date().toISOString(), twilio_sid: r.sid || null, error_message: null, updated_at: new Date().toISOString() })
              .eq('id', row.id);
            sentNow++;
            await logToInbox(admin, to, buyerName, body, r.status, r.sid, row.song_id);
          } else {
            await admin
              .from('scheduled_gift_messages')
              .update({ status: 'failed', error_message: (r.error || 'send_failed').slice(0, 500), updated_at: new Date().toISOString() })
              .eq('id', row.id);
            failed++;
          }
        } else if (msUntil >= TWILIO_MIN_LEAD_MS && msUntil <= TWILIO_MAX_LEAD_MS) {
          // In-window → hand to Twilio native scheduling (exact-second delivery).
          const r = await scheduleSms(to, body, new Date(row.send_at).toISOString());
          if (r.ok) {
            await admin
              .from('scheduled_gift_messages')
              .update({ status: 'scheduled', twilio_scheduled: true, twilio_sid: r.sid || null, error_message: null, updated_at: new Date().toISOString() })
              .eq('id', row.id);
            scheduledViaTwilio++;
          } else {
            // Twilio rejected the schedule — leave it scheduled (no flag) so a
            // later run sends it immediately when it comes due.
            await admin
              .from('scheduled_gift_messages')
              .update({ status: 'scheduled', error_message: ('twilio_schedule: ' + (r.error || 'rejected')).slice(0, 500), updated_at: new Date().toISOString() })
              .eq('id', row.id);
          }
        } else {
          // Too soon for Twilio but not yet due (1..16 min): release and wait.
          await admin
            .from('scheduled_gift_messages')
            .update({ status: 'scheduled', updated_at: new Date().toISOString() })
            .eq('id', row.id);
        }
      } catch (e) {
        // Any unexpected error → release back to scheduled for the next run.
        await admin
          .from('scheduled_gift_messages')
          .update({ status: 'scheduled', error_message: ('exception: ' + (e instanceof Error ? e.message : String(e))).slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, candidates: rows.length, scheduledViaTwilio, sentNow, failed, canceled }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('send-scheduled-gift-sms error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});

// Best-effort: thread the outbound gift text into the SMS inbox keyed by the
// recipient's number, so a STOP reply lands on a real conversation.
async function logToInbox(
  admin: ReturnType<typeof createClient>,
  to: string,
  name: string,
  body: string,
  status: string | undefined,
  sid: string | undefined,
  songId: string,
) {
  try {
    const nowIso = new Date().toISOString();
    const { data: convo } = await admin
      .from('sms_conversations')
      .select('id')
      .eq('phone', to)
      .maybeSingle();
    let conversationId = convo?.id as string | undefined;
    if (!conversationId) {
      const { data: created } = await admin
        .from('sms_conversations')
        .insert({ phone: to, customer_name: name || null, order_id: songId, last_message_at: nowIso })
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
        status: status || 'sent',
        twilio_sid: sid || null,
      });
    }
  } catch (e) {
    console.warn('send-scheduled-gift-sms: inbox log skipped', e);
  }
}
