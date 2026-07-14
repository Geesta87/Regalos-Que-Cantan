// supabase/functions/clip-studio/index.ts
// Deploy with: supabase functions deploy clip-studio --project-ref yzbvajungshqcpusfiia
//
// Clip Studio (Phase 1) — admin API for the auto-caption tool. Standalone by
// design: its own tables (clip_projects / clips) + its own storage bucket
// ('clip-studio'), no ties to songs/orders, so it can be lifted into its own
// project later. Heavy work runs on the in-house Cloud Run renderer
// (INHOUSE_RENDERER_URL /clip-prepare + /clip-render); results come back via
// the clip-studio-callback function.
//
// Actions:
//   list                                        -> projects (with clips)
//   create_project { title, ext }               -> row + signed upload URL
//   ingest        { project_id }                -> kick prepare (audio+duration) after upload
//   render_clip   { project_id, start_sec, end_sec, aspect, style, label }
//   delete_clip   { clip_id }
//   delete_project{ project_id }
//
// Auth: verify_jwt = true (admin JWT). Caller must be in admin_users — same
// pattern as admin-videos. Service-role for data.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RENDERER_URL = Deno.env.get('INHOUSE_RENDERER_URL');
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CLIP_AI_MODEL = Deno.env.get('CLIP_AI_MODEL') || 'claude-sonnet-5';
const PEXELS_API_KEY = Deno.env.get('PEXELS_API_KEY');

const BUCKET = 'clip-studio';
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/clip-studio-callback`;
const ASPECTS = ['9:16', '1:1', '16:9'];
const STYLES = ['boldpop', 'goldglow', 'cleanbox'];

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// Transcript words -> compact timestamped lines Claude can reason over:
//   [12.4] and the drama team memorized five skits
function timedTranscript(words: Array<{ word: string; start: number; end: number }>) {
  const lines: string[] = [];
  let cur: string[] = [];
  let lineStart = 0;
  for (let i = 0; i < words.length; i++) {
    if (cur.length === 0) lineStart = words[i].start;
    cur.push(words[i].word.trim());
    const gap = i + 1 < words.length ? words[i + 1].start - words[i].end : 99;
    if (cur.length >= 14 || /[.!?…]$/.test(words[i].word.trim()) || gap > 1.2) {
      lines.push(`[${lineStart.toFixed(1)}] ${cur.join(' ')}`);
      cur = [];
    }
  }
  if (cur.length) lines.push(`[${lineStart.toFixed(1)}] ${cur.join(' ')}`);
  return lines.join('\n');
}

const SUGGEST_TOOL = {
  name: 'propose_clips',
  description: 'Propose the best short-form clips from this transcript.',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            start_sec: { type: 'number', description: 'clip start, seconds' },
            end_sec: { type: 'number', description: 'clip end, seconds' },
            title: { type: 'string', description: 'short hook-style name for the clip, in the language of the transcript, max 8 words' },
            reason: { type: 'string', description: 'one sentence: why this moment will perform, in English' },
            score: { type: 'number', description: '1-10 how strong this clip is' },
          },
          required: ['start_sec', 'end_sec', 'title', 'reason', 'score'],
        },
      },
    },
    required: ['suggestions'],
  },
};

// For song teasers the brief changes: we want the chorus / emotional peak of
// SUNG LYRICS, ideally the moment the recipient's name is sung.
function teaserSystemPrompt(recipient: string | null) {
  return (
    'You pick the best TEASER windows from a personalized SONG for a social media ad. ' +
    'You receive the sung lyrics where each line starts with its timestamp in seconds. Pick the 2-3 strongest 18-30 second windows. ' +
    `Rules: prefer the chorus or the emotional peak; ${recipient ? `the window that contains the recipient's name ("${recipient}") being sung is the most valuable — include it; ` : ''}` +
    'start at the beginning of a sung line, end at the end of one; title = a short scroll-stopping hook IN SPANISH for the ad (max 8 words). ' +
    'Call the propose_clips tool with your picks.'
  );
}

async function proposeClips(words: Array<{ word: string; start: number; end: number }>, durationSec: number, teaserRecipient?: string | null, isTeaser = false) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLIP_AI_MODEL,
      max_tokens: 2000,
      system: isTeaser ? teaserSystemPrompt(teaserRecipient ?? null) :
        'You are a short-form video editor who cuts long videos into clips that perform on TikTok, Reels and as social ads. ' +
        'You receive a transcript where each line starts with its timestamp in seconds. Pick the 3-5 STRONGEST self-contained moments. ' +
        'Rules: each clip 10-45 seconds; must begin at a natural sentence start whose first line works as a hook; must end on a completed thought; ' +
        'never start mid-sentence; prefer emotional, surprising, persuasive or highly concrete moments over generic ones; do not overlap clips. ' +
        'Call the propose_clips tool with your picks.',
      messages: [{
        role: 'user',
        content: `Video duration: ${Math.round(durationSec)}s. Transcript:\n\n${timedTranscript(words).slice(0, 60000)}`,
      }],
      tools: [SUGGEST_TOOL],
      tool_choice: { type: 'tool', name: 'propose_clips' },
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const toolUse = (data.content || []).find((b: any) => b.type === 'tool_use');
  const raw = toolUse?.input?.suggestions;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('AI returned no suggestions');

  // Snap to word boundaries so caption timing starts exactly on speech.
  const snap = (s: any) => {
    let start = Number(s.start_sec), end = Number(s.end_sec);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    const first = words.find((w) => w.start >= start - 0.3);
    const lastCandidates = words.filter((w) => w.end <= end + 0.3);
    if (!first || !lastCandidates.length) return null;
    start = Math.max(0, first.start - 0.25);
    end = Math.min(durationSec, lastCandidates[lastCandidates.length - 1].end + 0.35);
    if (end - start < 6 || end - start > 90) return null;
    return {
      start_sec: Math.round(start * 10) / 10,
      end_sec: Math.round(end * 10) / 10,
      title: String(s.title || 'Clip').slice(0, 80),
      reason: String(s.reason || '').slice(0, 300),
      score: Math.max(1, Math.min(10, Number(s.score) || 5)),
    };
  };
  const cleaned = raw.map(snap).filter(Boolean) as any[];
  if (!cleaned.length) throw new Error('AI suggestions did not map to the transcript');
  cleaned.sort((a, b) => b.score - a.score);
  return cleaned.slice(0, 5);
}

// Tag the "power words" of a clip (numbers, names, benefits, emotional
// spikes) so the renderer can paint them gold and bigger. Cheap + fast model;
// failures degrade gracefully to no emphasis.
async function tagEmphasis(words: Array<{ word: string; start: number }>): Promise<number[]> {
  if (!ANTHROPIC_API_KEY || words.length < 6) return [];
  const listing = words.map((w) => `${w.start.toFixed(2)}|${w.word.trim()}`).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system:
        'You tag the power words of a social-video caption track: numbers, names, benefits, emotionally loaded or surprising words. ' +
        `Tag AT MOST ${Math.max(2, Math.ceil(words.length / 8))} words — only the ones that deserve visual emphasis. ` +
        'Call the tag tool with the start timestamps of the chosen words, exactly as given.',
      messages: [{ role: 'user', content: `Each line is "start|word":\n\n${listing.slice(0, 20000)}` }],
      tools: [{
        name: 'tag',
        description: 'Tag emphasis words by their start timestamps.',
        input_schema: { type: 'object', properties: { starts: { type: 'array', items: { type: 'number' } } }, required: ['starts'] },
      }],
      tool_choice: { type: 'tool', name: 'tag' },
    }),
  });
  if (!resp.ok) throw new Error(`emphasis ${resp.status}`);
  const data = await resp.json();
  const starts = (data.content || []).find((b: any) => b.type === 'tool_use')?.input?.starts;
  return Array.isArray(starts) ? starts.filter((s: unknown) => typeof s === 'number').slice(0, 20) : [];
}

// B-roll: Claude reads the clip's transcript and proposes 2-4 short visual
// moments with a stock-footage search query each; Pexels supplies the videos.
async function pickBrollCuts(words: Array<{ word: string; start: number; end: number }>, start: number, end: number) {
  if (!ANTHROPIC_API_KEY) return [];
  const listing = words.map((w) => `${w.start.toFixed(1)}|${w.word.trim()}`).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLIP_AI_MODEL,
      max_tokens: 700,
      system:
        'You add B-ROLL to a talking-head social clip. From the timestamped transcript, pick 2-4 moments where cutting to stock footage of WHAT IS BEING DESCRIBED makes the clip more visual. ' +
        `Rules: each cut 2.0-4.0 seconds; the first cut must start after ${(start + 3).toFixed(1)} (keep the hook on the speaker); the last must end before ${(end - 2).toFixed(1)}; ` +
        'leave at least 4 seconds of speaker between cuts; never cover a moment where the speaker says something personal/direct-to-camera. ' +
        'query = a concrete 2-4 word ENGLISH stock-video search for what is described (visual nouns: "kids rehearsing stage", "volunteers church hall"). Call the tool.',
      messages: [{ role: 'user', content: `Each line is "start|word":\n\n${listing.slice(0, 20000)}` }],
      tools: [{
        name: 'broll',
        description: 'Propose b-roll cuts.',
        input_schema: {
          type: 'object',
          properties: {
            cuts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  t_start: { type: 'number' }, t_end: { type: 'number' },
                  query: { type: 'string', description: '2-4 word English stock search' },
                },
                required: ['t_start', 't_end', 'query'],
              },
            },
          },
          required: ['cuts'],
        },
      }],
      tool_choice: { type: 'tool', name: 'broll' },
    }),
  });
  if (!resp.ok) throw new Error(`broll pick ${resp.status}`);
  const data = await resp.json();
  const cuts = (data.content || []).find((b: any) => b.type === 'tool_use')?.input?.cuts;
  if (!Array.isArray(cuts)) return [];
  return cuts
    .map((c: any) => ({ start: Number(c.t_start), end: Number(c.t_end), query: String(c.query || '').slice(0, 60) }))
    .filter((c) => !Number.isNaN(c.start) && !Number.isNaN(c.end) && c.query &&
      c.start >= start + 2.5 && c.end <= end - 1.5 && c.end - c.start >= 1.5 && c.end - c.start <= 5)
    .slice(0, 4);
}

async function searchPexelsVideo(query: string, aspect: string): Promise<string | null> {
  const orientation = aspect === '9:16' ? 'portrait' : aspect === '1:1' ? 'square' : 'landscape';
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=3&size=medium`,
    { headers: { Authorization: PEXELS_API_KEY! } },
  );
  if (!res.ok) throw new Error(`pexels ${res.status}`);
  const data = await res.json();
  for (const video of data.videos || []) {
    const files = (video.video_files || [])
      .filter((f: any) => f.file_type === 'video/mp4' && Math.min(f.width || 0, f.height || 0) >= 700)
      .sort((a: any, b: any) => (a.width * a.height) - (b.width * b.height));
    if (files.length) return files[0].link;
  }
  return null;
}

async function dispatchRenderer(path: string, job: Record<string, unknown>) {
  if (!RENDERER_URL) throw new Error('INHOUSE_RENDERER_URL not configured');
  const res = await fetch(`${RENDERER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN },
    body: JSON.stringify(job),
  });
  if (res.status !== 202) throw new Error(`renderer ${path} replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (o: unknown, code = 200) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: code });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ success: false, error: 'Missing Authorization' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: ue } = await userClient.auth.getUser();
    if (ue || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', userData.user.id).single();
    if (!roleRow) return json({ success: false, error: 'Not authorized' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'list';

    if (action === 'list') {
      const { data: projects, error } = await admin.from('clip_projects')
        .select('*').order('created_at', { ascending: false }).limit(30);
      if (error) throw new Error(error.message);
      const ids = (projects || []).map((p: any) => p.id);
      let clips: any[] = [];
      if (ids.length) {
        const { data } = await admin.from('clips').select('*').in('project_id', ids).order('created_at', { ascending: false });
        clips = data || [];
      }
      // Transcripts can be huge; the list view only needs word_count + text preview.
      const slim = (projects || []).map((p: any) => ({
        ...p,
        transcript: undefined,
        transcript_text: p.transcript?.text?.slice(0, 4000) || null,
        word_count: Array.isArray(p.transcript?.words) ? p.transcript.words.length : 0,
        clips: clips.filter((c) => c.project_id === p.id),
      }));
      return json({ success: true, projects: slim });
    }

    if (action === 'create_project') {
      const title = String(body.title || 'Untitled video').slice(0, 120);
      const ext = String(body.ext || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4';
      const { data: proj, error } = await admin.from('clip_projects')
        .insert({ title, status: 'uploaded' }).select().single();
      if (error) throw new Error(error.message);
      const sourcePath = `${proj.id}/source.${ext}`;
      const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(sourcePath, { upsert: true });
      if (se) throw new Error(`sign: ${se.message}`);
      return json({ success: true, project_id: proj.id, signed_url: signed.signedUrl, path: sourcePath });
    }

    if (action === 'ingest') {
      const { project_id, path: sourcePath } = body;
      if (!project_id || !sourcePath) throw new Error('Missing project_id or path');
      const source_url = admin.storage.from(BUCKET).getPublicUrl(sourcePath).data.publicUrl;
      const { error } = await admin.from('clip_projects')
        .update({ source_path: sourcePath, source_url, status: 'preparing', error_message: null, updated_at: new Date().toISOString() })
        .eq('id', project_id);
      if (error) throw new Error(error.message);
      // Cloud Run holds no Supabase key (house pattern, same as the Animado
      // builder) — hand it a pre-signed PUT URL for the audio it extracts.
      const audioPath = `${project_id}/audio.mp3`;
      const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(audioPath, { upsert: true });
      if (se) throw new Error(`sign audio: ${se.message}`);
      await dispatchRenderer('/clip-prepare', {
        project_id, source_url, bucket: BUCKET, callback_url: CALLBACK_URL,
        audio_upload_url: signed.signedUrl, audio_path: audioPath,
        audio_public_url: admin.storage.from(BUCKET).getPublicUrl(audioPath).data.publicUrl,
      });
      return json({ success: true, status: 'preparing' });
    }

    if (action === 'song_search') {
      const q = String(body.q || '').trim();
      let query = admin.from('songs')
        .select('id, recipient_name, genre, genre_name, occasion, created_at, image_url')
        .eq('paid', true).not('audio_url', 'is', null)
        .order('created_at', { ascending: false }).limit(15);
      if (q) query = query.ilike('recipient_name', `%${q}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return json({
        success: true,
        songs: (data || []).map((s: any) => ({
          id: s.id, recipient_name: s.recipient_name, genre: s.genre_name || s.genre,
          occasion: s.occasion, created_at: s.created_at, has_cover: !!s.image_url,
        })),
      });
    }

    if (action === 'create_teaser_project') {
      const { song_id } = body;
      if (!song_id) throw new Error('Missing song_id');
      const { data: song, error: se } = await admin.from('songs')
        .select('id, recipient_name, genre, genre_name, audio_url, image_url, lyrics, lyrics_timestamps')
        .eq('id', song_id).single();
      if (se || !song) throw new Error('song not found');
      if (!song.audio_url) throw new Error('song has no audio yet');

      const timed = Array.isArray(song.lyrics_timestamps?.words) && song.lyrics_timestamps.words.length > 0;
      const title = `Teaser — ${song.recipient_name || 'canción'} (${song.genre_name || song.genre || 'song'})`;
      const { data: proj, error: pe } = await admin.from('clip_projects').insert({
        kind: 'song_teaser',
        title,
        source_url: song.audio_url,
        status: timed ? 'ready' : 'transcribing',
        transcript: timed ? { words: song.lyrics_timestamps.words, text: song.lyrics || '', duration: song.lyrics_timestamps.duration } : null,
        duration_sec: timed ? song.lyrics_timestamps.duration : null,
        meta: { song_id: song.id, cover_url: song.image_url, recipient: song.recipient_name },
      }).select('id').single();
      if (pe) throw new Error(pe.message);

      if (!timed) {
        // Kie aligned-words (fast, free) with Whisper fallback — transcribe-song
        // caches onto the song row; we copy the result onto the project.
        const run = async () => {
          try {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-song`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ songId: song.id }),
            });
            const out = await r.json();
            if (!out.success || !Array.isArray(out.words)) throw new Error(out.error || 'no words');
            await admin.from('clip_projects').update({
              transcript: { words: out.words, text: song.lyrics || '', duration: out.duration },
              duration_sec: out.duration, status: 'ready', updated_at: new Date().toISOString(),
            }).eq('id', proj.id);
          } catch (e) {
            await admin.from('clip_projects').update({
              status: 'error', error_message: `Could not get word timing for this song: ${(e as Error).message}`,
              updated_at: new Date().toISOString(),
            }).eq('id', proj.id);
          }
        };
        // deno-lint-ignore no-explicit-any
        if (typeof (globalThis as any).EdgeRuntime !== 'undefined') (globalThis as any).EdgeRuntime.waitUntil(run()); else run();
      }
      return json({ success: true, project_id: proj.id });
    }

    if (action === 'pool_add') {
      const { song_id, note } = body;
      if (!song_id) throw new Error('Missing song_id');
      const { error } = await admin.from('marketing_song_pool')
        .upsert({ song_id, note: note ? String(note).slice(0, 200) : null, active: true }, { onConflict: 'song_id' });
      if (error) throw new Error(error.message);
      return json({ success: true });
    }

    if (action === 'suggest_clips') {
      const { project_id } = body;
      if (!project_id) throw new Error('Missing project_id');
      const { data: proj, error: pe } = await admin.from('clip_projects')
        .select('id, duration_sec, transcript, status, kind, meta').eq('id', project_id).single();
      if (pe || !proj) throw new Error('project not found');
      if (proj.status !== 'ready') throw new Error(`project is '${proj.status}', not ready`);
      const words = proj.transcript?.words;
      if (!Array.isArray(words) || words.length < 20) throw new Error('Not enough speech in this video to pick clips from');

      const isTeaser = proj.kind === 'song_teaser';
      const suggestions = await proposeClips(words, Number(proj.duration_sec) || words[words.length - 1].end, proj.meta?.recipient, isTeaser);
      const ai_suggestions = { generated_at: new Date().toISOString(), model: CLIP_AI_MODEL, suggestions };
      await admin.from('clip_projects').update({ ai_suggestions, updated_at: new Date().toISOString() }).eq('id', project_id);
      return json({ success: true, ai_suggestions });
    }

    if (action === 'render_clip') {
      const { project_id, start_sec, end_sec, aspect, style, label } = body;
      if (!project_id) throw new Error('Missing project_id');
      if (!ASPECTS.includes(aspect)) throw new Error(`aspect must be one of ${ASPECTS.join(', ')}`);
      if (!STYLES.includes(style)) throw new Error(`style must be one of ${STYLES.join(', ')}`);

      const { data: proj, error: pe } = await admin.from('clip_projects')
        .select('id, source_url, duration_sec, transcript, status, kind, meta').eq('id', project_id).single();
      if (pe || !proj) throw new Error('project not found');
      if (proj.status !== 'ready') throw new Error(`project is '${proj.status}', not ready`);
      const words = proj.transcript?.words;
      if (!Array.isArray(words) || words.length === 0) throw new Error('project has no transcript words');

      // Song teasers take a simpler path: audio window over the cover art.
      if (proj.kind === 'song_teaser') {
        const tStart = Math.max(0, Number(start_sec) || 0);
        const tEnd = Math.min(Number(end_sec) || 0, Number(proj.duration_sec) || Infinity);
        if (tEnd - tStart < 10) throw new Error('Teaser windows need at least 10 seconds');
        if (tEnd - tStart > 45) throw new Error('Teasers work best under 45 seconds — pick a shorter window');
        const tLabel = label ? String(label).slice(0, 120) : null;
        const { data: clip, error: ce } = await admin.from('clips').insert({
          project_id, start_sec: tStart, end_sec: tEnd, aspect, style,
          label: tLabel, status: 'rendering',
          options: { teaser: true, hook_title: !!tLabel },
        }).select().single();
        if (ce) throw new Error(ce.message);
        try {
          const outPath = `${project_id}/clips/${clip.id}.mp4`;
          const { data: signed, error: sge } = await admin.storage.from(BUCKET).createSignedUploadUrl(outPath, { upsert: true });
          if (sge) throw new Error(`sign output: ${sge.message}`);
          await dispatchRenderer('/clip-render', {
            mode: 'teaser', clip_id: clip.id, project_id,
            audio_src: proj.source_url, bg_image_url: proj.meta?.cover_url || null,
            start_sec: tStart, end_sec: tEnd, aspect, style, words,
            options: { hook_title_text: tLabel },
            endcard_text: 'regalosquecantan.com',
            bucket: BUCKET, callback_url: CALLBACK_URL,
            output_upload_url: signed.signedUrl, output_path: outPath,
            output_public_url: admin.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl,
          });
        } catch (e) {
          await admin.from('clips').update({ status: 'failed', error_message: (e as Error).message, updated_at: new Date().toISOString() }).eq('id', clip.id);
          throw e;
        }
        return json({ success: true, clip });
      }

      const start = Math.max(0, Number(start_sec) || 0);
      const end = Math.min(Number(end_sec) || Number(proj.duration_sec) || 0, Number(proj.duration_sec) || Infinity);
      if (end - start < 0.5) throw new Error('clip range too short');
      if (end - start > 180) throw new Error('Phase 1 caps clips at 3 minutes — pick a shorter range');

      // Phase 3 render options (all optional, validated here).
      const rawOpts = body.options || {};
      const cleanLabel = label ? String(label).slice(0, 120) : null;
      const options = {
        framing: ['auto', 'left', 'center', 'right'].includes(rawOpts.framing) ? rawOpts.framing : 'center',
        remove_silences: !!rawOpts.remove_silences,
        zoom: !!rawOpts.zoom,
        hook_title: !!rawOpts.hook_title,
        emphasis: rawOpts.emphasis !== false,
        music: !!rawOpts.music,
        broll: !!rawOpts.broll,
        transitions: rawOpts.transitions !== false,
        clean_audio: !!rawOpts.clean_audio,
      };
      if (options.hook_title && !cleanLabel) throw new Error('Give the clip a name to use as the title overlay');

      // Emphasis words (best-effort — a failure just means plain captions).
      let emphasis_starts: number[] = [];
      if (options.emphasis) {
        const inRange = (words as any[]).filter((w) => w.end > start + 0.05 && w.start < end - 0.05);
        try { emphasis_starts = await tagEmphasis(inRange); } catch (e) { console.warn('emphasis tagging failed:', (e as Error).message); }
      }

      // B-roll: Claude picks the moments + queries, Pexels supplies footage.
      // Best-effort per cut — a failed search just means fewer cuts.
      const broll: Array<{ start: number; end: number; url: string }> = [];
      if (options.broll) {
        if (!PEXELS_API_KEY) throw new Error('B-roll needs the Pexels key (PEXELS_API_KEY) configured');
        const inRange = (words as any[]).filter((w) => w.end > start + 0.05 && w.start < end - 0.05);
        try {
          const cuts = await pickBrollCuts(inRange, start, end);
          for (const cut of cuts) {
            try {
              const url = await searchPexelsVideo(cut.query, aspect);
              if (url) broll.push({ start: cut.start, end: cut.end, url });
            } catch (e) { console.warn(`pexels search "${cut.query}" failed:`, (e as Error).message); }
          }
        } catch (e) { console.warn('broll picking failed:', (e as Error).message); }
      }

      // Whoosh SFX for b-roll entries — only if the owner uploaded one.
      let sfx_url: string | null = null;
      if (options.transitions && broll.length) {
        const { data: sfx } = await admin.storage.from(BUCKET).list('sfx');
        const whoosh = (sfx || []).find((f: any) => /^whoosh.*\.(mp3|m4a|aac)$/i.test(f.name || ''));
        if (whoosh) sfx_url = admin.storage.from(BUCKET).getPublicUrl(`sfx/${whoosh.name}`).data.publicUrl;
      }

      // Music bed: pick a random track from the clip-studio/music library.
      let music_url: string | null = null;
      if (options.music) {
        const { data: tracks } = await admin.storage.from(BUCKET).list('music');
        const mp3s = (tracks || []).filter((f: any) => /\.(mp3|m4a|aac)$/i.test(f.name || ''));
        if (!mp3s.length) throw new Error('The music library is empty — use "Music library" on the Clip Studio home screen to upload an MP3 first');
        const pick = mp3s[Math.floor(Math.random() * mp3s.length)];
        music_url = admin.storage.from(BUCKET).getPublicUrl(`music/${pick.name}`).data.publicUrl;
      }

      const { data: clip, error: ce } = await admin.from('clips').insert({
        project_id, start_sec: start, end_sec: end, aspect, style,
        label: cleanLabel, status: 'rendering', options,
      }).select().single();
      if (ce) throw new Error(ce.message);

      try {
        const outPath = `${project_id}/clips/${clip.id}.mp4`;
        const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(outPath, { upsert: true });
        if (se) throw new Error(`sign output: ${se.message}`);
        await dispatchRenderer('/clip-render', {
          clip_id: clip.id, project_id, source_url: proj.source_url,
          start_sec: start, end_sec: end, aspect, style, words,
          options: { ...options, hook_title_text: options.hook_title ? cleanLabel : null, emphasis_starts },
          music_url, broll, sfx_url,
          bucket: BUCKET, callback_url: CALLBACK_URL,
          output_upload_url: signed.signedUrl, output_path: outPath,
          output_public_url: admin.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl,
        });
      } catch (e) {
        await admin.from('clips').update({ status: 'failed', error_message: (e as Error).message, updated_at: new Date().toISOString() }).eq('id', clip.id);
        throw e;
      }
      return json({ success: true, clip });
    }

    if (action === 'sign_music') {
      const name = String(body.filename || 'track.mp3').replace(/[^a-z0-9._-]/gi, '_').slice(0, 80);
      if (!/\.(mp3|m4a|aac)$/i.test(name)) throw new Error('Music must be an MP3/M4A file');
      const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(`music/${name}`, { upsert: true });
      if (se) throw new Error(`sign: ${se.message}`);
      return json({ success: true, signed_url: signed.signedUrl, path: `music/${name}` });
    }

    if (action === 'music_list') {
      const { data: tracks } = await admin.storage.from(BUCKET).list('music');
      return json({ success: true, tracks: (tracks || []).map((f: any) => f.name).filter((n: string) => /\.(mp3|m4a|aac)$/i.test(n)) });
    }

    if (action === 'send_to_creative') {
      const { clip_id } = body;
      if (!clip_id) throw new Error('Missing clip_id');
      const { data: clip } = await admin.from('clips').select('id, project_id, label, video_url, status, aspect, start_sec, end_sec').eq('id', clip_id).single();
      if (!clip) throw new Error('clip not found');
      if (clip.status !== 'ready' || !clip.video_url) throw new Error('Clip is not ready yet');
      const { data: proj } = await admin.from('clip_projects').select('title, transcript').eq('id', clip.project_id).single();
      const name = clip.label || proj?.title || 'Clip Studio clip';

      // Auto description: Claude writes the post caption + hashtags from what
      // is actually said in the clip. Falls back to the clip name on failure.
      let caption = name;
      let hashtags: string[] | null = null;
      try {
        const words = (proj?.transcript?.words || []) as Array<{ word: string; start: number; end: number }>;
        const said = words
          .filter((w) => w.end > Number(clip.start_sec) && w.start < (clip.end_sec != null ? Number(clip.end_sec) : Infinity))
          .map((w) => w.word.trim()).join(' ').slice(0, 2500);
        if (ANTHROPIC_API_KEY && said.length > 40) {
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 400,
              system:
                'You write social post captions for Regalos Que Cantan (personalized song gifts, warm Spanish-speaking brand). ' +
                'Given what is said in a short video clip, write ONE caption in the language of the clip: a scroll-stopping first line, 1-2 short warm sentences, no links, no emoji spam (max 2 emoji). ' +
                'Also give 4-6 relevant hashtags (no # in the strings). Call the tool.',
              messages: [{ role: 'user', content: `Clip title: ${name}\nWhat is said:\n${said}` }],
              tools: [{
                name: 'post',
                description: 'The caption and hashtags.',
                input_schema: {
                  type: 'object',
                  properties: {
                    caption: { type: 'string' },
                    hashtags: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['caption', 'hashtags'],
                },
              }],
              tool_choice: { type: 'tool', name: 'post' },
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            const out = (data.content || []).find((b: any) => b.type === 'tool_use')?.input;
            if (out?.caption) caption = String(out.caption).slice(0, 900);
            if (Array.isArray(out?.hashtags)) hashtags = out.hashtags.map((h: unknown) => String(h).replace(/^#/, '').slice(0, 40)).slice(0, 6);
          }
        }
      } catch (e) { console.warn('auto description failed:', (e as Error).message); }

      const { error: qe } = await admin.from('creative_queue').insert({
        kind: 'video',
        status: 'ready',
        intended_use: 'organic',
        batch_date: new Date().toISOString().slice(0, 10),
        concept: `Clip Studio — ${name}`,
        caption,
        ...(hashtags ? { hashtags } : {}),
        media_url: clip.video_url,
        design: { source: 'clip-studio', clip_id: clip.id, aspect: clip.aspect },
      });
      if (qe) throw new Error(qe.message);
      return json({ success: true });
    }

    if (action === 'delete_clip') {
      const { clip_id } = body;
      if (!clip_id) throw new Error('Missing clip_id');
      const { data: clip } = await admin.from('clips').select('id, storage_path').eq('id', clip_id).single();
      if (clip?.storage_path) await admin.storage.from(BUCKET).remove([clip.storage_path]).catch?.(() => {});
      await admin.from('clips').delete().eq('id', clip_id);
      return json({ success: true });
    }

    if (action === 'delete_project') {
      const { project_id } = body;
      if (!project_id) throw new Error('Missing project_id');
      // best-effort storage cleanup: source + audio + rendered clips
      const paths: string[] = [];
      const { data: root } = await admin.storage.from(BUCKET).list(project_id);
      (root || []).forEach((f: any) => { if (f.name) paths.push(`${project_id}/${f.name}`); });
      const { data: sub } = await admin.storage.from(BUCKET).list(`${project_id}/clips`);
      (sub || []).forEach((f: any) => { if (f.name) paths.push(`${project_id}/clips/${f.name}`); });
      if (paths.length) await admin.storage.from(BUCKET).remove(paths);
      await admin.from('clip_projects').delete().eq('id', project_id); // clips cascade
      return json({ success: true });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e: any) {
    console.error('clip-studio error:', e.message);
    return json({ success: false, error: e.message }, 500);
  }
});
