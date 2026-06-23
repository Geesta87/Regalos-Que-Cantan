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
