// src/components/clonamivoz/wav.js
//
// Client-side WebM/MP4 → WAV re-encoding for Clona Mi Voz (2026-08-08).
//
// Why: Kie's Suno Voice APIs silently DISCARD WebM input — the task never
// registers and the customer would wait forever (pilot-confirmed). Phones
// record WebM (Android) / MP4 (iOS), so before upload we decode the
// recording with Web Audio (the recorder already decodes it once for the
// quality gate) and re-encode to mono 16-bit PCM WAV, which Kie accepts
// (pilot-confirmed) and every backend consumer (upload-customer-voice,
// Suno upload-cover) also handles.
//
// 32 kHz mono keeps a 120 s recording at ~7.7 MB — under the 10 MB upload
// cap — while preserving the full voice band (16 kHz bandwidth).

const TARGET_SAMPLE_RATE = 32000;

/**
 * Re-encode any browser-recorded audio Blob to a mono 16-bit WAV Blob.
 * Falls back to the ORIGINAL blob if decoding fails (old browsers) —
 * callers should treat the result as best-effort.
 *
 * @param {Blob} blob  MediaRecorder output (webm/mp4/anything decodable)
 * @returns {Promise<Blob>} audio/wav Blob, or the original blob on failure
 */
export async function blobToWav(blob) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !window.OfflineAudioContext) return blob;

    const ctx = new AC();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close().catch(() => {});

    // Downmix + resample via OfflineAudioContext (native, fast).
    const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    const pcm = rendered.getChannelData(0);

    // 16-bit PCM WAV container.
    const dataBytes = pcm.length * 2;
    const buf = new ArrayBuffer(44 + dataBytes);
    const v = new DataView(buf);
    const writeStr = (off, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);          // fmt chunk size
    v.setUint16(20, 1, true);           // PCM
    v.setUint16(22, 1, true);           // mono
    v.setUint32(24, TARGET_SAMPLE_RATE, true);
    v.setUint32(28, TARGET_SAMPLE_RATE * 2, true); // byte rate
    v.setUint16(32, 2, true);           // block align
    v.setUint16(34, 16, true);          // bits per sample
    writeStr(36, 'data');
    v.setUint32(40, dataBytes, true);
    let off = 44;
    for (let i = 0; i < pcm.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  } catch (e) {
    console.warn('[clonamivoz/wav] WAV re-encode failed, using original blob:', e);
    return blob;
  }
}
