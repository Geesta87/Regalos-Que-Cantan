// supabase/functions/clip-studio-callback/index.ts
// Deploy with: supabase functions deploy clip-studio-callback --project-ref yzbvajungshqcpusfiia
//
// Completion hook for Clip Studio jobs on the in-house Cloud Run renderer
// (mirrors inhouse-video-callback). Two kinds:
//
//   { kind:'prepare', project_id, success, duration_sec, audio_path, audio_url | error }
//      -> stores duration + audio, then runs Whisper (word timestamps) on the
//         extracted MP3 in the background and flips the project to 'ready'.
//   { kind:'clip', clip_id, success, storage_path, video_url, render_seconds | error }
//      -> marks the clip ready/failed.
//
// Auth: Cloud Run cannot attach a Supabase JWT -> verify_jwt = false (see
// supabase/config.toml). Authenticated via the shared x-render-token header,
// same contract as inhouse-video-callback. Reads OPENAI_API_KEY for Whisper.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
const now = () => new Date().toISOString();

async function whisperWords(audioUrl: string) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`audio fetch ${audioRes.status}`);
  const form = new FormData();
  form.append('file', await audioRes.blob(), 'audio.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form,
  });
  if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const words = (data.words || [])
    .map((w: any) => ({ word: String(w.word || ''), start: Number(w.start), end: Number(w.end) }))
    .filter((w: any) => w.word && !Number.isNaN(w.start) && !Number.isNaN(w.end));
  if (!words.length) throw new Error('Whisper returned no words (is there speech in the video?)');
  return {
    words,
    text: String(data.text || ''),
    language: String(data.language || ''),
    duration: Number(data.duration) || 0,
  };
}

async function transcribeProject(projectId: string, audioUrl: string) {
  try {
    const transcript = await whisperWords(audioUrl);
    await supabase.from('clip_projects')
      .update({ transcript, status: 'ready', error_message: null, updated_at: now() })
      .eq('id', projectId);
    console.log(`[${projectId}] transcript ready: ${transcript.words.length} words (${transcript.language})`);
  } catch (e) {
    console.error(`[${projectId}] whisper failed:`, (e as Error).message);
    await supabase.from('clip_projects')
      .update({ status: 'error', error_message: `Transcription failed: ${(e as Error).message}`, updated_at: now() })
      .eq('id', projectId);
  }
}

serve(async (req) => {
  const json = (o: unknown, code = 200) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' }, status: code });
  try {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!RENDER_TOKEN || req.headers.get('x-render-token') !== RENDER_TOKEN) return json({ error: 'unauthorized' }, 401);
    const body = await req.json();

    if (body.kind === 'prepare') {
      const { project_id, success } = body;
      if (!project_id) throw new Error('missing project_id');
      if (!success) {
        await supabase.from('clip_projects')
          .update({ status: 'error', error_message: `Prepare failed: ${body.error || 'unknown'}`, updated_at: now() })
          .eq('id', project_id);
        return json({ ok: true });
      }
      await supabase.from('clip_projects')
        .update({ duration_sec: body.duration_sec ?? null, audio_path: body.audio_path ?? null, status: 'transcribing', updated_at: now() })
        .eq('id', project_id);
      // Whisper can take a while on long videos — reply to Cloud Run now,
      // transcribe in the background (same pattern as email-marketer-weekly).
      const run = () => transcribeProject(project_id, body.audio_url);
      // deno-lint-ignore no-explicit-any
      if (typeof (globalThis as any).EdgeRuntime !== 'undefined') (globalThis as any).EdgeRuntime.waitUntil(run()); else run();
      return json({ ok: true });
    }

    if (body.kind === 'clip') {
      const { clip_id, success } = body;
      if (!clip_id) throw new Error('missing clip_id');
      if (success) {
        await supabase.from('clips')
          .update({ status: 'ready', storage_path: body.storage_path ?? null, video_url: body.video_url ?? null, render_seconds: body.render_seconds ?? null, error_message: null, updated_at: now() })
          .eq('id', clip_id);
      } else {
        await supabase.from('clips')
          .update({ status: 'failed', error_message: body.error || 'unknown render error', updated_at: now() })
          .eq('id', clip_id);
      }
      return json({ ok: true });
    }

    return json({ error: 'unknown kind' }, 400);
  } catch (e: any) {
    console.error('clip-studio-callback error:', e.message);
    return json({ error: e.message }, 500);
  }
});
