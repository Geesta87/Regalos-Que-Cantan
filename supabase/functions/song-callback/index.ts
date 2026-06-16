// supabase/functions/song-callback/index.ts
// Receives webhook from Kie.ai (Suno) when a song generation task completes.
// Three callback stages: text → first → complete (or "error").
// We only act on "complete" (and "error") — earlier stages are logged.
// Looks up rows by kie_task_id, maps data[0]→v1 and data[1]→v2,
// marks them completed with the Kie CDN URL (needs_reupload=true so
// poll-processing-songs can later re-upload to Supabase Storage).
// Always returns 200 so Kie.ai doesn't retry.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders } from '../_shared/unsubscribe.ts';
import { buildEmailParts } from '../_shared/email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

// ============================================================================
// EMAIL HELPERS — same template/category as mureka-useapi-callback
// ============================================================================

async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string,
  category: string = 'transactional',
  preheader: string = '',
) {
  if (!SENDGRID_API_KEY) return null;
  try {
    const { html: finalHtml, text: finalText } = buildEmailParts(htmlContent, preheader);
    return await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: SENDER_EMAIL, name: SENDER_NAME },
        reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
        subject,
        // text/plain MUST come before text/html (RFC 2046 multipart/alternative).
        content: [
          { type: 'text/plain', value: finalText },
          { type: 'text/html', value: finalHtml },
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
  } catch (e) {
    console.error('Email error:', e);
    return null;
  }
}

function getPreviewReadyEmailHtml(song: any, previewLink: string) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const songTitle = song.song_title || `Canción para ${song.recipient_name || 'ti'}`;
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Righteous&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;padding:0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;">
<tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:50px 30px 40px;text-align:center;">
<p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px;">&#10024; TU REGALO TE EST&Aacute; ESPERANDO &#10024;</p>
<h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:36px;margin:0 0 4px;font-weight:400;">Oye, ${firstName}...</h1>
<h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 24px;font-weight:400;">Tu canci&oacute;n ya <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">est&aacute; viva.</span></h2>
<p style="color:#c9b99a;font-size:16px;margin:0;line-height:1.7;">Letra, melod&iacute;a y emoci&oacute;n &mdash; todo est&aacute; listo. Solo<br>falta <em>un paso</em> para que llegue al coraz&oacute;n de quien amas.</p></td></tr>
<tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
<a href="${previewLink}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">&#127925; Terminar Mi Canci&oacute;n</a></td></tr>
<tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;"><p style="color:#a67c52;font-size:13px;margin:0;">&#127873; Tu progreso se guarda por 24 horas &middot; Sin compromiso</p></td></tr>
<tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background-color:#1a0e08;padding:40px 30px 10px;text-align:center;"><p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">&#127911; VISTA PREVIA DE TU CANCI&Oacute;N</p>
<h3 style="font-family:'Righteous',cursive;color:#ffffff;font-size:24px;margin:0 0 24px;font-weight:400;">Tu regalo ya tiene voz</h3></td></tr>
<tr><td style="background-color:#1a0e08;padding:0 30px 30px;"><table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;"><tr>
<td width="120" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
<div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
<p style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">PREVIA</p></td>
<td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:20px 24px;vertical-align:middle;">
<p style="color:#ff6b35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">TU CANCI&Oacute;N PERSONALIZADA</p>
<p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">${songTitle}</p>
<p style="color:#a67c52;font-size:13px;margin:0;">Hecha con amor para <strong style="color:#ffd23f;">${song.recipient_name || 'tu ser querido'}</strong> &middot; Estilo: <span style="text-transform:capitalize;">${song.genre || 'Musical'}</span></p></td></tr></table></td></tr>
<tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;"><p style="color:#c9b99a;font-size:15px;margin:0;">&iquest;Te gusta? Compra la canci&oacute;n completa por solo <strong style="color:#ff6b35;">$29.99 USD</strong></p></td></tr>
<tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background-color:#1a0e08;padding:30px;text-align:center;">
<p style="color:#a67c52;font-size:12px;margin:0 0 10px;">&iquest;Preguntas? Escr&iacute;benos a<br><a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a></p>
<p style="color:#4a2c1a;font-size:11px;margin:0;">&copy; 2026 Regalos Que Cantan. Hecho con &#10084;&#65039; para ti.</p></td></tr>
</table></td></tr></table></body></html>`;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const body = await req.json().catch(() => ({}));
    console.log('=== KIE.AI CALLBACK ===');
    console.log('code:', body.code, 'msg:', body.msg, 'callbackType:', body.data?.callbackType, 'task_id:', body.data?.task_id);

    const taskId: string | undefined = body?.data?.task_id;
    const callbackType: string | undefined = body?.data?.callbackType;
    const tracks: any[] = Array.isArray(body?.data?.data) ? body.data.data : [];

    if (!taskId) {
      console.warn('No task_id in callback payload');
      return new Response(JSON.stringify({ ok: true, action: 'no_task_id' }),
        { headers: responseHeaders, status: 200 });
    }

    // Always 200 to Kie. We only act on terminal stages.
    if (callbackType !== 'complete' && callbackType !== 'error' && body.code === 200) {
      console.log(`Stage '${callbackType}' — ignoring (waiting for 'complete')`);
      return new Response(JSON.stringify({ ok: true, action: 'stage_ignored', stage: callbackType }),
        { headers: responseHeaders, status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Look up rows by kie_task_id (both v1 and v2, ordered v1 first)
    const { data: dbSongs, error: lookupError } = await supabase
      .from('songs')
      .select('id, version, recipient_name, sender_name, email, genre, occasion, status, kie_task_id')
      .eq('kie_task_id', taskId)
      .eq('status', 'processing')
      .order('version', { ascending: true });

    if (lookupError) {
      console.error('DB lookup error:', lookupError.message);
      return new Response(JSON.stringify({ ok: true, action: 'db_error', error: lookupError.message }),
        { headers: responseHeaders, status: 200 });
    }

    if (!dbSongs || dbSongs.length === 0) {
      console.log(`No processing songs found for kie_task_id ${taskId}`);
      return new Response(JSON.stringify({ ok: true, action: 'no_matching_songs' }),
        { headers: responseHeaders, status: 200 });
    }

    console.log(`Found ${dbSongs.length} processing songs for kie_task_id ${taskId}`);

    // ---- ERROR stage (or non-200 code) ----
    // Do NOT mark failed here: leave the rows in 'processing' (annotated) so
    // poll-processing-songs' recovery picks them up within ~5 min — it
    // retries the job once on Kie and then hands the order to Mureka. Only
    // that recovery (or the 90-min absolute timeout) decides a song is dead.
    if (callbackType === 'error' || body.code !== 200) {
      const errMsg = (body.msg || `kie.ai code=${body.code}` || 'unknown error').toString();
      console.log(`Task ${taskId} reported error: ${errMsg} — leaving for poll-processing-songs recovery`);
      for (const dbSong of dbSongs) {
        await supabase.from('songs').update({
          error_message: `kie.ai callback: ${errMsg} (awaiting auto-recovery)`.substring(0, 500),
        }).eq('id', dbSong.id).eq('status', 'processing');
      }
      return new Response(JSON.stringify({ ok: true, action: 'left_for_recovery', error: errMsg }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- COMPLETE stage — map track[0]→v1, track[1]→v2 ----
    console.log(`Task ${taskId} COMPLETE with ${tracks.length} tracks`);
    const results: any[] = [];
    let emailSent = false;

    for (const dbSong of dbSongs) {
      const idx = (dbSong.version || 1) - 1;
      const track = tracks[idx];

      if (track?.audio_url) {
        const { data: updatedSong } = await supabase.from('songs').update({
          audio_url: track.audio_url,
          preview_url: track.audio_url,
          original_audio_url: track.audio_url,
          // If Kie returned a cover image, store it; otherwise leave the existing image_url alone
          ...(track.image_url ? { image_url: track.image_url } : {}),
          status: 'completed',
          needs_reupload: true,
          kie_payload: JSON.stringify(track),
        }).eq('id', dbSong.id).eq('status', 'processing').select().single();

        if (updatedSong) {
          results.push({ id: dbSong.id, action: 'completed_instant' });
          if (!emailSent && dbSong.email) {
            const previewLink = `https://regalosquecantan.com/preview/${dbSong.id}`;
            await sendEmail(
              dbSong.email,
              `🎧 ¡Tu canción para ${dbSong.recipient_name} está lista!`,
              getPreviewReadyEmailHtml(updatedSong, previewLink)
            );
            console.log('Email sent to:', dbSong.email);
            emailSent = true;
          }
        } else {
          results.push({ id: dbSong.id, action: 'already_completed' });
        }
      } else {
        console.warn(`No audio_url for song ${dbSong.id} (v${dbSong.version}) at index ${idx}`);
        results.push({ id: dbSong.id, action: 'no_audio_url' });
      }
    }

    return new Response(JSON.stringify({ ok: true, action: 'completed', results }),
      { headers: responseHeaders, status: 200 });

  } catch (error: any) {
    console.error('song-callback error:', error?.message);
    // Always 200 so Kie.ai doesn't retry indefinitely
    return new Response(JSON.stringify({ ok: true, action: 'error', error: error?.message }),
      { headers: responseHeaders, status: 200 });
  }
});
