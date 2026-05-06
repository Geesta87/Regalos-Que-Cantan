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

type RecoveredSong = { recipient_names: string; listen_url: string; is_bundle: boolean; has_video: boolean };

function emailFooter(): string {
  return `
  <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="background-color:#1a0e08;padding:24px 30px;text-align:center;">
    <p style="color:#a67c52;font-size:12px;margin:0 0 4px;line-height:1.6;">Estos enlaces nunca expiran &mdash; gu&aacute;rdalos.</p>
    <p style="color:#a67c52;font-size:12px;margin:0;">&iquest;Necesitas ayuda? <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a></p>
    <p style="color:#4a2c1a;font-size:11px;margin:10px 0 0;">&copy; ${new Date().getFullYear()} Regalos Que Cantan</p>
    <p style="color:#4a2c1a;font-size:10px;margin:4px 0 0;">Regalos Que Cantan &bull; Los Angeles, CA 91324, USA</p>
  </td></tr>`;
}

function buildPaidHtml(entries: RecoveredSong[]): string {
  const entryRows = entries.map((e) => {
    const badge = e.has_video
      ? `<p style="color:#7c3aed;font-size:11px;font-weight:700;margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;">&#127909; CANCI&Oacute;N + VIDEO MUSICAL${e.is_bundle ? ' (PAQUETE 2)' : ''}</p>`
      : e.is_bundle
        ? `<p style="color:#8a7060;font-size:11px;font-weight:700;margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;">&#127873; PAQUETE 2 CANCIONES</p>`
        : `<p style="color:#8a7060;font-size:11px;font-weight:700;margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;">&#127873; CANCI&Oacute;N PERSONALIZADA</p>`;
    const btnBg = e.has_video ? 'background-color:#7c3aed;' : 'background-color:#ff6b35;';
    const btnLabel = e.has_video ? '&#127909;  Ver video y descargar' : '&#9654;  Escuchar y descargar';
    return `
    <tr><td style="background-color:#ffffff;padding:28px 32px;border-left:1px solid #e8e0d5;border-right:1px solid #e8e0d5;border-bottom:1px solid #f0e8de;">
      ${badge}
      <p style="color:#1a0e08;font-size:20px;font-weight:800;margin:0 0 20px;line-height:1.3;">Para <span style="color:#e05a1a;">${e.recipient_names}</span></p>
      <table cellpadding="0" cellspacing="0"><tr><td style="${btnBg}border-radius:8px;">
        <a href="${e.listen_url}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;">${btnLabel}</a>
      </td></tr></table>
    </td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:32px 16px;background-color:#f4f0eb;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Tus canciones de RegalosQueCantan est&aacute;n listas &mdash; toca el bot&oacute;n para escucharlas.</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">
  <tr><td style="background-color:#1a0e08;border-radius:16px 16px 0 0;padding:36px 32px 28px;text-align:center;">
    <img src="https://regalosquecantan.com/images/logo.png" alt="Regalos Que Cantan" width="140" style="display:block;margin:0 auto 20px;width:140px;border:0;" />
    <h1 style="color:#ffffff;font-size:22px;font-weight:800;margin:0 0 8px;line-height:1.3;">Tus canciones est&aacute;n listas</h1>
    <p style="color:#c9b99a;font-size:14px;margin:0;line-height:1.6;">Toca el bot&oacute;n para escucharlas, descargarlas y compartirlas.</p>
  </td></tr>
  ${entryRows}
  <tr><td style="background-color:#1a0e08;border-radius:0 0 16px 16px;padding:28px 32px;text-align:center;">
    <p style="color:#a67c52;font-size:12px;margin:0 0 4px;">Estos enlaces nunca expiran &mdash; gu&aacute;rdalos.</p>
    <p style="color:#a67c52;font-size:12px;margin:0;">&iquest;Necesitas ayuda? <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;text-decoration:none;">hola@regalosquecantan.com</a></p>
    <p style="color:#4a2c1a;font-size:11px;margin:10px 0 0;">&copy; ${new Date().getFullYear()} Regalos Que Cantan</p>
    <p style="color:#4a2c1a;font-size:10px;margin:6px 0 0;">Regalos Que Cantan &bull; Los Angeles, CA 91324, USA</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildPaidPlaintext(entries: RecoveredSong[]): string {
  const lines: string[] = ['Aquí están tus canciones de RegalosQueCantan', ''];
  for (const e of entries) {
    const tag = e.has_video ? ' (canción + video)' : e.is_bundle ? ' (paquete 2 canciones)' : '';
    lines.push(`• Para ${e.recipient_names}${tag}`);
    lines.push(`  ${e.listen_url}`);
    lines.push('');
  }
  lines.push('Estos enlaces nunca expiran.');
  lines.push('¿Necesitas ayuda? hola@regalosquecantan.com');
  return lines.join('\n');
}

type UnpaidSong = { recipient_name: string; listen_url: string };

function buildUnpaidHtml(songs: UnpaidSong[]): string {
  const songRows = songs.map((s) => `
    <tr><td style="padding:24px 0;border-bottom:1px solid rgba(255,255,255,0.08);text-align:center;">
      <p style="color:#ffffff;font-size:20px;font-weight:800;margin:0 0 16px;">Para <span style="color:#ffd23f;">${s.recipient_name}</span></p>
      <a href="${s.listen_url}" style="display:inline-block;background:linear-gradient(135deg,#e11d74 0%,#c026d3 100%);color:#ffffff;padding:16px 36px;border-radius:40px;text-decoration:none;font-weight:800;font-size:16px;box-shadow:0 4px 20px rgba(225,29,116,0.4);">&#9654;&nbsp; Escuchar y comprar</a>
    </td></tr>`).join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Tienes canciones listas pendientes de comprar en RegalosQueCantan.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;">
  <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:40px 30px 16px;text-align:center;">
    <p style="color:#ffd23f;font-size:40px;margin:0 0 14px;">&#9203;</p>
    <h1 style="color:#ffffff;font-size:26px;margin:0 0 8px;font-weight:800;">Tus canciones te esperan</h1>
    <p style="color:#c9b99a;font-size:14px;margin:0;line-height:1.6;">Ya est&aacute;n listas. Compl&eacute;talas para descargar y compartir.</p>
  </td></tr>
  <tr><td style="background-color:#1a0e08;padding:0 30px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0">${songRows}</table>
  </td></tr>
  ${emailFooter()}
</table></td></tr></table></body></html>`;
}

function buildUnpaidPlaintext(songs: UnpaidSong[]): string {
  const lines: string[] = ['Tus canciones pendientes en RegalosQueCantan', ''];
  for (const s of songs) {
    lines.push(`• Para ${s.recipient_name}: ${s.listen_url}`);
    lines.push('');
  }
  lines.push('Ya están listas — solo falta completar la compra.');
  lines.push('¿Necesitas ayuda? hola@regalosquecantan.com');
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
  let filterStripePaymentId: string | null = null;
  try {
    const body = await req.json();
    email = String(body?.email || '').trim().toLowerCase();
    if (body?.action === 'send' || body?.action === 'lookup') {
      action = body.action;
    }
    if (body?.which === 'paid' || body?.which === 'unpaid') {
      which = body.which;
    }
    // Optional: when sending paid songs, caller can pass a stripe_payment_id
    // to restrict the email to just that one purchase instead of all paid songs.
    if (body?.stripe_payment_id && typeof body.stripe_payment_id === 'string') {
      filterStripePaymentId = body.stripe_payment_id;
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
  const { data: songs } = await supabase
    .from('songs')
    .select('id, recipient_name, paid, paid_at, created_at, audio_url, stripe_payment_id, has_video_addon')
    .ilike('email', email)
    .not('audio_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40);

  const songRows = songs ?? [];

  if (songRows.length === 0) {
    console.log('[recover-song] no songs found', { email, action });
    return respondJson(200, { ok: true, songs: [], emailSent: false });
  }

  // ── Group paid songs that share a stripe_payment_id into one bundle entry ──
  // This produces a single /song/id1,id2 URL for bundles instead of two separate links.
  const paidRows = songRows.filter((s) => s.paid === true);
  const unpaidRows = songRows.filter((s) => s.paid !== true);

  const bundleMap = new Map<string, typeof paidRows>();
  const soloPaidRows: typeof paidRows = [];
  for (const s of paidRows) {
    if (s.stripe_payment_id) {
      const grp = bundleMap.get(s.stripe_payment_id);
      if (grp) grp.push(s);
      else bundleMap.set(s.stripe_payment_id, [s]);
    } else {
      soloPaidRows.push(s);
    }
  }

  // Each entry represents one card in the email / one row on the page.
  // Video orders route to /success?song_ids= (full video player + download).
  // Audio-only orders route to /song/ (SongPage).
  type PaidEntry = { ids: string; recipient_names: string; listen_url: string; paid_at: string | null; is_bundle: boolean; has_video: boolean; stripe_payment_id: string | null };
  const paidEntries: PaidEntry[] = [];
  for (const [pid, grp] of bundleMap) {
    const ids = grp.map((s) => s.id).join(',');
    const names = grp.map((s) => (s.recipient_name || 'tu ser querido').trim()).join(' y ');
    const hasVideo = grp.some((s) => s.has_video_addon === true);
    const url = hasVideo ? `${SITE_URL}/success?song_ids=${ids}` : `${SITE_URL}/song/${ids}`;
    paidEntries.push({ ids, recipient_names: names, listen_url: url, paid_at: grp[0].paid_at || null, is_bundle: grp.length > 1, has_video: hasVideo, stripe_payment_id: pid });
  }
  for (const s of soloPaidRows) {
    const hasVideo = s.has_video_addon === true;
    const url = hasVideo ? `${SITE_URL}/success?song_ids=${s.id}` : `${SITE_URL}/song/${s.id}`;
    paidEntries.push({ ids: s.id, recipient_names: (s.recipient_name || 'tu ser querido').trim(), listen_url: url, paid_at: s.paid_at || null, is_bundle: false, has_video: hasVideo, stripe_payment_id: s.stripe_payment_id || null });
  }

  // Unpaid songs stay individual (each needs its own preview+buy flow).
  const unpaidEntries = unpaidRows.map((s) => ({
    id: s.id,
    recipient_name: (s.recipient_name || 'tu ser querido').trim(),
    paid: false as const,
    paid_at: null,
    created_at: s.created_at || null,
    listen_url: `${SITE_URL}/listen?song_id=${s.id}`,
    stripe_payment_id: s.stripe_payment_id || null,
  }));

  // Response shape for the frontend — paid entries are already bundled.
  const responseSongs = [
    ...paidEntries.map((e) => ({
      id: e.ids,                          // may be "id1,id2" for bundles
      recipient_name: e.recipient_names,
      paid: true as const,
      paid_at: e.paid_at,
      created_at: null,
      listen_url: e.listen_url,
      is_bundle: e.is_bundle,
      has_video_addon: e.has_video,
      stripe_payment_id: e.stripe_payment_id,
    })),
    ...unpaidEntries,
  ];

  // If the caller only asked to look up, we're done.
  if (action === 'lookup') {
    return respondJson(200, { ok: true, songs: responseSongs, emailSent: false });
  }

  // ── Email send ──
  let subject: string;
  let html: string;
  let plaintext: string;
  let category: string;
  let funnelStep: string;
  let songCount: number;

  if (which === 'paid') {
    if (paidEntries.length === 0) {
      console.log('[recover-song] no paid songs to email', { email });
      return respondJson(200, { ok: true, songs: responseSongs, emailSent: false });
    }
    const entriesToSend = filterStripePaymentId
      ? paidEntries.filter((e) => e.stripe_payment_id === filterStripePaymentId)
      : paidEntries;
    if (entriesToSend.length === 0) {
      console.log('[recover-song] stripe_payment_id filter matched no entries', { email, filterStripePaymentId });
      return respondJson(200, { ok: true, songs: responseSongs, emailSent: false });
    }
    const emailEntries: RecoveredSong[] = entriesToSend.map((e) => ({ recipient_names: e.recipient_names, listen_url: e.listen_url, is_bundle: e.is_bundle, has_video: e.has_video }));
    subject = entriesToSend.length === 1 && !entriesToSend[0].is_bundle
      ? '🎵 Aquí está tu canción de RegalosQueCantan'
      : '🎵 Aquí están tus canciones de RegalosQueCantan';
    html = buildPaidHtml(emailEntries);
    plaintext = buildPaidPlaintext(emailEntries);
    category = 'song_recovery';
    funnelStep = 'song_recovery_sent';
    songCount = entriesToSend.length;
  } else {
    if (unpaidEntries.length === 0) {
      console.log('[recover-song] no unpaid songs to email', { email });
      return respondJson(200, { ok: true, songs: responseSongs, emailSent: false });
    }
    const unpaidEmailEntries: UnpaidSong[] = unpaidEntries.map((e) => ({ recipient_name: e.recipient_name, listen_url: e.listen_url }));
    subject = unpaidEntries.length > 1
      ? '⏳ Tus canciones pendientes en RegalosQueCantan'
      : '⏳ Tu canción pendiente en RegalosQueCantan';
    html = buildUnpaidHtml(unpaidEmailEntries);
    plaintext = buildUnpaidPlaintext(unpaidEmailEntries);
    category = 'song_recovery_unpaid';
    funnelStep = 'song_recovery_unpaid_sent';
    songCount = unpaidEntries.length;
  }

  let emailSent = false;
  try {
    await sendEmail(email, subject, html, plaintext, category);
    await supabase.from('funnel_events').insert([
      {
        step: funnelStep,
        metadata: { email, which, song_count: songCount, ip: clientIp },
      },
    ]);
    emailSent = true;
    console.log('[recover-song] sent', { email, which, count: songCount });
  } catch (e) {
    console.error('[recover-song] sendEmail failed', e);
  }

  return respondJson(200, { ok: true, songs: responseSongs, emailSent });
});
