// supabase/functions/recover-song/index.ts
//
// Public-facing self-service song recovery. The customer types their email at
// /mi-cancion and we either (a) show them their paid songs directly on the
// page, (b) re-send the song link(s) by email, or both.
//
// Body shape:
//   { email: string,
//     action?: 'lookup' | 'send'                  default: 'lookup'
//     which?:  'paid'   | 'unpaid'                default: 'paid'   (only used when action='send')
//   }
//
// Response:
//   { ok: true, songs: [
//       { id, recipient_name, paid: bool, paid_at | null, created_at,
//         listen_url }   // /song/<id> when paid, /listen?song_id=<id> when not
//     ],
//     emailSent: bool   // true when an email was actually dispatched
//   }
//
// The owner has explicitly opted into showing songs to anyone who knows the
// purchase email — see commit history for the trade-off rationale. The
// per-IP rate limit (5 attempts / 10 min) remains, and the endpoint still
// returns 200 with empty list on no-match (so the failure-shape mirrors
// success-with-zero-songs).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;

const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';
const SITE_URL = 'https://regalosquecantan.com';

const RATE_LIMIT_MAX_PER_IP = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

type RecoveredSong = { recipient_name: string; listen_url: string };

function buildPaidHtml(songs: RecoveredSong[]): string {
  const songRows = songs
    .map(
      (s) => `
    <tr><td style="padding:16px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
      <p style="color:#c9b99a;margin:0 0 8px;font-size:14px;">Canci&oacute;n para <strong style="color:#ffd23f;">${s.recipient_name}</strong></p>
      <a href="${s.listen_url}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:12px 24px;border-radius:30px;text-decoration:none;font-weight:700;font-size:14px;">&#9654; Escuchar y descargar</a>
    </td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Aqu&iacute; est&aacute;n los enlaces de tus canciones de RegalosQueCantan. El enlace nunca expira &mdash; gu&aacute;rdalo.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;">
  <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:40px 30px 24px;text-align:center;">
    <p style="color:#ff6b35;font-size:36px;margin:0 0 12px;">&#127925;</p>
    <h1 style="color:#ffffff;font-size:24px;margin:0 0 10px;font-weight:700;">Aqu&iacute; est&aacute;n tus canciones</h1>
    <p style="color:#c9b99a;font-size:14px;margin:0;line-height:1.6;">Recibimos tu solicitud de recuperaci&oacute;n. Estos son los enlaces:</p>
  </td></tr>
  <tr><td style="background-color:#1a0e08;padding:8px 30px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0">${songRows}</table>
  </td></tr>
  <tr><td style="background-color:#1a0e08;padding:0 30px 32px;text-align:center;">
    <p style="color:#a67c52;font-size:12px;margin:0;line-height:1.6;">Estos enlaces nunca expiran. Guarda este correo para volver a escuchar cuando quieras.</p>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="background-color:#1a0e08;padding:24px 30px;text-align:center;">
    <p style="color:#c9b99a;font-size:13px;margin:0 0 6px;">&iquest;Necesitas ayuda?</p>
    <p style="color:#a67c52;font-size:12px;margin:0;"><a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a></p>
    <p style="color:#4a2c1a;font-size:11px;margin:10px 0 0;">&copy; ${new Date().getFullYear()} Regalos Que Cantan</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function buildPaidPlaintext(songs: RecoveredSong[]): string {
  const lines: string[] = [];
  lines.push('Aquí están tus canciones de RegalosQueCantan');
  lines.push('');
  lines.push('Recibimos tu solicitud de recuperación. Estos son los enlaces:');
  lines.push('');
  for (const s of songs) {
    lines.push(`• Canción para ${s.recipient_name}`);
    lines.push(`  ${s.listen_url}`);
    lines.push('');
  }
  lines.push('Estos enlaces nunca expiran. Guarda este correo para volver a escuchar cuando quieras.');
  lines.push('');
  lines.push('¿Necesitas ayuda? Escríbenos a hola@regalosquecantan.com');
  return lines.join('\n');
}

function buildUnpaidHtml(songs: RecoveredSong[]): string {
  const songRows = songs
    .map(
      (s) => `
    <tr><td style="padding:16px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
      <p style="color:#c9b99a;margin:0 0 8px;font-size:14px;">Canci&oacute;n para <strong style="color:#ffd23f;">${s.recipient_name}</strong></p>
      <a href="${s.listen_url}" style="display:inline-block;background:linear-gradient(135deg,#e11d74 0%,#c026d3 100%);color:#ffffff;padding:12px 24px;border-radius:30px;text-decoration:none;font-weight:700;font-size:14px;">&#128178; Escuchar y comprar</a>
    </td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Recordatorio: tienes canciones creadas pendientes de comprar en RegalosQueCantan. Esc&uacute;chalas y compl&eacute;talas aqu&iacute;.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;">
  <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:40px 30px 24px;text-align:center;">
    <p style="color:#ffd23f;font-size:36px;margin:0 0 12px;">&#9203;</p>
    <h1 style="color:#ffffff;font-size:24px;margin:0 0 10px;font-weight:700;">Tus canciones pendientes</h1>
    <p style="color:#c9b99a;font-size:14px;margin:0;line-height:1.6;">Estas canciones ya est&aacute;n listas para escuchar. Compl&eacute;talas para descargar la versi&oacute;n completa y compartirlas.</p>
  </td></tr>
  <tr><td style="background-color:#1a0e08;padding:8px 30px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0">${songRows}</table>
  </td></tr>
  <tr><td style="background-color:#1a0e08;padding:0 30px 32px;text-align:center;">
    <p style="color:#a67c52;font-size:12px;margin:0;line-height:1.6;">Tu progreso est&aacute; guardado. No necesitas volver a crear nada &mdash; solo completar la compra.</p>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#e11d74,#ffd23f,#ff6b35);font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="background-color:#1a0e08;padding:24px 30px;text-align:center;">
    <p style="color:#c9b99a;font-size:13px;margin:0 0 6px;">&iquest;Necesitas ayuda?</p>
    <p style="color:#a67c52;font-size:12px;margin:0;"><a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a></p>
    <p style="color:#4a2c1a;font-size:11px;margin:10px 0 0;">&copy; ${new Date().getFullYear()} Regalos Que Cantan</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function buildUnpaidPlaintext(songs: RecoveredSong[]): string {
  const lines: string[] = [];
  lines.push('Tus canciones pendientes en RegalosQueCantan');
  lines.push('');
  lines.push('Estas canciones ya están listas. Complétalas para descargar la versión completa y compartirlas:');
  lines.push('');
  for (const s of songs) {
    lines.push(`• Canción para ${s.recipient_name}`);
    lines.push(`  ${s.listen_url}`);
    lines.push('');
  }
  lines.push('Tu progreso está guardado. No necesitas volver a crear nada — solo completar la compra.');
  lines.push('');
  lines.push('¿Necesitas ayuda? Escríbenos a hola@regalosquecantan.com');
  return lines.join('\n');
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  plaintext: string,
  category: string,
): Promise<void> {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      // text/plain MUST come before text/html (RFC 2046 multipart/alternative).
      content: [
        { type: 'text/plain', value: plaintext },
        { type: 'text/html', value: html },
      ],
      categories: [category, 'rqc'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false },
      },
      headers: {
        'List-Unsubscribe': '<mailto:hola@regalosquecantan.com?subject=unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SendGrid ${response.status}: ${text}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const respondJson = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  let email: string;
  let action: 'lookup' | 'send' = 'lookup';
  let which: 'paid' | 'unpaid' = 'paid';
  try {
    const body = await req.json();
    email = String(body?.email || '').trim().toLowerCase();
    if (body?.action === 'send' || body?.action === 'lookup') {
      action = body.action;
    }
    if (body?.which === 'paid' || body?.which === 'unpaid') {
      which = body.which;
    }
  } catch {
    return respondJson(400, { ok: false, error: 'invalid body' });
  }

  if (!email || !isValidEmail(email)) {
    return respondJson(400, { ok: false, error: 'invalid email' });
  }

  const xfwd = req.headers.get('x-forwarded-for') || '';
  const clientIp = xfwd.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || 'unknown';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Per-IP rate limit using funnel_events as a lightweight counter.
  const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: attemptCount } = await supabase
    .from('funnel_events')
    .select('id', { count: 'exact', head: true })
    .eq('step', 'song_recovery_attempt')
    .gte('created_at', sinceIso)
    .filter('metadata->>ip', 'eq', clientIp);

  if ((attemptCount ?? 0) >= RATE_LIMIT_MAX_PER_IP) {
    console.log('[recover-song] rate-limited', { ip: clientIp, count: attemptCount });
    return respondJson(429, { ok: false, error: 'rate_limited', songs: [], emailSent: false });
  }

  // Log the attempt (also serves as the rate-limit counter).
  await supabase.from('funnel_events').insert([
    {
      step: 'song_recovery_attempt',
      metadata: { email, ip: clientIp, action, which, ts: new Date().toISOString() },
    },
  ]);

  // Look up every song with a previewable audio_url for this email.
  // Both paid and unpaid are returned, distinguished by the `paid` field —
  // the frontend renders them in separate sections and routes to different
  // pages (paid → /song/<id> SongPage, unpaid → /listen?song_id=<id>
  // ShareablePreviewPage where the customer can preview + buy).
  const { data: songs } = await supabase
    .from('songs')
    .select('id, recipient_name, paid, paid_at, created_at, audio_url')
    .eq('email', email)
    .not('audio_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40);

  const songRows = songs ?? [];

  const responseSongs = songRows.map((s) => {
    const isPaid = s.paid === true;
    return {
      id: s.id,
      recipient_name: (s.recipient_name || 'tu ser querido').trim(),
      paid: isPaid,
      paid_at: s.paid_at || null,
      created_at: s.created_at || null,
      // Paid → SongPage (player + downloads). Unpaid → ShareablePreviewPage
      // (preview + buy button).
      listen_url: isPaid
        ? `${SITE_URL}/song/${s.id}`
        : `${SITE_URL}/listen?song_id=${s.id}`,
    };
  });

  if (songRows.length === 0) {
    console.log('[recover-song] no songs found', { email, action });
    return respondJson(200, { ok: true, songs: [], emailSent: false });
  }

  // If the caller only asked to look up, we're done.
  if (action === 'lookup') {
    return respondJson(200, { ok: true, songs: responseSongs, emailSent: false });
  }

  // Email send — pick the template + subject based on `which`.
  const targetSongs: RecoveredSong[] = responseSongs
    .filter((s) => (which === 'paid' ? s.paid : !s.paid))
    .map((s) => ({ recipient_name: s.recipient_name, listen_url: s.listen_url }));

  if (targetSongs.length === 0) {
    console.log('[recover-song] no songs to email', { email, which });
    return respondJson(200, { ok: true, songs: responseSongs, emailSent: false });
  }

  let subject: string;
  let html: string;
  let plaintext: string;
  let category: string;
  let funnelStep: string;

  if (which === 'paid') {
    subject =
      targetSongs.length > 1
        ? '🎵 Aquí están tus canciones de RegalosQueCantan'
        : '🎵 Aquí está tu canción de RegalosQueCantan';
    html = buildPaidHtml(targetSongs);
    plaintext = buildPaidPlaintext(targetSongs);
    category = 'song_recovery';
    funnelStep = 'song_recovery_sent';
  } else {
    subject =
      targetSongs.length > 1
        ? '⏳ Tus canciones pendientes en RegalosQueCantan'
        : '⏳ Tu canción pendiente en RegalosQueCantan';
    html = buildUnpaidHtml(targetSongs);
    plaintext = buildUnpaidPlaintext(targetSongs);
    category = 'song_recovery_unpaid';
    funnelStep = 'song_recovery_unpaid_sent';
  }

  let emailSent = false;
  try {
    await sendEmail(email, subject, html, plaintext, category);
    await supabase.from('funnel_events').insert([
      {
        step: funnelStep,
        metadata: { email, which, song_count: targetSongs.length, ip: clientIp },
      },
    ]);
    emailSent = true;
    console.log('[recover-song] sent', { email, which, count: targetSongs.length });
  } catch (e) {
    console.error('[recover-song] sendEmail failed', e);
  }

  return respondJson(200, { ok: true, songs: responseSongs, emailSent });
});
