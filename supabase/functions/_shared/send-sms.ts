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

// `mediaUrl` (optional): a publicly-fetchable image URL. When set, Twilio sends
// an MMS. NOTE: US A2P 10DLC does not always support MMS — if the campaign/number
// can't do it, Twilio returns an error and the caller records a failed message.
// `statusCallback` (optional): a public URL Twilio POSTs delivery-status updates
// to (sent/delivered/undelivered/failed). Only pass it when you have a receiver
// wired up (e.g. the $5 gift path → sms-status-callback); other callers omit it
// so their sends generate no extra callback traffic.
export async function sendSms(
  to: string,
  body: string,
  mediaUrl?: string,
  statusCallback?: string,
): Promise<SendSmsResult> {
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
    if (mediaUrl) form.append('MediaUrl', mediaUrl);
    if (statusCallback) form.append('StatusCallback', statusCallback);

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

// Actively fetch a message's current status from Twilio's REST API by SID.
// Used to reconcile rows Twilio already finished (e.g. gifts handed to native
// scheduled-send before any StatusCallback was wired) where no callback will
// ever arrive. Returns { ok, status, errorCode?, error? }.
export interface SmsStatusResult {
  ok: boolean;
  status?: string;
  errorCode?: string | number | null;
  error?: string;
}
export async function fetchSmsStatus(sid: string): Promise<SmsStatusResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { ok: false, error: 'twilio_not_configured' };
  }
  try {
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages/${sid}.json`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.message || `Twilio HTTP ${res.status}` };
    return { ok: true, status: data.status, errorCode: data.error_code ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Twilio NATIVE scheduled send — Twilio itself delivers the message at sendAtIso
// (exact-second), so we don't depend on cron timing for in-window gifts. Twilio
// only supports scheduling through a Messaging Service (MG...) with
// ScheduleType=fixed, and SendAt must be ~15 min to ~7 days in the future (Twilio
// rejects anything outside that window). The caller (send-scheduled-gift-sms)
// handles the out-of-window cases by sending immediately when the gift comes due.
//
// sendAtIso: ISO-8601 UTC instant, e.g. new Date(sendAt).toISOString().
// statusCallback (optional): public URL Twilio POSTs delivery-status updates to.
export async function scheduleSms(
  to: string,
  body: string,
  sendAtIso: string,
  statusCallback?: string,
): Promise<SendSmsResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_MESSAGING_SERVICE_SID) {
    return {
      ok: false,
      error: 'Twilio scheduled send requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID (a bare From number cannot schedule)',
    };
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const form = new URLSearchParams({
      MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
      To: to,
      Body: body,
      ScheduleType: 'fixed',
      SendAt: sendAtIso,
    });
    if (statusCallback) form.append('StatusCallback', statusCallback);

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
      return { ok: false, error: data?.message || `Twilio HTTP ${res.status}`, status: data?.status };
    }
    // Twilio returns status 'scheduled' for accepted scheduled messages.
    return { ok: true, sid: data.sid, status: data.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
