// supabase/functions/cloned-voice-status/index.ts
//
// Polls the current state of a Clone Mi Voz song job.
//
// Why this function exists
// ------------------------
// generate-cloned-voice-song fires a Kie.ai upload-cover job and immediately
// returns. The job typically takes 30-90 seconds, sometimes up to 4 minutes.
// Suno can also send Kie a callback when it's done, but our test harness
// found callbacks unreliable (the configured KIE_CALLBACK_URL is a
// webhook.site sink that we never read), so we poll instead — same pattern
// the standalone web-app prototype validated.
//
// The frontend calls this endpoint every ~5 seconds while the song is in
// the 'generating_song' status. Each call:
//   1. Looks up the cloned_voice_songs row.
//   2. If status is already terminal ('success' or 'failed'), returns the
//      row as-is — no Kie call (saves quota).
//   3. Otherwise hits Kie /api/v1/generate/record-info?taskId=<kie_task_id>.
//   4. Maps Kie's status to ours and, if it's now terminal, persists the
//      audio URLs (or error) to the row.
//   5. Returns the current state.
//
// Request
// -------
// GET  /functions/v1/cloned-voice-status?cloned_voice_song_id=<uuid>
//   - or -
// POST /functions/v1/cloned-voice-status
//   Body: { cloned_voice_song_id: '<uuid>' }
//
// Both are accepted because some browsers / CDNs handle GET caching badly
// for this kind of polling endpoint. POST is the safer default.
//
// Response (200)
// --------------
//   {
//     cloned_voice_song_id,
//     status: 'pending' | 'generating_lyrics' | 'generating_song' | 'success' | 'failed',
//     audio_urls?: string[],   // present when status === 'success'
//     title?: string,
//     lyrics?: string,
//     error_message?: string,  // present when status === 'failed'
//   }
//
// Response (4xx/5xx)
// ------------------
//   { error: '<code>', message: '<human>' }
//
// Auth
// ----
// verify_jwt = true (see supabase/config.toml). Frontend posts with the
// Supabase anon JWT — identical pattern to upload-customer-voice /
// generate-cloned-voice-lyrics / generate-cloned-voice-song.
//
// Deploy with: supabase functions deploy cloned-voice-status --project-ref yzbvajungshqcpusfiia

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

const TERMINAL_STATUSES = new Set(['success', 'failed']);

// Storage bucket where we permanently keep the finished songs.
// Created by 20260527_clonamivoz_permanent_audio_storage.sql.
// Public bucket — anyone with the URL can play it; we treat the URL as
// semi-secret (it has the unguessable cloned_voice_song_id in the path).
const PERMANENT_BUCKET = 'cloned-voice-songs';

/**
 * Download a single Suno MP3 and upload it to our permanent Storage bucket.
 * Returns the public URL we can serve forever, or null if the copy failed.
 *
 * We swallow errors and return null so a single bad URL doesn't break the
 * whole status response — the caller falls back to the original Suno URL.
 */
async function copyToPermanentStorage(
  supabase: ReturnType<typeof createClient>,
  sunoUrl: string,
  clonedVoiceSongId: string,
  variantIndex: number
): Promise<string | null> {
  try {
    const resp = await fetch(sunoUrl);
    if (!resp.ok) {
      console.warn(
        `[cloned-voice-status] Suno fetch returned ${resp.status} for variant ${variantIndex} of ${clonedVoiceSongId}`
      );
      return null;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length === 0) {
      console.warn(
        `[cloned-voice-status] Suno returned empty body for variant ${variantIndex} of ${clonedVoiceSongId}`
      );
      return null;
    }

    // Path layout: <song-uuid>/v<N>.mp3 — easy to grep in the dashboard,
    // unguessable thanks to the uuid component.
    const path = `${clonedVoiceSongId}/v${variantIndex}.mp3`;

    const uploadRes = await supabase.storage
      .from(PERMANENT_BUCKET)
      .upload(path, bytes, {
        contentType: 'audio/mpeg',
        upsert: true, // re-runs of polling are safe
      });

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
      `[cloned-voice-status] Unexpected error copying variant ${variantIndex} of ${clonedVoiceSongId}:`,
      e
    );
    return null;
  }
}

// Kie response shape (a subset — we only read what we use).
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

// Map Kie's status enum to our cloned_voice_songs.status enum.
// Anything that isn't terminal stays as 'generating_song' so the frontend
// keeps polling.
function mapKieStatus(kieStatus: string | undefined): {
  ours: 'generating_song' | 'success' | 'failed';
  isTerminal: boolean;
} {
  switch (kieStatus) {
    case 'SUCCESS':
      return { ours: 'success', isTerminal: true };
    case 'CREATE_TASK_FAILED':
    case 'GENERATE_AUDIO_FAILED':
    case 'CALLBACK_EXCEPTION':
    case 'SENSITIVE_WORD_ERROR':
      return { ours: 'failed', isTerminal: true };
    default:
      // PENDING, FIRST_SUCCESS, TEXT_SUCCESS, or unknown — still cooking.
      return { ours: 'generating_song', isTerminal: false };
  }
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

  // ---------------- parse cloned_voice_song_id from GET or POST ----------------
  let clonedVoiceSongId: string | null = null;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    clonedVoiceSongId = url.searchParams.get('cloned_voice_song_id');
  } else if (req.method === 'POST') {
    try {
      const body = await req.json();
      clonedVoiceSongId =
        typeof body?.cloned_voice_song_id === 'string' ? body.cloned_voice_song_id : null;
    } catch (_e) {
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

  // ---------------- load the order row ----------------
  const { data: row, error: loadError } = await supabase
    .from('cloned_voice_songs')
    .select(
      'id, status, kie_task_id, title, lyrics, suno_audio_urls, permanent_audio_urls, error_message, completed_at'
    )
    .eq('id', clonedVoiceSongId)
    .maybeSingle();

  if (loadError) {
    console.error('[cloned-voice-status] DB lookup failed:', loadError);
    return jsonResponse(
      { error: 'db_error', message: loadError.message },
      500
    );
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

  // ---------------- already terminal: return as-is, no Kie call ----------------
  if (TERMINAL_STATUSES.has(row.status)) {
    // Prefer permanent URLs (never expire); fall back to Suno's if the
    // earlier copy attempt didn't store them.
    const audioUrls =
      (row.permanent_audio_urls && row.permanent_audio_urls.length > 0)
        ? row.permanent_audio_urls
        : (row.suno_audio_urls || []);
    return jsonResponse({
      cloned_voice_song_id: row.id,
      status: row.status,
      title: row.title,
      lyrics: row.lyrics,
      audio_urls: audioUrls,
      error_message: row.error_message,
      completed_at: row.completed_at,
    });
  }

  // ---------------- no Kie task id yet: still in lyrics/pre-generate phase ----
  if (!row.kie_task_id) {
    return jsonResponse({
      cloned_voice_song_id: row.id,
      status: row.status,
      title: row.title,
      lyrics: row.lyrics,
      audio_urls: [],
      error_message: row.error_message,
    });
  }

  // ---------------- poll Kie ----------------
  let kieResponse: RecordInfoResponse;
  try {
    const kieResp = await fetch(
      `${KIE_BASE_URL}/api/v1/generate/record-info?taskId=${encodeURIComponent(row.kie_task_id)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    kieResponse = await kieResp.json();
  } catch (e) {
    console.error('[cloned-voice-status] Kie fetch failed:', e);
    // Non-fatal — return the last-known DB state so the frontend keeps polling.
    return jsonResponse({
      cloned_voice_song_id: row.id,
      status: row.status,
      title: row.title,
      lyrics: row.lyrics,
      audio_urls: [],
      poll_error: 'kie_fetch_failed',
    });
  }

  if (kieResponse.code !== 200) {
    console.warn(
      '[cloned-voice-status] Kie returned non-200 code:',
      kieResponse.code,
      kieResponse.msg
    );
    return jsonResponse({
      cloned_voice_song_id: row.id,
      status: row.status,
      title: row.title,
      lyrics: row.lyrics,
      audio_urls: [],
      poll_error: `kie_code_${kieResponse.code}`,
      poll_message: kieResponse.msg,
    });
  }

  const kieData = kieResponse.data || {};
  const mapped = mapKieStatus(kieData.status);

  // Still cooking — return current state without persisting.
  if (!mapped.isTerminal) {
    return jsonResponse({
      cloned_voice_song_id: row.id,
      status: 'generating_song',
      title: row.title,
      lyrics: row.lyrics,
      audio_urls: [],
      kie_status: kieData.status,
    });
  }

  // ---------------- terminal: persist + return ----------------
  if (mapped.ours === 'success') {
    const songs: SunoSong[] = kieData.response?.sunoData || kieData.sunoData || [];
    const audioUrls = songs
      .map((s) => s.audioUrl || s.streamAudioUrl)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);

    if (audioUrls.length === 0) {
      // Kie says SUCCESS but no URLs — treat as failed so the user gets a
      // clean error rather than a stuck spinner.
      const { error: updateError } = await supabase
        .from('cloned_voice_songs')
        .update({
          status: 'failed',
          error_message: 'Kie returned SUCCESS but no audio URLs were available.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updateError) {
        console.error('[cloned-voice-status] Failed to persist empty-success state:', updateError);
      }

      return jsonResponse({
        cloned_voice_song_id: row.id,
        status: 'failed',
        title: row.title,
        lyrics: row.lyrics,
        audio_urls: [],
        error_message: 'Kie returned SUCCESS but no audio URLs were available.',
      });
    }

    // ------- Copy each Suno MP3 into our permanent bucket -------
    // We do this BEFORE marking the row 'success' so the customer's first
    // SUCCESS poll already returns our permanent URLs. Each variant is
    // copied independently; partial success is fine — the response falls
    // back to Suno URLs for any variant we couldn't copy.
    const permanentUrls: string[] = [];
    for (let i = 0; i < audioUrls.length; i++) {
      const permUrl = await copyToPermanentStorage(supabase, audioUrls[i], row.id, i + 1);
      if (permUrl) permanentUrls.push(permUrl);
    }

    if (permanentUrls.length < audioUrls.length) {
      console.warn(
        `[cloned-voice-status] Only copied ${permanentUrls.length}/${audioUrls.length} variants for ${row.id} into permanent storage`
      );
    }

    const completedAtIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('cloned_voice_songs')
      .update({
        status: 'success',
        suno_audio_urls: audioUrls,
        permanent_audio_urls: permanentUrls.length > 0 ? permanentUrls : null,
        completed_at: completedAtIso,
      })
      .eq('id', row.id);

    if (updateError) {
      console.error('[cloned-voice-status] Failed to persist success state:', updateError);
      // Still return success to the frontend — the URLs are in Kie's response.
    }

    // Prefer permanent URLs in the response. Fall back to Suno URLs if we
    // couldn't copy any (customer still gets a playable song, just temporarily).
    const responseAudioUrls = permanentUrls.length > 0 ? permanentUrls : audioUrls;

    return jsonResponse({
      cloned_voice_song_id: row.id,
      status: 'success',
      title: row.title,
      lyrics: row.lyrics,
      audio_urls: responseAudioUrls,
      completed_at: completedAtIso,
    });
  }

  // mapped.ours === 'failed'
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

  return jsonResponse({
    cloned_voice_song_id: row.id,
    status: 'failed',
    title: row.title,
    lyrics: row.lyrics,
    audio_urls: [],
    error_message: errorMessage,
    kie_status: kieData.status,
    kie_error_code: kieData.errorCode,
  });
});
