// supabase/functions/send-song-ready-whatsapp/index.ts
//
// WhatsApp song-ready confirmation for PAID customers — the WhatsApp twin of
// send-song-ready-sms, sent ALONGSIDE the SMS (own dedup: song_wa_sent_at) so a
// customer gets each channel once. Uses the approved `song_ready_buyer_es`
// template (SONG_READY_TEMPLATE_SID) from CS_WHATSAPP_FROM.
//
// Eligibility (all must hold):
//   - paid (isStripeConfirmed) AND paid_at within the last 24h (so enabling this
//     never blasts the historical backlog — old buyers already have their song)
//   - whatsapp_phone present
//   - song_wa_sent_at IS NULL (not already WhatsApp-confirmed)
//   - not opted out (STOP)
// One send per phone per run (covers bundles). One attempt per customer: we set
// song_wa_sent_at after the attempt regardless (a bad/foreign number that isn't
// on WhatsApp just drops — the SMS still reached them). Only a transient rate
// limit defers to the next run.
//
// Master switch: cs_agent_settings.song_wa_autosend (defaults OFF).
// verify_jwt = false (config.toml): invoked by pg_cron. Never touches the
// payment funnel — only reads/stamps songs + sends.
//
// Deploy with: supabase functions deploy send-song-ready-whatsapp --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWhatsAppTemplate, isWhatsAppConfigured } from '../_shared/send-whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SONG_READY_TEMPLATE_SID = Deno.env.get('SONG_READY_TEMPLATE_SID'); // HX… of song_ready_buyer_es
const MAX_PER_RUN = parseInt(Deno.env.get('SONG_WA_MAX_PER_RUN') || '25', 10);
const SITE = 'https://regalosquecantan.com';
const TRANSIENT_CODES = new Set([63018, 20429]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

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

// Same link logic as send-song-ready-sms: upsell buyers land on /success (shows
// everything); audio-only orders get the branded /s/<short_code>.
function buildLink(group: Record<string, unknown>[]): string {
  const isUpsell = (g: Record<string, unknown>) =>
    g.has_video_addon === true || g.karaoke_video_status != null || g.karaoke_status != null;
  if (group.length > 1) {
    const allIds = group.map((g) => g.id as string).join(',');
    return group.some(isUpsell) ? `${SITE}/success?song_ids=${allIds}` : `${SITE}/song/${allIds}`;
  }
  const primary = group[0];
  if (isUpsell(primary)) return `${SITE}/success?song_id=${primary.id}`;
  if (primary.short_code) return `${SITE}/s/${primary.short_code}`;
  return `${SITE}/success?song_id=${primary.id}`;
}

serve(async () => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { data: settings } = await admin
      .from('cs_agent_settings').select('song_wa_autosend').eq('id', 1).maybeSingle();
    if (!settings?.song_wa_autosend) return json({ ok: true, skipped: 'song_wa autosend disabled' });

    if (!SONG_READY_TEMPLATE_SID) return json({ ok: false, error: 'SONG_READY_TEMPLATE_SID not set' }, 500);
    if (!isWhatsAppConfigured()) return json({ ok: false, error: 'WhatsApp not configured' }, 500);

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await admin
      .from('songs')
      .select('id, whatsapp_phone, sender_name, recipient_name, short_code, paid, payment_status, stripe_payment_id, paid_at, amount_paid, has_video_addon, karaoke_video_status, karaoke_status')
      .is('song_wa_sent_at', null)
      .not('whatsapp_phone', 'is', null)
      .not('paid_at', 'is', null)
      .gt('paid_at', dayAgo)
      .limit(400);
    if (error) throw new Error(`songs query failed: ${error.message}`);

    const paidRows = (rows || []).filter((r) => isStripeConfirmed(r) && String(r.whatsapp_phone || '').trim() !== '');

    // Never message someone who opted out.
    const { data: optedOutRows } = await admin
      .from('sms_conversations').select('phone').eq('opted_out', true);
    const optedOut = new Set((optedOutRows || []).map((o) => String(o.phone)));

    // One message per phone (covers bundles).
    const byPhone = new Map<string, Record<string, unknown>[]>();
    for (const r of paidRows) {
      const key = String(r.whatsapp_phone);
      if (!byPhone.has(key)) byPhone.set(key, []);
      byPhone.get(key)!.push(r);
    }

    let sent = 0, dropped = 0, transient = 0, skippedOptout = 0;
    let processed = 0;

    for (const [phone, group] of byPhone) {
      if (processed >= MAX_PER_RUN) break;
      const ids = group.map((g) => g.id as string);
      const markSent = async () =>
        admin.from('songs').update({ song_wa_sent_at: new Date().toISOString() }).in('id', ids);

      const to = toE164(phone);
      if (!to) { await markSent(); dropped++; processed++; continue; }
      if (optedOut.has(to)) { await markSent(); skippedOptout++; processed++; continue; }
      processed++;

      const primary = group[0];
      const senderName = String(primary.sender_name || '').trim() || 'amigo';
      const recipients = group
        .map((g) => String(g.recipient_name || '').trim())
        .filter(Boolean);
      const recipientStr = [...new Set(recipients)].join(' y ') || 'tu ser querido';
      const link = buildLink(group);

      const result = await sendWhatsAppTemplate(to, SONG_READY_TEMPLATE_SID, {
        '1': senderName, '2': recipientStr, '3': link,
      });

      if (!result.ok && result.code && TRANSIENT_CODES.has(result.code)) { transient++; continue; }
      await markSent();
      if (result.ok) sent++; else dropped++;

      // Best-effort: thread it in the WhatsApp inbox.
      try {
        const body = `Hola ${senderName} 🎵 Tu canción personalizada para ${recipientStr} ya está lista. Escúchala y descárgala aquí: ${link} — ¡Gracias por elegir Regalos Que Cantan! 🎶`;
        const nowIso = new Date().toISOString();
        const { data: convo } = await admin
          .from('sms_conversations').select('id').eq('phone', to).maybeSingle();
        let conversationId = convo?.id as string | undefined;
        if (!conversationId) {
          const { data: created } = await admin
            .from('sms_conversations')
            .insert({ phone: to, customer_name: senderName, order_id: ids[0] || null, last_message_at: nowIso, channel: 'whatsapp' })
            .select('id').single();
          conversationId = created?.id as string | undefined;
        } else {
          await admin.from('sms_conversations').update({ last_message_at: nowIso, channel: 'whatsapp' }).eq('id', conversationId);
        }
        if (conversationId) {
          await admin.from('sms_messages').insert({
            conversation_id: conversationId,
            direction: 'outbound',
            body,
            status: result.ok ? (result.status || 'sent') : 'failed',
            twilio_sid: result.sid || null,
            channel: 'whatsapp',
          });
        }
      } catch (logErr) {
        console.warn('send-song-ready-whatsapp: inbox log skipped', logErr);
      }
    }

    return json({ ok: true, customers: byPhone.size, processed, sent, dropped, transient, skipped_optout: skippedOptout });
  } catch (e) {
    console.error('send-song-ready-whatsapp error:', e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
