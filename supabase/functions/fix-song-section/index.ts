// supabase/functions/fix-song-section/index.ts
//
// "Fix a Song" — surgical, AI-assisted repair of ONE bad slice of an
// already-generated Suno/Kie song, WITHOUT re-rolling the whole track.
//
// How it works (full-auto):
//   1. The owner types a plain-language complaint ("dice mal el nombre, debe
//      sonar 'ya-RE-li'" / "el coro dice 'tus ojos' pero debe decir 'tu
//      sonrisa'").
//   2. We get word-level timestamps for the song from OpenAI Whisper
//      (reusing songs.lyrics_timestamps if render-social-clip already cached
//      them — same shape, written back if we have to compute fresh).
//   3. Claude (claude-opus-4-8, sonnet-4-6 fallback) reads the timed
//      transcript + the stored lyrics + the complaint and decides the minimal
//      contiguous time window to redo, writes the corrected FULL lyrics
//      (with Spanish-orthography phonetic respelling for mispronounced names),
//      and a short change summary.
//   4. We call Kie's Replace-Section endpoint
//      (POST /api/v1/generate/replace-section) which regenerates ONLY that
//      window and blends it into the untouched audio before/after.
//   5. We poll record-info until SUCCESS and return the fixed audio as a
//      PREVIEW. Nothing on the customer's row changes until the owner approves.
//
//   action: 'preview' (default) -> does steps 1-5, returns the fixed audio URL
//   action: 'apply'             -> swaps the approved fixed audio into the row
//
// Hard constraints from Kie (enforced/clamped here):
//   - replaced window must be 6-60 seconds AND <= 50% of the song length
//   - the source song must still be on Kie's servers (audio is purged after
//     ~14 days) — needs the parent kie_task_id + the per-track audioId, which
//     we read from songs.kie_task_id + songs.kie_payload.id. Songs older than
//     ~14 days (or made on Mureka) can't be section-fixed; the caller is told
//     to use regenerate-paid-song-kie (full re-roll) instead.
//
// Auth: verify_jwt = false. Mirrors regenerate-paid-song-kie — invoked from the
// admin dashboard / CLI with the anon (publishable) key as Bearer. The secrets
// (KIE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY) only exist in the edge
// runtime, which is why this is a function and not a browser-side script.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// V5_5 only — V4_5 failed the 2026-06-12 regional-Mexican bake-off. Replace-
// section must run on the same model family the source song was made with.
const KIE_MODEL = Deno.env.get('KIE_MODEL') || 'V5_5';

// Best model for the reasoning (locate the window + rewrite lyrics + phonetic
// name respelling). Sonnet fallback matches the codebase's Claude retry order.
const CLAUDE_PRIMARY_MODEL = 'claude-opus-4-8';
const CLAUDE_FALLBACK_MODEL = 'claude-sonnet-4-6';

// Kie hard limits for replace-section.
const MIN_WINDOW_S = 6;
const MAX_WINDOW_S = 60;

// ---------------------------------------------------------------------------
// Lyric marker / prosody normalization — identical to regenerate-paid-song-kie
// so the regenerated slice matches how the original paid song was produced.
// ---------------------------------------------------------------------------
function stripSpokenProsodyCue(lyrics: string): string {
  if (!lyrics) return lyrics;
  return lyrics
    .replace(/[ \t]*\(\s*spoken[^)]*\)/gi, '')
    .replace(/[ \t]*\[[a-záéíóúñ][^\]]*\]/g, '')
    .replace(/[ \t]+$/gm, '');
}

function englishifyLyricsMarkers(lyrics: string): string {
  if (!lyrics) return lyrics;
  return stripSpokenProsodyCue(lyrics)
    .replace(/\[Verso Final\]/gi, '[Final Verse]')
    .replace(/\[Verso (\d+)\]/gi, '[Verse $1]')
    .replace(/\[Verso\]/gi, '[Verse]')
    .replace(/\[Coro Final\]/gi, '[Final Chorus]')
    .replace(/\[Coro\]/gi, '[Chorus]')
    .replace(/\[Puente\]/gi, '[Bridge]')
    .replace(/\[Pre-Coro\]/gi, '[Pre-Chorus]')
    .replace(/\[Hablado\]/gi, '[Spoken Word]');
}

// Gender + Spanish-language locks, same construction regenerate-paid-song-kie
// uses, so the replaced section keeps the same voice and stays in Spanish.
function buildStyleAndNegatives(styleUsed: string, voiceType: string): { tags: string; negativeTags: string } {
  const vocalGender: 'm' | 'f' = voiceType === 'female' ? 'f' : 'm';
  const genderLabel = vocalGender === 'f'
    ? 'solo female vocalist, female voice'
    : 'solo male vocalist, male voice, masculine vocal';
  const oppositeGenderTags = vocalGender === 'f'
    ? 'male voice, male vocal, baritone, bass voice, deep male voice'
    : 'female voice, female vocal, soprano, female harmony, high female voice';
  const languageTags = 'Spanish-language vocals, sung entirely in Spanish, letra completamente en español, Mexican Spanish pronunciation';
  const englishNegatives = 'English lyrics, English language, English vocals, English words, spoken English, English ad-libs';

  return {
    tags: `${genderLabel}, ${languageTags}, ${styleUsed}`.substring(0, 1000),
    negativeTags: `${oppositeGenderTags}, ${englishNegatives}`.substring(0, 200),
  };
}

// ---------------------------------------------------------------------------
// Whisper — word-level timestamps. Copied from render-social-clip so the cache
// shape in songs.lyrics_timestamps stays interchangeable between the two.
// ---------------------------------------------------------------------------
type WhisperWord = { word: string; start: number; end: number };
type WhisperResult = { words: WhisperWord[]; duration: number; language: string };

async function transcribeAudio(audioUrl: string): Promise<WhisperResult | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`audio fetch failed: ${audioRes.status}`);
    const audioBlob = await audioRes.blob();

    const form = new FormData();
    form.append('file', audioBlob, 'song.mp3');
    form.append('model', 'whisper-1');
    form.append('language', 'es');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!resp.ok) {
      console.error(`[whisper] API error ${resp.status}: ${(await resp.text()).substring(0, 300)}`);
      return null;
    }
    const data = await resp.json();
    const words: WhisperWord[] = (data.words || [])
      .map((w: any) => ({ word: String(w.word || ''), start: Number(w.start), end: Number(w.end) }))
      .filter((w: WhisperWord) => w.word && !Number.isNaN(w.start) && !Number.isNaN(w.end));
    return { words, duration: Number(data.duration) || 0, language: String(data.language || 'spanish') };
  } catch (e: any) {
    console.error('[whisper] error:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claude — decides the time window + writes the corrected full lyrics.
// Uses the codebase's proven tool_use + forced tool_choice pattern (no
// thinking/sampling params, so it's valid on opus-4-8) rather than output_config.
// ---------------------------------------------------------------------------
const FIX_TOOL = {
  name: 'submit_section_fix',
  description: 'Return the exact time window of the song to regenerate and the corrected full lyrics that fix the reported problem.',
  input_schema: {
    type: 'object',
    properties: {
      can_fix: {
        type: 'boolean',
        description: 'true if the reported problem is localized to ONE contiguous stretch that is at most half the song; false if it is spread across the whole song or cannot be located in the transcript.',
      },
      reason: {
        type: 'string',
        description: 'If can_fix is false, one short sentence (Spanish) explaining why a section fix is not possible. If true, one short note on the window you chose.',
      },
      infill_start_s: {
        type: 'number',
        description: 'Start time, in seconds (up to 2 decimals), of the slice to regenerate. Take it from the word timestamps; start a hair before the first wrong word.',
      },
      infill_end_s: {
        type: 'number',
        description: 'End time, in seconds, of the slice to regenerate. End a hair after the last wrong word. The window (end - start) must be between 6 and 60 seconds and no more than half the song duration.',
      },
      section_text: {
        type: 'string',
        description: 'ONLY the corrected lyric lines that fall inside this window, in Spanish, exactly as they should now be sung. This becomes the replacement-section prompt.',
      },
      full_lyrics: {
        type: 'string',
        description: 'The COMPLETE corrected lyrics for the whole song, all sections, with section markers like [Coro]/[Verso] preserved. Apply ONLY the fix — every untouched line must stay identical to the original lyrics provided.',
      },
      change_summary: {
        type: 'string',
        description: 'One short sentence in Spanish describing exactly what changed, shown to the shop owner (e.g. "Corregí la pronunciación del nombre Yareli en el coro").',
      },
      verify_phrases: {
        type: 'array',
        description: '1 a 3 palabras o frases cortas EXACTAS que DEBEN escucharse en la parte corregida (el nombre o la frase nueva). Se usan para verificar con transcripción que el cambio sí se cantó.',
        items: { type: 'string' },
      },
    },
    required: ['can_fix', 'reason', 'infill_start_s', 'infill_end_s', 'section_text', 'full_lyrics', 'change_summary', 'verify_phrases'],
    additionalProperties: false,
  },
} as const;

const FIX_SYSTEM_PROMPT = `Eres un editor musical experto en canciones regionales mexicanas (corridos, bachata, norteño, etc.) generadas por IA y cantadas en español.

Te dan tres cosas:
1. La letra estructurada original de la canción (con marcadores como [Coro], [Verso]).
2. Una transcripción palabra-por-palabra de lo que SE CANTÓ en el audio, con marcas de tiempo en segundos (lo que de verdad suena, que puede diferir de la letra).
3. Una queja en lenguaje natural del dueño de la tienda sobre un error puntual.

Tu trabajo es localizar el problema y proponer un arreglo QUIRÚRGICO de una sola sección, sin rehacer toda la canción:

- Usa las marcas de tiempo de la transcripción para encontrar el momento exacto del error y define una ventana contigua [infill_start_s, infill_end_s] que lo cubra.
- La ventana DEBE durar entre 6 y 60 segundos y NO más de la mitad de la canción. Si el error es una sola palabra muy corta, amplía la ventana a una frase o verso completo para que el empalme suene natural (mínimo 6s).
- full_lyrics debe ser la letra COMPLETA ya corregida: aplica SOLO el cambio pedido y deja idéntico todo lo demás. Conserva los marcadores de sección.
- section_text son únicamente las líneas corregidas que caen dentro de la ventana.
- Para nombres mal pronunciados: reescribe el nombre con ortografía española fonética para que el modelo lo cante bien (p. ej. "Yareli" → "Yarelí", "Joaquin" → "Joaquín", "Yetzaeli" → "Yetsaelí"), tanto en full_lyrics como en section_text, manteniendo el nombre legible.
- Si el problema abarca toda la canción o no se puede ubicar, pon can_fix=false y explica por qué; no inventes una ventana.
- La queja puede incluir una conversación con el dueño y/o una captura de pantalla (WhatsApp) del mensaje del cliente. Lee la imagen si viene adjunta y usa todo el contexto para entender exactamente qué corregir.

Devuelve SIEMPRE tu respuesta llamando a la herramienta submit_section_fix.`;

// Conversational assistant used BEFORE running the fix — helps the owner nail
// down exactly what to change (reads a pasted WhatsApp screenshot, asks short
// clarifying questions). It does NOT edit anything; the actual fix runs when the
// owner clicks "Generar arreglo".
const CHAT_SYSTEM_PROMPT = `Eres un asistente que ayuda al dueño de una tienda de canciones personalizadas en español a entender EXACTAMENTE qué arreglar en una canción ya generada, ANTES de regenerar la sección (eso cuesta, así que primero hay que tener claro el cambio).

El dueño puede pegarte una captura de pantalla de WhatsApp del cliente o escribirte directamente. Tienes la letra actual de la canción.

Tu trabajo:
- Lee la captura/mensaje y di con tus palabras qué entiendes que hay que cambiar (qué palabra, nombre o línea está mal y cómo debería decir).
- Si falta información para hacer el cambio (por ejemplo, el cliente dice "está mal el nombre" pero no cómo se escribe/pronuncia), haz UNA pregunta corta para aclararlo.
- Cuando ya esté claro, resume en una sola frase qué vas a cambiar y dile: "Cuando quieras, dale a Generar arreglo."
- NO inventes datos. NO edites la canción tú mismo (eso pasa cuando el dueño presiona el botón).
- Responde corto, claro y en español.`;

// Full-song re-roll: used when section-fix isn't possible (e.g. a Mureka song)
// or the owner chooses to remake the whole song. Claude returns the complete
// corrected lyrics; we then generate a fresh Kie song from them.
const FULL_FIX_SYSTEM_PROMPT = `Eres un editor de letras de canciones regionales mexicanas en español. Te dan la letra actual de una canción y una queja/instrucción (puede incluir una conversación con el dueño y/o una captura de WhatsApp del cliente). Devuelve la letra COMPLETA ya corregida aplicando SOLO el cambio pedido y dejando idéntico todo lo demás; conserva los marcadores de sección como [Coro] y [Verso]. Para nombres mal pronunciados, reescríbelos con ortografía española fonética (p. ej. "Yareli"→"Yarelí", "Joaquin"→"Joaquín"). Lee la imagen si viene adjunta. En "changes" lista cada línea o frase que cambió, con el texto exacto ANTES y DESPUÉS, para que el dueño lo confirme. Responde SIEMPRE llamando a la herramienta submit_corrected_lyrics.`;

const FULL_FIX_TOOL = {
  name: 'submit_corrected_lyrics',
  description: 'Return the complete corrected lyrics for the whole song with the requested fix applied, plus a list of the exact before/after changes.',
  input_schema: {
    type: 'object',
    properties: {
      full_lyrics: { type: 'string', description: 'La letra COMPLETA corregida, con marcadores de sección. Aplica SOLO el cambio pedido; deja igual lo demás.' },
      change_summary: { type: 'string', description: 'Una frase corta en español de lo que cambió.' },
      changes: {
        type: 'array',
        description: 'Cada cambio puntual con el texto exacto antes y después. Vacío si no hubo cambios.',
        items: {
          type: 'object',
          properties: {
            before: { type: 'string', description: 'La línea o frase original.' },
            after: { type: 'string', description: 'La misma línea ya corregida.' },
          },
          required: ['before', 'after'],
          additionalProperties: false,
        },
      },
      verify_phrases: {
        type: 'array',
        description: '1 a 3 palabras o frases cortas EXACTAS que DEBEN escucharse en la versión corregida (p. ej. el nombre corregido o la frase nueva). Se usan para verificar con transcripción que el cambio sí se cantó.',
        items: { type: 'string' },
      },
    },
    required: ['full_lyrics', 'change_summary', 'changes', 'verify_phrases'],
    additionalProperties: false,
  },
} as const;

type InlineImage = { media_type: string; data: string };

// Build a Claude message content array: optional image first (so the model
// reads the screenshot), then the text.
function buildUserContent(text: string, image?: InlineImage): any {
  if (!image?.data) return text;
  return [
    { type: 'image', source: { type: 'base64', media_type: image.media_type || 'image/png', data: image.data } },
    { type: 'text', text },
  ];
}

async function callClaudeForFix(userMessage: string, image?: InlineImage): Promise<any | null> {
  if (!ANTHROPIC_API_KEY) {
    console.error('[fix-song-section] ANTHROPIC_API_KEY not configured');
    return null;
  }
  const MAX_RETRIES = 3;
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const model = attempt === MAX_RETRIES ? CLAUDE_FALLBACK_MODEL : CLAUDE_PRIMARY_MODEL;
    let resp: Response;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 3000,
          system: [{ type: 'text', text: FIX_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: [FIX_TOOL],
          tool_choice: { type: 'tool', name: 'submit_section_fix' },
          messages: [{ role: 'user', content: buildUserContent(userMessage, image) }],
        }),
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_RETRIES) { await new Promise((r) => setTimeout(r, attempt * 4000)); continue; }
      break;
    }

    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !Array.isArray(data.content)) {
      const overloaded = data?.error?.type === 'overloaded_error' || resp.status === 529;
      lastErr = `HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`;
      if (overloaded && attempt < MAX_RETRIES) { await new Promise((r) => setTimeout(r, attempt * 4000)); continue; }
      if (attempt === MAX_RETRIES) break;
      continue;
    }

    const block = data.content.find((b: any) => b && b.type === 'tool_use' && b.name === 'submit_section_fix');
    if (block && block.input && typeof block.input.full_lyrics === 'string') {
      return block.input;
    }
    lastErr = 'no submit_section_fix tool_use in response';
  }
  console.error('[fix-song-section] Claude failed:', lastErr);
  return null;
}

// Conversational turn — the owner chats with the AI (optionally with a pasted
// screenshot) to clarify the fix before running it. No tool, no Kie cost.
type ChatMsg = { role: string; text: string };
async function callClaudeChat(lyrics: string, conversation: ChatMsg[], image?: InlineImage): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const msgs: any[] = conversation.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.text || ''),
  }));
  // Attach the image to the most recent owner (user) turn so the model sees it.
  if (image?.data) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        msgs[i] = { role: 'user', content: buildUserContent(String(msgs[i].content || 'Mira esta captura.'), image) };
        break;
      }
    }
  }
  if (msgs.length === 0) return null;

  const system = `${CHAT_SYSTEM_PROMPT}\n\nLETRA ACTUAL DE LA CANCIÓN:\n${lyrics}`;
  const MAX_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const model = attempt === MAX_RETRIES ? CLAUDE_FALLBACK_MODEL : CLAUDE_PRIMARY_MODEL;
    let resp: Response;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: msgs,
        }),
      });
    } catch {
      if (attempt < MAX_RETRIES) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      return null;
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !Array.isArray(data.content)) {
      if (attempt < MAX_RETRIES) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      return null;
    }
    const text = data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim();
    if (text) return text;
  }
  return null;
}

// Claude rewrites the FULL lyrics with the fix applied (for the whole-song
// re-roll path). Same tool_use pattern as callClaudeForFix.
async function callClaudeForFullLyrics(currentLyrics: string, complaint: string, image?: InlineImage): Promise<any | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const userMessage =
    `LETRA ACTUAL:\n${currentLyrics}\n\n` +
    `QUEJA / INSTRUCCIÓN (puede incluir conversación con el dueño y/o una captura adjunta):\n${complaint}\n\n` +
    `Devuelve la letra completa corregida llamando a submit_corrected_lyrics.`;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const model = attempt === MAX_RETRIES ? CLAUDE_FALLBACK_MODEL : CLAUDE_PRIMARY_MODEL;
    let resp: Response;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model,
          max_tokens: 3000,
          system: [{ type: 'text', text: FULL_FIX_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: [FULL_FIX_TOOL],
          tool_choice: { type: 'tool', name: 'submit_corrected_lyrics' },
          messages: [{ role: 'user', content: buildUserContent(userMessage, image) }],
        }),
      });
    } catch {
      if (attempt < MAX_RETRIES) { await new Promise((r) => setTimeout(r, attempt * 3000)); continue; }
      return null;
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !Array.isArray(data.content)) {
      const overloaded = data?.error?.type === 'overloaded_error' || resp.status === 529;
      if (overloaded && attempt < MAX_RETRIES) { await new Promise((r) => setTimeout(r, attempt * 3000)); continue; }
      if (attempt === MAX_RETRIES) return null;
      continue;
    }
    const block = data.content.find((b: any) => b?.type === 'tool_use' && b.name === 'submit_corrected_lyrics');
    if (block?.input?.full_lyrics) return block.input;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Audit trail — every attempt lands in song_fix_attempts so failures stay
// debuggable long after the 24h edge-log window. Best-effort: never throws.
// ---------------------------------------------------------------------------
async function logAttempt(supabase: any, row: Record<string, unknown>) {
  try { await supabase.from('song_fix_attempts').insert(row); } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Whisper verification — confirm the corrected words actually got sung in the
// NEW audio. Fuzzy matching reused in spirit from render-social-clip (Whisper
// mishears Spanish names, so exact match is too strict).
// ---------------------------------------------------------------------------
function normalizeForMatch(w: string): string {
  return w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
function fuzzyEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return a === b;
  if (Math.abs(a.length - b.length) > 3) return false;
  return levenshtein(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.3));
}
async function verifyPhrasesInAudio(audioUrl: string, phrases: string[]): Promise<{ checked: boolean; allFound: boolean; missing: string[]; found: string[] }> {
  const clean = (phrases || []).map((p) => String(p || '').trim()).filter(Boolean);
  if (!clean.length) return { checked: false, allFound: true, missing: [], found: [] };
  const w = await transcribeAudio(audioUrl);
  if (!w || !w.words.length) return { checked: false, allFound: true, missing: [], found: [] };
  const audioTokens = w.words.map((x) => normalizeForMatch(x.word)).filter(Boolean);
  const found: string[] = [];
  const missing: string[] = [];
  for (const phrase of clean) {
    const tokens = phrase.split(/\s+/).map(normalizeForMatch).filter((t) => t.length > 1);
    if (!tokens.length) continue;
    const ok = tokens.every((t) => audioTokens.some((a) => fuzzyEq(a, t)));
    (ok ? found : missing).push(phrase);
  }
  return { checked: true, allFound: missing.length === 0, missing, found };
}

// Is a thrown error Kie's content/copyright filter?
function isContentError(e: any): boolean {
  const m = String(e?.message || e || '').toLowerCase();
  return m.includes('sensitive') || m.includes('content') || m.includes('filtro') || m.includes('derechos') || m.includes('copyright') || m.includes('bloque');
}

// On a content-filter rejection, strip likely triggers (artist/band/brand
// names, song titles, strong profanity) and return cleaned lyrics for one retry.
async function sanitizeLyricsForFilter(lyrics: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const sys = 'El filtro anti-plagio de un generador de música por IA rechazó esta letra como "contenido con derechos de autor". Casi siempre es un FALSO POSITIVO: alguna frase se parece a la letra de una canción existente. Reescríbela para esquivar el filtro: PARAFRASEA con otras palabras cualquier verso o frase que pudiera sonar a una canción famosa, y quita nombres de artistas/bandas/marcas, títulos de canciones reales y groserías fuertes. Conserva EXACTAMENTE el mismo significado y emoción, el idioma español, los nombres propios del cliente (destinatario), y los marcadores de sección como [Coro]/[Verso]. Cambia el fraseo, no la historia. Devuelve SOLO la letra reescrita, sin explicaciones ni comillas.';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CLAUDE_FALLBACK_MODEL, max_tokens: 3000, system: sys, messages: [{ role: 'user', content: lyrics }] }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !Array.isArray(data.content)) return null;
    const text = data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim();
    return text && text.length > 20 ? text : null;
  } catch { return null; }
}

// Keep Claude's window inside Kie's 6-60s / <=50%-of-song rule.
function clampWindow(startIn: number, endIn: number, duration: number): { start: number; end: number } {
  const dur = duration > 0 ? duration : 180;
  const maxLen = Math.max(MIN_WINDOW_S, Math.min(MAX_WINDOW_S, dur * 0.5));
  let start = Math.max(0, Math.min(startIn, dur));
  let end = Math.max(0, Math.min(endIn, dur));
  if (end <= start) end = start + MIN_WINDOW_S;
  let len = end - start;

  if (len > maxLen) {
    const center = (start + end) / 2;
    start = center - maxLen / 2;
    end = center + maxLen / 2;
  } else if (len < MIN_WINDOW_S) {
    const center = (start + end) / 2;
    start = center - MIN_WINDOW_S / 2;
    end = center + MIN_WINDOW_S / 2;
  }
  // Re-seat inside [0, dur] after centering.
  if (start < 0) { end -= start; start = 0; }
  if (end > dur) { start -= (end - dur); end = dur; }
  start = Math.max(0, start);
  len = end - start;
  if (len > maxLen) end = start + maxLen;

  return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Kie — Replace Section + poll. Reuses the same poll loop as the rest of the app.
// ---------------------------------------------------------------------------
interface KieTrack { id?: string; audioUrl?: string; imageUrl?: string; title?: string; duration?: number }

async function submitReplaceSection(args: {
  taskId: string; audioId: string; prompt: string; tags: string; title: string;
  infillStartS: number; infillEndS: number; fullLyrics: string; negativeTags: string; callbackUrl: string;
}): Promise<string> {
  const payload = {
    taskId: args.taskId,
    audioId: args.audioId,
    prompt: args.prompt.substring(0, 1000),
    tags: args.tags,
    title: args.title.substring(0, 80),
    infillStartS: args.infillStartS,
    infillEndS: args.infillEndS,
    fullLyrics: args.fullLyrics.substring(0, 5000),
    negativeTags: args.negativeTags,
    model: KIE_MODEL,
    callBackUrl: args.callbackUrl,
  };
  const resp = await fetch('https://api.kie.ai/api/v1/generate/replace-section', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => 'unknown');
    throw new Error(`kie replace-section ${resp.status}: ${t.substring(0, 250)}`);
  }
  const data = await resp.json();
  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`kie replace-section code=${data.code}: ${data.msg || 'no taskId'}`);
  }
  return data.data.taskId;
}

// Full new Kie generation from corrected lyrics (whole-song re-roll). Mirrors
// regenerate-paid-song-kie's submitToKie tuning so the remake matches how paid
// songs are produced.
async function submitFullGenerate(lyrics: string, title: string, styleUsed: string, voiceType: string, callbackUrl: string): Promise<string> {
  const vocalGender: 'm' | 'f' = voiceType === 'female' ? 'f' : 'm';
  const { tags, negativeTags } = buildStyleAndNegatives(styleUsed, voiceType);
  const payload = {
    prompt: englishifyLyricsMarkers(lyrics).substring(0, 5000),
    customMode: true,
    instrumental: false,
    model: KIE_MODEL,
    callBackUrl: callbackUrl,
    style: tags,
    title: title.substring(0, 80),
    vocalGender,
    negativeTags,
    styleWeight: 0.85,
    weirdnessConstraint: 0.3,
    audioWeight: 0.7,
  };
  const resp = await fetch('https://api.kie.ai/api/v1/generate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => 'unknown');
    throw new Error(`kie generate ${resp.status}: ${t.substring(0, 250)}`);
  }
  const data = await resp.json();
  if (data.code !== 200 || !data.data?.taskId) throw new Error(`kie generate code=${data.code}: ${data.msg || 'no taskId'}`);
  return data.data.taskId;
}

async function pollKieUntilDone(taskId: string, maxAttempts = 24, intervalMs = 8000): Promise<KieTrack[]> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
    });
    if (resp.ok) {
      const json = await resp.json();
      const status = json?.data?.status;
      const tracks: KieTrack[] = json?.data?.response?.sunoData ?? [];
      console.log(`[fix] poll ${attempt}/${maxAttempts}: status=${status}, tracks=${tracks.length}`);
      if (status === 'SUCCESS') return tracks;
      if (['GENERATE_AUDIO_FAILED', 'CREATE_TASK_FAILED', 'SENSITIVE_WORD_ERROR', 'CALLBACK_EXCEPTION'].includes(status)) {
        // Surface Kie's ACTUAL message (was being thrown away before) so the
        // owner — and our logs — see exactly why it failed.
        const kieMsg = json?.data?.errorMessage || json?.data?.error_message || json?.msg || '';
        console.error(`[fix] Kie terminal status=${status} taskId=${taskId} msg=${kieMsg}`);
        if (status === 'SENSITIVE_WORD_ERROR') {
          throw new Error(`Suno bloqueó el contenido (filtro de letra/derechos de autor)${kieMsg ? `: ${kieMsg}` : ''}. Reformula esa parte o usa "Rehacer canción completa".`);
        }
        throw new Error(`Kie falló (${status})${kieMsg ? `: ${kieMsg}` : ''}.`);
      }
    } else {
      console.warn(`[fix] poll ${attempt}/${maxAttempts}: HTTP ${resp.status}`);
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`kie replace-section task ${taskId} did not complete in time`);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const action: string = body?.action || 'preview';

    // -----------------------------------------------------------------
    // DIAG — pull Kie's record-info for any taskId (status + errorCode +
    // errorMessage). Permanent tool for diagnosing why a Kie job failed.
    // -----------------------------------------------------------------
    if (action === 'diag') {
      if (!KIE_API_KEY) return json({ ok: false, error: 'KIE_API_KEY missing on Supabase' });
      const taskId: string | undefined = body?.taskId;
      if (!taskId) return json({ ok: false, error: 'taskId required' });
      const resp = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
        headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
      });
      const raw = await resp.json().catch(() => null);
      return json({
        ok: resp.ok,
        httpStatus: resp.status,
        code: raw?.code,
        msg: raw?.msg,
        status: raw?.data?.status,
        type: raw?.data?.type,
        operationType: raw?.data?.operationType,
        errorCode: raw?.data?.errorCode,
        errorMessage: raw?.data?.errorMessage,
        tracks: raw?.data?.response?.sunoData?.length ?? 0,
      });
    }

    // -----------------------------------------------------------------
    // APPLY — swap the approved fixed audio into the customer's row.
    // -----------------------------------------------------------------
    if (action === 'apply') {
      const songId: string | undefined = body?.songId;
      const fixedAudioUrl: string | undefined = body?.fixedAudioUrl;
      const fixTaskId: string | undefined = body?.fixTaskId;
      const fixAudioId: string | undefined = body?.fixAudioId;
      const fullLyrics: string | undefined = body?.fullLyrics;
      const imageUrl: string | undefined = body?.imageUrl;
      if (!songId || !fixedAudioUrl) return json({ ok: false, error: 'songId and fixedAudioUrl are required' });

      // Snapshot the current state so the owner can Deshacer (undo) this fix.
      const { data: prev } = await supabase
        .from('songs')
        .select('audio_url, preview_url, original_audio_url, image_url, lyrics, kie_task_id, task_id, kie_payload, provider, lyrics_timestamps')
        .eq('id', songId)
        .single();

      const update: Record<string, unknown> = {
        audio_url: fixedAudioUrl,
        preview_url: fixedAudioUrl,
        original_audio_url: fixedAudioUrl,
        status: 'completed',
        needs_reupload: true,
        provider: 'kie',
        error_message: null,
        fix_backup: prev ? { ...prev, backed_up_at: new Date().toISOString() } : null,
      };
      if (imageUrl) update.image_url = imageUrl;
      if (typeof fullLyrics === 'string' && fullLyrics.trim()) update.lyrics = fullLyrics;
      // Chain future fixes off the corrected version.
      if (fixTaskId) { update.kie_task_id = fixTaskId; update.task_id = fixTaskId; }
      if (fixTaskId || fixAudioId) update.kie_payload = JSON.stringify({ id: fixAudioId, audioUrl: fixedAudioUrl });
      // The audio changed, so the cached transcript is stale.
      update.lyrics_timestamps = null;

      const { error } = await supabase.from('songs').update(update).eq('id', songId);
      if (error) return json({ ok: false, error: `apply failed: ${error.message}` });
      await logAttempt(supabase, { song_id: songId, action: 'apply', kie_task_id: fixTaskId || null, fixed_audio_url: fixedAudioUrl, outcome: 'applied' });
      return json({ ok: true, songId, applied: true, canUndo: !!prev, songLink: `https://regalosquecantan.com/song/${songId}` });
    }

    // -----------------------------------------------------------------
    // UNDO — restore the snapshot taken before the last apply.
    // -----------------------------------------------------------------
    if (action === 'undo') {
      const songId: string | undefined = body?.songId;
      if (!songId) return json({ ok: false, error: 'songId is required' });
      const { data: row } = await supabase.from('songs').select('fix_backup').eq('id', songId).single();
      const b: any = row?.fix_backup;
      if (!b || !b.audio_url) return json({ ok: false, error: 'No hay un arreglo previo que deshacer en esta canción.' });
      const restore: Record<string, unknown> = {
        audio_url: b.audio_url,
        preview_url: b.preview_url ?? b.audio_url,
        original_audio_url: b.original_audio_url ?? b.audio_url,
        image_url: b.image_url ?? null,
        lyrics: b.lyrics ?? null,
        kie_task_id: b.kie_task_id ?? null,
        task_id: b.task_id ?? null,
        kie_payload: b.kie_payload ?? null,
        provider: b.provider ?? null,
        lyrics_timestamps: b.lyrics_timestamps ?? null,
        needs_reupload: true,
        status: 'completed',
        fix_backup: null,
      };
      const { error } = await supabase.from('songs').update(restore).eq('id', songId);
      if (error) return json({ ok: false, error: `undo failed: ${error.message}` });
      await logAttempt(supabase, { song_id: songId, action: 'undo', fixed_audio_url: b.audio_url, outcome: 'undone' });
      return json({ ok: true, songId, undone: true, audioUrl: b.audio_url, lyrics: b.lyrics ?? null });
    }

    // -----------------------------------------------------------------
    // PLAN — cheap, instant: show the proposed lyric change(s) before
    // spending any Kie credits. No transcription, no audio generation.
    // -----------------------------------------------------------------
    if (action === 'plan') {
      if (!ANTHROPIC_API_KEY) return json({ ok: false, error: 'ANTHROPIC_API_KEY missing on Supabase' });
      const songId: string | undefined = body?.songId;
      const note: string | undefined = body?.note;
      const conversation: ChatMsg[] = Array.isArray(body?.conversation) ? body.conversation : [];
      const planImage: InlineImage | undefined = body?.image?.data ? { media_type: body.image.media_type, data: body.image.data } : undefined;
      const planComplaint = (note && note.trim())
        ? note.trim()
        : conversation.length
          ? conversation.map((m) => `${m.role === 'assistant' ? 'AI' : 'Dueño'}: ${m.text}`).join('\n')
          : (planImage ? '(Ver la captura de pantalla adjunta del mensaje del cliente.)' : '');
      if (!songId || (!planComplaint && !planImage)) return json({ ok: false, error: 'songId y una instrucción son obligatorios.' });

      const { data: song } = await supabase.from('songs').select('lyrics').eq('id', songId).single();
      if (!song?.lyrics) return json({ ok: false, error: 'song is missing lyrics' });
      const plan = await callClaudeForFullLyrics(song.lyrics, planComplaint, planImage);
      if (!plan?.full_lyrics) return json({ ok: false, error: 'Claude no pudo proponer el cambio. Intenta de nuevo.' });
      await logAttempt(supabase, { song_id: songId, action: 'plan', complaint: planComplaint.slice(0, 2000), outcome: 'success', detail: (plan.change_summary || '').slice(0, 500) });
      return json({
        ok: true,
        changeSummary: plan.change_summary || '',
        approvedLyrics: plan.full_lyrics,
        changes: Array.isArray(plan.changes) ? plan.changes : [],
        verifyPhrases: Array.isArray(plan.verify_phrases) ? plan.verify_phrases : [],
      });
    }

    // -----------------------------------------------------------------
    // CHAT — clarify the fix with the owner (text + optional screenshot)
    // before spending any Kie credits. No transcription, no Kie call.
    // -----------------------------------------------------------------
    if (action === 'chat') {
      if (!ANTHROPIC_API_KEY) return json({ ok: false, error: 'ANTHROPIC_API_KEY missing on Supabase' });
      const songId: string | undefined = body?.songId;
      const conversation: ChatMsg[] = Array.isArray(body?.conversation) ? body.conversation : [];
      const image: InlineImage | undefined = body?.image?.data ? { media_type: body.image.media_type, data: body.image.data } : undefined;
      if (!songId) return json({ ok: false, error: 'songId is required' });
      if (conversation.length === 0 && !image) return json({ ok: false, error: 'Escribe un mensaje o pega una captura.' });

      const { data: song } = await supabase.from('songs').select('lyrics').eq('id', songId).single();
      const reply = await callClaudeChat(song?.lyrics || '(sin letra guardada)', conversation, image);
      if (!reply) return json({ ok: false, error: 'El asistente no respondió. Intenta de nuevo.' });
      return json({ ok: true, reply });
    }

    // -----------------------------------------------------------------
    // PREVIEW — transcribe -> Claude -> Kie replace-section -> poll.
    // -----------------------------------------------------------------
    if (!KIE_API_KEY) return json({ ok: false, error: 'KIE_API_KEY missing on Supabase' });
    if (!ANTHROPIC_API_KEY) return json({ ok: false, error: 'ANTHROPIC_API_KEY missing on Supabase' });

    const songId: string | undefined = body?.songId;
    // Accept a plain note, a chat conversation, and/or a pasted screenshot.
    const note: string | undefined = body?.note;
    const conversation: ChatMsg[] = Array.isArray(body?.conversation) ? body.conversation : [];
    const fixImage: InlineImage | undefined = body?.image?.data ? { media_type: body.image.media_type, data: body.image.data } : undefined;
    // If the owner already confirmed the lyric change in the PLAN step, sing
    // exactly those words (don't re-derive them).
    const approvedLyrics: string | undefined = (typeof body?.approvedLyrics === 'string' && body.approvedLyrics.trim()) ? body.approvedLyrics : undefined;
    const verifyPhrases: string[] = Array.isArray(body?.verifyPhrases) ? body.verifyPhrases : [];
    const complaint = (note && note.trim())
      ? note.trim()
      : conversation.length
        ? conversation.map((m) => `${m.role === 'assistant' ? 'AI' : 'Dueño'}: ${m.text}`).join('\n')
        : (fixImage ? '(Ver la captura de pantalla adjunta del mensaje del cliente.)' : '');
    if (!songId || (!complaint && !fixImage)) {
      return json({ ok: false, error: 'songId y una instrucción (texto, conversación o captura) son obligatorios.' });
    }

    const { data: song, error: songErr } = await supabase
      .from('songs')
      .select('id, recipient_name, voice_type, style_used, genre, lyrics, audio_url, original_audio_url, kie_task_id, kie_payload, lyrics_timestamps, provider, created_at')
      .eq('id', songId)
      .single();
    if (songErr || !song) return json({ ok: false, error: `song lookup failed: ${songErr?.message || 'not found'}` });

    const audioForFix: string | undefined = song.original_audio_url || song.audio_url;
    if (!audioForFix) return json({ ok: false, error: 'song has no audio to fix' });

    // ---- FULL re-roll path — remake the whole song on Kie from corrected
    // lyrics. Works for any song (incl. Mureka), since it generates fresh. ----
    const mode = body?.mode === 'full' ? 'full' : 'section';
    if (mode === 'full') {
      if (!song.style_used) return json({ ok: false, error: 'song is missing style_used' });
      if (!song.lyrics) return json({ ok: false, error: 'song is missing lyrics' });
      let correctedLyrics = approvedLyrics;
      let correctedSummary = 'Canción rehecha con las correcciones.';
      if (!correctedLyrics) {
        const corrected = await callClaudeForFullLyrics(song.lyrics, complaint || '(ver captura adjunta)', fixImage);
        if (!corrected?.full_lyrics) return json({ ok: false, error: 'Claude no devolvió la letra corregida. Intenta de nuevo.' });
        correctedLyrics = corrected.full_lyrics;
        correctedSummary = corrected.change_summary || correctedSummary;
      }
      const title = `Canción para ${song.recipient_name || 'ti'}`;
      const callbackUrl = `${SUPABASE_URL}/functions/v1/song-callback`;
      try {
        // Generate; on a content-filter block, sanitize the lyrics once and retry.
        let usedLyrics = correctedLyrics;
        let taskId = '';
        let tracks: KieTrack[] = [];
        try {
          taskId = await submitFullGenerate(usedLyrics, title, song.style_used, song.voice_type, callbackUrl);
          tracks = await pollKieUntilDone(taskId);
        } catch (e) {
          if (!isContentError(e)) throw e;
          const cleaned = await sanitizeLyricsForFilter(usedLyrics);
          if (!cleaned || cleaned === usedLyrics) throw e;
          console.log('[fix] FULL content-filter retry with sanitized lyrics');
          usedLyrics = cleaned;
          taskId = await submitFullGenerate(usedLyrics, title, song.style_used, song.voice_type, callbackUrl);
          tracks = await pollKieUntilDone(taskId);
        }
        const made = tracks.find((t) => t.audioUrl) || tracks[0];
        if (!made?.audioUrl) {
          await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'full', complaint: complaint.slice(0, 2000), kie_task_id: taskId, outcome: 'failed', detail: 'no audio returned' });
          return json({ ok: false, fixTaskId: taskId, error: 'la regeneración no devolvió audio' });
        }
        const v = await verifyPhrasesInAudio(made.audioUrl, verifyPhrases);
        const verifyNote = !v.checked ? null : v.allFound
          ? '✅ Verificado: la corrección sí se canta.'
          : `⚠️ No pude confirmar en el audio: "${v.missing.join('", "')}". Escucha con atención; si está mal, descarta y reintenta.`;
        await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'full', complaint: complaint.slice(0, 2000), kie_task_id: taskId, kie_status: 'SUCCESS', fixed_audio_url: made.audioUrl, verified: v.checked ? v.allFound : null, verify_note: verifyNote, outcome: 'success' });
        return json({
          ok: true,
          mode: 'full',
          songId,
          changeSummary: correctedSummary,
          originalAudioUrl: audioForFix,
          fixedAudioUrl: made.audioUrl,
          fixTaskId: taskId,
          fixAudioId: made.id || null,
          fixImageUrl: made.imageUrl || null,
          fullLyrics: usedLyrics,
          verified: v.checked ? v.allFound : null,
          verifyNote,
        });
      } catch (e: any) {
        await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'full', complaint: complaint.slice(0, 2000), kie_error_message: String(e?.message || e).slice(0, 500), outcome: isContentError(e) ? 'blocked' : 'failed' });
        return json({ ok: false, error: String(e?.message || e) });
      }
    }

    // ---- SECTION path — eligibility: must be a Kie song still on Kie's servers ----
    if (!song.kie_task_id) {
      return json({ ok: false, eligible: false, error: 'No tiene kie_task_id (probablemente se hizo con Mureka). Usa "regenerar canción completa" en su lugar.' });
    }
    let kiePayload: any = song.kie_payload;
    if (typeof kiePayload === 'string') { try { kiePayload = JSON.parse(kiePayload); } catch { kiePayload = null; } }
    const audioId: string | undefined = kiePayload?.id;
    if (!audioId) {
      return json({ ok: false, eligible: false, error: 'No se encontró el audioId de Kie en kie_payload. No se puede arreglar por sección; usa regeneración completa.' });
    }
    if (!song.style_used) return json({ ok: false, error: 'song is missing style_used' });
    if (!song.lyrics) return json({ ok: false, error: 'song is missing lyrics' });

    const ageDays = song.created_at ? (Date.now() - new Date(song.created_at).getTime()) / 86400000 : null;
    const staleWarning = ageDays !== null && ageDays > 14
      ? `La canción tiene ~${Math.round(ageDays)} días; Kie borra el audio después de ~14 días, así que el arreglo por sección podría fallar. Si falla, usa regeneración completa.`
      : null;

    // ---- Word-level timestamps (reuse cache or compute + cache) ----
    let whisper: WhisperResult | null = null;
    const cached = song.lyrics_timestamps as WhisperResult | null;
    if (cached && Array.isArray(cached.words) && cached.words.length > 0) {
      whisper = cached;
    } else {
      whisper = await transcribeAudio(audioForFix);
      if (whisper && whisper.words.length > 0) {
        await supabase.from('songs').update({ lyrics_timestamps: whisper }).eq('id', song.id);
      }
    }
    if (!whisper || whisper.words.length === 0) {
      return json({ ok: false, error: 'No se pudo transcribir el audio (Whisper). Revisa OPENAI_API_KEY o intenta de nuevo.' });
    }

    const duration = whisper.duration || (whisper.words.length ? whisper.words[whisper.words.length - 1].end : 0);

    // ---- Ask Claude where + what to fix ----
    const timedWords = whisper.words
      .map((w) => `${w.word.trim()}[${w.start.toFixed(2)}-${w.end.toFixed(2)}]`)
      .join(' ');
    const userMessage =
      `Canción para: ${song.recipient_name || '(sin nombre)'}\n` +
      `Género/estilo: ${song.genre || ''} ${song.style_used}\n` +
      `Duración del audio: ${duration.toFixed(2)} segundos\n\n` +
      `LETRA ORIGINAL (estructurada):\n${song.lyrics}\n\n` +
      `TRANSCRIPCIÓN CANTADA con marcas de tiempo (palabra[inicio-fin] en segundos):\n${timedWords}\n\n` +
      `QUEJA / INSTRUCCIÓN (qué está mal y cómo debería ser; puede incluir conversación con el dueño y/o una captura adjunta):\n${complaint}\n\n` +
      (approvedLyrics ? `LETRA YA APROBADA POR EL DUEÑO (devuélvela EXACTA como full_lyrics; solo necesitas ubicar la ventana de tiempo donde ocurre el cambio):\n${approvedLyrics}\n\n` : '') +
      `Define la ventana mínima a regenerar y entrega la letra completa corregida llamando a submit_section_fix.`;

    const fix = await callClaudeForFix(userMessage, fixImage);
    if (!fix) return json({ ok: false, error: 'Claude no devolvió un arreglo. Intenta de nuevo.' });
    if (fix.can_fix === false) {
      return json({ ok: false, eligible: false, canFix: false, reason: fix.reason || 'No se puede arreglar por sección.' });
    }

    const { start, end } = clampWindow(Number(fix.infill_start_s), Number(fix.infill_end_s), duration);
    const { tags, negativeTags } = buildStyleAndNegatives(song.style_used, song.voice_type);
    const title = `Canción para ${song.recipient_name || 'ti'}`;
    const fullLyrics = englishifyLyricsMarkers(String(approvedLyrics || fix.full_lyrics));
    // Kie's replace-section `prompt` is the content for ONLY the infill window —
    // it must be the corrected lines of THAT section, never the whole song.
    // Sending the full lyrics here made Kie sing unrelated words (root cause of
    // "the words never made it"). If we can't isolate the section, refuse and
    // point the owner to the reliable full re-roll instead of sending garbage.
    const sectionText = String(fix.section_text || '').trim();
    if (!sectionText) {
      return json({ ok: false, eligible: false, error: 'No se pudo aislar la parte exacta a cambiar. Usa "Rehacer canción completa" para este cambio (más confiable para letras).' });
    }
    const sectionPrompt = sectionText.substring(0, 800);
    const callbackUrl = `${SUPABASE_URL}/functions/v1/song-callback`;

    // Pre-emptively paraphrase the CONTEXT lyrics we hand Suno so its copyright
    // filter is far less likely to false-positive on a 1-line edit. This does
    // NOT change the customer's song: only the infill window is re-sung (from
    // sectionPrompt); the rest stays the original audio, and fullLyrics is only
    // context. We still STORE the real corrected lyrics (fullLyrics), not this.
    let lyricsForKie = fullLyrics;
    const preSafe = await sanitizeLyricsForFilter(fullLyrics);
    if (preSafe && preSafe !== fullLyrics) {
      lyricsForKie = englishifyLyricsMarkers(preSafe);
      console.log('[fix] SECTION pre-emptive paraphrase of context lyrics applied');
    }

    console.log(`[fix] replace-section song=${songId} window=${start}-${end}s promptLen=${sectionPrompt.length} fullLyricsLen=${lyricsForKie.length} section="${sectionPrompt.slice(0, 140)}"`);
    const phrasesToVerify = verifyPhrases.length ? verifyPhrases : (Array.isArray(fix.verify_phrases) ? fix.verify_phrases : []);
    try {
      // ---- Kie replace-section + poll (sanitize+retry once on content filter) ----
      let promptUsed = sectionPrompt;
      let lyricsUsed = lyricsForKie;
      let fixTaskId = '';
      let tracks: KieTrack[] = [];
      try {
        fixTaskId = await submitReplaceSection({ taskId: song.kie_task_id, audioId, prompt: promptUsed, tags, title, infillStartS: start, infillEndS: end, fullLyrics: lyricsUsed, negativeTags, callbackUrl });
        tracks = await pollKieUntilDone(fixTaskId);
      } catch (e) {
        if (!isContentError(e)) throw e;
        const cleanedSection = await sanitizeLyricsForFilter(promptUsed);
        const cleanedFull = await sanitizeLyricsForFilter(lyricsUsed);
        if ((!cleanedSection || cleanedSection === promptUsed) && (!cleanedFull || cleanedFull === lyricsUsed)) throw e;
        console.log('[fix] SECTION content-filter retry with sanitized lyrics');
        promptUsed = (cleanedSection || promptUsed).substring(0, 800);
        lyricsUsed = englishifyLyricsMarkers(cleanedFull || lyricsUsed);
        fixTaskId = await submitReplaceSection({ taskId: song.kie_task_id, audioId, prompt: promptUsed, tags, title, infillStartS: start, infillEndS: end, fullLyrics: lyricsUsed, negativeTags, callbackUrl });
        tracks = await pollKieUntilDone(fixTaskId);
      }
      console.log(`[fix] replace-section taskId=${fixTaskId}`);
      const fixed = tracks.find((t) => t.audioUrl) || tracks[0];
      if (!fixed?.audioUrl) {
        await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'section', complaint: complaint.slice(0, 2000), window_start: start, window_end: end, kie_task_id: fixTaskId, outcome: 'failed', detail: 'no audio returned' });
        return json({ ok: false, fixTaskId, error: 'replace-section no devolvió audio' });
      }
      const v = await verifyPhrasesInAudio(fixed.audioUrl, phrasesToVerify);
      const verifyNote = !v.checked ? null : v.allFound
        ? '✅ Verificado: la corrección sí se canta.'
        : `⚠️ No pude confirmar en el audio: "${v.missing.join('", "')}". Para letras exactas, considera "Rehacer canción completa".`;
      await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'section', complaint: complaint.slice(0, 2000), window_start: start, window_end: end, kie_task_id: fixTaskId, kie_status: 'SUCCESS', fixed_audio_url: fixed.audioUrl, verified: v.checked ? v.allFound : null, verify_note: verifyNote, outcome: 'success' });
      return json({
        ok: true,
        songId,
        changeSummary: fix.change_summary || '',
        window: { startS: start, endS: end },
        originalAudioUrl: audioForFix,
        fixedAudioUrl: fixed.audioUrl,
        fixTaskId,
        fixAudioId: fixed.id || null,
        fixImageUrl: fixed.imageUrl || null,
        fullLyrics, // store the REAL corrected lyrics, not the filter-dodging paraphrase
        staleWarning,
        verified: v.checked ? v.allFound : null,
        verifyNote,
      });
    } catch (e: any) {
      await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'section', complaint: complaint.slice(0, 2000), window_start: start, window_end: end, kie_error_message: String(e?.message || e).slice(0, 500), outcome: isContentError(e) ? 'blocked' : 'failed' });
      return json({ ok: false, error: String(e?.message || e) });
    }
  } catch (e: any) {
    console.error('[fix-song-section] error:', e?.message);
    return json({ ok: false, error: e?.message });
  }
});
