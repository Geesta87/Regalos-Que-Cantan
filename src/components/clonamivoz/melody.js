// src/components/clonamivoz/melody.js
//
// Monotone detector for Clona Mi Voz recordings (2026-08-27).
//
// Why: the voice clone learns PITCH CHARACTER from the sample. The owner
// recorded a flat, read-aloud take and every generated song came out
// monotone. Coaching copy helps, but the reliable fix is to MEASURE the
// take before spending enrollment/Kie quota and warn when it's flat.
//
// How: decode the recording, estimate pitch (f0) on short frames with
// normalized autocorrelation, keep confident voiced frames in the human
// singing range, and measure the melodic SPREAD in semitones. Singing —
// even bad singing — spans ~5+ semitones between its low and high notes;
// flat reading sits within ~2-3.
//
// Deliberately fail-open: any decode/analysis problem returns
// { ok:false } and the caller proceeds as if the take were fine. A missed
// warning is annoying; a false block is a lost customer.

/**
 * Normalized autocorrelation pitch estimate for one frame.
 * Returns { freq, confidence } — confidence is the correlation peak (0-1).
 */
function estimatePitch(samples, start, frameSize, sampleRate) {
  const minFreq = 70;   // low male singing
  const maxFreq = 500;  // high female singing
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), frameSize - 1);

  let energy = 0;
  for (let i = 0; i < frameSize; i++) {
    const v = samples[start + i];
    energy += v * v;
  }
  if (energy < 1e-4) return { freq: 0, confidence: 0 }; // silence

  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < frameSize - lag; i++) {
      corr += samples[start + i] * samples[start + i + lag];
    }
    corr /= energy;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return { freq: 0, confidence: 0 };
  return { freq: sampleRate / bestLag, confidence: bestCorr };
}

/**
 * Analyze a recording Blob for melodic range.
 *
 * @returns {Promise<{ok: boolean, monotone?: boolean, rangeSemitones?: number,
 *                    voicedSeconds?: number, reason?: string}>}
 *   ok=false          → analysis unavailable, treat as fine (fail-open)
 *   monotone=true     → p10–p90 pitch spread under the singing threshold
 */
export async function analyzeMelody(blob) {
  let ctx;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return { ok: false, reason: 'no_audio_context' };
    ctx = new AudioCtx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const sr = buf.sampleRate;
    const ch = buf.getChannelData(0);

    // Analyze at most the first 90s; 40ms frames, 30ms hop. Downsample the
    // work by striding frames — plenty of resolution for a spread measure.
    const frameSize = Math.floor(sr * 0.04);
    const hop = Math.floor(sr * 0.03);
    const end = Math.min(ch.length, sr * 90) - frameSize;

    const semis = [];
    for (let i = 0; i < end; i += hop) {
      const { freq, confidence } = estimatePitch(ch, i, frameSize, sr);
      // Confident voiced frames only — unvoiced consonants and room noise
      // produce junk estimates that fake melodic range.
      if (confidence > 0.6 && freq >= 70 && freq <= 500) {
        semis.push(12 * Math.log2(freq / 55));
      }
    }

    const voicedSeconds = (semis.length * hop) / sr;
    if (semis.length < 40 || voicedSeconds < 5) {
      return { ok: false, reason: 'too_little_voiced_audio' };
    }

    // Robust spread: p10–p90 in semitones (ignores octave-error outliers
    // better than min–max; a median filter first knocks down single-frame
    // octave jumps).
    const filtered = semis.map((v, i, a) => {
      const w = [a[Math.max(0, i - 1)], v, a[Math.min(a.length - 1, i + 1)]];
      return w.sort((x, y) => x - y)[1];
    });
    const sorted = [...filtered].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.10)];
    const p90 = sorted[Math.floor(sorted.length * 0.90)];
    const rangeSemitones = p90 - p10;

    // Singing (even casual singing) spans 5+ semitones p10–p90. Flat
    // reading sits around 2-3. Threshold 4 = conservative: warns on clear
    // monotone, lets borderline takes through.
    return {
      ok: true,
      monotone: rangeSemitones < 4,
      rangeSemitones: Math.round(rangeSemitones * 10) / 10,
      voicedSeconds: Math.round(voicedSeconds),
    };
  } catch (e) {
    console.warn('[clonamivoz/melody] analysis failed (fail-open):', e);
    return { ok: false, reason: 'decode_or_analysis_error' };
  } finally {
    try { if (ctx) ctx.close(); } catch { /* non-fatal */ }
  }
}
