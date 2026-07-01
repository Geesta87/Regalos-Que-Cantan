// supabase/functions/send-hotlead-whatsapp/index.ts
//
// Automated hot-lead WhatsApp outreach. Runs hourly via pg_cron. For each
// eligible lead (made a song, left a WhatsApp phone, DIDN'T pay) it sends the
// approved `hot_lead_es` template from the CS WhatsApp number, then marks them
// contacted so they drop out of Hot Leads and are never messaged twice.
//
// SMART RULES (mirrors what the owner does manually, plus safety rails):
//   • The SQL function get_hotlead_candidates already excludes anyone who has
//     paid on ANY order (by email OR phone), anyone opted out, anyone already
//     contacted, and anything outside the 30min–72h freshness window.
//   • We RE-CHECK payment right before each send — if they bought in the last
//     few seconds, we skip + mark handled (they're a customer now, not a lead).
//   • ONE attempt per lead. After the attempt we set whatsapp_sent_at no matter
//     what — so a foreign number with no country code (reads as a US number
//     that's "not on WhatsApp") simply drops out and is NEVER retried. We only
//     hold off marking on a transient rate-limit so the next run can try once.
//   • Per-run cap (HOTLEAD_MAX_PER_RUN) keeps volume human-like to protect the
//     sender's quality rating.
//   • Master switch: cs_agent_settings.hotlead_autosend (defaults OFF).
//
// verify_jwt = false (config.toml): invoked by pg_cron (no JWT), same as the
// other cron senders. Reads its own env; only sends to eligible leads.
//
// Deploy with: supabase functions deploy send-hotlead-whatsapp --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWhatsAppTemplate, isWhatsAppConfigured } from '../_shared/send-whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HOTLEAD_TEMPLATE_SID = Deno.env.get('HOTLEAD_TEMPLATE_SID'); // HX… of hot_lead_es
const MAX_PER_RUN = parseInt(Deno.env.get('HOTLEAD_MAX_PER_RUN') || '25', 10);
const SITE = 'https://regalosquecantan.com';

// Twilio codes we treat as TRANSIENT (don't mark handled → retry next run).
// Everything else (incl. "not a WhatsApp user") is definitive → mark handled.
const TRANSIENT_CODES = new Set([63018 /* channel rate limit */, 20429 /* too many requests */]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function toE164(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}

serve(async () => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    // Master switch.
    const { data: settings } = await admin
      .from('cs_agent_settings').select('hotlead_autosend').eq('id', 1).maybeSingle();
    if (!settings?.hotlead_autosend) return json({ ok: true, skipped: 'hotlead autosend disabled' });

    if (!HOTLEAD_TEMPLATE_SID) return json({ ok: false, error: 'HOTLEAD_TEMPLATE_SID not set' }, 500);
    if (!isWhatsAppConfigured()) return json({ ok: false, error: 'WhatsApp not configured' }, 500);

    // Eligible leads (heavy filtering in SQL).
    const { data: leads, error } = await admin.rpc('get_hotlead_candidates', { p_limit: MAX_PER_RUN });
    if (error) throw new Error(`get_hotlead_candidates failed: ${error.message}`);

    let sent = 0, skippedPaid = 0, dropped = 0, transient = 0;

    for (const lead of leads || []) {
      const songIds: string[] = String(lead.song_ids || '').split(',').filter(Boolean);
      const markHandled = async () => {
        if (songIds.length) {
          await admin.from('songs').update({ whatsapp_sent_at: new Date().toISOString() }).in('id', songIds);
        }
      };

      // Re-check payment right before sending — a lead who just bought is now a
      // customer, so skip + mark handled (drops them from Hot Leads).
      const last10 = String(lead.phone || '').replace(/\D/g, '').slice(-10);
      const { data: paidRow } = await admin
        .from('songs')
        .select('id')
        .eq('paid', true)
        .or(`email.eq.${lead.email},whatsapp_phone.ilike.%${last10}`)
        .limit(1)
        .maybeSingle();
      if (paidRow) { await markHandled(); skippedPaid++; continue; }

      const to = toE164(String(lead.phone || ''));
      if (!to) { await markHandled(); dropped++; continue; } // unusable number → drop, no retry

      const sender = String(lead.sender_name || '').trim() || 'amigo';
      const recipient = String(lead.recipient_name || '').trim() || 'tu ser querido';
      const genre = String(lead.genre || '').trim() || 'personalizada';
      const link = `${SITE}/comparison?song_ids=${songIds.join(',')}`;

      const result = await sendWhatsAppTemplate(to, HOTLEAD_TEMPLATE_SID, {
        '1': sender, '2': genre, '3': recipient, '4': link,
      });

      // Transient rate-limit → leave for the next run (one light retry, nothing
      // was delivered). Any other outcome (success OR not-on-WhatsApp/invalid) →
      // mark handled so we NEVER retry.
      if (!result.ok && result.code && TRANSIENT_CODES.has(result.code)) {
        transient++;
        continue;
      }
      await markHandled();
      if (result.ok) sent++; else dropped++;

      // Best-effort: log to the SMS inbox so it threads in the WhatsApp tab.
      try {
        const body = `Hola ${sender} 👋 Soy de Regalos Que Cantan. Vi que creaste una canción increíble de ${genre} para ${recipient} pero no completaste tu compra. Tu canción sigue guardada y lista para ti 🎵 Escúchala y complétala aquí: ${link} — ¡No dejes pasar este regalo único! 🎁`;
        const nowIso = new Date().toISOString();
        const { data: convo } = await admin
          .from('sms_conversations').select('id').eq('phone', to).maybeSingle();
        let conversationId = convo?.id as string | undefined;
        if (!conversationId) {
          const { data: created } = await admin
            .from('sms_conversations')
            .insert({ phone: to, customer_name: sender, order_id: songIds[0] || null, last_message_at: nowIso, channel: 'whatsapp' })
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
        console.warn('send-hotlead-whatsapp: inbox log skipped', logErr);
      }
    }

    return json({ ok: true, considered: (leads || []).length, sent, skipped_paid: skippedPaid, dropped, transient });
  } catch (e) {
    console.error('send-hotlead-whatsapp error:', e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
