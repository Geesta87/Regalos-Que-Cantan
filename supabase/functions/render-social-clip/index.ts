// supabase/functions/render-social-clip/index.ts
// Renders a 60-second vertical (1080x1920) social media clip from a
// completed + paid song. Triggered from stripe-webhook (and verify-payment
// as fallback) the moment `songs.paid` flips to true. Songs are generated
// before payment (preview → pay flow), so by the time this fires the audio
// is expected to already be in Storage.
//
// No image assets required — the background is a genre-styled HTML gradient.
// Uses the existing Shotstack account + pattern from generate-video/index.ts.
// The async callback (Shotstack → us) is handled by social-clip-callback.
//
// Idempotency: the social_posts table has a UNIQUE index on song_id; if a
// row already exists for this song we short-circuit without a second render.
//
// Deploy with: supabase functions deploy render-social-clip

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHOTSTACK_API_KEY = Deno.env.get('SHOTSTACK_API_KEY')!;
const SHOTSTACK_API_URL = Deno.env.get('SHOTSTACK_API_URL') || 'https://api.shotstack.io/edit/stage';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const MONTSERRAT_FONT_URL =
  'https://fonts.gstatic.com/s/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Hw5aXo.woff2';

const CLIP_DURATION = 60; // seconds
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;

// ---------------------------------------------------------------------------
// Genre theme map. Keys are the genre ids used in src/config/genres.js.
// Unknown genres fall back to the default theme.
//
// `icon` values are stored as HTML numeric entities (e.g. &#x1F3A9;) rather
// than raw emoji characters — this matches the existing generate-video/
// pattern and avoids font/encoding issues in Shotstack's HTML renderer.
// `iconPlain` is the raw emoji for use in the social caption (plain text,
// not HTML-rendered).
// ---------------------------------------------------------------------------
interface GenreTheme {
  gradient: string;
  accent: string;
  icon: string;       // HTML entity — used inside Shotstack HTML asset
  iconPlain: string;  // Raw emoji — used in captions / plain text only
  label: string;
}

const GENRE_THEMES: Record<string, GenreTheme> = {
  corrido:      { gradient: 'linear-gradient(135deg, #3d2817 0%, #1a0e08 60%, #0a0503 100%)', accent: '#d4a574', icon: '&#x1F3A9;', iconPlain: '🎩', label: 'Corrido' },
  sierreno:     { gradient: 'linear-gradient(135deg, #3d2817 0%, #1a0e08 60%, #0a0503 100%)', accent: '#d4a574', icon: '&#x1F3B8;', iconPlain: '🎸', label: 'Sierreño' },
  norteno:      { gradient: 'linear-gradient(135deg, #2a3d17 0%, #1a2008 60%, #0a0f03 100%)', accent: '#c9b24a', icon: '&#x1F920;', iconPlain: '🤠', label: 'Norteño' },
  banda:        { gradient: 'linear-gradient(135deg, #3d2817 0%, #5c3a0f 60%, #1a0e08 100%)', accent: '#ffd23f', icon: '&#x1F3BA;', iconPlain: '🎺', label: 'Banda' },
  duranguense:  { gradient: 'linear-gradient(135deg, #3d2817 0%, #5c3a0f 60%, #1a0e08 100%)', accent: '#ffd23f', icon: '&#x1F3BA;', iconPlain: '🎺', label: 'Duranguense' },
  tejano:       { gradient: 'linear-gradient(135deg, #3d2817 0%, #5c3a0f 60%, #1a0e08 100%)', accent: '#ffd23f', icon: '&#x1F3BA;', iconPlain: '🎺', label: 'Tejano' },
  ranchera:     { gradient: 'linear-gradient(135deg, #8b1a1a 0%, #3d0a0a 60%, #0a0503 100%)', accent: '#ffd23f', icon: '&#x1F3BB;', iconPlain: '🎻', label: 'Ranchera' },
  mariachi:     { gradient: 'linear-gradient(135deg, #8b1a1a 0%, #3d0a0a 60%, #0a0503 100%)', accent: '#ffd23f', icon: '&#x1F3BB;', iconPlain: '🎻', label: 'Mariachi' },
  cumbia:       { gradient: 'linear-gradient(135deg, #ff6b35 0%, #c2693a 60%, #8b3a0a 100%)', accent: '#ffd23f', icon: '&#x1F389;', iconPlain: '🎉', label: 'Cumbia' },
  merengue:     { gradient: 'linear-gradient(135deg, #ff6b35 0%, #c2693a 60%, #8b3a0a 100%)', accent: '#ffd23f', icon: '&#x1F941;', iconPlain: '🥁', label: 'Merengue' },
  salsa:        { gradient: 'linear-gradient(135deg, #ff2e88 0%, #8b1a5c 60%, #1a0a14 100%)', accent: '#ffd23f', icon: '&#x1F483;', iconPlain: '💃', label: 'Salsa' },
  vallenato:    { gradient: 'linear-gradient(135deg, #ff6b35 0%, #c2693a 60%, #8b3a0a 100%)', accent: '#ffd23f', icon: '&#x1F389;', iconPlain: '🎉', label: 'Vallenato' },
  bachata:      { gradient: 'linear-gradient(135deg, #8b1a3c 0%, #3d0a17 60%, #0a0503 100%)', accent: '#ff6b8a', icon: '&#x1F339;', iconPlain: '🌹', label: 'Bachata' },
  bolero:       { gradient: 'linear-gradient(135deg, #8b1a3c 0%, #3d0a17 60%, #0a0503 100%)', accent: '#ff6b8a', icon: '&#x1F339;', iconPlain: '🌹', label: 'Bolero' },
  reggaeton:    { gradient: 'linear-gradient(135deg, #ff2e88 0%, #3d0a5c 60%, #0a0514 100%)', accent: '#00ffe0', icon: '&#x26A1;',  iconPlain: '⚡', label: 'Reggaetón' },
  latin_trap:   { gradient: 'linear-gradient(135deg, #2e0a5c 0%, #0a0514 60%, #000000 100%)', accent: '#00ffe0', icon: '&#x26A1;',  iconPlain: '⚡', label: 'Latin Trap' },
  balada:       { gradient: 'linear-gradient(135deg, #8b1a5c 0%, #3d0a3c 60%, #0a0514 100%)', accent: '#ff6b8a', icon: '&#x1F495;', iconPlain: '💕', label: 'Balada' },
  romantica:    { gradient: 'linear-gradient(135deg, #8b1a5c 0%, #3d0a3c 60%, #0a0514 100%)', accent: '#ff6b8a', icon: '&#x1F495;', iconPlain: '💕', label: 'Romántica' },
  pop_latino:   { gradient: 'linear-gradient(135deg, #ff6b35 0%, #ff2e88 60%, #3d0a5c 100%)', accent: '#ffd23f', icon: '&#x2B50;',  iconPlain: '⭐', label: 'Pop Latino' },
  rock_espanol: { gradient: 'linear-gradient(135deg, #1a0e08 0%, #0a0503 60%, #000000 100%)', accent: '#ff2e88', icon: '&#x1F3B8;', iconPlain: '🎸', label: 'Rock' },
  vals:         { gradient: 'linear-gradient(135deg, #1a2e5c 0%, #0a1740 60%, #05081a 100%)', accent: '#c0c0c0', icon: '&#x1F48D;', iconPlain: '💍', label: 'Vals' },
  grupera:      { gradient: 'linear-gradient(135deg, #8b1a3c 0%, #3d2817 60%, #1a0e08 100%)', accent: '#ffd23f', icon: '&#x1F3B6;', iconPlain: '🎶', label: 'Grupera' },
};

const DEFAULT_THEME: GenreTheme = {
  gradient: 'linear-gradient(135deg, #2a1408 0%, #1a0e08 60%, #0a0503 100%)',
  accent: '#ff6b35',
  icon: '&#x1F3B5;',
  iconPlain: '🎵',
  label: 'Canción',
};

function getGenreTheme(genre: string | null | undefined): GenreTheme {
  if (!genre) return DEFAULT_THEME;
  const key = genre.toLowerCase().trim().replace(/[\s-]/g, '_');
  return GENRE_THEMES[key] || {
    ...DEFAULT_THEME,
    label: genre.charAt(0).toUpperCase() + genre.slice(1).toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// Caption generator. Spanish, genre-aware, includes recipient name.
// ---------------------------------------------------------------------------
function buildCaption(song: {
  recipient_name: string | null;
  genre: string | null;
  occasion: string | null;
  relationship: string | null;
}): string {
  const theme = getGenreTheme(song.genre);
  const recipient = song.recipient_name || 'alguien especial';
  const occasion = song.occasion || 'un momento especial';
  const relationship = song.relationship ? ` (${song.relationship})` : '';
  const hashtagGenre = theme.label
    .replace(/\s/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return `${theme.iconPlain} Un ${theme.label.toLowerCase()} hecho especialmente para ${recipient}${relationship} — ${occasion} 🎁

¿Quieres el tuyo? → regalosquecantan.com

#RegalosQueCantan #${hashtagGenre}Personalizado #CancionPersonalizada #RegaloUnico`;
}

// ---------------------------------------------------------------------------
// Shared constants for every HTML clip.
// Shotstack's HTML renderer captures a single static frame per clip — CSS
// keyframe animations do NOT animate. Motion comes from Shotstack's clip
// `effect` (zoomIn, slideLeft, etc.) and `transition` (fade, slide) fields.
// ---------------------------------------------------------------------------
const FONT_FACE =
  `@font-face { font-family: 'Montserrat'; src: url('${MONTSERRAT_FONT_URL}') format('woff2'); }`;

// Explicit fallback stack. If Montserrat fails to load in Shotstack's render
// window the fallbacks have predictable metrics; using a bare `sans-serif`
// can switch to a serif fallback in some headless browser builds, throwing
// off width calculations and breaking text wrapping.
const FONT_STACK = `'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif`;

const BASE_CSS =
  `${FONT_FACE}
  html, body { margin: 0; padding: 0; font-family: ${FONT_STACK}; }
  * { box-sizing: border-box; }`;

// ---------------------------------------------------------------------------
// Lyric parser. Strips section markers like [Verso 1], [Coro], drops empty
// lines and fragments. Returns up to maxLines "meaningful" lines in order.
// ---------------------------------------------------------------------------
function parseLyrics(raw: string | null | undefined, maxLines = 5): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^\[[^\]]+\]$/.test(l))   // strip [Verso], [Coro], etc.
    .filter((l) => l.length >= 15 && l.length <= 120)
    .slice(0, maxLines);
}

// ---------------------------------------------------------------------------
// Split a lyric line into chunks that fit on a single rendered line.
// Shotstack's HTML renderer has a bug where wrapped text collapses onto
// the same Y position instead of stacking — so we avoid wrapping entirely
// by pre-splitting at word boundaries and rendering each chunk as its own
// single-line clip with `white-space: nowrap`.
// ---------------------------------------------------------------------------
function splitLyricIntoChunks(line: string, maxCharsPerChunk = 22): string[] {
  if (line.length <= maxCharsPerChunk) return [line];
  const words = line.split(/\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    // Single word longer than the limit — emit it alone; the font sizer
    // will shrink it to fit.
    if (word.length > maxCharsPerChunk) {
      if (current) { chunks.push(current); current = ''; }
      chunks.push(word);
      continue;
    }
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerChunk) {
      current += ' ' + word;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Whisper API integration for lyric-to-audio timing alignment.
//
// Strategy: send the song audio to OpenAI Whisper, get word-level timestamps
// back, then match our known lyric chunks against Whisper's word sequence
// (fuzzy match — Whisper mishears Spanish names like "Guillermina" →
// "Guillerma"). Use Whisper's timestamps for start/end of each chunk.
//
// Cost: ~$0.006/minute of audio. Cached in songs.lyrics_timestamps so it's
// a one-time cost per song regardless of how many times we re-render.
// ---------------------------------------------------------------------------

type WhisperWord = { word: string; start: number; end: number };
type WhisperResult = { words: WhisperWord[]; duration: number; language: string };
type TimedChunk = { text: string; start: number; end: number };

async function transcribeAudio(audioUrl: string): Promise<WhisperResult | null> {
  if (!OPENAI_API_KEY) {
    console.warn('[whisper] OPENAI_API_KEY not set — skipping transcription');
    return null;
  }

  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      throw new Error(`audio fetch failed: ${audioRes.status}`);
    }
    const audioBlob = await audioRes.blob();
    console.log(`[whisper] audio fetched: ${audioBlob.size} bytes`);

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
      const errText = await resp.text();
      console.error(`[whisper] API error ${resp.status}: ${errText.substring(0, 400)}`);
      return null;
    }

    const data = await resp.json();
    const words = (data.words || [])
      .map((w: any) => ({
        word: String(w.word || ''),
        start: Number(w.start),
        end: Number(w.end),
      }))
      .filter((w: WhisperWord) => w.word && !Number.isNaN(w.start) && !Number.isNaN(w.end));

    console.log(`[whisper] transcribed ${words.length} words over ${data.duration}s`);

    return {
      words,
      duration: Number(data.duration) || 0,
      language: String(data.language || 'spanish'),
    };
  } catch (e: any) {
    console.error('[whisper] error:', e.message);
    return null;
  }
}

function normalizeForMatch(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function fuzzyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;   // too short to fuzzy-match safely
  if (Math.abs(a.length - b.length) > 3) return false;
  const tolerance = Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.3));
  return levenshtein(a, b) <= tolerance;
}

// Build timed chunks directly from Whisper's word-level transcription.
//
// This replaces the older alignChunksToWhisper() approach (which tried to
// fuzzy-match our stored lyric text against Whisper's transcription). The
// old approach failed when the AI-sung version diverged from the lyric
// sheet — e.g. the Guillermina song lyric sheet said "Por ti conocí" but
// Mureka actually sang "Hoy sí conocí", so the alignment dropped the
// entire chunk and left a silent gap in the clip.
//
// Using Whisper's transcription directly solves this: what Whisper hears
// IS what's being sung, so timestamps and text always match. The trade-off
// is we show what was sung, not what the sheet says — which is the more
// accurate behavior for a lyric video.
//
// Chunks are grouped by (a) long pauses between words, and (b) a max
// character length so each chunk fits on one line without wrapping.
function buildTimedChunksFromWhisper(
  words: WhisperWord[],
  audioTrim: number,
  windowStart: number,
  windowEnd: number,
  maxCharsPerChunk: number,
  pauseThresholdSec: number,
  maxChunks: number,
): TimedChunk[] {
  const out: TimedChunk[] = [];
  let current: { text: string; start: number; end: number } | null = null;

  for (const w of words) {
    const start = w.start - audioTrim;
    const end = w.end - audioTrim;
    if (start < windowStart || start >= windowEnd) continue;

    const word = w.word.trim();
    if (word.length < 1) continue;

    if (current === null) {
      current = { text: word, start, end };
      continue;
    }

    const gap = start - current.end;
    const proposed = (current.text + ' ' + word).trim();
    const shouldBreak = gap > pauseThresholdSec || proposed.length > maxCharsPerChunk;

    if (shouldBreak) {
      out.push(current);
      if (out.length >= maxChunks) { current = null; break; }
      current = { text: word, start, end };
    } else {
      current.text = proposed;
      current.end = end;
    }
  }
  if (current !== null && out.length < maxChunks) out.push(current);

  // Minimum per-chunk display time for readability
  for (let i = 0; i < out.length; i++) {
    if (out[i].end - out[i].start < 0.8) {
      out[i].end = Math.min(windowEnd, out[i].start + 0.8);
    }
  }
  return out;
}

// Align our pre-chunked lyrics to Whisper's word timeline.
// Greedy: scan Whisper words left-to-right, find start position for each chunk
// by matching the chunk's first token, then scan for the chunk's last token
// within a small forward window to get the end timestamp.
function alignChunksToWhisper(chunks: string[], words: WhisperWord[]): TimedChunk[] {
  if (chunks.length === 0 || words.length === 0) return [];

  const normW = words.map((w) => ({ ...w, norm: normalizeForMatch(w.word) }));
  const result: TimedChunk[] = [];
  let cursor = 0;

  for (const chunk of chunks) {
    const tokens = chunk.split(/\s+/).map(normalizeForMatch).filter((t) => t.length > 0);
    if (tokens.length === 0) continue;

    // Find a Whisper word matching ANY of the first two chunk tokens, starting from cursor.
    let firstIdx = -1;
    const candidates = tokens.slice(0, 2);
    for (let i = cursor; i < normW.length; i++) {
      if (candidates.some((t) => fuzzyMatch(normW[i].norm, t))) {
        firstIdx = i;
        break;
      }
    }
    if (firstIdx < 0) continue; // skip this chunk; post-processing will fill gaps

    // Scan forward for last token within a window proportional to token count.
    const lastToken = tokens[tokens.length - 1];
    const scanEnd = Math.min(firstIdx + tokens.length * 2 + 2, normW.length);
    let lastIdx = firstIdx;
    for (let i = firstIdx; i < scanEnd; i++) {
      if (fuzzyMatch(normW[i].norm, lastToken)) lastIdx = i;
    }

    result.push({
      text: chunk,
      start: normW[firstIdx].start,
      end: normW[lastIdx].end,
    });
    cursor = lastIdx + 1;
  }

  // Post-process: enforce minimum visible duration + prevent overlap with next chunk.
  for (let i = 0; i < result.length; i++) {
    const curr = result[i];
    const next = result[i + 1];
    if (next && curr.end > next.start - 0.15) {
      curr.end = Math.max(curr.start + 0.8, next.start - 0.15);
    }
    if (curr.end - curr.start < 1.0) {
      curr.end = curr.start + 1.0;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Clip builders — each returns a Shotstack clip object.
// ---------------------------------------------------------------------------

// Intro hook variations — one of these is picked deterministically per song
// based on the song ID hash. Re-rendering the same song always produces the
// same hook (consistency); different songs naturally pick different hooks
// (variety across the feed). Add or remove options here to tune the pool.
const HOOK_OPTIONS: Array<{ line1: string; line2: string }> = [
  { line1: 'Una canción hecha a mano', line2: 'para alguien muy especial...' },
  { line1: 'Una canción única...',      line2: 'hecha con el alma' },
  { line1: 'Alguien muy especial...',   line2: 'merece esto' },
  { line1: 'Hay regalos que se olvidan...', line2: 'este NO' },
  { line1: 'Melodías que emocionan...', line2: 'letras que conectan' },
  { line1: 'El regalo más emocional...', line2: 'que recibirá este año' },
  { line1: 'Para quien te hace sonreír...', line2: 'esta canción es tuya' },
  { line1: 'Cuando escuche esto...',    line2: 'no lo va a creer' },
];

// Simple string hash → stable non-negative integer. Used to deterministically
// pick a hook variation based on the song's UUID so re-renders stay consistent.
function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickHookForSong(songId: string): { line1: string; line2: string } {
  const idx = hashStringToInt(songId) % HOOK_OPTIONS.length;
  return HOOK_OPTIONS[idx];
}

function buildHookClip(start: number, length: number, theme: GenreTheme, hook: { line1: string; line2: string }) {
  const css = `${BASE_CSS}
    .scene { width: ${OUTPUT_WIDTH}px; height: ${OUTPUT_HEIGHT}px; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #ffffff; text-align: center; padding: 0 80px; }
    .label { color: ${theme.accent}; font-size: 46px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; margin-bottom: 36px; text-shadow: 0 2px 24px rgba(0,0,0,0.9); line-height: 1.2; }
    .sub { color: #ffffff; font-size: 64px; font-weight: 300; font-style: italic; opacity: 0.95; text-shadow: 0 2px 24px rgba(0,0,0,0.9); line-height: 1.3; }`;
  const html = `
    <div class="scene">
      <div class="label">${escapeHtml(hook.line1)}</div>
      <div class="sub">${escapeHtml(hook.line2)}</div>
    </div>`;
  return {
    asset: { type: 'html', html, css, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    start, length,
    // In-fade only — using out-fade on sequential same-track clips causes
    // the outgoing and incoming text to be simultaneously visible during
    // the crossfade window (compounded by heavy text-shadow). Cutting the
    // outgoing clip and letting the next one fade in from black avoids
    // the overlap entirely.
    transition: { in: 'fade' },
  };
}

function buildRevealClip(start: number, length: number, firstName: string, theme: GenreTheme) {
  const css = `${BASE_CSS}
    .scene { width: ${OUTPUT_WIDTH}px; height: ${OUTPUT_HEIGHT}px; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #ffffff; text-align: center; padding: 0 60px; }
    .badge { color: ${theme.accent}; font-size: 38px; font-weight: 700; letter-spacing: 8px; margin-bottom: 40px; text-shadow: 0 2px 20px rgba(0,0,0,0.9); }
    .para { color: #ffffff; font-size: 54px; font-weight: 300; margin-bottom: 16px; opacity: 0.9; text-shadow: 0 2px 20px rgba(0,0,0,0.9); }
    .name { color: #ffffff; font-size: 140px; font-weight: 800; line-height: 1.05; text-shadow: 0 4px 32px rgba(0,0,0,0.95); word-break: break-word; }`;
  const html = `
    <div class="scene">
      <div class="badge">${theme.icon} ${theme.label.toUpperCase()}</div>
      <div class="para">Para</div>
      <div class="name">${escapeHtml(firstName)}</div>
    </div>`;
  return {
    asset: { type: 'html', html, css, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    start, length,
    effect: 'zoomIn',  // name "grows" into the reveal — no transition: hard cut
  };
}

function buildLyricClip(start: number, length: number, line: string) {
  // Font size is picked to keep the chunk on ONE LINE at ~880px available
  // width. Assumes avg char width ≈ 0.55 × font-size for Montserrat bold.
  // white-space: nowrap is the safety net — if a chunk is longer than
  // expected, it gets clipped at the scene edge rather than wrapping onto
  // a second line (which triggers Shotstack's overlap bug).
  const len = line.length;
  const fontSize =
    len > 22 ? 52 :
    len > 18 ? 62 :
    len > 14 ? 72 :
    82;

  const css = `${BASE_CSS}
    .scene { width: ${OUTPUT_WIDTH}px; height: ${OUTPUT_HEIGHT}px; position: relative; overflow: hidden; }
    .lyric-wrap { position: absolute; top: 50%; left: 0; right: 0; transform: translateY(-50%); text-align: center; padding: 0 40px; }
    .lyric { margin: 0; color: #ffffff; font-family: ${FONT_STACK}; font-size: ${fontSize}px; font-weight: 700; line-height: 1.2; text-shadow: 0 4px 28px rgba(0,0,0,0.95); letter-spacing: -0.5px; white-space: nowrap; overflow: hidden; text-overflow: clip; }`;
  const html = `
    <div class="scene">
      <div class="lyric-wrap">
        <p class="lyric">${escapeHtml(line)}</p>
      </div>
    </div>`;
  return {
    asset: { type: 'html', html, css, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    start, length,
  };
}

function buildEndCardClip(start: number, length: number, theme: GenreTheme) {
  const qrUrl =
    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` +
    `${encodeURIComponent('https://regalosquecantan.com')}&margin=2&color=1a0e08&bgcolor=ffffff`;
  const css = `${BASE_CSS}
    .scene { width: ${OUTPUT_WIDTH}px; height: ${OUTPUT_HEIGHT}px; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #ffffff; text-align: center; padding: 0 60px; }
    .headline { color: ${theme.accent}; font-size: 54px; font-weight: 800; letter-spacing: 10px; margin-bottom: 24px; text-shadow: 0 2px 24px rgba(0,0,0,0.95); }
    .url { color: #ffffff; font-size: 68px; font-weight: 800; margin-bottom: 44px; text-shadow: 0 2px 28px rgba(0,0,0,0.95); }
    .qr { background: #ffffff; padding: 18px; border-radius: 24px; margin-bottom: 40px; width: 260px; height: 260px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
    .price { color: #ffffff; font-size: 44px; font-weight: 700; margin-bottom: 20px; opacity: 0.95; text-shadow: 0 2px 20px rgba(0,0,0,0.95); }
    .sub { color: #ffffff; font-size: 32px; font-weight: 300; font-style: italic; opacity: 0.85; text-shadow: 0 2px 16px rgba(0,0,0,0.95); padding: 0 40px; line-height: 1.3; }`;
  const html = `
    <div class="scene">
      <div class="headline">HAZ LA TUYA</div>
      <div class="url">regalosquecantan.com</div>
      <img class="qr" src="${qrUrl}" />
      <div class="price">Desde $29.99 USD</div>
      <div class="sub">Listo en 3 minutos</div>
    </div>`;
  return {
    asset: { type: 'html', html, css, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    start, length,
    effect: 'zoomIn', // hard cut from last lyric, then zoomIn for emphasis
  };
}

// Genre-branded thumbnail used as the FULL VIDEO BACKGROUND. Replaces the
// per-song Mureka cover art — same image is used for both the GHL feed
// thumbnail and the video background, giving a consistent brand look across
// every post for the same genre. Stored at:
//   {SUPABASE_URL}/storage/v1/object/public/video-photos/thumbnails/{genre}.png
// Native Shotstack image asset (NOT HTML <img>) per the documented constraint
// elsewhere in this file. `fit: 'crop'` fills the 1080x1920 canvas regardless
// of the source image aspect ratio. `effect: 'zoomIn'` gives the same slow
// Ken Burns motion as the previous Mureka cover background.
const THUMBNAIL_BASE_URL =
  `${SUPABASE_URL}/storage/v1/object/public/video-photos/thumbnails`;

function thumbnailUrlForGenre(genre: string | null | undefined): string | null {
  if (!genre) return null;
  const key = genre.toLowerCase().trim().replace(/[\s-]/g, '_');
  // Mirror the GENRE_THEMES key set — only return a URL for genres we
  // actually have thumbnails for. Anything else falls back to the gradient.
  if (!(key in GENRE_THEMES)) return null;
  return `${THUMBNAIL_BASE_URL}/${key}.png`;
}

function buildThumbnailBackgroundClip(thumbnailUrl: string) {
  return {
    asset: {
      type: 'image',
      src: thumbnailUrl,
    },
    start: 0,
    length: CLIP_DURATION,
    fit: 'crop',
    effect: 'zoomIn',
  };
}

// Dark gradient overlay rendered on top of the cover art to keep lyric
// text legible. Pure CSS, no images — no risk of loading failures.
function buildDarkScrimClip() {
  const css = `${BASE_CSS}
    .scrim { width: ${OUTPUT_WIDTH}px; height: ${OUTPUT_HEIGHT}px; background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 28%, rgba(0,0,0,0.28) 65%, rgba(0,0,0,0.78) 100%); }`;
  const html = `<div class="scrim"></div>`;
  return {
    asset: { type: 'html', html, css, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    start: 0,
    length: CLIP_DURATION,
  };
}

// Brand watermark — logo pinned to the top-right, visible the whole clip.
//
// IMPORTANT: Shotstack's HTML renderer does NOT load external <img> tags
// reliably. The existing working generate-video function uses
// `type: 'image'` for every image — never <img> inside HTML. Attempts to
// render the logo as HTML+<img> all produced invisible watermarks because
// Shotstack renders the HTML without the image. So we use Shotstack's
// native image asset here.
//
// The source PNG (120x120 RGBA) already has transparent corners around
// its circular design, so no border-radius is needed — the image renders
// as a visual circle because of the alpha channel.
//
// Positioning: offset-only. `position: 'topRight'` rendered the logo in
// the upper-center in a previous attempt. Explicit offset is more
// predictable. Shotstack convention:
//   offset.x ∈ [-1, 1], +1 = right edge of canvas
//   offset.y ∈ [-1, 1], +1 = top edge of canvas (Y is inverted from screen)
const WATERMARK_LOGO_URL =
  `${SUPABASE_URL}/storage/v1/object/public/video-photos/assets/logo.png`;

function buildWatermarkClip() {
  return {
    asset: {
      type: 'image',
      src: WATERMARK_LOGO_URL,
    },
    start: 0,
    length: CLIP_DURATION,
    // Top-right corner placement. `fit: 'contain'` is REQUIRED — without it
    // the image asset doesn't render (confirmed by the diagnostic — same
    // config without fit was invisible, with fit it worked). Offset values
    // here are tuned for visibility in the upper-right area regardless of
    // Shotstack's internal scaling convention.
    offset: { x: 0.4, y: 0.42 },
    scale: 0.16,
    fit: 'contain',
    opacity: 0.92,
  };
}

function buildGradientBackgroundClip(theme: GenreTheme) {
  const css = `${BASE_CSS}
    .bg { width: ${OUTPUT_WIDTH}px; height: ${OUTPUT_HEIGHT}px; background: ${theme.gradient}; }`;
  const html = `<div class="bg"></div>`;
  return {
    asset: { type: 'html', html, css, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    start: 0,
    length: CLIP_DURATION,
    effect: 'zoomIn',
  };
}

// ---------------------------------------------------------------------------
// Shotstack timeline builder — 60s multi-scene vertical clip.
//   0-3s   Hook text ("Una canción hecha a mano...")
//   3-7s   Name reveal (big name + genre badge, zoomIn effect)
//   7-52s  Lyric cards (5 lines × 9s, fading between)
//   52-60s End card (URL, QR code, price, CTA)
//   Background (0-60s): genre-branded thumbnail (same image used on the GHL
//                       feed post) with Ken Burns motion, or CSS gradient
//                       fallback for unknown genres.
//   Audio (0-60s): first 60s of song with fadeOut.
// ---------------------------------------------------------------------------
function buildShotstackTimeline(
  song: {
    id: string;
    audio_url: string;
    recipient_name: string | null;
    genre: string | null;
    lyrics: string | null;
    mureka_payload: string | null;
  },
  whisper: WhisperResult | null,
): any {
  const theme = getGenreTheme(song.genre);
  // Background source order:
  //   1. Genre-branded thumbnail (video-photos/thumbnails/{genre}.png) — the
  //      same image used as the GHL feed thumbnail. Consistent brand look.
  //   2. CSS gradient fallback when the genre is unknown.
  // Mureka cover art is no longer used for the social clip background — the
  // genre thumbnail makes both posts (feed + video) feel like one cohesive
  // creative.
  const thumbnailUrl = thumbnailUrlForGenre(song.genre);
  const lyricLines = parseLyrics(song.lyrics, 5);

  const recipientFirstName =
    (song.recipient_name || '').split(' ')[0] || song.recipient_name || 'ti';

  // Pick a hook variation deterministically from the song ID. Same song
  // always gets the same hook; different songs get variety across the feed.
  const hook = pickHookForSong(song.id);

  // Scene timings (seconds). The hook + reveal occupy the intro. Lyrics get
  // aligned to actual vocal timing via Whisper when available, otherwise
  // evenly distributed in [LYRICS_START, LYRICS_END].
  const GAP = 0.8;
  const HOOK_START = 0, HOOK_LEN = 3;                 // visible 0–3
  const REVEAL_START = 3.5, REVEAL_LEN = 5;           // visible 3.5–8.5
  const LYRICS_START = 10, LYRICS_END = 50;
  const END_START = 50, END_LEN = 10;                 // visible 50–60
  const LYRIC_WINDOW = LYRICS_END - LYRICS_START;     // 40s

  // Compute timed chunks. Preferred path: use Whisper's transcription directly.
  // Fallback: split our stored lyrics and distribute evenly in the window.
  let timedChunks: TimedChunk[] = [];
  let audioTrim = 0;

  if (whisper && whisper.words.length > 0) {
    // Audio-trim: skip instrumental intro so vocals land at ~LYRICS_START.
    const vocalStart = whisper.words[0].start;
    const songDurationSec = whisper.duration || 0;
    const maxTrim = Math.max(0, songDurationSec - CLIP_DURATION);
    audioTrim = Math.min(Math.max(0, vocalStart - LYRICS_START), maxTrim);

    // Build chunks directly from what Whisper heard — no alignment needed.
    const maxChunkEnd = END_START - 0.3;
    timedChunks = buildTimedChunksFromWhisper(
      whisper.words,
      audioTrim,
      LYRICS_START,
      maxChunkEnd,
      22,   // max chars per chunk (one line of display)
      1.0,  // pause threshold (sec between words to start new chunk)
      16,   // max total chunks
    );

    console.log(
      `[timing] Whisper-direct chunks: ${timedChunks.length}; audioTrim=${audioTrim.toFixed(1)}s (vocal at song ${vocalStart.toFixed(1)}s)`,
    );
  }

  // Fallback when Whisper is unavailable — split stored lyrics, distribute evenly.
  if (timedChunks.length === 0) {
    console.log('[timing] Whisper unavailable — falling back to even distribution of stored lyrics');
    const allChunks: string[] = [];
    for (const line of lyricLines) {
      for (const chunk of splitLyricIntoChunks(line, 22)) {
        allChunks.push(chunk);
      }
    }
    const maxChunks = Math.floor(LYRIC_WINDOW / (2.5 + GAP));
    const chunks = allChunks.slice(0, maxChunks);
    if (chunks.length > 0) {
      const slot = LYRIC_WINDOW / chunks.length;
      const len = Math.max(1.8, slot - GAP);
      timedChunks = chunks.map((chunk, i) => ({
        text: chunk,
        start: LYRICS_START + i * slot,
        end: LYRICS_START + i * slot + len,
      }));
    }
  }

  // ---- Text track (sequential scenes with gaps) ----
  const textClips: any[] = [
    buildHookClip(HOOK_START, HOOK_LEN, theme, hook),
    buildRevealClip(REVEAL_START, REVEAL_LEN, recipientFirstName, theme),
  ];

  if (timedChunks.length > 0) {
    for (const tc of timedChunks) {
      textClips.push(buildLyricClip(tc.start, tc.end - tc.start, tc.text));
    }
  } else {
    // No lyrics at all — hold a single editorial line through the window.
    textClips.push(
      buildLyricClip(LYRICS_START, LYRIC_WINDOW - GAP,
        `Para ${recipientFirstName}`),
    );
  }

  textClips.push(buildEndCardClip(END_START, END_LEN, theme));

  // ---- Background track (full 60s) ----
  const backgroundClip = thumbnailUrl
    ? buildThumbnailBackgroundClip(thumbnailUrl)
    : buildGradientBackgroundClip(theme);

  // ---- Audio track ----
  // `trim` skips the song's instrumental intro when Whisper told us vocals
  // enter later than LYRICS_START. Short-intro songs get trim=0 and play
  // from the top.
  const audioClip = {
    asset: {
      type: 'audio',
      src: song.audio_url,
      trim: audioTrim,
      volume: 1,
      effect: 'fadeOut',
    },
    start: 0,
    length: CLIP_DURATION,
  };

  return {
    timeline: {
      background: '#000000',
      // Track order: Shotstack draws tracks[0] ON TOP of the stack. The
      // order here (top → bottom):
      //   watermark → text → dark scrim → cover art → audio
      // The scrim sits between the text and the cover to darken the cover
      // art for legibility without dimming the text itself.
      tracks: [
        { clips: [buildWatermarkClip()] },   // TOP: brand watermark
        { clips: textClips },                // text scenes (hook → reveal → lyrics → end)
        { clips: [buildDarkScrimClip()] },   // dark gradient over cover for text legibility
        { clips: [backgroundClip] },         // cover art (or gradient fallback)
        { clips: [audioClip] },              // audio
      ],
    },
    output: {
      format: 'mp4',
      resolution: '1080', // 1080x1920 for 9:16 — native TikTok/Reels/Shorts
      aspectRatio: '9:16',
      fps: 30,
    },
    callback: `${SUPABASE_URL}/functions/v1/social-clip-callback`,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Main handler — accepts { songId } and kicks off a Shotstack render.
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Global pause switch. Set the Supabase secret
    //   SOCIAL_CLIPS_ENABLED=false
    // to halt ALL video rendering + Whisper calls for new songs. Any value
    // other than the literal string "false" keeps the pipeline running.
    // Flip back on with: SOCIAL_CLIPS_ENABLED=true
    const enabled = Deno.env.get('SOCIAL_CLIPS_ENABLED') !== 'false';
    if (!enabled) {
      console.log('[render-social-clip] SOCIAL_CLIPS_ENABLED=false — pipeline paused, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'pipeline_paused' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    const { songId } = await req.json();
    if (!songId) throw new Error('Missing songId');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Idempotency: skip if a social clip already exists for this song.
    const { data: existing } = await supabase
      .from('social_posts')
      .select('id, video_status')
      .eq('song_id', songId)
      .maybeSingle();

    if (existing) {
      console.log(
        `[render-social-clip] song ${songId} already has social_post (video_status=${existing.video_status}), skipping`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'already_exists', video_status: existing.video_status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    // Load song details. Guard against unpaid / still-processing songs.
    // `lyrics` powers the lyric cards; the background imagery is the
    // genre-branded thumbnail looked up from song.genre.
    // `lyrics_timestamps` caches Whisper alignment.
    const { data: song, error: songError } = await supabase
      .from('songs')
      .select('id, audio_url, recipient_name, sender_name, genre, occasion, relationship, lyrics, mureka_payload, lyrics_timestamps, paid, status')
      .eq('id', songId)
      .single();

    if (songError || !song) {
      throw new Error(`Song not found: ${songError?.message || 'no row'}`);
    }
    // Guard: only paid + fully-generated songs render. Return 200 with
    // `skipped: true` rather than throwing, because these are expected
    // transient states when the trigger fires slightly out of order
    // (e.g. a paid-before-generation race). The caller does not retry.
    if (!song.paid) {
      console.log(`[render-social-clip] song ${songId} not paid, skipping`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'not_paid' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }
    if (song.status !== 'completed') {
      console.log(`[render-social-clip] song ${songId} status=${song.status}, skipping`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'not_completed', status: song.status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }
    if (!song.audio_url) {
      console.log(`[render-social-clip] song ${songId} has no audio_url, skipping`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_audio_url' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    // ---- Whisper: get (or reuse cached) word-level timestamps ----
    let whisperResult: WhisperResult | null = null;
    const cached = song.lyrics_timestamps as WhisperResult | null;
    if (cached && Array.isArray(cached.words) && cached.words.length > 0) {
      whisperResult = cached;
      console.log(`[whisper] using cached timestamps (${cached.words.length} words)`);
    } else if (OPENAI_API_KEY) {
      console.log(`[whisper] no cache — transcribing ${song.audio_url}`);
      whisperResult = await transcribeAudio(song.audio_url);
      if (whisperResult && whisperResult.words.length > 0) {
        const { error: cacheErr } = await supabase
          .from('songs')
          .update({ lyrics_timestamps: whisperResult })
          .eq('id', song.id);
        if (cacheErr) {
          console.warn(`[whisper] cache write failed: ${cacheErr.message}`);
        } else {
          console.log('[whisper] cached for future renders');
        }
      }
    } else {
      console.warn('[whisper] skipping — OPENAI_API_KEY not configured');
    }

    const timeline = buildShotstackTimeline(song, whisperResult);
    const caption = buildCaption(song);

    console.log(
      `[render-social-clip] submitting Shotstack render for song ${songId} (genre=${song.genre})`,
    );

    const renderResponse = await fetch(`${SHOTSTACK_API_URL}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': SHOTSTACK_API_KEY,
      },
      body: JSON.stringify(timeline),
    });

    if (!renderResponse.ok) {
      const errorText = await renderResponse.text();
      console.error('[render-social-clip] Shotstack error:', errorText);
      throw new Error(`Shotstack render failed: ${renderResponse.status}`);
    }

    const renderData = await renderResponse.json();
    const renderId = renderData.response?.id;
    if (!renderId) throw new Error('No render ID returned from Shotstack');

    // Insert social_posts row. The unique index on song_id protects against
    // races if two callers fired simultaneously — one insert wins, the other
    // silently fails and we log it as a warning.
    //
    // Schema note: the existing social_posts table has extra columns for the
    // future GHL posting phase (ghl_post_id, post_status, {platform}_status,
    // retry_count). We only populate the render-phase columns here; the GHL
    // phase will populate the rest later.
    const { error: insertError } = await supabase
      .from('social_posts')
      .insert({
        song_id: songId,
        shotstack_render_id: renderId,
        caption,
        video_status: 'rendering',
      });

    if (insertError) {
      console.warn(
        `[render-social-clip] insert social_posts failed for ${songId} (likely race): ${insertError.message}`,
      );
    }

    console.log(
      `[render-social-clip] queued: renderId=${renderId}, song=${songId}`,
    );

    return new Response(
      JSON.stringify({ success: true, songId, renderId, status: 'rendering' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error: any) {
    console.error('[render-social-clip] error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
