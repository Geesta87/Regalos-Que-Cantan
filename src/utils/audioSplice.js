// src/utils/audioSplice.js
//
// Browser-side audio splice for the surgical song fix (the PROVEN recipe,
// validated 2026-06-23 — see memory project_fix_song_section). It takes the
// re-sung block audio (corrected date/name) + the PRISTINE original, and joins
// [ re-sung 0..resungCut ] + [ original origCut..end ] with a short crossfade,
// so only the corrected lines are AI-re-sung and the rest of the song stays the
// untouched original. Runs entirely in the browser — no server ffmpeg.
//
// Output is a real MP3 Blob (encoded with @breezystack/lamejs, already a
// dependency), small enough to upload and stream like any other song.

import { Mp3Encoder } from '@breezystack/lamejs';

const TARGET_SR = 44100; // lamejs-friendly; decodeAudioData resamples to this.

function getCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  // Force 44.1k so the offline render + MP3 encoder agree on sample rate.
  try { return new AC({ sampleRate: TARGET_SR }); } catch { return new AC(); }
}

async function decode(url, ctx) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar el audio (${res.status})`);
  const buf = await res.arrayBuffer();
  return await ctx.decodeAudioData(buf);
}

function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function audioBufferToMp3Blob(buffer, kbps = 192) {
  const channels = buffer.numberOfChannels >= 2 ? 2 : 1;
  const sr = buffer.sampleRate;
  const enc = new Mp3Encoder(channels, sr, kbps);
  const left = floatToInt16(buffer.getChannelData(0));
  const right = channels === 2 ? floatToInt16(buffer.getChannelData(1)) : null;
  const blockSize = 1152;
  const chunks = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const mp3 = right
      ? enc.encodeBuffer(l, right.subarray(i, i + blockSize))
      : enc.encodeBuffer(l);
    if (mp3.length > 0) chunks.push(new Int8Array(mp3));
  }
  const end = enc.flush();
  if (end.length > 0) chunks.push(new Int8Array(end));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

// Splice the corrected re-sung lines onto the pristine original.
//   resungUrl   – Kie replace-section output (corrected block at the front)
//   resungCutS  – seconds: cut the re-sung audio here (just after the last
//                 corrected line, before Suno's padding)
//   originalUrl – the customer's original song
//   origCutS    – seconds: take the original from here onward (same musical
//                 point — the block's end, where the instrumental break is)
//   xfade       – crossfade length at the single seam (default 0.3s)
// Returns { blob, url, durationS } where url is an object URL for instant
// in-card playback.
export async function spliceIntoOriginal({ resungUrl, resungCutS, originalUrl, origCutS, xfade = 0.3 }) {
  const ctx = getCtx();
  let reBuf, orBuf;
  try {
    [reBuf, orBuf] = await Promise.all([decode(resungUrl, ctx), decode(originalUrl, ctx)]);
  } finally {
    // Decode is done; release the live context (render uses an offline one).
    if (ctx.close) ctx.close();
  }

  const sr = reBuf.sampleRate;
  const xf = Math.max(0, Math.min(xfade, resungCutS - 0.05, (orBuf.duration - origCutS) - 0.05));
  const aLen = Math.max(0, Math.min(resungCutS, reBuf.duration));
  const bLen = Math.max(0, orBuf.duration - origCutS);
  const totalDur = aLen + bLen - xf;
  if (totalDur <= 0) throw new Error('Puntos de empalme inválidos.');

  const channels = Math.max(reBuf.numberOfChannels, orBuf.numberOfChannels) >= 2 ? 2 : 1;
  const off = new OfflineAudioContext(channels, Math.ceil(totalDur * sr), sr);

  // Segment A: re-sung corrected lines, faded out over the last `xf`.
  const aSrc = off.createBufferSource();
  aSrc.buffer = reBuf;
  const aGain = off.createGain();
  aSrc.connect(aGain).connect(off.destination);
  aGain.gain.setValueAtTime(1, 0);
  if (xf > 0) {
    aGain.gain.setValueAtTime(1, Math.max(0, aLen - xf));
    aGain.gain.linearRampToValueAtTime(0, aLen);
  }
  aSrc.start(0, 0, aLen);

  // Segment B: pristine original from origCutS, faded in, overlapping the seam.
  const bStart = Math.max(0, aLen - xf);
  const bSrc = off.createBufferSource();
  bSrc.buffer = orBuf;
  const bGain = off.createGain();
  bSrc.connect(bGain).connect(off.destination);
  if (xf > 0) {
    bGain.gain.setValueAtTime(0, bStart);
    bGain.gain.linearRampToValueAtTime(1, bStart + xf);
  } else {
    bGain.gain.setValueAtTime(1, bStart);
  }
  bSrc.start(bStart, origCutS, bLen);

  const rendered = await off.startRendering();
  const blob = audioBufferToMp3Blob(rendered, 192);
  return { blob, url: URL.createObjectURL(blob), durationS: rendered.duration };
}

// Parse the edge fn's `transcribe` "timed" string ("word[start-end] …") into
// word objects, and find the END time of the last line of `sectionText` (the
// splice point in the re-sung audio). Mirrors scripts/fix-song-surgical.cjs.
export function parseTimed(timed) {
  if (!timed) return [];
  return timed.split(' ').map((tok) => {
    const m = tok.match(/^(.*)\[([0-9.]+)-([0-9.]+)\]$/);
    return m ? { word: m[1], start: +m[2], end: +m[3] } : null;
  }).filter(Boolean);
}

function norm(w) {
  return String(w || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// Validate that a re-sung take ACTUALLY sang the correction — in order,
// contiguously, with the real words. Kie replace-section (especially on
// corridos) frequently SKIPS the corrected line, inserts hallucinated gibberish,
// or mangles a name ("Adrián" for "Arianna"). "Pick the tightest take" silently
// accepts those. `tokenGroups` is an ordered list of expected words; each group
// is an array of acceptable normalized alternatives (e.g. ['2019','diecinueve']).
// Returns { ok, reason, endS, maxGap, span }. A clean take matches every group in
// order with no large gap between consecutive hits.
function _lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
export function validateTake(words, tokenGroups, { maxGapS = 6, maxSpanS = 32 } = {}) {
  if (!words?.length) return { ok: false, reason: 'no transcription' };
  if (!tokenGroups?.length) return { ok: true, reason: 'no check' };
  const atoms = words.map((w) => ({ n: norm(w.word ?? w.w), s: w.start ?? w.s, e: w.end ?? w.e }));
  // Fuzzy word equality — tolerant of Whisper spelling noise (mezquite≈mesquite),
  // prefixes, and single-character edits on longer words.
  const grpEq = (n, group) => group.some((g) => n === g
    || (n.length > 3 && g.length > 3 && (n.startsWith(g) || g.startsWith(n)))
    || (Math.max(n.length, g.length) >= 5 && Math.abs(n.length - g.length) <= 1 && _lev(n, g) <= 1));
  let best = null;
  for (let start = 0; start < atoms.length; start++) {
    if (!grpEq(atoms[start].n, tokenGroups[0])) continue;
    let gi = 0, ai = start, maxGap = 0, prevE = atoms[start].s;
    const hit = [];
    while (gi < tokenGroups.length && ai < atoms.length) {
      if (grpEq(atoms[ai].n, tokenGroups[gi])) { const gap = atoms[ai].s - prevE; if (gap > maxGap) maxGap = gap; prevE = atoms[ai].e; hit.push(atoms[ai]); gi++; }
      ai++;
    }
    if (gi === tokenGroups.length) {
      const span = hit[hit.length - 1].e - hit[0].s;
      if (!best || maxGap < best.maxGap) best = { maxGap, span, endS: hit[hit.length - 1].e };
    }
  }
  if (!best) return { ok: false, reason: 'las palabras corregidas no se cantaron (¿saltó la línea?)' };
  if (best.maxGap > maxGapS) return { ok: false, reason: `hueco de ${best.maxGap.toFixed(1)}s (¿balbuceo/repetición?)`, ...best };
  if (best.span > maxSpanS) return { ok: false, reason: `tramo de ${best.span.toFixed(1)}s demasiado largo`, ...best };
  return { ok: true, endS: best.endS, maxGap: best.maxGap, span: best.span };
}

// Build ordered token-groups for validateTake from a corrected line of lyrics.
// Content words become one-word groups. Spelled Spanish YEARS ("mil novecientos
// setenta y cinco", "dos mil catorce") are collapsed to the DIGIT form Whisper
// actually transcribes ("1975", "2014") — via a parser so ANY year 1900-2099
// works (parents'/grandparents' birth years included), not a hand-listed table
// that silently false-rejects the years it forgot. Standalone number words also
// accept their digit form (age contexts, e.g. "catorce años" -> "14").
const _UNITS = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const _TEENS = { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19 };
const _TENS = { veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const _COMPOUND = { veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
const _FILLER = new Set(['de', 'del', 'la', 'el', 'y', 'a', 'en', 'que', 'lo', 'los', 'las', 'un', 'una', 'mi', 'me', 'te', 'su', 'con', 'por', 'dos', 'mil', 'has']);

// Parse a 0-99 quantity at t[i]; returns { val, next } or null.
function _parseUnder100(t, i) {
  const w = t[i];
  if (_COMPOUND[w] != null) return { val: _COMPOUND[w], next: i + 1 };
  if (_TEENS[w] != null) return { val: _TEENS[w], next: i + 1 };
  if (_TENS[w] != null) {
    if (t[i + 1] === 'y' && _UNITS[t[i + 2]] != null) return { val: _TENS[w] + _UNITS[t[i + 2]], next: i + 3 };
    return { val: _TENS[w], next: i + 1 };
  }
  if (_UNITS[w] != null) return { val: _UNITS[w], next: i + 1 };
  return null;
}
// Parse a spelled year phrase at t[i]; returns { year, next } or null.
function _parseYear(t, i) {
  if (t[i] === 'mil' && t[i + 1] === 'novecientos') { const p = _parseUnder100(t, i + 2); return { year: 1900 + (p ? p.val : 0), next: p ? p.next : i + 2 }; }
  if (t[i] === 'dos' && t[i + 1] === 'mil') { const p = _parseUnder100(t, i + 2); return { year: 2000 + (p ? p.val : 0), next: p ? p.next : i + 2 }; }
  return null;
}
export function buildTokenGroups(correctedLine) {
  const t = String(correctedLine || '').split(/\s+/).map(norm).filter(Boolean);
  const groups = [];
  for (let i = 0; i < t.length;) {
    const y = _parseYear(t, i);
    if (y) { groups.push([String(y.year)]); i = y.next; continue; } // "dos mil catorce" -> ['2014']
    const w = t[i]; i++;
    if (w.length < 2) continue;
    if (_FILLER.has(w)) continue;
    const numVal = _COMPOUND[w] ?? _TEENS[w] ?? _TENS[w] ?? _UNITS[w];
    if (numVal != null) { groups.push([w, String(numVal)]); continue; } // standalone number + digit
    groups.push([w]);
  }
  return groups;
}

export function findLastLineEnd(words, sectionText) {
  const lines = String(sectionText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length || !words.length) return null;
  const tokens = lines[lines.length - 1].split(/\s+/).map(norm).filter((t) => t.length > 1);
  if (!tokens.length) return null;
  const atoms = words.map((w) => ({ n: norm(w.word), end: w.end }));
  const eq = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));
  for (let i = 0; i + tokens.length <= atoms.length; i++) {
    let ok = true;
    for (let j = 0; j < tokens.length; j++) { if (!eq(atoms[i + j].n, tokens[j])) { ok = false; break; } }
    if (ok) return atoms[i + tokens.length - 1].end;
  }
  const last = tokens[tokens.length - 1];
  for (let i = atoms.length - 1; i >= 0; i--) if (eq(atoms[i].n, last)) return atoms[i].end;
  return null;
}
