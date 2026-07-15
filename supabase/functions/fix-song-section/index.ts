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
// In-house ffmpeg Cloud Run — does the seamless surgical splice server-side
// (duration-match + equal-power crossfade + gain-match). Same host/secret as video render.
const INHOUSE_RENDERER_URL = Deno.env.get('INHOUSE_RENDERER_URL');
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';

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
// Suno REJECTS tags that name a real artist ("Your tags contain artist name
// el komander…"). songs.style_used sometimes carries a regional-Mexican artist
// name (genre DNA leaked in at generation), so strip those before re-singing —
// otherwise both section-fix and full re-roll fail. Same gotcha as
// regenerate-paid-song-kie (which resends style_used verbatim).
const ARTIST_RE = /\b(el komander|komander|los buchones de culiac[aá]n|los buchones|buchones|gerardo ortiz|natanael cano|peso pluma|junior h|fuerza regida|tito double p|luis r\.? conriquez|conriquez|chalino(?: sanchez)?|los tucanes(?: de tijuana)?|los tigres del norte|banda ms|christian nodal|nodal|car[ií]n le[oó]n|eslab[oó]n armado|t3r elemento|ariel camacho|calibre 50|grupo firme|espinoza paz|larry hern[aá]ndez|remmy valenzuela|el fantasma|la adictiva|adriel favela|el makabelico|los dos carnales|la maquinaria norte[ñn]a)\b(?:\s+(?:style|sound|vibe|aesthetic))?/gi;
function stripArtistNames(style: string): string {
  if (!style) return style;
  let out = style.replace(ARTIST_RE, '');
  // Drop a dangling "al estilo de"/"estilo de"/"como"/"X style" left over.
  out = out.replace(/\b(al estilo de|estilo de|like|inspired by|in the style of|a lo|como|tipo)\s*(?=,|$)/gi, '');
  return out.replace(/\s*,\s*(,\s*)+/g, ', ').replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
}

function buildStyleAndNegatives(styleUsedRaw: string, voiceType: string): { tags: string; negativeTags: string } {
  const styleUsed = stripArtistNames(styleUsedRaw);
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
        description: 'If can_fix is false, one short sentence in ENGLISH explaining why a section fix is not possible. If true, one short note (in English) on the window you chose.',
      },
      infill_start_s: {
        type: 'number',
        description: 'Start time, in seconds (up to 2 decimals), of the slice to regenerate. Take it from the word timestamps. Start at the BEGINNING of the first full lyric line of the passage you are replacing (just before its first word) — never mid-line.',
      },
      infill_end_s: {
        type: 'number',
        description: 'End time, in seconds, of the slice to regenerate. End at the END of the last full lyric line of the passage (just after its last word) — never mid-line. Choose a whole phrase, not just the wrong word: aim for a 10-15 second window covering the complete line(s) the error sits in. Hard limits: 6-60 seconds and no more than half the song duration.',
      },
      section_text: {
        type: 'string',
        description: 'ALL the lyric lines that are actually sung within [infill_start_s, infill_end_s] — the COMPLETE contiguous passage, in Spanish, exactly as it should now be sung, with the correction applied and every OTHER word kept identical to the original. This fills the whole window so the model never has to pad or repeat a line to stretch a short fix. NEVER return just the single changed word or line.',
      },
      full_lyrics: {
        type: 'string',
        description: 'The COMPLETE corrected lyrics for the whole song, all sections, with section markers like [Coro]/[Verso] preserved. Apply ONLY the fix — every untouched line must stay identical to the original lyrics provided.',
      },
      change_summary: {
        type: 'string',
        description: 'One short sentence in ENGLISH describing exactly what changed, shown to the (English-speaking) shop owner (e.g. "Fixed the birth date in Verse 1 to 28 de octubre de 1987"). Keep any quoted lyric snippet in Spanish, but write the sentence in English.',
      },
      verify_phrases: {
        type: 'array',
        description: '1 a 3 palabras o frases cortas EXACTAS que DEBEN escucharse en la parte corregida (el nombre o la frase nueva). Se usan para verificar con transcripción que el cambio sí se cantó.',
        items: { type: 'string' },
      },
      add_line: {
        type: 'object',
        description: 'Solo si la petición es AGREGAR una línea NUEVA (no reemplazar) y esa línea va en el BLOQUE FINAL/despedida de la canción. En ese caso: { text: la línea nueva EXACTA en español (ya incluida también en section_text y full_lyrics en su lugar), anchor: UNA palabra distintiva de esa línea nueva (poco común en el resto de la canción, para ubicar el pase limpio) }. Si NO es una adición, o la adición NO está en el bloque final, OMITE add_line por completo (y si es una adición a media canción, pon can_fix=false).',
        properties: { text: { type: 'string' }, anchor: { type: 'string' } },
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
- REGLA CLAVE 1 (filtro de copyright): Suno RECHAZA ("contenido con derechos de autor") una ventana corta que contenga una línea muy común, sobre todo el típico arranque de corrido "Yo soy [nombre], nací/nacido un…". Una ventana de VARIAS líneas diluye ese parecido y SÍ pasa el filtro. Pero NO exageres: elige el BLOQUE MÍNIMO SUFICIENTE = las líneas del error MÁS unas pocas líneas siguientes, hasta el PRIMER hueco instrumental natural que venga después (normalmente unas 4 líneas, ~15-25s). Si el error está al inicio de un verso largo, NO re-cantes todo el verso — corta en el primer respiro instrumental. Mientras menos audio re-cantes, más se conserva la grabación original.
- REGLA CLAVE 2 (empalme): la ventana DEBE terminar en un HUECO INSTRUMENTAL natural entre secciones (el respiro antes de la siguiente línea/sección), no pegada a la siguiente palabra cantada. Ese hueco es donde se empalma de vuelta con el audio original; necesita ~1s o más de instrumental.
- Corta SIEMPRE en límites de línea naturales (inicio de la primera palabra, final de la última), nunca a media palabra ni a media frase.
- La ventana DEBE durar entre 6 y 60 segundos y NO más de la mitad de la canción.
- section_text debe ser TODO lo que se canta dentro de la ventana (la estrofa/líneas completas), ya con la corrección aplicada y dejando idénticas las demás palabras. La última línea de section_text marca dónde se hará el empalme.
- full_lyrics debe ser la letra COMPLETA ya corregida: aplica SOLO el cambio pedido y deja idéntico todo lo demás. Conserva los marcadores de sección.
- Para nombres mal pronunciados: reescribe el nombre con ortografía española fonética para que el modelo lo cante bien (p. ej. "Yareli" → "Yarelí", "Joaquin" → "Joaquín", "Yetzaeli" → "Yetsaelí"), tanto en full_lyrics como en section_text, manteniendo el nombre legible.
- QUIRKS DEL MODELO (lecciones aprendidas — el modelo canta mal ciertas frases y hay que redactar la corrección para que las cante bien):
  · Homófonos/elisiones: una frase que se presta a confundirse al cantarse la canta mal de forma consistente (p. ej. "me dicen el Potro" salió "me hice en el potro" en cada intento). Si la línea corregida contiene una construcción así, prefiere una redacción natural equivalente que conserve el significado y sea inequívoca al oído (p. ej. "me llaman el Potro"). No cambies el sentido; solo desambigua el sonido.
  · Fechas: escribe los números SIEMPRE en palabras y de forma natural en español (p. ej. "el catorce de marzo de dos mil catorce", nunca "14/03/2014" ni "2014"). El año va deletreado completo.
  · No repitas el coro ni la despedida dentro de la ventana; re-canta el bloque UNA sola vez, en orden, sin saltar ni duplicar líneas.
- AGREGAR UNA LÍNEA NUEVA (no reemplazar): solo es confiable en el BLOQUE FINAL / la despedida (ahí hay espacio instrumental y nada después que se desalinee). Si el dueño pide agregar una línea al final: inserta la línea EXACTA en su lugar dentro de section_text y de full_lyrics; define la ventana [infill_start_s, infill_end_s] = el bloque final completo (desde el inicio del último coro/despedida hasta el final del canto), y llena add_line = { text, anchor } con una palabra distintiva de la línea nueva. Si la canción tiene intro [Hablado] (los corridos), puedes agregarla como línea [Hablado] (lo hablado no necesita métrica → usa las palabras EXACTAS del cliente). Si la adición NO es al final (va a media canción), pon can_fix=false y explica que ese caso necesita rehacer la canción completa.
- Si el problema abarca toda la canción o no se puede ubicar, pon can_fix=false y explica por qué; no inventes una ventana.
- La queja puede incluir una conversación con el dueño y/o una captura de pantalla (WhatsApp) del mensaje del cliente. Lee la imagen si viene adjunta y usa todo el contexto para entender exactamente qué corregir.

IDIOMA: change_summary y reason van en INGLÉS (el dueño habla inglés). Toda la LETRA (section_text, full_lyrics, verify_phrases) y los nombres/fechas cantados permanecen en ESPAÑOL — nunca traduzcas la letra.

Devuelve SIEMPRE tu respuesta llamando a la herramienta submit_section_fix.`;

// Conversational assistant used BEFORE running the fix — helps the owner nail
// down exactly what to change (reads a pasted WhatsApp screenshot, asks short
// clarifying questions). It does NOT edit anything; the actual fix runs when the
// owner clicks "Generar arreglo".
const CHAT_SYSTEM_PROMPT = `You are an assistant that helps the owner of a personalized-song shop figure out EXACTLY what to fix in an already-generated Spanish-language song, BEFORE regenerating the section (regenerating costs money, so the change must be clear first).

The owner may paste a WhatsApp screenshot from the customer or type to you directly. You have the song's current lyrics.

Your job:
- Read the screenshot/message and say, in your own words, what you understand needs to change (which word, name, or line is wrong and what it should say).
- If information is missing (e.g. the customer says "the name is wrong" but not how it's spelled/pronounced), ask ONE short question to clarify.
- Once it's clear, summarize in a single sentence what you'll change and tell them: "When you're ready, click Confirm and generate."
- Do NOT invent details. Do NOT edit the song yourself (that happens when the owner clicks the button).
- Respond in ENGLISH, concise and clear. BUT keep any song lyrics, names, dates, and quoted lyric lines in their original SPANISH — never translate the lyrics themselves.`;

// Full-song re-roll: used when section-fix isn't possible (e.g. a Mureka song)
// or the owner chooses to remake the whole song. Claude returns the complete
// corrected lyrics; we then generate a fresh Kie song from them.
const FULL_FIX_SYSTEM_PROMPT = `Eres un editor de letras de canciones regionales mexicanas en español. Te dan la letra actual de una canción y una queja/instrucción (puede incluir una conversación con el dueño y/o una captura de WhatsApp del cliente). Devuelve la letra COMPLETA ya corregida aplicando SOLO el cambio pedido y dejando idéntico todo lo demás; conserva los marcadores de sección como [Coro] y [Verso]. Para nombres mal pronunciados, reescríbelos con ortografía española fonética (p. ej. "Yareli"→"Yarelí", "Joaquin"→"Joaquín"). Lee la imagen si viene adjunta. En "changes" lista cada línea o frase que cambió, con el texto exacto ANTES y DESPUÉS, para que el dueño lo confirme. Si la petición es AGREGAR una línea NUEVA (no reemplazar): inclúyela en full_lyrics en su lugar, repórtala en "changes" como { before: "(línea nueva)", after: la línea }, y si va en el BLOQUE FINAL/despedida llena add_line = { text, anchor } con una palabra distintiva y poco común de la línea nueva. Si la canción tiene intro [Hablado], puedes agregarla como línea [Hablado] con las palabras EXACTAS del cliente. IDIOMA: change_summary va en INGLÉS (el dueño habla inglés); la LETRA (full_lyrics) y los textos antes/después en "changes" permanecen en ESPAÑOL — nunca traduzcas la letra. Responde SIEMPRE llamando a la herramienta submit_corrected_lyrics.`;

const FULL_FIX_TOOL = {
  name: 'submit_corrected_lyrics',
  description: 'Return the complete corrected lyrics for the whole song with the requested fix applied, plus a list of the exact before/after changes.',
  input_schema: {
    type: 'object',
    properties: {
      full_lyrics: { type: 'string', description: 'La letra COMPLETA corregida, con marcadores de sección. Aplica SOLO el cambio pedido; deja igual lo demás.' },
      change_summary: { type: 'string', description: 'One short sentence in ENGLISH describing what changed (the lyrics themselves stay in Spanish).' },
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
      add_line: {
        type: 'object',
        description: 'Solo si la petición es AGREGAR una línea NUEVA (no reemplazar) al BLOQUE FINAL/despedida de la canción. { text: la línea nueva EXACTA en español (ya incluida en full_lyrics en su lugar), anchor: UNA palabra distintiva y poco común de esa línea }. OMÍTELO si no es una adición al final; si es una adición a media canción, descríbela igual pero el arreglo por sección no la podrá hacer.',
        properties: { text: { type: 'string' }, anchor: { type: 'string' } },
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

// Suggest alternate wordings of a line the AI singer keeps refusing (skips it,
// garbles it, or reverts to the original word — e.g. llaman→llamarán, or a filter
// block like "mi vida no tiene sentido"). Keeps the meaning; makes it singable.
const REWORD_TOOL = {
  name: 'suggest_rewordings',
  description: 'Suggest 2-3 alternate wordings of a lyric line that keep the exact meaning but are easier for the AI singer to sing.',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: { type: 'object', properties: { text: { type: 'string' }, why: { type: 'string' } }, required: ['text', 'why'], additionalProperties: false },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  },
} as const;
async function callClaudeReword(before: string, after: string, sang: string): Promise<any[]> {
  if (!ANTHROPIC_API_KEY) return [];
  const system = `Eres un letrista experto en canciones en español generadas por IA (Suno/Kie). El generador NO logra cantar cierta línea corregida: la salta, canta gibberish, o vuelve a la palabra original. Propón 2-3 REDACCIONES ALTERNATIVAS de la línea que: (a) conserven EXACTAMENTE el significado que el cliente pidió; (b) sean más fáciles de cantar — evita homófonos que el modelo confunde (p. ej. "me dicen"→"me hice"), y evita frases que disparan el filtro de contenido (autolesión: "mi vida no tiene sentido"); (c) mantengan métrica y rima parecidas. Cada sugerencia: text = la línea nueva completa en ESPAÑOL; why = una frase corta en INGLÉS para el dueño. Devuelve llamando a suggest_rewordings.`;
  const user = `Línea original: "${before}"\nCorrección deseada: "${after}"\nLo que el generador cantó (fallando): "${sang || '(saltó la línea / gibberish)'}"\n\nPropón 2-3 redacciones alternativas de la línea corregida, cantables, mismo significado.`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const model = attempt === 2 ? CLAUDE_FALLBACK_MODEL : CLAUDE_PRIMARY_MODEL;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 800, system, tool_choice: { type: 'tool', name: 'suggest_rewordings' }, tools: [REWORD_TOOL], messages: [{ role: 'user', content: user }] }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const block = (data?.content || []).find((b: any) => b?.type === 'tool_use' && b?.name === 'suggest_rewordings');
      const s = block?.input?.suggestions;
      if (Array.isArray(s) && s.length) return s.slice(0, 3);
    } catch { /* next model */ }
  }
  return [];
}

// Read a customer↔team conversation and summarize, in one or two plain Spanish
// sentences, WHAT the customer wants corrected in their song (the exact line/word/
// date/name when identifiable). Used by the "Send to Fix Song" chat button so the
// owner gets an actionable summary alongside the raw exchange.
async function callClaudeSummarizeRequest(exchange: string): Promise<string> {
  if (!ANTHROPIC_API_KEY || !exchange.trim()) return '';
  const system = `Eres un asistente que lee una conversación entre el equipo de soporte y un cliente sobre su CANCIÓN personalizada. Resume en UNA o DOS frases claras QUÉ quiere corregir el cliente en la canción (la línea, palabra, fecha o nombre EXACTO si se identifica). Escribe en ESPAÑOL, directo y accionable para quien hará el arreglo. Si NO es una corrección de canción, responde exactamente "(no parece una corrección de canción)". Devuelve SOLO el resumen, sin preámbulo.`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const model = attempt === 2 ? CLAUDE_FALLBACK_MODEL : CLAUDE_PRIMARY_MODEL;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 300, system, messages: [{ role: 'user', content: `CONVERSACIÓN:\n${exchange}` }] }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const text = (data?.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim();
      if (text) return text;
    } catch { /* next model */ }
  }
  return '';
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
// Count contiguous, in-order occurrences of a phrase's tokens in the audio
// token stream (used to catch the line being sung MORE than it should be).
function countPhraseOccurrences(tokens: string[], phraseTokens: string[]): number {
  if (!phraseTokens.length || !tokens.length) return 0;
  let count = 0;
  for (let i = 0; i + phraseTokens.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (!fuzzyEq(tokens[i + j], phraseTokens[j])) { ok = false; break; }
    }
    if (ok) { count++; i += phraseTokens.length - 1; }
  }
  return count;
}
async function verifyPhrasesInAudio(audioUrl: string, phrases: string[], expectedLyrics?: string): Promise<{ checked: boolean; allFound: boolean; missing: string[]; found: string[]; repeated: string[] }> {
  const clean = (phrases || []).map((p) => String(p || '').trim()).filter(Boolean);
  if (!clean.length) return { checked: false, allFound: true, missing: [], found: [], repeated: [] };
  const w = await transcribeAudio(audioUrl);
  if (!w || !w.words.length) return { checked: false, allFound: true, missing: [], found: [], repeated: [] };
  const audioTokens = w.words.map((x) => normalizeForMatch(x.word)).filter(Boolean);
  // How often each phrase is SUPPOSED to appear, read off the corrected lyrics.
  const expectedTokens = expectedLyrics ? expectedLyrics.split(/\s+/).map(normalizeForMatch).filter(Boolean) : null;
  const found: string[] = [];
  const missing: string[] = [];
  const repeated: string[] = [];
  for (const phrase of clean) {
    const tokens = phrase.split(/\s+/).map(normalizeForMatch).filter((t) => t.length > 1);
    if (!tokens.length) continue;
    // Lenient presence check (Whisper mis-segments Spanish, so don't require contiguity here).
    const present = tokens.every((t) => audioTokens.some((a) => fuzzyEq(a, t)));
    (present ? found : missing).push(phrase);
    // Repetition check: contiguous occurrences in the audio vs. in the lyrics.
    const expected = expectedTokens ? Math.max(1, countPhraseOccurrences(expectedTokens, tokens)) : 1;
    if (countPhraseOccurrences(audioTokens, tokens) > expected) repeated.push(phrase);
  }
  return { checked: true, allFound: missing.length === 0, missing, found, repeated };
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

// ---------------------------------------------------------------------------
// Best-of-N — Kie returns up to 2 takes per generation; verify each and pick
// the one where the correction actually landed (auto-pick), keeping the others
// as alternates the owner can switch to.
// ---------------------------------------------------------------------------
type Take = { audioUrl: string; id: string | null; imageUrl: string | null; verified: boolean | null; missing: string[]; repeated: string[]; lyrics?: string };
async function annotateTake(t: KieTrack, phrases: string[], lyrics?: string): Promise<Take | null> {
  if (!t.audioUrl) return null;
  const v = await verifyPhrasesInAudio(t.audioUrl, phrases, lyrics);
  const repeated = v.repeated || [];
  // A take that REPEATS the corrected line is a fail (the exact bug we're
  // killing) — rank it below an unverifiable take so best-of-N retries.
  const verified = v.checked ? (v.allFound && repeated.length === 0) : null;
  return { audioUrl: t.audioUrl, id: t.id || null, imageUrl: t.imageUrl || null, verified, missing: v.missing, repeated, lyrics };
}
// Best first: verified, then unverifiable (null), then failed.
function orderTakesBest(takes: Take[]): Take[] {
  const rank = (t: Take) => (t.verified === true ? 0 : t.verified === null ? 1 : 2);
  return [...takes].sort((a, b) => rank(a) - rank(b));
}
function takeVerifyNote(t: Take | undefined, sectionMode: boolean): string | null {
  if (!t) return null;
  if (t.verified === true) return '✅ Verified: the correction is sung correctly.';
  if (t.repeated && t.repeated.length) return `⚠️ The corrected part was sung more than once ("${t.repeated.join('", "')}").${sectionMode ? ' Retried with a longer window; if it persists, use "Redo full song".' : ' Try again or check the takes.'}`;
  if (t.verified === false) return `⚠️ Couldn't confirm the correction${t.missing.length ? `: "${t.missing.join('", "')}"` : ''}.${sectionMode ? ' For exact lyrics, consider "Redo full song".' : ' Check the takes or try again.'}`;
  return null;
}
// One full-generation round, with content-filter sanitize+retry baked in.
async function generateFullRound(lyrics: string, title: string, styleUsed: string, voiceType: string, callbackUrl: string): Promise<{ taskId: string; tracks: KieTrack[]; usedLyrics: string }> {
  let usedLyrics = lyrics;
  try {
    const taskId = await submitFullGenerate(usedLyrics, title, styleUsed, voiceType, callbackUrl);
    return { taskId, tracks: await pollKieUntilDone(taskId), usedLyrics };
  } catch (e) {
    if (!isContentError(e)) throw e;
    const cleaned = await sanitizeLyricsForFilter(usedLyrics);
    if (!cleaned || cleaned === usedLyrics) throw e;
    usedLyrics = cleaned;
    const taskId = await submitFullGenerate(usedLyrics, title, styleUsed, voiceType, callbackUrl);
    return { taskId, tracks: await pollKieUntilDone(taskId), usedLyrics };
  }
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

// Suno re-sings the ENTIRE infill window from the prompt lyrics, so a window
// that's too short for the line forces it to pad by repeating. Real-data sweet
// spot (song_fix_attempts): ~12-14s phrase-length windows land clean; ~6s ones
// repeat. We grow Claude's window to at least this, then snap both edges to the
// gaps between sung words so the splice falls in a natural breath, not mid-word.
const TARGET_MIN_WINDOW_S = 11;

// Nearest silence gap (midpoint between two consecutive sung words) to time `t`,
// searching within `search` seconds. Falls back to `t` if none is close.
function snapToGap(t: number, words: WhisperWord[], dur: number, search = 1.3): number {
  if (!words || words.length < 2) return Math.max(0, Math.min(t, dur));
  let best = t;
  let bestDist = Infinity;
  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i].end;
    const gapEnd = words[i + 1].start;
    if (gapEnd <= gapStart) continue; // no silence between these words
    const mid = (gapStart + gapEnd) / 2;
    const d = Math.abs(mid - t);
    if (d < bestDist && d <= search) { bestDist = d; best = mid; }
  }
  return Math.max(0, Math.min(best, dur));
}

// Expand a window to a phrase-length minimum (centered), snap edges to natural
// breaths, then enforce Kie's 6-60s / <=50% rule via clampWindow.
function snapWindowToPhrase(startIn: number, endIn: number, words: WhisperWord[], duration: number): { start: number; end: number } {
  const dur = duration > 0 ? duration : 180;
  let start = Math.max(0, Math.min(startIn, dur));
  let end = Math.max(start, Math.min(endIn, dur));

  const target = Math.min(Math.max(TARGET_MIN_WINDOW_S, end - start), Math.min(MAX_WINDOW_S, dur * 0.5));
  if (end - start < target) {
    const center = (start + end) / 2;
    start = center - target / 2;
    end = center + target / 2;
    if (start < 0) { end -= start; start = 0; }
    if (end > dur) { start -= (end - dur); end = dur; }
    start = Math.max(0, start);
  }

  // Snap to breaths (only adopt the snap if it doesn't shrink us below target).
  const snappedStart = snapToGap(start, words, dur);
  const snappedEnd = snapToGap(end, words, dur);
  if (snappedEnd - snappedStart >= Math.min(target, MIN_WINDOW_S)) {
    start = snappedStart;
    end = snappedEnd;
  }

  return clampWindow(start, end, dur);
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

// Host a browser-spliced surgical fix (MP3 multipart) and swap it into the song
// row, snapshotting the previous version for undo. The applied audio is a
// stitched MP3 (not a Kie track), so we drop the Kie ids — a future fix on this
// song goes through a fresh re-roll rather than a stale section edit.
async function applySplicedAudio(req: Request, supabase: any): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); } catch (e) { return json({ ok: false, error: `bad multipart: ${e instanceof Error ? e.message : e}` }); }
  const file = form.get('audio');
  const songId = String(form.get('songId') || '');
  const fullLyrics = form.get('fullLyrics') ? String(form.get('fullLyrics')) : '';
  const summary = form.get('summary') ? String(form.get('summary')) : '';
  // Multi-part fixes send the full list of corrections applied so far, so future
  // fixes can re-derive from the pristine original without dropping an earlier one.
  let corrections: unknown = null;
  if (form.get('corrections')) { try { corrections = JSON.parse(String(form.get('corrections'))); } catch { corrections = null; } }
  if (!file || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== 'function' || !songId) {
    return json({ ok: false, error: 'audio file and songId are required' });
  }
  const bytes = new Uint8Array(await (file as Blob).arrayBuffer());
  if (!bytes.length) return json({ ok: false, error: 'empty audio' });

  const objectPath = `songs/fixed-${songId}-${Date.now()}.mp3`;
  const up = await supabase.storage.from('audio').upload(objectPath, bytes, { contentType: 'audio/mpeg', upsert: true });
  if (up.error) return json({ ok: false, error: `upload failed: ${up.error.message}` });
  const publicUrl = supabase.storage.from('audio').getPublicUrl(objectPath).data.publicUrl;

  const { data: prev } = await supabase
    .from('songs')
    .select('audio_url, preview_url, original_audio_url, image_url, lyrics, kie_task_id, task_id, kie_payload, kie_source, fix_corrections, provider, lyrics_timestamps, fixed_at, fix_count, fix_history')
    .eq('id', songId)
    .single();

  const now = new Date().toISOString();
  const prevHistory = Array.isArray(prev?.fix_history) ? prev!.fix_history : [];
  const update: Record<string, unknown> = {
    audio_url: publicUrl,
    preview_url: publicUrl,
    original_audio_url: publicUrl,
    status: 'completed',
    needs_reupload: true,
    error_message: null,
    lyrics_timestamps: null,
    kie_task_id: null,
    task_id: null,
    kie_payload: null,
    // Footprint — stamp the song as fixed (when + note + count) so staff can see
    // at a glance which songs were repaired and why.
    fixed_at: now,
    fix_count: (Number(prev?.fix_count) || 0) + 1,
    fix_history: [...prevHistory, { at: now, note: summary || 'Surgical fix (Arreglar Canción)', mode: 'section' }],
    fix_backup: prev ? { ...prev, backed_up_at: now } : null,
  };
  // kie_source is intentionally NOT in `update` — it must survive the apply so a
  // future surgical fix can still re-sing from the original voice-track.
  if (Array.isArray(corrections)) update.fix_corrections = corrections;
  if (fullLyrics.trim()) update.lyrics = fullLyrics;

  const { error } = await supabase.from('songs').update(update).eq('id', songId);
  if (error) return json({ ok: false, error: `apply failed: ${error.message}` });
  await logAttempt(supabase, { song_id: songId, action: 'apply-spliced', fixed_audio_url: publicUrl, outcome: 'applied', detail: summary.slice(0, 500) });
  return json({ ok: true, songId, applied: true, audioUrl: publicUrl, fixCount: (Number(prev?.fix_count) || 0) + 1, fixedAt: now, canUndo: !!prev, songLink: `https://regalosquecantan.com/song/${songId}` });
}

// Fetch a specific Kie track's CURRENT audioUrl via record-info. Kie's temp
// audio URLs can rotate, so we always re-fetch rather than trust a stored URL.
async function fetchKieTrack(taskId: string, audioId?: string): Promise<{ audioUrl: string; id: string } | null> {
  if (!KIE_API_KEY || !taskId) return null;
  try {
    const resp = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
    });
    const raw = await resp.json().catch(() => null);
    const tracks: any[] = raw?.data?.response?.sunoData ?? [];
    if (!tracks.length) return null;
    const t = (audioId && tracks.find((x: any) => x.id === audioId)) || tracks[0];
    if (!t?.audioUrl) return null;
    return { audioUrl: t.audioUrl, id: t.id };
  } catch { return null; }
}

function parseJsonMaybe(p: any): any {
  if (p && typeof p === 'string') { try { return JSON.parse(p); } catch { return null; } }
  return p;
}

// Resolve the ORIGINAL Kie voice-track for a song so surgical fixes keep working
// even after the song has already been fixed once (an apply nulls kie_task_id).
// Tries, in order: the live row ids -> the permanent kie_source column -> the
// fix_backup snapshot. Backfills kie_source when found (first-time recovery) so
// it survives all future fixes. Returns the parent taskId, the per-track audioId,
// and the CURRENT pristine audioUrl. null = no recoverable Kie source (Mureka, or
// Kie purged the audio after ~14 days) → caller should offer a full re-roll.
async function resolveKieSource(song: any, supabase: any): Promise<{ taskId: string; audioId: string; pristineUrl: string } | null> {
  const candidates: Array<{ taskId?: string; audioId?: string }> = [];
  if (song?.kie_task_id) { const kp = parseJsonMaybe(song.kie_payload); candidates.push({ taskId: song.kie_task_id, audioId: kp?.id }); }
  const ks = parseJsonMaybe(song?.kie_source); if (ks?.taskId) candidates.push({ taskId: ks.taskId, audioId: ks.audioId });
  const fb = parseJsonMaybe(song?.fix_backup); if (fb?.kie_task_id) { const kp = parseJsonMaybe(fb.kie_payload); candidates.push({ taskId: fb.kie_task_id, audioId: kp?.id }); }
  for (const c of candidates) {
    if (!c.taskId) continue;
    const track = await fetchKieTrack(c.taskId, c.audioId);
    if (track?.audioUrl) {
      const existing = parseJsonMaybe(song?.kie_source);
      if (!existing || existing.taskId !== c.taskId) {
        try { await supabase.from('songs').update({ kie_source: { taskId: c.taskId, audioId: c.audioId || track.id } }).eq('id', song.id); } catch { /* best effort */ }
      }
      return { taskId: c.taskId, audioId: c.audioId || track.id, pristineUrl: track.audioUrl };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // The admin dashboard stitches the surgical fix in the browser (Web Audio)
    // and POSTs the finished MP3 here as multipart/form-data to host + apply it.
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      return await applySplicedAudio(req, supabase);
    }

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
        // Full track list (audioUrl/id/imageUrl) so a slow replace-section job
        // whose original request hit the 150s gateway timeout can still be
        // collected out-of-band by polling this action with the taskId.
        trackList: (raw?.data?.response?.sunoData ?? []).map((t: any) => ({
          id: t.id ?? null,
          audioUrl: t.audioUrl ?? null,
          imageUrl: t.imageUrl ?? null,
        })),
      });
    }

    // -----------------------------------------------------------------
    // SIBLINGS — the OTHER version(s) of the same song from one generation.
    // Every song creation makes 2 audio variants that share a `session_id`
    // (present on both regardless of paid, and it survives a fix — unlike
    // kie_task_id). Used by the admin "Corregir ambas versiones" button to fix
    // both takes of a bundle at once. Read-only, no cost.
    // -----------------------------------------------------------------
    if (action === 'siblings') {
      const songId: string | undefined = body?.songId;
      if (!songId) return json({ ok: false, error: 'songId required' });
      const { data: me } = await supabase.from('songs').select('session_id').eq('id', songId).single();
      if (!me?.session_id) return json({ ok: true, siblings: [] });
      const { data: sibs } = await supabase
        .from('songs')
        .select('id, version, paid, recipient_name, audio_url, provider')
        .eq('session_id', me.session_id)
        .neq('id', songId)
        .order('version', { ascending: true });
      return json({ ok: true, siblings: sibs || [] });
    }

    // -----------------------------------------------------------------
    // TRANSCRIBE — Whisper word-timestamps for a song (no Kie cost). Used to
    // inspect WHERE a lyric line falls in the audio while tuning section fixes.
    // Returns words + duration; pass verify=[...] to also get occurrence counts.
    // -----------------------------------------------------------------
    if (action === 'transcribe') {
      if (!OPENAI_API_KEY) return json({ ok: false, error: 'OPENAI_API_KEY missing on Supabase' });
      const songId: string | undefined = body?.songId;
      const directUrl: string | undefined = body?.audioUrl;
      let audioUrl: string | undefined = directUrl;
      let cached: WhisperResult | null = null;
      if (!audioUrl) {
        if (!songId) return json({ ok: false, error: 'songId or audioUrl required' });
        const { data: s } = await supabase.from('songs').select('audio_url, original_audio_url, lyrics_timestamps').eq('id', songId).single();
        audioUrl = s?.original_audio_url || s?.audio_url;
        if (s?.lyrics_timestamps && Array.isArray(s.lyrics_timestamps?.words) && s.lyrics_timestamps.words.length) cached = s.lyrics_timestamps as WhisperResult;
      }
      if (!audioUrl) return json({ ok: false, error: 'no audio to transcribe' });
      let w = cached;
      if (!w) {
        w = await transcribeAudio(audioUrl);
        if (w && w.words.length && songId && !directUrl) await supabase.from('songs').update({ lyrics_timestamps: w }).eq('id', songId);
      }
      if (!w || !w.words.length) return json({ ok: false, error: 'transcription failed' });
      return json({
        ok: true,
        duration: w.duration,
        wordCount: w.words.length,
        // Compact "word[start-end]" view so the time of any line is readable.
        timed: w.words.map((x) => `${x.word.trim()}[${x.start.toFixed(2)}-${x.end.toFixed(2)}]`).join(' '),
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
      const changeSummary: string | undefined = body?.changeSummary;
      if (!songId || !fixedAudioUrl) return json({ ok: false, error: 'songId and fixedAudioUrl are required' });

      // Snapshot the current state so the owner can Undo this fix.
      const { data: prev } = await supabase
        .from('songs')
        .select('audio_url, preview_url, original_audio_url, image_url, lyrics, kie_task_id, task_id, kie_payload, provider, lyrics_timestamps, fixed_at, fix_count, fix_history')
        .eq('id', songId)
        .single();

      const nowTs = new Date().toISOString();
      const prevHist = Array.isArray(prev?.fix_history) ? prev!.fix_history : [];
      const update: Record<string, unknown> = {
        audio_url: fixedAudioUrl,
        preview_url: fixedAudioUrl,
        original_audio_url: fixedAudioUrl,
        status: 'completed',
        needs_reupload: true,
        provider: 'kie',
        error_message: null,
        // Footprint — stamp the song as fixed (when + note + count).
        fixed_at: nowTs,
        fix_count: (Number(prev?.fix_count) || 0) + 1,
        fix_history: [...prevHist, { at: nowTs, note: changeSummary || 'Full re-roll (Arreglar Canción)', mode: 'full' }],
        fix_backup: prev ? { ...prev, backed_up_at: nowTs } : null,
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
      await logAttempt(supabase, { song_id: songId, action: 'apply', kie_task_id: fixTaskId || null, fixed_audio_url: fixedAudioUrl, outcome: 'applied', detail: (changeSummary || '').slice(0, 500) });
      return json({ ok: true, songId, applied: true, fixCount: (Number(prev?.fix_count) || 0) + 1, fixedAt: nowTs, canUndo: !!prev, songLink: `https://regalosquecantan.com/song/${songId}` });
    }

    // -----------------------------------------------------------------
    // UNDO — restore the snapshot taken before the last apply.
    // -----------------------------------------------------------------
    if (action === 'undo') {
      const songId: string | undefined = body?.songId;
      if (!songId) return json({ ok: false, error: 'songId is required' });
      const { data: row } = await supabase.from('songs').select('fix_backup').eq('id', songId).single();
      const b: any = row?.fix_backup;
      if (!b || !b.audio_url) return json({ ok: false, error: 'No previous fix to undo on this song.' });
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
        // Restore the footprint to its pre-fix state (snapshot captured them).
        fixed_at: b.fixed_at ?? null,
        fix_count: Number(b.fix_count) || 0,
        fix_history: Array.isArray(b.fix_history) ? b.fix_history : [],
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
    // Reword a stubborn line the AI singer keeps refusing (skip/garble/filter) —
    // returns 2-3 singable alternatives that keep the meaning, for the owner to pick.
    if (action === 'reword') {
      const after = String(body?.after || '');
      if (!after) return json({ ok: false, error: 'after line is required' });
      const suggestions = await callClaudeReword(String(body?.before || ''), after, String(body?.sang || ''));
      return json({ ok: true, suggestions });
    }

    // Summarize a chat exchange into "what the customer wants corrected" — for the
    // "Send to Fix Song" button (owner reviews the raw exchange + this summary).
    if (action === 'summarize-request') {
      const summary = await callClaudeSummarizeRequest(String(body?.exchange || ''));
      return json({ ok: true, summary });
    }

    // Seamless splice — proxy to the in-house ffmpeg Cloud Run, which stitches the
    // re-sung line into the pristine song with duration-match + equal-power
    // crossfade + gain-match, and returns a hosted MP3 URL. The browser plays that
    // URL for preview and fetches it into a blob to apply — replacing the old
    // in-browser Web-Audio splice that made the seam audible. Falls through to the
    // browser splice on the frontend if this errors.
    if (action === 'splice') {
      if (!INHOUSE_RENDERER_URL) return json({ ok: false, error: 'INHOUSE_RENDERER_URL not configured' });
      const mode = body?.mode === 'section' ? 'section' : body?.mode === 'rehost' ? 'rehost' : 'line';
      const spec: Record<string, unknown> = {
        mode,
        pristine_url: body?.pristineUrl,
        resung_url: body?.resungUrl,
      };
      if (mode === 'section') { spec.origCut = body?.origCut; spec.resungCut = body?.resungCut; }
      else if (mode === 'line') { spec.pStart = body?.pStart; spec.pEnd = body?.pEnd; spec.rStart = body?.rStart; spec.rEnd = body?.rEnd; spec.noStretch = !!body?.noStretch; }
      if (!spec.pristine_url) return json({ ok: false, error: 'pristineUrl required' });
      if (mode !== 'rehost' && !spec.resung_url) return json({ ok: false, error: 'resungUrl required' });
      try {
        const r = await fetch(`${INHOUSE_RENDERER_URL}/splice-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN },
          body: JSON.stringify(spec),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.success) return json({ ok: false, error: d?.error || `splice ${r.status}` });
        return json({ ok: true, url: d.url });
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

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
        addLine: (plan.add_line && typeof plan.add_line?.text === 'string' && plan.add_line.text.trim())
          ? { text: String(plan.add_line.text).trim(), anchor: String(plan.add_line.anchor || '').trim() }
          : null,
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
      .select('id, recipient_name, voice_type, style_used, genre, lyrics, audio_url, original_audio_url, kie_task_id, kie_payload, kie_source, fix_backup, lyrics_timestamps, provider, created_at')
      .eq('id', songId)
      .single();
    if (songErr || !song) return json({ ok: false, error: `song lookup failed: ${songErr?.message || 'not found'}` });

    const audioForFix: string | undefined = song.original_audio_url || song.audio_url;
    if (!audioForFix) return json({ ok: false, error: 'song has no audio to fix' });

    // ---- FULL re-roll path — remake the whole song on Kie from corrected
    // lyrics. Works for any song (incl. Mureka), since it generates fresh. ----
    const mode = (body?.mode === 'full' || action === 'full-submit') ? 'full' : 'section';
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

      // ---- ASYNC SUBMIT-ONLY (full re-roll) ----
      // A full generation runs well past Supabase's 150s request limit, so the
      // synchronous 'full' preview 504s and loses the audio. action:'full-submit'
      // submits ONE generation (Kie returns ~2 takes) and returns the taskId
      // immediately; the caller polls action:'diag' for both takes, then applies
      // the chosen one. Mirrors 'section-submit'.
      if (action === 'full-submit') {
        try {
          let lyricsUsed = correctedLyrics as string;
          let taskId: string;
          try {
            taskId = await submitFullGenerate(lyricsUsed, title, song.style_used, song.voice_type, callbackUrl);
          } catch (e) {
            if (!isContentError(e)) throw e;
            const cleaned = await sanitizeLyricsForFilter(lyricsUsed);
            if (!cleaned || cleaned === lyricsUsed) throw e;
            lyricsUsed = cleaned;
            taskId = await submitFullGenerate(lyricsUsed, title, song.style_used, song.voice_type, callbackUrl);
          }
          await logAttempt(supabase, { song_id: songId, action: 'full-submit', mode: 'full', complaint: complaint.slice(0, 2000), kie_task_id: taskId, outcome: 'submitted', detail: (correctedSummary || '').slice(0, 500) });
          return json({
            ok: true,
            submitted: true,
            mode: 'full',
            songId,
            fixTaskId: taskId,
            changeSummary: correctedSummary,
            fullLyrics: correctedLyrics, // store the REAL corrected lyrics on apply
            verifyPhrases,
            staleWarning: null,
          });
        } catch (e: any) {
          await logAttempt(supabase, { song_id: songId, action: 'full-submit', mode: 'full', complaint: complaint.slice(0, 2000), kie_error_message: String(e?.message || e).slice(0, 500), outcome: isContentError(e) ? 'blocked' : 'failed' });
          return json({ ok: false, error: String(e?.message || e) });
        }
      }

      try {
        // Best-of-N: each round returns ~2 takes; verify each, auto-pick the one
        // that got the correction right. 2nd round only if the 1st didn't verify.
        const takes: Take[] = [];
        let lastTaskId = '';
        const maxRounds = verifyPhrases.length ? 2 : 1;
        for (let round = 1; round <= maxRounds; round++) {
          const r = await generateFullRound(correctedLyrics, title, song.style_used, song.voice_type, callbackUrl);
          lastTaskId = r.taskId;
          for (const t of r.tracks) { const a = await annotateTake(t, verifyPhrases, r.usedLyrics); if (a) takes.push(a); }
          if (!verifyPhrases.length || takes.some((t) => t.verified === true)) break;
        }
        if (!takes.length) {
          await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'full', complaint: complaint.slice(0, 2000), kie_task_id: lastTaskId, outcome: 'failed', detail: 'no audio returned' });
          return json({ ok: false, fixTaskId: lastTaskId, error: 'la regeneración no devolvió audio' });
        }
        const ordered = orderTakesBest(takes);
        const best = ordered[0];
        const verifyNote = takeVerifyNote(best, false);
        await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'full', complaint: complaint.slice(0, 2000), kie_task_id: lastTaskId, kie_status: 'SUCCESS', fixed_audio_url: best.audioUrl, verified: best.verified, verify_note: verifyNote, outcome: 'success', detail: `${ordered.length} takes` });
        return json({
          ok: true,
          mode: 'full',
          songId,
          changeSummary: correctedSummary,
          originalAudioUrl: audioForFix,
          fixedAudioUrl: best.audioUrl,
          fixTaskId: lastTaskId,
          fixAudioId: best.id,
          fixImageUrl: best.imageUrl,
          fullLyrics: best.lyrics || correctedLyrics,
          verified: best.verified,
          verifyNote,
          takes: ordered.map((t) => ({ audioUrl: t.audioUrl, id: t.id, imageUrl: t.imageUrl, verified: t.verified, lyrics: t.lyrics || correctedLyrics })),
        });
      } catch (e: any) {
        await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'full', complaint: complaint.slice(0, 2000), kie_error_message: String(e?.message || e).slice(0, 500), outcome: isContentError(e) ? 'blocked' : 'failed' });
        return json({ ok: false, error: String(e?.message || e) });
      }
    }

    // ---- SECTION path — resolve the ORIGINAL Kie voice-track. resolveKieSource
    // recovers it from kie_source / fix_backup even if this song was already
    // fixed once (an apply nulls kie_task_id), so repeat & multi-part surgical
    // fixes keep re-singing from the same original voice. ----
    const kieSrc = await resolveKieSource(song, supabase);
    if (!kieSrc) {
      return json({ ok: false, eligible: false, error: 'No hay una pista original de Kie disponible (hecha con Mureka, o Kie ya borró el audio tras ~14 días). Usa "regenerar canción completa".' });
    }
    const audioId: string = kieSrc.audioId;
    const kieTaskId: string = kieSrc.taskId;
    const pristineUrl: string = kieSrc.pristineUrl;
    if (!song.style_used) return json({ ok: false, error: 'song is missing style_used' });
    if (!song.lyrics) return json({ ok: false, error: 'song is missing lyrics' });

    const ageDays = song.created_at ? (Date.now() - new Date(song.created_at).getTime()) / 86400000 : null;
    // Songs older than Kie's ~14-day audio retention can't be section-fixed — the
    // original voice-track is deleted, so the re-sing + splice have nothing to work
    // from. Route straight to the full re-roll (fresh take, same style & voice)
    // with a clear message, instead of failing later on a dead transcription/re-sing.
    if (ageDays !== null && ageDays > 14) {
      return json({ ok: false, eligible: false, tooOld: true,
        reason: `Esta canción tiene ~${Math.round(ageDays)} días. Kie borra el audio original después de ~14 días, así que el arreglo por sección (misma voz exacta) ya no es posible. Usa "Rehacer la canción completa" — se vuelve a grabar con el mismo estilo y tipo de voz.` });
    }

    // ---- Word-level timestamps of the PRISTINE original (fresh Whisper — the
    // cached lyrics_timestamps may be a previously-fixed version, and the splice
    // must line up with the pristine timeline). If the Kie tempfile is unreachable
    // (flaky/expired) but the song is still young enough, fall back to OUR permanent
    // copy (audio_url) — it's the same audio, so both transcription and splice work. ----
    let whisper: WhisperResult | null = await transcribeAudio(pristineUrl);
    let pristineForSplice = pristineUrl;
    if ((!whisper || whisper.words.length === 0) && song.audio_url && song.audio_url !== pristineUrl) {
      console.log('[fix] pristine Kie URL unreachable — retrying with permanent audio_url');
      const w2 = await transcribeAudio(song.audio_url);
      if (w2 && w2.words.length) { whisper = w2; pristineForSplice = song.audio_url; }
    }
    if (!whisper || whisper.words.length === 0) {
      return json({ ok: false, eligible: false,
        reason: 'No se pudo acceder al audio original para transcribirlo. Usa "Rehacer la canción completa" (mismo estilo y voz).' });
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

    // Grow to a phrase-length window + snap to natural breaths (anti-repetition).
    const { start, end } = snapWindowToPhrase(Number(fix.infill_start_s), Number(fix.infill_end_s), whisper.words, duration);
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

    // Do NOT pre-emptively paraphrase. The song's ORIGINAL lyrics already PASSED
    // Kie's copyright filter at creation time, so the safest payload for
    // replace-section is those same lyrics with ONLY the correction applied
    // (minimal change). Pre-paraphrasing the whole song rewrote approved-safe
    // lines into novel ones that tripped the filter MORE — observed 2026-06-23
    // on a corrido whose original generated cleanly but whose paraphrased
    // replace-section payload hit SENSITIVE_WORD_ERROR twice. Paraphrasing is
    // now REACTIVE only: it runs in the catch below IF Kie actually rejects.
    const lyricsForKie = fullLyrics;

    console.log(`[fix] replace-section song=${songId} window=${start}-${end}s promptLen=${sectionPrompt.length} fullLyricsLen=${lyricsForKie.length} section="${sectionPrompt.slice(0, 140)}"`);
    const phrasesToVerify = verifyPhrases.length ? verifyPhrases : (Array.isArray(fix.verify_phrases) ? fix.verify_phrases : []);

    // ---- ASYNC SUBMIT-ONLY path ----
    // Kie's replace-section can take longer than Supabase's hard 150s request
    // limit, so the synchronous 'preview' (submit + poll in one request) 504s
    // and the result is lost. action:'section-submit' does everything EXCEPT the
    // poll: it returns the Kie taskId immediately. The caller then polls
    // action:'diag' (fast, single record-info fetch) until SUCCESS, reads the
    // audio from trackList, and finishes with action:'apply'. No request ever
    // approaches the gateway timeout.
    if (action === 'section-submit') {
      try {
        let promptUsed = sectionPrompt;
        let lyricsUsed = lyricsForKie;
        let fixTaskId: string;
        try {
          fixTaskId = await submitReplaceSection({ taskId: kieTaskId, audioId, prompt: promptUsed, tags, title, infillStartS: start, infillEndS: end, fullLyrics: lyricsUsed, negativeTags, callbackUrl });
        } catch (e) {
          if (!isContentError(e)) throw e;
          const cs = await sanitizeLyricsForFilter(promptUsed);
          const cf = await sanitizeLyricsForFilter(lyricsUsed);
          if ((!cs || cs === promptUsed) && (!cf || cf === lyricsUsed)) throw e;
          promptUsed = (cs || promptUsed).substring(0, 800);
          lyricsUsed = englishifyLyricsMarkers(cf || lyricsUsed);
          fixTaskId = await submitReplaceSection({ taskId: kieTaskId, audioId, prompt: promptUsed, tags, title, infillStartS: start, infillEndS: end, fullLyrics: lyricsUsed, negativeTags, callbackUrl });
        }
        await logAttempt(supabase, { song_id: songId, action: 'section-submit', mode: 'section', complaint: complaint.slice(0, 2000), window_start: start, window_end: end, kie_task_id: fixTaskId, outcome: 'submitted', detail: (fix.change_summary || '').slice(0, 500) });
        return json({
          ok: true,
          submitted: true,
          songId,
          fixTaskId,
          changeSummary: fix.change_summary || '',
          window: { startS: start, endS: end },
          sectionText,                 // the corrected block lines (for splice-boundary detection)
          originalAudioUrl: pristineForSplice, // pristine original (or our permanent copy) — everything after the block comes from here
          fullLyrics, // the REAL corrected lyrics to store on apply
          verifyPhrases: phrasesToVerify,
          staleWarning: null,
        });
      } catch (e: any) {
        await logAttempt(supabase, { song_id: songId, action: 'section-submit', mode: 'section', complaint: complaint.slice(0, 2000), window_start: start, window_end: end, kie_error_message: String(e?.message || e).slice(0, 500), outcome: isContentError(e) ? 'blocked' : 'failed' });
        return json({ ok: false, error: String(e?.message || e) });
      }
    }

    try {
      // One replace-section round (2 takes), with content-filter sanitize+retry.
      const sectionRound = async (): Promise<{ taskId: string; tracks: KieTrack[] }> => {
        let promptUsed = sectionPrompt;
        let lyricsUsed = lyricsForKie;
        try {
          const taskId = await submitReplaceSection({ taskId: kieTaskId, audioId, prompt: promptUsed, tags, title, infillStartS: start, infillEndS: end, fullLyrics: lyricsUsed, negativeTags, callbackUrl });
          return { taskId, tracks: await pollKieUntilDone(taskId) };
        } catch (e) {
          if (!isContentError(e)) throw e;
          const cs = await sanitizeLyricsForFilter(promptUsed);
          const cf = await sanitizeLyricsForFilter(lyricsUsed);
          if ((!cs || cs === promptUsed) && (!cf || cf === lyricsUsed)) throw e;
          console.log('[fix] SECTION content-filter retry with sanitized lyrics');
          promptUsed = (cs || promptUsed).substring(0, 800);
          lyricsUsed = englishifyLyricsMarkers(cf || lyricsUsed);
          const taskId = await submitReplaceSection({ taskId: kieTaskId, audioId, prompt: promptUsed, tags, title, infillStartS: start, infillEndS: end, fullLyrics: lyricsUsed, negativeTags, callbackUrl });
          return { taskId, tracks: await pollKieUntilDone(taskId) };
        }
      };

      // Best-of-N: verify each take, auto-pick the one that landed; 2nd round
      // only if the 1st didn't verify.
      const takes: Take[] = [];
      let lastTaskId = '';
      const maxRounds = phrasesToVerify.length ? 2 : 1;
      for (let round = 1; round <= maxRounds; round++) {
        const r = await sectionRound();
        lastTaskId = r.taskId;
        for (const t of r.tracks) { const a = await annotateTake(t, phrasesToVerify, fullLyrics); if (a) takes.push(a); }
        if (!phrasesToVerify.length || takes.some((t) => t.verified === true)) break;
      }
      if (!takes.length) {
        await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'section', complaint: complaint.slice(0, 2000), window_start: start, window_end: end, kie_task_id: lastTaskId, outcome: 'failed', detail: 'no audio returned' });
        return json({ ok: false, fixTaskId: lastTaskId, error: 'replace-section no devolvió audio' });
      }
      const ordered = orderTakesBest(takes);
      const best = ordered[0];
      const verifyNote = takeVerifyNote(best, true);
      await logAttempt(supabase, { song_id: songId, action: 'preview', mode: 'section', complaint: complaint.slice(0, 2000), window_start: start, window_end: end, kie_task_id: lastTaskId, kie_status: 'SUCCESS', fixed_audio_url: best.audioUrl, verified: best.verified, verify_note: verifyNote, outcome: 'success', detail: `${ordered.length} takes` });
      return json({
        ok: true,
        songId,
        changeSummary: fix.change_summary || '',
        window: { startS: start, endS: end },
        originalAudioUrl: pristineForSplice,
        fixedAudioUrl: best.audioUrl,
        fixTaskId: lastTaskId,
        fixAudioId: best.id,
        fixImageUrl: best.imageUrl,
        fullLyrics, // store the REAL corrected lyrics, not the filter-dodging paraphrase
        staleWarning: null,
        verified: best.verified,
        verifyNote,
        takes: ordered.map((t) => ({ audioUrl: t.audioUrl, id: t.id, imageUrl: t.imageUrl, verified: t.verified, lyrics: fullLyrics })),
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
