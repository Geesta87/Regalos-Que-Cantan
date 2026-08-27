// supabase/functions/meta-capi-relay/index.ts
//
// Web-only Conversions API relay (Phase B of the Week-0 measurement work).
// The frontend fires every Meta pixel event with a minted eventID, then
// beacons the same event here; we forward it to Meta's Graph API with the
// client IP + user agent so the event survives ad blockers / ITP where the
// browser pixel drops. Meta dedupes browser + server copies by
// (event_name, event_id), so nothing double-counts.
//
// Called via navigator.sendBeacon (no headers possible) → verify_jwt = false,
// pinned in supabase/config.toml per CLAUDE.md §3.2. Because the endpoint is
// unauthenticated, it is deliberately dumb: whitelisted event names, hard size
// caps, no DB access, no secrets echoed, always returns fast.

// sendBeacon sends credentialed requests, and a credentialed CORS exchange
// forbids Access-Control-Allow-Origin '*' — the preflight validates only when
// we echo the caller's origin and allow credentials (observed live 2026-08-27:
// 142 OPTIONS, zero POSTs, until this was fixed). The frontend also posts
// text/plain to avoid preflights entirely; this covers any path that still
// preflights.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

const META_PIXEL_ID = Deno.env.get('META_PIXEL_ID') || '';
const META_CAPI_ACCESS_TOKEN = Deno.env.get('META_CAPI_ACCESS_TOKEN') || '';
const META_TEST_EVENT_CODE = Deno.env.get('META_TEST_EVENT_CODE') || '';

// Standard events the funnel actually fires (tracking.js pixelEventMap) plus
// the FunnelStep custom event. Purchase and InitiateCheckout are NOT relayed —
// stripe-webhook and create-checkout already send those server-side with
// richer match data (hashed email, phone, zip).
const ALLOWED_EVENTS = new Set([
  'PageView',
  'ViewContent',
  'AddToCart',
  'Lead',
  'CompleteRegistration',
  'FunnelStep',
]);

// Keep custom_data primitive and small — drop anything exotic a caller stuffs in.
function sanitizeParams(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 12) break;
    if (typeof k !== 'string' || k.length > 40) continue;
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; n++; }
    else if (typeof v === 'string' && v.length <= 200) { out[k] = v; n++; }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: corsHeaders(req) });
  }
  if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
    // Misconfiguration is server-side; tell the beacon nothing interesting.
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
  }

  let events: any[] = [];
  try {
    const body = await req.json();
    events = Array.isArray(body?.events) ? body.events.slice(0, 10) : [];
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
  }

  const xfwd = req.headers.get('x-forwarded-for') || '';
  const clientIp = xfwd.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || '';
  const clientUa = req.headers.get('user-agent') || '';
  const now = Math.floor(Date.now() / 1000);

  const data: any[] = [];
  for (const ev of events) {
    const name = typeof ev?.name === 'string' ? ev.name : '';
    if (!ALLOWED_EVENTS.has(name)) continue;
    const id = typeof ev?.id === 'string' ? ev.id.slice(0, 100) : '';
    if (!id) continue;
    const url = typeof ev?.url === 'string' ? ev.url.slice(0, 500) : '';
    if (!/^https?:\/\//.test(url)) continue;

    const userData: Record<string, any> = {};
    if (typeof ev?.fbp === 'string' && ev.fbp) userData.fbp = ev.fbp.slice(0, 500);
    if (typeof ev?.fbc === 'string' && ev.fbc) userData.fbc = ev.fbc.slice(0, 500);
    // Meta flags events carrying an IP without a user agent — send together.
    if (clientIp && clientUa) userData.client_ip_address = clientIp;
    if (clientUa) userData.client_user_agent = clientUa.slice(0, 500);
    // An event with no identifiers at all is unmatched noise — skip it.
    if (Object.keys(userData).length === 0) continue;

    data.push({
      event_name: name,
      event_time: now,
      event_id: id,
      action_source: 'website',
      event_source_url: url,
      user_data: userData,
      custom_data: sanitizeParams(ev?.params),
    });
  }

  if (data.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
  }

  const payload: Record<string, any> = { data };
  if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;

  // Forward after responding when the runtime allows it — the beacon caller
  // never waits on Meta. 5s hard timeout, never throws (mirrors the
  // stripe-webhook CAPI contract).
  const send = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      let resp: Response;
      try {
        resp = await fetch(
          `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_CAPI_ACCESS_TOKEN)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ctrl.signal,
          },
        );
      } finally {
        clearTimeout(t);
      }
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error(`[meta-capi] relay non-2xx ${resp.status}: ${errText.slice(0, 400)}`);
        return;
      }
      const json = await resp.json().catch(() => ({}));
      console.log(`[meta-capi] relay sent ${data.length} event(s) [${data.map(d => d.event_name).join(',')}] events_received=${json?.events_received ?? '?'}`);
    } catch (err: any) {
      console.error('[meta-capi] relay threw:', err?.message || err);
    }
  })();

  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(send);
  else await send;

  return new Response(JSON.stringify({ ok: true, sent: data.length }), { status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
});
