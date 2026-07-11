// supabase/functions/sms-status-callback/index.ts
//
// Twilio DELIVERY-STATUS receiver for the $5 scheduled gift texts. Twilio POSTs
// here (application/x-www-form-urlencoded) as each gift SMS progresses
// (queued → sent → delivered, or → undelivered / failed). We match the row in
// scheduled_gift_messages by twilio_sid and reconcile its status so the admin
// (and any monitoring) can see the TRUE outcome — not just "handed to Twilio".
//
// WHY THIS EXISTS: send-scheduled-gift-sms hands in-window gifts to Twilio's
// native scheduled-send and then never touches the row again, so before this
// function those rows read "scheduled" forever with sent_at=NULL even after
// Twilio delivered them — and a carrier-level failure AFTER handoff was
// invisible. This closes that loop. FULLY ISOLATED from the payment path.
//
// TWO MODES (same function):
//   1. Twilio callback  — POST form-urlencoded (MessageSid, MessageStatus, ...).
//                         Reconciles that ONE row. Authenticated by Twilio's
//                         X-Twilio-Signature (gated by TWILIO_VALIDATE_SIGNATURE),
//                         same pattern as twilio-sms-webhook.
//   2. Backfill/reconcile — POST application/json {"backfill": true} with
//                         Authorization: Bearer <SERVICE_ROLE_KEY>. Actively GETs
//                         every still-unresolved gift SID from Twilio's REST API
//                         and reconciles it. Used once to verify historical
//                         messages that predate the callback wiring.
//
// verify_jwt = false (config.toml): Twilio cannot attach a Supabase JWT. The
// backfill mode enforces its own service-role bearer check inside the handler.
//
// Deploy: supabase functions deploy sms-status-callback --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const VALIDATE_SIGNATURE = Deno.env.get('TWILIO_VALIDATE_SIGNATURE') === 'true';
const WEBHOOK_URL_OVERRIDE = Deno.env.get('TWILIO_STATUS_WEBHOOK_URL');

// Map a Twilio MessageStatus onto our row. Returns null for non-terminal,
// non-actionable states (queued/sending/accepted/scheduled) — we leave those.
function mapStatus(twilioStatus: string, errorCode?: string, errorMessage?: string):
  Record<string, unknown> | null {
  const s = (twilioStatus || '').toLowerCase();
  const nowIso = new Date().toISOString();
  if (s === 'delivered') {
    return { status: 'delivered', sent_at: nowIso, error_message: null, updated_at: nowIso };
  }
  if (s === 'sent') {
    // Handed to the carrier; keep as 'sent' unless a later 'delivered' upgrades it.
    return { status: 'sent', sent_at: nowIso, error_message: null, updated_at: nowIso };
  }
  if (s === 'undelivered' || s === 'failed') {
    const detail = [errorCode, errorMessage].filter(Boolean).join(' ').trim();
    return {
      status: 'failed',
      error_message: (`twilio_${s}${detail ? ': ' + detail : ''}`).slice(0, 500),
      updated_at: nowIso,
    };
  }
  if (s === 'canceled') {
    return { status: 'canceled', error_message: 'twilio_canceled', updated_at: nowIso };
  }
  return null;
}

// Never downgrade a confirmed 'delivered' back to 'sent' if callbacks arrive out
// of order. Only apply an update when it moves the row forward.
const RANK: Record<string, number> = {
  scheduled: 0, processing: 0, sent: 1, delivered: 2, failed: 2, canceled: 2,
};
function shouldApply(current: string | null, next: string): boolean {
  const c = RANK[(current || '').toLowerCase()] ?? 0;
  const n = RANK[next.toLowerCase()] ?? 0;
  return n >= c;
}

async function reconcileOne(
  admin: ReturnType<typeof createClient>,
  sid: string,
  twilioStatus: string,
  errorCode?: string,
  errorMessage?: string,
): Promise<'updated' | 'skipped' | 'nomatch' | 'noop'> {
  const patch = mapStatus(twilioStatus, errorCode, errorMessage);
  if (!patch) return 'noop';
  const { data: row } = await admin
    .from('scheduled_gift_messages')
    .select('id, status')
    .eq('twilio_sid', sid)
    .maybeSingle();
  if (!row) return 'nomatch';
  if (!shouldApply(row.status as string, patch.status as string)) return 'skipped';
  await admin.from('scheduled_gift_messages').update(patch).eq('id', row.id);
  return 'updated';
}

// Twilio signature: base64( HMAC-SHA1( authToken, url + sortedConcat(params) ) )
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
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const contentType = req.headers.get('content-type') || '';

  // ── Mode 2: backfill / active reconcile (JSON + service-role bearer) ──
  if (contentType.includes('application/json')) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return json(403, { error: 'forbidden' });
    }
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return json(500, { error: 'twilio_not_configured' });
    }
    let body: { backfill?: boolean } = {};
    try { body = await req.json(); } catch { /* ignore */ }
    if (!body.backfill) return json(400, { error: 'expected {"backfill": true}' });

    // Every gift row that was handed to Twilio but never got a terminal status.
    const { data: rows, error } = await admin
      .from('scheduled_gift_messages')
      .select('id, twilio_sid, status, send_at')
      .not('twilio_sid', 'is', null)
      .in('status', ['scheduled', 'processing', 'sent'])
      .order('send_at', { ascending: true });
    if (error) return json(500, { error: error.message });

    const basic = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const report: Array<Record<string, unknown>> = [];
    for (const r of rows || []) {
      const sid = String(r.twilio_sid);
      try {
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages/${sid}.json`,
          { headers: { Authorization: `Basic ${basic}` } },
        );
        const m = await res.json().catch(() => ({}));
        if (!res.ok) {
          report.push({ sid, ok: false, twilio_http: res.status, error: m?.message || null });
          continue;
        }
        const outcome = await reconcileOne(admin, sid, m.status, m.error_code, m.error_message);
        report.push({
          sid,
          twilio_status: m.status,
          error_code: m.error_code || null,
          db_before: r.status,
          reconcile: outcome,
        });
      } catch (e) {
        report.push({ sid, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json(200, { backfill: true, checked: report.length, report });
  }

  // ── Mode 1: Twilio status callback (form-urlencoded) ──
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);

    const signature = req.headers.get('X-Twilio-Signature') || '';
    const urlForSig = WEBHOOK_URL_OVERRIDE || req.url;
    if (VALIDATE_SIGNATURE) {
      const ok = await isValidTwilioSignature(urlForSig, params, signature);
      if (!ok) {
        console.warn('sms-status-callback: signature validation FAILED', { url: urlForSig });
        return new Response('Forbidden', { status: 403 });
      }
    } else if (signature) {
      const ok = await isValidTwilioSignature(urlForSig, params, signature).catch(() => false);
      console.log('sms-status-callback: signature (not enforced) valid=', ok);
    }

    const sid = params['MessageSid'] || params['SmsSid'] || '';
    const status = params['MessageStatus'] || params['SmsStatus'] || '';
    if (!sid || !status) return new Response('', { status: 204 });

    const outcome = await reconcileOne(
      admin, sid, status, params['ErrorCode'], params['ErrorMessage'],
    );
    console.log('sms-status-callback:', { sid, status, outcome });
    return new Response('', { status: 204 });
  } catch (e) {
    console.error('sms-status-callback error:', e);
    // Ack anyway so Twilio does not retry-storm.
    return new Response('', { status: 204 });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
