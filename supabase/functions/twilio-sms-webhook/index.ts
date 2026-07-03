// supabase/functions/twilio-sms-webhook/index.ts
//
// Inbound SMS receiver. Twilio POSTs here (application/x-www-form-urlencoded)
// every time a customer texts our A2P number. This is what makes replies show
// up in the admin "💬 Mensajes SMS" inbox.
//
// Configure in Twilio: Phone Numbers → your A2P number → "A message comes in"
//   → Webhook → https://yzbvajungshqcpusfiia.supabase.co/functions/v1/twilio-sms-webhook  (POST)
//
// verify_jwt = false (config.toml): Twilio cannot attach a Supabase JWT. We
// authenticate the request instead via Twilio's X-Twilio-Signature (HMAC-SHA1
// of the URL + sorted params, keyed by the Auth Token).
//
// What it does per inbound message:
//   1. (optional) validate the Twilio signature
//   2. find or create the conversation for that phone number
//   3. handle STOP / START / HELP keywords (mirror opt-out state so the inbox
//      composer locks — Twilio also enforces STOP at the carrier level)
//   4. store the inbound message + bump unread + last_message_at
//   5. return empty TwiML (200) so Twilio sends no auto-reply
//
// Deploy with: supabase functions deploy twilio-sms-webhook --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { triggerCsAgent, runInBackground } from '../_shared/trigger-cs-agent.ts';
import { maybeSendOutOfOffice } from '../_shared/out-of-office.ts';
import { storeInboundImage } from '../_shared/inbound-media.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
// Opt-in switch: set to 'true' only AFTER confirming the exact public webhook
// URL matches what Twilio calls (otherwise a URL mismatch would reject every
// inbound message). Leave unset during initial setup — we log instead.
const VALIDATE_SIGNATURE = Deno.env.get('TWILIO_VALIDATE_SIGNATURE') === 'true';
// Optional override of the URL used for signature validation, in case the
// platform rewrites req.url. Should equal the webhook URL set in Twilio.
const WEBHOOK_URL_OVERRIDE = Deno.env.get('TWILIO_WEBHOOK_URL');

// CTIA / Twilio standard opt-out + opt-in + help keywords.
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);

function twiml(body = '<Response></Response>') {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

// Twilio signature: base64( HMAC-SHA1( authToken, url + sortedConcat(params) ) )
async function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
): Promise<boolean> {
  if (!TWILIO_AUTH_TOKEN || !signature) return false;
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  const keyData = new TextEncoder().encode(TWILIO_AUTH_TOKEN);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);

    const fromRaw = (params['From'] || '').trim();
    const messageBody = (params['Body'] || '').trim();
    const twilioSid = params['MessageSid'] || params['SmsSid'] || null;

    if (!fromRaw) {
      // Nothing actionable; ack so Twilio doesn't retry.
      return twiml();
    }

    // Signature check (opt-in). When enabled and it fails, reject.
    const signature = req.headers.get('X-Twilio-Signature') || '';
    const urlForSig = WEBHOOK_URL_OVERRIDE || req.url;
    if (VALIDATE_SIGNATURE) {
      const ok = await isValidTwilioSignature(urlForSig, params, signature);
      if (!ok) {
        console.warn('twilio-sms-webhook: signature validation FAILED', { url: urlForSig });
        return new Response('Forbidden', { status: 403 });
      }
    } else if (signature) {
      // Not enforcing yet — log so we can confirm the URL/params line up
      // before flipping TWILIO_VALIDATE_SIGNATURE on.
      const ok = await isValidTwilioSignature(urlForSig, params, signature).catch(() => false);
      console.log('twilio-sms-webhook: signature (not enforced) valid=', ok);
    }

    const phone = fromRaw; // Twilio delivers From in E.164 already.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find or create the conversation for this phone.
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
      };
      if (isStop) { update.opted_out = true; update.opted_out_at = nowIso; }
      if (isStart) { update.opted_out = false; update.opted_out_at = null; }
      await admin.from('sms_conversations').update(update).eq('id', conversationId);
    } else {
      // New number — best-effort enrich name/order from a matching paid song.
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
      } catch (_e) {
        // Enrichment is optional — never let it block message capture.
      }

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
        })
        .select('id')
        .single();
      if (createErr || !created) {
        console.error('twilio-sms-webhook: failed to create conversation', createErr);
        return twiml(); // ack anyway; do not make Twilio retry-storm
      }
      conversationId = created.id;
      displayName = customerName;
    }

    // Capture an attached image (MMS) so it shows in the thread and the bot can
    // SEE it.
    let media: { path: string; type: string } | null = null;
    if (parseInt(params['NumMedia'] || '0', 10) > 0 && params['MediaUrl0']) {
      media = await storeInboundImage(admin, {
        conversationId,
        mediaUrl: params['MediaUrl0'],
        contentType: params['MediaContentType0'] || '',
      });
    }

    // Store the inbound message.
    await admin.from('sms_messages').insert({
      conversation_id: conversationId,
      direction: 'inbound',
      body: messageBody,
      status: 'received',
      twilio_sid: twilioSid,
      channel: 'sms',
      media_path: media?.path || null,
      media_type: media?.type || null,
    });

    // No reply owed on STOP/START keywords or to opted-out numbers.
    const replyable = !isStop && !isStart && !(existing && existing.opted_out);

    // Out-of-office: if the owner is away, auto-reply ONCE (throttled) and skip
    // the AI draft — the customer already got an answer. Runs in the background
    // so it doesn't slow the Twilio ack.
    if (replyable) {
      runInBackground(
        maybeSendOutOfOffice(admin, {
          conversationId,
          phone,
          channel: 'sms',
          lastAutoReplyAt: existing?.oo_auto_replied_at ?? null,
        }).then((r) => {
          // Only fall through to the AI draft when we did NOT auto-reply.
          if (!r.sent) return triggerCsAgent(conversationId);
        }),
      );
    }

    // Notify admin devices via web push (best effort — never blocks capture).
    try {
      const preview =
        messageBody.length > 110 ? messageBody.slice(0, 110) + '…' : messageBody;
      await fetch(`${SUPABASE_URL}/functions/v1/notify-admin-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          title: `💬 ${displayName || phone}`,
          body: preview || '(mensaje vacío)',
          url: '/admin/dashboard?tab=sms',
          tag: `sms-${conversationId}`,
        }),
      });
    } catch (pushErr) {
      console.warn('twilio-sms-webhook: push notify failed', pushErr);
    }

    return twiml();
  } catch (e) {
    console.error('twilio-sms-webhook error:', e);
    // Still ack with empty TwiML — a 500 makes Twilio retry repeatedly.
    return twiml();
  }
});
