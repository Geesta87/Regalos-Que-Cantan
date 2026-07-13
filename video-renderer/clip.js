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

function ff(dir, args) {
  return execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd: dir });
}

function download(url, dest) {
  return fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`download ${res.status} for ${url.slice(0, 120)}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  });
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
const BOX_BLACK = '&H66000000'; // ~60%-opaque black for the clean box style

// Caption styles. wordsPerGroup controls the caption chunk size; highlight
// paints the word being spoken; upper = shout-case like the viral templates.
const STYLES = {
  boldpop:  { wordsPerGroup: 3, highlight: YELLOW, upper: true,  border: 'outline' },
  goldglow: { wordsPerGroup: 3, highlight: GOLD,   upper: true,  border: 'outline' },
  cleanbox: { wordsPerGroup: 5, highlight: null,   upper: false, border: 'box' },
};

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

function buildAss(words, styleKey, aspectKey) {
  const geo = ASPECTS[aspectKey] || ASPECTS['9:16'];
  const st = STYLES[styleKey] || STYLES.boldpop;

  const outline = st.border === 'box'
    ? `3,${Math.round(geo.fontsize / 5)},0`   // BorderStyle=3 (box) — Outline acts as box padding
    : `1,${Math.round(geo.fontsize / 11)},0`; // BorderStyle=1, thick outline
  const backColour = st.border === 'box' ? BOX_BLACK : '&H00000000';
  const outlineColour = st.border === 'box' ? BOX_BLACK : '&H00000000';

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${geo.w}`,
    `PlayResY: ${geo.h}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,DejaVu Sans,${geo.fontsize},${WHITE},${WHITE},${outlineColour},${backColour},1,0,0,0,100,100,0,0,${outline},2,60,60,${geo.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const lines = [];
  const groups = groupWords(words, st.wordsPerGroup);
  for (const group of groups) {
    const texts = group.map((w) => {
      const t = assEscape(w.word);
      return st.upper ? t.toUpperCase() : t;
    });
    if (!st.highlight) {
      // One dialogue per group, no per-word paint.
      lines.push(`Dialogue: 0,${toAssTime(group[0].start)},${toAssTime(group[group.length - 1].end)},Cap,,0,0,0,,${texts.join(' ')}`);
      continue;
    }
    // One dialogue per word: full group shown, the spoken word painted.
    for (let i = 0; i < group.length; i++) {
      const from = i === 0 ? group[0].start : group[i].start;
      const to = i < group.length - 1 ? group[i + 1].start : group[group.length - 1].end;
      if (to - from < 0.01) continue;
      const text = texts
        .map((t, j) => (j === i ? `{\\c${st.highlight}&}${t}{\\c${WHITE}&}` : t))
        .join(' ');
      lines.push(`Dialogue: 0,${toAssTime(from)},${toAssTime(to)},Cap,,0,0,0,,${text}`);
    }
  }

  return header.concat(lines).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// render: cut + crop + burn captions
// ---------------------------------------------------------------------------
async function renderClip(job, { dir, log }) {
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'source.mp4');
  log(`downloading source ${job.source_url.slice(0, 100)}`);
  await download(job.source_url, src);

  const start = Math.max(0, Number(job.start_sec) || 0);
  const sourceDur = probeDuration(dir, 'source.mp4');
  const end = Math.min(Number(job.end_sec) || sourceDur, sourceDur);
  if (end - start < 0.5) throw new Error(`clip range too short (${start}-${end})`);
  const clipDur = end - start;

  // Filter Whisper words to the clip range and re-base to t=0.
  const words = (job.words || [])
    .filter((w) => w.end > start + 0.05 && w.start < end - 0.05)
    .map((w) => ({ word: w.word, start: Math.max(0, w.start - start), end: Math.min(clipDur, w.end - start) }));
  log(`${words.length} words in range ${start.toFixed(1)}-${end.toFixed(1)}s, style=${job.style}, aspect=${job.aspect}`);

  fs.writeFileSync(path.join(dir, 'captions.ass'), buildAss(words, job.style, job.aspect));

  const geo = ASPECTS[job.aspect] || ASPECTS['9:16'];
  const vf = [
    `scale=${geo.w}:${geo.h}:force_original_aspect_ratio=increase`,
    `crop=${geo.w}:${geo.h}`,
    'fps=30',
    'subtitles=captions.ass',
  ].join(',');

  const outPath = path.join(dir, 'clip.mp4');
  ff(dir, [
    '-ss', String(start), '-t', String(clipDur), '-i', 'source.mp4',
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    'clip.mp4',
  ]);

  return { finalPath: outPath, durationSec: clipDur };
}

module.exports = { prepareClipSource, renderClip, buildAss, groupWords };
