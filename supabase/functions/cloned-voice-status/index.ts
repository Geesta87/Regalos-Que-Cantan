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
// Auth: verify_jwt = true (same as the other clonamivoz functions).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const KIE_BASE_URL = Deno.env.get('KIE_BASE_URL') || 'https://api.kie.ai';

const PERMANENT_BUCKET = 'cloned-voice-songs';

// States where the frontend keeps polling. Anything NOT in this set is
// either terminal-ish (preview_ready, awaiting_payment, paid, success,
// failed) or doesn't need a Kie call.
const ACTIVE_KIE_POLL_STATUSES = new Set(['generating_preview', 'generating_song']);

type SunoSong = {
  id?: string;
  audioId?: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  duration?: number;
  title?: string;
  tags?: string;
};

type RecordInfoResponse = {
  code: number;
  msg?: string;
  data?: {
    status?:
      | 'PENDING'
      | 'FIRST_SUCCESS'
      | 'TEXT_SUCCESS'
      | 'SUCCESS'
      | 'CREATE_TASK_FAILED'
      | 'GENERATE_AUDIO_FAILED'
      | 'CALLBACK_EXCEPTION'
      | 'SENSITIVE_WORD_ERROR';
    taskId?: string;
    errorCode?: number;
    errorMessage?: string;
    response?: { sunoData?: SunoSong[] };
    sunoData?: SunoSong[];
  };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function mapKieTerminal(kieStatus: string | undefined): 'success' | 'failed' | 'pending' {
  switch (kieStatus) {
    case 'SUCCESS':
      return 'success';
    case 'CREATE_TASK_FAILED':
    case 'GENERATE_AUDIO_FAILED':
    case 'CALLBACK_EXCEPTION':
    case 'SENSITIVE_WORD_ERROR':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Download a single Suno MP3 and upload it to our permanent Storage bucket.
 * Returns the public URL we can serve forever, or null if the copy failed.
 */
async function copyToPermanentStorage(
  supabase: ReturnType<typeof createClient>,
  sunoUrl: string,
  clonedVoiceSongId: string,
  variantLabel: string
): Promise<string | null> {
  try {
    const resp = await fetch(sunoUrl);
    if (!resp.ok) {
      console.warn(
        `[cloned-voice-status] Suno fetch returned ${resp.status} for ${variantLabel} of ${clonedVoiceSongId}`
      );
      return null;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length === 0) {
      console.warn(
        `[cloned-voice-status] Suno returned empty body for ${variantLabel} of ${clonedVoiceSongId}`
      );
      return null;
    }

    const path = `${clonedVoiceSongId}/${variantLabel}.mp3`;

    const uploadRes = await supabase.storage
      .from(PERMANENT_BUCKET)
      .upload(path, bytes, { contentType: 'audio/mpeg', upsert: true });

    if (uploadRes.error) {
      console.error(
        `[cloned-voice-status] Storage upload failed for ${path}:`,
        uploadRes.error
      );
      return null;
    }

    const { data: publicData } = supabase.storage
      .from(PERMANENT_BUCKET)
      .getPublicUrl(path);
    return publicData?.publicUrl || null;
  } catch (e) {
    console.error(
      `[cloned-voice-status] Unexpected error copying ${variantLabel} of ${clonedVoiceSongId}:`,
      e
    );
    return null;
  }
}

/**
 * Hit Kie's record-info for a taskId. Returns null on network failure
 * so the caller can return the last-known DB state instead of crashing.
 */
async function pollKieTask(taskId: string): Promise<RecordInfoResponse | null> {
  try {
    const resp = await fetch(
      `${KIE_BASE_URL}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return await resp.json();
  } catch (e) {
    console.error('[cloned-voice-status] Kie fetch failed:', e);
    return null;
  }
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
      'id, status, kie_task_id, preview_kie_task_id, title, lyrics, suno_audio_urls, permanent_audio_urls, preview_audio_url, paid, paid_at, error_message, completed_at'
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
  const songs: SunoSong[] = kieData.response?.sunoData || kieData.sunoData || [];
  const sunoUrls = songs
    .map((s) => s.audioUrl || s.streamAudioUrl)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);

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
    const permUrl = await copyToPermanentStorage(supabase, sunoUrls[0], row.id, 'preview');
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
  // Copy each variant to permanent storage. Partial success OK.
  const permanentUrls: string[] = [];
  for (let i = 0; i < sunoUrls.length; i++) {
    const permUrl = await copyToPermanentStorage(supabase, sunoUrls[i], row.id, `v${i + 1}`);
    if (permUrl) permanentUrls.push(permUrl);
  }
  if (permanentUrls.length < sunoUrls.length) {
    console.warn(
      `[cloned-voice-status] Only copied ${permanentUrls.length}/${sunoUrls.length} variants for ${row.id} into permanent storage`
    );
  }

  const completedAtIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('cloned_voice_songs')
    .update({
      status: 'success',
      suno_audio_urls: sunoUrls,
      permanent_audio_urls: permanentUrls.length > 0 ? permanentUrls : null,
      completed_at: completedAtIso,
    })
    .eq('id', row.id);
  if (updateError) {
    console.error('[cloned-voice-status] Failed to persist success state:', updateError);
  }

  const responseAudioUrls = permanentUrls.length > 0 ? permanentUrls : sunoUrls;
  return jsonResponse(
    buildResponse(row, {
      status: 'success',
      audio_urls: responseAudioUrls,
      completed_at: completedAtIso,
      phase: 'full_song',
    })
  );
});
