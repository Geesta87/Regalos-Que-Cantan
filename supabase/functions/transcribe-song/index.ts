// supabase/functions/transcribe-song/index.ts
// Deploy with: supabase functions deploy transcribe-song --project-ref yzbvajungshqcpusfiia
//
// Word-level TIMING helper for the AI story-video / lyric-video pipeline.
// Given { songId }, returns exact word-level timestamps so the storyboard step
// can place each scene on the precise sung moment, and caches them to
// songs.lyrics_timestamps.
//
// Timing source priority (most accurate first):
//   1. Kie/Suno native alignedWords (get-timestamped-lyrics) — exact "sung == shown"
//   2. OpenAI Whisper (word granularities) — fallback
// Mirrors the proven logic in api/render-lyric-video.js.
//
// Auth: called manually / server-to-server (no Supabase JWT) -> verify_jwt MUST
// be false (see supabase/config.toml). KIE_API_KEY / OPENAI_API_KEY / service-role
// key are read from the function's own env (never exposed to the caller).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getKieAudioId(song: any): Promise<string | null> {
  try {
    const kp = typeof song.kie_payload === 'string' ? JSON.parse(song.kie_payload) : song.kie_payload;
    if (kp && kp.id) return kp.id;
  } catch { /* ignore */ }
  const ri = await fetch(
    `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(song.kie_task_id)}`,
    { headers: { Authorization: `Bearer ${KIE_API_KEY}` } },
  );
  const rj = await ri.json().catch(() => null);
  const tracks = rj?.data?.response?.sunoData || [];
  const idx = (song.version || 1) - 1;
  return tracks[idx]?.id || tracks[0]?.id || null;
}

// Exact Kie/Suno word timings -> [{word,start,end}]
async function getKieWords(song: any) {
  if (!KIE_API_KEY || !song.kie_task_id) return null;
  const audioId = await getKieAudioId(song);
  if (!audioId) return null;
  const resp = await fetch('https://api.kie.ai/api/v1/generate/get-timestamped-lyrics', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: song.kie_task_id, audioId }),
  });
  const json = await resp.json().catch(() => null);
  const aligned = json?.data?.alignedWords;
  if (!Array.isArray(aligned) || aligned.length === 0) return null;
  const words = aligned
    .map((w: any) => ({ word: String(w.word || ''), start: Number(w.startS), end: Number(w.endS) }))
    .filter((w: any) => w.word && !Number.isNaN(w.start) && !Number.isNaN(w.end));
  return words.length ? words : null;
}

async function getWhisperWords(audioUrl: string) {
  if (!OPENAI_API_KEY) return null;
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`audio fetch ${audioRes.status}`);
  const form = new FormData();
  form.append('file', await audioRes.blob(), 'song.mp3');
  form.append('model', 'whisper-1');
  form.append('language', 'es');
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
  return words.length ? { words, duration: Number(data.duration) || 0, text: String(data.text || '') } : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (code: number, obj: unknown) =>
    new Response(JSON.stringify(obj), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: code });

  try {
    const { songId, force } = await req.json();
    if (!songId) throw new Error('Missing songId');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: song, error } = await supabase
      .from('songs')
      .select('id, audio_url, provider, version, kie_task_id, kie_payload, lyrics_timestamps')
      .eq('id', songId).single();
    if (error || !song) throw new Error(`Song not found: ${error?.message || 'no row'}`);

    const cached = song.lyrics_timestamps as any;
    if (!force && cached && Array.isArray(cached.words) && cached.words.length > 0) {
      return json(200, { success: true, source: cached.source || 'cache', word_count: cached.words.length, duration: cached.duration, words: cached.words });
    }

    // 1) Exact Kie/Suno timings
    let words = null, source = '', duration = 0;
    try {
      const kie = await getKieWords(song);
      if (kie) { words = kie; source = 'kie'; duration = kie[kie.length - 1].end; }
    } catch (e) { console.warn('kie timing failed:', (e as Error).message); }

    // 2) Whisper fallback
    if (!words) {
      if (!song.audio_url) throw new Error('No audio_url for Whisper fallback');
      const w = await getWhisperWords(song.audio_url);
      if (w) { words = w.words; source = 'whisper'; duration = w.duration; }
    }
    if (!words) throw new Error('Could not obtain word timings (Kie + Whisper both failed)');

    const result = { words, duration, source };
    await supabase.from('songs').update({ lyrics_timestamps: result }).eq('id', songId);
    return json(200, { success: true, source, word_count: words.length, duration, words });
  } catch (e: any) {
    console.error('transcribe-song error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
