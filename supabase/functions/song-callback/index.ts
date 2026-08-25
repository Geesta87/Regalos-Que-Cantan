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
import { renderEmail } from '../_shared/email-shell.ts';
import { handleKieTerminalFailure, recordKieHealthEvent } from '../_shared/kie-recovery.ts';

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

// `versionCount` = how many versions the CTA actually opens. Every order gets
// two takes, so the copy must not promise a single song when the page is about
// to show both.
function getPreviewReadyEmailHtml(song: any, previewLink: string, versionCount: number = 1) {
  const recipientName = song.recipient_name || 'tu ser querido';
  // genre_name is the human label ("Pop Latino"); `genre` is the raw slug
  // ("pop_latino") and is only the fallback.
  const genre = song.genre_name || song.genre || 'Musical';
  const multi = versionCount > 1;
  // Rebuilt on the shared brand shell (_shared/email-shell.ts). previewLink is
  // passed straight through as ctaHref — the URL is unchanged from the caller.
  return renderEmail({
    palette: 'preview',
    hero: 'vinyl',
    eyebrow: multi ? 'Tus 2 versiones est&aacute;n listas' : 'Tu muestra est&aacute; lista',
    headline: `La canci&oacute;n de <span style="color:#a9c4f0;">${recipientName}</span> ya est&aacute; lista.`,
    sub: multi
      ? 'Te hicimos <strong>dos versiones</strong> distintas. Esc&uacute;chalas y qu&eacute;date con la que m&aacute;s te guste.'
      : 'Escucha c&oacute;mo qued&oacute; &mdash; y si te encanta, ll&eacute;vatela para descargar y compartir.',
    credits: [{ label: 'Para', value: recipientName }, { label: 'Estilo', value: genre }],
    ctaText: multi
      ? '&#9654;&nbsp;&nbsp;Escuchar mis 2 versiones&nbsp;&nbsp;&#8594;'
      : '&#9654;&nbsp;&nbsp;Escuchar mi canci&oacute;n&nbsp;&nbsp;&#8594;',
    ctaHref: previewLink,
    subcopy: multi
      ? 'Las dos te esperan en el navegador.'
      : 'Tu muestra te espera en el navegador.',
  });
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
      .select('id, version, recipient_name, sender_name, email, genre, genre_name, occasion, status, kie_task_id')
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
    // Event-driven recovery: run the retry-once-on-Kie → hand-to-Mureka ladder
    // RIGHT NOW instead of waiting for a poll-processing-songs sweep (which
    // added 5-10 min of pure queue time per failure during the 2026-08-05
    // Suno outage). The rows stay 'processing' throughout; the marker below is
    // stamped first so the poll's backstop still catches us if the recovery
    // call dies mid-flight. Only the recovery ladder (or the 90-min absolute
    // timeout) decides a song is dead.
    if (callbackType === 'error' || body.code !== 200) {
      const errMsg = (body.msg || `kie.ai code=${body.code}` || 'unknown error').toString();
      console.log(`Task ${taskId} reported error: ${errMsg} — triggering recovery now`);
      for (const dbSong of dbSongs) {
        await supabase.from('songs').update({
          error_message: `kie.ai callback: ${errMsg} (awaiting auto-recovery)`.substring(0, 500),
        }).eq('id', dbSong.id).eq('status', 'processing');
      }
      // Suno's artist-name/tags rejection is DETERMINISTIC — resubmitting the
      // identical payload to Kie is guaranteed to 400 again (Nestor
      // 2026-08-25 burned a pointless Kie retry on it). Classify it so the
      // ladder skips straight to Mureka, which doesn't enforce the rule.
      const deterministic = /artist name|change your tags/i.test(errMsg);
      let recovery = 'recovery_error';
      try {
        recovery = await handleKieTerminalFailure(
          supabase, taskId, deterministic ? 'TAGS_REJECTED' : 'CALLBACK_REPORTED_FAILURE');
        console.log(`Recovery for ${taskId}: ${recovery}`);
      } catch (e: any) {
        // Marker is already stamped — poll-processing-songs will pick it up.
        console.error(`Event-driven recovery failed for ${taskId}: ${e.message}`);
      }
      return new Response(JSON.stringify({ ok: true, action: 'recovery_triggered', recovery, error: errMsg }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- COMPLETE stage — map track[0]→v1, track[1]→v2 ----
    console.log(`Task ${taskId} COMPLETE with ${tracks.length} tracks`);
    const results: any[] = [];
    // Rows actually completed in this pass, in version order — exactly the ids
    // the preview link must open.
    const completedIds: string[] = [];
    let emailRow: any = null;

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
          completedIds.push(dbSong.id);
          // Remember the first row that carries an email. The order is emailed
          // once, AFTER the loop, so the link can include every version.
          if (!emailRow && dbSong.email) emailRow = { ...updatedSong, email: dbSong.email };
        } else {
          results.push({ id: dbSong.id, action: 'already_completed' });
        }
      } else {
        console.warn(`No audio_url for song ${dbSong.id} (v${dbSong.version}) at index ${idx}`);
        results.push({ id: dbSong.id, action: 'no_audio_url' });
      }
    }

    // Feed the outage circuit-breaker (kie-recovery.ts): a completed take is
    // proof Kie is healthy, which closes the breaker again after an outage.
    if (completedIds.length > 0) await recordKieHealthEvent(supabase, 'success', taskId);

    // ---- One email per order, linking to EVERY version ----
    // This used to fire inside the loop with `/preview/<first id>`, which the
    // frontend resolves to /listen?song_id=<one id> — so the customer only ever
    // saw one of their two takes. dbSongs is ordered v1→v2, so completedIds
    // keeps the versions in order.
    if (emailRow && completedIds.length > 0) {
      const previewLink =
        `https://regalosquecantan.com/listen?song_ids=${completedIds.join(',')}` +
        `&utm_source=email&utm_medium=transactional&utm_campaign=preview_ready`;
      await sendEmail(
        emailRow.email,
        `🎧 ¡Tu canción para ${emailRow.recipient_name} está lista!`,
        getPreviewReadyEmailHtml(emailRow, previewLink, completedIds.length)
      );
      console.log(`Email sent to: ${emailRow.email} (${completedIds.length} version(s))`);
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
