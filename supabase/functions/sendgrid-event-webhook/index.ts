// supabase/functions/sendgrid-event-webhook/index.ts
//
// Receives SendGrid's Event Webhook POST (an array of event objects) and does
// TWO jobs:
//   1. ENGAGEMENT CAPTURE (Email Command Center) — stores every meaningful event
//      (delivered, open, click, bounce, dropped, deferred, spamreport,
//      unsubscribe, group_unsubscribe) into public.email_events, keyed to the
//      campaign via SendGrid `category`. Idempotent on sg_event_id (SendGrid
//      retries). This is the data layer the analytics rollup reads.
//   2. OPT-OUT SUPPRESSION — records genuine "stop emailing me" events
//      (unsubscribe / group_unsubscribe / spamreport) into email_unsubscribes so
//      every marketing sender honors them automatically.
//
// Campaign key: senders tag categories like [emailType, 'rqc'] (and Father's Day
// uses [umbrella, emailType, 'rqc']). We take the LAST non-'rqc' category, which
// resolves to the specific emailType in both shapes — matching how email_logs
// keys campaigns, so engagement lines up with sends.
//
// Auth: SendGrid can't attach a Supabase JWT, so verify_jwt = false (config.toml).
// The webhook URL carries ?token=<SENDGRID_EVENT_TOKEN>.
//
// Deploy: supabase functions deploy sendgrid-event-webhook --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_EVENT_TOKEN = Deno.env.get('SENDGRID_EVENT_TOKEN') || '';

// Events we persist for analytics. 'processed' is intentionally dropped (noise —
// it just means SendGrid accepted the message; 'delivered' is the useful one).
const KEEP_EVENTS = new Set([
  'delivered', 'open', 'click', 'bounce', 'dropped', 'deferred',
  'spamreport', 'unsubscribe', 'group_unsubscribe',
]);

// Opt-out events → email_unsubscribes.source (unchanged behavior).
const OPT_OUT_EVENTS: Record<string, string> = {
  unsubscribe: 'sendgrid-unsubscribe',
  group_unsubscribe: 'sendgrid-group-unsubscribe',
  spamreport: 'sendgrid-spamreport',
};

// Categories that are umbrella/brand tags, never the specific campaign key.
const NON_CAMPAIGN_CATEGORIES = new Set(['rqc']);

function resolveCampaign(cat: unknown): { categories: string[]; campaign_key: string | null } {
  const categories = Array.isArray(cat)
    ? cat.map((c) => String(c))
    : (cat ? [String(cat)] : []);
  const meaningful = categories.filter((c) => c && !NON_CAMPAIGN_CATEGORIES.has(c));
  // Last meaningful category = the specific emailType (see header note).
  const campaign_key = meaningful.length ? meaningful[meaningful.length - 1] : null;
  return { categories, campaign_key };
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

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

  // ── 1) Engagement capture → email_events (idempotent on sg_event_id) ──
  const eventRows: any[] = [];
  for (const ev of events) {
    const type = String(ev?.event || '');
    if (!KEEP_EVENTS.has(type)) continue;
    const { categories, campaign_key } = resolveCampaign(ev?.category);
    const tsSec = Number(ev?.timestamp);
    eventRows.push({
      sg_event_id: ev?.sg_event_id ? String(ev.sg_event_id) : null,
      sg_message_id: ev?.sg_message_id ? String(ev.sg_message_id) : null,
      email: ev?.email ? String(ev.email).trim().toLowerCase() : null,
      event: type,
      campaign_key,
      categories: categories.length ? categories : null,
      url: ev?.url ? String(ev.url).slice(0, 1000) : null,
      ip: ev?.ip ? String(ev.ip) : null,
      user_agent: ev?.useragent ? String(ev.useragent).slice(0, 500) : null,
      reason: ev?.reason ? String(ev.reason).slice(0, 500) : null,
      ts: Number.isFinite(tsSec) ? new Date(tsSec * 1000).toISOString() : null,
      raw: ev,
    });
  }

  let stored = 0;
  if (eventRows.length) {
    // ignoreDuplicates so SendGrid's at-least-once retries don't double-count.
    const { error, count } = await supabase
      .from('email_events')
      .upsert(eventRows, { onConflict: 'sg_event_id', ignoreDuplicates: true, count: 'exact' });
    if (error) {
      console.error('[sendgrid-event-webhook] email_events insert failed:', error.message);
      // 5xx so SendGrid retries the whole batch.
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    stored = count ?? eventRows.length;
  }

  // ── 2) Opt-out suppression → email_unsubscribes (de-duped by email) ──
  const optOuts = new Map<string, { email: string; source: string; reason: string }>();
  for (const ev of events) {
    const source = OPT_OUT_EVENTS[ev?.event];
    if (!source) continue;
    const email = String(ev?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (!optOuts.has(email)) optOuts.set(email, { email, source, reason: `sendgrid event: ${ev.event}` });
  }
  if (optOuts.size) {
    const { error } = await supabase
      .from('email_unsubscribes')
      .upsert([...optOuts.values()], { onConflict: 'email', ignoreDuplicates: true });
    if (error) console.error('[sendgrid-event-webhook] unsubscribe upsert failed:', error.message);
  }

  return new Response(JSON.stringify({ ok: true, events_stored: stored, opt_outs: optOuts.size }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
