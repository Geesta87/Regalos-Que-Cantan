// supabase/functions/cloned-voice-status/index.ts
//
// Polls the current state of a Clone Mi Voz song job.
//
// Handles TWO Kie polling paths now:
//
//   1. PREVIEW path  — row.status = 'generating_preview', poll
//                      preview_kie_task_id. On SUCCESS, copy the audio
//                      to permanent storage, set preview_audio_url,
//                      flip status to 'preview_ready'.
//
//   2. FULL SONG path — row.status = 'generating_song', poll
//                       kie_task_id. On SUCCESS, copy both variants
//                       to permanent storage, set permanent_audio_urls,
//                       flip status to 'success'.
//
// Terminal states ('success', 'failed', 'preview_ready', 'awaiting_payment',
// 'paid', 'lyrics_ready') return immediately from DB — no Kie call.
//
// The frontend calls this every ~5s while a generation is in flight.
//
// 2026-08-27: the Kie-polling + rehost logic moved to
// _shared/cloned-voice-delivery.ts, shared with the poll-cloned-voice-songs
// pg_cron sweeper — the safety net that finishes songs when the customer
// closes the tab. This endpoint stays the fast path. On a PAID full-song
// success it also fires the delivery email (idempotent — the sweeper and
// this endpoint can race safely).
//
// Auth: verify_jwt = true (same as the other clonamivoz functions).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  pollKieTask,
  mapKieTerminal,
  extractSunoUrls,
  extractSunoDurations,
  copyToPermanentStorage,
  finalizeFullSongSuccess,
  sendClonedVoiceDeliveryEmail,
} from '../_shared/cloned-voice-delivery.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');

// States where the frontend keeps polling. Anything NOT in this set is
// either terminal-ish (preview_ready, awaiting_payment, paid, success,
// failed) or doesn't need a Kie call.
const ACTIVE_KIE_POLL_STATUSES = new Set(['generating_preview', 'generating_song']);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * The standard response shape every code path returns. Includes both
 * preview info and full-song info so the frontend has everything it
 * needs in one round-trip.
 */
function buildResponse(row: any, overrides: Record<string, unknown> = {}) {
  // Prefer permanent URLs for the full song; fall back to Suno URLs.
  const audioUrls =
    (row.permanent_audio_urls && row.permanent_audio_urls.length > 0)
      ? row.permanent_audio_urls
      : (row.suno_audio_urls || []);
  return {
    cloned_voice_song_id: row.id,
    status: row.status,
    title: row.title,
    lyrics: row.lyrics,
    preview_audio_url: row.preview_audio_url || null,
    audio_urls: audioUrls,
    paid: !!row.paid,
    paid_at: row.paid_at || null,
    error_message: row.error_message || null,
    completed_at: row.completed_at || null,
    // Gift-page fields (/regalo?id=<uuid>, 2026-08-27). The id is an
    // unguessable UUID and the endpoint already exposed title + lyrics.
    recipient_name: row.recipient_name || null,
    genre_slug: row.genre_slug || null,
    occasion: row.occasion || null,
    ...overrides,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!KIE_API_KEY) {
    console.error('[cloned-voice-status] KIE_API_KEY env var is not set');
    return jsonResponse(
      { error: 'config_error', message: 'Server missing KIE_API_KEY.' },
      500
    );
  }

  // Parse cloned_voice_song_id from GET or POST.
  let clonedVoiceSongId: string | null = null;
  if (req.method === 'GET') {
    const url = new URL(req.url);
    clonedVoiceSongId = url.searchParams.get('cloned_voice_song_id');
  } else if (req.method === 'POST') {
    try {
      const body = await req.json();
      clonedVoiceSongId =
        typeof body?.cloned_voice_song_id === 'string' ? body.cloned_voice_song_id : null;
    } catch {
      return jsonResponse(
        { error: 'invalid_body', message: 'POST body must be JSON.' },
        400
      );
    }
  } else {
    return jsonResponse(
      { error: 'method_not_allowed', message: 'Use GET or POST.' },
      405
    );
  }

  if (!clonedVoiceSongId) {
    return jsonResponse(
      {
        error: 'cloned_voice_song_id_required',
        message: 'Missing cloned_voice_song_id query param or body field.',
      },
      400
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Load the row with everything we might need.
  const { data: row, error: loadError } = await supabase
    .from('cloned_voice_songs')
    .select(
      'id, status, kie_task_id, preview_kie_task_id, title, lyrics, suno_audio_urls, permanent_audio_urls, preview_audio_url, paid, paid_at, error_message, completed_at, customer_email, recipient_name, genre_slug, occasion, delivery_email_sent_at'
    )
    .eq('id', clonedVoiceSongId)
    .maybeSingle();

  if (loadError) {
    console.error('[cloned-voice-status] DB lookup failed:', loadError);
    return jsonResponse({ error: 'db_error', message: loadError.message }, 500);
  }

  if (!row) {
    return jsonResponse(
      {
        error: 'not_found',
        message: `No cloned_voice_songs row with id ${clonedVoiceSongId}.`,
      },
      404
    );
  }

  // If this row isn't in an active polling state, return as-is. Covers
  // pending, generating_lyrics, lyrics_ready, preview_ready,
  // awaiting_payment, paid, success, failed.
  if (!ACTIVE_KIE_POLL_STATUSES.has(row.status)) {
    return jsonResponse(buildResponse(row));
  }

  // ====== Active polling: figure out which Kie task to query ======
  const isPreviewPhase = row.status === 'generating_preview';
  const taskId = isPreviewPhase ? row.preview_kie_task_id : row.kie_task_id;

  // Active state but no taskId yet — the request to Kie hasn't been
  // recorded yet. Return current state; frontend will poll again.
  if (!taskId) {
    return jsonResponse(buildResponse(row));
  }

  const kieResponse = await pollKieTask(taskId);
  if (!kieResponse) {
    // Network failure → return DB state with a soft error flag so the
    // frontend retries.
    return jsonResponse(buildResponse(row, { poll_error: 'kie_fetch_failed' }));
  }

  if (kieResponse.code !== 200) {
    console.warn(
      '[cloned-voice-status] Kie returned non-200 code:',
      kieResponse.code,
      kieResponse.msg
    );
    return jsonResponse(
      buildResponse(row, {
        poll_error: `kie_code_${kieResponse.code}`,
        poll_message: kieResponse.msg,
      })
    );
  }

  const kieData = kieResponse.data || {};
  const terminal = mapKieTerminal(kieData.status);

  if (terminal === 'pending') {
    // Still cooking. Return the current row plus a hint about which
    // phase we're polling so the frontend can label its spinner.
    return jsonResponse(
      buildResponse(row, { kie_status: kieData.status, phase: isPreviewPhase ? 'preview' : 'full_song' })
    );
  }

  if (terminal === 'failed') {
    const errorMessage =
      kieData.errorMessage ||
      `Kie returned status ${kieData.status} (code ${kieData.errorCode ?? 'n/a'}).`;

    const { error: updateError } = await supabase
      .from('cloned_voice_songs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) {
      console.error('[cloned-voice-status] Failed to persist failed state:', updateError);
    }

    return jsonResponse(
      buildResponse(row, {
        status: 'failed',
        error_message: errorMessage,
        kie_status: kieData.status,
        kie_error_code: kieData.errorCode,
      })
    );
  }

  // terminal === 'success' — extract Suno URLs and persist
  const sunoUrls = extractSunoUrls(kieData);

  if (sunoUrls.length === 0) {
    // Kie says SUCCESS but no URLs — fail cleanly.
    const failMsg = isPreviewPhase
      ? 'El sistema devolvió SUCCESS pero sin audio para la prueba.'
      : 'El sistema devolvió SUCCESS pero sin URLs de audio.';
    await supabase
      .from('cloned_voice_songs')
      .update({
        status: 'failed',
        error_message: failMsg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    return jsonResponse(
      buildResponse(row, {
        status: 'failed',
        error_message: failMsg,
      })
    );
  }

  // ====== PREVIEW success path ======
  if (isPreviewPhase) {
    // Preview only needs 1 variant. Copy the first one to permanent storage.
    // Filename carries the genre (2026-08-27, genre A/B): each genre's
    // preview gets its own object, so re-rendering in another genre never
    // overwrites a preview the customer may still be comparing against.
    const permUrl = await copyToPermanentStorage(
      supabase, sunoUrls[0], row.id, `preview_${row.genre_slug || 'default'}`
    );
    const previewUrl = permUrl || sunoUrls[0];

    const completedAtIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('cloned_voice_songs')
      .update({
        status: 'preview_ready',
        preview_audio_url: previewUrl,
        preview_completed_at: completedAtIso,
      })
      .eq('id', row.id);
    if (updateError) {
      console.error('[cloned-voice-status] Failed to persist preview_ready state:', updateError);
    }

    return jsonResponse(
      buildResponse(row, {
        status: 'preview_ready',
        preview_audio_url: previewUrl,
        preview_completed_at: completedAtIso,
        phase: 'preview',
      })
    );
  }

  // ====== FULL SONG success path ======
  // Shared with the poll-cloned-voice-songs sweeper: rehost every variant
  // (partial success OK — the sweeper retries stragglers) and flip the row.
  const { audioUrls, permanentUrls } = await finalizeFullSongSuccess(supabase, row.id, sunoUrls);
  const completedAtIso = new Date().toISOString();

  // Paid song finished while the customer was watching — send the delivery
  // email with the permanent links too. Idempotent (atomic column claim),
  // and a failure must never break the poll response.
  if (row.paid && !row.delivery_email_sent_at) {
    try {
      await sendClonedVoiceDeliveryEmail(
        supabase,
        {
          ...row,
          permanent_audio_urls: permanentUrls.length > 0 ? permanentUrls : null,
          suno_audio_urls: sunoUrls,
        },
        { durationsS: extractSunoDurations(kieData) }
      );
    } catch (e) {
      console.error('[cloned-voice-status] Delivery email failed (non-fatal):', e);
    }
  }

  return jsonResponse(
    buildResponse(row, {
      status: 'success',
      audio_urls: audioUrls,
      completed_at: completedAtIso,
      phase: 'full_song',
    })
  );
});
