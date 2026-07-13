// supabase/functions/upsell-email-drip/index.ts
//
// Post-purchase UPSELL drip for song-only buyers. Someone bought a personalized
// song (platform 'es') but no add-on — this nudges them to make it "even more
// special": the $9.99 photo-video (hero), Animado $29, lyric video $9.99,
// instrumental $7.99, or the $5 scheduled SMS gift.
//
// WHY IT WORKS WITH ZERO NEW MONEY-PATH RISK: every CTA deep-links to the
// buyer's OWN /success page carrying song_ids + session_id (= songs
// .stripe_session_id). That page already hosts the saved-card ONE-TAP upsell
// (OneTapUpsell + charge-upsell), which is authorized by exactly that
// session_id and files every charge against the song_id. So "tracked to their
// song" is automatic and the confirm-before-charge step is the one that already
// ships. This function only SENDS EMAIL — it never charges.
//
// Two touches, both at-most-once (stamp-first, mirrors remind-upload-photos):
//   • Email 1 — ~30 min after purchase.            stamp: upsell_email_1_sent_at
//   • Email 2 — "última oportunidad", ~3 h later,   stamp: upsell_email_2_sent_at
//     and ONLY if they still haven't added anything.
//
// Audience filters (a buyer must pass ALL):
//   - paid = true, platform = 'es', valid email
//   - has a saved card (stripe_customer_id + stripe_payment_method_id) so the
//     one-tap actually works and the "un toque, tarjeta guardada" copy is true
//   - owns NO add-on: has_video_addon / karaoke_status / lyric_video_status /
//     karaoke_video_status all empty, no story_video_orders (Animado) row, no
//     non-failed upsell_charges row
//   - not on the marketing suppression list (email_unsubscribes)
//
// Runs via pg_cron every ~15 min. Manual modes:
//   POST { "dryRun": true }            -> report candidates, send nothing
//   POST { "testTo": "you@email.com" } -> send ONE sample of each touch to you
//
// Deploy: supabase functions deploy upsell-email-drip --project-ref yzbvajungshqcpusfiia
// (verify_jwt = false is pinned in supabase/config.toml — it's cron-invoked.)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders, isMarketingSuppressed } from '../_shared/unsubscribe.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;

const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';
const SITE_URL = 'https://regalosquecantan.com';

// Poster stills for each product tile. AI-generated (Higgsfield, 2026-07-04),
// then a play button was composited in (ffmpeg) so the tiles read as video in
// EVERY inbox — no fragile CSS overlay — and mirrored to our own public
// creative-studio bucket so the URLs never expire. To regenerate a tile: rebuild
// the JPG in scratchpad/posters and re-upload to the same object path.
const POSTERS = 'https://yzbvajungshqcpusfiia.supabase.co/storage/v1/object/public/creative-studio/email-posters';
const IMG = {
  hero: `${POSTERS}/hero.jpg`,
  lyric: `${POSTERS}/lyric.jpg`,
  instrumental: `${POSTERS}/instrumental.jpg`,
  sms: `${POSTERS}/sms.jpg`,
  animado: `${POSTERS}/animado-family.jpg`,
};

// Email 1: fire once the purchase is >= 30 min old but still fresh. The short
// max window means turning the drip ON doesn't blast the whole backlog — only
// people who bought in the last few hours are ever eligible for touch 1.
const EMAIL1_MIN_MINUTES = 30;
const EMAIL1_MAX_HOURS = 6;
// Email 2: fire ~3 h after touch 1, within a day, if still no add-on.
const EMAIL2_MIN_HOURS = 3;
const EMAIL2_MAX_HOURS = 24;
// Cap per run so a backlog can't turn one cron tick into a mass blast.
const MAX_PER_RUN = 40;

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Song = {
  id: string;
  recipient_name: string | null;
  sender_name: string | null;
  email: string | null;
  paid_at: string | null;
  stripe_session_id: string | null;
  upsell_email_1_sent_at?: string | null;
};

// ── One CTA URL → the buyer's own success page, one-tap-authorized by
//    session_id, with UTM + item so clicks attribute in funnel_events. ──
function ctaUrl(song: Song, campaign: string, item: string): string {
  const p = new URLSearchParams({
    song_ids: song.id,
    session_id: song.stripe_session_id || '',
    src: 'upsell_email',
    utm_source: 'email',
    utm_medium: 'upsell',
    utm_campaign: campaign,
    utm_content: item,
  });
  return `${SITE_URL}/success?${p.toString()}#hazlo-especial`;
}

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One e-commerce product card (3-up grid cell) with a poster still + play badge.
function card(img: string, tag: string, name: string, price: string, href: string): string {
  return `<td width="33%" valign="top" style="padding:5px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border:1px solid #ece2d1;border-radius:13px;overflow:hidden;">
      <tr><td style="padding:0;line-height:0;position:relative;">
        <img src="${img}" width="180" alt="${name}" style="display:block;width:100%;height:96px;object-fit:cover;border-radius:13px 13px 0 0;" />
      </td></tr>
      <tr><td style="padding:9px 11px 11px;">
        <p style="margin:0 0 6px;color:#8a7a86;font-size:9px;font-weight:bold;letter-spacing:.6px;font-family:Arial,sans-serif;">&#9654; ${tag}</p>
        <p style="margin:0;color:#241326;font-size:13px;font-weight:bold;font-family:Arial,sans-serif;">${name}</p>
        <table cellpadding="0" cellspacing="0" role="presentation" width="100%" style="margin-top:7px;"><tr>
          <td align="left" style="color:#c88a12;font-size:15px;font-weight:bold;font-family:Georgia,serif;">${price}</td>
          <td align="right"><a href="${href}" style="background:#7c3aed;color:#ffffff;text-decoration:none;font-size:11.5px;font-weight:bold;font-family:Arial,sans-serif;padding:7px 13px;border-radius:8px;display:inline-block;">Agregar</a></td>
        </tr></table>
      </td></tr>
    </table>
  </td>`;
}

function buildHtml(song: Song, lastChance: boolean): string {
  const name = esc(song.recipient_name?.trim() || 'tu ser querido');
  const campaign = lastChance ? 'upsell_drip_2' : 'upsell_drip_1';

  const eyebrow = lastChance
    ? '<span style="display:inline-block;background:#fbe4ea;color:#c02a5c;font-size:11px;font-weight:bold;letter-spacing:.4px;padding:5px 12px;border-radius:30px;font-family:Arial,sans-serif;">⏳ ÚLTIMA OPORTUNIDAD</span>'
    : '<span style="display:inline-block;background:#e7f6ee;color:#1f8a58;font-size:11px;font-weight:bold;letter-spacing:.4px;padding:5px 12px;border-radius:30px;font-family:Arial,sans-serif;">✓ PAGO CONFIRMADO · CANCIÓN LISTA</span>';

  const headline = lastChance
    ? `Antes de que se cierre: haz la canción de <span style="color:#e0447f;">${name}</span> aún más especial`
    : `La canción de <span style="color:#e0447f;">${name}</span> quedó preciosa.`;

  const leadP = lastChance
    ? 'Es el último recordatorio 💛 Estas sorpresas se agregan con un toque a tu tarjeta guardada — confirmas antes de cobrar.'
    : 'Ahora conviértela en un recuerdo que van a guardar para siempre 👇';

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:24px 12px;background:#efe7d9;font-family:Arial,'Helvetica Neue',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#fbf6ee;border:1px solid #e7ddca;border-radius:16px;overflow:hidden;">

  <tr><td align="center" style="padding:20px 26px 4px;">
    <span style="font-family:Georgia,serif;font-size:17px;color:#241326;font-weight:bold;">Regalos Que <span style="color:#c88a12;">Cantan</span> <span style="color:#e0447f;">&#9834;</span></span>
  </td></tr>

  <tr><td align="center" style="padding:12px 26px 2px;">
    ${eyebrow}
    <h1 style="font-family:Georgia,serif;color:#241326;font-size:24px;line-height:1.25;margin:12px 0 6px;font-weight:bold;">${headline}</h1>
    <p style="color:#6a5a66;font-size:14px;line-height:1.55;margin:0;">${leadP}</p>
  </td></tr>

  <tr><td style="padding:16px 22px 6px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#1c0f2e;border-radius:16px;overflow:hidden;border:1px solid #2c1a44;">
      <tr><td style="padding:0;line-height:0;">
        <img src="${IMG.hero}" width="552" alt="Video con sus fotos" style="display:block;width:100%;height:auto;border-radius:15px 15px 0 0;" />
      </td></tr>
      <tr><td align="center" style="padding:16px 20px 20px;">
        <p style="margin:0 0 8px;color:#f5b942;font-size:10px;font-weight:bold;letter-spacing:1px;font-family:Arial,sans-serif;">&#9654; MUESTRA REAL &nbsp;·&nbsp; 0:20</p>
        <h2 style="color:#ffffff;font-size:20px;font-weight:bold;line-height:1.28;margin:0 0 5px;font-family:Arial,sans-serif;">Sus fotos + su canción = <span style="color:#f5b942;">un video para llorar</span></h2>
        <p style="color:#c9b6e0;font-size:13px;line-height:1.45;margin:0 0 14px;">Hasta 15 fotos en un video cinematográfico. Tú las eliges, nosotros lo armamos.</p>
        <table cellpadding="0" cellspacing="0" role="presentation" align="center"><tr>
          <td style="padding-right:14px;font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#f5b942;">$9.99</td>
          <td style="background:#f5b942;border-radius:11px;">
            <a href="${ctaUrl(song, campaign, 'video')}" style="display:inline-block;color:#3a2505;text-decoration:none;font-size:15.5px;font-weight:bold;padding:14px 26px;font-family:Arial,sans-serif;">Crear su video &#8594;</a>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:14px 26px 2px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td width="38%" style="border-bottom:1px solid #e2d7c3;font-size:0;">&nbsp;</td>
      <td width="24%" align="center" style="color:#8a7a86;font-size:12px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap;font-family:Arial,sans-serif;">O agrégale una sorpresa</td>
      <td width="38%" style="border-bottom:1px solid #e2d7c3;font-size:0;">&nbsp;</td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:6px 16px 2px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      ${card(IMG.animado, 'ANIMADO', 'Película animada', '$29', ctaUrl(song, campaign, 'animado'))}
      ${card(IMG.lyric, 'CON LETRA', 'Video con letra', '$9.99', ctaUrl(song, campaign, 'lyric_video'))}
      ${card(IMG.instrumental, 'INSTRUMENTAL', 'Pista instrumental', '$7.99', ctaUrl(song, campaign, 'instrumental'))}
    </tr></table>
  </td></tr>

  <tr><td style="padding:8px 21px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border:1px solid #ece2d1;border-radius:14px;overflow:hidden;"><tr>
      <td width="38%" style="padding:0;line-height:0;">
        <img src="${IMG.sms}" width="210" alt="Enviar por mensaje" style="display:block;width:100%;height:100%;min-height:118px;object-fit:cover;" />
      </td>
      <td valign="middle" style="padding:14px 16px;">
        <p style="margin:0;color:#241326;font-size:16px;font-weight:bold;font-family:Arial,sans-serif;">Enviar por mensaje &#128172;</p>
        <p style="margin:4px 0 0;color:#8a7a86;font-size:12px;line-height:1.4;font-family:Arial,sans-serif;">Nosotros se la mandamos por SMS el día y la hora que elijas — con tu nombre.</p>
        <table cellpadding="0" cellspacing="0" role="presentation" width="100%" style="margin-top:11px;"><tr>
          <td align="left" style="color:#c88a12;font-size:18px;font-weight:bold;font-family:Georgia,serif;">$5</td>
          <td align="right"><a href="${ctaUrl(song, campaign, 'gift')}" style="background:#0f9d76;color:#ffffff;text-decoration:none;font-size:12.5px;font-weight:bold;font-family:Arial,sans-serif;padding:9px 17px;border-radius:9px;display:inline-block;">Agregar</a></td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>

  <tr><td align="center" style="padding:16px 22px 4px;color:#8a7a86;font-size:11.5px;line-height:1.6;">
    &#128274; <span style="color:#2fa36b;font-weight:bold;">Un solo toque</span> · confirmas antes de cobrar a tu tarjeta guardada · todo se liga a la canción de ${name}
  </td></tr>

  <tr><td align="center" style="padding:16px 26px 26px;color:#a596a0;font-size:11px;line-height:1.6;">
    <span style="font-family:Georgia,serif;color:#6a5a66;font-size:14px;font-weight:bold;">Regalos Que Cantan &#9834;</span><br>
    Te escribimos porque compraste la canción de ${name}.<br>
    <a href="${SITE_URL}/success?song_ids=${song.id}" style="color:#a596a0;text-decoration:underline;">Ver la canción</a> &nbsp;·&nbsp; {{UNSUB}}
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function buildPlaintext(song: Song, lastChance: boolean): string {
  const name = song.recipient_name?.trim() || 'tu ser querido';
  const campaign = lastChance ? 'upsell_drip_2' : 'upsell_drip_1';
  const url = ctaUrl(song, campaign, 'video');
  return [
    lastChance ? `Última oportunidad para hacer la canción de ${name} aún más especial`
               : `La canción de ${name} ya está lista — hazla inolvidable`,
    ``,
    `EL MÁS PEDIDO — Video con sus fotos ($9.99)`,
    `Hasta 15 fotos convertidas en un video al ritmo de su canción.`,
    `  ${url}`,
    ``,
    `O agrega otra sorpresa (un toque, confirmas antes de cobrar a tu tarjeta guardada):`,
    `  • Película animada — $29`,
    `  • Video con letra — $9.99`,
    `  • Pista instrumental — $7.99`,
    `  • Enviar por mensaje (SMS programado) — $5`,
    ``,
    `Todo se liga automáticamente a la canción de ${name}.`,
    `Abrir: ${ctaUrl(song, campaign, 'grid')}`,
    ``,
    `¿Necesitas ayuda? hola@regalosquecantan.com`,
  ].join('\n');
}

async function sendEmail(supabase: any, to: string, subject: string, song: Song, lastChance: boolean): Promise<void> {
  const unsubUrl = (await buildUnsubscribeHeaders(to))['List-Unsubscribe']?.match(/<(https[^>]+)>/)?.[1] || '';
  const unsubAnchor = unsubUrl
    ? `<a href="${unsubUrl}" style="color:#a596a0;text-decoration:underline;">Cancelar estos correos</a>`
    : `<a href="mailto:hola@regalosquecantan.com?subject=unsubscribe" style="color:#a596a0;text-decoration:underline;">Cancelar estos correos</a>`;

  const html = buildHtml(song, lastChance).replace('{{UNSUB}}', unsubAnchor);
  const text = buildPlaintext(song, lastChance);

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
      categories: [lastChance ? 'upsell_offer_2' : 'upsell_offer_1', 'rqc'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false },
      },
      headers: await buildUnsubscribeHeaders(to),
    }),
  });
  if (!response.ok) {
    const t = await response.text();
    throw new Error(`SendGrid ${response.status}: ${t}`);
  }
}

const SUBJECT_1 = (name: string) => `Haz la canción de ${name} aún más especial 🎬`;
const SUBJECT_2 = (name: string) => `⏳ Última oportunidad: el video de ${name}`;

// Given candidate songs, drop any that already own an add-on (checkout-time OR
// a post-purchase one-tap). Returns the still-song-only subset.
async function filterSongOnly(supabase: any, songs: Song[]): Promise<Song[]> {
  if (songs.length === 0) return [];
  const ids = songs.map((s) => s.id);
  const owns = new Set<string>();

  const { data: animado } = await supabase
    .from('story_video_orders').select('song_id').in('song_id', ids);
  for (const r of animado ?? []) owns.add(r.song_id);

  const { data: charges } = await supabase
    .from('upsell_charges').select('song_id, status').in('song_id', ids).neq('status', 'failed');
  for (const r of charges ?? []) owns.add(r.song_id);

  return songs.filter((s) => !owns.has(s.id));
}

serve(async (req) => {
  let opts: { dryRun?: boolean; testTo?: string } = {};
  if (req.method === 'POST') {
    try { opts = await req.json(); } catch { /* empty body = real cron run */ }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = Date.now();

  // Base column list + the add-on flags we exclude on at the SQL layer.
  const COLS = 'id, recipient_name, sender_name, email, paid_at, stripe_session_id, upsell_email_1_sent_at';
  // Only card-on-file, no-add-on, Spanish, paid songs are ever eligible.
  const baseFilter = (q: any) => q
    .eq('paid', true)
    .eq('platform', 'es')
    .not('stripe_session_id', 'is', null)
    .not('stripe_customer_id', 'is', null)
    .not('stripe_payment_method_id', 'is', null)
    .not('has_video_addon', 'is', true)
    .is('karaoke_status', null)
    .is('lyric_video_status', null)
    .is('karaoke_video_status', null);

  // ── EMAIL 1 candidates: 30 min .. 6 h old, not yet touched ──
  const e1Min = new Date(now - EMAIL1_MIN_MINUTES * 60 * 1000).toISOString();
  const e1Max = new Date(now - EMAIL1_MAX_HOURS * 3600 * 1000).toISOString();
  const { data: e1raw, error: e1err } = await baseFilter(
    supabase.from('songs').select(COLS)
      .is('upsell_email_1_sent_at', null)
      .lte('paid_at', e1Min)
      .gte('paid_at', e1Max),
  ).order('paid_at', { ascending: true }).limit(MAX_PER_RUN * 3);
  if (e1err) { console.error('[upsell-drip] e1 query:', e1err); return json(500, { error: e1err.message }); }

  // ── EMAIL 2 candidates: touch 1 was 3 h .. 24 h ago, no touch 2 yet ──
  const e2Min = new Date(now - EMAIL2_MIN_HOURS * 3600 * 1000).toISOString();
  const e2Max = new Date(now - EMAIL2_MAX_HOURS * 3600 * 1000).toISOString();
  const { data: e2raw, error: e2err } = await baseFilter(
    supabase.from('songs').select(COLS)
      .not('upsell_email_1_sent_at', 'is', null)
      .is('upsell_email_2_sent_at', null)
      .lte('upsell_email_1_sent_at', e2Min)
      .gte('upsell_email_1_sent_at', e2Max),
  ).order('upsell_email_1_sent_at', { ascending: true }).limit(MAX_PER_RUN * 3);
  if (e2err) { console.error('[upsell-drip] e2 query:', e2err); return json(500, { error: e2err.message }); }

  const e1valid = (e1raw ?? []).filter((s: Song) => s.email && VALID_EMAIL.test(s.email));
  const e2valid = (e2raw ?? []).filter((s: Song) => s.email && VALID_EMAIL.test(s.email));
  const e1 = (await filterSongOnly(supabase, e1valid)).slice(0, MAX_PER_RUN);
  const e2 = (await filterSongOnly(supabase, e2valid)).slice(0, MAX_PER_RUN);

  // ── Dry run — report only, no send, no stamp ──
  if (opts.dryRun) {
    return json(200, {
      dryRun: true,
      email1_eligible: e1.length,
      email2_eligible: e2.length,
      sample1: e1.slice(0, 5).map((s) => ({ song_id: s.id, name: s.recipient_name, email: s.email, paid_at: s.paid_at, url: ctaUrl(s, 'upsell_drip_1', 'video') })),
      sample2: e2.slice(0, 5).map((s) => ({ song_id: s.id, name: s.recipient_name, email: s.email, sent1: s.upsell_email_1_sent_at })),
    });
  }

  // ── Test send — one of EACH touch to the owner, no stamping ──
  if (opts.testTo) {
    const s1 = e1[0] ?? e2[0] ?? e1valid[0] ?? e2valid[0];
    if (!s1) return json(200, { test: true, note: 'no candidate song to sample from' });
    await sendEmail(supabase, opts.testTo, SUBJECT_1(s1.recipient_name || 'tu ser querido'), s1, false);
    await sendEmail(supabase, opts.testTo, SUBJECT_2(s1.recipient_name || 'tu ser querido'), s1, true);
    return json(200, { test: true, sentTo: opts.testTo, sampleSong: s1.id });
  }

  // ── Real run ──
  const summary = { email1_sent: 0, email1_failed: 0, email2_sent: 0, email2_failed: 0 };

  for (const s of e1) {
    if (await isMarketingSuppressed(supabase, s.email!)) continue;
    // Stamp FIRST (at-most-once); guard on still-null so overlapping ticks can't double-send.
    const { data: stamped } = await supabase.from('songs')
      .update({ upsell_email_1_sent_at: new Date().toISOString() })
      .eq('id', s.id).is('upsell_email_1_sent_at', null).select('id');
    if (!stamped || stamped.length === 0) continue;
    try {
      await sendEmail(supabase, s.email!, SUBJECT_1(s.recipient_name || 'tu ser querido'), s, false);
      summary.email1_sent++;
      await supabase.from('email_logs').insert({ song_id: s.id, email: s.email, recipient_name: s.recipient_name, email_type: 'upsell_offer_1', subject: SUBJECT_1(s.recipient_name || ''), status: 'sent' });
    } catch (err) {
      summary.email1_failed++;
      const msg = (err as Error).message;
      console.error(`[upsell-drip] e1 send failed ${s.id}:`, msg);
      await supabase.from('songs').update({ upsell_email_1_sent_at: null }).eq('id', s.id);
      await supabase.from('email_logs').insert({ song_id: s.id, email: s.email, recipient_name: s.recipient_name, email_type: 'upsell_offer_1', subject: SUBJECT_1(s.recipient_name || ''), status: 'failed', error_message: msg });
    }
  }

  for (const s of e2) {
    if (await isMarketingSuppressed(supabase, s.email!)) continue;
    const { data: stamped } = await supabase.from('songs')
      .update({ upsell_email_2_sent_at: new Date().toISOString() })
      .eq('id', s.id).is('upsell_email_2_sent_at', null).select('id');
    if (!stamped || stamped.length === 0) continue;
    try {
      await sendEmail(supabase, s.email!, SUBJECT_2(s.recipient_name || 'tu ser querido'), s, true);
      summary.email2_sent++;
      await supabase.from('email_logs').insert({ song_id: s.id, email: s.email, recipient_name: s.recipient_name, email_type: 'upsell_offer_2', subject: SUBJECT_2(s.recipient_name || ''), status: 'sent' });
    } catch (err) {
      summary.email2_failed++;
      const msg = (err as Error).message;
      console.error(`[upsell-drip] e2 send failed ${s.id}:`, msg);
      await supabase.from('songs').update({ upsell_email_2_sent_at: null }).eq('id', s.id);
      await supabase.from('email_logs').insert({ song_id: s.id, email: s.email, recipient_name: s.recipient_name, email_type: 'upsell_offer_2', subject: SUBJECT_2(s.recipient_name || ''), status: 'failed', error_message: msg });
    }
  }

  return json(200, summary);
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), { headers: { 'Content-Type': 'application/json' }, status });
}
