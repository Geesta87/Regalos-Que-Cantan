// supabase/functions/poll-processing-songs/index.ts
// Three jobs:
//   1. PRIORITY: Process 'callback_received' songs — download audio, upload to Storage, send email, mark completed
//   2. ACTIVE POLL: Check Mureka task status API for 'processing' songs (callbacks may be unreliable)
//   3. SAFETY NET: Re-submit stuck 'processing' songs to Mureka when polling also fails
// Runs via pg_cron every 2 minutes
// Provider: Mureka AI (migrated from Evolink/Kie.ai)
// Deploy with: supabase functions deploy poll-processing-songs --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MUREKA_API_KEY = Deno.env.get('MUREKA_API_KEY')!
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

// Config
const POLL_AFTER_MINUTES = 3;    // Start active polling after 3 min (don't rush Mureka)
const RETRY_AFTER_MINUTES = 15;  // Re-submit after 15 min without callback (Mureka)
const MAX_RETRIES = 3;           // Max re-submission attempts
const TIMEOUT_MINUTES = 90;      // Absolute timeout

// ============================================================================
// EMAIL HELPERS
// ============================================================================

async function sendEmail(to: string, subject: string, htmlContent: string, category: string = 'transactional') {
  if (!SENDGRID_API_KEY) return null;
  try {
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
      })
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
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:36px;margin:0 0 4px;font-weight:400;">Oye, \${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 24px;font-weight:400;">Tu canci&oacute;n ya <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">est&aacute; viva.</span></h2>
          <p style="color:#c9b99a;font-size:16px;margin:0;line-height:1.7;">Letra, melod&iacute;a y emoci&oacute;n &mdash; todo est&aacute; listo. Solo<br>falta <em>un paso</em> para que llegue al coraz&oacute;n de quien amas.</p>
        </td></tr>

        <!-- CTA Button -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <a href="\${previewLink}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
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
                <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">\${songTitle}</p>
                <p style="color:#a67c52;font-size:13px;margin:0 0 12px;">Hecha con amor para <strong style="color:#ffd23f;">\${song.recipient_name || 'tu ser querido'}</strong> &middot; Estilo: <span style="text-transform:capitalize;">\${song.genre || 'Musical'}</span></p>
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
// COMPLETE SONG: Download audio → Upload to Storage → Update DB → Send email
// ============================================================================

async function completeSong(supabase: any, song: any, audioUrl: string): Promise<boolean> {
  try {
    console.log(`Downloading audio for ${song.id}: ${audioUrl}`);
    const audioResponse = await fetch(audioUrl);

    if (!audioResponse.ok) {
      console.warn(`Audio download failed for ${song.id} (${audioResponse.status}), saving temp URL`);
      await supabase.from('songs').update({
        audio_url: audioUrl,
        preview_url: audioUrl,
        status: 'completed',
        error_message: 'Audio download failed, using temp URL'
      }).eq('id', song.id);
      return true;
    }

    const audioBlob = await audioResponse.blob();
    const cleanName = (song.recipient_name || 'unknown')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
    const shortId = song.id.substring(0, 8);
    const fileName = `songs/cancion-para-${cleanName}-${shortId}.mp3`;

    console.log(`Uploading: ${fileName}`);
    const { error: uploadError } = await supabase.storage
      .from('audio')
      .upload(fileName, audioBlob, {
        contentType: 'audio/mpeg',
        cacheControl: '3600',
        upsert: true
      });

    let publicAudioUrl: string;
    if (uploadError) {
      console.warn(`Upload failed for ${song.id}, using temp URL:`, uploadError.message);
      publicAudioUrl = audioUrl;
    } else {
      const { data: publicUrlData } = supabase.storage.from('audio').getPublicUrl(fileName);
      publicAudioUrl = publicUrlData.publicUrl;
    }

    const { data: updatedSong } = await supabase.from('songs').update({
      audio_url: publicAudioUrl,
      preview_url: publicAudioUrl,
      original_audio_url: audioUrl,
      status: 'completed'
    }).eq('id', song.id).select().single();

    console.log(`COMPLETED: ${song.id} (${song.recipient_name})`);

    // Send email notification
    if (song.email) {
      const previewLink = `https://regalosquecantan.com/listen?song_id=${song.id}&utm_source=email&utm_medium=transactional&utm_campaign=preview_ready`;
      await sendEmail(
        song.email,
        `🎧 ¡Tu canción para ${song.recipient_name} está lista!`,
        getPreviewReadyEmailHtml(updatedSong || song, previewLink)
      );
      console.log('Email sent to:', song.email);
    }

    return true;
  } catch (e: any) {
    console.error(`completeSong error for ${song.id}:`, e.message);
    return false;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== POLL PROCESSING SONGS (v17 - webhook re-upload + useapi.net + Mureka + Polling + Auto-retry) ===');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const results: any[] = [];
    const USEAPI_TOKEN = Deno.env.get('USEAPI_TOKEN');

    // ========================================================================
    // JOB RE-UPLOAD: Move completed songs from Mureka CDN to Supabase Storage
    //   These songs were instantly completed by the webhook callback with CDN URLs
    //   Now we download and re-upload to our own storage for permanence
    // ========================================================================
    {
      const { data: reuploadSongs, error: reuploadError } = await supabase
        .from('songs')
        .select('id, audio_url, original_audio_url, recipient_name')
        .eq('needs_reupload', true)
        .eq('status', 'completed')
        .order('created_at', { ascending: true })
        .limit(10);

      if (reuploadError) {
        console.error('Error fetching re-upload songs:', reuploadError.message);
      }

      if (reuploadSongs && reuploadSongs.length > 0) {
        console.log(`[RE-UPLOAD] Found ${reuploadSongs.length} songs to re-upload to Storage`);

        for (const song of reuploadSongs) {
          try {
            const cdnUrl = song.original_audio_url || song.audio_url;
            if (!cdnUrl) {
              console.warn(`[RE-UPLOAD] No URL for song ${song.id}, skipping`);
              await supabase.from('songs').update({ needs_reupload: false }).eq('id', song.id);
              results.push({ id: song.id, job: 'reupload', action: 'skipped_no_url' });
              continue;
            }

            console.log(`[RE-UPLOAD] Downloading: ${cdnUrl}`);
            const audioResponse = await fetch(cdnUrl);

            if (!audioResponse.ok) {
              console.warn(`[RE-UPLOAD] Download failed for ${song.id} (${audioResponse.status}), keeping CDN URL`);
              // Don't set needs_reupload=false — try again next cycle
              results.push({ id: song.id, job: 'reupload', action: 'download_failed' });
              continue;
            }

            const audioBlob = await audioResponse.blob();
            const cleanName = (song.recipient_name || 'unknown')
              .toLowerCase()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9\s-]/g, '')
              .replace(/\s+/g, '-')
              .substring(0, 50);
            const shortId = song.id.substring(0, 8);
            const fileName = `songs/cancion-para-${cleanName}-${shortId}.mp3`;

            console.log(`[RE-UPLOAD] Uploading to Storage: ${fileName}`);
            const { error: uploadError } = await supabase.storage
              .from('audio')
              .upload(fileName, audioBlob, {
                contentType: 'audio/mpeg',
                cacheControl: '3600',
                upsert: true,
              });

            if (uploadError) {
              console.warn(`[RE-UPLOAD] Upload failed for ${song.id}: ${uploadError.message}`);
              // Keep CDN URL, try again next cycle
              results.push({ id: song.id, job: 'reupload', action: 'upload_failed' });
              continue;
            }

            const { data: publicUrlData } = supabase.storage.from('audio').getPublicUrl(fileName);
            const permanentUrl = publicUrlData.publicUrl;

            await supabase.from('songs').update({
              audio_url: permanentUrl,
              preview_url: permanentUrl,
              needs_reupload: false,
            }).eq('id', song.id);

            console.log(`[RE-UPLOAD] Done: ${song.id} → ${permanentUrl}`);
            results.push({ id: song.id, job: 'reupload', action: 'reuploaded' });

          } catch (reErr: any) {
            console.error(`[RE-UPLOAD] Error for ${song.id}:`, reErr.message);
            results.push({ id: song.id, job: 'reupload', action: 'error', error: reErr.message });
          }
        }
      } else {
        console.log('[RE-UPLOAD] No songs need re-upload');
      }
    }

    // ========================================================================
    // JOB 0: Poll useapi.net Mureka jobs (provider='mureka-useapi')
    //         These songs use mureka_job_id instead of task_id
    // ========================================================================

    if (USEAPI_TOKEN) {
      const { data: useapiSongs, error: useapiError } = await supabase
        .from('songs')
        .select('id, mureka_job_id, version, recipient_name, email, genre, occasion')
        .eq('status', 'processing')
        .eq('provider', 'mureka-useapi')
        .not('mureka_job_id', 'is', null)
        .order('created_at', { ascending: true })
        .limit(20);

      if (useapiError) {
        console.error('Error fetching useapi songs:', useapiError.message);
      }

      if (useapiSongs && useapiSongs.length > 0) {
        // Group songs by mureka_job_id (2 songs share the same job)
        const jobGroups: Record<string, typeof useapiSongs> = {};
        for (const song of useapiSongs) {
          const jid = song.mureka_job_id!;
          if (!jobGroups[jid]) jobGroups[jid] = [];
          jobGroups[jid].push(song);
        }

        console.log(`[JOB 0] Polling ${Object.keys(jobGroups).length} useapi.net jobs (${useapiSongs.length} songs)`);

        for (const [jobId, songs] of Object.entries(jobGroups)) {
          try {
            const jobResponse = await fetch(`https://api.useapi.net/v1/mureka/jobs/${jobId}`, {
              headers: { 'Authorization': `Bearer ${USEAPI_TOKEN}` },
            });

            if (!jobResponse.ok) {
              console.warn(`useapi.net poll failed for job ${jobId}: HTTP ${jobResponse.status}`);
              for (const s of songs) {
                await supabase.from('songs').update({ updated_at: new Date().toISOString() }).eq('id', s.id);
              }
              continue;
            }

            const jobData = await jobResponse.json();
            // useapi.net wraps the response: { jobid, status, response: { state, songs[] } }
            const responseState = jobData.response?.state ?? jobData.state;
            const responseStatus = jobData.status; // "completed", "failed", etc.
            console.log(`useapi.net job ${jobId}: response.state=${responseState}, status=${responseStatus}`);

            if (responseState === 3 || responseStatus === 'completed') {
              // Complete — map API songs to DB songs by version
              const apiSongs = jobData.response?.songs ?? jobData.songs ?? [];
              console.log(`Job ${jobId} complete: ${apiSongs.length} songs returned`);

              for (const dbSong of songs) {
                // version 1 → apiSongs[0], version 2 → apiSongs[1]
                const idx = (dbSong.version || 1) - 1;
                const apiSong = apiSongs[idx];

                if (apiSong?.mp3_url) {
                  console.log(`Completing song ${dbSong.id} (v${dbSong.version}) from useapi.net job ${jobId}`);
                  await supabase.from('songs').update({
                    original_audio_url: apiSong.mp3_url,
                    mureka_payload: JSON.stringify(apiSong),
                  }).eq('id', dbSong.id);

                  const completed = await completeSong(supabase, dbSong, apiSong.mp3_url);
                  results.push({
                    id: dbSong.id,
                    job: 'useapi_poll',
                    action: completed ? 'completed' : 'failed_to_complete',
                  });
                } else {
                  console.warn(`No audio for song ${dbSong.id} (v${dbSong.version}) in job ${jobId}`);
                  results.push({ id: dbSong.id, job: 'useapi_poll', action: 'no_audio_in_response' });
                }
              }

            } else if (responseState === 4 || responseStatus === 'failed') {
              // Failed
              const errMsg = jobData.response?.error || jobData.error || 'unknown error';
              console.log(`useapi.net job ${jobId} FAILED: ${errMsg}`);
              for (const s of songs) {
                await supabase.from('songs').update({
                  status: 'failed',
                  error_message: `useapi.net job failed: ${errMsg}`.substring(0, 500),
                }).eq('id', s.id);
                results.push({ id: s.id, job: 'useapi_poll', action: 'job_failed' });
              }

            } else {
              // Still queued (1) or processing (2)
              console.log(`useapi.net job ${jobId} still in state ${responseState} (status: ${responseStatus})`);
              for (const s of songs) {
                await supabase.from('songs').update({ updated_at: new Date().toISOString() }).eq('id', s.id);
                results.push({ id: s.id, job: 'useapi_poll', action: 'still_processing', state: responseState });
              }
            }

          } catch (pollErr: any) {
            console.error(`useapi.net poll error for job ${jobId}:`, pollErr.message);
            for (const s of songs) {
              results.push({ id: s.id, job: 'useapi_poll', action: 'poll_error', error: pollErr.message });
            }
          }
        }
      } else {
        console.log('[JOB 0] No useapi.net songs to poll');
      }
    } else {
      console.log('[JOB 0] USEAPI_TOKEN not configured, skipping');
    }

    // ========================================================================
    // JOB 1: Process 'callback_received' songs (PRIORITY — these have audio ready)
    // ========================================================================

    const { data: callbackSongs, error: cbError } = await supabase
      .from('songs')
      .select('id, task_id, recipient_name, email, genre, occasion, original_audio_url')
      .eq('status', 'callback_received')
      .not('original_audio_url', 'is', null)
      .order('created_at', { ascending: true })
      .limit(10);

    if (cbError) {
      console.error('Error fetching callback_received songs:', cbError.message);
    }

    if (callbackSongs && callbackSongs.length > 0) {
      console.log(`[JOB 1] ${callbackSongs.length} songs with callback_received`);

      for (const song of callbackSongs) {
        const audioUrl = song.original_audio_url;
        console.log(`Processing ${song.id}: ${audioUrl.substring(0, 80)}`);

        const completed = await completeSong(supabase, song, audioUrl);
        results.push({
          id: song.id,
          job: 'callback_processing',
          action: completed ? 'completed' : 'failed_to_complete'
        });
      }
    } else {
      console.log('[JOB 1] No callback_received songs');
    }

    // ========================================================================
    // JOB 2: Active polling — check Mureka task status API for processing songs
    //         Callbacks may be unreliable, so we actively check task completion
    // ========================================================================

    const pollThreshold = new Date(Date.now() - POLL_AFTER_MINUTES * 60 * 1000).toISOString();
    const { data: pollSongs, error: pollError } = await supabase
      .from('songs')
      .select('id, task_id, recipient_name, email, genre, occasion, provider')
      .eq('status', 'processing')
      .not('task_id', 'is', null)
      .lt('updated_at', pollThreshold)
      .order('created_at', { ascending: true })
      .limit(10);

    if (pollError) {
      console.error('Error fetching songs to poll:', pollError.message);
    }

    if (pollSongs && pollSongs.length > 0) {
      console.log(`[JOB 2] Polling Mureka status for ${pollSongs.length} processing songs`);

      for (const song of pollSongs) {
        try {
          console.log(`Polling task ${song.task_id} for song ${song.id} (provider: ${song.provider})`);

          // Mureka polling endpoint
          const taskResponse = await fetch(`https://api.mureka.ai/v1/song/query?ids=${song.task_id}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${MUREKA_API_KEY}`
            }
          });

          if (!taskResponse.ok) {
            console.warn(`Task poll failed for ${song.task_id}: HTTP ${taskResponse.status}`);
            results.push({ id: song.id, job: 'poll', action: 'poll_failed', status: taskResponse.status });
            continue;
          }

          const taskData = await taskResponse.json();
          // Mureka query returns an array or object — normalize
          const songResult = Array.isArray(taskData) ? taskData[0] : (taskData.songs?.[0] || taskData);
          const taskStatus = songResult?.status || taskData?.status;

          console.log(`Task ${song.task_id} status: ${taskStatus}`);
          if (taskStatus === 'succeeded' || taskStatus === 'failed') {
            console.log('Task data:', JSON.stringify(taskData).substring(0, 500));
          }

          if (taskStatus === 'succeeded' || taskStatus === 'complete' || taskStatus === 'completed') {
            // Extract audio URL from Mureka response
            let audioUrl: string | null = null;

            // Mureka: songs array with flac_audio_url / audio_url
            if (songResult?.flac_audio_url) {
              audioUrl = songResult.flac_audio_url;
            } else if (songResult?.audio_url) {
              audioUrl = songResult.audio_url;
            }
            // Fallback: check other possible locations
            if (!audioUrl && taskData.flac_audio_url) {
              audioUrl = taskData.flac_audio_url;
            }

            if (audioUrl) {
              console.log(`FOUND AUDIO via polling for ${song.id}: ${audioUrl.substring(0, 80)}`);

              // Save audio URL and process immediately
              await supabase.from('songs').update({
                original_audio_url: audioUrl,
                mureka_payload: JSON.stringify(taskData)
              }).eq('id', song.id);

              const completed = await completeSong(supabase, song, audioUrl);
              results.push({
                id: song.id,
                job: 'poll',
                action: completed ? 'completed' : 'failed_to_complete'
              });
            } else {
              console.warn(`Task complete but no audio URL found for ${song.id}. Response: ${JSON.stringify(taskData).substring(0, 300)}`);
              results.push({ id: song.id, job: 'poll', action: 'complete_no_audio' });
            }

          } else if (taskStatus === 'failed' || taskStatus === 'error') {
            const errDetail = songResult?.error || taskData?.error || taskData?.message || 'unknown error';
            const errStr = typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail);
            console.log(`Task FAILED for song ${song.id}: ${errStr}`);

            // Get current retry count
            const { data: songData } = await supabase
              .from('songs').select('regenerate_count, mureka_payload').eq('id', song.id).single();
            const retryCount = songData?.regenerate_count || 0;

            if (retryCount < MAX_RETRIES) {
              // Auto-retry: re-submit to Mureka
              const rawPayload = songData?.mureka_payload;
              if (rawPayload) {
                try {
                  const payload = JSON.parse(rawPayload);
                  // Rebuild Mureka payload
                  const retryPayload = {
                    lyrics: payload.lyrics,
                    prompt: payload.prompt,
                    title: payload.title,
                    model: 'auto',
                    callback_url: `${SUPABASE_URL}/functions/v1/song-callback`,
                  };

                  console.log(`Auto-retrying ${song.id} via Mureka (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                  const retryResponse = await fetch('https://api.mureka.ai/v1/song/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MUREKA_API_KEY}` },
                    body: JSON.stringify(retryPayload)
                  });

                  if (retryResponse.ok) {
                    const retryData = await retryResponse.json();
                    const newTaskId = retryData.id;
                    if (newTaskId) {
                      await supabase.from('songs').update({
                        task_id: newTaskId,
                        regenerate_count: retryCount + 1,
                        error_message: null,
                        mureka_payload: JSON.stringify(retryPayload)
                      }).eq('id', song.id);
                      console.log(`AUTO-RETRIED ${song.id}: new task=${newTaskId}`);
                      results.push({ id: song.id, job: 'poll', action: 'auto_retried', newTaskId });
                      continue;
                    }
                  }
                  console.warn(`Auto-retry API call failed for ${song.id}`);
                } catch (retryErr: any) {
                  console.error(`Auto-retry error for ${song.id}:`, retryErr.message);
                }
              }
            }

            // Permanent failure (max retries or retry failed)
            await supabase.from('songs').update({
              status: 'failed',
              error_message: `Mureka task failed: ${errStr}`.substring(0, 500),
              mureka_payload: JSON.stringify(taskData)
            }).eq('id', song.id);
            results.push({ id: song.id, job: 'poll', action: 'task_failed' });

          } else {
            // Still pending/processing/running — update updated_at to prevent premature JOB 3 re-submission
            console.log(`Task ${song.task_id} still ${taskStatus} for song ${song.id}`);
            await supabase.from('songs').update({
              updated_at: new Date().toISOString()
            }).eq('id', song.id);
            results.push({ id: song.id, job: 'poll', action: 'still_processing', taskStatus });
          }

        } catch (pollErr: any) {
          console.error(`Poll error for ${song.id}:`, pollErr.message);
          results.push({ id: song.id, job: 'poll', action: 'poll_error', error: pollErr.message });
        }
      }
    } else {
      console.log('[JOB 2] No songs to poll');
    }

    // ========================================================================
    // JOB 3: Retry stuck 'processing' songs (safety net — re-submit if polling didn't help)
    // ========================================================================

    const retryThreshold = new Date(Date.now() - RETRY_AFTER_MINUTES * 60 * 1000).toISOString();
    const { data: stuckSongs, error: fetchError } = await supabase
      .from('songs')
      .select('id, task_id, recipient_name, email, genre, occasion, mureka_payload, evolink_payload, kie_payload, regenerate_count, created_at, updated_at, provider')
      .eq('status', 'processing')
      .not('task_id', 'is', null)
      .lt('updated_at', retryThreshold)
      .order('created_at', { ascending: true })
      .limit(10);

    if (fetchError) {
      console.error('Error fetching stuck songs:', fetchError.message);
    }

    if (stuckSongs && stuckSongs.length > 0) {
      console.log(`[JOB 3] ${stuckSongs.length} stuck songs (processing > ${RETRY_AFTER_MINUTES} min)`);

      for (const song of stuckSongs) {
        const result: any = { id: song.id, job: 'retry', retryCount: song.regenerate_count || 0 };
        const ageMinutes = (Date.now() - new Date(song.created_at).getTime()) / (60 * 1000);
        result.ageMinutes = Math.round(ageMinutes);

        try {
          // Check absolute timeout
          if (ageMinutes > TIMEOUT_MINUTES) {
            await supabase.from('songs').update({
              status: 'failed',
              error_message: `Timed out after ${Math.round(ageMinutes)} min (${song.regenerate_count || 0} retries)`
            }).eq('id', song.id);
            result.action = 'timed_out';
            console.log(`Song ${song.id} timed out after ${Math.round(ageMinutes)} min`);
            results.push(result);
            continue;
          }

          // Check max retries
          if ((song.regenerate_count || 0) >= MAX_RETRIES) {
            await supabase.from('songs').update({
              status: 'failed',
              error_message: `Failed after ${song.regenerate_count} retries — provider not responding`
            }).eq('id', song.id);
            result.action = 'max_retries';
            console.log(`Song ${song.id} exceeded max retries`);
            results.push(result);
            continue;
          }

          // Determine which payload to use for retry
          const rawPayload = song.mureka_payload || song.evolink_payload || song.kie_payload;

          // Legacy Evolink/Kie songs without Mureka payload — just fail them
          if (!song.mureka_payload && (song.evolink_payload || song.kie_payload)) {
            console.log(`Song ${song.id} is legacy ${song.provider || 'unknown'} — marking failed (Evolink deprecated)`);
            await supabase.from('songs').update({
              status: 'failed',
              error_message: 'Evolink/Kie.ai deprecated — migrated to Mureka'
            }).eq('id', song.id);
            result.action = 'legacy_deprecated';
            results.push(result);
            continue;
          }

          if (rawPayload) {
            console.log(`Re-submitting ${song.id} via Mureka (attempt ${(song.regenerate_count || 0) + 1}/${MAX_RETRIES})`);

            let payload;
            try {
              payload = JSON.parse(rawPayload);
            } catch (e) {
              console.error(`Invalid payload for ${song.id}`);
              result.action = 'invalid_payload';
              results.push(result);
              continue;
            }

            // Build clean Mureka retry payload
            const retryPayload = {
              lyrics: payload.lyrics,
              prompt: payload.prompt,
              title: payload.title,
              model: 'auto',
              callback_url: `${SUPABASE_URL}/functions/v1/song-callback`,
            };

            const musicResponse = await fetch('https://api.mureka.ai/v1/song/generate', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MUREKA_API_KEY}`
              },
              body: JSON.stringify(retryPayload)
            });

            if (!musicResponse.ok) {
              const errText = await musicResponse.text();
              console.error(`Mureka re-submit failed for ${song.id}: ${musicResponse.status} — ${errText.substring(0, 200)}`);
              result.action = 'resubmit_failed';

              await supabase.from('songs').update({
                regenerate_count: (song.regenerate_count || 0) + 1
              }).eq('id', song.id);

              results.push(result);
              continue;
            }

            const musicData = await musicResponse.json();
            const newTaskId = musicData.id;

            if (!newTaskId) {
              console.error(`No taskId from re-submit for ${song.id}`);
              result.action = 'no_task_id';
              await supabase.from('songs').update({
                regenerate_count: (song.regenerate_count || 0) + 1
              }).eq('id', song.id);
              results.push(result);
              continue;
            }

            await supabase.from('songs').update({
              task_id: newTaskId,
              regenerate_count: (song.regenerate_count || 0) + 1,
              error_message: null,
              mureka_payload: JSON.stringify(retryPayload),
              provider: 'mureka'
            }).eq('id', song.id);

            result.action = 'resubmitted';
            result.newTaskId = newTaskId;
            console.log(`RESUBMITTED ${song.id}: new task=${newTaskId}`);

          } else {
            // No payload — can't retry
            console.log(`Song ${song.id} has no payload for retry`);
            result.action = 'no_payload';

            if (ageMinutes > 30) {
              await supabase.from('songs').update({
                status: 'failed',
                error_message: 'No callback and no payload for retry'
              }).eq('id', song.id);
              result.action = 'failed_no_payload';
            }
          }

        } catch (songError: any) {
          result.action = 'error';
          result.error = songError.message;
          console.error(`Error processing ${song.id}:`, songError.message);
        }

        results.push(result);
      }
    } else {
      console.log('[JOB 3] No stuck processing songs');
    }

    // Summary
    const completed = results.filter(r => r.action === 'completed').length;
    const polled = results.filter(r => r.job === 'poll').length;
    const resubmitted = results.filter(r => r.action === 'resubmitted').length;
    const failed = results.filter(r => r.action?.includes('failed') || r.action === 'timed_out' || r.action === 'max_retries' || r.action === 'task_failed').length;

    console.log(`=== DONE: ${completed} completed, ${polled} polled, ${resubmitted} resubmitted, ${failed} failed ===`);

    return new Response(
      JSON.stringify({ completed, polled, resubmitted, failed, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('Poll error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
