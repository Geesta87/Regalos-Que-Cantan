// supabase/functions/song-teaser-daily/index.ts
// Deploy with: supabase functions deploy song-teaser-daily --project-ref yzbvajungshqcpusfiia
//
// SONG-TEASER factory (Clip Studio Phase 2). Turns a catalog song into a
// vertical teaser ad: word timing (Kie aligned words via transcribe-song),
// Claude picks the best 18-30s window + a Spanish hook, and the in-house
// renderer burns karaoke captions over the cover art with a brand end-card.
//
// Modes (POST JSON):
//   {}                    -> rotation: next active row from marketing_song_pool
//                            (owner-cleared songs only), auto-queues the finished
//                            teaser into creative_queue for approval.
//   { song_id }           -> one-off teaser for that song (owner previews).
//                            NOT auto-queued.
//
// Auth: pg_cron / operator only — no user JWT, so verify_jwt = false in
// config.toml. Fails closed unless the x-teaser-token header matches the
// TEASER_TRIGGER_SECRET project secret (same pattern as send-fathers-day-campaign).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RENDERER_URL = Deno.env.get('INHOUSE_RENDERER_URL');
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CLIP_AI_MODEL = Deno.env.get('CLIP_AI_MODEL') || 'claude-sonnet-5';
const TEASER_TRIGGER_SECRET = Deno.env.get('TEASER_TRIGGER_SECRET');

const BUCKET = 'clip-studio';
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/clip-studio-callback`;

function timedLyrics(words: Array<{ word: string; start: number; end: number }>) {
  const lines: string[] = [];
  let cur: string[] = [];
  let lineStart = 0;
  for (let i = 0; i < words.length; i++) {
    if (cur.length === 0) lineStart = words[i].start;
    cur.push(words[i].word.trim());
    const gap = i + 1 < words.length ? words[i + 1].start - words[i].end : 99;
    if (cur.length >= 10 || gap > 1.0) { lines.push(`[${lineStart.toFixed(1)}] ${cur.join(' ')}`); cur = []; }
  }
  if (cur.length) lines.push(`[${lineStart.toFixed(1)}] ${cur.join(' ')}`);
  return lines.join('\n');
}

async function pickWindow(words: Array<{ word: string; start: number; end: number }>, duration: number, recipient: string | null) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLIP_AI_MODEL,
      max_tokens: 400,
      system:
        'You pick the single best TEASER window from a personalized song for a social ad. Lyrics lines start with their timestamp. ' +
        `Rules: 18-30 seconds; prefer the chorus / emotional peak; ${recipient ? `the moment the name "${recipient}" is sung is the most valuable — include it if possible; ` : ''}` +
        'start and end on sung-line boundaries. hook = a scroll-stopping ad hook IN SPANISH, max 8 words. Call the tool.',
      messages: [{ role: 'user', content: `Song duration ${Math.round(duration)}s. Sung lyrics:\n\n${timedLyrics(words).slice(0, 20000)}` }],
      tools: [{
        name: 'window',
        description: 'The chosen teaser window.',
        input_schema: {
          type: 'object',
          properties: { start_sec: { type: 'number' }, end_sec: { type: 'number' }, hook: { type: 'string' } },
          required: ['start_sec', 'end_sec', 'hook'],
        },
      }],
      tool_choice: { type: 'tool', name: 'window' },
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}`);
  const data = await resp.json();
  const w = (data.content || []).find((b: any) => b.type === 'tool_use')?.input;
  let s = Number(w?.start_sec), e = Number(w?.end_sec);
  if (Number.isNaN(s) || Number.isNaN(e)) throw new Error('AI returned no window');
  // snap to word boundaries + clamp 15-35s
  const first = words.find((x) => x.start >= s - 0.4) || words[0];
  s = Math.max(0, first.start - 0.2);
  e = Math.min(duration, Math.max(e, s + 15));
  if (e - s > 35) e = s + 30;
  const lastIn = words.filter((x) => x.end <= e + 0.3);
  if (lastIn.length) e = Math.min(duration, lastIn[lastIn.length - 1].end + 0.4);
  return { start: Math.round(s * 10) / 10, end: Math.round(e * 10) / 10, hook: String(w.hook || 'Una canción hecha solo para ella').slice(0, 80) };
}

serve(async (req) => {
  const json = (o: unknown, code = 200) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' }, status: code });
  try {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!TEASER_TRIGGER_SECRET || req.headers.get('x-teaser-token') !== TEASER_TRIGGER_SECRET) return json({ error: 'unauthorized' }, 401);
    if (!RENDERER_URL) throw new Error('INHOUSE_RENDERER_URL not configured');
    const body = await req.json().catch(() => ({}));

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Which song? Explicit (owner preview) or next from the cleared pool (cron).
    let songId: string | null = body.song_id || null;
    const fromPool = !songId;
    if (fromPool) {
      const { data: pool } = await admin.from('marketing_song_pool')
        .select('id, song_id').eq('active', true)
        .order('last_used_at', { ascending: true, nullsFirst: true }).limit(1);
      if (!pool?.length) return json({ success: false, error: 'marketing_song_pool is empty — add songs cleared for marketing first' });
      songId = pool[0].song_id;
      await admin.from('marketing_song_pool').update({ last_used_at: new Date().toISOString() }).eq('id', pool[0].id);
    }

    const { data: song, error: se } = await admin.from('songs')
      .select('id, recipient_name, genre, genre_name, audio_url, image_url, lyrics, lyrics_timestamps')
      .eq('id', songId).single();
    if (se || !song) throw new Error('song not found');
    if (!song.audio_url) throw new Error('song has no audio');

    // Ensure word timing (Kie aligned words; Whisper fallback) — cached on the song.
    let words = song.lyrics_timestamps?.words;
    let duration = song.lyrics_timestamps?.duration;
    if (!Array.isArray(words) || !words.length) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-song`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id }),
      });
      const out = await r.json();
      if (!out.success || !Array.isArray(out.words)) throw new Error(`word timing failed: ${out.error || 'no words'}`);
      words = out.words;
      duration = out.duration;
    }
    duration = Number(duration) || words[words.length - 1].end;

    const win = await pickWindow(words, duration, song.recipient_name || null);

    // Project + clip rows (the teaser shows up in Clip Studio like everything else).
    const { data: proj, error: pe } = await admin.from('clip_projects').insert({
      kind: 'song_teaser',
      title: `Teaser — ${song.recipient_name || 'canción'} (${song.genre_name || song.genre || 'song'})`,
      source_url: song.audio_url,
      status: 'ready',
      transcript: { words, text: song.lyrics || '', duration },
      duration_sec: duration,
      meta: { song_id: song.id, cover_url: song.image_url, recipient: song.recipient_name, via: fromPool ? 'cron' : 'manual' },
    }).select('id').single();
    if (pe) throw new Error(pe.message);

    const { data: clip, error: ce } = await admin.from('clips').insert({
      project_id: proj.id, start_sec: win.start, end_sec: win.end,
      aspect: '9:16', style: 'goldglow', label: win.hook, status: 'rendering',
      options: { teaser: true, hook_title: true, auto_queue: fromPool },
    }).select('id').single();
    if (ce) throw new Error(ce.message);

    const outPath = `${proj.id}/clips/${clip.id}.mp4`;
    const { data: signed, error: sge } = await admin.storage.from(BUCKET).createSignedUploadUrl(outPath, { upsert: true });
    if (sge) throw new Error(`sign: ${sge.message}`);

    const res = await fetch(`${RENDERER_URL}/clip-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN },
      body: JSON.stringify({
        mode: 'teaser', clip_id: clip.id, project_id: proj.id,
        audio_src: song.audio_url, bg_image_url: song.image_url || null,
        start_sec: win.start, end_sec: win.end, aspect: '9:16', style: 'goldglow', words,
        options: { hook_title_text: win.hook, auto_queue: fromPool },
        endcard_text: 'regalosquecantan.com',
        bucket: BUCKET, callback_url: CALLBACK_URL,
        output_upload_url: signed.signedUrl, output_path: outPath,
        output_public_url: admin.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl,
      }),
    });
    if (res.status !== 202) throw new Error(`renderer replied ${res.status}: ${(await res.text()).slice(0, 200)}`);

    return json({ success: true, project_id: proj.id, clip_id: clip.id, window: win, auto_queue: fromPool });
  } catch (e: any) {
    console.error('song-teaser-daily error:', e.message);
    return json({ success: false, error: e.message }, 500);
  }
});
