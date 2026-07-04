// supabase/functions/refresh-email-analytics/index.ts
//
// Email Command Center — the rollup refresher + one-time tracking enabler.
//
//   (cron, no body)            → rebuilds public.email_campaign_daily via the
//                                rebuild_email_campaign_daily() SQL function
//                                (engagement + last-touch revenue attribution).
//                                Reads songs/email_logs read-only; never touches
//                                the payment funnel.
//   POST {"action":"enable_tracking"}
//                              → turns on SendGrid account-level open + click
//                                tracking and makes the Event Webhook forward
//                                engagement events (open/click/delivered/bounce/
//                                unsubscribe/spam) to sendgrid-event-webhook.
//                                Idempotent; run once at go-live.
//
// verify_jwt = false (config.toml) — cron-invoked / server-to-server.
// Deploy: supabase functions deploy refresh-email-analytics --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

async function sg(method: string, path: string, body?: unknown) {
  const r = await fetch(`https://api.sendgrid.com/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

// Flip on open + click tracking account-wide, and make the Event Webhook forward
// engagement events. Merges into the existing webhook config so its url/token
// query stays intact.
async function enableTracking() {
  const results: Record<string, unknown> = {};

  results.open = (await sg('PATCH', '/tracking_settings/open', { enabled: true })).status;
  results.click = (await sg('PATCH', '/tracking_settings/click', { enabled: true })).status;

  const cur = await sg('GET', '/user/webhooks/event/settings');
  if (cur.ok && cur.data && typeof cur.data === 'object') {
    const merged = {
      ...cur.data,
      enabled: true,
      delivered: true,
      open: true,
      click: true,
      bounce: true,
      dropped: true,
      deferred: true,
      spam_report: true,
      unsubscribe: true,
      group_unsubscribe: true,
      group_resubscribe: cur.data.group_resubscribe ?? false,
      processed: cur.data.processed ?? false,
    };
    const patch = await sg('PATCH', '/user/webhooks/event/settings', merged);
    results.event_webhook = { status: patch.status, url: (cur.data as any).url || null };
  } else {
    results.event_webhook = { status: cur.status, note: 'could not read existing webhook settings; enable engagement events in SendGrid UI', data: cur.data };
  }
  return results;
}

serve(async (req) => {
  let action = '';
  if (req.method === 'POST') {
    try { action = (await req.json())?.action || ''; } catch { /* empty = cron rebuild */ }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (action === 'enable_tracking') {
    try {
      const r = await enableTracking();
      await supabase.from('analytics_meta').upsert(
        { key: 'tracking_enabled_at', value: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
      return json(200, { ok: true, action: 'enable_tracking', results: r });
    } catch (e: any) {
      return json(500, { ok: false, error: e?.message || 'enable_tracking failed' });
    }
  }

  // Default: rebuild the rollup.
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('rebuild_email_campaign_daily', {
    p_lookback_days: 220,
    p_window_days: 7,
  });
  if (error) {
    console.error('[refresh-email-analytics] rebuild failed:', error.message);
    return json(500, { ok: false, error: error.message });
  }
  return json(200, { ok: true, rows_built: data, ms: Date.now() - t0 });
});
