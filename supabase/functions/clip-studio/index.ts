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

async function proposeClips(words: Array<{ word: string; start: number; end: number }>, durationSec: number) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLIP_AI_MODEL,
      max_tokens: 2000,
      system:
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

    if (action === 'suggest_clips') {
      const { project_id } = body;
      if (!project_id) throw new Error('Missing project_id');
      const { data: proj, error: pe } = await admin.from('clip_projects')
        .select('id, duration_sec, transcript, status').eq('id', project_id).single();
      if (pe || !proj) throw new Error('project not found');
      if (proj.status !== 'ready') throw new Error(`project is '${proj.status}', not ready`);
      const words = proj.transcript?.words;
      if (!Array.isArray(words) || words.length < 20) throw new Error('Not enough speech in this video to pick clips from');

      const suggestions = await proposeClips(words, Number(proj.duration_sec) || words[words.length - 1].end);
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
        .select('id, source_url, duration_sec, transcript, status').eq('id', project_id).single();
      if (pe || !proj) throw new Error('project not found');
      if (proj.status !== 'ready') throw new Error(`project is '${proj.status}', not ready`);
      const words = proj.transcript?.words;
      if (!Array.isArray(words) || words.length === 0) throw new Error('project has no transcript words');

      const start = Math.max(0, Number(start_sec) || 0);
      const end = Math.min(Number(end_sec) || Number(proj.duration_sec) || 0, Number(proj.duration_sec) || Infinity);
      if (end - start < 0.5) throw new Error('clip range too short');
      if (end - start > 180) throw new Error('Phase 1 caps clips at 3 minutes — pick a shorter range');

      // Phase 3 render options (all optional, validated here).
      const rawOpts = body.options || {};
      const cleanLabel = label ? String(label).slice(0, 120) : null;
      const options = {
        framing: ['left', 'center', 'right'].includes(rawOpts.framing) ? rawOpts.framing : 'center',
        remove_silences: !!rawOpts.remove_silences,
        zoom: !!rawOpts.zoom,
        hook_title: !!rawOpts.hook_title,
      };
      if (options.hook_title && !cleanLabel) throw new Error('Give the clip a name to use as the title overlay');

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
          options: { ...options, hook_title_text: options.hook_title ? cleanLabel : null },
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
