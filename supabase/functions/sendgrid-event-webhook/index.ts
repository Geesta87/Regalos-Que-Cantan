// supabase/functions/sendgrid-event-webhook/index.ts
//
// Receives SendGrid's Event Webhook POST (an array of event objects) and
// records genuine opt-out signals into email_unsubscribes so they're honored
// by every marketing sender automatically — no more manual inbox processing.
//
// We record only true "stop emailing me" events:
//   unsubscribe        → SendGrid one-click / list unsubscribe
//   group_unsubscribe  → unsubscribe from an ASM group
//   spamreport         → recipient hit "mark as spam" (an implicit opt-out)
//
// Hard bounces / dropped are deliverability concerns, not opt-outs, so they're
// intentionally NOT written here (keeps the table meaning "people who opted
// out"). Add them later with their own source tag if desired.
//
// Auth: SendGrid can't attach a Supabase JWT, so verify_jwt = false (see
// config.toml). Instead the configured webhook URL carries ?token=<secret>
// and we compare it (constant-ish) against SENDGRID_EVENT_TOKEN.
//
// Deploy: supabase functions deploy sendgrid-event-webhook --project-ref yzbvajungshqcpusfiia
// Requires: SENDGRID_EVENT_TOKEN secret + email_unsubscribes table.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_EVENT_TOKEN = Deno.env.get('SENDGRID_EVENT_TOKEN') || '';

// SendGrid event → email_unsubscribes.source. Only opt-out events are mapped;
// anything not in here is ignored.
const OPT_OUT_EVENTS: Record<string, string> = {
  unsubscribe: 'sendgrid-unsubscribe',
  group_unsubscribe: 'sendgrid-group-unsubscribe',
  spamreport: 'sendgrid-spamreport',
};

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  // Token gate — the webhook URL must include ?token=SENDGRID_EVENT_TOKEN.
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  if (!SENDGRID_EVENT_TOKEN || token !== SENDGRID_EVENT_TOKEN) {
    return new Response('unauthorized', { status: 401 });
  }

  let events: any[] = [];
  try {
    const body = await req.json();
    events = Array.isArray(body) ? body : [body];
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Build one row per opt-out event, de-duped by email (keep first/earliest).
  const rows = new Map<string, { email: string; source: string; reason: string }>();
  for (const ev of events) {
    const source = OPT_OUT_EVENTS[ev?.event];
    if (!source) continue;
    const email = String(ev?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (!rows.has(email)) {
      rows.set(email, { email, source, reason: `sendgrid event: ${ev.event}` });
    }
  }

  if (rows.size === 0) {
    // Nothing to record (e.g. only delivered/open/click events in this batch).
    return new Response(JSON.stringify({ ok: true, recorded: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ON CONFLICT DO NOTHING — the earliest opt-out timestamp stays authoritative.
  const { error } = await supabase
    .from('email_unsubscribes')
    .upsert([...rows.values()], { onConflict: 'email', ignoreDuplicates: true });

  if (error) {
    console.error('[sendgrid-event-webhook] insert failed:', error.message);
    // 5xx so SendGrid retries.
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('[sendgrid-event-webhook] recorded opt-outs:', rows.size);
  return new Response(JSON.stringify({ ok: true, recorded: rows.size }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
