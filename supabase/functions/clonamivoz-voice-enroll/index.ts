// supabase/functions/clonamivoz-voice-enroll/index.ts
//
// Suno Voice enrollment for Clona Mi Voz — turns a customer's recorded
// sample into a reusable cloned voice via Kie's Suno Voice APIs.
// Added 2026-08-08 after the pilot proved the flow end-to-end (memory:
// project_suno_voice_clone_pilot).
//
// Flow (frontend drives, one action per call):
//   1. { action:'start',  voice_sample_id }  → POST /api/v1/voice/validate
//      with a signed URL of the sample. Stores kie_voice_task_id,
//      voice_status='phrase_pending'.
//   2. { action:'phrase', voice_sample_id }  → GET /voice/validate-info.
//      When wait_validating: stores + returns the phrase the customer
//      must SING. Phrases expire ~10-15 min and are single-use — the
//      frontend must only call 'start' when the mic screen is live.
//   3. { action:'verify', voice_sample_id, verify_sample_id } →
//      POST /voice/generate with a signed URL of the phrase recording.
//      voice_status='verifying'.
//   4. { action:'status', voice_sample_id } → GET /voice/validate-info.
//      On success also POST /voice/check-voice; when isAvailable=true,
//      voice_status='ready'. THE VOICE'S personaId IS kie_voice_task_id
//      (Kie's record-info voiceId field never populates — do not wait
//      for it).
//
// Failure at any point → voice_status='failed' + error returned; the
// frontend offers a restart ('start' again → fresh task + phrase).
//
// HARD REQUIREMENT: the sample audio must be WAV or MP3. Kie silently
// discards WebM (task never registers — pilot-confirmed), so 'start'
// rejects webm/mp4 sources; the frontend uploads WAV since 2026-08-08.
//
// Auth: verify_jwt = true — called from /clonamivoz with the anon key,
// same as the other clonamivoz functions.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');

const STORAGE_BUCKET = 'customer-voice';
const SIGNED_URL_TTL_SECONDS = 3600;
const ALLOWED_SOURCE_MIMES = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg'];

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function kie(method: 'GET' | 'POST', path: string, body?: unknown) {
  const resp = await fetch(`https://api.kie.ai${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KIE_API_KEY}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' && body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return resp.json().catch(() => null);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!KIE_API_KEY) return json(500, { error: 'server_misconfigured', message: 'KIE_API_KEY not set.' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }

  const action = body.action;
  const voiceSampleId = typeof body.voice_sample_id === 'string' ? body.voice_sample_id : '';
  if (!voiceSampleId) return json(400, { error: 'missing_voice_sample_id' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: sample, error: lookupError } = await supabase
    .from('voice_samples')
    .select('id, storage_path, source_mime, duration_seconds, deleted_at, kie_voice_task_id, voice_phrase, voice_status')
    .eq('id', voiceSampleId)
    .single();
  if (lookupError || !sample) return json(404, { error: 'voice_sample_not_found' });
  if (sample.deleted_at) return json(410, { error: 'voice_sample_deleted' });

  async function signedUrl(storagePath: string): Promise<string | null> {
    const signed = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    return signed.data?.signedUrl || null;
  }

  // ---------------- start: submit sample for phrase generation ----------------
  if (action === 'start') {
    if (!ALLOWED_SOURCE_MIMES.includes(sample.source_mime)) {
      return json(422, {
        error: 'unsupported_format',
        message: `Voice sample is ${sample.source_mime}; Kie requires WAV or MP3. Re-record with the current recorder.`,
      });
    }
    // Kie's /voice/validate pipeline SILENTLY DROPS tasks whose audio URL
    // filename contains a UUID pattern (isolated 2026-08-08: identical
    // bytes — 'rootshort.wav' processes, '9f8e...uuid.wav' evaporates,
    // across 10+ controlled trials; upload-cover is NOT affected). All
    // our stored samples have UUID names, so copy the sample to a short
    // non-UUID name per attempt. Unique-per-attempt also insulates each
    // retry from any cached failure on a previous attempt's URL. Falls
    // back to the original path only if the copy fails.
    const ext = sample.storage_path.split('.').pop() || 'wav';
    const attemptPath = `enroll-attempts/va${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const copied = await supabase.storage.from(STORAGE_BUCKET).copy(sample.storage_path, attemptPath);
    const kiePath = copied.error ? sample.storage_path : attemptPath;
    if (copied.error) {
      console.warn('[clonamivoz-voice-enroll] attempt-copy failed, using original path:', copied.error.message);
    }
    const url = await signedUrl(kiePath);
    if (!url) return json(502, { error: 'signed_url_failed' });

    const durationS = Math.max(10, Math.min(Math.floor(Number(sample.duration_seconds) || 55), 120));
    const language = body.language === 'en' ? 'en' : 'es';
    const resp = await kie('POST', '/api/v1/voice/validate', {
      voiceUrl: url,
      vocalStartS: 0,
      vocalEndS: durationS,
      language,
    });
    const taskId: string | undefined = resp?.data?.taskId;
    if (resp?.code !== 200 || !taskId) {
      return json(502, { error: 'kie_validate_failed', message: resp?.msg || 'No taskId from Kie.' });
    }
    await supabase
      .from('voice_samples')
      .update({ kie_voice_task_id: taskId, voice_phrase: null, voice_status: 'phrase_pending', voice_ready_at: null })
      .eq('id', sample.id);
    return json(200, { status: 'phrase_pending', kie_voice_task_id: taskId });
  }

  // ---------------- phrase: poll until the phrase is ready ----------------
  if (action === 'phrase') {
    if (!sample.kie_voice_task_id) return json(409, { error: 'not_started' });
    const resp = await kie('GET', `/api/v1/voice/validate-info?taskId=${sample.kie_voice_task_id}`);
    const d = resp?.data;
    if (!d) return json(200, { status: 'phrase_pending' }); // task not yet queryable
    if (d.status === 'wait_validating' && d.validateInfo) {
      await supabase
        .from('voice_samples')
        .update({ voice_phrase: d.validateInfo, voice_status: 'phrase_ready' })
        .eq('id', sample.id);
      return json(200, { status: 'phrase_ready', phrase: d.validateInfo });
    }
    if (d.status === 'processing_validate_fail' || d.status === 'fail') {
      await supabase.from('voice_samples').update({ voice_status: 'failed' }).eq('id', sample.id);
      return json(200, { status: 'failed', message: d.errorMessage || 'Kie could not process the sample.' });
    }
    return json(200, { status: 'phrase_pending' });
  }

  // ---------------- verify: submit the sung phrase recording ----------------
  if (action === 'verify') {
    const verifySampleId = typeof body.verify_sample_id === 'string' ? body.verify_sample_id : '';
    if (!verifySampleId) return json(400, { error: 'missing_verify_sample_id' });
    if (!sample.kie_voice_task_id) return json(409, { error: 'not_started' });

    const { data: verifyRow } = await supabase
      .from('voice_samples')
      .select('id, storage_path, source_mime, deleted_at')
      .eq('id', verifySampleId)
      .single();
    if (!verifyRow || verifyRow.deleted_at) return json(404, { error: 'verify_sample_not_found' });
    if (!ALLOWED_SOURCE_MIMES.includes(verifyRow.source_mime)) {
      return json(422, { error: 'unsupported_format', message: 'Phrase recording must be WAV or MP3.' });
    }

    const url = await signedUrl(verifyRow.storage_path);
    if (!url) return json(502, { error: 'signed_url_failed' });

    const resp = await kie('POST', '/api/v1/voice/generate', {
      taskId: sample.kie_voice_task_id,
      verifyUrl: url,
      voiceName: `rqc-${sample.id.slice(0, 8)}`,
      description: 'Clona Mi Voz customer voice',
      singerSkillLevel: 'beginner',
    });
    if (resp?.code !== 200) {
      // Most common cause: phrase expired (~10-15 min TTL). Customer restarts.
      await supabase.from('voice_samples').update({ voice_status: 'failed' }).eq('id', sample.id);
      return json(200, { status: 'failed', message: resp?.msg || 'Kie rejected the verification.' });
    }
    await supabase
      .from('voice_samples')
      .update({ voice_status: 'verifying', verify_sample_id: verifySampleId })
      .eq('id', sample.id);
    return json(200, { status: 'verifying' });
  }

  // ---------------- status: poll voice creation, confirm availability ----------------
  if (action === 'status') {
    if (!sample.kie_voice_task_id) return json(409, { error: 'not_started' });
    if (sample.voice_status === 'ready') {
      return json(200, { status: 'ready', voice_task_id: sample.kie_voice_task_id });
    }
    const resp = await kie('GET', `/api/v1/voice/validate-info?taskId=${sample.kie_voice_task_id}`);
    const d = resp?.data;
    if (d?.status === 'success') {
      const check = await kie('POST', '/api/v1/voice/check-voice', { task_id: sample.kie_voice_task_id });
      if (check?.data?.isAvailable === true) {
        await supabase
          .from('voice_samples')
          .update({ voice_status: 'ready', voice_ready_at: new Date().toISOString() })
          .eq('id', sample.id);
        return json(200, { status: 'ready', voice_task_id: sample.kie_voice_task_id });
      }
      return json(200, { status: 'verifying' }); // created but not yet available
    }
    if (d?.status === 'fail' || d?.status === 'processing_validate_fail') {
      await supabase.from('voice_samples').update({ voice_status: 'failed' }).eq('id', sample.id);
      return json(200, { status: 'failed', message: d?.errorMessage || 'Voice creation failed.' });
    }
    return json(200, { status: 'verifying' });
  }

  return json(400, { error: 'unknown_action', message: "action must be 'start', 'phrase', 'verify', or 'status'" });
});
