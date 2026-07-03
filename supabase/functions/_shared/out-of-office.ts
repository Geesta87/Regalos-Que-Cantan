// supabase/functions/_shared/out-of-office.ts
//
// Out-of-office auto-reply, shared by the inbound webhooks (twilio-sms-webhook
// and whatsapp-webhook). When the owner has flipped the "out of office" toggle
// in the inbox, an inbound customer message gets ONE friendly auto-reply on the
// same channel it came in on — so nobody is left waiting overnight.
//
// The toggle + editable message live on cs_agent_settings (id = 1), the same
// singleton that holds the AI-bot master switch. Throttling lives per
// conversation (sms_conversations.oo_auto_replied_at): a customer who fires off
// several texts in a row only gets one auto-reply per THROTTLE_HOURS window.

import { sendSms } from './send-sms.ts';
import { sendWhatsApp } from './send-whatsapp.ts';

// Only one auto-reply per conversation within this window. "We'll be back
// tomorrow" — so roughly one per away-period is right; 8h means an evening of
// texts gets a single reply, and a next-morning text (still away) gets one more.
const THROTTLE_HOURS = 8;

// Fallback message (customer-facing → Spanish) used until the owner edits it.
export const DEFAULT_OO_MESSAGE =
  '¡Hola! 🌙 Gracias por tu mensaje. En este momento nuestro equipo está fuera de la oficina, pero tu pregunta es muy importante para nosotros. Te responderemos tan pronto regresemos a la oficina. ¡Gracias por tu paciencia! 💛';

// deno-lint-ignore no-explicit-any
type Admin = any;

// Send the out-of-office auto-reply if (and only if) the toggle is on AND we
// haven't already auto-replied to this conversation recently. Records the
// outbound message in the thread and stamps the throttle timestamp.
//
// Returns { sent: true } when an auto-reply went out — the caller should then
// skip the normal cs-agent draft (the customer already got an answer).
export async function maybeSendOutOfOffice(
  admin: Admin,
  opts: {
    conversationId: string;
    phone: string;
    channel: 'sms' | 'whatsapp';
    lastAutoReplyAt?: string | null;
  },
): Promise<{ sent: boolean }> {
  try {
    const { data: settings } = await admin
      .from('cs_agent_settings')
      .select('out_of_office, out_of_office_message')
      .eq('id', 1)
      .maybeSingle();
    if (!settings?.out_of_office) return { sent: false };

    // Throttle: at most one auto-reply per conversation per window.
    if (opts.lastAutoReplyAt) {
      const ageMs = Date.now() - new Date(opts.lastAutoReplyAt).getTime();
      if (ageMs < THROTTLE_HOURS * 3600_000) return { sent: false };
    }

    const message = (settings.out_of_office_message || '').trim() || DEFAULT_OO_MESSAGE;
    const result = opts.channel === 'whatsapp'
      ? await sendWhatsApp(opts.phone, message)
      : await sendSms(opts.phone, message);

    const nowIso = new Date().toISOString();
    // Record the auto-reply in the thread regardless of send outcome, so the
    // owner sees what went out.
    await admin.from('sms_messages').insert({
      conversation_id: opts.conversationId,
      direction: 'outbound',
      body: message,
      status: result.ok ? (result.status || 'sent') : 'failed',
      twilio_sid: result.sid || null,
      channel: opts.channel,
      ai_generated: true,
    });
    // Stamp the throttle even on a failed send — if Twilio is choking we don't
    // want to hammer it with retries on every inbound message.
    await admin
      .from('sms_conversations')
      .update({ oo_auto_replied_at: nowIso, last_message_at: nowIso })
      .eq('id', opts.conversationId);

    return { sent: result.ok };
  } catch (e) {
    console.warn('out-of-office: auto-reply failed', e);
    return { sent: false };
  }
}
