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

function buildAss(words, styleKey, aspectKey, opts = {}) {
  const geo = ASPECTS[aspectKey] || ASPECTS['9:16'];
  const st = STYLES[styleKey] || STYLES.boldpop;

  const outline = st.border === 'box'
    ? `3,${Math.round(geo.fontsize / 5)},0`   // BorderStyle=3 (box) — Outline acts as box padding
    : `1,${Math.round(geo.fontsize / 11)},0`; // BorderStyle=1, thick outline
  const backColour = st.border === 'box' ? BOX_BLACK : '&H00000000';
  const outlineColour = st.border === 'box' ? BOX_BLACK : '&H00000000';
  const hookSize = Math.round(geo.fontsize * 0.72);
  const hookMarginTop = geo.h >= 1900 ? 170 : 100;

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
    // Hook title: top-center (alignment 8), soft dark box so it reads on any footage.
    `Style: Hook,DejaVu Sans,${hookSize},${WHITE},${WHITE},${BOX_BLACK},${BOX_BLACK},1,0,0,0,100,100,0,0,3,${Math.round(hookSize / 4)},0,8,60,60,${hookMarginTop},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const lines = [];
  if (opts.hookTitle) {
    const hookEnd = Math.max(1.2, Math.min(2.8, (opts.totalDur || 2.8) - 0.2));
    lines.push(`Dialogue: 1,${toAssTime(0)},${toAssTime(hookEnd)},Hook,,0,0,0,,${assEscape(opts.hookTitle).toUpperCase()}`);
  }
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
// silence removal: keep-segments from word gaps + caption remapping
// ---------------------------------------------------------------------------

// Words (clip-local time) -> segments of speech to KEEP. Gaps between words
// longer than maxGap become jump cuts; each kept segment gets a little
// breathing room (pad) so cuts don't clip consonants.
function buildKeepSegments(words, clipDur, { pad = 0.22, maxGap = 1.0 } = {}) {
  if (!words.length) return [{ start: 0, end: clipDur }];
  const segs = [];
  let s = words[0].start;
  let e = words[0].end;
  for (let i = 1; i < words.length; i++) {
    if (words[i].start - e <= maxGap) {
      e = Math.max(e, words[i].end);
    } else {
      segs.push({ start: s, end: e });
      s = words[i].start;
      e = words[i].end;
    }
  }
  segs.push({ start: s, end: e });
  // pad + clamp + merge overlaps created by padding
  const padded = segs.map((g) => ({ start: Math.max(0, g.start - pad), end: Math.min(clipDur, g.end + pad) }));
  const merged = [padded[0]];
  for (let i = 1; i < padded.length; i++) {
    const last = merged[merged.length - 1];
    if (padded[i].start <= last.end + 0.05) last.end = Math.max(last.end, padded[i].end);
    else merged.push(padded[i]);
  }
  return merged;
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
// render: cut (+ jump cuts) + crop/frame + optional zoom + burn captions
// ---------------------------------------------------------------------------
async function renderClip(job, { dir, log }) {
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

  // Filter Whisper words to the clip range and re-base to t=0.
  let words = (job.words || [])
    .filter((w) => w.end > start + 0.05 && w.start < end - 0.05)
    .map((w) => ({ word: w.word, start: Math.max(0, w.start - start), end: Math.min(clipDur, w.end - start) }));

  // Jump cuts: keep only speech segments, then remap caption timing.
  let segs = [{ start: 0, end: clipDur }];
  let outDur = clipDur;
  if (opts.remove_silences && words.length) {
    segs = buildKeepSegments(words, clipDur);
    const remapped = remapWords(words, segs);
    words = remapped.words;
    outDur = remapped.totalDur;
    log(`silence removal: ${segs.length} segments, ${clipDur.toFixed(1)}s -> ${outDur.toFixed(1)}s`);
  }
  log(`${words.length} words, style=${job.style}, aspect=${job.aspect}, framing=${opts.framing || 'center'}, zoom=${!!opts.zoom}, hook=${!!opts.hook_title_text}`);

  fs.writeFileSync(path.join(dir, 'captions.ass'), buildAss(words, job.style, job.aspect, {
    hookTitle: opts.hook_title_text || null,
    totalDur: outDur,
  }));

  const geo = ASPECTS[job.aspect] || ASPECTS['9:16'];
  const cropX = opts.framing === 'left' ? '0' : opts.framing === 'right' ? 'iw-ow' : '(iw-ow)/2';
  const post = [
    `scale=${geo.w}:${geo.h}:force_original_aspect_ratio=increase`,
    `crop=${geo.w}:${geo.h}:${cropX}:(ih-oh)/2`,
    // Subtle push-in: ~+2.4%/s, capped at 112%. zoompan emits 30fps itself.
    opts.zoom
      ? `zoompan=z='min(1+0.0008*on,1.12)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${geo.w}x${geo.h}:fps=30`
      : 'fps=30',
    'subtitles=captions.ass',
  ].join(',');

  const hasAudio = (() => {
    try {
      return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', 'source.mp4'], { cwd: dir }).toString().includes('audio');
    } catch { return false; }
  })();

  // One filter graph for both paths: trim the kept segments (a single segment
  // when silence removal is off), concat, then crop/zoom/subtitles.
  const parts = [];
  const vRefs = [];
  segs.forEach((seg, i) => {
    parts.push(`[0:v]trim=start=${(start + seg.start).toFixed(3)}:end=${(start + seg.end).toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) parts.push(`[0:a]atrim=start=${(start + seg.start).toFixed(3)}:end=${(start + seg.end).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    vRefs.push(hasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  parts.push(`${vRefs.join('')}concat=n=${segs.length}:v=1:a=${hasAudio ? 1 : 0}${hasAudio ? '[vc][ac]' : '[vc]'}`);
  parts.push(`[vc]${post}[vout]`);

  const outPath = path.join(dir, 'clip.mp4');
  const args = ['-i', 'source.mp4', '-filter_complex', parts.join(';'), '-map', '[vout]'];
  if (hasAudio) args.push('-map', '[ac]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'clip.mp4');
  ff(dir, args);

  return { finalPath: outPath, durationSec: outDur };
}

module.exports = { prepareClipSource, renderClip, buildAss, groupWords, buildKeepSegments, remapWords };
