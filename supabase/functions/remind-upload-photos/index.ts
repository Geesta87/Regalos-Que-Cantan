// supabase/functions/remind-upload-photos/index.ts
//
// Plugs the biggest leak in the photo-video upsell: customers who PAID for the
// video addon at checkout but never returned to upload their photos, so no
// video is ever made. Audited 2026-06-14 — 97 such orders (~$900) with NO
// reminder email existing. This is that reminder.
//
// Source of truth is songs.has_video_addon = true (NOT video_orders), because
// the video_orders row is only created lazily when the customer opens the
// success page — 24 paying customers had no video_orders row at all. We key off
// the song so those are covered too.
//
// A customer is reminded once when their order is:
//   - paid (has_video_addon = true, paid = true)
//   - between MIN_AGE_HOURS and MAX_AGE_DAYS old (give them a chance to upload
//     on their own first; don't pester people who bought weeks ago)
//   - not yet delivered (songs.has_video is not true)
//   - has NOT uploaded photos / started a render (no video_orders row with
//     photo_count > 0 or status in photos_uploaded/processing/completed)
//   - not already reminded (songs.video_photo_reminder_sent_at is null)
//
// Stamp-first (at-most-once): we set video_photo_reminder_sent_at BEFORE
// sending, mirroring auto-send-paid-email, so a crash can never double-send.
//
// Runs via pg_cron every 30 min. Also supports a manual dry run:
//   POST { "dryRun": true }            -> returns candidates, sends nothing
//   POST { "testTo": "you@email.com" } -> sends ONE sample to that address only
//
// Deploy: supabase functions deploy remind-upload-photos --project-ref yzbvajungshqcpusfiia
// (verify_jwt = false is pinned in supabase/config.toml — it's cron-invoked.)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders } from '../_shared/unsubscribe.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;

const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';
const SITE_URL = 'https://regalosquecantan.com';

// Give buyers a window to upload on their own before nudging, but don't
// resurrect ancient orders (the gift moment has likely passed).
const MIN_AGE_HOURS = 3;
const MAX_AGE_DAYS = 7;
// Cap per run so a backlog can't turn one cron tick into a mass blast.
const MAX_PER_RUN = 25;

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildHtml(recipientName: string, uploadUrl: string): string {
  const name = recipientName?.trim() || 'tu ser querido';
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:32px 16px;background-color:#f4f0eb;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Solo falta un paso: sube tus fotos y creamos tu video musical.</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">
  <tr><td style="background-color:#1a0e08;border-radius:16px 16px 0 0;padding:36px 32px 28px;text-align:center;">
    <img src="https://regalosquecantan.com/images/logo.png" alt="Regalos Que Cantan" width="140" style="display:block;margin:0 auto 20px;width:140px;border:0;" />
    <p style="color:#7c3aed;font-size:11px;font-weight:700;margin:0 0 10px;letter-spacing:2px;text-transform:uppercase;">&#127909; Tu video musical</p>
    <h1 style="color:#ffffff;font-size:22px;font-weight:800;margin:0 0 8px;line-height:1.3;">Solo falta un paso</h1>
    <p style="color:#c9b99a;font-size:14px;margin:0;line-height:1.6;">Ya pagaste tu video &mdash; sube tus fotos y lo creamos al instante.</p>
  </td></tr>
  <tr><td style="background-color:#ffffff;padding:28px 32px;border-left:1px solid #e8e0d5;border-right:1px solid #e8e0d5;border-bottom:1px solid #f0e8de;text-align:center;">
    <p style="color:#1a0e08;font-size:18px;font-weight:700;margin:0 0 8px;line-height:1.4;">El video para <span style="color:#e05a1a;">${name}</span> est&aacute; casi listo</p>
    <p style="color:#5a4636;font-size:14px;margin:0 0 22px;line-height:1.6;">Elige tus fotos favoritas y las unimos con la canci&oacute;n para hacer un video que se puede compartir y guardar para siempre.</p>
    <table cellpadding="0" cellspacing="0" align="center"><tr><td style="background-color:#7c3aed;border-radius:8px;">
      <a href="${uploadUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:15px 32px;">&#128247;&nbsp; Subir mis fotos</a>
    </td></tr></table>
    <p style="color:#8a7060;font-size:12px;margin:20px 0 0;line-height:1.5;">Puedes subir hasta 15 fotos. Tarda menos de 2 minutos.</p>
  </td></tr>
  <tr><td style="background-color:#1a0e08;border-radius:0 0 16px 16px;padding:24px 32px;text-align:center;">
    <p style="color:#a67c52;font-size:12px;margin:0 0 4px;">Este enlace nunca expira &mdash; gu&aacute;rdalo.</p>
    <p style="color:#a67c52;font-size:12px;margin:0;">&iquest;Necesitas ayuda? <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;text-decoration:none;">hola@regalosquecantan.com</a></p>
    <p style="color:#4a2c1a;font-size:11px;margin:10px 0 0;">&copy; ${new Date().getFullYear()} Regalos Que Cantan</p>
    <p style="color:#4a2c1a;font-size:10px;margin:6px 0 0;">Regalos Que Cantan &bull; Los Angeles, CA 91324, USA</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildPlaintext(recipientName: string, uploadUrl: string): string {
  const name = recipientName?.trim() || 'tu ser querido';
  return [
    `Solo falta un paso para tu video musical`,
    ``,
    `Ya pagaste el video para ${name}. Sube tus fotos y lo creamos al instante:`,
    `  ${uploadUrl}`,
    ``,
    `Puedes subir hasta 15 fotos. Tarda menos de 2 minutos.`,
    `Este enlace nunca expira.`,
    `¿Necesitas ayuda? hola@regalosquecantan.com`,
  ].join('\n');
}

async function sendEmail(to: string, subject: string, html: string, plaintext: string): Promise<void> {
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
      categories: ['photo_upload_reminder', 'rqc'],
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

const SUBJECT = '📸 Solo falta un paso: sube tus fotos para tu video';

serve(async (req) => {
  let opts: { dryRun?: boolean; testTo?: string } = {};
  if (req.method === 'POST') {
    try { opts = await req.json(); } catch { /* empty body = real cron run */ }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const nowIso = new Date().toISOString();
  const minAgeIso = new Date(Date.now() - MIN_AGE_HOURS * 3600 * 1000).toISOString();
  const maxAgeIso = new Date(Date.now() - MAX_AGE_DAYS * 86400 * 1000).toISOString();

  // 1) Songs that paid for a video addon, not yet delivered, not yet reminded,
  //    inside the reminder window.
  const { data: candidateSongs, error: songErr } = await supabase
    .from('songs')
    .select('id, recipient_name, email, paid_at')
    .eq('has_video_addon', true)
    .eq('paid', true)
    .is('video_photo_reminder_sent_at', null)
    .not('has_video', 'is', true)
    .lte('paid_at', minAgeIso)
    .gte('paid_at', maxAgeIso)
    .order('paid_at', { ascending: true })
    .limit(MAX_PER_RUN * 2); // over-fetch; some get filtered out below

  if (songErr) {
    console.error('[remind-upload-photos] song query error:', songErr);
    return new Response(JSON.stringify({ error: songErr.message }), { status: 500 });
  }

  const songs = (candidateSongs ?? []).filter((s) => s.email && VALID_EMAIL.test(s.email));
  if (songs.length === 0) {
    return new Response(JSON.stringify({ checked: 0, sent: 0 }), {
      headers: { 'Content-Type': 'application/json' }, status: 200,
    });
  }

  // 2) Exclude anyone who already uploaded photos or has a render going.
  const songIds = songs.map((s) => s.id);
  const { data: activeOrders } = await supabase
    .from('video_orders')
    .select('song_id, photo_count, status')
    .in('song_id', songIds);

  const alreadyStarted = new Set<string>();
  for (const o of activeOrders ?? []) {
    if ((o.photo_count ?? 0) > 0 || ['photos_uploaded', 'processing', 'completed'].includes(o.status)) {
      alreadyStarted.add(o.song_id);
    }
  }

  const eligible = songs.filter((s) => !alreadyStarted.has(s.id)).slice(0, MAX_PER_RUN);

  // ── Dry run: report who WOULD be emailed, send nothing, stamp nothing ──
  if (opts.dryRun) {
    return new Response(JSON.stringify({
      dryRun: true,
      eligible: eligible.length,
      sample: eligible.slice(0, 10).map((s) => ({
        song_id: s.id, recipient_name: s.recipient_name, email: s.email, paid_at: s.paid_at,
        upload_url: `${SITE_URL}/success?song_ids=${s.id}`,
      })),
    }, null, 2), { headers: { 'Content-Type': 'application/json' }, status: 200 });
  }

  // ── Test send: one sample email to the owner, no stamping ──
  if (opts.testTo) {
    const s = eligible[0] ?? songs[0];
    const url = `${SITE_URL}/success?song_ids=${s.id}`;
    await sendEmail(opts.testTo, SUBJECT, buildHtml(s.recipient_name, url), buildPlaintext(s.recipient_name, url));
    return new Response(JSON.stringify({ test: true, sentTo: opts.testTo, sampleSong: s.id }), {
      headers: { 'Content-Type': 'application/json' }, status: 200,
    });
  }

  // ── Real run ──
  let sent = 0, failed = 0;
  const results: Array<{ song_id: string; ok: boolean; error?: string }> = [];

  for (const s of eligible) {
    // Stamp FIRST (at-most-once). Guard on still-null so two overlapping cron
    // ticks can't both claim the same song.
    const { data: stamped, error: stampErr } = await supabase
      .from('songs')
      .update({ video_photo_reminder_sent_at: nowIso })
      .eq('id', s.id)
      .is('video_photo_reminder_sent_at', null)
      .select('id');

    if (stampErr || !stamped || stamped.length === 0) {
      // Lost the race or stamp failed — skip, don't send.
      continue;
    }

    const url = `${SITE_URL}/success?song_ids=${s.id}`;
    try {
      await sendEmail(s.email, SUBJECT, buildHtml(s.recipient_name, url), buildPlaintext(s.recipient_name, url));
      sent++;
      results.push({ song_id: s.id, ok: true });
      await supabase.from('email_logs').insert({
        song_id: s.id, email: s.email, recipient_name: s.recipient_name,
        email_type: 'photo_upload_reminder', subject: SUBJECT, status: 'sent',
      });
    } catch (err) {
      failed++;
      const msg = (err as Error).message;
      results.push({ song_id: s.id, ok: false, error: msg });
      console.error(`[remind-upload-photos] send failed for ${s.id}:`, msg);
      // Roll the stamp back so a transient SendGrid error gets retried next run.
      await supabase.from('songs')
        .update({ video_photo_reminder_sent_at: null })
        .eq('id', s.id);
      await supabase.from('email_logs').insert({
        song_id: s.id, email: s.email, recipient_name: s.recipient_name,
        email_type: 'photo_upload_reminder', subject: SUBJECT, status: 'failed', error_message: msg,
      });
    }
  }

  return new Response(JSON.stringify({ checked: eligible.length, sent, failed, results }, null, 2), {
    headers: { 'Content-Type': 'application/json' }, status: 200,
  });
});
