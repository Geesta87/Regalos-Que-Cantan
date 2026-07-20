// video-renderer/clip.js
// Clip Studio jobs for the in-house renderer (Phase 1: auto-captions).
//
//   prepareClipSource(job, opts) — download the uploaded video, probe its
//     duration, extract a small mono MP3 for Whisper (the OpenAI API caps
//     uploads at 25MB, so the edge function can't send the raw video).
//
//   renderClip(job, opts) — cut a [start,end] range out of the source, crop to
//     the requested aspect, burn animated word-by-word ASS captions, and hand
//     back the finished MP4 for upload.
//
// Caption timing comes from Whisper word timestamps (absolute in the source);
// this module filters them to the clip range and re-bases them to 0.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

function ff(dir, args) {
  return execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd: dir });
}

// Stream straight to disk — buffering a multi-GB source through arrayBuffer +
// Buffer.from would transiently double it in RAM and OOM the instance.
async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} for ${url.slice(0, 120)}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

function probeDuration(dir, file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { cwd: dir },
  ).toString().trim();
  const d = parseFloat(out);
  if (!d || Number.isNaN(d)) throw new Error(`ffprobe could not read duration (${out})`);
  return d;
}

// ---------------------------------------------------------------------------
// prepare: video -> duration + small mono MP3 for Whisper
// ---------------------------------------------------------------------------
async function prepareClipSource(job, { dir, log }) {
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'source.mp4');
  log(`downloading source ${job.source_url.slice(0, 100)}`);
  await download(job.source_url, src);

  const durationSec = probeDuration(dir, 'source.mp4');
  log(`duration ${durationSec.toFixed(1)}s — extracting audio`);

  // 48kbps mono mp3 ≈ 0.36MB/min -> a 60-min video stays under Whisper's 25MB cap.
  const audioPath = path.join(dir, 'audio.mp3');
  ff(dir, ['-i', 'source.mp4', '-vn', '-ac', '1', '-ar', '22050', '-b:a', '48k', 'audio.mp3']);

  return { audioPath, durationSec };
}

// ---------------------------------------------------------------------------
// ASS caption generation
// ---------------------------------------------------------------------------

// Output geometry per aspect ratio. MarginV keeps captions above the
// TikTok/Reels UI band on vertical, comfortable on the others.
const ASPECTS = {
  '9:16': { w: 1080, h: 1920, fontsize: 82, marginV: 460 },
  '1:1':  { w: 1080, h: 1080, fontsize: 68, marginV: 140 },
  '16:9': { w: 1920, h: 1080, fontsize: 63, marginV: 110 },
};

// ASS colors are &HAABBGGRR (alpha, blue, green, red).
const WHITE = '&H00FFFFFF';
const YELLOW = '&H0000D4FF';  // #FFD400
const GOLD = '&H000AB7F5';    // #F5B70A — matches the corrido ad gold
const PINK = '&H007C00E4';    // #E4007C — the brand badge pink
const BOX_BLACK = '&H66000000'; // ~60%-opaque black for the clean box style

// Caption styles. wordsPerGroup controls the caption chunk size; highlight
// paints the word being spoken; upper = shout-case like the viral templates;
// pop = the active word lands with a quick scale-settle animation; scale
// shrinks the whole caption track (minimal style).
const RED = '&H001E1EC4';     // #C41E1E — corrido red
const ORANGE = '&H00105DE8';  // #E85D10 — energia orange
const WARM = '&H0027B4F0';    // #F0B427 — brasa warm gold
const CYAN = '&H00FFE500';    // #00E5FF — neon cyan
const TEAL = '&H00A8C200';    // #00C2A8 — signature-pack teal
const AQUA = '&H00E2DE7D';    // #7DDEE2 — sampled from the Prime reference
const DARKTXT = '&H00181818';
// Caption personalities. New fields beyond v1:
//   pill: {bg, fg}      active word gets a chunky colored surround (thick \bord)
//   glow: color         active word gets a blurred neon halo
//   emphItalic: true    emphasized words go italic+bigger instead of gold
//   marginV, align      caption placement overrides
const STYLES = {
  // Flagship caption styles run on Montserrat Black / Archivo Black — the
  // heavy geometric faces the premium tools use. Anton stays only where a
  // template's identity calls for condensed display type.
  boldpop:  { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline', font: 'Montserrat Black' },
  goldglow: { wordsPerGroup: 3, highlight: GOLD,   upper: true,  border: 'outline', font: 'Montserrat Black' },
  cleanbox: { wordsPerGroup: 5, highlight: null,   upper: false, border: 'box' },
  popline:  { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline', pop: true, font: 'Montserrat Black' },
  rosa:     { wordsPerGroup: 3, highlight: PINK,   upper: true,  border: 'outline', pop: true, font: 'Montserrat Black' },
  minimal:  { wordsPerGroup: 4, highlight: null,   upper: false, border: 'outline', scale: 0.72 },
  // Caption-first looks — no template layer, the captions ARE the design.
  // All of these honor opts.accent (owner-picked color) via applyAccent.
  //   fsp: extra letter-spacing (ASS Spacing)   shadow: hard drop shadow depth
  // Kinetic looks — the word engine lays out and animates every word as its
  // own object (fontkit metrics -> absolute \pos). See buildKineticAss.
  palabra:   { wordsPerGroup: 4, highlight: YELLOW, upper: true, font: 'Montserrat Black', kinetic: 'reveal' },
  pildora:   { wordsPerGroup: 4, highlight: null,   upper: true, font: 'Montserrat Black', kinetic: 'pill', pill: { bg: YELLOW, fg: DARKTXT } },
  heroe:     { wordsPerGroup: 5, highlight: YELLOW, upper: true, font: 'Montserrat Black', kinetic: 'hero' },
  temblor:   { wordsPerGroup: 3, highlight: ORANGE, upper: true, border: 'outline', font: 'Montserrat Black', pop: true, shake: true, entrance: 'slam' },
  escenario: { wordsPerGroup: 3, highlight: GOLD,   upper: true, border: 'outline', font: 'Montserrat Black', scale: 1.08, center: true, entrance: 'fade' },
  lujo:     { wordsPerGroup: 4, highlight: GOLD,   upper: false, border: 'outline', scale: 0.8,  font: 'Prata', fsp: 3, emphItalic: true, entrance: 'fade' },
  grande:   { wordsPerGroup: 2, highlight: YELLOW, upper: true,  border: 'outline', scale: 1.18, font: 'Archivo Black', pop: true, entrance: 'slam' },
  resalta:  { wordsPerGroup: 3, highlight: null,   upper: true,  border: 'outline', scale: 1.0, font: 'Montserrat Black', pill: { bg: YELLOW, fg: DARKTXT }, pop: true },
  brillo:   { wordsPerGroup: 3, highlight: CYAN,   upper: true,  border: 'outline', font: 'Montserrat Black', glow: CYAN, pop: true, entrance: 'flicker' },
  sombra:   { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline', scale: 1.08, font: 'Archivo Black', shadow: true, pop: true, entrance: 'slam' },
  // fluido: the karaoke sweep — color fills across each word as it's spoken
  fluido:   { wordsPerGroup: 4, highlight: GOLD,   upper: true,  border: 'outline', font: 'Montserrat Black', fill: true, entrance: 'fade' },
  // Signature looks — the captions.ai gallery devices: mixed typefaces,
  // hollow letters, tilted color blocks, marker underlines. Each carries a
  // subtle cinematic grade so the footage reads produced, not raw.
  // Motion design pack — 10 hand-animated behaviors on real easing curves
  // (kinetic: 'motion', see the motion branch in buildKineticAss).
  cascada:  { wordsPerGroup: 4, highlight: YELLOW, upper: true, font: 'Montserrat Black', kinetic: 'motion', motion: 'cascada', grade: 'eq=contrast=1.05:saturation=1.06' },
  resorte:  { wordsPerGroup: 3, highlight: YELLOW, upper: true, font: 'Montserrat Black', kinetic: 'motion', motion: 'resorte', grade: 'eq=contrast=1.05:saturation=1.06' },
  maquina:  { wordsPerGroup: 4, highlight: GOLD,   upper: true, font: 'Space Mono', kinetic: 'motion', motion: 'maquina', grade: 'eq=contrast=1.06:saturation=0.94' },
  ola:      { wordsPerGroup: 4, highlight: CYAN,   upper: true, font: 'Montserrat Black', kinetic: 'motion', motion: 'ola', grade: 'eq=contrast=1.04:saturation=1.08' },
  golpe:    { wordsPerGroup: 3, highlight: YELLOW, upper: true, font: 'Archivo Black', kinetic: 'motion', motion: 'golpe', grade: 'eq=contrast=1.1:saturation=1.05' },
  neonvivo: { wordsPerGroup: 3, highlight: CYAN,   upper: true, font: 'Anton', kinetic: 'motion', motion: 'neonvivo', grade: 'eq=contrast=1.12:saturation=1.15,colorbalance=bs=.08' },
  recorte:  { wordsPerGroup: 4, highlight: PINK,   upper: true, font: 'Archivo Black', kinetic: 'motion', motion: 'recorte', grade: 'eq=contrast=1.05:saturation=1.1' },
  cinta:    { wordsPerGroup: 4, highlight: GOLD,   upper: true, font: 'Montserrat Black', kinetic: 'motion', motion: 'cinta', grade: 'eq=contrast=1.04:saturation=1.02' },
  enfoque:  { wordsPerGroup: 4, highlight: GOLD,   upper: true, font: 'Montserrat Black', kinetic: 'motion', motion: 'enfoque', grade: 'eq=contrast=1.06:saturation=0.96' },
  gravedad: { wordsPerGroup: 3, highlight: YELLOW, upper: true, font: 'Archivo Black', kinetic: 'motion', motion: 'gravedad', grade: 'eq=contrast=1.06:saturation=1.05' },
  // Premium luminous type: stacked halo + inner glow + crisp core, so the
  // words read as lit from within rather than outlined.
  resplandor: { wordsPerGroup: 4, highlight: GOLD, upper: true, font: 'Montserrat Black', kinetic: 'motion', motion: 'glow', grade: 'eq=contrast=1.07:saturation=1.02:brightness=-0.02' },
  // "Prime" — rebuilt from a measured reference: sentence-case Poppins Bold
  // in white with the key word beneath it in cyan Sacramento script. The
  // reference holds each caption completely still, so this one does too.
  prime: { wordsPerGroup: 4, highlight: AQUA, upper: false, font: 'Poppins', scriptFont: 'Satisfy', kinetic: 'motion', motion: 'prime', grade: 'eq=contrast=1.05:saturation=1.03' },
  mixto:     { wordsPerGroup: 4, highlight: GOLD,   upper: true, border: 'outline', font: 'Montserrat Black', mixFont: 'Great Vibes', grade: 'eq=contrast=1.06:saturation=1.1:brightness=0.01', entrance: 'fade' },
  contorno:  { wordsPerGroup: 3, highlight: YELLOW, upper: true, border: 'outline', font: 'Archivo Black', hollow: true, pop: true, grade: 'eq=contrast=1.09:saturation=0.9', entrance: 'slam' },
  bloque:    { wordsPerGroup: 3, upper: true, font: 'Montserrat Black', kinetic: 'block', palette: [{ bg: PINK, fg: WHITE }, { bg: YELLOW, fg: DARKTXT }, { bg: TEAL, fg: DARKTXT }], grade: 'eq=contrast=1.05:saturation=1.08' },
  subrayado: { wordsPerGroup: 4, highlight: YELLOW, upper: true, font: 'Montserrat Black', kinetic: 'reveal', underline: true, grade: 'eq=contrast=1.04:saturation=1.06' },
  // Template looks (caption layer — frame/title/stickers/grade in TEMPLATES):
  fiesta:    { wordsPerGroup: 3, highlight: PINK,   upper: true,  border: 'outline', pop: true,  font: 'Anton' },
  editorial: { wordsPerGroup: 4, highlight: GOLD,   upper: false, border: 'outline', scale: 0.92, font: 'Prata', emphItalic: true, entrance: 'fade' },
  corrido:   { wordsPerGroup: 3, highlight: RED,    upper: true,  border: 'outline', font: 'Anton', pill: { bg: GOLD, fg: DARKTXT } },
  craft:     { wordsPerGroup: 4, highlight: YELLOW, upper: false, border: 'outline', pop: true,  font: 'Patrick Hand', scale: 1.05, entrance: 'wobble' },
  retro:     { wordsPerGroup: 4, highlight: null,   upper: false, border: 'outline', scale: 0.82, pill: { bg: YELLOW, fg: DARKTXT } },
  brasa:     { wordsPerGroup: 4, highlight: WARM,   upper: false, border: 'outline', scale: 0.95, font: 'Prata', entrance: 'fade' },
  impacto:   { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline', scale: 1.05, font: 'Anton', pill: { bg: YELLOW, fg: DARKTXT }, pop: true, entrance: 'slam' },
  neon:      { wordsPerGroup: 3, highlight: CYAN,   upper: true,  border: 'outline', font: 'Anton', glow: CYAN, entrance: 'flicker' },
  luxe:      { wordsPerGroup: 5, highlight: null,   upper: false, border: 'box', scale: 0.6, font: 'Space Mono', marginV: 320, entrance: 'fade' },
  cine:      { wordsPerGroup: 4, highlight: null,   upper: false, border: 'outline', scale: 0.85, font: 'Prata', entrance: 'fade' },
  grafica:   { wordsPerGroup: 4, highlight: null,   upper: true,  border: 'outline', scale: 0.9, pill: { bg: '&H00C85624', fg: '&H00FFFFFF' } },
  revista:   { wordsPerGroup: 4, highlight: null,   upper: false, border: 'outline', scale: 0.95, font: 'Prata', emphItalic: true, entrance: 'fade' },
  energia:   { wordsPerGroup: 3, highlight: ORANGE, upper: true,  border: 'outline', scale: 1.08, font: 'Anton', pill: { bg: ORANGE, fg: '&H00FFFFFF' } },
  historia:  { wordsPerGroup: 4, highlight: null,   upper: false, border: 'box', scale: 0.88 },
};

// Art direction per template: color grade (video-only, applied before
// captions), a two-line drawtext title treatment (script accent line + big
// display line — drawtext because Cloud Run's libass is unreliable with
// custom fonts), and sticker packs that ride the overlay engine.
const FONTS_DIR = process.env.FONTS_DIR || path.join(__dirname, 'assets', 'fonts');
const STICKERS_DIR = process.env.STICKERS_DIR || path.join(__dirname, 'assets', 'stickers');
// Full template configs. New v2 fields:
//   frame: { asset, panel:{x,y,w,h fractions}, canvasColor } — the video is
//     scaled into `panel` over a canvas; `asset` is a full-frame PNG with a
//     transparent window drawn to match the panel rect.
//   letterbox: { top, bottom, color } — sugar for a full-width panel.
//   title.mode: 'card' (accent+boxed main) | 'bleed' (huge, may echo) |
//     'band' (in the letterbox bar, dark text) | 'titlebar' (retro window
//     bar, persistent) | 'strip' (on the tape strip asset)
//   grain / vignette: film texture applied over the FINISHED frame.
const TEMPLATES = {
  fiesta: {
    grade: 'eq=saturation=1.12:brightness=0.02',
    frame: { asset: 'fiesta-frame', panel: { x: 0.05, y: 0.1302, w: 0.90, h: 0.7396 } },
    title: { mode: 'card', accentFont: 'GreatVibes-Regular.ttf', mainFont: 'Anton-Regular.ttf', accentColor: 'FFFFFF', mainColor: 'FFFFFF', y: 22, accentScale: 0.05, mainScale: 0.058, boxColor: 'black@0.35' },
    burst: ['fiesta-starburst', 'fiesta-confetti', 'fiesta-swirl'],
  },
  editorial: {
    grade: 'eq=saturation=0.92:contrast=0.99:brightness=0.015',
    letterbox: { top: 0.115, bottom: 0.115, color: '0xF3EDDE' },
    title: { mode: 'band', accentFont: 'GreatVibes-Regular.ttf', mainFont: 'Prata-Regular.ttf', accentColor: 'B8912A', mainColor: '1B2653', y: 30, accentScale: 0.055, mainScale: 0.052 },
    burst: ['editorial-flourish', 'editorial-heart', 'editorial-underline'],
    vignette: true,
  },
  corrido: {
    grade: 'eq=contrast=1.08:saturation=0.88:brightness=-0.015',
    letterbox: { top: 0.10, bottom: 0.135, color: 'black' },
    title: { mode: 'bleed', accentFont: 'GreatVibes-Regular.ttf', accentText: 'Regalos que Cantan', mainFont: 'Anton-Regular.ttf', accentColor: 'D4AF37', mainColor: 'FFFFFF', y: 36, mainScale: 0.135, accentScale: 0.05 },
    burst: ['corrido-star', 'corrido-underline', 'corrido-slash'],
    grain: true, vignette: true,
  },
  craft: {
    grade: 'eq=saturation=1.03:brightness=0.01',
    frame: { asset: 'craft-frame', panel: { x: 0.0556, y: 0.15625, w: 0.8889, h: 0.7083 } },
    title: { mode: 'strip', stripAsset: 'craft-strip', mainFont: 'PatrickHand-Regular.ttf', mainColor: '4A4238', y: 96, mainScale: 0.052 },
    burst: ['craft2-arrow', 'craft2-bulb', 'craft2-circle', 'craft2-scribble'],
  },
  retro: {
    grade: 'eq=saturation=1.08:brightness=0.02',
    frame: { asset: 'retro-frame', panel: { x: 0.0444, y: 0.2177, w: 0.9111, h: 0.6469 } },
    title: { mode: 'titlebar', mainFont: 'SpaceMono-Regular.ttf', mainColor: 'FFFFFF', y: 352, mainScale: 0.036 },
    burst: ['fiesta-starburst', 'craft-scribble'],
  },
  brasa: {
    grade: 'colorbalance=rs=.12:gs=.02:bs=-.12,eq=saturation=1.06:brightness=0.02',
    title: { mode: 'card', accentFont: 'GreatVibes-Regular.ttf', mainFont: 'Prata-Regular.ttf', accentColor: 'F0B427', mainColor: 'FFFFFF', y: 140, accentScale: 0.055, mainScale: 0.06, boxColor: 'black@0.3' },
    burst: ['editorial-flourish', 'editorial-heart'],
    vignette: true,
  },
  impacto: {
    grade: 'eq=contrast=1.15:saturation=1.1',
    title: { mode: 'bleed', mainFont: 'Anton-Regular.ttf', mainColor: 'FFD400', y: 60, mainScale: 0.15 },
    burst: ['corrido-slash', 'fiesta-starburst', 'corrido-underline'],
    grain: true,
  },
  neon: {
    grade: 'eq=contrast=1.12:saturation=1.22,colorbalance=rs=.06:bs=.12',
    title: { mode: 'bleed', echo: true, mainFont: 'Anton-Regular.ttf', mainColor: 'FF3EAC', y: 70, mainScale: 0.13 },
    burst: ['fiesta-swirl', 'fiesta-starburst'],
    vignette: true,
  },
  luxe: {
    grade: 'eq=contrast=1.05:saturation=0.75:brightness=-0.03',
    title: { mode: 'card', mainFont: 'SpaceMono-Regular.ttf', mainColor: 'FFFFFF', y: 170, mainScale: 0.032, boxColor: 'black@0.55', rule: 'D4AF37' },
    burst: [],
    vignette: true,
  },
  cine: {
    grade: 'eq=contrast=1.06:saturation=0.82',
    letterbox: { top: 0.12, bottom: 0.12, color: 'black' },
    title: { mode: 'band', accentFont: 'GreatVibes-Regular.ttf', accentText: 'Regalos que Cantan presenta', mainFont: 'Prata-Regular.ttf', accentColor: 'D4AF37', mainColor: 'FFFFFF', y: 40, accentScale: 0.045, mainScale: 0.05 },
    burst: [],
    grain: true, vignette: true,
  },
  grafica: {
    grade: null,
    frame: { asset: 'grafica-frame', panel: { x: 0.0833, y: 0.1719, w: 0.8333, h: 0.6927 } },
    title: { mode: 'card', mainFont: 'Anton-Regular.ttf', mainColor: 'FFFFFF', y: 90, mainScale: 0.062, boxColor: '0x1B49C8@0.9' },
    burst: ['craft-scribble'],
  },
  revista: {
    grade: 'eq=saturation=0.88:brightness=0.02',
    title: { mode: 'card', accentFont: 'GreatVibes-Regular.ttf', mainFont: 'Prata-Regular.ttf', accentColor: 'B8912A', mainColor: 'FFFFFF', y: 110, accentScale: 0.06, mainScale: 0.075, boxColor: 'black@0.22' },
    burst: ['editorial-underline', 'editorial-corner'],
    vignette: true,
  },
  energia: {
    grade: 'eq=contrast=1.12:saturation=1.05',
    frame: { asset: 'energia-frame', panel: { x: 0.0426, y: 0.15625, w: 0.9148, h: 0.7135 } },
    title: { mode: 'bleed', mainFont: 'Anton-Regular.ttf', mainColor: 'E85D10', y: 195, mainScale: 0.105 },
    burst: ['corrido-slash', 'corrido-underline'],
    grain: true,
  },
  historia: {
    grade: 'eq=saturation=0.98',
    title: { mode: 'card', mainFont: 'Prata-Regular.ttf', mainColor: 'FFFFFF', y: 140, mainScale: 0.05, boxColor: 'black@0.4' },
    burst: [],
  },
};
const drawtextEscape = (s) => String(s).replace(/[\\:'";%{}\[\],]/g, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Animated title system (ASS). Titles render as a SECOND subtitle pass on the
// full canvas after the frame stage — libass \t/\move/\fad/\clip transforms
// give every template a real motion-design entrance instead of a static fade.
// ---------------------------------------------------------------------------
const FONT_FAMILY = {
  'Anton-Regular.ttf': 'Anton', 'GreatVibes-Regular.ttf': 'Great Vibes',
  'Prata-Regular.ttf': 'Prata', 'PatrickHand-Regular.ttf': 'Patrick Hand',
  'SpaceMono-Regular.ttf': 'Space Mono',
};
const assColorHex = (hex) => `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toUpperCase();
// 'black@0.42' | '0x1B49C8@0.9' -> ASS back colour with alpha
const assBoxColor = (spec) => {
  if (!spec) return '&H94000000';
  const [c, aRaw] = String(spec).split('@');
  const a = Math.max(0, Math.min(255, Math.round((1 - (Number(aRaw) || 0.42)) * 255)));
  const hex = c === 'black' ? '000000' : c.replace(/^0x/, '');
  return `&H${a.toString(16).padStart(2, '0').toUpperCase()}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toUpperCase();
};

function buildTitlesAss(tpl, styleKey, geo, mainRaw, outDur, depth = false) {
  const T = tpl.title;
  if (!T || (!mainRaw && T.mode !== 'titlebar')) return null;
  const scaleY = geo.h / 1920;
  const cx = Math.round(geo.w / 2);
  const mainFam = FONT_FAMILY[T.mainFont] || 'DejaVu Sans';
  const accFam = FONT_FAMILY[T.accentFont] || 'Great Vibes';
  const mainC = assColorHex(T.mainColor || 'FFFFFF');
  const accC = assColorHex(T.accentColor || 'D4AF37');
  const y0 = Math.round((T.y || 100) * scaleY);
  const accSize = Math.round(geo.w * (T.accentScale || 0.055));
  const mainSizeFit = Math.min(Math.round(geo.w * (T.mainScale || 0.07)), Math.floor((geo.w * 0.92) / Math.max(6, mainRaw.length * 0.58)));
  const END = '0:00:02.85';
  const acc = T.accentFont ? assEscape(T.accentText || 'Regalos que Cantan') : null;
  const main = assEscape(mainRaw).toUpperCase();
  const boxBack = assBoxColor(T.boxColor);
  const isBox = T.mode === 'card';

  const styles = [
    `Style: TMain,${mainFam},${T.mode === 'bleed' ? Math.round(geo.w * (T.mainScale || 0.13)) : mainSizeFit},${mainC},&HFF000000,${isBox ? boxBack : '&H00000000'},${isBox ? boxBack : '&H00000000'},1,0,0,0,100,100,0,0,${isBox ? `3,${Math.round(mainSizeFit / 4)}` : '1,3'},0,8,40,40,10,1`,
    `Style: TAcc,${accFam},${accSize},${accC},${accC},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,40,40,10,1`,
    // typewriter: secondary colour fully transparent so \k reveals chars
    `Style: TType,${mainFam},${Math.round(geo.w * (T.mainScale || 0.036))},${mainC},&HFF000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,40,40,10,1`,
    // neon glow: colored thick outline that blurs into a halo
    `Style: TNeon,${mainFam},${Math.round(geo.w * (T.mainScale || 0.13))},${mainC},&HFF000000,${mainC},&H00000000,1,0,0,0,100,100,0,0,1,${Math.round(geo.w * 0.008)},0,8,40,40,10,1`,
  ];
  const ev = [];
  const E = (start, end, style, text) => ev.push(`Dialogue: 2,${start},${end},${style},,0,0,0,,${text}`);

  // Depth pass: drop the title into the head/shoulder zone so it actually
  // intersects the person — that's what sells the behind-you effect.
  const yMainNormal = acc && (T.mode === 'card' || T.mode === 'band') ? y0 + accSize + Math.round(16 * scaleY) : y0;
  const yMain = depth ? Math.round(geo.h * 0.3) : yMainNormal;
  const anims = {
    fiesta:  `{\\pos(${cx},${yMain})\\fscx24\\fscy24\\t(0,150,\\fscx115\\fscy115)\\t(150,290,\\fscx100\\fscy100)\\fad(50,320)}`,
    craft:   `{\\pos(${cx},${yMain})\\frz-6\\fscx36\\fscy36\\t(0,180,\\frz1\\fscx105\\fscy105)\\t(180,300,\\frz0\\fscx100\\fscy100)\\fad(60,320)}`,
    corrido: `{\\pos(${cx},${yMain})\\fscx158\\fscy158\\blur7\\t(0,130,\\fscx100\\fscy100\\blur0)\\fad(30,300)}`,
    impacto: `{\\pos(${cx},${yMain})\\fscx158\\fscy158\\blur7\\t(0,110,\\fscx100\\fscy100\\blur0)\\fad(30,300)}`,
    energia: `{\\pos(${cx},${yMain})\\frx35\\fscy140\\t(0,140,\\frx0\\fscy100)\\fad(40,300)}`,
    editorial: `{\\pos(${cx},${yMain})\\blur13\\fsp16\\t(0,520,\\blur0\\fsp2)\\fad(160,380)}`,
    revista: `{\\pos(${cx},${yMain})\\blur13\\fsp20\\t(0,560,\\blur0\\fsp3)\\fad(160,380)}`,
    cine:    `{\\pos(${cx},${yMain})\\blur10\\fsp14\\t(0,600,\\blur0\\fsp2)\\fad(200,400)}`,
    brasa:   `{\\pos(${cx},${yMain})\\blur10\\t(0,480,\\blur0)\\fad(150,380)}`,
    historia:`{\\pos(${cx},${yMain})\\fad(220,380)}`,
    luxe:    `{\\pos(${cx},${yMain})\\fsp34\\alpha&HFF&\\t(0,650,\\fsp5\\alpha&H00&)}`,
    grafica: `{\\pos(${cx},${yMain})\\clip(${cx - 4},${yMain - 30},${cx + 4},${yMain + mainSizeFit * 2})\\t(0,380,\\clip(0,${yMain - 30},${geo.w},${yMain + mainSizeFit * 2}))\\fad(0,280)}`,
    neon:    `{\\pos(${cx},${yMain})\\blur14\\t(0,220,\\blur3)\\t(900,1500,\\blur9)\\t(1500,2100,\\blur3)\\fad(60,320)}`,
  };
  const accAnim = `{\\pos(${cx},${y0})\\blur8\\t(120,560,\\blur0)\\fad(180,340)}`;

  if (T.mode === 'titlebar') {
    const txt = (mainRaw || 'regalos que cantan').toLowerCase().replace(/ /g, '-').slice(0, 30) + '.mp4';
    const typed = txt.split('').map((ch) => `{\\k7}${ch === ' ' ? '\\h' : assEscape(ch)}`).join('');
    const yBar = Math.round(T.y * scaleY);
    const endAll = toAssTime(outDur);
    E('0:00:00.00', endAll, 'TType', `{\\pos(${cx},${yBar})}${typed}`);
  } else if (T.mode === 'bleed') {
    const bigSize = Math.round(geo.w * (T.mainScale || 0.13));
    const anim = anims[styleKey] || anims.corrido;
    if (T.echo) {
      E('0:00:00.05', END, 'TMain', `{\\pos(${cx},${yMain - Math.round(bigSize * 1.02)})\\alpha&HD8&\\fad(120,300)}${main}`);
      E('0:00:00.05', END, 'TMain', `{\\pos(${cx},${yMain + Math.round(bigSize * 1.02)})\\alpha&HB8&\\fad(120,300)}${main}`);
    }
    E('0:00:00.00', END, styleKey === 'neon' ? 'TNeon' : 'TMain', `${anim}${main}`);
    if (acc) E('0:00:00.15', END, 'TAcc', `{\\pos(${cx},${yMain + Math.round(bigSize * 1.12)})\\fad(200,320)}${acc}`);
  } else {
    // card / band / strip
    if (acc) E('0:00:00.00', END, 'TAcc', `${accAnim}${acc}`);
    const anim = anims[styleKey] || anims.historia;
    E('0:00:00.00', END, 'TMain', `${anim}${main}`);
  }

  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${geo.w}`, `PlayResY: ${geo.h}`,
    'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles, '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...ev,
  ].join('\n') + '\n';
}

function assEscape(text) {
  return String(text).replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
}

function toAssTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${rest}`;
}

// Split words into caption groups: cut on group size, a speech gap, or
// end-of-sentence punctuation, and never let one group run past ~3.5s.
function groupWords(words, perGroup) {
  const groups = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : 99;
    const sentenceEnd = /[.!?…]$/.test(w.word.trim());
    const tooLong = cur.length > 0 && w.end - cur[0].start > 3.5;
    if (cur.length >= perGroup || gap > 0.8 || sentenceEnd || tooLong || !next) {
      groups.push(cur);
      cur = [];
    }
  }
  return groups.filter((g) => g.length);
}

function assHeader(geo, st, fontsize, contrast = 0) {
  // Premium stroke system: a FAT outline (the thin default stroke is what
  // makes captions read "stock") + an always-on soft translucent drop shadow
  // for depth. contrast = auto-readability boost (bright footage) thickens
  // further. Box styles carry their own scrim instead.
  const outlineW = contrast >= 2 ? Math.round(fontsize / 6)
    : contrast === 1 ? Math.round(fontsize / 7)
    : Math.round(fontsize / 8.5);
  const shadowDepth = Math.max(
    st.shadow ? Math.round(fontsize / 7) : Math.round(fontsize / 20), // hard 3D (sombra) vs soft depth
    contrast >= 2 ? Math.round(fontsize / 14) : contrast === 1 ? Math.round(fontsize / 18) : 0);
  const outline = st.border === 'box'
    ? `3,${Math.round(fontsize / 5)},0`   // BorderStyle=3 (box) — Outline acts as box padding
    : `1,${outlineW},${shadowDepth}`; // BorderStyle=1, thick outline
  const backColour = st.border === 'box' ? BOX_BLACK
    : st.shadow ? '&H00000000' : '&H6E000000'; // shadow colour: hard for sombra, soft translucent otherwise
  const outlineColour = st.border === 'box' ? BOX_BLACK : '&H00000000';
  const align = st.center ? 5 : 2; // center-stage styles sit mid-screen
  const hookSize = Math.round(geo.fontsize * 0.6);
  const hookMarginTop = geo.h >= 1900 ? 170 : 100;
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${geo.w}`,
    `PlayResY: ${geo.h}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${st.font || 'DejaVu Sans'},${fontsize},${WHITE},${WHITE},${outlineColour},${backColour},1,0,0,0,100,100,${st.fsp || 0},0,${outline},${align},60,60,${st.marginV || geo.marginV},1`,
    // Hook title: top-center (alignment 8), soft dark box so it reads on any footage.
    `Style: Hook,DejaVu Sans,${hookSize},${WHITE},${WHITE},${BOX_BLACK},${BOX_BLACK},1,0,0,0,100,100,0,0,3,${Math.round(hookSize / 4)},0,8,60,60,${hookMarginTop},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
}

// Auto-readability: measure how bright the footage is where the captions
// will sit (center band at ~72-87% height — where 9:16 captions land with
// marginV 460). Bright walls wash out white captions; the returned level
// (0/1/2) thickens outlines + adds a drop shadow in assHeader.
function measureCaptionBandLuma(dir, start, clipDur, log = () => {}) {
  try {
    const lumaFile = path.join(dir, 'luma.txt');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(Math.min(clipDur, 30)),
      '-i', 'source.mp4',
      // format=gray pins the scale to 8-bit (0-255) — 10-bit sources (DJI)
      // would otherwise report YAVG on a 0-1023 scale and always max the boost
      '-vf', `fps=${Math.min(1, 6 / Math.min(clipDur, 30)).toFixed(3)},crop=iw*0.6:ih*0.15:iw*0.2:ih*0.72,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=luma.txt`,
      '-f', 'null', '-'], { cwd: dir });
    const vals = fs.readFileSync(lumaFile, 'utf8').match(/YAVG=([\d.]+)/g)?.map((m) => Number(m.slice(5))) || [];
    fs.rmSync(lumaFile, { force: true });
    if (!vals.length) return 0;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const level = avg > 175 ? 2 : avg > 135 ? 1 : 0;
    log(`caption-band luma ${avg.toFixed(0)} -> contrast boost ${level}`);
    return level;
  } catch { return 0; }
}

// Owner-picked accent color ("#RRGGBB" from the UI color picker) re-skins
// whatever active-word treatment the style has: highlight paint, pill
// background (text flips dark/light by luminance), or glow halo.
const hexToAssColor = (hex) => {
  const h = hex.replace('#', '');
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};
const hexIsLight = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
};
function applyAccent(st, accentHex) {
  if (!accentHex || !/^#?[0-9a-fA-F]{6}$/.test(String(accentHex))) return st;
  const c = hexToAssColor(String(accentHex));
  const out = { ...st };
  if (st.pill) out.pill = { bg: c, fg: hexIsLight(accentHex) ? DARKTXT : '&H00FFFFFF' };
  if (st.glow) out.glow = c;
  // Picking a color ALWAYS colors the spoken word — on quiet styles that had
  // no highlight (cleanbox/minimal) this turns the word paint on, which is
  // what choosing a color is asking for.
  out.highlight = c;
  // block styles carry a rotating palette — the picked color leads it
  if (Array.isArray(st.palette)) {
    out.palette = [{ bg: c, fg: hexIsLight(accentHex) ? DARKTXT : '&H00FFFFFF' }, ...st.palette.slice(1)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kinetic caption engine (word-level typography). fontkit reads the exact
// bundled TTFs, so every word gets a measured absolute position — that's what
// unlocks cumulative reveals, a pill that travels between words, and
// art-directed hero stacking. Measurements assume Bold=0 (synthetic bold
// would widen glyphs past the measured advance).
// ---------------------------------------------------------------------------
const FONT_FILE = {
  Anton: 'Anton-Regular.ttf', Prata: 'Prata-Regular.ttf', 'Patrick Hand': 'PatrickHand-Regular.ttf',
  'Space Mono': 'SpaceMono-Regular.ttf', 'Great Vibes': 'GreatVibes-Regular.ttf',
  'Montserrat Black': 'Montserrat-Black.ttf', 'Archivo Black': 'ArchivoBlack-Regular.ttf',
  Poppins: 'Poppins-Bold.ttf', Sacramento: 'Sacramento-Regular.ttf', Satisfy: 'Satisfy-Regular.ttf',
};
const _fkFonts = {};
function textW(fam, text, size) {
  if (!_fkFonts[fam]) _fkFonts[fam] = require('fontkit').openSync(path.join(FONTS_DIR, FONT_FILE[fam] || FONT_FILE.Anton));
  const f = _fkFonts[fam];
  return (f.layout(String(text)).advanceWidth / f.unitsPerEm) * size;
}

// Center a group of tokens into 1-2 lines of measured words. Returns per-word
// {x, y, w, size} where x/y are \an5 centers; shrinks as a last resort so a
// long word never runs off screen.
function layoutGroup(fam, tokens, baseSize, geo, bottomY) {
  const maxW = geo.w * 0.86;
  const gap = (s) => textW(fam, ' ', s) || s * 0.28;
  let size = baseSize;
  const wrap = (s) => {
    const l = [[]];
    let w = 0;
    for (const t of tokens) {
      const tw = textW(fam, t.txt, s) + (l[l.length - 1].length ? gap(s) : 0);
      if (w + tw > maxW && l[l.length - 1].length) { l.push([]); w = 0; }
      w += tw;
      l[l.length - 1].push(t);
    }
    return l;
  };
  const lineW = (ln, s) => ln.reduce((a, t) => a + textW(fam, t.txt, s), 0) + gap(s) * (ln.length - 1);
  let lines = lineW(tokens, size) <= maxW ? [tokens] : wrap(size);
  while (size > baseSize * 0.55 && lines.some((ln) => lineW(ln, size) > maxW)) { size *= 0.94; lines = wrap(size); }
  const lh = size * 1.24;
  const y0 = bottomY - lh * (lines.length - 1);
  const out = [];
  lines.forEach((ln, li) => {
    let x = (geo.w - lineW(ln, size)) / 2;
    for (const t of ln) {
      const w = textW(fam, t.txt, size);
      out.push({ ...t, w, size, x: x + w / 2, y: y0 + li * lh });
      x += w + gap(size);
    }
  });
  return out;
}

// Real easing curves, approximated as multi-step \t chains — the difference
// between motion that feels hand-animated and the stiff two-step transforms
// that read "template". Back overshoots, expo snaps, elastic springs.
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutElastic = (t) => { const c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; };
// Animate uniform scale s0 -> 100 over dur ms along `ease` (8 steps ≈ smooth).
function scaleChain(s0, dur, ease, steps = 8) {
  let out = `\\fscx${Math.round(s0)}\\fscy${Math.round(s0)}`;
  for (let i = 1; i <= steps; i++) {
    const t0 = Math.round((dur * (i - 1)) / steps), t1 = Math.round((dur * i) / steps);
    const v = Math.max(1, Math.round(s0 + (100 - s0) * ease(i / steps)));
    out += `\\t(${t0},${t1},\\fscx${v}\\fscy${v})`;
  }
  return out;
}
// Animate blur b0 -> bEnd over dur ms along `ease`.
function blurChain(b0, bEnd, dur, ease, steps = 6) {
  let out = `\\blur${b0}`;
  for (let i = 1; i <= steps; i++) {
    const t0 = Math.round((dur * (i - 1)) / steps), t1 = Math.round((dur * i) / steps);
    const v = (b0 + (bEnd - b0) * ease(i / steps)).toFixed(1);
    out += `\\t(${t0},${t1},\\blur${v})`;
  }
  return out;
}

function buildKineticAss(words, styleKey, aspectKey, opts = {}) {
  const geo = ASPECTS[aspectKey] || ASPECTS['9:16'];
  const st = applyAccent(STYLES[styleKey] || STYLES.palabra, opts.accent);
  const fam = st.font || 'Anton';
  const baseSize = Math.round(geo.fontsize * (st.scale || 1) * 1.08 * (opts.sizeScale || 1));
  const contrast = opts.contrast || 0;
  const bord = contrast >= 2 ? Math.round(baseSize / 6) : contrast === 1 ? Math.round(baseSize / 7) : Math.round(baseSize / 8.5);
  const shad = Math.round(baseSize / (contrast ? 16 : 22));
  const bottomY = geo.h - (st.marginV || geo.marginV) - Math.round(baseSize * 0.5);
  const hookSize = Math.round(geo.fontsize * 0.6);
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${geo.w}`, `PlayResY: ${geo.h}`,
    'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Bold=0 on purpose — the layout is measured on the real glyph advances
    `Style: K,${fam},${baseSize},${WHITE},${WHITE},&H00000000,&H6E000000,0,0,0,0,100,100,0,0,1,${bord},${shad},5,0,0,0,1`,
    `Style: Hook,DejaVu Sans,${hookSize},${WHITE},${WHITE},${BOX_BLACK},${BOX_BLACK},1,0,0,0,100,100,0,0,3,${Math.round(hookSize / 4)},0,8,60,60,${geo.h >= 1900 ? 170 : 100},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = hookLine({ hookTitle: opts.hookTitle, totalDur: opts.totalDur });
  // \blur0.8 softens the stroke edge — the difference between a harsh burned
  // stroke and the smooth pro one. Injected into the first tag block.
  const E = (layer, from, to, text) => lines.push(`Dialogue: ${layer},${toAssTime(from)},${toAssTime(to)},K,,0,0,0,,${text.replace('{', '{\\blur0.8')}`);
  const wordColor = (w) => (w.emp || isNumberWord(w.word) || isCtaWord(w.word) ? (st.highlight || GOLD) : WHITE);
  const groups = groupWords(words, st.wordsPerGroup);
  let gi = -1;

  for (const group of groups) {
    gi++;
    const tokens = group.map((w) => ({ txt: st.upper ? String(w.word).toUpperCase() : String(w.word), w }));
    const gEnd = group[group.length - 1].end + 0.1;

    if (st.kinetic === 'reveal') {
      // Words appear one by one as spoken — and stay. Each lands with a
      // little overshoot bounce at its measured position. subrayado also
      // wipes a thick marker line under key words as they land.
      const pos = layoutGroup(fam, tokens, baseSize, geo, bottomY);
      pos.forEach((p, i) => {
        const fsTag = Math.round(p.size) !== baseSize ? `\\fs${Math.round(p.size)}` : '';
        const enter = `\\fscx30\\fscy30\\t(0,110,\\fscx112\\fscy112)\\t(110,190,\\fscx100\\fscy100)`;
        E(1, group[i].start, gEnd, `{\\an5\\pos(${Math.round(p.x)},${Math.round(p.y)})${fsTag}\\c${wordColor(group[i])}&${enter}}${assEscape(p.txt)}`);
        const w = group[i];
        if (st.underline && (w.emp || isNumberWord(w.word) || isCtaWord(w.word))) {
          const uw = Math.round(p.w + p.size * 0.2);
          const uh = Math.round(p.size * 0.12);
          const ux = Math.round(p.x);
          const uy = Math.round(p.y + p.size * 0.62);
          const x0 = ux - Math.round(uw / 2), x1 = ux + Math.round(uw / 2);
          E(0, w.start + 0.08, gEnd, `{\\an5\\pos(${ux},${uy})\\1c${st.highlight || YELLOW}&\\3c${st.highlight || YELLOW}&\\bord3\\shad0\\p1\\clip(${x0},${uy - 40},${x0},${uy + 40})\\t(0,160,\\clip(${x0},${uy - 40},${x1},${uy + 40}))}m 0 0 l ${uw} 0 ${uw} ${uh} 0 ${uh}{\\p0}`);
        }
      });
    } else if (st.kinetic === 'block') {
      // The whole phrase sits on a tilted solid color block; block colors
      // rotate through the palette per phrase, tilt alternates sides.
      const pos = layoutGroup(fam, tokens, baseSize, geo, bottomY);
      const pal = (st.palette && st.palette[gi % st.palette.length]) || { bg: YELLOW, fg: DARKTXT };
      const tiltDeg = gi % 2 ? -2 : 2;
      // group words by line (same y)
      const lines2 = [];
      for (const p of pos) {
        let ln = lines2.find((l) => l.y === p.y);
        if (!ln) { ln = { y: p.y, items: [] }; lines2.push(ln); }
        ln.items.push(p);
      }
      const enter = `\\fscx90\\fscy90\\t(0,120,\\fscx100\\fscy100)\\fad(70,0)`;
      for (const ln of lines2) {
        const minX = Math.min(...ln.items.map((p) => p.x - p.w / 2));
        const maxX = Math.max(...ln.items.map((p) => p.x + p.w / 2));
        const cx = Math.round((minX + maxX) / 2);
        const bw = Math.round(maxX - minX + ln.items[0].size * 0.7);
        const bh = Math.round(ln.items[0].size * 1.42);
        const org = `\\org(${cx},${Math.round(ln.y)})\\frz${tiltDeg}`;
        E(0, group[0].start, gEnd, `{\\an5\\pos(${cx},${Math.round(ln.y)})${org}\\1c${pal.bg}&\\3c${pal.bg}&\\bord${Math.round(ln.items[0].size * 0.16)}\\shad2\\4c&H96000000&${enter}\\p1}m 0 0 l ${bw} 0 ${bw} ${bh} 0 ${bh}{\\p0}`);
        for (const p of ln.items) {
          E(1, group[0].start, gEnd, `{\\an5\\pos(${Math.round(p.x)},${Math.round(p.y)})${org}\\c${pal.fg}&\\bord0\\shad0${enter}}${assEscape(p.txt)}`);
        }
      }
    } else if (st.kinetic === 'motion') {
      // ---- the motion design pack: 10 hand-animated behaviors --------------
      const pos = st.motion === 'golpe' ? null : layoutGroup(fam, tokens, baseSize, geo, bottomY);
      const hi = st.highlight || YELLOW;
      const beats = group.map((w, i) => ({
        from: w.start,
        to: i < group.length - 1 ? group[i + 1].start : gEnd,
      }));
      // smart direction: per-word intensity (loudness + emphasis bonus)
      const EN = (w) => Math.min(1.45, (w.energy ?? 0.8) + (w.emp ? 0.3 : 0));

      if (st.motion === 'cascada') {
        // Words drop from above one by one, land with a back-eased overshoot;
        // a soft ground-shadow puff catches each landing, settled words dim
        // and keep a subtle breath so the line never freezes.
        pos.forEach((p, i) => {
          const x = Math.round(p.x), y = Math.round(p.y);
          const en = EN(group[i]);
          const enter = `\\move(${x},${y - Math.round(70 + 60 * en)},${x},${y},0,170)${scaleChain(Math.round(86 - 18 * en), 260, easeOutBack)}\\frz-5\\t(60,240,\\frz0)`;
          const to2 = i < group.length - 1 ? beats[i + 1].from : gEnd;
          // landing shadow puff (appears at touchdown, spreads + fades)
          const sw = Math.round(p.w * 0.45), sh = Math.round(p.size * 0.09);
          E(0, group[i].start + 0.13, group[i].start + 0.5,
            `{\\an5\\pos(${x},${y + Math.round(p.size * 0.62)})\\1c&H000000&\\alpha&H82&\\bord${sh}\\3c&H000000&\\blur6\\fscx60\\t(0,240,\\fscx130\\alpha&HFF&)\\p1}m 0 0 l ${sw} 0 ${sw} 2 0 2{\\p0}`);
          E(1, group[i].start, to2, `{\\an5${enter}\\c${i === 0 ? WHITE : hi}&}${assEscape(p.txt)}`);
          if (to2 < gEnd) E(1, to2, gEnd, `{\\an5\\pos(${x},${y})\\alpha&H46&\\c${WHITE}&\\t(300,1100,\\fscx101\\fscy101)\\t(1100,1900,\\fscx100\\fscy100)}${assEscape(p.txt)}`);
        });
      } else if (st.motion === 'resorte') {
        // Elastic spring-in with ANTICIPATION: each beat the word dips 5%
        // for a breath, then springs — and a ghost echo trails the pop.
        pos.forEach((p, i) => {
          E(1, group[0].start, gEnd, `{\\an5\\pos(${Math.round(p.x)},${Math.round(p.y)})${scaleChain(38, 520, easeOutElastic, 10)}\\c${WHITE}&}${assEscape(p.txt)}`);
        });
        beats.forEach((b, i) => {
          if (b.to - b.from < 0.05) return;
          const p = pos[i];
          const x = Math.round(p.x), y = Math.round(p.y);
          // ghost echo: an oversized fading copy right behind the pop
          E(2, b.from, Math.min(b.to, b.from + 0.28), `{\\an5\\pos(${x},${y})\\fscx150\\fscy150\\c${hi}&\\bord0\\blur4\\alpha&H78&\\t(0,260,\\fscx185\\fscy185\\alpha&HFF&)}${assEscape(p.txt)}`);
          const anticipate = `\\fscx94\\fscy94\\t(0,55,\\fscx94\\fscy94)`;
          E(3, b.from, b.to, `{\\an5\\pos(${x},${y})${anticipate}${scaleChain(Math.round(96 + 18 * EN(group[i])), 340, easeOutElastic, 8)}\\c${hi}&\\bord${Math.round(p.size / 8)}}${assEscape(p.txt)}`);
        });
      } else if (st.motion === 'maquina') {
        // Typewriter: each word types out character by character on its real
        // duration in a warm ink that settles to its final color — with a
        // faint keystroke flutter while typing.
        pos.forEach((p, i) => {
          const w = group[i];
          const typeMs = Math.round((beats[i].to - beats[i].from) * 0.7 * 1000);
          const durCs = Math.max(6, Math.round(typeMs / 10 / Math.max(1, p.txt.length)));
          const typed = p.txt.split('').map((ch) => `{\\k${durCs}}${assEscape(ch)}`).join('');
          const finalC = i % 2 ? hi : WHITE;
          const settle = `\\c${GOLD}&\\t(${typeMs},${typeMs + 220},\\c${finalC}&)`;
          const flutter = `\\t(0,${Math.round(typeMs * 0.5)},\\fscy99)\\t(${Math.round(typeMs * 0.5)},${typeMs},\\fscy100)`;
          E(1, w.start, gEnd, `{\\an5\\pos(${Math.round(p.x)},${Math.round(p.y)})${settle}${flutter}\\2a&HFF&}${typed}`);
        });
        beats.forEach((b, i) => {
          if (b.to - b.from < 0.05) return;
          const p = pos[i];
          const cx = Math.round(p.x + p.w / 2 + p.size * 0.18);
          const cw = Math.round(p.size * 0.42), ch = Math.round(p.size * 0.82);
          const prevX = i > 0 ? Math.round(pos[i - 1].x + pos[i - 1].w / 2 + p.size * 0.18) : cx;
          const posTag = i === 0 ? `\\pos(${cx},${Math.round(p.y)})` : `\\move(${prevX},${Math.round(pos[i - 1].y)},${cx},${Math.round(p.y)},0,90)`;
          E(0, b.from, b.to, `{\\an5${posTag}\\1c${hi}&\\bord0\\shad0\\t(200,340,\\alpha&HFF&)\\t(340,480,\\alpha&H00&)\\p1}m 0 0 l ${cw} 0 ${cw} ${ch} 0 ${ch}{\\p0}`);
        });
      } else if (st.motion === 'ola') {
        // A traveling two-harmonic wave; the crest (active word) rides
        // slightly bigger with a soft glow, like it's catching light.
        const waveOff = (j, i, size) => Math.round((Math.sin((j - i) * 1.1) * 0.14 + Math.sin((j - i) * 2.2) * 0.05) * size);
        beats.forEach((b, i) => {
          if (b.to - b.from < 0.05) return;
          pos.forEach((p, j) => {
            const off = waveOff(j, i, p.size);
            const prevOff = waveOff(j, i - 1, p.size);
            const x = Math.round(p.x);
            const posTag = i === 0
              ? `\\pos(${x},${Math.round(p.y + off)})`
              : `\\move(${x},${Math.round(p.y + prevOff)},${x},${Math.round(p.y + off)},0,150)`;
            const intro = i === 0 ? `\\fad(90,0)` : '';
            const crest = j === i
              ? `\\c${hi}&\\fscx106\\fscy106\\bord${Math.max(3, Math.round(p.size / 14))}\\3c${hi}&\\blur3`
              : `\\c${WHITE}&`;
            E(1, b.from, b.to, `{\\an5${posTag}${crest}${intro}}${assEscape(p.txt)}`);
          });
        });
      } else if (st.motion === 'golpe') {
        // One word at a time, HUGE — expo punch-in with a micro shake, an
        // impact shockwave puff, and a ghost echo. Position drifts a little
        // per word so the rhythm feels hand-cut.
        group.forEach((w, i) => {
          const b = beats[i];
          if (b.to - b.from < 0.05) return;
          const txt = tokens[i].txt;
          const en = EN(w);
          const size = Math.min(Math.round(geo.w * (0.16 + 0.05 * en) * (opts.sizeScale || 1)), Math.floor((geo.w * 0.9) / Math.max(3, txt.length * 0.62)));
          const cx = Math.round(geo.w / 2 + (((i * 53) % 5) - 2) * 14);
          const cy = Math.round(geo.h * 0.6 + (((i * 31) % 5) - 2) * 12);
          const color = i % 3 === 2 ? hi : WHITE;
          // shockwave puff behind the impact
          E(0, b.from, Math.min(b.to, b.from + 0.24), `{\\an5\\pos(${cx},${cy})\\1c${color}&\\bord${Math.round(size * 0.3)}\\3c${color}&\\blur14\\alpha&H6E&\\fscx30\\fscy30\\t(0,220,\\fscx170\\fscy170\\alpha&HFF&)\\p1}m 0 0 l ${size} 0 ${size} ${Math.round(size * 0.4)} 0 ${Math.round(size * 0.4)}{\\p0}`);
          // ghost echo trailing the punch
          E(1, b.from, Math.min(b.to, b.from + 0.2), `{\\an5\\pos(${cx},${cy})\\fs${size}\\fscx135\\fscy135\\blur5\\alpha&H8C&\\c${color}&\\bord0\\t(0,180,\\fscx170\\fscy170\\alpha&HFF&)}${assEscape(txt)}`);
          const sa = (1.1 * en).toFixed(1);
          const shake = `\\t(0,40,\\frz${sa})\\t(40,80,\\frz-${sa})\\t(80,120,\\frz0)`;
          E(2, b.from, b.to, `{\\an5\\pos(${cx},${cy})\\fs${size}${scaleChain(Math.round(135 + 28 * en), 190, easeOutExpo)}${shake}\\c${color}&}${assEscape(txt)}`);
        });
      } else if (st.motion === 'neonvivo') {
        // Words ignite like neon tubes — stuttering flicker, then a slow
        // glow pulse — with a faint mirrored FLOOR REFLECTION under the line.
        const pal = [CYAN, PINK];
        pos.forEach((p, i) => {
          const d = i * 60 + (((i * 73) % 7) - 3) * 6; // staggered ignition, human jitter
          const flicker = `\\alpha&HFF&\\t(${d},${d + 40},\\alpha&H00&)\\t(${d + 40},${d + 80},\\alpha&HB0&)\\t(${d + 80},${d + 130},\\alpha&H00&)`;
          const glow = `\\bord${Math.max(3, Math.round(p.size / 12))}\\3c${pal[i % 2]}&\\blur5\\t(600,1400,\\blur9)\\t(1400,2200,\\blur5)`;
          E(1, group[i].start, gEnd, `{\\an5\\pos(${Math.round(p.x)},${Math.round(p.y)})${flicker}${glow}\\c&HFFFFFF&}${assEscape(p.txt)}`);
          // reflection: vertically flipped, dim, blurred, hugging the baseline
          const rf = `\\alpha&HFF&\\t(${d + 80},${d + 160},\\alpha&HCC&)`;
          E(0, group[i].start, gEnd, `{\\an5\\pos(${Math.round(p.x)},${Math.round(p.y + p.size * 1.18)})\\fscy-92\\fscx100${rf}\\blur4\\bord2\\3c${pal[i % 2]}&\\c&HFFFFFF&}${assEscape(p.txt)}`);
        });
      } else if (st.motion === 'recorte') {
        // Sticker collage: each word slaps in oversized with a back-ease,
        // keeps a hand-placed tilt. Sticker = DARK ink on a thick white
        // border (white-on-white reads as a blob).
        pos.forEach((p, i) => {
          const tilt = ((i * 37) % 7) - 3;
          const enter = `${scaleChain(165, 240, easeOutBack)}\\frz${tilt + 10}\\t(0,220,\\frz${tilt})`;
          // the sticker's shadow slaps down a beat late — parallax depth
          E(0, group[i].start + 0.05, gEnd, `{\\an5\\pos(${Math.round(p.x + 7)},${Math.round(p.y + 9)})${scaleChain(150, 200, easeOutBack)}\\frz${tilt}\\c&H000000&\\alpha&H8C&\\bord${Math.round(p.size / 6)}\\3c&H000000&\\blur3}${assEscape(p.txt)}`);
          E(1, group[i].start, gEnd, `{\\an5\\pos(${Math.round(p.x)},${Math.round(p.y)})${enter}\\c${i % 3 === 1 ? hi : DARKTXT}&\\bord${Math.round(p.size / 6)}\\3c&HFFFFFF&\\shad0}${assEscape(p.txt)}`);
        });
      } else if (st.motion === 'cinta') {
        // News-ticker: words slide in from the right edge to their measured
        // spots, staggered, with a tiny arrival squash.
        const lineY = Math.round(pos[pos.length - 1].y + pos[0].size * 0.72);
        const minX2 = Math.round(Math.min(...pos.map((p) => p.x - p.w / 2)));
        const maxX2 = Math.round(Math.max(...pos.map((p) => p.x + p.w / 2)));
        pos.forEach((p, i) => {
          const x = Math.round(p.x), y = Math.round(p.y);
          const d = i * 70 + (((i * 73) % 7) - 3) * 5; // human jitter
          // speed-stretch while sliding, squash on arrival
          const arrive = `\\fscx132\\t(${d},${260 + d},\\fscx132)\\t(${260 + d},${320 + d},\\fscx98)\\t(${320 + d},${380 + d},\\fscx100)`;
          E(1, group[0].start, gEnd, `{\\an5\\move(${geo.w + Math.round(p.w / 2)},${y},${x},${y},${d},${260 + d})${arrive}\\c${wordColor(group[i])}&}${assEscape(p.txt)}`);
        });
        // ticker rule draws itself under the line once the words settle
        E(0, group[0].start + 0.3, gEnd, `{\\an5\\pos(${Math.round((minX2 + maxX2) / 2)},${lineY})\\1c${hi}&\\bord1\\3c${hi}&\\shad0\\p1\\clip(${minX2},${lineY - 20},${minX2},${lineY + 20})\\t(0,240,\\clip(${minX2},${lineY - 20},${maxX2},${lineY + 20}))}m 0 0 l ${maxX2 - minX2} 0 ${maxX2 - minX2} 5 0 5{\\p0}`);
      } else if (st.motion === 'enfoque') {
        // Focus pull: the phrase racks from big soft blur into crisp focus;
        // on each beat the active word is sharp while the rest soften back.
        // rack-focus with a fake chromatic fringe: warm and cool copies open
        // slightly apart and converge as focus lands
        pos.forEach((p) => {
          const x = Math.round(p.x), y = Math.round(p.y);
          E(0, group[0].start, beats[0].to, `{\\an5\\move(${x - 5},${y},${x},${y},0,340)${blurChain(11, 2, 380, easeOutExpo)}\\alpha&H96&\\c&H4040FF&\\bord0\\t(300,380,\\alpha&HFF&)}${assEscape(p.txt)}`);
          E(0, group[0].start, beats[0].to, `{\\an5\\move(${x + 5},${y},${x},${y},0,340)${blurChain(11, 2, 380, easeOutExpo)}\\alpha&H96&\\c&HFFB040&\\bord0\\t(300,380,\\alpha&HFF&)}${assEscape(p.txt)}`);
          E(1, group[0].start, beats[0].to, `{\\an5\\pos(${x},${y})${blurChain(11, 0.8, 380, easeOutExpo)}${scaleChain(124, 380, easeOutExpo)}\\c${WHITE}&}${assEscape(p.txt)}`);
        });
        beats.slice(1).forEach((b, k) => {
          const i = k + 1;
          if (b.to - b.from < 0.05) return;
          pos.forEach((p, j) => {
            const soft = j === i ? `\\blur0.8\\c${hi}&` : `\\blur2.4\\alpha&H28&\\c${WHITE}&`;
            E(1, b.from, b.to, `{\\an5\\pos(${Math.round(p.x)},${Math.round(p.y)})${soft}}${assEscape(p.txt)}`);
          });
        });
      } else if (st.motion === 'prime') {
        // Measured from the reference capture (fractions of frame height):
        //   bold line centre 0.677 · script line centre 0.727
        //   bold em 0.0505 · script em 0.062 (script x-heights run small)
        // Captions hold perfectly still — the reference has zero caption
        // motion, so a soft fade is the only concession.
        const boldFam = st.font || 'Poppins';
        const scriptFam = st.scriptFont || 'Sacramento';
        const sizeK = opts.sizeScale || 1;
        // Sizes solved against the reference by WIDTH, not height: at the
        // capture's resolution the caption is ~95px wide but only ~12px tall,
        // so width carries ~8x the measurable signal. Reference "know this"
        // spans 53.4% of frame width, "one tip" 54.5%.
        // NOTE libass does not map \fs 1:1 onto the em, and the error differs
        // per face — measured on this renderer: Poppins draws ~1.21x wider
        // than fontkit's advance predicts, Sacramento ~0.70x. RF corrects
        // both the calibrated sizes and the shrink-to-fit test.
        const RF = { Poppins: 0.553, Sacramento: 0.697, Satisfy: 0.640 };
        const boldSize = Math.round(geo.h * 0.1099 * sizeK);
        const scriptSize = Math.round(geo.h * 0.1674 * sizeK);
        const cx = Math.round(geo.w / 2);
        // \an5 centres the LAYOUT box, not the ink, so the anchors are
        // nudged by each face's ink offset to land the ink where measured.
        const yBold = Math.round(geo.h * 0.6856);
        const yScript = Math.round(geo.h * 0.7350);
        const maxW = geo.w * 0.88;

        let kIdx = group.findIndex((w) => w.emp);
        if (kIdx < 0) kIdx = group.findIndex((w) => isNumberWord(w.word) || isCtaWord(w.word));

        // Script is an ACCENT, never the body text. It only appears when a
        // real key word lands in the last two positions, so the cursive tail
        // is at most two words and always ends the phrase ("know this" /
        // "one tip"). Everything else stays white and readable — the
        // reference is full of all-white captions ("We're taught", "means").
        const useScript = kIdx >= 0 && kIdx >= group.length - 2;
        const splitAt = useScript ? kIdx : group.length;
        const restRaw = group.slice(0, splitAt).map((w) => String(w.word)).join(' ').trim();
        const keyRaw = group.slice(splitAt).map((w) => String(w.word)).join(' ').replace(/[.,!?…¿¡]+$/, '').trim();
        const fit = (fam, text, size) => {
          const rf = RF[fam] || 1;
          let s = size;
          while (s > size * 0.5 && textW(fam, text, s) * rf > maxW) s = Math.floor(s * 0.94);
          return s;
        };
        // A white-only caption is one balanced line, not a line pinned to the
        // top of an empty two-line block.
        const yWhiteOnly = Math.round((yBold + yScript) / 2);
        // Long body text WRAPS (the reference stacks "starts to look"); it
        // must never shrink itself off the frame — four long Spanish words
        // hit the shrink floor and still overflowed at 1060px.
        const renderW = (fam, t, s) => textW(fam, t, s) * (RF[fam] || 1);
        const wrapWhite = (text, size) => {
          if (!text) return { lines: [], size };
          if (renderW(boldFam, text, size) <= maxW) return { lines: [text], size };
          const ws = text.split(' ');
          let best = null;
          for (let i = 1; i < ws.length; i++) {
            const a = ws.slice(0, i).join(' '), b = ws.slice(i).join(' ');
            const wide = Math.max(renderW(boldFam, a, size), renderW(boldFam, b, size));
            if (!best || wide < best.wide) best = { a, b, wide };
          }
          if (!best) return { lines: [text], size: fit(boldFam, text, size) };
          let s = size;
          while (s > size * 0.6 && Math.max(renderW(boldFam, best.a, s), renderW(boldFam, best.b, s)) > maxW) s = Math.floor(s * 0.95);
          return { lines: [best.a, best.b], size: s };
        };
        const white = wrapWhite(restRaw, boldSize);
        const bs = white.size;
        const ss = keyRaw ? fit(scriptFam, keyRaw, scriptSize) : scriptSize;
        const fade = `\\fad(90,60)`;
        // The reference carries almost no outline — legibility comes from a
        // soft drop shadow, not a hard stroke. A heavy \bord was the biggest
        // visual difference in the first comparison passes.
        const edge = (size) => `\\3c&H70000000&\\bord${Math.max(2, Math.round(size / 42))}\\4c&H8C000000&\\shad${Math.max(2, Math.round(size / 26))}\\blur1.2`;
        // bold rows — the readable body text, always white, never cursive.
        // Multi-line white stacks UPWARD so the last line keeps its anchor
        // and the script row underneath never moves.
        const lineH = Math.round(bs * 1.22);
        const anchor = keyRaw ? yBold : yWhiteOnly;
        white.lines.forEach((ln, i) => {
          const y = anchor - (white.lines.length - 1 - i) * lineH;
          E(1, group[0].start, gEnd, `{\\an5\\pos(${cx},${y})\\fn${boldFam}\\fs${bs}\\b0\\c&HFFFFFF&${edge(bs)}${fade}}${assEscape(ln)}`);
        });
        // script row — the cyan key word, sitting just under the bold line.
        // scy86: the reference script is wider-and-shorter than any free
        // connected script (measured h/w 0.320 vs Satisfy's 0.439); a light
        // vertical squeeze lands the proportion without visible distortion
        // and stops the ascenders colliding with the bold row.
        if (keyRaw) {
          E(1, group[0].start, gEnd, `{\\an5\\pos(${cx},${restRaw ? yScript : yWhiteOnly})\\fn${scriptFam}\\fs${ss}\\fscy86\\b0\\c${st.highlight || AQUA}&${edge(ss * 0.55)}${fade}}${assEscape(keyRaw)}`);
        }
      } else if (st.motion === 'glow') {
        // Three stacked passes per word — wide ambient halo, tight inner
        // glow, crisp core — then the spoken word re-lights brighter. The
        // halo carries the legibility, so the core needs only a hairline
        // dark edge instead of the usual heavy outline.
        const pos = layoutGroup(fam, tokens, baseSize, geo, bottomY);
        // Hard handoff: this group must be gone the instant the next one
        // starts. gEnd's 0.1s tail would leave both layouts on screen (they
        // sit at different line heights, so it reads as doubled text).
        const gOut = groups[gi + 1] ? Math.min(gEnd, groups[gi + 1][0].start) : gEnd;
        pos.forEach((p, i) => {
          const x = Math.round(p.x), y = Math.round(p.y);
          const fsTag = Math.round(p.size) !== baseSize ? `\\fs${Math.round(p.size)}` : '';
          const t = assEscape(p.txt);
          const halo = Math.max(6, Math.round(p.size * 0.2));
          const inner = Math.max(3, Math.round(p.size * 0.085));
          const fade = `\\fad(220,140)`;
          E(0, group[0].start, gOut, `{\\an5\\pos(${x},${y})${fsTag}\\1c${hi}&\\3c${hi}&\\bord${halo}\\blur${Math.round(p.size * 0.16)}\\alpha&H86&\\shad0${fade}}${t}`);
          E(1, group[0].start, gOut, `{\\an5\\pos(${x},${y})${fsTag}\\1c${hi}&\\3c${hi}&\\bord${inner}\\blur${Math.round(p.size * 0.06)}\\alpha&H3C&\\shad0${fade}}${t}`);
          E(2, group[0].start, gOut, `{\\an5\\pos(${x},${y})${fsTag}\\c&HFFFFFF&\\3c&H50000000&\\bord${Math.max(2, Math.round(p.size / 26))}\\blur1.2\\shad0${fade}${scaleChain(94, 300, easeOutExpo, 5)}}${t}`);
        });
        beats.forEach((b, i) => {
          b = { from: b.from, to: Math.min(b.to, gOut) };
          if (b.to - b.from < 0.05) return;
          const p = pos[i];
          const x = Math.round(p.x), y = Math.round(p.y);
          const fsTag = Math.round(p.size) !== baseSize ? `\\fs${Math.round(p.size)}` : '';
          const t = assEscape(p.txt);
          const flare = Math.max(8, Math.round(p.size * 0.3));
          E(3, b.from, b.to, `{\\an5\\pos(${x},${y})${fsTag}\\1c${hi}&\\3c${hi}&\\bord${flare}\\blur${Math.round(p.size * 0.22)}\\alpha&H5A&\\shad0\\t(0,180,\\alpha&H74&)}${t}`);
          E(4, b.from, b.to, `{\\an5\\pos(${x},${y})${fsTag}\\c&HFFFFFF&\\3c${hi}&\\bord${Math.max(3, Math.round(p.size / 14))}\\blur3\\shad0\\fscx104\\fscy104\\t(0,150,\\fscx100\\fscy100)}${t}`);
        });
      } else if (st.motion === 'gravedad') {
        // Gravity: words free-fall, squash on impact, then take one small
        // second hop before settling — real bounce physics, staggered.
        pos.forEach((p, i) => {
          const x = Math.round(p.x), y = Math.round(p.y);
          const d = i * 90 + (((i * 73) % 7) - 3) * 5; // human jitter — never metronome-even
          const t0 = group[0].start;
          const landAt = t0 + (170 + d) / 1000;
          const hopAt = landAt + 0.13;
          const squash = `\\t(${170 + d},${215 + d},\\fscy74\\fscx120)\\t(${215 + d},${285 + d},\\fscy104\\fscx98)`;
          // fall + impact squash
          E(1, t0, hopAt, `{\\an5\\move(${x},${y - Math.round(120 + 90 * EN(group[i]))},${x},${y},${d},${170 + d})\\alpha&HFF&\\t(${d},${d + 30},\\alpha&H00&)${squash}\\c${wordColor(group[i])}&}${assEscape(p.txt)}`);
          // small second hop up...
          E(1, hopAt, hopAt + 0.09, `{\\an5\\move(${x},${y},${x},${y - 16},0,90)\\c${wordColor(group[i])}&}${assEscape(p.txt)}`);
          // ...and down, tiny squash, rest
          E(1, hopAt + 0.09, gEnd, `{\\an5\\move(${x},${y - 16},${x},${y},0,80)\\t(80,120,\\fscy94)\\t(120,180,\\fscy100)\\c${wordColor(group[i])}&}${assEscape(p.txt)}`);
        });
      }

      // ---- exit choreography ---------------------------------------------
      // Groups don't vanish — they LEAVE with their own physics while the
      // next phrase enters (golpe excluded: hard cuts ARE that style).
      const nextStart = groups[gi + 1] ? groups[gi + 1][0].start : null;
      if (nextStart !== null && pos && st.motion !== 'golpe') {
        const xEnd = gEnd + 0.22;
        pos.forEach((p, i) => {
          const x = Math.round(p.x), y = Math.round(p.y);
          const dj = ((i * 73) % 7) * 6; // human-feel stagger (never metronome-even)
          const txt = assEscape(p.txt);
          if (st.motion === 'cascada' || st.motion === 'gravedad') {
            E(1, gEnd, xEnd, `{\\an5\\move(${x},${y},${x},${y + 190},${dj},${dj + 190})\\t(0,200,\\frz${i % 2 ? 14 : -14})\\t(60,220,\\alpha&HFF&)\\c${WHITE}&}${txt}`);
          } else if (st.motion === 'resorte') {
            E(1, gEnd, xEnd, `{\\an5\\pos(${x},${y})\\t(0,90,\\fscx116\\fscy116)\\t(90,210,\\fscx4\\fscy4\\alpha&HFF&)\\c${WHITE}&}${txt}`);
          } else if (st.motion === 'maquina' || st.motion === 'enfoque') {
            E(1, gEnd, xEnd, `{\\an5\\pos(${x},${y})${blurChain(0.8, 10, 200, easeOutExpo, 4)}\\t(40,210,\\alpha&HFF&)\\c${WHITE}&}${txt}`);
          } else if (st.motion === 'ola') {
            E(1, gEnd, xEnd, `{\\an5\\move(${x},${y},${x},${y + 70},${dj},${dj + 180})\\t(40,200,\\alpha&HFF&)\\c${WHITE}&}${txt}`);
          } else if (st.motion === 'neonvivo') {
            E(1, gEnd, xEnd, `{\\an5\\pos(${x},${y})\\t(0,40,\\alpha&HB0&)\\t(40,80,\\alpha&H30&)\\t(80,150,\\alpha&HFF&)\\bord3\\3c${i % 2 ? PINK : CYAN}&\\blur4\\c&HFFFFFF&}${txt}`);
          } else if (st.motion === 'recorte') {
            E(1, gEnd, xEnd, `{\\an5\\move(${x},${y},${x + 40},${y - 60},${dj},${dj + 200})\\frz${((i * 37) % 7) - 3}\\t(0,200,\\frz${((i * 37) % 7) + 12})\\t(60,210,\\alpha&HFF&)\\c${DARKTXT}&\\bord${Math.round(p.size / 6)}\\3c&HFFFFFF&}${txt}`);
          } else if (st.motion === 'cinta') {
            E(1, gEnd, xEnd, `{\\an5\\move(${x},${y},${x - geo.w},${y},${dj},${dj + 230})\\c${WHITE}&}${txt}`);
          }
        });
      }
    } else if (st.kinetic === 'pill') {
      // The whole phrase is visible; a pill GLIDES from word to word on the
      // spoken beat (layer 0 = pill drawing, layer 1 = text).
      const pos = layoutGroup(fam, tokens, baseSize, geo, bottomY);
      const pillBg = (st.pill && st.pill.bg) || YELLOW;
      const pillFg = (st.pill && st.pill.fg) || DARKTXT;
      for (let i = 0; i < group.length; i++) {
        const from = group[i].start;
        const to = i < group.length - 1 ? group[i + 1].start : gEnd;
        if (to - from < 0.01) continue;
        const p = pos[i];
        const w2 = Math.round(p.w / 2 + p.size * 0.18);
        const h2 = Math.round(p.size * 0.6);
        const posTag = i === 0
          ? `\\pos(${Math.round(p.x)},${Math.round(p.y)})`
          : `\\move(${Math.round(pos[i - 1].x)},${Math.round(pos[i - 1].y)},${Math.round(p.x)},${Math.round(p.y)},0,130)`;
        // \bord on a drawing rounds the rect corners in the pill color.
        // Coordinates MUST start at the origin — libass only centers (an5)
        // drawings whose bbox is measured from (0,0); negative extents drift.
        E(0, from, to, `{\\an5${posTag}\\1c${pillBg}&\\3c${pillBg}&\\bord${Math.round(p.size * 0.18)}\\shad0\\p1}m 0 0 l ${w2 * 2} 0 ${w2 * 2} ${h2 * 2} 0 ${h2 * 2}{\\p0}`);
        pos.forEach((q, j) => {
          const fsTag = Math.round(q.size) !== baseSize ? `\\fs${Math.round(q.size)}` : '';
          const color = j === i ? pillFg : wordColor(group[j]);
          // the word ON the pill drops its outline — dark-on-yellow reads clean
          const flat = j === i ? `\\bord0\\shad0` : '';
          const intro = i === 0 ? `\\fad(80,0)` : '';
          E(1, from, to, `{\\an5\\pos(${Math.round(q.x)},${Math.round(q.y)})${fsTag}\\c${color}&${flat}${intro}}${assEscape(q.txt)}`);
        });
      }
    } else if (st.kinetic === 'hero') {
      // Art-directed stack: the most important word gets its own line, HUGE
      // and in the highlight color; the rest sit small above/below it.
      let heroIdx = group.findIndex((w) => w.emp);
      if (heroIdx < 0) heroIdx = group.findIndex((w) => isNumberWord(w.word) || isCtaWord(w.word));
      if (heroIdx < 0) heroIdx = group.reduce((bi, w, i) => (String(w.word).length > String(group[bi].word).length ? i : bi), 0);
      const smallSize = Math.round(baseSize * 0.58);
      const heroTok = tokens[heroIdx].txt;
      let heroSize = Math.round(baseSize * 1.6);
      const maxW = geo.w * 0.9;
      if (textW(fam, heroTok, heroSize) > maxW) heroSize = Math.floor(heroSize * (maxW / textW(fam, heroTok, heroSize)));
      const rows = [];
      const joinTokens = (arr) => arr.map((t) => t.txt).join(' ');
      if (heroIdx > 0) rows.push({ text: joinTokens(tokens.slice(0, heroIdx)), size: smallSize, color: WHITE });
      rows.push({ text: heroTok, size: heroSize, color: st.highlight || GOLD, hero: true });
      if (heroIdx < tokens.length - 1) rows.push({ text: joinTokens(tokens.slice(heroIdx + 1)), size: smallSize, color: WHITE });
      let y = bottomY;
      for (let r = rows.length - 1; r >= 0; r--) { rows[r].y = y; y -= Math.round(rows[r].size * 1.22); }
      const cx = Math.round(geo.w / 2);
      for (const row of rows) {
        let sz = row.size;
        if (textW(fam, row.text, sz) > geo.w * 0.9) sz = Math.floor(sz * ((geo.w * 0.9) / textW(fam, row.text, sz)));
        const enter = row.hero
          ? `\\fscx145\\fscy145\\blur5\\t(0,120,\\fscx100\\fscy100\\blur0)`
          : `\\fad(110,0)`;
        E(1, group[0].start, gEnd, `{\\an5\\pos(${cx},${row.y})\\fs${sz}\\c${row.color}&${enter}}${assEscape(row.text)}`);
      }
    }
  }
  return header.concat(lines).join('\n') + '\n';
}

function hookLine(opts) {
  if (!opts.hookTitle) return [];
  const hookEnd = Math.max(1.2, Math.min(2.8, (opts.totalDur || 2.8) - 0.2));
  // {\q0} = smart wrapping for this line only (WrapStyle 2 disables it
  // globally so caption groups never wrap) — long hooks fold into 2 lines
  // instead of running off both edges.
  return [`Dialogue: 1,${toAssTime(0)},${toAssTime(hookEnd)},Hook,,0,0,0,,{\\q0}${assEscape(opts.hookTitle).toUpperCase()}`];
}

function buildAss(words, styleKey, aspectKey, opts = {}) {
  const geo = ASPECTS[aspectKey] || ASPECTS['9:16'];
  const st = applyAccent(STYLES[styleKey] || STYLES.boldpop, opts.accent);
  const fontsize = Math.round(geo.fontsize * (st.scale || 1) * (opts.sizeScale || 1));
  const header = assHeader(geo, st, fontsize, opts.contrast || 0);
  const lines = hookLine(opts);

  // Emphasized (AI-tagged) words render gold+bigger (or italic+bigger for
  // emphItalic styles) at all times; the active-word paint walks across the
  // non-emphasized ones.
  const empSize = Math.round(fontsize * 1.18);
  const empOpen = st.emphItalic ? `{\\i1\\fs${empSize}}` : `{\\c${GOLD}&\\fs${empSize}}`;
  const empClose = st.emphItalic ? `{\\i0\\fs${fontsize}}` : `{\\c${WHITE}&\\fs${fontsize}}`;
  // Soft stroke edge on every caption (harsh burned strokes read "stock").
  const SOFT = `{\\blur0.8}`;
  // Per-style caption-group entrances: each personality arrives differently.
  // Blur transitions settle at 0.8 (not 0) so the soft edge survives them.
  const ENTRANCES = {
    rise: `{\\fscy82\\t(0,90,\\fscy100)}`,
    slam: `{\\fscx128\\fscy128\\blur4\\t(0,100,\\fscx100\\fscy100\\blur0.8)}`,
    fade: `{\\alpha&HFF&\\blur6\\t(0,160,\\alpha&H00&\\blur0.8)}`,
    flicker: `{\\alpha&HFF&\\t(0,40,\\alpha&H00&)\\t(40,80,\\alpha&H90&)\\t(80,140,\\alpha&H00&)}`,
    wobble: `{\\frz-4\\fscy85\\t(0,140,\\frz0\\fscy100)}`,
  };
  const entrance = ENTRANCES[st.entrance] || ENTRANCES.rise;
  // pop styles: the active word lands slightly oversized and settles in 120ms
  const popOpen = `{\\fscx116\\fscy116\\t(0,120,\\fscx100\\fscy100)}`;
  const popClose = `{\\fscx100\\fscy100}`;
  // Active-word treatments: plain color paint, chunky pill, or neon glow.
  // temblor: the active emphasized word vibrates with a squash-stretch
  // jitter for its beat (glyph-scale only — safe mid-line, unlike \frz).
  const shakeOpen = `{\\t(0,45,\\fscx114\\fscy88)\\t(45,90,\\fscx90\\fscy112)\\t(90,140,\\fscx108\\fscy94)\\t(140,190,\\fscx100\\fscy100)}`;
  const paintWord = (body, isEmp) => {
    let paint;
    if (st.pill) paint = `{\\bord${Math.max(8, Math.round(fontsize / 3.4))}\\3c${st.pill.bg}&\\c${st.pill.fg}&}${body}{\\r\\blur0.8}`;
    else if (st.glow) paint = `{\\bord${Math.max(4, Math.round(fontsize / 8))}\\3c${st.glow}&\\blur7\\c&HFFFFFF&}${body}{\\r\\blur0.8}`;
    else paint = `{\\c${st.highlight}&}${body}{\\c${WHITE}&}`;
    if (st.shake && isEmp) return `${shakeOpen}${paint}{\\fscx100\\fscy100}`;
    return st.pop ? `${popOpen}${paint}${popClose}` : paint;
  };
  // Word-kind treatments (standing, i.e. visible the whole group, active
  // paint still takes over on the spoken beat): numbers bigger + colored,
  // CTA words pilled (color-bolded instead on box styles — an inline \bord
  // inside BorderStyle=3 would inflate the box).
  const numSize = Math.round(fontsize * 1.3);
  const kindColor = st.highlight || GOLD;
  const ctaBg = (st.pill && st.pill.bg) || kindColor;
  const ctaFg = (st.pill && st.pill.fg) || DARKTXT;
  const numPaint = (body) => `{\\fs${numSize}\\c${kindColor}&}${body}{\\fs${fontsize}\\c${WHITE}&}`;
  const ctaPaint = st.border === 'box'
    ? (body) => `{\\c${kindColor}&}${body}{\\c${WHITE}&}`
    : (body) => `{\\bord${Math.max(8, Math.round(fontsize / 3.4))}\\3c${ctaBg}&\\c${ctaFg}&}${body}{\\r\\blur0.8}`;

  // mixto: ONE word per group renders in the script face — lowercase, bigger,
  // in the highlight color — inline with the heavy caps (the mixed-typeface
  // signature). contorno: words are hollow (transparent fill, white outline)
  // until spoken, then fill solid in the highlight color.
  const mixSize = Math.round(fontsize * 1.8); // script faces run small — oversize so it reads elegant, not timid
  const mixPaint = (raw) => `{\\fn${st.mixFont}\\fs${mixSize}\\c${st.highlight || GOLD}&\\bord${Math.max(3, Math.round(fontsize / 22))}}${assEscape(String(raw).toLowerCase())}{\\fn${st.font}\\fs${fontsize}\\c${WHITE}&\\bord${Math.round(fontsize / 8.5)}}`;
  const hollowWrap = (body) => `{\\1a&HFF&\\3c&HFFFFFF&}${body}{\\1a&H00&\\3c&H000000&}`;
  const solidFill = (body) => `{\\c${st.highlight || YELLOW}&\\3c&H000000&}${body}{\\c${WHITE}&}`;

  const perWord = !!(st.highlight || st.pill || st.glow);
  const groups = groupWords(words, st.wordsPerGroup);
  let gi = -1;
  for (const group of groups) {
    gi++;
    // escenario: each phrase lands with a slight alternating hand-made tilt
    const tilt = st.center ? `{\\frz${gi % 2 ? '-1.6' : '1.6'}}` : '';
    // mixto: pick this group's script word (emphasis > number/CTA > longest)
    let mixIdx = -1;
    if (st.mixFont) {
      mixIdx = group.findIndex((w) => w.emp);
      if (mixIdx < 0) mixIdx = group.findIndex((w) => isNumberWord(w.word) || isCtaWord(w.word));
      if (mixIdx < 0) mixIdx = group.reduce((bi, w, i) => (String(w.word).length > String(group[bi].word).length ? i : bi), 0);
    }
    const texts = group.map((w) => {
      const t = assEscape(w.word);
      return {
        txt: st.upper ? t.toUpperCase() : t, emp: !!w.emp, emoji: w.emoji || null,
        kind: isNumberWord(w.word) ? 'num' : isCtaWord(w.word) ? 'cta' : null,
      };
    });
    // Emoji do NOT go into the caption text — Cloud Run's libass draws tofu
    // for them no matter which font we ship. They render as PNG bursts above
    // the captions instead (see the emoji-burst overlays in renderClip).
    const withEmoji = (x) => x.txt;
    // Karaoke fill (fluido): one dialogue per group, color sweeps across each
    // word for exactly its spoken duration (\kf in centiseconds; secondary
    // colour = white pre-fill, primary = highlight post-fill).
    if (st.fill) {
      const kf = texts.map((x, idx) => {
        const from = group[idx].start;
        const to = idx < group.length - 1 ? group[idx + 1].start : group[idx].end;
        return `{\\kf${Math.max(1, Math.round((to - from) * 100))}}${withEmoji(x, idx)}`;
      }).join(' ');
      lines.push(`Dialogue: 0,${toAssTime(group[0].start)},${toAssTime(group[group.length - 1].end)},Cap,,0,0,0,,${SOFT}${tilt}${entrance}{\\1c${st.highlight || GOLD}&\\2c&H00FFFFFF&}${kf}`);
      continue;
    }
    if (!perWord) {
      // One dialogue per group, no per-word paint.
      const text = texts.map((x, j) => {
        const body = withEmoji(x, j);
        if (x.kind === 'num') return numPaint(body);
        if (x.kind === 'cta') return ctaPaint(body);
        return x.emp ? `${empOpen}${body}${empClose}` : body;
      }).join(' ');
      lines.push(`Dialogue: 0,${toAssTime(group[0].start)},${toAssTime(group[group.length - 1].end)},Cap,,0,0,0,,${SOFT}${tilt}${entrance}${text}`);
      continue;
    }
    // One dialogue per word: full group shown, the spoken word painted. The
    // first dialogue of each group rises in (90ms) so caption changes feel
    // alive instead of teleporting.
    for (let i = 0; i < group.length; i++) {
      const from = i === 0 ? group[0].start : group[i].start;
      const to = i < group.length - 1 ? group[i + 1].start : group[group.length - 1].end;
      if (to - from < 0.01) continue;
      const intro = (i === 0 ? entrance : '') + tilt;
      const text = texts
        .map((x, j) => {
          const body = withEmoji(x, j);
          // mixto's script word keeps its treatment even on the spoken beat
          if (st.mixFont && j === mixIdx) return mixPaint(group[j].word);
          if (st.hollow) return j === i ? solidFill(body) : hollowWrap(body);
          if (j === i) return paintWord(body, x.emp); // spoken beat always wins
          if (x.kind === 'num') return numPaint(body);
          if (x.kind === 'cta') return ctaPaint(body);
          if (x.emp) return `${empOpen}${body}${empClose}`;
          return body;
        })
        .join(' ');
      lines.push(`Dialogue: 0,${toAssTime(from)},${toAssTime(to)},Cap,,0,0,0,,${SOFT}${intro}${text}`);
    }
  }

  return header.concat(lines).join('\n') + '\n';
}

// Pre-translated caption groups (e.g. the EN version of a Spanish clip):
// one dialogue per group, no per-word karaoke — timing comes from the group.
function buildAssFromGroups(groups, styleKey, aspectKey, opts = {}) {
  const geo = ASPECTS[aspectKey] || ASPECTS['9:16'];
  const st = applyAccent(STYLES[styleKey] || STYLES.boldpop, opts.accent);
  const fontsize = Math.round(geo.fontsize * (st.scale || 1));
  const header = assHeader(geo, st, fontsize, opts.contrast || 0);
  const lines = hookLine(opts);
  for (const g of groups) {
    if (!(g && typeof g.text === 'string' && g.text.trim())) continue;
    const text = st.upper ? assEscape(g.text).toUpperCase() : assEscape(g.text);
    lines.push(`Dialogue: 0,${toAssTime(g.start)},${toAssTime(g.end)},Cap,,0,0,0,,{\\q0\\blur0.8}${text}`);
  }
  return header.concat(lines).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// silence removal: keep-segments from word gaps + caption remapping
// ---------------------------------------------------------------------------

// Word hierarchy: certain word KINDS get art direction beyond the spoken-word
// paint — numbers/prices render bigger in the highlight color, and a small
// CTA lexicon (deliberately conservative — high-frequency Spanish words like
// "ya"/"solo" excluded) gets a standing pill so offers jump out.
const CTA_WORDS = new Set(['gratis', 'hoy', 'ahora', 'nuevo', 'nueva', 'oferta', 'descuento', 'promo', 'link', 'bio', 'free', 'today', 'now', 'new']);
const stripPunct = (w) => String(w).toLowerCase().replace(/[.,!?…¿¡:;"'()]+/g, '').trim();
const isNumberWord = (w) => /[\d$%€]/.test(String(w));
const isCtaWord = (w) => CTA_WORDS.has(stripPunct(w));

// Pure vocal fillers safe to cut in EN + ES. Deliberately conservative:
// words like "este"/"pues"/"like" carry real meaning too often.
const FILLERS = new Set(['um', 'uh', 'uhm', 'umm', 'uhh', 'hmm', 'mm', 'mmm', 'mhm', 'huh', 'er', 'erm', 'eh', 'ehh']);
const isFiller = (w) => FILLERS.has(String(w).toLowerCase().replace(/[.,!?…¿¡]+/g, '').trim());

// Words (clip-local time) -> segments of speech to KEEP. Gaps between words
// longer than maxGap become jump cuts, and any span in `breaks` (removed
// filler words) forces a cut too. Silence boundaries get breathing room
// (pad) so cuts don't clip consonants; filler boundaries cut tight (0.03s)
// so the "um" actually disappears.
function buildKeepSegments(words, clipDur, { pad = 0.22, maxGap = 1.0, breaks = [] } = {}) {
  if (!words.length) return [{ start: 0, end: clipDur }];
  const hasBreak = (a, b) => breaks.some((x) => x.start >= a - 0.06 && x.end <= b + 0.06);
  const raw = [];
  let segStart = words[0].start, segEnd = words[0].end, padBefore = pad;
  for (let i = 1; i <= words.length; i++) {
    const next = words[i];
    const gap = next ? next.start - segEnd : Infinity;
    const fillerCut = next ? hasBreak(segEnd, next.start) : false;
    if (!next || gap > maxGap || fillerCut) {
      raw.push({ start: segStart, end: segEnd, padBefore, padAfter: fillerCut ? 0.03 : pad });
      if (next) { segStart = next.start; segEnd = next.end; padBefore = fillerCut ? 0.03 : pad; }
    } else {
      segEnd = Math.max(segEnd, next.end);
    }
  }
  // apply pads, then clamp so neighbouring segments never overlap
  const out = raw.map((g) => ({ start: Math.max(0, g.start - g.padBefore), end: Math.min(clipDur, g.end + g.padAfter) }));
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].end + 0.01) {
      const mid = (raw[i].start + raw[i - 1].end) / 2;
      out[i - 1].end = Math.min(out[i - 1].end, Math.max(raw[i - 1].end, mid - 0.005));
      out[i].start = Math.max(out[i].start, Math.min(raw[i].start, mid + 0.005));
    }
  }
  return out.filter((g) => g.end - g.start > 0.05);
}

// Shift word timestamps onto the post-cut timeline so captions stay in sync.
function remapWords(words, segs) {
  const out = [];
  let acc = 0;
  for (const seg of segs) {
    for (const w of words) {
      if (w.start >= seg.start - 0.02 && w.start < seg.end) {
        out.push({
          word: w.word,
          emp: !!w.emp,
          emoji: w.emoji || null,
          energy: w.energy,
          start: acc + Math.max(0, w.start - seg.start),
          end: acc + Math.min(seg.end - seg.start, Math.max(0.05, w.end - seg.start)),
        });
      }
    }
    acc += seg.end - seg.start;
  }
  return { words: out, totalDur: acc };
}

// Smart direction: how LOUD was each word actually said? Per-word RMS from
// the source audio (8kHz mono PCM), normalized against the clip's 90th
// percentile -> w.energy in [0.4, 1.3]. Motion styles scale their physics
// with it — louder delivery hits harder, soft moments land softer.
function computeWordEnergy(dir, start, clipDur, words, log = () => {}) {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(clipDur),
      '-i', 'source.mp4', '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', 'loud.pcm'], { cwd: dir });
    const buf = fs.readFileSync(path.join(dir, 'loud.pcm'));
    const n = buf.length >> 1;
    const rms = words.map((w) => {
      const a = Math.max(0, Math.floor(w.start * 8000));
      const b = Math.min(n, Math.ceil(w.end * 8000));
      let s = 0, c = 0;
      for (let i = a; i < b; i++) { const v = buf.readInt16LE(i * 2); s += v * v; c++; }
      return c ? Math.sqrt(s / c) : 0;
    });
    const sorted = rms.filter((x) => x > 0).sort((x, y) => x - y);
    const hi = sorted[Math.floor(sorted.length * 0.9)] || 1;
    words.forEach((w, i) => { w.energy = Math.max(0.4, Math.min(1.3, rms[i] / hi)); });
    fs.rmSync(path.join(dir, 'loud.pcm'), { force: true });
    log('word energy: loudness-reactive motion enabled');
  } catch (e) {
    log(`word energy skipped (${e.message})`);
    words.forEach((w) => { w.energy = 0.8; });
  }
}

// ---------------------------------------------------------------------------
// auto speaker tracking (framing: 'auto'): sample frames -> Google Vision face
// detection -> smoothed pan keyframes -> dynamic crop x expression.
// ---------------------------------------------------------------------------
const SAMPLE_W = 480; // width of the low-res frames sent to Vision

async function getGcpToken() {
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!res.ok) throw new Error(`metadata token ${res.status}`);
  return (await res.json()).access_token;
}

// Sample ~1fps and return every face per frame: [{t, faces:[{cx,x0,x1,area}]}].
async function sampleFaces(dir, start, clipDur, log) {
  const rate = Math.min(1, 60 / clipDur);
  const facesDir = path.join(dir, 'faces');
  fs.mkdirSync(facesDir, { recursive: true });
  ff(dir, ['-ss', String(start), '-t', String(clipDur), '-i', 'source.mp4',
    '-vf', `fps=${rate.toFixed(4)},scale=${SAMPLE_W}:-2`, '-q:v', '5', 'faces/f%04d.jpg']);
  const files = fs.readdirSync(facesDir).filter((f) => f.endsWith('.jpg')).sort();
  if (!files.length) return { frames: [], rate };

  const token = await getGcpToken();
  const frames = files.map((_, i) => ({ t: (i + 0.5) / rate, faces: [] }));
  for (let ofs = 0; ofs < files.length; ofs += 16) {
    const batch = files.slice(ofs, ofs + 16);
    const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map((f) => ({
          image: { content: fs.readFileSync(path.join(facesDir, f)).toString('base64') },
          features: [{ type: 'FACE_DETECTION', maxResults: 5 }],
        })),
      }),
    });
    if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    (data.responses || []).forEach((r, i) => {
      for (const face of r.faceAnnotations || []) {
        const v = (face.boundingPoly || {}).vertices || [];
        if (v.length < 3) continue;
        const xs = v.map((p) => p.x || 0), ys = v.map((p) => p.y || 0);
        const x0 = Math.min(...xs) / SAMPLE_W, x1 = Math.max(...xs) / SAMPLE_W;
        frames[ofs + i].faces.push({
          cx: (x0 + x1) / 2,
          x0: Math.max(0, x0), x1: Math.min(1, x1),
          area: (x1 - x0) * ((Math.max(...ys) - Math.min(...ys)) / SAMPLE_W),
        });
      }
    });
  }
  const withFaces = frames.filter((f) => f.faces.length).length;
  log(`face sampling: ${withFaces}/${frames.length} frames with faces`);
  return { frames, rate };
}

// Decide how to frame a multi/single-person shot.
//   cropFrac = the fraction of the source width a full-height crop can show.
// Returns { mode:'track', keyframes } | { mode:'wide', x0, x1 } | null.
function decideFraming(frames, rate, cropFrac) {
  const detections = frames.flatMap((f) => f.faces.map((face) => ({ ...face, t: f.t })));
  if (!detections.length) return null;

  // Cluster faces by x-position into "persons" (interview shots are static).
  const clusters = [];
  for (const d of detections) {
    const hit = clusters.find((c) => Math.abs(c.center - d.cx) < 0.1);
    if (hit) {
      hit.center = (hit.center * hit.n + d.cx) / (hit.n + 1);
      hit.n += 1;
      hit.x0 = Math.min(hit.x0, d.x0);
      hit.x1 = Math.max(hit.x1, d.x1);
      hit.area += d.area;
    } else {
      clusters.push({ center: d.cx, n: 1, x0: d.x0, x1: d.x1, area: d.area });
    }
  }
  const framesWithFaces = frames.filter((f) => f.faces.length).length;
  const persistent = clusters.filter((c) => c.n >= Math.max(2, framesWithFaces * 0.2));
  if (!persistent.length) return null;

  // Multiple people wider than the crop can hold -> wide (blurred-band) layout.
  if (persistent.length >= 2) {
    const x0 = Math.min(...persistent.map((c) => c.x0));
    const x1 = Math.max(...persistent.map((c) => c.x1));
    if (x1 - x0 + 0.1 > cropFrac * 0.95) {
      return { mode: 'wide', x0: Math.max(0, x0 - 0.05), x1: Math.min(1, x1 + 0.05) };
    }
  }

  // Single person (or a tight group): track the dominant cluster like before.
  const main = persistent.sort((a, b) => b.area - a.area)[0];
  const centers = frames.map((f) => {
    const near = f.faces.filter((face) => Math.abs(face.cx - main.center) < 0.15);
    if (!near.length) return null;
    return near.sort((a, b) => b.area - a.area)[0].cx;
  });
  if (centers.every((c) => c == null)) return null;
  let last = centers.find((c) => c != null);
  const filled = centers.map((c) => (c != null ? (last = c) : last));
  const smoothed = filled.map((_, i) => {
    const win = filled.slice(Math.max(0, i - 1), i + 2);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
  const step = 1 / rate;
  const maxDelta = 0.08 * step; // ≤8% of the width per second
  for (let i = 1; i < smoothed.length; i++) {
    const d = smoothed[i] - smoothed[i - 1];
    if (Math.abs(d) > maxDelta) smoothed[i] = smoothed[i - 1] + Math.sign(d) * maxDelta;
  }
  return { mode: 'track', keyframes: smoothed.map((cx, i) => ({ t: (i + 0.5) * step, cx })) };
}

// Keyframes -> ffmpeg crop x expression (piecewise-linear pan, clamped to the
// frame). Evaluated per output frame because it references t.
function faceCropExpr(keyframes) {
  let expr = keyframes[keyframes.length - 1].cx.toFixed(4);
  for (let i = keyframes.length - 2; i >= 0; i--) {
    const a = keyframes[i], b = keyframes[i + 1];
    const slope = (b.cx - a.cx) / Math.max(0.001, b.t - a.t);
    expr = `if(lt(t,${b.t.toFixed(2)}),${a.cx.toFixed(4)}+${slope.toFixed(5)}*(t-${a.t.toFixed(2)}),${expr})`;
  }
  return `clip((${expr})*iw-ow/2,0,iw-ow)`;
}

// ---------------------------------------------------------------------------
// song teaser: a window of a catalog song over its cover art (slow Ken Burns),
// karaoke captions from the song's word timestamps, brand end-card, audio fades.
// ---------------------------------------------------------------------------
const SERIF = process.env.SERIF_PATH || path.join(__dirname, 'assets', 'serif.ttf');
const LOGO = process.env.LOGO_PATH || path.join(__dirname, 'assets', 'logo.png');
const WHOOSH = process.env.WHOOSH_PATH || path.join(__dirname, 'assets', 'whoosh.mp3');
const POP = process.env.POP_PATH || path.join(__dirname, 'assets', 'pop.mp3');
// Bundled monochrome Noto Emoji (OFL) — loaded via the subtitles filter's
// fontsdir so {\fnNoto Emoji} resolves without any system font packages.
const EMOJI_FONT = process.env.EMOJI_FONT_PATH || path.join(__dirname, 'assets', 'NotoEmoji-Regular.ttf');
// Emoji bursts: full-color Noto PNGs (Apache-2.0) overlaid above the captions.
// The AI is constrained to exactly this set (see tagEmoji in the edge fn).
const EMOJI_DIR = process.env.EMOJI_DIR || path.join(__dirname, 'assets', 'emoji');
const EMOJI_PNG = {
  '🎁': 'u1f381', '🎶': 'u1f3b6', '🎵': 'u1f3b5', '❤': 'u2764', '❤️': 'u2764',
  '😍': 'u1f60d', '😭': 'u1f62d', '🔥': 'u1f525', '🎉': 'u1f389', '👏': 'u1f44f',
  '💯': 'u1f4af', '⭐': 'u2b50', '🙌': 'u1f64c', '💝': 'u1f49d', '🌹': 'u1f339',
  '🎂': 'u1f382', '🥰': 'u1f970', '😱': 'u1f631', '🤯': 'u1f92f', '💛': 'u1f49b', '😊': 'u1f60a',
};
const emojiAsset = (e) => {
  const key = String(e || '').replace(/️/g, '');
  const file = EMOJI_PNG[key] || EMOJI_PNG[key + '️'];
  return file ? path.join(EMOJI_DIR, `${file}.png`) : null;
};

// ---------------------------------------------------------------------------
// Brand outro (options.outro): a 2.8s end-card — RQC logo + site on the brand
// green — encoded with the exact same settings as the main clip so the two
// concat via stream copy (no full re-encode). Falls back to a re-encoding
// concat if the copy is rejected.
// ---------------------------------------------------------------------------
const OUTRO_SEC = 2.8;

function probeAudio(dir, file) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', file],
      { cwd: dir },
    ).toString().trim();
    if (!out) return null;
    const [sr, ch] = out.split(',').map((n) => parseInt(n, 10));
    return sr && ch ? { sampleRate: sr, channels: ch } : null;
  } catch { return null; }
}

// Second pass for the depth title: draw the (animated) title on the finished
// clip, then paste the person — cut out via the RVM alpha — back on top, so
// the words live BEHIND them. alphamerge ends with the short alpha stream and
// eof_action=pass leaves the rest of the clip untouched.
function applyDepthTitle(dir, geo, log) {
  fs.renameSync(path.join(dir, 'clip.mp4'), path.join(dir, 'pre-depth.mp4'));
  const filter = [
    '[0:v]subtitles=titles.ass:fontsdir=.[bg]',
    `[1:v]scale=${geo.w}:${geo.h},format=gray[am]`,
    '[0:v][am]alphamerge[pers]',
    '[bg][pers]overlay=0:0:eof_action=pass[vout]',
  ].join(';');
  ff(dir, ['-i', 'pre-depth.mp4', '-i', 'alpha.mp4', '-filter_complex', filter,
    '-map', '[vout]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
    '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', 'clip.mp4']);
  log('depth title composited behind the person');
}

// Key words behind the person: pick up to 5 well-spaced AI-emphasized words
// (skipping the intro title zone), matte a ~1.2s window around each, and pop
// the word BIG behind the speaker exactly as it's said.
function pickDepthWords(words) {
  const out = [];
  let lastT = -99;
  for (const w of words) {
    if (!w.emp || w.cut) continue;
    if (w.start < 3.5) continue;             // the intro belongs to the title
    if (w.start - lastT < 2.5) continue;     // breathing room between pops
    const clean = String(w.word).replace(/[.,!?…¿¡:;"'()]+/g, '');
    if (clean.length < 3) continue;
    out.push({ t: w.start, word: clean });
    lastT = w.start;
    if (out.length >= 5) break;
  }
  return out;
}

function buildDepthWordsAss(geo, st, windows) {
  const fam = st.font || 'Anton';
  const color = st.highlight || YELLOW;
  const cx = Math.round(geo.w / 2);
  const ev = windows.map((w) => {
    const size = Math.min(Math.round(geo.w * 0.19), Math.floor((geo.w * 0.94) / Math.max(4, w.word.length * 0.6)));
    // Anchor the word to THIS window's detected head-top: most of the word
    // sits above the head, only the bottom ~20% tucks behind it (the way
    // Captions.ai places depth text). No head found -> a high default.
    const headY = w.headTopFrac !== null && w.headTopFrac !== undefined
      ? Math.round(w.headTopFrac * geo.h) : Math.round(geo.h * 0.3);
    const y = Math.max(Math.round(geo.h * 0.05), headY - Math.round(size * 0.8));
    const anim = `{\\pos(${cx},${y})\\fs${size}\\fscx150\\fscy150\\blur6\\t(0,110,\\fscx100\\fscy100\\blur0)\\fad(0,200)}`;
    return `Dialogue: 2,${toAssTime(w.from)},${toAssTime(w.to)},DWord,,0,0,0,,${anim}${assEscape(w.word).toUpperCase()}`;
  });
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${geo.w}`, `PlayResY: ${geo.h}`,
    'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: DWord,${fam},100,${color},${color},&H78000000,&H00000000,1,0,0,0,100,100,0,0,1,5,0,8,40,40,10,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...ev,
  ].join('\n') + '\n';
}

// Composite pass: draw the pop words on the clip, then paste windowed person
// cutouts (one small alpha video per word) back on top so each word lands
// behind the speaker. setpts shifts each cutout to its window; overlay only
// fires inside the window (enable + eof_action=pass).
function applyDepthWords(dir, geo, windows, log) {
  fs.renameSync(path.join(dir, 'clip.mp4'), path.join(dir, 'pre-words.mp4'));
  // Single full-length mask (transparent between windows) — the person layer
  // always has frames, so overlay never buffers waiting for a late window.
  const filter = [
    '[0:v]subtitles=depthwords.ass:fontsdir=.[bg]',
    `[1:v]scale=${geo.w}:${geo.h},format=gray[am]`,
    '[0:v][am]alphamerge[pers]',
    '[bg][pers]overlay=0:0:eof_action=pass[vout]',
  ].join(';');
  ff(dir, ['-i', 'pre-words.mp4', '-i', 'alpha-words.mp4', '-filter_complex', filter,
    '-map', '[vout]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
    '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', 'clip.mp4']);
  log(`depth words: ${windows.length} key word(s) popped behind the person`);
}

function appendBrandOutro(dir, geo, log) {
  // Work with local copies so font/logo paths need no ffmpeg escaping.
  fs.copyFileSync(LOGO, path.join(dir, 'outro-logo.png'));
  fs.copyFileSync(SERIF, path.join(dir, 'outro-serif.ttf'));
  const audio = probeAudio(dir, 'clip.mp4');

  // White card so the full-color circular badge sits naturally; site name in
  // the logo's own navy underneath.
  const logoW = Math.round(geo.w * 0.46);
  const textSize = Math.round(geo.w * 0.05);
  const logoY = `(H-h)/2-${Math.round(geo.h * 0.05)}`;
  const textY = `(h-text_h)/2+${Math.round(geo.h * 0.16)}`;
  const filter = [
    `[1:v]scale=${logoW}:-1[logo]`,
    `[0:v][logo]overlay=(W-w)/2:${logoY}[bg]`,
    `[bg]drawtext=fontfile=outro-serif.ttf:text='regalosquecantan.com':fontcolor=0x1B2653:fontsize=${textSize}:x=(w-text_w)/2:y=${textY},fade=t=in:st=0:d=0.3:color=white,fps=30[vout]`,
  ].join(';');

  const args = [
    '-f', 'lavfi', '-i', `color=c=white:s=${geo.w}x${geo.h}:r=30:d=${OUTRO_SEC}`,
    '-i', 'outro-logo.png',
  ];
  if (audio) args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=${audio.channels === 1 ? 'mono' : 'stereo'}:sample_rate=${audio.sampleRate}`);
  args.push('-filter_complex', filter, '-map', '[vout]');
  if (audio) args.push('-map', '2:a', '-t', String(OUTRO_SEC), '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'outro.mp4');
  ff(dir, args);

  fs.renameSync(path.join(dir, 'clip.mp4'), path.join(dir, 'main.mp4'));
  fs.writeFileSync(path.join(dir, 'list.txt'), "file 'main.mp4'\nfile 'outro.mp4'\n");
  try {
    ff(dir, ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'clip.mp4']);
  } catch (e) {
    log(`outro copy-concat rejected (${e.message.slice(0, 80)}) — re-encoding join`);
    const re = ['-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
    if (audio) re.push('-c:a', 'aac', '-b:a', '192k');
    re.push('-movflags', '+faststart', 'clip.mp4');
    ff(dir, re);
  }
  log(`brand outro appended (+${OUTRO_SEC}s)`);
}
const drawEsc = (s) => String(s).replace(/\\/g, '').replace(/'/g, '’').replace(/[:%,]/g, ' ').trim();

async function renderTeaser(job, { dir, log }) {
  fs.mkdirSync(dir, { recursive: true });
  const opts = job.options || {};
  log(`teaser: downloading audio ${job.audio_src.slice(0, 100)}`);
  await download(job.audio_src, path.join(dir, 'song.mp3'));

  const start = Math.max(0, Number(job.start_sec) || 0);
  const end = Number(job.end_sec);
  if (!end || end - start < 5) throw new Error('teaser window too short');
  const D = end - start;

  const words = (job.words || [])
    .filter((w) => w.end > start + 0.05 && w.start < end - 0.05)
    .map((w) => ({ word: w.word, start: Math.max(0, w.start - start), end: Math.min(D, w.end - start) }));
  log(`teaser: ${words.length} words in ${start.toFixed(1)}-${end.toFixed(1)}s, style=${job.style}, aspect=${job.aspect}`);

  fs.writeFileSync(path.join(dir, 'captions.ass'), buildAss(words, job.style, job.aspect, {
    hookTitle: opts.hook_title_text || null,
    totalDur: D,
  }));
  fs.copyFileSync(SERIF, path.join(dir, 'serif.ttf'));

  const geo = ASPECTS[job.aspect] || ASPECTS['9:16'];
  const hasBg = !!job.bg_image_url;
  if (hasBg) await download(job.bg_image_url, path.join(dir, 'bg.jpg'));

  // Video: cover art scaled to fill, slow push-in, darkened a touch so the
  // captions carry; brand end-card fades in over the last ~2.2s.
  const endcard = job.endcard_text
    ? `,drawtext=fontfile=serif.ttf:text='${drawEsc(job.endcard_text)}':fontcolor=white:fontsize=${Math.round(geo.fontsize * 0.62)}:x=(w-text_w)/2:y=h*0.42:alpha='clip((t-${(D - 2.2).toFixed(2)})/0.4\\,0\\,1)':shadowcolor=black@0.7:shadowx=2:shadowy=2`
    : '';
  const vchain =
    `scale=${geo.w}:${geo.h}:force_original_aspect_ratio=increase,crop=${geo.w}:${geo.h},` +
    `zoompan=z='1+0.06*on/${Math.round(D * 30)}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${geo.w}x${geo.h}:fps=30,` +
    `eq=brightness=-0.04:saturation=1.05,subtitles=captions.ass${endcard}`;

  const parts = [];
  parts.push(`[0:v]${vchain}[vout]`);
  parts.push(`[1:a]afade=t=in:st=0:d=0.35,afade=t=out:st=${(D - 1.6).toFixed(2)}:d=1.6[aout]`);

  const outPath = path.join(dir, 'clip.mp4');
  const args = [];
  if (hasBg) args.push('-loop', '1', '-framerate', '30', '-t', String(D), '-i', 'bg.jpg');
  else args.push('-f', 'lavfi', '-i', `color=c=0x161219:s=${geo.w}x${geo.h}:d=${D}:r=30`);
  args.push('-ss', String(start), '-t', String(D), '-i', 'song.mp3');
  args.push('-filter_complex', parts.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', 'clip.mp4');
  ff(dir, args);

  return { finalPath: outPath, durationSec: D };
}

// ---------------------------------------------------------------------------
// render: cut (+ jump cuts) + crop/frame + optional zoom + burn captions
// ---------------------------------------------------------------------------
async function renderClip(job, { dir, log }) {
  if (job.mode === 'teaser') return renderTeaser(job, { dir, log });
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'source.mp4');
  log(`downloading source ${job.source_url.slice(0, 100)}`);
  await download(job.source_url, src);

  const opts = job.options || {};
  const start = Math.max(0, Number(job.start_sec) || 0);
  const sourceDur = probeDuration(dir, 'source.mp4');
  const end = Math.min(Number(job.end_sec) || sourceDur, sourceDur);
  if (end - start < 0.5) throw new Error(`clip range too short (${start}-${end})`);
  const clipDur = end - start;

  // Filter Whisper words to the clip range and re-base to t=0. `emp` marks
  // the AI-tagged emphasis words (matched by their absolute start time);
  // `cut` marks words the owner crossed out in the transcript editor.
  const empStarts = new Set((opts.emphasis_starts || []).map((t) => Math.round(Number(t) * 100)));
  const emojiByStart = new Map((opts.emoji_starts || []).map((x) => [Math.round(Number(x.t) * 100), String(x.e || '').slice(0, 8)]));
  let words = (job.words || [])
    .filter((w) => w.end > start + 0.05 && w.start < end - 0.05)
    .map((w) => ({
      word: w.word,
      emp: empStarts.has(Math.round(Number(w.start) * 100)),
      emoji: emojiByStart.get(Math.round(Number(w.start) * 100)) || null,
      cut: !!w.cut,
      start: Math.max(0, w.start - start),
      end: Math.min(clipDur, w.end - start),
    }));
  // Smart direction: loudness per word (pre-cut timeline — source audio).
  if (words.length && (STYLES[job.style] || {}).kinetic) computeWordEnergy(dir, start, clipDur, words, log);

  // Owner cuts: words crossed out in the transcript editor get removed from
  // audio, video AND captions — regardless of the remove_silences option.
  // Adjacent cut words merge into one span so the jump is a single cut.
  const cutSpans = [];
  for (const w of words) {
    if (!w.cut) continue;
    const prev = cutSpans[cutSpans.length - 1];
    if (prev && w.start - prev.end < 0.15) prev.end = Math.max(prev.end, w.end);
    else cutSpans.push({ start: w.start, end: w.end });
  }
  if (cutSpans.length) {
    words = words.filter((w) => !w.cut);
    log(`owner cuts: removing ${cutSpans.length} crossed-out span(s)`);
  }

  // Jump cuts: keep only speech segments (dropping filler words entirely —
  // they get cut from the audio AND never appear in the captions), then
  // remap caption timing onto the post-cut timeline.
  let segs = [{ start: 0, end: clipDur }];
  let outDur = clipDur;
  if (opts.remove_silences && words.length) {
    const fillerSpans = words.filter((w) => isFiller(w.word)).map((w) => ({ start: w.start, end: w.end }));
    if (fillerSpans.length) {
      words = words.filter((w) => !isFiller(w.word));
      log(`filler removal: cutting ${fillerSpans.length} filler word(s)`);
    }
    segs = buildKeepSegments(words, clipDur, { breaks: [...fillerSpans, ...cutSpans] });
    const remapped = remapWords(words, segs);
    words = remapped.words;
    outDur = remapped.totalDur;
    log(`silence removal: ${segs.length} segments, ${clipDur.toFixed(1)}s -> ${outDur.toFixed(1)}s`);
  } else if (cutSpans.length && words.length) {
    // No silence removal, but the crossed-out words still have to go:
    // maxGap=Infinity means ONLY the owner's cuts create segment breaks.
    segs = buildKeepSegments(words, clipDur, { breaks: cutSpans, maxGap: Infinity });
    const remapped = remapWords(words, segs);
    words = remapped.words;
    outDur = remapped.totalDur;
    log(`owner cuts: ${segs.length} segments, ${clipDur.toFixed(1)}s -> ${outDur.toFixed(1)}s`);
  }
  log(`${words.length} words, style=${job.style}, aspect=${job.aspect}, framing=${opts.framing || 'center'}, zoom=${!!opts.zoom}, hook=${!!opts.hook_title_text}`);

  // Pre-translated caption groups (EN version): group times arrive on the
  // clip-local ORIGINAL timeline and get mapped through the cuts.
  const mapCapT = (t) => {
    let acc = 0;
    for (const seg of segs) {
      if (t < seg.start) return acc;
      if (t <= seg.end) return acc + (t - seg.start);
      acc += seg.end - seg.start;
    }
    return acc;
  };
  // Template looks: color grade before the captions, a drawtext title
  // treatment instead of the ASS hook, and sticker packs on the overlays.
  const tpl = TEMPLATES[job.style] || null;
  // Depth title: the intro title composites BEHIND the person (RVM matting,
  // second pass). Not for strip/titlebar templates — their text sits on a
  // physical device that must stay in front.
  const depthMode = !!opts.depth_title && !!opts.hook_title_text
    && (!tpl || !['strip', 'titlebar'].includes(tpl.title?.mode || ''));
  const capOpts = {
    hookTitle: tpl || depthMode ? null : (opts.hook_title_text || null), totalDur: outDur,
    accent: opts.accent_color || null,
    contrast: measureCaptionBandLuma(dir, start, clipDur, log),
    sizeScale: Math.max(0.7, Math.min(1.6, Number(opts.caption_size) || 1)),
  };
  const assContent = Array.isArray(job.caption_groups) && job.caption_groups.length
    ? buildAssFromGroups(
        job.caption_groups.map((g) => ({ start: mapCapT(Number(g.start)), end: mapCapT(Number(g.end)), text: g.text })),
        job.style, job.aspect, capOpts)
    : (STYLES[job.style] && STYLES[job.style].kinetic)
      ? buildKineticAss(words, job.style, job.aspect, capOpts)
      : buildAss(words, job.style, job.aspect, capOpts);
  fs.writeFileSync(path.join(dir, 'captions.ass'), assContent);

  const geo = ASPECTS[job.aspect] || ASPECTS['9:16'];

  // Framing. 'auto' = Vision looks at who is in the shot: one person -> pan to
  // follow them; several people spread wider than the crop can hold -> 'wide'
  // (full-width band over a blurred backdrop, nobody ever cut off). 'wide' can
  // also be forced manually. Everything falls back to a center crop on errors.
  let cropX = opts.framing === 'left' ? '0' : opts.framing === 'right' ? 'iw-ow' : '(iw-ow)/2';
  let wide = null; // { x0, x1 } normalized source-width band to feature
  if ((opts.framing === 'auto' || opts.framing === 'wide') && job.aspect !== '16:9') {
    try {
      const dims = (() => {
        const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', 'source.mp4'], { cwd: dir }).toString().trim().split(',');
        return { w: Number(out[0]) || 1920, h: Number(out[1]) || 1080 };
      })();
      const cropFrac = Math.min(1, (geo.w / geo.h) / (dims.w / dims.h));
      const { frames, rate } = await sampleFaces(dir, start, clipDur, log);
      const decision = decideFraming(frames, rate, cropFrac);
      if (opts.framing === 'wide') {
        wide = decision && decision.mode === 'wide' ? decision
          : decision && decision.mode === 'track'
            ? { x0: 0, x1: 1 } // one person but wide was forced -> full width
            : { x0: 0, x1: 1 };
      } else if (decision?.mode === 'wide') {
        wide = decision;
        log(`framing: ${'multiple people wider than the crop'} — using wide layout (${decision.x0.toFixed(2)}-${decision.x1.toFixed(2)})`);
      } else if (decision?.mode === 'track') {
        cropX = faceCropExpr(decision.keyframes);
        log('framing: tracking a single speaker');
      } else {
        log('framing: no faces found — using center crop');
      }
      if (wide) {
        // Keep the featured band tall enough that captions stay clear below it.
        const minFrac = Math.min(1, (geo.w * dims.h) / (dims.w * Math.round(geo.h * 0.55)));
        if (wide.x1 - wide.x0 < minFrac) {
          const mid = (wide.x0 + wide.x1) / 2;
          wide = { x0: Math.max(0, Math.min(1 - minFrac, mid - minFrac / 2)), x1: 0 };
          wide.x1 = wide.x0 + minFrac;
        }
      }
    } catch (e) {
      log(`framing analysis failed (${e.message}) — using center crop`);
    }
  }

  // Beat detection (in-house, no deps): onset-energy envelope at 8kHz ->
  // autocorrelation over 60-180 BPM lags -> {period, phase} in seconds.
  // Used to snap punch-cuts to the music grid and start the track on a beat.
  function detectBeats(file) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', '60', '-i', file,
      '-ac', '1', '-ar', '8000', '-f', 's16le', 'beat.pcm'], { cwd: dir });
    const buf = fs.readFileSync(path.join(dir, 'beat.pcm'));
    fs.rmSync(path.join(dir, 'beat.pcm'), { force: true });
    const n = buf.length >> 1, hop = 256;
    const frames = Math.floor(n / hop) - 1;
    if (frames < 40) return null;
    const env = new Float64Array(frames);
    let prev = 0;
    for (let f = 0; f < frames; f++) {
      let e = 0;
      for (let i = f * hop; i < (f + 1) * hop; i++) { const v = buf.readInt16LE(i * 2); e += v * v; }
      env[f] = Math.max(0, e - prev); // positive energy flux = onsets
      prev = e;
    }
    const secPerFrame = hop / 8000;
    let bestLag = 0, bestScore = -1;
    const minLag = Math.round(0.333 / secPerFrame), maxLag = Math.round(1.0 / secPerFrame);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let f = 0; f + lag < frames; f++) s += env[f] * env[f + lag];
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    if (!bestLag) return null;
    let bestPhase = 0, bestPs = -1;
    for (let p = 0; p < bestLag; p++) {
      let s = 0;
      for (let f = p; f < frames; f += bestLag) s += env[f];
      if (s > bestPs) { bestPs = s; bestPhase = p; }
    }
    return { period: bestLag * secPerFrame, phase: bestPhase * secPerFrame };
  }

  // Auto punch-in cuts: alternate caption groups render at a hard 114% zoom
  // so the framing never sits still — the #1 pro talking-head edit pattern.
  // With beat-sync on (and music), cut boundaries snap to the beat grid and
  // the music itself starts on a downbeat.
  let punchWindows = [];
  let musicSeek = 0;
  let beatGrid = null;
  if (opts.punch_cuts && words.length) {
    if (opts.beat_sync && job.music_url) {
      try {
        // music normally downloads later — pull it early for beat analysis
        if (!fs.existsSync(path.join(dir, 'music.mp3'))) await download(job.music_url, path.join(dir, 'music.mp3'));
        beatGrid = detectBeats('music.mp3');
        if (beatGrid) {
          musicSeek = beatGrid.phase; // downbeat lands at t=0
          log(`beat-sync: ~${Math.round(60 / beatGrid.period)} BPM, phase ${beatGrid.phase.toFixed(2)}s`);
        }
      } catch (e) { log(`beat-sync skipped (${e.message})`); }
    }
    const snapBeat = (t) => {
      if (!beatGrid) return t;
      const k = Math.round(t / beatGrid.period);
      const bt = k * beatGrid.period;
      return Math.abs(bt - t) <= 0.3 ? Math.max(0, bt) : t;
    };
    const pGroups = groupWords(words, (STYLES[job.style] || {}).wordsPerGroup || 3);
    punchWindows = pGroups
      .map((g, i) => ({ i, a: snapBeat(g[0].start), b: snapBeat(g[g.length - 1].end + 0.05) }))
      .filter((w) => w.i % 2 === 1 && w.b - w.a > 0.4)
      .slice(0, 30);
    if (punchWindows.length) log(`punch cuts: ${punchWindows.length} zoom window(s)${beatGrid ? ' on the beat grid' : ''}`);
  }

  // Zoom layer: the subtle push-in and/or the hook zoom share one zoompan pass.
  // Hook zoom (opts.punch_zooms) = an exaggerated 15% zoom-in over the first
  // 0.3s that eases back out by ~1.8s, INTRO ONLY (owner: no hits later in
  // the clip), paired with a whoosh mixed into the audio below.
  // t = on/30 (zoompan emits 30fps itself).
  const punch = !!opts.punch_zooms;
  let zoomStage = 'fps=30';
  if (opts.zoom || punch || punchWindows.length) {
    const t = '(on/30)';
    const zterms = [];
    zterms.push(opts.zoom ? 'min(1+0.0008*on,1.12)' : '1');
    if (punch) {
      zterms.push(`0.15*(min(max(${t}/0.3,0),1)-min(max((${t}-0.9)/0.9,0),1))`);
      log('hook zoom: 15% intro punch');
    }
    // punch cuts: hard 14% zoom steps on alternating caption groups — the
    // step (no easing) IS the cut
    if (punchWindows.length) {
      zterms.push(`0.14*(${punchWindows.map((w) => `between(${t},${w.a.toFixed(2)},${w.b.toFixed(2)})`).join('+')})`);
    }
    // fps=30 FIRST: zoompan stamps its output at fps regardless of input
    // timing, so a non-30fps source (DJI shoots 25!) would play 30/25 too
    // fast and drift out of sync with the audio — the 2026-07-15 lip-sync
    // bug. Converting to true CFR 30 before zoompan makes its
    // one-frame-in-one-frame-out assumption exact.
    zoomStage = `fps=30,zoompan=z='min(${zterms.join('+')},1.25)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${geo.w}x${geo.h}:fps=30`;
  }
  fs.copyFileSync(EMOJI_FONT, path.join(dir, 'NotoEmoji-Regular.ttf'));
  // Template fonts ride along in the workdir: subtitles' fontsdir picks them
  // up even if fontconfig doesn't, and drawtext references them by filename.
  for (const f of fs.readdirSync(FONTS_DIR)) fs.copyFileSync(path.join(FONTS_DIR, f), path.join(dir, f));

  // Titles moved out of `post` in v2 — they draw on the full canvas after the
  // frame stage (see the template stage after the audio section).
  const postParts = [];
  // Caption-first signature styles carry their own subtle cinematic grade —
  // raw office footage is half of what reads "amateur" next to the big tools.
  const styleGrade = !tpl && (STYLES[job.style] || {}).grade;
  if (tpl && tpl.grade) postParts.push(tpl.grade);
  else if (styleGrade) postParts.push(styleGrade);
  postParts.push(zoomStage, 'subtitles=captions.ass:fontsdir=.');
  const post = postParts.join(',');

  const hasAudio = (() => {
    try {
      return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', 'source.mp4'], { cwd: dir }).toString().includes('audio');
    } catch { return false; }
  })();
  const withMusic = !!job.music_url;

  // B-roll cutaways: spans arrive on the SOURCE timeline (absolute seconds);
  // map them clip-local and then through the silence cuts so they land where
  // the words actually play. Cap 4; drop spans the cuts shrank below 1.2s.
  const mapTime = (t) => {
    let acc = 0;
    for (const seg of segs) {
      if (t < seg.start) return acc;
      if (t <= seg.end) return acc + (t - seg.start);
      acc += seg.end - seg.start;
    }
    return acc;
  };
  const broll = [];
  for (const b of (Array.isArray(job.broll) ? job.broll : []).slice(0, 4)) {
    const s = mapTime(Math.max(0, Number(b.start) - start));
    const e = mapTime(Math.max(0, Number(b.end) - start));
    if (b.url && e - s >= 1.2 && s < outDur - 1.5) broll.push({ s, e: Math.min(e, outDur - 0.3), url: b.url });
  }
  for (let i = 0; i < broll.length; i++) {
    log(`b-roll ${i}: ${broll[i].s.toFixed(1)}-${broll[i].e.toFixed(1)}s <- ${broll[i].url.slice(0, 90)}`);
    await download(broll[i].url, path.join(dir, `broll${i}.mp4`));
  }
  const brollInputBase = 1 + (withMusic ? 1 : 0);

  // Graph order matters: scale+crop FIRST (so the pan expression sees the
  // same clip-local t the face keyframes were sampled on), then the kept
  // segments are trimmed and concatenated, then zoom/captions. The input is
  // pre-seeked with -ss/-t so only the clip range is decoded.
  const parts = [];
  if (wide) {
    // Wide (podcast) layout: the featured band across the middle shows the
    // full people-span; blurred+darkened copy of the shot fills the rest.
    // Band sits slightly above center so the captions area stays clean.
    parts.push(
      `[0:v]split=2[bgsrc][fgsrc];` +
      `[bgsrc]scale=${geo.w}:${geo.h}:force_original_aspect_ratio=increase,crop=${geo.w}:${geo.h},boxblur=24:2,eq=brightness=-0.14[bgw];` +
      `[fgsrc]crop=iw*${(wide.x1 - wide.x0).toFixed(4)}:ih:iw*${wide.x0.toFixed(4)}:0,scale=${geo.w}:-2[fgw];` +
      `[bgw][fgw]overlay=x=0:y=(H-h)/2-${Math.round(geo.h * 0.06)}[vs]`
    );
  } else {
    parts.push(`[0:v]scale=${geo.w}:${geo.h}:force_original_aspect_ratio=increase,crop=${geo.w}:${geo.h}:x='${cropX}':y=(ih-oh)/2[vs]`);
  }
  // A pad can only be consumed once — fan [vs] (and the audio) out to one
  // copy per segment.
  parts.push(`[vs]split=${segs.length}${segs.map((_, i) => `[s${i}]`).join('')}`);
  if (hasAudio) parts.push(`[0:a]asplit=${segs.length}${segs.map((_, i) => `[sa${i}]`).join('')}`);
  // Transitions ('fx'): a very short fade-in at the head of every segment
  // after the first softens the jump cuts WITHOUT changing durations (a true
  // crossfade would shift the timeline and desync every caption).
  const fx = opts.transitions !== false;
  const vRefs = [];
  segs.forEach((seg, i) => {
    const softener = fx && i > 0 ? ',fade=t=in:st=0:d=0.08' : '';
    parts.push(`[s${i}]trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},setpts=PTS-STARTPTS${softener}[v${i}]`);
    if (hasAudio) parts.push(`[sa${i}]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    vRefs.push(hasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  parts.push(`${vRefs.join('')}concat=n=${segs.length}:v=1:a=${hasAudio ? 1 : 0}${hasAudio ? '[vc][ac]' : '[vc]'}`);

  // Clean audio: gentle rumble cut + FFT denoise on the voice before any
  // music is mixed in.
  let speechLabel = hasAudio ? '[ac]' : null;
  if (opts.clean_audio && hasAudio) {
    parts.push(`[ac]highpass=f=70,afftdn=nf=-28[acl]`);
    speechLabel = '[acl]';
  }

  // B-roll: full-frame cutaways on the post-cut timeline; the speaker's audio
  // keeps playing underneath, captions render on top (post comes after).
  // With fx on, each cutaway alpha-fades in and out.
  let vbase = 'vc';
  broll.forEach((b, i) => {
    const idx = brollInputBase + i;
    const bfade = fx
      ? `,format=yuva420p,fade=t=in:st=${b.s.toFixed(3)}:d=0.15:alpha=1,fade=t=out:st=${(b.e - 0.18).toFixed(3)}:d=0.15:alpha=1`
      : '';
    parts.push(`[${idx}:v]trim=end=${(b.e - b.s).toFixed(3)},setpts=PTS-STARTPTS+${b.s.toFixed(3)}/TB,scale=${geo.w}:${geo.h}:force_original_aspect_ratio=increase,crop=${geo.w}:${geo.h}${bfade}[bb${i}]`);
    parts.push(`[${vbase}][bb${i}]overlay=enable='between(t,${b.s.toFixed(3)},${b.e.toFixed(3)})':eof_action=pass[ov${i}]`);
    vbase = `ov${i}`;
  });
  // Captions render, then brand layers on top of EVERYTHING (b-roll included):
  // corner watermark first, progress bar last so it's never covered.
  const withWatermark = !!opts.watermark;
  const withProgress = !!opts.progress_bar;
  // wm.png is pushed as an input right after the b-roll files (before sfx),
  // so its index never depends on the audio decisions made further down.
  const wmIdx = brollInputBase + broll.length;
  // [vt] is the template stage's output (frame device + titles), declared in
  // the post-audio block — filter_complex chains are order-independent, so
  // referencing it here is fine.
  let vfinal = 'vt';
  parts.push(`[${vbase}]${post}[vsub]`);
  if (withWatermark) {
    fs.copyFileSync(LOGO, path.join(dir, 'wm.png'));
    parts.push(`[${wmIdx}:v]scale=${Math.round(geo.w * 0.13)}:-1,format=rgba,colorchannelmixer=aa=0.55[wm]`);
    parts.push(`[${vfinal}][wm]overlay=W-w-${Math.round(geo.w * 0.03)}:${Math.round(geo.w * 0.03)}[vwm]`);
    vfinal = 'vwm';
  }
  if (withProgress) {
    // Gold bar slides in from the left and fills exactly at the end. overlay
    // x is evaluated per frame; the bar source is bounded to the clip length
    // (an unbounded color source would stall the graph at EOF).
    const barH = Math.max(6, Math.round(geo.h * 0.007));
    parts.push(`color=c=0xD4AF37@0.85:s=${geo.w}x${barH}:r=30:d=${outDur.toFixed(3)}[pbar]`);
    parts.push(`[${vfinal}][pbar]overlay=x='-W+W*min(t/${outDur.toFixed(3)},1)':y=${geo.h - barH}:eof_action=pass[vpb]`);
    vfinal = 'vpb';
  }
  // NOTE: [vout] is aliased AFTER the audio section — the emoji-burst overlays
  // need input indices that depend on the audio inputs (sfx/whoosh/pops).

  // Music bed: looped track as a second input, volume-dropped and side-chain
  // ducked under the speech, then mixed back in (no re-normalizing).
  let audioLabel = speechLabel;
  if (withMusic) {
    log(`music bed: ${job.music_url.slice(0, 100)}`);
    if (!fs.existsSync(path.join(dir, 'music.mp3'))) await download(job.music_url, path.join(dir, 'music.mp3'));
    if (hasAudio) {
      parts.push(`[1:a]atrim=end=${outDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.22[mus]`);
      parts.push(`${speechLabel}asplit=2[spA][spB]`);
      parts.push(`[mus][spB]sidechaincompress=threshold=0.03:ratio=10:attack=40:release=500[duck]`);
      parts.push(`[spA][duck]amix=inputs=2:duration=first:normalize=0[aout]`);
      audioLabel = '[aout]';
    } else {
      parts.push(`[1:a]atrim=end=${outDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.5[aout]`);
      audioLabel = '[aout]';
    }
  }

  // Whoosh on each b-roll entry — only when the owner has uploaded a sound
  // (clip-studio/sfx/whoosh.mp3); the edge fn passes sfx_url when it exists.
  const withSfx = fx && !!job.sfx_url && broll.length > 0 && audioLabel;
  if (withSfx) {
    await download(job.sfx_url, path.join(dir, 'sfx.mp3'));
    const sfxIdx = brollInputBase + broll.length + (withWatermark ? 1 : 0);
    parts.push(`[${sfxIdx}:a]asplit=${broll.length}${broll.map((_, i) => `[w${i}]`).join('')}`);
    const wRefs = broll.map((b, i) => {
      const ms = Math.max(0, Math.round((b.s - 0.12) * 1000));
      parts.push(`[w${i}]adelay=${ms}|${ms},volume=0.35[wd${i}]`);
      return `[wd${i}]`;
    });
    parts.push(`${audioLabel}${wRefs.join('')}amix=inputs=${1 + broll.length}:duration=first:normalize=0[afx]`);
    audioLabel = '[afx]';
  }

  // Hook-zoom whoosh: the intro punch gets its swoosh (built-in asset, mixed
  // under the speech at the very start).
  const withHookWhoosh = punch && !!audioLabel;
  if (withHookWhoosh) {
    fs.copyFileSync(WHOOSH, path.join(dir, 'hook-whoosh.mp3'));
    const hwIdx = brollInputBase + broll.length + (withWatermark ? 1 : 0) + (withSfx ? 1 : 0);
    parts.push(`[${hwIdx}:a]volume=0.5[hw]`);
    parts.push(`${audioLabel}[hw]amix=inputs=2:duration=first:normalize=0[ahw]`);
    audioLabel = '[ahw]';
  }

  // Key-word sounds: a soft pop lands exactly on each gold emphasis word
  // (post-cut timestamps — the remapped words carry emp).
  const popTimes = (opts.sfx_emphasis && audioLabel)
    ? words.filter((w) => w.emp && w.start > 0.2 && w.start < outDur - 0.4).map((w) => w.start).slice(0, 12)
    : [];
  const withPops = popTimes.length > 0;
  if (withPops) {
    fs.copyFileSync(POP, path.join(dir, 'kw-pop.mp3'));
    const popIdx = brollInputBase + broll.length + (withWatermark ? 1 : 0) + (withSfx ? 1 : 0) + (withHookWhoosh ? 1 : 0);
    parts.push(`[${popIdx}:a]asplit=${popTimes.length}${popTimes.map((_, i) => `[kp${i}]`).join('')}`);
    const popRefs = popTimes.map((t, i) => {
      const ms = Math.max(0, Math.round(t * 1000));
      parts.push(`[kp${i}]adelay=${ms}|${ms},volume=0.3[kpd${i}]`);
      return `[kpd${i}]`;
    });
    parts.push(`${audioLabel}${popRefs.join('')}amix=inputs=${1 + popTimes.length}:duration=first:normalize=0[akw]`);
    audioLabel = '[akw]';
    log(`key-word sounds: ${popTimes.length} pop(s)`);
  }

  // ---- motion sound design ----------------------------------------------
  // Every motion style has a matched, deliberately quiet sound: thumps on
  // landings, keystrokes while typing, a buzz per neon ignition. Hit volume
  // scales with the word's spoken energy (smart direction).
  const MOTION_SFX = {
    cascada:  { file: 'thump.mp3', vol: 0.2,  per: 'word', offset: 0.17 },
    gravedad: { file: 'thump.mp3', vol: 0.24, per: 'word', offset: 0.17, stagger: 0.09 },
    golpe:    { file: 'slap.mp3',  vol: 0.28, per: 'word', offset: 0.02 },
    recorte:  { file: 'slap.mp3',  vol: 0.2,  per: 'word', offset: 0.06 },
    maquina:  { file: 'key.mp3',   vol: 0.26, per: 'type' },
    neonvivo: { file: 'buzz.mp3',  vol: 0.16, per: 'word', offset: 0.05, stagger: 0.06 },
    resorte:  { file: 'boing.mp3', vol: 0.13, per: 'emp' },
    cinta:    { file: 'slide.mp3', vol: 0.22, per: 'group' },
    enfoque:  { file: 'riser.mp3', vol: 0.18, per: 'group' },
  };
  const stMo = STYLES[job.style] || {};
  // Owner call 2026-07-20: per-word motion sounds REMOVED (read as noise
  // against speech + music). Machinery stays; opt-in only if a job
  // explicitly sends sfx_motion:true — nothing does today.
  const msfxCfg = (audioLabel && stMo.kinetic === 'motion' && opts.sfx_motion === true) ? MOTION_SFX[stMo.motion] : null;
  let msfxEvents = [];
  if (msfxCfg) {
    const gs = groupWords(words, stMo.wordsPerGroup || 4);
    if (msfxCfg.per === 'group') {
      msfxEvents = gs.map((g) => ({ t: g[0].start, v: msfxCfg.vol }));
    } else if (msfxCfg.per === 'emp') {
      msfxEvents = words.filter((w) => w.emp).map((w) => ({ t: w.start, v: msfxCfg.vol }));
    } else if (msfxCfg.per === 'type') {
      for (const g of gs) for (const w of g) {
        const dur = Math.max(0.12, (w.end - w.start) * 0.7);
        for (let k = 0; k < 3; k++) msfxEvents.push({ t: w.start + (dur * k) / 3, v: msfxCfg.vol });
      }
    } else {
      for (const g of gs) g.forEach((w, wi) => msfxEvents.push({
        t: w.start + (msfxCfg.offset || 0) + (msfxCfg.stagger ? msfxCfg.stagger * wi : 0),
        v: msfxCfg.vol * (0.7 + 0.5 * Math.min(1.3, w.energy ?? 0.8)),
      }));
    }
    msfxEvents = msfxEvents.filter((e) => e.t > 0.05 && e.t < outDur - 0.2).slice(0, 48);
  }
  const withMotionSfx = msfxEvents.length > 0;
  if (withMotionSfx) {
    fs.copyFileSync(path.join(__dirname, 'assets', 'sfx-motion', msfxCfg.file), path.join(dir, 'msfx.mp3'));
    const mIdx = brollInputBase + broll.length + (withWatermark ? 1 : 0) + (withSfx ? 1 : 0) + (withHookWhoosh ? 1 : 0) + (withPops ? 1 : 0);
    parts.push(`[${mIdx}:a]asplit=${msfxEvents.length}${msfxEvents.map((_, i) => `[ms${i}]`).join('')}`);
    const refs = msfxEvents.map((e, i) => {
      const ms = Math.max(0, Math.round(e.t * 1000));
      parts.push(`[ms${i}]adelay=${ms}|${ms},volume=${e.v.toFixed(2)}[msd${i}]`);
      return `[msd${i}]`;
    });
    parts.push(`${audioLabel}${refs.join('')}amix=inputs=${1 + msfxEvents.length}:duration=first:normalize=0[amx]`);
    audioLabel = '[amx]';
    log(`motion sfx: ${msfxEvents.length} ${msfxCfg.file} hit(s)`);
  }

  // ---- template stage: frame device + titles -> [vt] --------------------
  // [vsub] (captioned video) is scaled into the template's panel over a
  // canvas, the frame PNG (transparent window) goes on top, then the title
  // treatment draws on the full canvas. Non-template renders pass through.
  const tplImgs = []; // {name, dur} — image inputs owned by this stage
  const tplBase = brollInputBase + broll.length + (withWatermark ? 1 : 0) + (withSfx ? 1 : 0) + (withHookWhoosh ? 1 : 0) + (withPops ? 1 : 0) + (withMotionSfx ? 1 : 0);
  const regTplImg = (srcPath, name, durSec) => {
    fs.copyFileSync(srcPath, path.join(dir, name));
    tplImgs.push({ name, dur: durSec });
    return tplBase + tplImgs.length - 1;
  };
  let vcur = 'vsub';
  const use916 = job.aspect === '9:16';
  const frameCfg = tpl && use916
    ? (tpl.frame || (tpl.letterbox
        ? { panel: { x: 0, y: tpl.letterbox.top, w: 1, h: 1 - tpl.letterbox.top - tpl.letterbox.bottom }, canvasColor: tpl.letterbox.color }
        : null))
    : null;
  if (frameCfg) {
    const P = frameCfg.panel;
    const pw = 2 * Math.round(geo.w * P.w / 2), ph = 2 * Math.round(geo.h * P.h / 2);
    const px = Math.round(geo.w * P.x), py = Math.round(geo.h * P.y);
    parts.push(`color=c=${frameCfg.canvasColor || 'black'}:s=${geo.w}x${geo.h}:r=30:d=${outDur.toFixed(3)}[tcanvas]`);
    parts.push(`[${vcur}]scale=${pw}:${ph}[tpanel]`);
    parts.push(`[tcanvas][tpanel]overlay=${px}:${py}:eof_action=pass[tframed]`);
    vcur = 'tframed';
    if (frameCfg.asset) {
      const idx = regTplImg(path.join(STICKERS_DIR, `${frameCfg.asset}.png`), 'tframe.png', outDur + 0.1);
      parts.push(`[${idx}:v]scale=${geo.w}:${geo.h}[tfa]`);
      parts.push(`[${vcur}][tfa]overlay=0:0:eof_action=pass[tframed2]`);
      vcur = 'tframed2';
    }
    log(`template frame: ${tpl.frame ? frameCfg.asset : 'letterbox'} (${job.style})`);
  }
  // Title treatment on the full canvas — animated ASS pass (see buildTitlesAss).
  if (tpl && tpl.title) {
    const T = tpl.title;
    const scaleY = geo.h / 1920;
    const mainRaw = drawtextEscape(opts.hook_title_text || '');
    // The tape-strip backdrop still rides in as an image input under the text.
    if (T.mode === 'strip' && mainRaw && T.stripAsset) {
      const stripW = Math.round(geo.w * 0.82);
      const y0 = Math.round((T.y || 100) * scaleY);
      const idx = regTplImg(path.join(STICKERS_DIR, `${T.stripAsset}.png`), 'tstrip.png', 2.9);
      parts.push(`[${idx}:v]format=rgba,scale=${stripW}:-1,fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st=2.45:d=0.35:alpha=1[tstripv]`);
      parts.push(`[${vcur}][tstripv]overlay=(W-w)/2:${y0 - Math.round(stripW * 170 / 900 * 0.22)}:enable='lt(t,2.85)':eof_action=pass[tstriped]`);
      vcur = 'tstriped';
    }
    const titlesAss = buildTitlesAss(tpl, job.style, geo, mainRaw, outDur, depthMode);
    if (titlesAss) {
      fs.writeFileSync(path.join(dir, 'titles.ass'), titlesAss);
      // depth mode: the title is applied in the second (matted) pass instead
      if (!depthMode) {
        parts.push(`[${vcur}]subtitles=titles.ass:fontsdir=.[vtitled]`);
        vcur = 'vtitled';
      }
    }
    if (T.rule && mainRaw) {
      const yRule = Math.round((T.y || 100) * scaleY) + Math.round(geo.w * (T.mainScale || 0.05)) + Math.round(34 * scaleY);
      parts.push(`[${vcur}]drawbox=x=iw/2-${Math.round(geo.w * 0.1)}:y=${yRule}:w=${Math.round(geo.w * 0.2)}:h=3:color=0x${T.rule}@0.9:t=fill:enable='lt(t,2.85)'[vruled]`);
      vcur = 'vruled';
    }
  }
  parts.push(`[${vcur}]null[vt]`);

  // Overlay engine: emoji bursts, template sticker bursts (on emphasized
  // words, alternating sides above the captions) and persistent template
  // decorations all flow through one loop.
  const overlayItems = [];
  for (const w of words) {
    if (!w.emoji || overlayItems.length >= 6) continue;
    const asset = emojiAsset(w.emoji);
    if (!asset || !fs.existsSync(asset)) continue;
    if (w.start < 1.5 || w.start > outDur - 1.2) continue;
    if (overlayItems.length && w.start - overlayItems[overlayItems.length - 1].from < 2.5) continue;
    const sz = Math.round(geo.w * 0.15);
    overlayItems.push({
      asset, w: sz, x: '(W-w)/2',
      y: Math.max(40, geo.h - geo.marginV - Math.round(geo.fontsize * 1.7) - sz),
      from: Math.round(w.start * 100) / 100, to: Math.round(w.start * 100) / 100 + 1.1, fade: true,
    });
  }
  if (tpl) {
    let side = 0, prevT = -9, burstCount = 0;
    const pushBurst = (T) => {
      const asset = path.join(STICKERS_DIR, `${tpl.burst[burstCount % tpl.burst.length]}.png`);
      if (!fs.existsSync(asset)) return;
      prevT = T;
      const sz = Math.round(geo.w * 0.32);
      overlayItems.push({
        asset, w: sz,
        x: side % 2 === 0 ? Math.round(geo.w * 0.07) : `W-w-${Math.round(geo.w * 0.07)}`,
        y: Math.max(40, geo.h - geo.marginV - Math.round(geo.fontsize * 1.5) - Math.round(sz * 0.6)),
        from: Math.round(T * 100) / 100, to: Math.round(T * 100) / 100 + 1.5, fade: true,
      });
      side++; burstCount++;
    };
    for (const w of words) {
      if (!tpl.burst.length || !w.emp || burstCount >= 4) continue;
      const T = w.start;
      if (T < 2.2 || T > outDur - 1.7 || T - prevT < 3) continue;
      pushBurst(T);
    }
    // Guarantee the look: if key words gave us fewer than 3 sticker moments,
    // fill in at fixed points so a template NEVER renders bare.
    if (burstCount < 3 && outDur > 8) {
      for (const frac of [0.3, 0.55, 0.8]) {
        if (burstCount >= 3) break;
        const T = Math.round(outDur * frac * 100) / 100;
        if (T < 2.2 || T > outDur - 1.7 || Math.abs(T - prevT) < 3) continue;
        pushBurst(T);
      }
    }
    if (tpl.persistent) {
      const asset = path.join(STICKERS_DIR, `${tpl.persistent.file}.png`);
      if (fs.existsSync(asset)) {
        const pos = tpl.persistent.pos === 'top'
          ? { w: Math.round(geo.w * 0.86), x: '(W-w)/2', y: 14 }
          : tpl.persistent.pos === 'topleft'
            ? { w: Math.round(geo.w * 0.2), x: 22, y: 22 }
            : { w: Math.round(geo.w * 0.15), x: 20, y: Math.round(geo.h * 0.28) };
        // reveal after the title card so the top of the frame never crowds
        const from = opts.hook_title_text && tpl.persistent.pos !== 'left' ? 2.8 : 0;
        overlayItems.push({ asset, ...pos, from, to: outDur, fade: false, dim: true });
      }
    }
  }
  const ovBase = tplBase + tplImgs.length;
  overlayItems.forEach((o, i) => {
    fs.copyFileSync(o.asset, path.join(dir, `ov${i}.png`));
    const rel = (o.to - o.from).toFixed(3);
    const fx2 = o.fade
      ? `,fade=t=in:st=0:d=0.12:alpha=1,fade=t=out:st=${Math.max(0, o.to - o.from - 0.25).toFixed(3)}:d=0.25:alpha=1`
      : (o.dim ? ',colorchannelmixer=aa=0.92' : '');
    parts.push(`[${ovBase + i}:v]format=rgba,scale=${o.w}:-1${fx2},setpts=PTS+${o.from.toFixed(3)}/TB[ov${i}]`);
    // Fading bursts slide up ~34px with an ease-out as they appear.
    const yExpr = o.fade ? `'${o.y}+34*pow(max(0\\,1-(t-${o.from.toFixed(3)})/0.3)\\,2)'` : o.y;
    parts.push(`[${vfinal}][ov${i}]overlay=${o.x}:${yExpr}:enable='between(t,${o.from.toFixed(3)},${o.to.toFixed(3)})':eof_action=pass[vov${i}]`);
    vfinal = `vov${i}`;
  });
  if (overlayItems.length) log(`overlays: ${overlayItems.length} (template: ${tpl ? job.style : 'none'})`);
  // Film texture over the FINISHED frame (canvas, titles, stickers included).
  const tex = [];
  if (tpl && tpl.grain) tex.push('noise=alls=7:allf=t');
  if (tpl && tpl.vignette) tex.push('vignette=PI/4.6');
  parts.push(`[${vfinal}]${tex.length ? tex.join(',') : 'null'}[vout]`);

  const outPath = path.join(dir, 'clip.mp4');
  const args = ['-ss', String(start), '-t', String(clipDur), '-i', 'source.mp4'];
  if (withMusic) {
    if (musicSeek > 0.02) args.push('-ss', musicSeek.toFixed(3)); // downbeat at t=0 (beat-sync)
    args.push('-stream_loop', '-1', '-i', 'music.mp3');
  }
  broll.forEach((_, i) => args.push('-i', `broll${i}.mp4`));
  if (withWatermark) args.push('-i', 'wm.png'); // index = wmIdx (right after b-roll)
  if (withSfx) args.push('-i', 'sfx.mp3');
  if (withHookWhoosh) args.push('-i', 'hook-whoosh.mp3');
  if (withPops) args.push('-i', 'kw-pop.mp3');
  if (withMotionSfx) args.push('-i', 'msfx.mp3');
  tplImgs.forEach((im) => args.push('-loop', '1', '-framerate', '30', '-t', im.dur.toFixed(3), '-i', im.name));
  overlayItems.forEach((o, i) => args.push('-loop', '1', '-framerate', '30', '-t', (o.to - o.from + 0.05).toFixed(3), '-i', `ov${i}.png`));
  args.push('-filter_complex', parts.join(';'), '-map', '[vout]');
  if (audioLabel) args.push('-map', audioLabel, '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'clip.mp4');

  // Depth mode, plain (non-template) styles: a large luxury-serif title in
  // the head/shoulder zone, applied in the second (matted) pass so it lands
  // behind the person. Oversized + letter-spaced on purpose: the text must
  // spread WIDER than the head so it stays readable around the silhouette.
  if (depthMode && !tpl) {
    const raw = String(opts.hook_title_text).toUpperCase();
    const fsp = Math.round(geo.w * 0.009); // luxury tracking — also pushes text past the head
    const size = Math.min(Math.round(geo.w * 0.15),
      Math.floor((geo.w * 0.97) / Math.max(5, raw.length * 0.62 + raw.length * (fsp / (geo.w * 0.15)))));
    const cx = Math.round(geo.w / 2);
    const y = Math.round(geo.h * 0.26);
    // tracking reveal: letters start wide-spread and translucent, settle in
    const anim = `{\\pos(${cx},${y})\\fsp${fsp * 3}\\blur6\\alpha&H60&\\t(0,450,\\fsp${fsp}\\blur0\\alpha&H00&)\\fad(40,320)}`;
    fs.writeFileSync(path.join(dir, 'titles.ass'), [
      '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${geo.w}`, `PlayResY: ${geo.h}`,
      'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: DHook,Prata,${size},${WHITE},${WHITE},&H50000000,&H00000000,0,0,0,0,100,100,${fsp},0,1,3,0,8,40,40,10,1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      `Dialogue: 2,0:00:00.00,0:00:02.85,DHook,,0,0,0,,${anim}${assEscape(raw)}`,
    ].join('\n') + '\n');
  }
  ff(dir, args);

  if (depthMode) {
    try {
      const { buildPersonAlpha } = require('./segment');
      await buildPersonAlpha(dir, path.join(dir, 'clip.mp4'), 3.2, log);
      applyDepthTitle(dir, geo, log);
    } catch (e) {
      // Matting is best-effort: if it fails, the title still lands — in front.
      log(`depth title failed (${e.message}) — applying title in front instead`);
      fs.renameSync(path.join(dir, 'clip.mp4'), path.join(dir, 'pre-depth.mp4'));
      ff(dir, ['-i', 'pre-depth.mp4', '-vf', 'subtitles=titles.ass:fontsdir=.',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart', 'clip.mp4']);
    }
  }

  // Key words behind the person (depth_words extra): each picked emphasis
  // word gets its own ~1.2s matte window and pops big behind the speaker.
  if (opts.depth_words) {
    const picked = pickDepthWords(words);
    if (picked.length) {
      try {
        const windows = picked.map((p) => ({
          word: p.word,
          from: Math.max(0, p.t - 0.12),
          to: Math.min(outDur, p.t + 1.15),
        })).filter((w) => w.to - w.from > 0.4);
        // ONE continuous mask for the whole clip — per-window alpha inputs
        // made overlay buffer unboundedly until a late window (OOM).
        const { buildWindowedAlpha } = require('./segment');
        const wa = await buildWindowedAlpha(dir, path.join(dir, 'clip.mp4'), windows, outDur, log);
        windows.forEach((w, i) => { w.headTopFrac = wa.heads[i]; });
        const stDW = applyAccent(STYLES[job.style] || STYLES.boldpop, opts.accent_color);
        fs.writeFileSync(path.join(dir, 'depthwords.ass'), buildDepthWordsAss(geo, stDW, windows));
        applyDepthWords(dir, geo, windows, log);
      } catch (e) {
        log(`depth words failed (${e.message}) — clip keeps rendering without them`);
        const pre = path.join(dir, 'pre-words.mp4');
        if (fs.existsSync(pre) && !fs.existsSync(path.join(dir, 'clip.mp4'))) fs.renameSync(pre, path.join(dir, 'clip.mp4'));
      }
    } else {
      log('depth words: no eligible emphasis words (need Highlight key words on)');
    }
  }

  if (opts.outro) {
    appendBrandOutro(dir, geo, log);
    outDur += OUTRO_SEC;
  }

  return { finalPath: outPath, durationSec: outDur };
}

module.exports = { prepareClipSource, renderClip, buildAss, buildAssFromGroups, groupWords, buildKeepSegments, remapWords, decideFraming, appendBrandOutro };
