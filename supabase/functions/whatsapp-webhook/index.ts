// supabase/functions/whatsapp-webhook/index.ts
//
// Inbound WhatsApp receiver — the WhatsApp twin of twilio-sms-webhook. Twilio
// POSTs here every time a customer messages our WhatsApp Business number. The
// only differences from the SMS webhook are: `From` arrives as `whatsapp:+E164`
// (we strip the prefix to store a clean phone) and the conversation/message are
// tagged channel='whatsapp' so the admin inbox shows them under the WhatsApp
// sub-tab.
//
// STAYS DARK until the approved WhatsApp Business sender exists in Twilio and
// this URL is set as its inbound webhook:
//   Twilio → WhatsApp sender → "when a message comes in" → POST
//   https://yzbvajungshqcpusfiia.supabase.co/functions/v1/whatsapp-webhook
//
// verify_jwt = false (config.toml): Twilio cannot attach a Supabase JWT. We
// authenticate (optionally) via Twilio's X-Twilio-Signature, exactly like the
// SMS webhook.
//
// Deploy with: supabase functions deploy whatsapp-webhook --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { triggerCsAgent, runInBackground } from '../_shared/trigger-cs-agent.ts';
import { maybeSendOutOfOffice } from '../_shared/out-of-office.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const VALIDATE_SIGNATURE = Deno.env.get('TWILIO_VALIDATE_SIGNATURE') === 'true';
const WEBHOOK_URL_OVERRIDE = Deno.env.get('TWILIO_WHATSAPP_WEBHOOK_URL');

// Same CTIA-style opt-out/in keywords Twilio honors on WhatsApp too.
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);

function twiml(body = '<Response></Response>') {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

async function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
): Promise<boolean> {
  if (!TWILIO_AUTH_TOKEN || !signature) return false;
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === signature;
}

// Twilio WhatsApp addresses come as 'whatsapp:+1305...'; store the bare E.164.
function stripWhatsApp(v: string): string {
  return (v || '').replace(/^whatsapp:/i, '').trim();
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);

    const phone = stripWhatsApp(params['From'] || '');
    const messageBody = (params['Body'] || '').trim();
    const twilioSid = params['MessageSid'] || params['SmsSid'] || null;
    if (!phone) return twiml();

    const signature = req.headers.get('X-Twilio-Signature') || '';
    const urlForSig = WEBHOOK_URL_OVERRIDE || req.url;
    if (VALIDATE_SIGNATURE) {
      const ok = await isValidTwilioSignature(urlForSig, params, signature);
      if (!ok) {
        console.warn('whatsapp-webhook: signature validation FAILED', { url: urlForSig });
        return new Response('Forbidden', { status: 403 });
      }
    } else if (signature) {
      const ok = await isValidTwilioSignature(urlForSig, params, signature).catch(() => false);
      console.log('whatsapp-webhook: signature (not enforced) valid=', ok);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existing } = await admin
      .from('sms_conversations')
      .select('id, unread, customer_name, order_id, opted_out, oo_auto_replied_at')
      .eq('phone', phone)
      .maybeSingle();

    const upper = messageBody.toUpperCase();
    const isStop = STOP_WORDS.has(upper);
    const isStart = START_WORDS.has(upper);

    let conversationId: string;
    let displayName: string | null = null;
    const nowIso = new Date().toISOString();

    if (existing) {
      conversationId = existing.id;
      displayName = existing.customer_name || null;
      const update: Record<string, unknown> = {
        unread: (existing.unread || 0) + 1,
        last_message_at: nowIso,
        channel: 'whatsapp',
      };
      if (isStop) { update.opted_out = true; update.opted_out_at = nowIso; }
      if (isStart) { update.opted_out = false; update.opted_out_at = null; }
      await admin.from('sms_conversations').update(update).eq('id', conversationId);
    } else {
      // Best-effort enrich name/order from a matching paid song.
      let customerName: string | null = null;
      let orderId: string | null = null;
      try {
        const last10 = phone.replace(/\D/g, '').slice(-10);
        if (last10.length === 10) {
          const { data: song } = await admin
            .from('songs')
            .select('id, recipient_name, sender_name, whatsapp_phone')
            .ilike('whatsapp_phone', `%${last10}`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (song) {
            customerName = song.sender_name || song.recipient_name || null;
            orderId = song.id || null;
          }
        }
      } catch (_e) { /* enrichment is optional */ }

      const { data: created, error: createErr } = await admin
        .from('sms_conversations')
        .insert({
          phone,
          customer_name: customerName,
          order_id: orderId,
          unread: 1,
          opted_out: isStop,
          opted_out_at: isStop ? nowIso : null,
          last_message_at: nowIso,
          channel: 'whatsapp',
        })
        .select('id')
        .single();
      if (createErr || !created) {
        console.error('whatsapp-webhook: failed to create conversation', createErr);
        return twiml();
      }
      conversationId = created.id;
      displayName = customerName;
    }

    await admin.from('sms_messages').insert({
      conversation_id: conversationId,
      direction: 'inbound',
      body: messageBody,
      status: 'received',
      twilio_sid: twilioSid,
      channel: 'whatsapp',
    });

    // No reply owed on STOP/START keywords or to opted-out numbers.
    const replyable = !isStop && !isStart && !(existing && existing.opted_out);

    // Out-of-office: auto-reply ONCE (throttled) when the owner is away, and
    // skip the AI draft. Otherwise draft an AI reply in the background (no-ops
    // unless the bot is switched on; never sends).
    if (replyable) {
      runInBackground(
        maybeSendOutOfOffice(admin, {
          conversationId,
          phone,
          channel: 'whatsapp',
          lastAutoReplyAt: existing?.oo_auto_replied_at ?? null,
        }).then((r) => {
          if (!r.sent) return triggerCsAgent(conversationId);
        }),
      );
    }

    // Notify admin devices.
    try {
      const preview = messageBody.length > 110 ? messageBody.slice(0, 110) + '…' : messageBody;
      await fetch(`${SUPABASE_URL}/functions/v1/notify-admin-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          title: `🟢 ${displayName || phone}`,
          body: preview || '(mensaje vacío)',
          url: '/admin/dashboard?tab=sms',
          tag: `wa-${conversationId}`,
        }),
      });
    } catch (pushErr) {
      console.warn('whatsapp-webhook: push notify failed', pushErr);
    }

    return twiml();
  } catch (e) {
    console.error('whatsapp-webhook error:', e);
    return twiml();
  }
});
