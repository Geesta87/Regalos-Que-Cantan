// supabase/functions/unsubscribe/index.ts
//
// Handles email unsubscribe requests from three places:
//   1. POST  /functions/v1/unsubscribe  body: List-Unsubscribe=One-Click
//      — Gmail/Yahoo/Apple Mail one-click (RFC 8058). Body is form-urlencoded.
//      Email + token come from the URL query string. Must respond 200/204
//      within a few seconds or the inbox client falls back to mailto.
//   2. GET   /functions/v1/unsubscribe?email=…&token=…
//      — User clicked the link. Renders a confirmation HTML page.
//   3. POST  /functions/v1/unsubscribe?from=admin  body: { email, reason? }
//      — Admin manually suppressing an address. Service-role JWT required.
//
// Token: HMAC-SHA256(UNSUBSCRIBE_SECRET, lowercased_email), base64url.
// Without the secret, the only path that works is GET-with-no-token, which
// shows a "tell us your email" form and POSTs back via the public unsubscribe
// page. (Not yet wired — the email-client-driven flows above cover the
// dominant case where the user is already authenticated by clicking from
// their own inbox.)
//
// Deploy: supabase functions deploy unsubscribe --project-ref yzbvajungshqcpusfiia
// Requires: UNSUBSCRIBE_SECRET project secret + email_unsubscribes table.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { canonicalEmail, verifyUnsubscribeToken } from '../_shared/unsubscribe.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
  });
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/** Public confirmation page — shown after a successful unsubscribe. */
function successPage(email: string): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Te has dado de baja — Regalos Que Cantan</title></head>
<body style="margin:0;padding:0;background:#1a0e08;font-family:'Helvetica Neue',Arial,sans-serif;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;">
<div style="max-width:480px;padding:48px 32px;text-align:center;">
  <p style="font-size:42px;margin:0 0 16px;">&#9989;</p>
  <h1 style="font-size:26px;font-weight:800;margin:0 0 12px;">Te has dado de baja</h1>
  <p style="color:#c9b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
    No volver&aacute;s a recibir correos promocionales de Regalos Que Cantan en
    <strong style="color:#ffd23f;">${email}</strong>.
  </p>
  <p style="color:#a67c52;font-size:13px;line-height:1.6;margin:0 0 32px;">
    Si compras una canci&oacute;n nueva, te seguiremos enviando los correos de confirmaci&oacute;n del pedido &mdash;
    son necesarios para que recibas el producto que pagaste.
  </p>
  <a href="https://regalosquecantan.com" style="display:inline-block;color:#ff6b35;font-weight:700;font-size:14px;text-decoration:none;border:1px solid #ff6b35;padding:12px 28px;border-radius:50px;">Volver a regalosquecantan.com</a>
  <p style="color:#4a2c1a;font-size:11px;margin:40px 0 0;">&iquest;Te diste de baja por error? <a href="mailto:hola@regalosquecantan.com?subject=Resuscribirme" style="color:#a67c52;">Esc&iacute;benos</a> y te volvemos a agregar.</p>
</div>
</body></html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>No se pudo procesar — Regalos Que Cantan</title></head>
<body style="margin:0;padding:0;background:#1a0e08;font-family:'Helvetica Neue',Arial,sans-serif;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;">
<div style="max-width:480px;padding:48px 32px;text-align:center;">
  <p style="font-size:42px;margin:0 0 16px;">&#9888;&#65039;</p>
  <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;">No pudimos procesar tu solicitud</h1>
  <p style="color:#c9b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">${message}</p>
  <p style="color:#a67c52;font-size:13px;line-height:1.6;margin:0;">Escr&iacute;benos a <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;">hola@regalosquecantan.com</a> y te damos de baja manualmente.</p>
</div>
</body></html>`;
}

async function recordUnsubscribe(
  supabase: any,
  email: string,
  source: string,
  ip: string,
  userAgent: string,
  reason?: string,
): Promise<void> {
  // ON CONFLICT DO NOTHING — repeat unsubscribes are no-ops; we don't want
  // to bump unsubscribed_at on every retry/redelivery. The original
  // timestamp is the authoritative one for compliance audit trails.
  const { error } = await supabase
    .from('email_unsubscribes')
    .upsert(
      { email, source, ip, user_agent: userAgent, reason: reason || null },
      { onConflict: 'email', ignoreDuplicates: true },
    );
  if (error) {
    // Throw — caller turns this into a 5xx so the inbox client retries.
    throw new Error(`db insert failed: ${error.message}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const email = canonicalEmail(url.searchParams.get('email') || '');
  const token = url.searchParams.get('token') || '';
  const fromAdmin = url.searchParams.get('from') === 'admin';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || req.headers.get('cf-connecting-ip')
    || 'unknown';
  const userAgent = (req.headers.get('user-agent') || '').slice(0, 500);

  // ── Admin path: service-role JWT only ──
  if (fromAdmin && req.method === 'POST') {
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) throw new Error('not a JWT');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'service_role') throw new Error('need service_role');
    } catch {
      return jsonResponse({ error: 'service_role JWT required' }, 401);
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const adminEmail = canonicalEmail(String(body?.email || ''));
    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return jsonResponse({ error: 'invalid email' }, 400);
    }
    try {
      await recordUnsubscribe(supabase, adminEmail, 'admin', ip, userAgent, body?.reason);
      console.log('[unsubscribe] admin recorded', { email: adminEmail });
      return jsonResponse({ ok: true, email: adminEmail });
    } catch (e: any) {
      console.error('[unsubscribe] admin insert failed', e?.message || e);
      return jsonResponse({ error: 'database error' }, 500);
    }
  }

  // ── Public paths require a valid token ──
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return htmlResponse(errorPage('El enlace no incluye un correo v&aacute;lido.'), 400);
  }
  const tokenOk = await verifyUnsubscribeToken(email, token);
  if (!tokenOk) {
    console.warn('[unsubscribe] invalid token attempt', { email, ip });
    return htmlResponse(errorPage('Este enlace no es v&aacute;lido o ha expirado.'), 400);
  }

  // ── POST one-click (RFC 8058) — body may be List-Unsubscribe=One-Click ──
  if (req.method === 'POST') {
    try {
      await recordUnsubscribe(supabase, email, 'one-click', ip, userAgent);
      console.log('[unsubscribe] one-click recorded', { email, ip });
      // RFC 8058 expects 200/2xx; body content is ignored by mail clients.
      return new Response('', { status: 200, headers: corsHeaders });
    } catch (e: any) {
      console.error('[unsubscribe] one-click insert failed', e?.message || e);
      return new Response('', { status: 500, headers: corsHeaders });
    }
  }

  // ── GET (user clicked the link) — record + show confirmation page ──
  if (req.method === 'GET') {
    try {
      await recordUnsubscribe(supabase, email, 'web', ip, userAgent);
      console.log('[unsubscribe] web recorded', { email, ip });
      return htmlResponse(successPage(email));
    } catch (e: any) {
      console.error('[unsubscribe] web insert failed', e?.message || e);
      return htmlResponse(errorPage('No pudimos guardar tu solicitud. Vuelve a intentarlo en unos minutos.'), 500);
    }
  }

  return htmlResponse(errorPage('M&eacute;todo no permitido.'), 405);
});
