// supabase/functions/_shared/send-whatsapp.ts
//
// Shared Twilio WhatsApp sender — the WhatsApp twin of _shared/send-sms.ts.
// Same Account SID + Auth Token + Messages.json endpoint already proven in
// health-check/index.ts (admin alerts), but addressed to a `whatsapp:` sender
// and recipient.
//
// WhatsApp customer-service rule: you may reply FREELY within 24 hours of the
// customer's last inbound message (the "customer care window"). Our bot only
// ever drafts replies TO an incoming message, so replies land inside that
// window. Starting a NEW conversation after 24h needs a pre-approved template —
// out of scope for Phase 1.
//
// Env (Supabase project secrets):
//   TWILIO_ACCOUNT_SID    — reused (already set)
//   TWILIO_AUTH_TOKEN     — reused
//   CS_WHATSAPP_FROM      — PREFERRED: the WhatsApp Business sender dedicated to
//                           customer-service replies, e.g. 'whatsapp:+18183065193'.
//                           Set this so the customer-service line is INDEPENDENT
//                           of the admin-alert sender (health-check uses
//                           TWILIO_WHATSAPP_FROM). If unset, we fall back to
//                           TWILIO_WHATSAPP_FROM so nothing breaks.
//   TWILIO_WHATSAPP_FROM  — FALLBACK: the sender health-check already uses.
//
// Import from any edge function:
//   import { sendWhatsApp, isWhatsAppConfigured } from '../_shared/send-whatsapp.ts';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
// Prefer the dedicated customer-service sender; fall back to the shared one.
const TWILIO_WHATSAPP_FROM =
  Deno.env.get('CS_WHATSAPP_FROM') || Deno.env.get('TWILIO_WHATSAPP_FROM'); // 'whatsapp:+1...'

export interface SendResult {
  ok: boolean;
  sid?: string;
  status?: string;
  error?: string;
  code?: number; // Twilio error code, when present
}

export function isWhatsAppConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);
}

// Ensure a phone is in Twilio's `whatsapp:+E164` form. Accepts a bare E.164
// (+1...), a `whatsapp:`-prefixed value, or digits, and normalizes.
function toWhatsAppAddress(raw: string): string {
  let v = (raw || '').trim();
  if (v.startsWith('whatsapp:')) return v;
  if (!v.startsWith('+')) {
    const d = v.replace(/\D/g, '');
    v = d.length === 10 ? `+1${d}` : `+${d}`;
  }
  return `whatsapp:${v}`;
}

// `mediaUrl` (optional): a publicly-fetchable image URL. When set, the WhatsApp
// message carries the image (works freely inside the 24h customer-care window,
// which is exactly when we reply from the inbox).
export async function sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<SendResult> {
  if (!isWhatsAppConfigured()) {
    return {
      ok: false,
      error: 'Twilio WhatsApp not configured (need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM)',
    };
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const form = new URLSearchParams({
      From: TWILIO_WHATSAPP_FROM!.startsWith('whatsapp:')
        ? TWILIO_WHATSAPP_FROM!
        : `whatsapp:${TWILIO_WHATSAPP_FROM!}`,
      To: toWhatsAppAddress(to),
      Body: body,
    });
    if (mediaUrl) form.append('MediaUrl', mediaUrl);

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
    return { ok: true, sid: data.sid, status: data.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Send an APPROVED WhatsApp template (required for business-initiated messages —
// i.e. anything the customer didn't just message us about). `variables` maps the
// template's {{1}}, {{2}}… to values, e.g. { "1": "María", "2": "corrido" }.
// Returns Twilio's error `code` on failure so callers can distinguish a
// not-a-WhatsApp-user rejection from a transient rate-limit.
export async function sendWhatsAppTemplate(
  to: string,
  contentSid: string,
  variables: Record<string, string>,
): Promise<SendResult> {
  if (!isWhatsAppConfigured()) {
    return { ok: false, error: 'Twilio WhatsApp not configured (need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, CS_WHATSAPP_FROM/TWILIO_WHATSAPP_FROM)' };
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const from = TWILIO_WHATSAPP_FROM!.startsWith('whatsapp:')
      ? TWILIO_WHATSAPP_FROM!
      : `whatsapp:${TWILIO_WHATSAPP_FROM!}`;
    const form = new URLSearchParams({
      From: from,
      To: toWhatsAppAddress(to),
      ContentSid: contentSid,
      ContentVariables: JSON.stringify(variables),
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || `Twilio HTTP ${res.status}`,
        status: data?.status,
        code: typeof data?.code === 'number' ? data.code : undefined,
      };
    }
    return { ok: true, sid: data.sid, status: data.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
