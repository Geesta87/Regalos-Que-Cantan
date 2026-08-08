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
//
// 2026-08-08: repo re-synced from the DEPLOYED version (which had migrated to
// the shared email shell while the repo still carried the old hand-rolled
// HTML), plus one addition: each paid song card now carries a "déjanos 5
// estrellas" link to /calificar?song_id=<id> — the real-review capture that
// legitimately earns star ratings in Google results.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders } from '../_shared/unsubscribe.ts';
import { renderEmail } from '../_shared/email-shell.ts';

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

type RecoveredSong = { recipient_names: string; listen_url: string; is_bundle: boolean; has_video: boolean; review_song_id: string };

// Migrated to the shared brand shell. Each song keeps its exact listen_url
// (paid → /song/ or /success; passed straight through, never rebuilt here).
function buildPaidHtml(entries: RecoveredSong[]): string {
  return renderEmail({
    palette: 'confirm',
    hero: 'vinyl',
    preheader: 'Tus canciones de RegalosQueCantan están listas — toca el botón para escucharlas.',
    eyebrow: 'Tus canciones',
    headline: 'Tus canciones ya est&aacute;n <span style="color:#8fe6b8;">listas</span>.',
    sub: 'Toca el bot&oacute;n de cada una para escucharla, descargarla y compartirla. Estos enlaces nunca expiran &mdash; gu&aacute;rdalos.',
    songRows: entries.map((e) => ({
      name: e.recipient_names,
      href: e.listen_url,
      label: e.has_video ? '&#127909;&nbsp; Ver video y descargar' : '&#9654;&nbsp; Escuchar y descargar',
      sub: e.review_song_id
        ? { text: '&#11088; &iquest;Te encant&oacute;? D&eacute;janos 5 estrellas &mdash; toma 10 segundos', href: `${SITE_URL}/calificar?song_id=${e.review_song_id}` }
        : undefined,
    })),
  });
}

function buildPaidPlaintext(entries: RecoveredSong[]): string {
  const lines: string[] = ['Aquí están tus canciones de RegalosQueCantan', ''];
  for (const e of entries) {
    const tag = e.has_video ? ' (canción + video)' : e.is_bundle ? ' (paquete 2 canciones)' : '';
    lines.push(`• Para ${e.recipient_names}${tag}`);
    lines.push(`  ${e.listen_url}`);
    if (e.review_song_id) lines.push(`  ¿Te encantó? Déjanos 5 estrellas: ${SITE_URL}/calificar?song_id=${e.review_song_id}`);
    lines.push('');
  }
  lines.push('Estos enlaces nunca expiran.');
  lines.push('¿Necesitas ayuda? hola@regalosquecantan.com');
  return lines.join('\n');
}

type UnpaidSong = { recipient_name: string; listen_url: string };

// Migrated to the shared brand shell. Each song keeps its exact listen_url
// (unpaid → /listen? preview+buy page; passed straight through, never rebuilt).
function buildUnpaidHtml(songs: UnpaidSong[]): string {
  return renderEmail({
    palette: 'preview',
    hero: 'vinyl',
    preheader: 'Tienes canciones listas pendientes de comprar en RegalosQueCantan.',
    eyebrow: 'Listas &middot; pendientes de comprar',
    headline: 'Tus canciones te <span style="color:#a9c4f0;">esperan</span>.',
    sub: 'Ya est&aacute;n listas. Compl&eacute;talas para descargarlas, compartirlas y guardarlas para siempre.',
    songRows: songs.map((s) => ({
      name: s.recipient_name,
      href: s.listen_url,
      label: '&#9654;&nbsp; Escuchar y comprar',
    })),
  });
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
      headers: await buildUnsubscribeHeaders(to),
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
  let filterGroupKey: string | null = null;
  try {
    const body = await req.json();
    email = String(body?.email || '').trim().toLowerCase();
    if (body?.action === 'send' || body?.action === 'lookup') {
      action = body.action;
    }
    if (body?.which === 'paid' || body?.which === 'unpaid') {
      which = body.which;
    }
    // Optional: restrict a paid-send to one specific purchase group.
    // group_key is whichever of stripe_payment_id / stripe_session_id was
    // used as the bundle key (returned by the lookup response).
    if (body?.group_key && typeof body.group_key === 'string') {
      filterGroupKey = body.group_key;
    } else if (body?.stripe_payment_id && typeof body.stripe_payment_id === 'string') {
      // backwards-compat: older clients may still send stripe_payment_id
      filterGroupKey = body.stripe_payment_id;
    }
  } catch {
    return respondJson(400, { ok: false, error: 'invalid body' });
  }

  if (!email || !isValidEmail(email)) {
    return respondJson(400, { ok: false, error: 'invalid email' });
  }

  const xfwd = req.headers.get('x-forwarded-for') || '';
  const clientIp = xfwd.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || 'unknown';

  // Trusted server-to-server caller (auto-send-paid-email cron). The gateway
  // only accepts anon/user JWTs as Bearer, so internal callers authenticate
  // via this extra header instead. Bypasses ONLY the per-IP rate limit —
  // every other code path is identical to a customer request.
  const isInternal =
    (req.headers.get('x-internal-auth') || '') === SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Per-IP rate limit using funnel_events as a lightweight counter.
  if (!isInternal) {
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
    .select('id, recipient_name, paid, paid_at, created_at, audio_url, stripe_payment_id, stripe_session_id, has_video_addon, karaoke_video_status, karaoke_status')
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

  // Group by stripe_payment_id first, fall back to stripe_session_id.
  // Both songs in a 2-song bundle share the same checkout session, so even
  // when stripe_payment_id is null the session ID ties them together.
  const bundleMap = new Map<string, typeof paidRows>();
  const soloPaidRows: typeof paidRows = [];
  for (const s of paidRows) {
    const groupKey = s.stripe_payment_id || s.stripe_session_id;
    if (groupKey) {
      const grp = bundleMap.get(groupKey);
      if (grp) grp.push(s);
      else bundleMap.set(groupKey, [s]);
    } else {
      soloPaidRows.push(s);
    }
  }

  // Each entry represents one card in the email / one row on the page.
  // Anyone who bought ANY upsell (video, karaoke video, or instrumental) routes to
  // /success?song_ids= — the only page that surfaces all of it (song + video +
  // karaoke + instrumental). Plain audio-only orders route to /song/ (SongPage).
  // (has_video stays the TRUE video flag, separate from the routing decision.)
  const isUpsell = (s: Record<string, unknown>) =>
    s.has_video_addon === true || s.karaoke_video_status != null || s.karaoke_status != null;
  type PaidEntry = { ids: string; recipient_names: string; listen_url: string; paid_at: string | null; is_bundle: boolean; has_video: boolean; stripe_payment_id: string | null; group_key: string | null };
  const paidEntries: PaidEntry[] = [];
  for (const [groupKey, grp] of bundleMap) {
    const ids = grp.map((s) => s.id).join(',');
    const names = grp.map((s) => (s.recipient_name || 'tu ser querido').trim()).join(' y ');
    const hasVideo = grp.some((s) => s.has_video_addon === true);
    const hasUpsell = grp.some(isUpsell);
    const url = hasUpsell ? `${SITE_URL}/success?song_ids=${ids}` : `${SITE_URL}/song/${ids}`;
    paidEntries.push({ ids, recipient_names: names, listen_url: url, paid_at: grp[0].paid_at || null, is_bundle: grp.length > 1, has_video: hasVideo, stripe_payment_id: grp[0].stripe_payment_id || null, group_key: groupKey });
  }
  for (const s of soloPaidRows) {
    const hasVideo = s.has_video_addon === true;
    const url = isUpsell(s) ? `${SITE_URL}/success?song_ids=${s.id}` : `${SITE_URL}/song/${s.id}`;
    paidEntries.push({ ids: s.id, recipient_names: (s.recipient_name || 'tu ser querido').trim(), listen_url: url, paid_at: s.paid_at || null, is_bundle: false, has_video: hasVideo, stripe_payment_id: s.stripe_payment_id || null, group_key: null });
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
      group_key: e.group_key,
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
    const entriesToSend = filterGroupKey
      ? paidEntries.filter((e) => e.group_key === filterGroupKey)
      : paidEntries;
    if (entriesToSend.length === 0) {
      console.log('[recover-song] group_key filter matched no entries', { email, filterGroupKey });
      return respondJson(200, { ok: true, songs: responseSongs, emailSent: false });
    }
    const emailEntries: RecoveredSong[] = entriesToSend.map((e) => ({
      recipient_names: e.recipient_names, listen_url: e.listen_url, is_bundle: e.is_bundle, has_video: e.has_video,
      review_song_id: String(e.ids).split(',')[0].trim(),
    }));
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
