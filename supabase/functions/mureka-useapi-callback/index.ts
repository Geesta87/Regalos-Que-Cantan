// supabase/functions/mureka-useapi-callback/index.ts
// Receives webhook from useapi.net when a Mureka job completes
// Instantly marks songs as completed with Mureka CDN URL (needs_reupload=true)
// poll-processing-songs will later re-upload audio to Supabase Storage
// Deploy: supabase functions deploy mureka-useapi-callback --project-ref yzbvajungshqcpusfiia
// (verify_jwt=false is pinned in supabase/config.toml — do NOT pass --no-verify-jwt)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders } from '../_shared/unsubscribe.ts';
import { buildEmailParts } from '../_shared/email.ts';
import { renderEmail } from '../_shared/email-shell.ts';

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
        // text/plain MUST come before text/html (RFC 2046 multipart/alternative).
        content: [
          { type: 'text/plain', value: finalText },
          { type: 'text/html', value: finalHtml },
        ],
        categories: [category, 'rqc'],
        tracking_settings: {
          click_tracking: { enable: true, enable_text: false },
          open_tracking: { enable: true },
          subscription_tracking: { enable: false }
        },
        headers: await buildUnsubscribeHeaders(to)
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
      .select('id, version, recipient_name, sender_name, email, genre, genre_name, occasion, status, mureka_job_id')
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
      // Rows actually completed in this pass, in version order — exactly the
      // ids the preview link must open.
      const completedIds: string[] = [];
      let emailRow: any = null;

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
            completedIds.push(dbSong.id);
            // Remember the first row that carries an email. The order is
            // emailed once, AFTER the loop, so the link can include every
            // version.
            if (!emailRow && dbSong.email) emailRow = { ...updatedSong, email: dbSong.email };
          } else {
            // Song was already completed (race condition with poller)
            results.push({ id: dbSong.id, action: 'already_completed' });
          }
        } else {
          console.warn(`No mp3_url for song ${dbSong.id} (v${dbSong.version}) in API response`);
          results.push({ id: dbSong.id, action: 'no_audio_url' });
        }
      }

      // ---- One email per order, linking to EVERY version ----
      // This used to fire inside the loop with `/preview/<first id>`, which the
      // frontend resolves to /listen?song_id=<one id> — so the customer only
      // ever saw one of their two takes. dbSongs is ordered v1→v2, so
      // completedIds keeps the versions in order.
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
