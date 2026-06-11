// supabase/functions/_shared/send-sms.ts
//
// Shared Twilio SMS sender. Mirrors the WhatsApp REST call already proven in
// health-check/index.ts (same Account SID + Auth Token, same Messages.json
// endpoint), but sends a plain SMS from the A2P 10DLC long code instead of the
// whatsapp: sender.
//
// Env (Supabase project secrets):
//   TWILIO_ACCOUNT_SID            — reused, already set for WhatsApp alerts
//   TWILIO_AUTH_TOKEN             — reused
//   TWILIO_MESSAGING_SERVICE_SID  — PREFERRED: the A2P Messaging Service
//                                   (MG...), e.g. MGd63058f3e4536ada8aeff95f5092bded.
//                                   Sending through the Messaging Service is what
//                                   associates each SMS with the approved A2P
//                                   10DLC campaign and lets Twilio pick the right
//                                   sender from the campaign's number pool.
//   TWILIO_SMS_FROM              — FALLBACK: a single A2P number in E.164
//                                   (+1...), used only if no Messaging Service
//                                   SID is set.
//
// Import from any edge function:
//   import { sendSms } from '../_shared/send-sms.ts';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
const TWILIO_SMS_FROM = Deno.env.get('TWILIO_SMS_FROM');

export interface SendSmsResult {
  ok: boolean;
  sid?: string;
  status?: string;
  error?: string;
}

export function isSmsConfigured(): boolean {
  // Need credentials + at least one sender (Messaging Service preferred).
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN &&
    (TWILIO_MESSAGING_SERVICE_SID || TWILIO_SMS_FROM));
}

export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  if (!isSmsConfigured()) {
    return {
      ok: false,
      error: 'Twilio SMS not configured (need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID or TWILIO_SMS_FROM)',
    };
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    // Prefer the Messaging Service (A2P campaign association); fall back to a
    // bare From number only if no Messaging Service SID is configured.
    const sender = TWILIO_MESSAGING_SERVICE_SID
      ? { MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID }
      : { From: TWILIO_SMS_FROM! };
    const form = new URLSearchParams({ ...sender, To: to, Body: body });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Twilio returns { code, message, status, more_info } on error.
      return { ok: false, error: data?.message || `Twilio HTTP ${res.status}`, status: data?.status };
    }
    return { ok: true, sid: data.sid, status: data.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
