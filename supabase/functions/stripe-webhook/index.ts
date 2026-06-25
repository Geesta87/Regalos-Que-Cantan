// supabase/functions/stripe-webhook/index.ts
// Deploy with: supabase functions deploy stripe-webhook

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders } from '../_shared/unsubscribe.ts';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';
import { buildEmailParts } from '../_shared/email.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// SendGrid API for sending emails
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

// Meta Conversions API — server-side fallback for the browser pixel.
// Both pixel + token must be set for CAPI to fire. If either is missing
// the helper logs and skips, so this whole block is a no-op in
// environments that haven't been configured yet (safe to deploy without
// secrets). Token name accepts any of three historical conventions —
// whichever the project has set first wins.
const META_PIXEL_ID = Deno.env.get('META_PIXEL_ID') || '';
const META_CAPI_ACCESS_TOKEN =
  Deno.env.get('META_CAPI_ACCESS_TOKEN') ||
  Deno.env.get('META_ACCESS_TOKEN') ||
  Deno.env.get('META_CONVERSIONS_API_TOKEN') ||
  '';
const META_TEST_EVENT_CODE = Deno.env.get('META_TEST_EVENT_CODE') || '';

// SHA-256 lowercase-trim hash for Meta user_data fields. Meta rejects
// PII in cleartext — every match field except fbc/fbp/IP/UA must be hashed.
async function metaHash(value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Fire a server-side Purchase event to Meta CAPI. NEVER throws — every
// failure mode is caught and logged so the webhook still returns 200 to
// Stripe. Dedup with the browser pixel via event_id = stripe session.id
// (matches eventID passed in SuccessPage.jsx fbq('track','Purchase',...)).
async function sendMetaCAPIPurchase(args: {
  sessionId: string;
  email: string | null | undefined;
  amountUsd: number | null;
  songIds: string[];
  fbc: string;
  fbp: string;
  clientIp: string;
  clientUserAgent: string;
  recipientName?: string | null;
}): Promise<void> {
  if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
    console.log('[meta-capi] skipped — META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not set');
    return;
  }
  try {
    const userData: Record<string, any> = {};
    if (args.email) userData.em = [await metaHash(args.email)];
    if (args.fbc) userData.fbc = args.fbc;
    if (args.fbp) userData.fbp = args.fbp;
    if (args.clientIp) userData.client_ip_address = args.clientIp;
    if (args.clientUserAgent) userData.client_user_agent = args.clientUserAgent;

    const payload: Record<string, any> = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: args.sessionId, // dedup key with browser pixel
        action_source: 'website',
        event_source_url: 'https://regalosquecantan.com/success',
        user_data: userData,
        custom_data: {
          currency: 'USD',
          value: args.amountUsd ?? 0,
          content_type: 'product',
          content_ids: args.songIds,
          num_items: args.songIds.length,
          content_name: args.recipientName
            ? `Canción para ${args.recipientName}`
            : 'Canción personalizada'
        }
      }]
    };
    if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;

    // 5s hard timeout — a hung Meta endpoint must NEVER block the webhook.
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
          signal: ctrl.signal
        }
      );
    } finally {
      clearTimeout(t);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[meta-capi] non-2xx ${resp.status} for session ${args.sessionId}: ${errText.slice(0, 500)}`);
      return;
    }
    const json = await resp.json().catch(() => ({}));
    console.log(`[meta-capi] Purchase sent — session=${args.sessionId} value=${args.amountUsd} events_received=${json?.events_received ?? '?'} fbtrace=${json?.fbtrace_id ?? '?'}`);
  } catch (err: any) {
    console.error(`[meta-capi] threw for session ${args.sessionId}:`, err?.message || err);
  }
}

// Helper function to send emails via SendGrid (with tracking + deliverability).
// Uses _shared/email.ts to inject a hidden preheader and a text/plain alternative.
async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string,
  category: string = 'transactional',
  preheader: string = '',
) {
  if (!SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set, skipping email');
    return null;
  }

  const { html: finalHtml, text: finalText } = buildEmailParts(htmlContent, preheader);

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SENDGRID_API_KEY}`
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject: subject,
      // text/plain MUST come before text/html (RFC 2046 multipart/alternative).
      content: [
        { type: 'text/plain', value: finalText },
        { type: 'text/html', value: finalHtml },
      ],
      categories: [category, 'rqc'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false }
      },
      headers: await buildUnsubscribeHeaders(to)
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('SendGrid error:', response.status, errorText);
    throw new Error(`SendGrid error: ${response.status}`);
  }

  console.log('Email sent successfully to:', to, '| category:', category);
  return response;
}

// ── 3-song pack ("Paquete de 3 canciones") ─────────────────────────────────
// Mint a memorable, unique code: BUYERFIRSTNAME-### — accent-stripped, A–Z
// only, with a 3-digit number. Retries on collision against the coupons table.
async function mintPackCode(supabase: any, rawName: string): Promise<string> {
  const first = (rawName || '').trim().split(/\s+/)[0] || '';
  const base = first
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (José → Jose)
    .toUpperCase().replace(/[^A-Z]/g, '')             // letters only
    .slice(0, 12) || 'AMIGO';
  for (let i = 0; i < 12; i++) {
    const num = Math.floor(100 + Math.random() * 900); // 100–999
    const candidate = `${base}-${num}`;
    const { data: clash } = await supabase.from('coupons').select('code').eq('code', candidate).maybeSingle();
    if (!clash) return candidate;
  }
  // Extremely unlikely fallback — guarantee uniqueness with a time suffix.
  return `${base}-${Date.now().toString().slice(-6)}`;
}

function getPack3EmailHtml(code: string, rawName: string): string {
  const firstName = (rawName || '').trim().split(/\s+/)[0] || 'Amigo';
  const createUrl = 'https://regalosquecantan.com/create/genre';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background:#181114; color:#ffffff; border-radius:16px; overflow:hidden;">
      <div style="background:linear-gradient(135deg,#f20d80,#a5085a); padding:28px 24px; text-align:center;">
        <h1 style="margin:0; font-size:22px; color:#fff;">¡Gracias por tu compra, ${firstName}! 🎵</h1>
        <p style="margin:8px 0 0; color:#ffd9ec; font-size:14px;">Tu Paquete de 3 Canciones está listo</p>
      </div>
      <div style="padding:28px 24px;">
        <p style="font-size:15px; color:#e7e2e5; line-height:1.6; margin:0 0 18px;">
          Este es tu código personal. Sirve para crear <strong>3 canciones personalizadas</strong> —
          una para cada persona que quieras sorprender, cuando tú quieras.
        </p>
        <div style="text-align:center; background:rgba(242,13,128,0.12); border:2px dashed #f20d80; border-radius:14px; padding:20px; margin:0 0 18px;">
          <p style="margin:0 0 6px; font-size:12px; letter-spacing:1px; color:#f9a8d4; font-weight:bold;">TU CÓDIGO</p>
          <p style="margin:0; font-size:30px; font-weight:800; color:#fff; letter-spacing:2px;">${code}</p>
          <p style="margin:10px 0 0; font-size:13px; color:#bdb6ba;">Válido para 3 canciones · 12 meses</p>
        </div>
        <p style="font-size:14px; color:#e7e2e5; line-height:1.6; margin:0 0 10px;"><strong>Cómo usarlo:</strong></p>
        <ol style="font-size:14px; color:#cfc8cc; line-height:1.7; margin:0 0 22px; padding-left:20px;">
          <li>Crea tu canción en regalosquecantan.com (elige el género, el nombre y la historia).</li>
          <li>Al momento de pagar, escribe tu código <strong>${code}</strong>.</li>
          <li>Esa canción te sale gratis. Repite hasta 3 veces — una por persona.</li>
        </ol>
        <div style="text-align:center;">
          <a href="${createUrl}" style="display:inline-block; background:#f20d80; color:#fff; text-decoration:none; font-weight:bold; font-size:16px; padding:14px 30px; border-radius:10px;">Crear mi primera canción 🎵</a>
        </div>
        <p style="font-size:12px; color:#8a838a; line-height:1.5; margin:22px 0 0; text-align:center;">
          Guarda este correo para no perder tu código. ¿Dudas? Escríbenos a hola@regalosquecantan.com
        </p>
      </div>
    </div>`;
}

// ─── Affiliate attribution helpers ───────────────────────────────────────
// These run at the moment a song flips to paid. They are intentionally
// idempotent against webhook retries: Stripe will redeliver checkout.session
// .completed if our handler ever returns non-2xx, and verify-payment can
// also reach us in parallel from the success page.
//
// Idempotency model: there is exactly one `purchase` event per song. We
// SELECT-then-INSERT under that invariant. Coupon usage is incremented only
// when the INSERT actually creates a new row, so a redelivery is a no-op.

async function recordAffiliatePurchase(
  supabase: any,
  song: { id: string; affiliate_code: string | null; coupon_code: string | null; amount_paid: number | string | null },
  fallbackAffiliateCode: string | null
): Promise<void> {
  const affiliateCode = (song.affiliate_code || fallbackAffiliateCode || '').toString().toLowerCase().trim();
  if (!affiliateCode) {
    return; // not an affiliate-attributed sale
  }

  // Verify the affiliate exists & is active. Guards against stale codes
  // surviving on a song row after the affiliate was deactivated.
  const { data: validAffiliate } = await supabase
    .from('affiliates')
    .select('code')
    .eq('code', affiliateCode)
    .eq('active', true)
    .maybeSingle();
  if (!validAffiliate) {
    console.warn(`[affiliate] purchase event skipped — code ${affiliateCode} is not an active affiliate`);
    return;
  }

  // Idempotency check (one purchase event per song)
  const { data: existing } = await supabase
    .from('affiliate_events')
    .select('id')
    .eq('song_id', song.id)
    .eq('event_type', 'purchase')
    .maybeSingle();
  if (existing) {
    return;
  }

  const amount = parseFloat(String(song.amount_paid ?? '0')) || 0;
  const { error: insertErr } = await supabase
    .from('affiliate_events')
    .insert({
      affiliate_code: affiliateCode,
      event_type: 'purchase',
      song_id: song.id,
      amount,
    });
  if (insertErr) {
    console.error(`[affiliate] failed to insert purchase event for song ${song.id}:`, insertErr.message);
    return;
  }
  console.log(`[affiliate] purchase event recorded — code=${affiliateCode} song=${song.id} amount=${amount}`);

  // Bump coupon usage once per recorded purchase. The caller invokes this
  // exactly once per order (see affiliatePurchaseLogged), so a 2-pack bumps
  // the coupon a single time. Safe even if multiple webhooks race — the
  // SELECT above gates this whole branch behind a successful INSERT.
  if (song.coupon_code) {
    const { data: coupon } = await supabase
      .from('coupons')
      .select('times_used')
      .eq('code', song.coupon_code)
      .maybeSingle();
    if (coupon) {
      await supabase
        .from('coupons')
        .update({ times_used: (coupon.times_used || 0) + 1 })
        .eq('code', song.coupon_code);
    }
  }
}

// Email template for checkout abandonment recovery
function getAbandonedCheckoutEmailHtml(song: any, listenUrl: string) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const recipientName = song.recipient_name || 'tu ser querido';
  const songTitle = song.song_title || `Canción para ${recipientName}`;
  const genre = song.genre || 'Musical';
  const occasion = song.occasion || 'Especial';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Righteous&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;padding:0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;">

        <!-- Hero Section -->
        <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:50px 30px 30px;text-align:center;">
          <p style="color:#ff6b35;font-size:42px;margin:0 0 16px;">&#127925;</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 8px;font-weight:400;">${firstName}, tu canci&oacute;n</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:28px;margin:0 0 20px;font-weight:400;">para <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">${recipientName}</span> te espera</h2>
          <p style="color:#c9b99a;font-size:15px;margin:0;line-height:1.7;">Notamos que no completaste tu compra.<br>Tu canci&oacute;n personalizada sigue lista para ti.</p>
        </td></tr>

        <!-- Song Card -->
        <tr><td style="background-color:#1a0e08;padding:20px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;">
            <tr>
              <td width="100" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
                <div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
                <p style="color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">LISTA</p>
              </td>
              <td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:18px 20px;vertical-align:middle;">
                <p style="color:#ff6b35;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 4px;">TU CANCI&Oacute;N PERSONALIZADA</p>
                <p style="color:#ffffff;font-size:15px;font-weight:700;margin:0 0 6px;font-family:'Righteous',cursive;">${songTitle}</p>
                <p style="color:#a67c52;font-size:12px;margin:0;">Para <strong style="color:#ffd23f;">${recipientName}</strong><br>
                <span style="text-transform:capitalize;">${genre}</span> &middot; <span style="text-transform:capitalize;">${occasion}</span></p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Listen CTA -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 10px;text-align:center;">
          <a href="${listenUrl}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#127911; Escuchar y Completar Compra
          </a>
        </td></tr>

        <!-- Discount Section -->
        <tr><td style="background-color:#1a0e08;padding:20px 30px;text-align:center;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed #ff6b35;border-radius:16px;overflow:hidden;">
            <tr><td style="background:rgba(255,107,53,0.08);padding:24px 20px;text-align:center;">
              <p style="color:#ffd23f;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">&#127873; REGALO EXCLUSIVO PARA TI</p>
              <p style="font-family:'Righteous',cursive;color:#ff6b35;font-size:36px;margin:0 0 4px;font-weight:400;">10% OFF</p>
              <p style="color:#c9b99a;font-size:14px;margin:0 0 12px;">Usa este c&oacute;digo al momento de pagar:</p>
              <div style="display:inline-block;background:#2a1408;border:1px solid #ff6b35;border-radius:8px;padding:10px 24px;">
                <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:4px;font-family:monospace;">VUELVE10</span>
              </div>
              <p style="color:#a67c52;font-size:12px;margin:12px 0 0;">V&aacute;lido por 24 horas &middot; Solo para esta canci&oacute;n</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Urgency -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 20px;text-align:center;">
          <p style="color:#c9b99a;font-size:14px;margin:0;line-height:1.6;">
            &#9200; Las canciones se guardan por <strong style="color:#ffd23f;">tiempo limitado</strong>.<br>
            No dejes pasar esta sorpresa &uacute;nica.
          </p>
        </td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Footer -->
        <tr><td style="background-color:#1a0e08;padding:30px;text-align:center;">
          <p style="color:#a67c52;font-size:12px;margin:0 0 10px;">&iquest;Preguntas? Escr&iacute;benos a<br>
            <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a>
          </p>
          <p style="color:#4a2c1a;font-size:11px;margin:0;">&copy; 2025 Regalos Que Cantan. Hecho con &#10084;&#65039; para ti.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Email template for purchase confirmation (dark gradient design).
// Pass the full list of paid song IDs so 2-song bundle buyers get ONE link
// covering all of them — the listen page resolves comma-joined ids.
function getPurchaseEmailHtml(song: any, songIds: string[] = [song.id]) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const recipientName = song.recipient_name || 'tu ser querido';
  const songTitle = song.song_title || `Canci\u00f3n para ${song.recipient_name || 'ti'}`;
  const senderName = song.sender_name || 'An\u00f3nimo';
  const genre = song.genre || 'Musical';
  const occasion = song.occasion || 'Especial';
  // Use durable /listen page link, NOT the raw audio_url (which can change as audio
  // moves from Mureka CDN → Supabase Storage). The page handles all URL states.
  // Listen page deep-link. Bundle buyers (2+ songs) get `song_ids=id1,id2`
  // so a single link covers every paid song under one combo player.
  const isCombo = songIds.length > 1;
  const songCount = songIds.length;
  const listenParam = isCombo
    ? `song_ids=${songIds.join(',')}`
    : `song_id=${song.id}`;
  const listenUrl = `https://regalosquecantan.com/listen?${listenParam}&utm_source=email&utm_medium=transactional&utm_campaign=purchase_confirmation`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Righteous&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;padding:0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;">

        <!-- Dark Hero Section -->
        <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:50px 30px 40px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px;">&#127881; COMPRA CONFIRMADA${isCombo ? ` &middot; ${songCount} CANCIONES` : ''}</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:36px;margin:0 0 4px;font-weight:400;">Oye, ${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 24px;font-weight:400;">${isCombo ? `Tus <strong style="color:#ffd23f;">${songCount} canciones</strong> ya son` : 'Tu canci&oacute;n ya es'} <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">${isCombo ? 'tuyas.' : 'tuya.'}</span></h2>
          <p style="color:#c9b99a;font-size:16px;margin:0;line-height:1.7;">${isCombo
            ? `Letra, melod&iacute;a y emoci&oacute;n en <strong style="color:#ffd23f;">${songCount} versiones &uacute;nicas</strong> &mdash;<br>todas listas para llegar al coraz&oacute;n de <strong style="color:#ffd23f;">${recipientName}</strong>.`
            : `Letra, melod&iacute;a y emoci&oacute;n &mdash; todo listo para<br>que llegue al coraz&oacute;n de <strong style="color:#ffd23f;">${recipientName}</strong>.`}</p>
        </td></tr>

        <!-- Download CTA Button -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <a href="${listenUrl}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#127911; ${isCombo ? `Escuchar mis ${songCount} canciones` : 'Escuchar y Descargar'}
          </a>
        </td></tr>
${isCombo ? `
        <!-- Combo callout — flagged so 2-song bundle buyers don't think they only got one song -->
        <tr><td style="background-color:#1a0e08;padding:0 30px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,rgba(255,107,53,0.12) 0%,rgba(255,46,136,0.12) 100%);border:1.5px solid rgba(255,107,53,0.4);border-radius:16px;">
            <tr><td style="padding:18px 22px;text-align:center;">
              <p style="color:#ffd23f;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px;">&#127911;&#127911; PAQUETE DE ${songCount} CANCIONES</p>
              <p style="color:#ffffff;font-size:14px;font-weight:600;margin:0;line-height:1.5;">El bot&oacute;n de arriba abre <strong style="color:#ff8c42;">tus ${songCount} canciones</strong> en una sola p&aacute;gina.<br><span style="color:#c9b99a;font-weight:400;font-size:13px;">Usa los botones &laquo;Canci&oacute;n 1&raquo; / &laquo;Canci&oacute;n 2&raquo; arriba del reproductor para alternar entre ellas.</span></p>
            </td></tr>
          </table>
        </td></tr>
` : ''}
        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#a67c52;font-size:13px;margin:0;">&#128274; Este enlace no expira &middot; ${isCombo ? `Las ${songCount} canciones est&aacute;n incluidas` : 'Escucha y descarga cuando quieras'}</p>
        </td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Song Preview Section -->
        <tr><td style="background-color:#1a0e08;padding:40px 30px 10px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">&#127911; ${isCombo ? `TUS ${songCount} CANCIONES COMPRADAS` : 'TU CANCI&Oacute;N COMPRADA'}</p>
          <h3 style="font-family:'Righteous',cursive;color:#ffffff;font-size:24px;margin:0 0 24px;font-weight:400;">${isCombo ? `${songCount} canciones, un solo enlace` : 'Este regalo tiene voz propia'}</h3>
        </td></tr>

        <!-- Song Card -->
        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;">
            <tr>
              <!-- Play Button Column -->
              <td width="120" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
                <div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
                <p style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">${isCombo ? `${songCount} CANCIONES` : 'COMPRADA'}</p>
              </td>
              <!-- Song Info Column -->
              <td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:20px 24px;vertical-align:middle;">
                <p style="color:#ff6b35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">${isCombo ? `TUS ${songCount} CANCIONES PERSONALIZADAS` : 'TU CANCI&Oacute;N PERSONALIZADA'}</p>
                <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">${songTitle}</p>
                <p style="color:#a67c52;font-size:13px;margin:0 0 12px;">Para <strong style="color:#ffd23f;">${recipientName}</strong> &middot; De: ${senderName}<br>Estilo: <span style="text-transform:capitalize;">${genre}</span> &middot; Ocasi&oacute;n: <span style="text-transform:capitalize;">${occasion}</span>${isCombo ? `<br><strong style="color:#ffd23f;">${songCount} versiones &uacute;nicas en el mismo enlace</strong>` : ''}</p>
                <!-- Mini Waveform -->
                <span style="display:inline-block;width:4px;height:14px;background:#ff6b35;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:22px;background:#ff8c42;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:10px;background:#ffd23f;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:26px;background:#ff6b35;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:16px;background:#ff2e88;border-radius:2px;margin:0 1px;"></span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Share Section -->
        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#c9b99a;font-size:15px;margin:0;">&iquest;Te gust&oacute;? Sorprende a m&aacute;s personas en <a href="https://regalosquecantan.com" style="color:#ff6b35;font-weight:700;">regalosquecantan.com</a></p>
        </td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Footer -->
        <tr><td style="background-color:#1a0e08;padding:30px;text-align:center;">
          <p style="color:#a67c52;font-size:12px;margin:0 0 10px;">&iquest;Preguntas? Escr&iacute;benos a<br>
            <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a>
          </p>
          <p style="color:#4a2c1a;font-size:11px;margin:0;">&copy; 2025 Regalos Que Cantan. Hecho con &#10084;&#65039; para ti.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  
  if (!signature) {
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    
    // Verify webhook signature.
    // IMPORTANT: must use constructEventAsync in Deno — constructEvent uses
    // Node's sync crypto which is not available in the Edge Functions runtime
    // and throws "use constructEventAsync()" → 400 on every webhook.
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    console.log('Webhook event:', event.type);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ========== HANDLE SUCCESSFUL PAYMENT ==========
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      // ─────────────────────────────────────────────────────────────────────
      // VIDEO UPSELL ($9.99) — a post-purchase add-on bought from the success
      // page. create-video-checkout tags it with metadata.type='video_upsell'.
      // It MUST be handled as a video order (mark the video paid + enable the
      // photo upload), NOT as a song payment. Without this branch it falls
      // through to the song path below, which overwrites the song's amount_paid
      // (e.g. $29.99 → $9.99) and never enables the video. (Don Lucas, 2026-06-21.)
      // ─────────────────────────────────────────────────────────────────────
      if (session.metadata?.type === 'video_upsell') {
        const vSongId = session.metadata?.songId;
        if (!vSongId) {
          console.error('[video_upsell] no songId in metadata for session', session.id);
          return new Response(JSON.stringify({ received: true, status: 'video_upsell_no_song' }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
        }
        try {
          // Idempotent: only create a paid video order if one doesn't exist yet
          // (guards against Stripe webhook retries and the success-page auto-create).
          const { data: existingVo } = await supabase
            .from('video_orders')
            .select('id')
            .eq('song_id', vSongId)
            .eq('paid', true)
            .maybeSingle();
          if (!existingVo) {
            await supabase.from('video_orders').insert({
              song_id: vSongId,
              paid: true,
              paid_at: new Date().toISOString(),
              amount_cents: session.amount_total ?? 999,
              status: 'pending',
              stripe_session_id: session.id,
            });
          }
          // Flag the song so the upload UI appears — but DO NOT touch the song's
          // own payment fields (amount_paid / paid / paid_at / stripe_session_id).
          await supabase.from('songs').update({ has_video_addon: true, video_addon_count: 1 }).eq('id', vSongId);
          console.log(`✅ [video_upsell] registered paid video order for song ${vSongId} (session ${session.id})`);
        } catch (e: any) {
          console.error('[video_upsell] failed to register video order:', e?.message || e);
        }
        return new Response(JSON.stringify({ received: true, status: 'video_upsell_processed' }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
      }

      // ─────────────────────────────────────────────────────────────────────
      // GIFT SMS ($5) — "send this song as a scheduled surprise text" add-on
      // bought from the success page. create-gift-checkout tags it with
      // metadata.type='gift_sms' and a gift_id pointing at the already-created
      // (moderation-passed) scheduled_gift_messages row. Payment is what flips
      // that row from 'awaiting_payment' to 'scheduled'; the every-minute
      // send-scheduled-gift-sms cron does the actual Twilio scheduling/sending.
      // We deliberately do NOT touch Twilio here — the payment path stays
      // isolated (mirrors send-song-ready-sms). Like video_upsell, this MUST
      // return early so it isn't treated as a song payment (which would
      // overwrite the song's amount_paid).
      // ─────────────────────────────────────────────────────────────────────
      if (session.metadata?.type === 'gift_sms') {
        const giftId = session.metadata?.gift_id;
        if (giftId) {
          try {
            // Idempotent: only promote a still-unpaid draft (guards webhook retries).
            await supabase
              .from('scheduled_gift_messages')
              .update({
                status: 'scheduled',
                stripe_session_id: session.id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', giftId)
              .eq('status', 'awaiting_payment');
            console.log(`✅ [gift_sms] scheduled gift ${giftId} (session ${session.id})`);
          } catch (e: any) {
            console.error('[gift_sms] failed to promote gift to scheduled:', e?.message || e);
          }
        } else {
          console.error('[gift_sms] no gift_id in metadata for session', session.id);
        }
        return new Response(JSON.stringify({ received: true, status: 'gift_sms_scheduled' }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
      }

      // ─────────────────────────────────────────────────────────────────────
      // 3-SONG PACK ($49.99) — "Paquete de 3 canciones" bought from the store.
      // create-checkout tags it metadata.type='pack3' (no songId). On payment
      // we mint a personal NOMBRE-### coupon worth 3 free single-song
      // redemptions (12-mo expiry) and email it. Idempotent on session.id so a
      // retried webhook never mints a second code. MUST return early so it is
      // not treated as a song payment.
      // ─────────────────────────────────────────────────────────────────────
      if (session.metadata?.type === 'pack3') {
        const packEmail = (session.metadata?.email || session.customer_email || '').trim().toLowerCase();
        const packName = (session.metadata?.buyer_name || session.customer_details?.name || '').trim();
        try {
          // Idempotent: reuse the code if this session already minted one.
          const { data: existing } = await supabase
            .from('coupons')
            .select('code')
            .eq('stripe_session_id', session.id)
            .maybeSingle();
          let code = existing?.code || null;
          if (!code) {
            code = await mintPackCode(supabase, packName);
            const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
            await supabase.from('coupons').insert({
              code,
              active: true,
              type: 'free',
              discount: 100,
              max_uses: 3,
              times_used: 0,
              expires_at: expiresAt,
              single_song_only: true,
              buyer_email: packEmail || null,
              stripe_session_id: session.id,
            });
          }
          if (packEmail) {
            await sendEmail(
              packEmail,
              'Tu código de 3 canciones — RegalosQueCantan 🎵',
              getPack3EmailHtml(code, packName),
              'pack3_purchase',
              `Tu código ${code} sirve para crear 3 canciones personalizadas.`,
            );
          }
          console.log(`✅ [pack3] minted ${code} for ${packEmail || '(no email)'} (session ${session.id})`);
        } catch (e: any) {
          console.error('[pack3] failed to mint/email code:', e?.message || e);
        }
        return new Response(JSON.stringify({ received: true, status: 'pack3_processed' }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
      }

      const songIdMeta = session.metadata?.songId;
      const email = session.metadata?.email || session.customer_email;

      if (!songIdMeta) {
        throw new Error('No songId in metadata');
      }

      // Support comma-separated song IDs for bundle purchases
      const songIds = songIdMeta.split(',').map((id: string) => id.trim()).filter(Boolean);

      // ✅ IDEMPOTENCY CHECK: if song already paid AND email already sent, skip.
      // If song already paid but email NOT sent (e.g. verify-payment marked it
      // paid first but its SendGrid call failed), fall through and send now.
      const { data: existingPaid } = await supabase
        .from('songs')
        .select('*')
        .eq('id', songIds[0])
        .single();

      if (existingPaid?.paid && existingPaid?.stripe_session_id === session.id) {
        // Self-heal affiliate attribution if a previous run (verify-payment
        // or an earlier deploy) marked the song paid without recording the
        // purchase event. recordAffiliatePurchase is idempotent — no-op if
        // the event already exists.
        try {
          await recordAffiliatePurchase(supabase, existingPaid, session.metadata?.affiliateCode || null);
        } catch (affErr: any) {
          console.error(`[affiliate] self-heal failed for already-paid song ${existingPaid.id}:`, affErr?.message || affErr);
        }

        const { data: emailEvent } = await supabase
          .from('funnel_events')
          .select('id')
          .eq('step', 'purchase_email_sent')
          .contains('metadata', { stripe_session_id: session.id })
          .maybeSingle();

        if (emailEvent) {
          console.log('⏭️ Already processed (paid + email sent):', session.id);
          return new Response(JSON.stringify({ received: true, status: 'already_processed' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
          });
        }

        // Paid but email not sent — recover by sending email now and returning.
        console.log('🟡 Already paid but no purchase_email_sent — sending email now for session:', session.id);
        const recoveryEmail = session.metadata?.email || session.customer_email || existingPaid.email;
        if (recoveryEmail) {
          let emailOk = false;
          let emailErr: string | null = null;
          try {
            const subject = songIds.length > 1
              ? `🎵 Tus ${songIds.length} canciones para ${existingPaid.recipient_name} están listas!`
              : `🎵 Tu canción para ${existingPaid.recipient_name} está lista!`;
            const preheader = songIds.length > 1
              ? `Tus ${songIds.length} canciones para ${existingPaid.recipient_name} en un solo enlace. El enlace nunca expira — guarda este correo.`
              : `Escucha y descarga tu canción para ${existingPaid.recipient_name}. El enlace nunca expira — guarda este correo.`;
            await sendEmail(
              recoveryEmail,
              subject,
              getPurchaseEmailHtml(existingPaid, songIds),
              'purchase_confirmation',
              preheader,
            );
            emailOk = true;
            console.log('📧 Purchase email sent (recovery) to:', recoveryEmail, 'song:', existingPaid.id);
          } catch (emailError: any) {
            emailErr = emailError?.message || String(emailError);
            console.error('🔴 Failed to send recovery purchase email:', emailErr);
          }
          try {
            await supabase.from('funnel_events').insert([{
              session_id: session.id,
              step: emailOk ? 'purchase_email_sent' : 'purchase_email_failed',
              metadata: {
                stripe_session_id: session.id,
                song_ids: songIds,
                email: recoveryEmail,
                error: emailErr,
                attempted_at: new Date().toISOString(),
                source: 'stripe-webhook-recovery',
              },
            }]);
          } catch (logErr) {
            console.error('Failed to log recovery purchase email status:', logErr);
          }
        } else {
          console.warn('🟡 Already-paid recovery: no email available for song', existingPaid.id);
        }
        return new Response(JSON.stringify({ received: true, status: 'paid_email_recovered' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });
      }

      console.log('Processing payment for songs:', songIds);

      // Extract amount and UTM attribution from Stripe session
      const amountPaid = session.amount_total ? (session.amount_total / 100) : null;
      const metaUtmSource = session.metadata?.utm_source || null;
      const metaUtmMedium = session.metadata?.utm_medium || null;
      const metaUtmCampaign = session.metadata?.utm_campaign || null;
      const metaFromEmail = session.metadata?.from_email_campaign || null;

      const baseUpdateData: Record<string, any> = {
        paid: true,
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_session_id: session.id,
        amount_paid: amountPaid
      };
      // Only overwrite UTMs if they exist in metadata (don't null out existing values)
      if (metaUtmSource) baseUpdateData.utm_source = metaUtmSource;
      if (metaUtmMedium) baseUpdateData.utm_medium = metaUtmMedium;
      if (metaUtmCampaign) baseUpdateData.utm_campaign = metaUtmCampaign;
      if (metaFromEmail) baseUpdateData.from_email_campaign = metaFromEmail;

      // ─── Capture the saved card for one-tap post-purchase upsells ───────────
      // create-checkout now saves the PaymentMethod off-session. Store the Stripe
      // customer + payment method on the song so charge-upsell can charge it with
      // a single tap (no second checkout). Wrapped + best-effort: a failure here
      // must NEVER block the payment/email flow — the customer has already paid.
      let savedCustomerId: string | null = typeof session.customer === 'string'
        ? session.customer
        : (session.customer as any)?.id || null;
      let savedPaymentMethodId: string | null = null;
      let savedCardLast4: string | null = null;
      try {
        const piId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : (session.payment_intent as any)?.id || null;
        if (piId) {
          const pi = await stripe.paymentIntents.retrieve(piId);
          savedPaymentMethodId = typeof pi.payment_method === 'string'
            ? pi.payment_method
            : (pi.payment_method as any)?.id || null;
          if (!savedCustomerId && pi.customer) {
            savedCustomerId = typeof pi.customer === 'string' ? pi.customer : (pi.customer as any).id;
          }
          // Last 4 powers the one-tap trust line ("se cobra a tu tarjeta ···· 4242").
          if (savedPaymentMethodId) {
            const pm = await stripe.paymentMethods.retrieve(savedPaymentMethodId);
            savedCardLast4 = (pm as any)?.card?.last4 || null;
          }
        }
      } catch (pmErr: any) {
        console.warn('[upsell] could not capture saved payment method:', pmErr?.message || pmErr);
      }
      if (savedCustomerId) baseUpdateData.stripe_customer_id = savedCustomerId;
      if (savedPaymentMethodId) baseUpdateData.stripe_payment_method_id = savedPaymentMethodId;
      if (savedCardLast4) baseUpdateData.stripe_card_last4 = savedCardLast4;

      // Video addon: flag songs appropriately based on count
      const videoAddonPurchased = session.metadata?.videoAddon === 'true';
      const videoAddonCountMeta = parseInt(session.metadata?.videoAddonCount || '1');
      const isDualVideo = videoAddonPurchased && videoAddonCountMeta >= 2;

      // Karaoke addon: instrumental(s). karaokeSongIds lists exactly which songs
      // the customer bought an instrumental for (one or both of a 2-pack).
      // fetch-karaoke runs per flagged song after we set status to pending.
      const karaokeAddonPurchased = session.metadata?.karaokeAddon === 'true';
      const karaokeSongIdSet = new Set(
        (session.metadata?.karaokeSongIds || '')
          .split(',').map((s: string) => s.trim()).filter(Boolean),
      );
      // Music-video addons (Phase 4): synced lyric video / karaoke video.
      // render-lyric-video (Vercel) builds them async after we flag pending.
      const lyricVideoPurchased = session.metadata?.lyricVideoAddon === 'true';
      const karaokeVideoPurchased = session.metadata?.karaokeVideoAddon === 'true';

      // Update ALL songs in the bundle
      let firstSong = null;
      // Affiliate commission must be counted ONCE per order, not per song.
      // For a 2-pack both song rows carry the full order total in amount_paid,
      // so recording per song would double the partner's revenue/commission
      // (and double-bump coupon usage). This one-shot flag ensures a single
      // purchase event per order — same "count once per stripe_session_id"
      // doctrine the revenue dashboard uses.
      let affiliatePurchaseLogged = false;
      for (let idx = 0; idx < songIds.length; idx++) {
        const sid = songIds[idx];
        const updateData = { ...baseUpdateData };
        // Dual-video: all songs get has_video_addon; single-video: first song only
        if (videoAddonPurchased && (isDualVideo || idx === 0)) {
          updateData.has_video_addon = true;
          updateData.video_addon_count = isDualVideo ? 2 : 1;
        }
        // Karaoke: flag each song the customer chose (karaokeSongIds). Legacy
        // orders with no per-song list fall back to the first song only.
        const wantsKaraoke = karaokeSongIdSet.size > 0
          ? karaokeSongIdSet.has(sid)
          : (karaokeAddonPurchased && idx === 0);
        if (wantsKaraoke) {
          updateData.karaoke_status = 'pending';
        }
        // Music videos: flag the FIRST song only. render-lyric-video will
        // populate the *_video_url and flip status to 'ready'.
        if (lyricVideoPurchased && idx === 0) {
          updateData.lyric_video_status = 'pending';
        }
        if (karaokeVideoPurchased && idx === 0) {
          updateData.karaoke_video_status = 'pending';
        }
        const { data: song, error: updateError } = await supabase
          .from('songs')
          .update(updateData)
          .eq('id', sid)
          .select()
          .single();

        if (updateError) {
          console.error(`Failed to update song ${sid}:`, updateError.message);
          continue;
        }

        console.log('Song marked as paid:', song.id);
        if (!firstSong) firstSong = song;

        // Affiliate attribution: record ONE purchase event per order (against
        // the first paid song, carrying the full order total) + bump coupon
        // usage once. Recording per song would double-count bundle revenue and
        // coupon usage. Idempotent against webhook retries (one event per
        // song_id). Wrapped so a failure never blocks the payment flow — the
        // customer has paid and everything downstream (email, social clip)
        // must still run.
        if (!affiliatePurchaseLogged) {
          affiliatePurchaseLogged = true;
          try {
            await recordAffiliatePurchase(supabase, song, session.metadata?.affiliateCode || null);
          } catch (affErr: any) {
            console.error(`[affiliate] recordAffiliatePurchase threw for song ${sid}:`, affErr?.message || affErr);
          }
        }

        // Fire-and-forget: render a 60s social media clip for this paid song.
        // render-social-clip is idempotent (UNIQUE index on social_posts.song_id)
        // and gated by SOCIAL_CLIPS_ENABLED env var. Failures here MUST NOT
        // block the payment flow — wrapped in try/catch + 3s race timeout so
        // even a hung edge-function call can never delay the webhook response.
        try {
          const clipPromise = fetch(`${SUPABASE_URL}/functions/v1/render-social-clip`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ songId: sid }),
          });
          const timeoutPromise = new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error('render-social-clip trigger timeout')), 3000)
          );
          const clipResponse = await Promise.race([clipPromise, timeoutPromise]);
          if (!clipResponse.ok) {
            console.warn(`[render-social-clip] non-2xx for ${sid}: ${clipResponse.status}`);
          }
        } catch (clipErr: any) {
          console.warn(`[render-social-clip] trigger failed for ${sid}:`, clipErr?.message || clipErr);
        }

        // Fire-and-forget: trigger the Vercel karaoke worker for the first
        // song if the customer bought the karaoke add-on. The work runs on
        // Vercel (1GB memory) because Supabase Edge Functions ran out of
        // memory extracting the 195MB Mureka stem ZIP. Authenticated with a
        // shared secret (KARAOKE_TRIGGER_SECRET).
        if (wantsKaraoke) {
          const karaokeSecret = Deno.env.get('KARAOKE_TRIGGER_SECRET') || '';
          const vercelBase = Deno.env.get('VERCEL_BASE_URL') || 'https://regalosquecantan.com';
          if (!karaokeSecret) {
            console.warn(`[karaoke] KARAOKE_TRIGGER_SECRET not set — skipping trigger for ${sid}`);
          } else {
            try {
              const karaokePromise = fetch(`${vercelBase}/api/karaoke-fetch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ songId: sid, secret: karaokeSecret }),
              });
              const karaokeTimeout = new Promise<Response>((_, reject) =>
                setTimeout(() => reject(new Error('karaoke-fetch trigger timeout')), 3000)
              );
              const karaokeResponse = await Promise.race([karaokePromise, karaokeTimeout]);
              if (!karaokeResponse.ok) {
                console.warn(`[karaoke] vercel non-2xx for ${sid}: ${karaokeResponse.status}`);
              }
            } catch (karaokeErr: any) {
              console.warn(`[karaoke] vercel trigger failed for ${sid}:`, karaokeErr?.message || karaokeErr);
            }
          }
        }

        // Fire-and-forget: trigger the Vercel video renderer for the first
        // song when a music-video addon was bought. Same timeout-guarded
        // pattern as the karaoke trigger above — the render itself runs to
        // completion on Vercel (2-4 min) independent of this 3s race, so the
        // webhook response is never delayed. Auth: KARAOKE_TRIGGER_SECRET.
        if ((lyricVideoPurchased || karaokeVideoPurchased) && idx === 0) {
          const videoSecret = Deno.env.get('KARAOKE_TRIGGER_SECRET') || '';
          const vercelBase = Deno.env.get('VERCEL_BASE_URL') || 'https://regalosquecantan.com';
          if (!videoSecret) {
            console.warn(`[lyric-video] KARAOKE_TRIGGER_SECRET not set — skipping trigger for ${sid}`);
          } else {
            const modes: string[] = [];
            if (lyricVideoPurchased) modes.push('lyric');
            if (karaokeVideoPurchased) modes.push('karaoke');
            for (const mode of modes) {
              try {
                const vidPromise = fetch(`${vercelBase}/api/render-lyric-video`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ songId: sid, mode, secret: videoSecret }),
                });
                const vidTimeout = new Promise<Response>((_, reject) =>
                  setTimeout(() => reject(new Error('render-lyric-video trigger timeout')), 3000)
                );
                const vidResponse = await Promise.race([vidPromise, vidTimeout]);
                if (!vidResponse.ok) {
                  console.warn(`[lyric-video:${mode}] vercel non-2xx for ${sid}: ${vidResponse.status}`);
                }
              } catch (vidErr: any) {
                // Timeout is EXPECTED here — the render runs minutes; the
                // Vercel function keeps going after our 3s race resolves.
                console.warn(`[lyric-video:${mode}] trigger race ended for ${sid}:`, vidErr?.message || vidErr);
              }
            }
          }
        }
      }

      // Gift-SMS add-on ($5, bundled at checkout): now that the song is paid,
      // create the scheduled_gift_messages row the every-minute
      // send-scheduled-gift-sms cron will deliver. Moderation already passed in
      // create-checkout (pre-charge). Idempotent on stripe_session_id so webhook
      // retries can't double-insert. Wrapped so a failure never blocks the
      // payment/email flow (the customer has paid).
      if (session.metadata?.gift_sms === 'true' && session.metadata?.gift_recipient_phone) {
        try {
          const { data: existingGift } = await supabase
            .from('scheduled_gift_messages')
            .select('id')
            .eq('stripe_session_id', session.id)
            .maybeSingle();
          if (!existingGift) {
            await supabase.from('scheduled_gift_messages').insert({
              song_id: session.metadata?.gift_song_id || songIds[0],
              buyer_email: email || null,
              buyer_name: session.metadata?.gift_buyer_name || 'Alguien',
              recipient_name: session.metadata?.gift_recipient_name || null,
              recipient_phone: session.metadata.gift_recipient_phone,
              personal_message: session.metadata?.gift_message || null,
              send_at: session.metadata?.gift_send_at,
              buyer_timezone: session.metadata?.gift_tz || null,
              status: 'scheduled',
              moderation_status: 'approved',
              amount_cents: 500,
              attestation_accepted: true,
              marketing_excluded: true,
              stripe_session_id: session.id,
            });
            console.log(`✅ [gift_sms bundled] scheduled gift for song ${session.metadata?.gift_song_id || songIds[0]} (session ${session.id})`);
          }
        } catch (giftErr: any) {
          console.error('[gift_sms bundled] failed to create gift row:', giftErr?.message || giftErr);
        }
      }

      // Meta Conversions API — server-side Purchase event. Dedupes with the
      // browser pixel via event_id = session.id (the SuccessPage pixel passes
      // {eventID: session_id}). Wrapped + gated on env vars; never throws.
      try {
        await sendMetaCAPIPurchase({
          sessionId: session.id,
          email: email || null,
          amountUsd: amountPaid,
          songIds,
          fbc: session.metadata?.fbc || '',
          fbp: session.metadata?.fbp || '',
          clientIp: session.metadata?.client_ip || '',
          clientUserAgent: session.metadata?.client_user_agent || '',
          recipientName: firstSong?.recipient_name || null
        });
      } catch (capiErr: any) {
        // Defensive: sendMetaCAPIPurchase already swallows everything, but
        // re-catch here so a future refactor can never block the email path.
        console.error('[meta-capi] outer guard caught:', capiErr?.message || capiErr);
      }

      // Send email with download link via SendGrid (use first song for template).
      // De-dup against funnel_events so verify-payment + webhook can't both
      // send. Log success/failure so admin + health-check can detect issues.
      if (email && firstSong) {
        const { data: existingEmailEvent } = await supabase
          .from('funnel_events')
          .select('id')
          .eq('step', 'purchase_email_sent')
          .contains('metadata', { stripe_session_id: session.id })
          .maybeSingle();

        if (existingEmailEvent) {
          console.log('⏭️ purchase email already sent for session', session.id, '- skipping');
        } else {
          let emailOk = false;
          let emailErr: string | null = null;
          try {
            const subject = songIds.length > 1
              ? `🎵 Tus ${songIds.length} canciones para ${firstSong.recipient_name} están listas!`
              : `🎵 Tu canción para ${firstSong.recipient_name} está lista!`;
            const preheader = songIds.length > 1
              ? `Tus ${songIds.length} canciones para ${firstSong.recipient_name} en un solo enlace. El enlace nunca expira — guarda este correo.`
              : `Escucha y descarga tu canción para ${firstSong.recipient_name}. El enlace nunca expira — guarda este correo.`;
            await sendEmail(
              email,
              subject,
              getPurchaseEmailHtml(firstSong, songIds),
              'purchase_confirmation',
              preheader,
            );
            emailOk = true;
            console.log('📧 Purchase email sent to:', email, 'for songs:', songIds);
          } catch (emailError: any) {
            emailErr = emailError?.message || String(emailError);
            console.error('🔴 Failed to send purchase email:', emailErr, 'songId:', firstSong.id, 'email:', email);
          }
          try {
            await supabase.from('funnel_events').insert([{
              session_id: session.id,
              step: emailOk ? 'purchase_email_sent' : 'purchase_email_failed',
              metadata: {
                stripe_session_id: session.id,
                song_ids: songIds,
                email,
                error: emailErr,
                attempted_at: new Date().toISOString(),
                source: 'stripe-webhook',
              },
            }]);
          } catch (logErr) {
            console.error('Failed to log purchase email status:', logErr);
          }
        }
      } else if (firstSong && !email) {
        console.warn('🟡 No email on session for songId:', firstSong.id);
        try {
          await supabase.from('funnel_events').insert([{
            session_id: session.id,
            step: 'purchase_email_skipped_no_email',
            metadata: { stripe_session_id: session.id, song_ids: songIds },
          }]);
        } catch {}
      }
    }

    // ========== HANDLE EXPIRED CHECKOUT (Stripe abandonment tracking + recovery email) ==========
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const songIdMeta = session.metadata?.songId;
      const email = session.metadata?.email || session.customer_email;

      console.log('⏰ Checkout session expired:', session.id, 'email:', email, 'songIds:', songIdMeta);

      // Log the abandoned checkout to funnel_events for analytics
      if (songIdMeta) {
        const songIds = songIdMeta.split(',').map((id: string) => id.trim()).filter(Boolean);

        await supabase
          .from('funnel_events')
          .insert([{
            session_id: session.id,
            step: 'checkout_expired',
            metadata: {
              stripe_session_id: session.id,
              song_ids: songIds,
              email: email,
              amount: session.amount_total ? (session.amount_total / 100) : null,
              expired_at: new Date().toISOString()
            }
          }]);

        console.log('📊 Logged checkout_expired event for songs:', songIds);

        // ========== SEND RECOVERY EMAIL ==========
        if (email && songIds.length > 0) {
          try {
            // Fetch the first song to check if already paid (they may have retried successfully)
            const { data: song } = await supabase
              .from('songs')
              .select('*')
              .eq('id', songIds[0])
              .single();

            if (song && !song.paid) {
              // Check we haven't already sent a recovery email for this session
              const { data: existingEvent } = await supabase
                .from('funnel_events')
                .select('id')
                .eq('step', 'checkout_recovery_email_sent')
                .contains('metadata', { stripe_session_id: session.id })
                .maybeSingle();

              if (!existingEvent) {
                const siteUrl = 'https://regalosquecantan.com';
                const listenUrl = songIds.length > 1
                  ? `${siteUrl}/listen?song_ids=${songIds.join(',')}&coupon=VUELVE10`
                  : `${siteUrl}/listen?song_id=${songIds[0]}&coupon=VUELVE10`;

                await sendEmail(
                  email,
                  `🎵 ${song.recipient_name ? `Tu canción para ${song.recipient_name}` : 'Tu canción'} te espera — 10% OFF`,
                  getAbandonedCheckoutEmailHtml(song, listenUrl),
                  'checkout_recovery',
                  `Tu canción personalizada sigue lista. Completa tu compra con 10% OFF — usa el código VUELVE10.`,
                );

                // Log that we sent the recovery email (prevents duplicates)
                await supabase
                  .from('funnel_events')
                  .insert([{
                    session_id: session.id,
                    step: 'checkout_recovery_email_sent',
                    metadata: {
                      stripe_session_id: session.id,
                      song_ids: songIds,
                      email: email,
                      sent_at: new Date().toISOString()
                    }
                  }]);

                console.log('📧 Recovery email sent to:', email, 'for songs:', songIds);
              } else {
                console.log('⏭️ Recovery email already sent for session:', session.id);
              }
            } else {
              console.log('⏭️ Song already paid, skipping recovery email for:', songIds[0]);
            }
          } catch (emailError) {
            console.error('Failed to send recovery email:', emailError);
            // Don't fail the webhook if email fails
          }
        }
      }
    }

    // ========== HANDLE FAILED PAYMENT ==========
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const songIdMeta = session.metadata?.songId;
      const email = session.metadata?.email || session.customer_email;

      console.log('❌ Payment failed:', session.id, 'email:', email);

      // Log the failed payment for analytics
      if (songIdMeta) {
        await supabase
          .from('funnel_events')
          .insert([{
            session_id: session.id,
            step: 'payment_failed',
            metadata: {
              stripe_session_id: session.id,
              song_ids: songIdMeta.split(',').map((id: string) => id.trim()),
              email: email,
              failed_at: new Date().toISOString()
            }
          }]);
      }
    }

    // ========== HANDLE REFUNDS (affiliate commission reversal) ==========
    // Subscribe to `charge.refunded` in the Stripe Dashboard for this to fire.
    // We log a negative-amount `refund` event scoped to the original song so
    // affiliate-data subtracts it from commission. Idempotent per (song_id,
    // refund_id) — Stripe may redeliver the event.
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id || null;

      if (!paymentIntentId) {
        console.warn('[refund] charge.refunded with no payment_intent — skipping');
      } else {
        // Find the affected songs. stripe_payment_id is set by verify-payment
        // when it wins the race; if only stripe-webhook ran, we need to
        // resolve via the checkout session.
        let { data: refundedSongs } = await supabase
          .from('songs')
          .select('id, affiliate_code, coupon_code, amount_paid, stripe_session_id')
          .eq('stripe_payment_id', paymentIntentId);

        if (!refundedSongs || refundedSongs.length === 0) {
          // Fall back: ask Stripe which session this PI belongs to, then
          // look up the song(s) by stripe_session_id.
          try {
            const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
            const session = sessions.data[0];
            if (session) {
              const { data: viaSession } = await supabase
                .from('songs')
                .select('id, affiliate_code, coupon_code, amount_paid, stripe_session_id')
                .eq('stripe_session_id', session.id);
              refundedSongs = viaSession || [];
            }
          } catch (lookupErr: any) {
            console.error('[refund] session lookup failed for PI', paymentIntentId, lookupErr?.message || lookupErr);
          }
        }

        if (!refundedSongs || refundedSongs.length === 0) {
          console.warn('[refund] no song found for charge', charge.id, 'PI', paymentIntentId);
        } else {
          // Total refunded so far on this charge in dollars.
          const refundedTotal = (charge.amount_refunded || 0) / 100;
          // Use the latest refund in the charge as the de-dup key.
          const latestRefund = (charge.refunds?.data || [])[0];
          const refundIdKey = latestRefund?.id || `charge_${charge.id}`;

          for (const song of refundedSongs) {
            if (!song.affiliate_code) continue; // not affiliate-attributed

            // Idempotency: one refund event per (song, refund-id).
            const { data: existing } = await supabase
              .from('affiliate_events')
              .select('id, amount, created_at')
              .eq('song_id', song.id)
              .eq('event_type', 'refund');

            // If we've already logged a refund event for this exact refund_id
            // (encoded in created_at-tagged metadata isn't available, so we
            // gate on absolute total), skip. Simplest: only one refund event
            // per song. If the customer is partially refunded multiple times
            // we use the cumulative total for the latest entry.
            const refundAmount = Math.min(refundedTotal, parseFloat(String(song.amount_paid || '0')) || refundedTotal);

            if (existing && existing.length > 0) {
              // Already have a refund event — update if the cumulative
              // amount changed (e.g. second partial refund).
              const prevAmount = Math.abs(parseFloat(String(existing[0].amount || '0')) || 0);
              if (Math.abs(refundAmount - prevAmount) < 0.005) {
                continue; // no change
              }
              await supabase
                .from('affiliate_events')
                .update({ amount: -refundAmount })
                .eq('id', existing[0].id);
              console.log(`[refund] updated existing refund event for song ${song.id} → -${refundAmount}`);
            } else {
              await supabase.from('affiliate_events').insert({
                affiliate_code: song.affiliate_code,
                event_type: 'refund',
                song_id: song.id,
                amount: -refundAmount,
              });
              console.log(`[refund] recorded refund event — code=${song.affiliate_code} song=${song.id} amount=-${refundAmount} refund=${refundIdKey}`);
            }
          }

          // Mark the song(s) as refunded so the admin dashboard reflects it.
          for (const song of refundedSongs) {
            await supabase
              .from('songs')
              .update({ payment_status: 'refunded' })
              .eq('id', song.id);
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400 }
    );
  }
});
