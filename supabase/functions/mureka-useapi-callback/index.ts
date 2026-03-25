// supabase/functions/mureka-useapi-callback/index.ts
// Receives webhook from useapi.net when a Mureka job completes
// Instantly marks songs as completed with Mureka CDN URL (needs_reupload=true)
// poll-processing-songs will later re-upload audio to Supabase Storage
// Deploy with: supabase functions deploy mureka-useapi-callback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const USEAPI_WEBHOOK_SECRET = Deno.env.get('USEAPI_WEBHOOK_SECRET') || '';
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

// ============================================================================
// EMAIL HELPERS (same as poll-processing-songs)
// ============================================================================

async function sendEmail(to: string, subject: string, htmlContent: string, category: string = 'transactional') {
  if (!SENDGRID_API_KEY) return null;
  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
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
        content: [{ type: 'text/html', value: htmlContent }],
        categories: [category, 'rqc'],
        tracking_settings: {
          click_tracking: { enable: true, enable_text: false },
          open_tracking: { enable: true },
          subscription_tracking: { enable: false }
        },
        headers: {
          'List-Unsubscribe': `<mailto:hola@regalosquecantan.com?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      }),
    });
    if (!response.ok) {
      console.error('SendGrid error:', response.status);
    }
    return response;
  } catch (e) {
    console.error('Email error:', e);
    return null;
  }
}

function getPreviewReadyEmailHtml(song: any, previewLink: string) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const songTitle = song.song_title || `Canci\u00f3n para ${song.recipient_name || 'ti'}`;
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
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px;">&#10024; TU REGALO TE EST&Aacute; ESPERANDO &#10024;</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:36px;margin:0 0 4px;font-weight:400;">Oye, ${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 24px;font-weight:400;">Tu canci&oacute;n ya <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">est&aacute; viva.</span></h2>
          <p style="color:#c9b99a;font-size:16px;margin:0;line-height:1.7;">Letra, melod&iacute;a y emoci&oacute;n &mdash; todo est&aacute; listo. Solo<br>falta <em>un paso</em> para que llegue al coraz&oacute;n de quien amas.</p>
        </td></tr>

        <!-- CTA Button -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <a href="${previewLink}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#127925; Terminar Mi Canci&oacute;n
          </a>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#a67c52;font-size:13px;margin:0;">&#127873; Tu progreso se guarda por 24 horas &middot; Sin compromiso</p>
        </td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Song Preview Section -->
        <tr><td style="background-color:#1a0e08;padding:40px 30px 10px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">&#127911; VISTA PREVIA DE TU CANCI&Oacute;N</p>
          <h3 style="font-family:'Righteous',cursive;color:#ffffff;font-size:24px;margin:0 0 24px;font-weight:400;">Tu regalo ya tiene voz</h3>
        </td></tr>

        <!-- Song Card -->
        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;">
            <tr>
              <!-- Play Button Column -->
              <td width="120" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
                <div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
                <p style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">PREVIA</p>
              </td>
              <!-- Song Info Column -->
              <td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:20px 24px;vertical-align:middle;">
                <p style="color:#ff6b35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">TU CANCI&Oacute;N PERSONALIZADA</p>
                <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">${songTitle}</p>
                <p style="color:#a67c52;font-size:13px;margin:0 0 12px;">Hecha con amor para <strong style="color:#ffd23f;">${song.recipient_name || 'tu ser querido'}</strong> &middot; Estilo: <span style="text-transform:capitalize;">${song.genre || 'Musical'}</span></p>
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

        <!-- Price Section -->
        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#c9b99a;font-size:15px;margin:0;">&iquest;Te gusta? Compra la canci&oacute;n completa por solo <strong style="color:#ff6b35;">$24.99 USD</strong></p>
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

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    // ---- Security: validate token ----
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    if (USEAPI_WEBHOOK_SECRET && token !== USEAPI_WEBHOOK_SECRET) {
      console.warn('Invalid webhook token received');
      // Still return 200 to prevent retries, but do nothing
      return new Response(
        JSON.stringify({ ok: true, action: 'rejected_invalid_token' }),
        { headers: responseHeaders, status: 200 }
      );
    }

    // ---- Parse payload ----
    const payload = await req.json();
    console.log('=== MUREKA-USEAPI-CALLBACK ===');
    console.log(`jobid: ${payload.jobid}, status: ${payload.status}, replyRef: ${payload.replyRef}`);

    const jobId = payload.jobid;
    if (!jobId) {
      console.warn('No jobid in callback payload');
      return new Response(
        JSON.stringify({ ok: true, action: 'no_jobid' }),
        { headers: responseHeaders, status: 200 }
      );
    }

    // ---- Parse response (nested format) ----
    const responseState = payload.response?.state ?? payload.state;
    const responseStatus = payload.status; // "completed", "failed", etc.
    const apiSongs = payload.response?.songs ?? payload.songs ?? [];

    console.log(`response.state=${responseState}, status=${responseStatus}, songs=${apiSongs.length}`);

    // ---- Connect to Supabase ----
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Look up songs by mureka_job_id ----
    const { data: dbSongs, error: lookupError } = await supabase
      .from('songs')
      .select('id, version, recipient_name, sender_name, email, genre, occasion, status, mureka_job_id')
      .eq('mureka_job_id', jobId)
      .eq('status', 'processing')
      .order('version', { ascending: true });

    if (lookupError) {
      console.error('DB lookup error:', lookupError.message);
      return new Response(
        JSON.stringify({ ok: true, action: 'db_error', error: lookupError.message }),
        { headers: responseHeaders, status: 200 }
      );
    }

    if (!dbSongs || dbSongs.length === 0) {
      console.log(`No processing songs found for job ${jobId} (may already be completed)`);
      return new Response(
        JSON.stringify({ ok: true, action: 'no_matching_songs' }),
        { headers: responseHeaders, status: 200 }
      );
    }

    console.log(`Found ${dbSongs.length} processing songs for job ${jobId}`);

    // ---- Handle COMPLETED (state=3 or status=completed) ----
    if (responseState === 3 || responseStatus === 'completed') {
      console.log(`Job ${jobId} COMPLETED with ${apiSongs.length} songs`);
      const results: any[] = [];
      let emailSent = false;

      for (const dbSong of dbSongs) {
        // Map version 1 → apiSongs[0], version 2 → apiSongs[1]
        const idx = (dbSong.version || 1) - 1;
        const apiSong = apiSongs[idx];

        if (apiSong?.mp3_url) {
          console.log(`Completing song ${dbSong.id} (v${dbSong.version}) with CDN URL`);

          // Instant completion: set Mureka CDN URL directly, mark needs_reupload
          const { data: updatedSong } = await supabase.from('songs').update({
            audio_url: apiSong.mp3_url,
            preview_url: apiSong.mp3_url,
            original_audio_url: apiSong.mp3_url,
            status: 'completed',
            needs_reupload: true,
            mureka_payload: JSON.stringify(apiSong),
          }).eq('id', dbSong.id).eq('status', 'processing').select().single();

          if (updatedSong) {
            results.push({ id: dbSong.id, action: 'completed_instant' });

            // Send email for the FIRST song only (one email per order, not per song)
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
            // Song was already completed (race condition with poller)
            results.push({ id: dbSong.id, action: 'already_completed' });
          }
        } else {
          console.warn(`No mp3_url for song ${dbSong.id} (v${dbSong.version}) in API response`);
          results.push({ id: dbSong.id, action: 'no_audio_url' });
        }
      }

      return new Response(
        JSON.stringify({ ok: true, action: 'completed', results }),
        { headers: responseHeaders, status: 200 }
      );
    }

    // ---- Handle FAILED (state=4 or status=failed) ----
    if (responseState === 4 || responseStatus === 'failed') {
      const errMsg = payload.response?.error || payload.error || 'unknown error';
      console.log(`Job ${jobId} FAILED: ${errMsg}`);

      for (const dbSong of dbSongs) {
        await supabase.from('songs').update({
          status: 'failed',
          error_message: `useapi.net callback: ${errMsg}`.substring(0, 500),
        }).eq('id', dbSong.id).eq('status', 'processing');
      }

      return new Response(
        JSON.stringify({ ok: true, action: 'marked_failed', error: errMsg }),
        { headers: responseHeaders, status: 200 }
      );
    }

    // ---- Handle in-progress callbacks (state 1 or 2) ----
    console.log(`Job ${jobId} still in state ${responseState} (status: ${responseStatus}) — ignoring`);
    return new Response(
      JSON.stringify({ ok: true, action: 'still_processing', state: responseState }),
      { headers: responseHeaders, status: 200 }
    );

  } catch (error: any) {
    console.error('mureka-useapi-callback error:', error.message);
    // Always return 200 to prevent useapi.net retries
    return new Response(
      JSON.stringify({ ok: true, action: 'error', error: error.message }),
      { headers: responseHeaders, status: 200 }
    );
  }
});
