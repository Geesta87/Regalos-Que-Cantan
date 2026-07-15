// video-renderer/spliceAudio.cjs
// Server-side surgical song splice with a SEAMLESS seam. Runs on the in-house
// ffmpeg Cloud Run (see server.js /splice-audio). Replaces the browser Web-Audio
// splice (src/utils/audioSplice.js), whose linear crossfade + no duration-match
// made the seam audible ("off-beat when the correction came in").
//
// Two modes, mirroring the frontend:
//   line    — replace ONE line in place: pristine[0..pStart] + fitted corrected
//             line + pristine[pEnd..]. The corrected line is time-stretched
//             (pitch preserved, rubberband) to EXACTLY fill the hole so the beat
//             after the seam is preserved — the key fix.
//   section — re-sing from a point onward: resung[0..resungCut] + pristine[origCut..].
//             One seam; equal-power crossfade + gain-match (no hole to fit).
// Both: equal-power (qsin) crossfades and a loudness match of the re-sung audio
// to the surrounding original. Pure file ops; the server does download/upload.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}
function probeDur(file) {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]).toString().trim());
}
function meanDb(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = ((r.stderr || '') + (r.stdout || '')).match(/mean_volume:\s*(-?[0-9.]+) dB/);
  return m ? parseFloat(m[1]) : null;
}
const SR = '44100';

// Snap a cut time to the QUIETEST micro-moment within ±win seconds. Legato
// singing has no real breath gaps, so cutting exactly on a Whisper word-boundary
// still slices mid-voice; landing the seam on the local energy minimum (a
// consonant edge / the dip between syllables) masks the join between two takes.
// Returns the absolute time (seconds) of the lowest-RMS ~8ms frame in the window.
function snapQuiet(file, targetS, win = 0.12) {
  const start = Math.max(0, targetS - win);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(2 * win), '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '8000', 'pipe:1'], { maxBuffer: 1 << 24 });
  const buf = r.stdout;
  if (!buf || buf.length < 320) return targetS;
  const frame = 64; // ~8ms at 8kHz
  let best = { rms: Infinity, i: 0 };
  for (let i = 0; i + frame <= buf.length / 2; i += frame) {
    let sum = 0;
    for (let j = 0; j < frame; j++) { const s = buf.readInt16LE((i + j) * 2); sum += s * s; }
    const rms = sum / frame;
    if (rms < best.rms) best = { rms, i };
  }
  return start + (best.i + frame / 2) / 8000;
}

// Extract [start,end] of `src` into `out` (input-side seek so filters see full res).
function cut(src, start, dur, out, filter) {
  const a = ['-ss', String(start)];
  if (dur != null) a.push('-t', String(dur));
  a.push('-i', src);
  if (filter) a.push('-af', filter);
  a.push('-ar', SR, '-ac', '2', out);
  ff(a);
}
// Match `file`'s loudness to `refDb` (dBFS) in place.
function gainMatchTo(file, refDb, tmp) {
  if (refDb == null) return;
  const cur = meanDb(file);
  if (cur == null) return;
  const delta = (refDb - cur).toFixed(2);
  if (Math.abs(delta) < 0.1) return;
  const g = `${tmp}/_g.wav`;
  ff(['-i', file, '-af', `volume=${delta}dB`, '-ar', SR, '-ac', '2', g]);
  fs.renameSync(g, file);
}
function crossfade(a, b, out, xfade) {
  ff(['-i', a, '-i', b, '-filter_complex', `[0][1]acrossfade=d=${xfade}:c1=qsin:c2=qsin[o]`, '-map', '[o]', '-ar', SR, '-ac', '2', out]);
}

// LINE mode — replace pristine[pStart,pEnd] with the take's [rStart,rEnd],
// time-stretched to fill the hole exactly. Writes `out` (wav).
function spliceLine({ pristine, pStart, pEnd, resung, rStart, rEnd, out, xfade = 0.09, snapWin = 0.12, noStretch = false, tmp }) {
  // Snap all four cut points to the local quiet spot so each seam lands in the
  // lowest-energy micro-moment (masks the voice-to-voice join).
  if (snapWin > 0) {
    pStart = snapQuiet(pristine, pStart, snapWin);
    pEnd = snapQuiet(pristine, pEnd, snapWin);
    rStart = snapQuiet(resung, rStart, snapWin);
    rEnd = snapQuiet(resung, rEnd, snapWin);
  }
  const holeLen = pEnd - pStart, lineLen = rEnd - rStart;
  if (holeLen <= 0 || lineLen <= 0) throw new Error('bad line window');
  const A = `${tmp}/_A.wav`, B = `${tmp}/_B.wav`, C = `${tmp}/_C.wav`, AB = `${tmp}/_AB.wav`;
  cut(pristine, 0, pStart, A);
  let tempo = 1;
  if (noStretch) {
    // NO time-stretch: the corrected words play at their natural speed, and the
    // original resumes right after them (pEnd is ignored — the tail simply shifts
    // by the natural length difference, which is tiny for a short segment). This
    // is the fix for material where the re-sing tempo differs from the original.
    cut(resung, rStart, lineLen, B);
    cut(pristine, pStart + lineLen, null, C);
  } else {
    const targetLen = holeLen + 2 * xfade;               // two acrossfades each eat `xfade`
    tempo = Math.max(0.5, Math.min(2.0, lineLen / targetLen));
    cut(resung, rStart, lineLen, B, `atempo=${tempo.toFixed(6)}`);
    cut(pristine, pEnd, null, C);
  }
  // Gain-match the corrected words to the pristine just before the seam.
  const ref = `${tmp}/_ref.wav`; cut(pristine, Math.max(0, pStart - 3), 3, ref);
  gainMatchTo(B, meanDb(ref), tmp);
  crossfade(A, B, AB, xfade);
  crossfade(AB, C, out, xfade);
  return { out, tempo, holeLen, lineLen, noStretch };
}

// SECTION mode — resung[0,resungCut] then pristine[origCut..end], one seam.
function spliceSection({ pristine, origCut, resung, resungCut, out, xfade = 0.12, tmp }) {
  const A = `${tmp}/_sA.wav`, C = `${tmp}/_sC.wav`;
  cut(resung, 0, resungCut, A);
  cut(pristine, origCut, null, C);
  // Match the re-sung head loudness to the pristine tail it joins.
  gainMatchTo(A, meanDb(C), tmp);
  crossfade(A, C, out, xfade);
  return { out };
}

module.exports = { spliceLine, spliceSection, probeDur };
