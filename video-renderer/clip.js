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
  '9:16': { w: 1080, h: 1920, fontsize: 76, marginV: 460 },
  '1:1':  { w: 1080, h: 1080, fontsize: 64, marginV: 140 },
  '16:9': { w: 1920, h: 1080, fontsize: 60, marginV: 110 },
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
const DARKTXT = '&H00181818';
// Caption personalities. New fields beyond v1:
//   pill: {bg, fg}      active word gets a chunky colored surround (thick \bord)
//   glow: color         active word gets a blurred neon halo
//   emphItalic: true    emphasized words go italic+bigger instead of gold
//   marginV, align      caption placement overrides
const STYLES = {
  boldpop:  { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline', font: 'Anton' },
  goldglow: { wordsPerGroup: 3, highlight: GOLD,   upper: true,  border: 'outline', font: 'Anton' },
  cleanbox: { wordsPerGroup: 5, highlight: null,   upper: false, border: 'box' },
  popline:  { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline', pop: true, font: 'Anton' },
  rosa:     { wordsPerGroup: 3, highlight: PINK,   upper: true,  border: 'outline', pop: true, font: 'Anton' },
  minimal:  { wordsPerGroup: 4, highlight: null,   upper: false, border: 'outline', scale: 0.72 },
  // Caption-first looks — no template layer, the captions ARE the design.
  // All of these honor opts.accent (owner-picked color) via applyAccent.
  //   fsp: extra letter-spacing (ASS Spacing)   shadow: hard drop shadow depth
  lujo:     { wordsPerGroup: 4, highlight: GOLD,   upper: false, border: 'outline', scale: 0.8,  font: 'Prata', fsp: 3, emphItalic: true },
  grande:   { wordsPerGroup: 2, highlight: YELLOW, upper: true,  border: 'outline', scale: 1.32, font: 'Anton', pop: true },
  resalta:  { wordsPerGroup: 3, highlight: null,   upper: true,  border: 'outline', scale: 1.05, font: 'Anton', pill: { bg: YELLOW, fg: DARKTXT }, pop: true },
  brillo:   { wordsPerGroup: 3, highlight: CYAN,   upper: true,  border: 'outline', font: 'Anton', glow: CYAN, pop: true },
  sombra:   { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline', scale: 1.18, font: 'Anton', shadow: true, pop: true },
  // Template looks (caption layer — frame/title/stickers/grade in TEMPLATES):
  fiesta:    { wordsPerGroup: 3, highlight: PINK,   upper: true,  border: 'outline', pop: true,  font: 'Anton' },
  editorial: { wordsPerGroup: 4, highlight: GOLD,   upper: false, border: 'outline', scale: 0.92, font: 'Prata', emphItalic: true },
  corrido:   { wordsPerGroup: 3, highlight: RED,    upper: true,  border: 'outline', font: 'Anton', pill: { bg: GOLD, fg: DARKTXT } },
  craft:     { wordsPerGroup: 4, highlight: YELLOW, upper: false, border: 'outline', pop: true,  font: 'Patrick Hand', scale: 1.05 },
  retro:     { wordsPerGroup: 4, highlight: null,   upper: false, border: 'outline', scale: 0.82, pill: { bg: YELLOW, fg: DARKTXT } },
  brasa:     { wordsPerGroup: 4, highlight: WARM,   upper: false, border: 'outline', scale: 0.95, font: 'Prata' },
  impacto:   { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline', scale: 1.05, font: 'Anton', pill: { bg: YELLOW, fg: DARKTXT }, pop: true },
  neon:      { wordsPerGroup: 3, highlight: CYAN,   upper: true,  border: 'outline', font: 'Anton', glow: CYAN },
  luxe:      { wordsPerGroup: 5, highlight: null,   upper: false, border: 'box', scale: 0.6, font: 'Space Mono', marginV: 320 },
  cine:      { wordsPerGroup: 4, highlight: null,   upper: false, border: 'outline', scale: 0.85, font: 'Prata' },
  grafica:   { wordsPerGroup: 4, highlight: null,   upper: true,  border: 'outline', scale: 0.9, pill: { bg: '&H00C85624', fg: '&H00FFFFFF' } },
  revista:   { wordsPerGroup: 4, highlight: null,   upper: false, border: 'outline', scale: 0.95, font: 'Prata', emphItalic: true },
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

function assHeader(geo, st, fontsize) {
  const shadowDepth = st.shadow ? Math.round(fontsize / 7) : 0; // hard 3D drop shadow
  const outline = st.border === 'box'
    ? `3,${Math.round(fontsize / 5)},0`   // BorderStyle=3 (box) — Outline acts as box padding
    : `1,${Math.round(fontsize / 11)},${shadowDepth}`; // BorderStyle=1, thick outline
  const backColour = st.border === 'box' ? BOX_BLACK : '&H00000000';
  const outlineColour = st.border === 'box' ? BOX_BLACK : '&H00000000';
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
    `Style: Cap,${st.font || 'DejaVu Sans'},${fontsize},${WHITE},${WHITE},${outlineColour},${backColour},1,0,0,0,100,100,${st.fsp || 0},0,${outline},2,60,60,${st.marginV || geo.marginV},1`,
    // Hook title: top-center (alignment 8), soft dark box so it reads on any footage.
    `Style: Hook,DejaVu Sans,${hookSize},${WHITE},${WHITE},${BOX_BLACK},${BOX_BLACK},1,0,0,0,100,100,0,0,3,${Math.round(hookSize / 4)},0,8,60,60,${hookMarginTop},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
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
  if (st.highlight) out.highlight = c;
  return out;
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
  const fontsize = Math.round(geo.fontsize * (st.scale || 1));
  const header = assHeader(geo, st, fontsize);
  const lines = hookLine(opts);

  // Emphasized (AI-tagged) words render gold+bigger (or italic+bigger for
  // emphItalic styles) at all times; the active-word paint walks across the
  // non-emphasized ones.
  const empSize = Math.round(fontsize * 1.18);
  const empOpen = st.emphItalic ? `{\\i1\\fs${empSize}}` : `{\\c${GOLD}&\\fs${empSize}}`;
  const empClose = st.emphItalic ? `{\\i0\\fs${fontsize}}` : `{\\c${WHITE}&\\fs${fontsize}}`;
  // pop styles: the active word lands slightly oversized and settles in 120ms
  const popOpen = `{\\fscx116\\fscy116\\t(0,120,\\fscx100\\fscy100)}`;
  const popClose = `{\\fscx100\\fscy100}`;
  // Active-word treatments: plain color paint, chunky pill, or neon glow.
  const paintWord = (body) => {
    let paint;
    if (st.pill) paint = `{\\bord${Math.max(8, Math.round(fontsize / 3.4))}\\3c${st.pill.bg}&\\c${st.pill.fg}&}${body}{\\r}`;
    else if (st.glow) paint = `{\\bord${Math.max(4, Math.round(fontsize / 8))}\\3c${st.glow}&\\blur7\\c&HFFFFFF&}${body}{\\r}`;
    else paint = `{\\c${st.highlight}&}${body}{\\c${WHITE}&}`;
    return st.pop ? `${popOpen}${paint}${popClose}` : paint;
  };
  const perWord = !!(st.highlight || st.pill || st.glow);
  const groups = groupWords(words, st.wordsPerGroup);
  for (const group of groups) {
    const texts = group.map((w) => {
      const t = assEscape(w.word);
      return { txt: st.upper ? t.toUpperCase() : t, emp: !!w.emp, emoji: w.emoji || null };
    });
    // Emoji do NOT go into the caption text — Cloud Run's libass draws tofu
    // for them no matter which font we ship. They render as PNG bursts above
    // the captions instead (see the emoji-burst overlays in renderClip).
    const withEmoji = (x) => x.txt;
    if (!perWord) {
      // One dialogue per group, no per-word paint.
      const text = texts.map((x, j) => (x.emp ? `${empOpen}${withEmoji(x, j)}${empClose}` : withEmoji(x, j))).join(' ');
      lines.push(`Dialogue: 0,${toAssTime(group[0].start)},${toAssTime(group[group.length - 1].end)},Cap,,0,0,0,,${text}`);
      continue;
    }
    // One dialogue per word: full group shown, the spoken word painted. The
    // first dialogue of each group rises in (90ms) so caption changes feel
    // alive instead of teleporting.
    for (let i = 0; i < group.length; i++) {
      const from = i === 0 ? group[0].start : group[i].start;
      const to = i < group.length - 1 ? group[i + 1].start : group[group.length - 1].end;
      if (to - from < 0.01) continue;
      const intro = i === 0 ? `{\\fscy82\\t(0,90,\\fscy100)}` : '';
      const text = texts
        .map((x, j) => {
          const body = withEmoji(x, j);
          if (x.emp && j !== i) return `${empOpen}${body}${empClose}`;
          if (j === i) return paintWord(body);
          return body;
        })
        .join(' ');
      lines.push(`Dialogue: 0,${toAssTime(from)},${toAssTime(to)},Cap,,0,0,0,,${intro}${text}`);
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
  const header = assHeader(geo, st, fontsize);
  const lines = hookLine(opts);
  for (const g of groups) {
    if (!(g && typeof g.text === 'string' && g.text.trim())) continue;
    const text = st.upper ? assEscape(g.text).toUpperCase() : assEscape(g.text);
    lines.push(`Dialogue: 0,${toAssTime(g.start)},${toAssTime(g.end)},Cap,,0,0,0,,{\\q0}${text}`);
  }
  return header.concat(lines).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// silence removal: keep-segments from word gaps + caption remapping
// ---------------------------------------------------------------------------

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
          start: acc + Math.max(0, w.start - seg.start),
          end: acc + Math.min(seg.end - seg.start, Math.max(0.05, w.end - seg.start)),
        });
      }
    }
    acc += seg.end - seg.start;
  }
  return { words: out, totalDur: acc };
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
  const capOpts = { hookTitle: tpl || depthMode ? null : (opts.hook_title_text || null), totalDur: outDur, accent: opts.accent_color || null };
  const assContent = Array.isArray(job.caption_groups) && job.caption_groups.length
    ? buildAssFromGroups(
        job.caption_groups.map((g) => ({ start: mapCapT(Number(g.start)), end: mapCapT(Number(g.end)), text: g.text })),
        job.style, job.aspect, capOpts)
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

  // Zoom layer: the subtle push-in and/or the hook zoom share one zoompan pass.
  // Hook zoom (opts.punch_zooms) = an exaggerated 15% zoom-in over the first
  // 0.3s that eases back out by ~1.8s, INTRO ONLY (owner: no hits later in
  // the clip), paired with a whoosh mixed into the audio below.
  // t = on/30 (zoompan emits 30fps itself).
  const punch = !!opts.punch_zooms;
  let zoomStage = 'fps=30';
  if (opts.zoom || punch) {
    const t = '(on/30)';
    const zterms = [];
    zterms.push(opts.zoom ? 'min(1+0.0008*on,1.12)' : '1');
    if (punch) {
      zterms.push(`0.15*(min(max(${t}/0.3,0),1)-min(max((${t}-0.9)/0.9,0),1))`);
      log('hook zoom: 15% intro punch');
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
  if (tpl && tpl.grade) postParts.push(tpl.grade);
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
    await download(job.music_url, path.join(dir, 'music.mp3'));
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

  // ---- template stage: frame device + titles -> [vt] --------------------
  // [vsub] (captioned video) is scaled into the template's panel over a
  // canvas, the frame PNG (transparent window) goes on top, then the title
  // treatment draws on the full canvas. Non-template renders pass through.
  const tplImgs = []; // {name, dur} — image inputs owned by this stage
  const tplBase = brollInputBase + broll.length + (withWatermark ? 1 : 0) + (withSfx ? 1 : 0) + (withHookWhoosh ? 1 : 0) + (withPops ? 1 : 0);
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
  if (withMusic) args.push('-stream_loop', '-1', '-i', 'music.mp3');
  broll.forEach((_, i) => args.push('-i', `broll${i}.mp4`));
  if (withWatermark) args.push('-i', 'wm.png'); // index = wmIdx (right after b-roll)
  if (withSfx) args.push('-i', 'sfx.mp3');
  if (withHookWhoosh) args.push('-i', 'hook-whoosh.mp3');
  if (withPops) args.push('-i', 'kw-pop.mp3');
  tplImgs.forEach((im) => args.push('-loop', '1', '-framerate', '30', '-t', im.dur.toFixed(3), '-i', im.name));
  overlayItems.forEach((o, i) => args.push('-loop', '1', '-framerate', '30', '-t', (o.to - o.from + 0.05).toFixed(3), '-i', `ov${i}.png`));
  args.push('-filter_complex', parts.join(';'), '-map', '[vout]');
  if (audioLabel) args.push('-map', audioLabel, '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'clip.mp4');

  // Depth mode, plain (non-template) styles: a big Anton slam-in title in the
  // head/shoulder zone, applied in the second (matted) pass so it lands
  // behind the person.
  if (depthMode && !tpl) {
    const size = Math.min(Math.round(geo.w * 0.115),
      Math.floor((geo.w * 0.92) / Math.max(6, String(opts.hook_title_text).length * 0.58)));
    const cx = Math.round(geo.w / 2);
    const y = Math.round(geo.h * 0.3);
    const anim = `{\\pos(${cx},${y})\\fscx158\\fscy158\\blur7\\t(0,130,\\fscx100\\fscy100\\blur0)\\fad(30,300)}`;
    fs.writeFileSync(path.join(dir, 'titles.ass'), [
      '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${geo.w}`, `PlayResY: ${geo.h}`,
      'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: DHook,Anton,${size},${WHITE},${WHITE},&H64000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,8,40,40,10,1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      `Dialogue: 2,0:00:00.00,0:00:02.85,DHook,,0,0,0,,${anim}${assEscape(opts.hook_title_text).toUpperCase()}`,
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

  if (opts.outro) {
    appendBrandOutro(dir, geo, log);
    outDur += OUTRO_SEC;
  }

  return { finalPath: outPath, durationSec: outDur };
}

module.exports = { prepareClipSource, renderClip, buildAss, buildAssFromGroups, groupWords, buildKeepSegments, remapWords, decideFraming, appendBrandOutro };
