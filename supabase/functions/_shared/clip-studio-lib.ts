// supabase/functions/_shared/clip-studio-lib.ts
// Shared Clip Studio logic used by three functions:
//   clip-studio          (admin API: suggest, render, retry)
//   clip-studio-callback (auto-pilot kickoff once a transcript is ready)
//   clip-studio-watchdog (pg_cron: stuck-render retry, auto-pilot sweep, purge)
//
// Everything here runs with a service-role client passed in by the caller.
// Renderer contract: POST {INHOUSE_RENDERER_URL}/clip-render with x-render-token;
// the job's stable fields live in clips.render_job so a retry can re-dispatch
// with nothing but the clip row + its project (fresh signed URLs minted here).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const RENDERER_URL = Deno.env.get('INHOUSE_RENDERER_URL');
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CLIP_AI_MODEL = Deno.env.get('CLIP_AI_MODEL') || 'claude-sonnet-5';

export const BUCKET = 'clip-studio';
export const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/clip-studio-callback`;
export const ASPECTS = ['9:16', '1:1', '16:9'];
export const STYLES = ['boldpop', 'goldglow', 'cleanbox', 'popline', 'rosa', 'minimal', 'lujo', 'grande', 'resalta', 'brillo', 'sombra', 'fluido', 'palabra', 'pildora', 'heroe', 'temblor', 'escenario', 'fiesta', 'editorial', 'corrido', 'craft', 'retro', 'brasa', 'impacto', 'neon', 'luxe', 'cine', 'grafica', 'revista', 'energia', 'historia'];

export type Word = { word: string; start: number; end: number };

export const nowIso = () => new Date().toISOString();

export async function dispatchRenderer(path: string, job: Record<string, unknown>) {
  if (!RENDERER_URL) throw new Error('INHOUSE_RENDERER_URL not configured');
  const res = await fetch(`${RENDERER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN },
    body: JSON.stringify(job),
  });
  if (res.status !== 202) throw new Error(`renderer ${path} replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Transcript words -> compact timestamped lines Claude can reason over:
//   [12.4] and the drama team memorized five skits
export function timedTranscript(words: Word[]) {
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

const BEST_PICKS_PROMPT =
  'You are a short-form video editor who cuts long videos into clips that perform on TikTok, Reels and as social ads. ' +
  'You receive a transcript where each line starts with its timestamp in seconds. Pick the 3-5 STRONGEST self-contained moments. ' +
  'Rules: each clip 10-45 seconds; must begin at a natural sentence start whose first line works as a hook; must end on a completed thought; ' +
  'never start mid-sentence; prefer emotional, surprising, persuasive or highly concrete moments over generic ones; do not overlap clips. ' +
  'CRITICAL: end_sec must land AFTER the final word of the closing sentence — when unsure, end LATER, never earlier; cutting a thought off mid-sentence is the worst possible failure. ' +
  'Call the propose_clips tool with your picks.';

// Auto-clip: walk the WHOLE video and pull out every complete, self-contained
// segment — full context, never a mid-thought cut.
const FULL_SEGMENT_PROMPT =
  'You split an ENTIRE video into ALL of its strong, self-contained social media clips. ' +
  'You receive a transcript where each line starts with its timestamp in seconds. Walk through it in order and extract every segment that fully stands on its own. ' +
  'Rules: each clip 15-90 seconds; a clip must start at the natural beginning of a thought, story or point (NEVER mid-sentence) and must end only where that thought completely resolves — the viewer must never feel context was cut off; ' +
  'if a story needs 80 seconds to make sense, use 80 seconds — completeness beats brevity; skip weak, repetitive or filler stretches entirely (do not force clips out of them); clips must not overlap; ' +
  'return between 2 and 8 clips depending on how much genuinely strong material exists, each with a hook-style title in the language of the transcript. ' +
  'CRITICAL: end_sec must land AFTER the final word of the closing sentence — when unsure, end LATER, never earlier; cutting a thought off mid-sentence is the worst possible failure. ' +
  'Call the propose_clips tool with your picks.';

export async function proposeClips(
  words: Word[],
  durationSec: number,
  opts: { mode?: 'best' | 'teaser' | 'full'; recipient?: string | null } = {},
) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  // Words the owner crossed out in the transcript editor don't exist as far
  // as clip picking is concerned.
  words = words.filter((w) => !(w as any).cut);
  const mode = opts.mode || 'best';
  const system = mode === 'teaser' ? teaserSystemPrompt(opts.recipient ?? null)
    : mode === 'full' ? FULL_SEGMENT_PROMPT
    : BEST_PICKS_PROMPT;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLIP_AI_MODEL,
      max_tokens: 2000,
      system,
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
  // The END walks FORWARD to the completed thought: the AI's end_sec often
  // lands mid-sentence and the old backward snap cut the closing words off.
  const extendMax = mode === 'teaser' ? 4 : 12; // teasers have a 45s render cap
  const snap = (s: any) => {
    let start = Number(s.start_sec), end = Number(s.end_sec);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    const firstIdx = words.findIndex((w) => w.start >= start - 0.3);
    if (firstIdx < 0) return null;
    let lastIdx = -1;
    for (let i = firstIdx; i < words.length; i++) {
      if (words[i].end <= end + 0.3) lastIdx = i; else break;
    }
    if (lastIdx < 0) return null;
    // Finish the thought: continue to closing punctuation or a natural pause
    // (>0.8s), up to extendMax seconds past the proposed end.
    for (let i = lastIdx; i < words.length; i++) {
      lastIdx = i;
      const w = words[i];
      const gapNext = i + 1 < words.length ? words[i + 1].start - w.end : 99;
      if (/[.!?…]$/.test(String(w.word).trim()) || gapNext > 0.8) break;
      if (w.end - end > extendMax) break;
    }
    start = Math.max(0, words[firstIdx].start - 0.25);
    // Tail pad 0.6s: Whisper end-timestamps consistently run early, which was
    // audibly clipping the last word.
    end = Math.min(durationSec, words[lastIdx].end + 0.6);
    if (end - start < 6 || end - start > 105) return null;
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
  if (mode === 'full') {
    // keep chronological order, cap at 8 — auto-clip renders all of them
    cleaned.sort((a, b) => a.start_sec - b.start_sec);
    return cleaned.slice(0, 8);
  }
  cleaned.sort((a, b) => b.score - a.score);
  return cleaned.slice(0, 5);
}

// Tag the "power words" of a clip (numbers, names, benefits, emotional
// spikes) so the renderer can paint them gold and bigger. Cheap + fast model;
// failures degrade gracefully to no emphasis.
export async function tagEmphasis(words: Array<{ word: string; start: number }>): Promise<number[]> {
  words = words.filter((w) => !(w as any).cut);
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

// Emoji captions: Haiku tags a handful of caption moments with one fitting
// emoji each (word start times, same matching contract as emphasis_starts).
// Failures degrade to no emoji.
export async function tagEmoji(words: Array<{ word: string; start: number }>): Promise<Array<{ t: number; e: string }>> {
  words = words.filter((w) => !(w as any).cut);
  if (!ANTHROPIC_API_KEY || words.length < 10) return [];
  const listing = words.map((w) => `${w.start.toFixed(2)}|${w.word.trim()}`).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system:
        'You add emoji to social-video captions. Pick the punchy moments — money, love, music, surprise, gifts — and give each ONE fitting emoji. ' +
        'You may ONLY use these emoji (the renderer has exactly these): 🎁 🎶 🎵 ❤️ 😍 😭 🔥 🎉 👏 💯 ⭐ 🙌 💝 🌹 🎂 🥰 😱 🤯 💛 😊. ' +
        `Tag AT MOST ${Math.max(2, Math.ceil(words.length / 12))} words, never two within 3 seconds of each other. ` +
        'Call the tag tool with the exact start timestamps and the emoji.',
      messages: [{ role: 'user', content: `Each line is "start|word":\n\n${listing.slice(0, 20000)}` }],
      tools: [{
        name: 'tag',
        description: 'Tag emoji moments.',
        input_schema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: {
                type: 'object',
                properties: { start: { type: 'number' }, emoji: { type: 'string' } },
                required: ['start', 'emoji'],
              },
            },
          },
          required: ['tags'],
        },
      }],
      tool_choice: { type: 'tool', name: 'tag' },
    }),
  });
  if (!resp.ok) throw new Error(`emoji ${resp.status}`);
  const data = await resp.json();
  const tags = (data.content || []).find((b: any) => b.type === 'tool_use')?.input?.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .map((x: any) => ({ t: Number(x.start), e: String(x.emoji || '').slice(0, 8) }))
    .filter((x) => !Number.isNaN(x.t) && x.e)
    .slice(0, 10);
}

// EN caption version: group the clip's Spanish words like the renderer will,
// translate every group in ONE Claude call, return caption groups on the
// clip-local (pre-cut) timeline for the renderer's caption_groups override.
export async function translateCaptionGroups(
  words: Word[], clipStart: number, targetLang = 'English',
): Promise<Array<{ start: number; end: number; text: string }>> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  words = words.filter((w) => !(w as any).cut);
  // group like the renderer: ~6 words, sentence end, or a pause
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const gap = i + 1 < words.length ? words[i + 1].start - words[i].end : 99;
    const sentenceEnd = /[.!?…]$/.test(words[i].word.trim());
    if (cur.length >= 6 || gap > 0.8 || sentenceEnd || words[i].end - cur[0].start > 3.5) {
      groups.push(cur); cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  if (!groups.length) throw new Error('no words to translate');

  const texts = groups.map((g) => g.map((w) => w.word.trim()).join(' '));
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLIP_AI_MODEL,
      max_tokens: 3000,
      system:
        `You translate video caption lines to natural, punchy ${targetLang} for social media. ` +
        'Translate EACH line as its own caption — same order, same count, roughly similar length so the timing still fits. ' +
        'Keep names untranslated. Call the tool with the translated lines.',
      messages: [{ role: 'user', content: texts.map((t, i) => `${i + 1}. ${t}`).join('\n').slice(0, 30000) }],
      tools: [{
        name: 'translated',
        description: 'The translated caption lines, same order and count as input.',
        input_schema: {
          type: 'object',
          properties: { lines: { type: 'array', items: { type: 'string' } } },
          required: ['lines'],
        },
      }],
      tool_choice: { type: 'tool', name: 'translated' },
    }),
  });
  if (!resp.ok) throw new Error(`translate ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const lines = (data.content || []).find((b: any) => b.type === 'tool_use')?.input?.lines;
  if (!Array.isArray(lines) || lines.length !== groups.length) {
    throw new Error(`translation returned ${Array.isArray(lines) ? lines.length : 0} lines for ${groups.length} groups`);
  }
  return groups.map((g, i) => ({
    start: Math.max(0, g[0].start - clipStart),
    end: Math.max(0, g[g.length - 1].end - clipStart + 0.15),
    text: String(lines[i]).slice(0, 140),
  }));
}

// Fresh pre-signed output slot for a clip render (Cloud Run holds no Supabase key).
export async function mintClipOutput(admin: SupabaseClient, projectId: string, clipId: string) {
  const output_path = `${projectId}/clips/${clipId}.mp4`;
  const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(output_path, { upsert: true });
  if (error) throw new Error(`sign output: ${error.message}`);
  return {
    output_upload_url: signed.signedUrl,
    output_path,
    output_public_url: admin.storage.from(BUCKET).getPublicUrl(output_path).data.publicUrl,
  };
}

// Rebuild the stable render payload for clips created before render_job
// existed. Teasers reconstruct fully; standard clips lose one-shot extras
// that were resolved at dispatch time (music track choice, b-roll footage) —
// a retry still renders captions, silences, framing, title correctly.
export function legacyRenderJob(proj: any, clip: any): Record<string, unknown> {
  const base = {
    start_sec: Number(clip.start_sec), end_sec: Number(clip.end_sec),
    aspect: clip.aspect, style: clip.style,
  };
  if (proj.kind === 'song_teaser' || clip.options?.teaser) {
    return {
      ...base, mode: 'teaser',
      audio_src: proj.source_url, bg_image_url: proj.meta?.cover_url || null,
      options: { hook_title_text: clip.label || null },
      endcard_text: 'regalosquecantan.com',
    };
  }
  const o = clip.options || {};
  return {
    ...base, source_url: proj.source_url,
    options: { ...o, music: false, broll: false, hook_title_text: o.hook_title ? clip.label : null, emphasis_starts: [] },
    music_url: null, broll: [], sfx_url: null,
  };
}

// Dispatch (or re-dispatch) one clip to the renderer. The stable payload comes
// from clips.render_job (or the legacy rebuild); words + signed URLs are added
// fresh every time. Stamps dispatched_at so the watchdog can spot stalls.
export async function dispatchClip(admin: SupabaseClient, proj: any, clip: any) {
  const words = proj.transcript?.words;
  if (!Array.isArray(words) || !words.length) throw new Error('project has no transcript words');
  const stable = clip.render_job || legacyRenderJob(proj, clip);
  const out = await mintClipOutput(admin, proj.id, clip.id);
  await dispatchRenderer('/clip-render', {
    ...stable,
    clip_id: clip.id, project_id: proj.id, words,
    bucket: BUCKET, callback_url: CALLBACK_URL,
    ...out,
  });
  await admin.from('clips').update({ dispatched_at: nowIso(), updated_at: nowIso() }).eq('id', clip.id);
}

// Auto-pilot: once a project's transcript is ready, segment the WHOLE video
// into complete self-contained clips and render each one through the queue.
// Idempotent via auto_pilot_state (pending -> running -> done | error).
export async function autoPilotRun(admin: SupabaseClient, projectId: string) {
  const { data: proj } = await admin.from('clip_projects').select('*').eq('id', projectId).single();
  if (!proj || !proj.auto_pilot || proj.status !== 'ready') return { skipped: true };
  // Only a 'pending' (or never-set) project may start; a stale 'running' left
  // behind by a crashed run is reset back to 'pending' by the watchdog sweep.
  if (proj.auto_pilot_state && proj.auto_pilot_state !== 'pending') return { skipped: true };
  await admin.from('clip_projects').update({ auto_pilot_state: 'running', updated_at: nowIso() }).eq('id', projectId);
  try {
    const words: Word[] = proj.transcript?.words || [];
    if (words.length < 20) throw new Error('Not enough speech in this video to auto-clip');
    const durationSec = Number(proj.duration_sec) || words[words.length - 1].end;
    const isTeaser = proj.kind === 'song_teaser';
    const suggestions = await proposeClips(words, durationSec, {
      mode: isTeaser ? 'teaser' : 'full',
      recipient: proj.meta?.recipient,
    });

    // The owner's saved preset (chosen at upload) drives the look; the
    // auto-edit essentials (silences, emphasis, hook title) stay forced on.
    const pc = (proj.auto_pilot_config || {}) as Record<string, unknown>;
    const pStyle = STYLES.includes(String(pc.style)) ? String(pc.style) : 'boldpop';
    const pAspect = ASPECTS.includes(String(pc.aspect)) ? String(pc.aspect) : '9:16';

    let launched = 0;
    for (const s of suggestions) {
      const inRange = words.filter((w) => w.end > s.start_sec + 0.05 && w.start < s.end_sec - 0.05);
      let emphasis_starts: number[] = [];
      if (!isTeaser) {
        try { emphasis_starts = await tagEmphasis(inRange); } catch (e) { console.warn('auto-pilot emphasis failed:', (e as Error).message); }
      }
      let emoji_starts: Array<{ t: number; e: string }> = [];
      if (!isTeaser && pc.emoji) {
        try { emoji_starts = await tagEmoji(inRange); } catch (e) { console.warn('auto-pilot emoji failed:', (e as Error).message); }
      }
      const options = isTeaser
        ? { teaser: true, hook_title: !!s.title }
        : {
            framing: ['auto', 'wide', 'left', 'center', 'right'].includes(String(pc.framing)) ? pc.framing : 'auto',
            remove_silences: true, hook_title: true, emphasis: true,
            zoom: !!pc.zoom, music: false, broll: false,
            transitions: pc.transitions !== false, clean_audio: !!pc.clean_audio,
            outro: !!pc.outro, punch_zooms: !!pc.punch_zooms,
            progress_bar: !!pc.progress_bar, watermark: !!pc.watermark,
            emoji: !!pc.emoji, sfx_emphasis: !!pc.sfx_emphasis,
            accent_color: typeof pc.accent_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(pc.accent_color) ? pc.accent_color : null,
            depth_title: !!pc.depth_title,
            depth_words: !!pc.depth_words,
          };
      const render_job = isTeaser
        ? {
            mode: 'teaser', audio_src: proj.source_url, bg_image_url: proj.meta?.cover_url || null,
            start_sec: s.start_sec, end_sec: s.end_sec, aspect: '9:16', style: 'boldpop',
            options: { hook_title_text: s.title || null }, endcard_text: 'regalosquecantan.com',
          }
        : {
            source_url: proj.source_url,
            start_sec: s.start_sec, end_sec: s.end_sec, aspect: pAspect, style: pStyle,
            options: { ...options, hook_title_text: s.title || null, emphasis_starts, emoji_starts },
            music_url: null, broll: [], sfx_url: null,
          };
      const { data: clip, error: ce } = await admin.from('clips').insert({
        project_id: projectId, start_sec: s.start_sec, end_sec: s.end_sec,
        aspect: isTeaser ? '9:16' : pAspect, style: isTeaser ? 'boldpop' : pStyle, label: s.title || null,
        ai_score: s.score ?? null, ai_reason: s.reason || null,
        status: 'rendering', options, render_job, dispatched_at: nowIso(),
      }).select().single();
      if (ce) throw new Error(ce.message);
      try {
        await dispatchClip(admin, proj, clip);
        launched++;
      } catch (e) {
        await admin.from('clips').update({ status: 'failed', error_message: (e as Error).message, updated_at: nowIso() }).eq('id', clip.id);
      }
    }
    const ai_suggestions = { generated_at: nowIso(), model: CLIP_AI_MODEL, mode: 'auto', suggestions };
    await admin.from('clip_projects').update({ auto_pilot_state: 'done', ai_suggestions, updated_at: nowIso() }).eq('id', projectId);
    console.log(`[auto-pilot:${projectId}] launched ${launched}/${suggestions.length} clips`);
    return { launched, total: suggestions.length };
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[auto-pilot:${projectId}] failed:`, msg);
    await admin.from('clip_projects').update({
      auto_pilot_state: 'error',
      meta: { ...(proj.meta || {}), auto_pilot_error: msg },
      updated_at: nowIso(),
    }).eq('id', projectId);
    return { error: msg };
  }
}
