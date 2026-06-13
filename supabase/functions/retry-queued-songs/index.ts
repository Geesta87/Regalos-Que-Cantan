// supabase/functions/retry-queued-songs/index.ts
//
// pg_cron (every 5 min): resubmits songs stuck in status 'queued_retry'
// (rate-limited at generation time) to the SAME provider that queued them.
//
// History: the original version only knew how to retry Kie/Suno (it predates
// the Mureka-primary era). When Mureka became primary (2026-05-04), every
// Mureka 429 got queued with mureka_payload saved — this cron looked for
// kie_payload, found none, and marked the song FAILED ("No retry payload
// saved"). ~2 customer demos/day silently died for two months. Fixed
// 2026-06-12: retries via whichever provider's payload exists.
//
// Invoked by pg_cron — verify_jwt = false pinned in supabase/config.toml.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const KIE_API_KEY = Deno.env.get('KIE_API_KEY')!;
  const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;
  const USEAPI_TOKEN = Deno.env.get('USEAPI_TOKEN');
  const USEAPI_WEBHOOK_SECRET = Deno.env.get('USEAPI_WEBHOOK_SECRET') || '';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Find all songs stuck in queued_retry
    const { data: queuedSongs, error: fetchError } = await supabase
      .from('songs')
      .select('*')
      .eq('status', 'queued_retry')
      .order('created_at', { ascending: true })
      .limit(10);

    if (fetchError) throw fetchError;
    if (!queuedSongs || queuedSongs.length === 0) {
      return new Response(JSON.stringify({ message: 'No queued songs to retry', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${queuedSongs.length} songs to retry`);
    const results: any[] = [];

    for (const song of queuedSongs) {
      try {
        const murekaPayload = song.mureka_payload ? JSON.parse(song.mureka_payload) : null;
        const kiePayload = song.kie_payload ? JSON.parse(song.kie_payload) : null;

        if (!murekaPayload && !kiePayload) {
          console.error(`Song ${song.id} has no retry payload, marking failed`);
          await supabase.from('songs').update({ status: 'failed', error_message: 'No retry payload saved' }).eq('id', song.id);
          results.push({ id: song.id, status: 'failed', reason: 'no_payload' });
          continue;
        }

        if (murekaPayload) {
          // ---- Mureka / useapi.net retry (primary provider since 2026-05) ----
          if (!USEAPI_TOKEN) {
            console.error(`Song ${song.id}: mureka_payload present but USEAPI_TOKEN missing — leaving queued`);
            results.push({ id: song.id, status: 'still_queued', reason: 'no_useapi_token' });
            continue;
          }
          // Refresh the callback URL in case the saved one is stale
          const callbackBase = `${SUPABASE_URL}/functions/v1/mureka-useapi-callback`;
          murekaPayload.replyUrl = USEAPI_WEBHOOK_SECRET ? `${callbackBase}?token=${USEAPI_WEBHOOK_SECRET}` : callbackBase;

          console.log(`Retrying song ${song.id} via Mureka...`);
          const resp = await fetch('https://api.useapi.net/v1/mureka/music/create-advanced', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${USEAPI_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(murekaPayload),
          });

          if (!resp.ok) {
            const errText = await resp.text().catch(() => 'unknown');
            console.warn(`Mureka still unavailable for song ${song.id}: ${resp.status} ${errText.substring(0, 150)}`);
            // Leave as queued_retry — next run tries again (429s clear on their own)
            results.push({ id: song.id, status: 'still_queued', reason: `mureka_${resp.status}` });
            continue;
          }

          const data = await resp.json().catch(() => ({}));
          const jobId = data.jobid;
          if (!jobId) {
            console.error(`No jobid on Mureka retry for song ${song.id}`);
            // Don't kill the song on a weird response — leave queued for next run
            results.push({ id: song.id, status: 'still_queued', reason: 'no_jobid' });
            continue;
          }

          await supabase.from('songs').update({
            status: 'processing',
            task_id: jobId,
            mureka_job_id: jobId,
            provider: 'mureka-useapi',
            error_message: null,
          }).eq('id', song.id);

          console.log(`Song ${song.id} retried via Mureka, jobid: ${jobId}`);
          if (song.email) await sendRetryNotification(SENDGRID_API_KEY, song);
          results.push({ id: song.id, status: 'retried', provider: 'mureka', taskId: jobId });
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        // ---- Kie / Suno retry (original behavior) ----
        kiePayload.callBackUrl = `${SUPABASE_URL}/functions/v1/song-callback`;

        console.log(`Retrying song ${song.id} via Kie...`);
        const musicResponse = await fetch('https://api.kie.ai/api/v1/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KIE_API_KEY}`,
          },
          body: JSON.stringify(kiePayload),
        });

        if (!musicResponse.ok) {
          const errText = await musicResponse.text();
          console.error(`Kie.ai still down for song ${song.id}: ${musicResponse.status}`);
          results.push({ id: song.id, status: 'still_queued', reason: `kie_${musicResponse.status}` });
          // Leave as queued_retry — we'll try again next run
          continue;
        }

        const musicData = await musicResponse.json();
        const taskId = musicData.data?.taskId;

        if (!taskId) {
          console.error(`No taskId for song ${song.id}`);
          await supabase.from('songs').update({ status: 'failed', error_message: 'No taskId on retry' }).eq('id', song.id);
          results.push({ id: song.id, status: 'failed', reason: 'no_task_id' });
          continue;
        }

        // Success! Update song back to processing
        await supabase.from('songs').update({
          status: 'processing',
          task_id: taskId,
          error_message: null,
          kie_payload: null,
        }).eq('id', song.id);

        console.log(`Song ${song.id} retried successfully, taskId: ${taskId}`);

        // Send "your song is being made" email
        if (song.email) {
          await sendRetryNotification(SENDGRID_API_KEY, song);
        }

        results.push({ id: song.id, status: 'retried', provider: 'kie', taskId });

        // Small delay between retries
        await new Promise(r => setTimeout(r, 2000));

      } catch (songErr) {
        console.error(`Error retrying song ${song.id}:`, songErr);
        results.push({ id: song.id, status: 'error', reason: songErr.message });
      }
    }

    return new Response(JSON.stringify({
      message: `Processed ${results.length} songs`,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Retry error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});


async function sendRetryNotification(sendgridKey: string, song: any) {
  const recipientName = song.recipient_name || 'tu ser querido';

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f4f1eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" style="background-color:#f4f1eb;"><tr><td align="center" style="padding:30px 10px;">
<table role="presentation" width="600" style="max-width:600px;width:100%;">
  <tr><td align="center" style="padding:0 0 20px;">
    <table role="presentation"><tr><td align="center" style="padding:14px 28px;background-color:#1a3a2f;border-radius:10px;">
      <span style="font-size:15px;font-weight:800;letter-spacing:2px;color:#d4af37;text-transform:uppercase;">&#127925; REGALOS QUE CANTAN</span>
    </td></tr></table>
  </td></tr>
  <tr><td>
    <table role="presentation" width="100%" style="background-color:#1a3a2f;border-radius:16px;">
      <tr><td align="center" style="padding:45px 40px 10px;">
        <div style="font-size:60px;line-height:1;">&#127908;&#9749;</div>
      </td></tr>
      <tr><td align="center" style="padding:20px 40px 0;">
        <h1 style="margin:0;font-size:26px;color:#fff;font-weight:800;line-height:1.3;">&iexcl;Nuestro cantante despert&oacute;!</h1>
      </td></tr>
      <tr><td align="center" style="padding:12px 40px 0;">
        <p style="margin:0;font-size:16px;color:#d4af37;font-weight:600;">Tu canci&oacute;n para ${recipientName} est&aacute; siendo creada</p>
      </td></tr>
      <tr><td align="center" style="padding:24px 40px;">
        <p style="margin:0;font-size:14px;color:#ccc;line-height:1.6;">Perdona la espera &mdash; nuestro servicio de m&uacute;sica tuvo un peque&ntilde;o momento de diva, pero ya volvi&oacute; al escenario. &#127926;<br/><br/>Tu canci&oacute;n deber&iacute;a estar lista en unos minutos. Te enviamos otro email con el enlace para escucharla en cuanto est&eacute; terminada.</p>
      </td></tr>
      <tr><td align="center" style="padding:0 40px 40px;">
        <p style="margin:0;font-size:12px;color:#999;">&iquest;Preguntas? Responde a este correo</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:20px;">
    <p style="margin:0;font-size:11px;color:#999;">RegalosQueCantan &copy; ${new Date().getFullYear()}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: song.email }],
          subject: `☕ ¡Nuestro cantante despertó! Tu canción para ${recipientName} está en camino`,
        }],
        from: { email: 'hola@regalosquecantan.com', name: 'RegalosQueCantan' },
        content: [{ type: 'text/html', value: html }],
      }),
    });
    console.log(`Retry notification sent to ${song.email}: ${res.status}`);
  } catch (e) {
    console.error(`Failed to send retry notification to ${song.email}:`, e);
  }
}
