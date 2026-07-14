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
  // Emphasized (AI-tagged) words render gold and ~18% bigger at all times;
  // the active-word paint still walks across the non-emphasized ones.
  const empSize = Math.round(geo.fontsize * 1.18);
  const empOpen = `{\\c${GOLD}&\\fs${empSize}}`;
  const empClose = `{\\c${WHITE}&\\fs${geo.fontsize}}`;
  const groups = groupWords(words, st.wordsPerGroup);
  for (const group of groups) {
    const texts = group.map((w) => {
      const t = assEscape(w.word);
      return { txt: st.upper ? t.toUpperCase() : t, emp: !!w.emp };
    });
    if (!st.highlight) {
      // One dialogue per group, no per-word paint.
      const text = texts.map((x) => (x.emp ? `${empOpen}${x.txt}${empClose}` : x.txt)).join(' ');
      lines.push(`Dialogue: 0,${toAssTime(group[0].start)},${toAssTime(group[group.length - 1].end)},Cap,,0,0,0,,${text}`);
      continue;
    }
    // One dialogue per word: full group shown, the spoken word painted.
    for (let i = 0; i < group.length; i++) {
      const from = i === 0 ? group[0].start : group[i].start;
      const to = i < group.length - 1 ? group[i + 1].start : group[group.length - 1].end;
      if (to - from < 0.01) continue;
      const text = texts
        .map((x, j) => {
          if (x.emp) return `${empOpen}${x.txt}${empClose}`;
          if (j === i) return `{\\c${st.highlight}&}${x.txt}{\\c${WHITE}&}`;
          return x.txt;
        })
        .join(' ');
      lines.push(`Dialogue: 0,${toAssTime(from)},${toAssTime(to)},Cap,,0,0,0,,${text}`);
    }
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

// Returns smoothed [{t, cx}] keyframes (t clip-local seconds, cx 0..1 face
// center across the frame width), or null when no faces were found at all.
async function detectFaceTrack(dir, start, clipDur, log) {
  // ~1 snapshot/second, capped at 60 per clip to bound Vision cost.
  const rate = Math.min(1, 60 / clipDur);
  const facesDir = path.join(dir, 'faces');
  fs.mkdirSync(facesDir, { recursive: true });
  ff(dir, ['-ss', String(start), '-t', String(clipDur), '-i', 'source.mp4',
    '-vf', `fps=${rate.toFixed(4)},scale=${SAMPLE_W}:-2`, '-q:v', '5', 'faces/f%04d.jpg']);
  const files = fs.readdirSync(facesDir).filter((f) => f.endsWith('.jpg')).sort();
  if (!files.length) return null;

  const token = await getGcpToken();
  const centers = new Array(files.length).fill(null);
  for (let ofs = 0; ofs < files.length; ofs += 16) {
    const batch = files.slice(ofs, ofs + 16);
    const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map((f) => ({
          image: { content: fs.readFileSync(path.join(facesDir, f)).toString('base64') },
          features: [{ type: 'FACE_DETECTION', maxResults: 3 }],
        })),
      }),
    });
    if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    (data.responses || []).forEach((r, i) => {
      const faces = r.faceAnnotations || [];
      if (!faces.length) return;
      // Track the LARGEST face (the main speaker).
      let best = null, bestArea = 0;
      for (const face of faces) {
        const v = (face.boundingPoly || {}).vertices || [];
        if (v.length < 3) continue;
        const xs = v.map((p) => p.x || 0), ys = v.map((p) => p.y || 0);
        const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        if (area > bestArea) { bestArea = area; best = (Math.max(...xs) + Math.min(...xs)) / 2 / SAMPLE_W; }
      }
      if (best != null) centers[ofs + i] = Math.max(0, Math.min(1, best));
    });
  }
  if (centers.every((c) => c == null)) return null;

  // Fill gaps with the nearest detection, then smooth (window 3) and clamp
  // the pan speed so the camera never whips.
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
  const found = centers.filter((c) => c != null).length;
  log(`face track: ${found}/${files.length} frames with a face`);
  return smoothed.map((cx, i) => ({ t: (i + 0.5) * step, cx }));
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

  // Filter Whisper words to the clip range and re-base to t=0. `emp` marks
  // the AI-tagged emphasis words (matched by their absolute start time).
  const empStarts = new Set((opts.emphasis_starts || []).map((t) => Math.round(Number(t) * 100)));
  let words = (job.words || [])
    .filter((w) => w.end > start + 0.05 && w.start < end - 0.05)
    .map((w) => ({
      word: w.word,
      emp: empStarts.has(Math.round(Number(w.start) * 100)),
      start: Math.max(0, w.start - start),
      end: Math.min(clipDur, w.end - start),
    }));

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
    segs = buildKeepSegments(words, clipDur, { breaks: fillerSpans });
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

  // Crop focus. 'auto' asks Google Vision where the speaker is and pans to
  // follow (falls back to center when no face is found or Vision errors).
  let cropX = opts.framing === 'left' ? '0' : opts.framing === 'right' ? 'iw-ow' : '(iw-ow)/2';
  if (opts.framing === 'auto' && job.aspect !== '16:9') {
    try {
      const track = await detectFaceTrack(dir, start, clipDur, log);
      if (track) cropX = faceCropExpr(track);
      else log('face track: no faces found — using center crop');
    } catch (e) {
      log(`face track failed (${e.message}) — using center crop`);
    }
  }

  const post = [
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
  parts.push(`[0:v]scale=${geo.w}:${geo.h}:force_original_aspect_ratio=increase,crop=${geo.w}:${geo.h}:x='${cropX}':y=(ih-oh)/2[vs]`);
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
  parts.push(`[${vbase}]${post}[vout]`);

  // Music bed: looped track as a second input, volume-dropped and side-chain
  // ducked under the speech, then mixed back in (no re-normalizing).
  let audioLabel = speechLabel;
  if (withMusic) {
    log(`music bed: ${job.music_url.slice(0, 100)}`);
    await download(job.music_url, path.join(dir, 'music.mp3'));
    if (hasAudio) {
      parts.push(`[1:a]atrim=end=${outDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.16[mus]`);
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
    const sfxIdx = brollInputBase + broll.length;
    parts.push(`[${sfxIdx}:a]asplit=${broll.length}${broll.map((_, i) => `[w${i}]`).join('')}`);
    const wRefs = broll.map((b, i) => {
      const ms = Math.max(0, Math.round((b.s - 0.12) * 1000));
      parts.push(`[w${i}]adelay=${ms}|${ms},volume=0.35[wd${i}]`);
      return `[wd${i}]`;
    });
    parts.push(`${audioLabel}${wRefs.join('')}amix=inputs=${1 + broll.length}:duration=first:normalize=0[afx]`);
    audioLabel = '[afx]';
  }

  const outPath = path.join(dir, 'clip.mp4');
  const args = ['-ss', String(start), '-t', String(clipDur), '-i', 'source.mp4'];
  if (withMusic) args.push('-stream_loop', '-1', '-i', 'music.mp3');
  broll.forEach((_, i) => args.push('-i', `broll${i}.mp4`));
  if (withSfx) args.push('-i', 'sfx.mp3');
  args.push('-filter_complex', parts.join(';'), '-map', '[vout]');
  if (audioLabel) args.push('-map', audioLabel, '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'clip.mp4');
  ff(dir, args);

  return { finalPath: outPath, durationSec: outDur };
}

module.exports = { prepareClipSource, renderClip, buildAss, groupWords, buildKeepSegments, remapWords };
