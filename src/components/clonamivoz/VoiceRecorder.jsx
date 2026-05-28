// src/components/clonamivoz/VoiceRecorder.jsx
//
// Voice capture for the /clonamivoz tier. Ported (JSX, no TS) from
// suno-voice-clone-test/web-app/components/VoiceRecorder.tsx.
//
// Encapsulates:
//   - MediaRecorder lifecycle (start / stop / cleanup on unmount)
//   - Live RMS analyser → 32-bar visualizer
//   - Live timer + zoneFor() messaging
//   - QualityProgressBar (30s/45s/75s tick marks)
//   - Optional collapsible ReadingScriptPanel
//   - Playback preview + length-quality copy
//
// All sub-components are co-located in this file so the parent page only
// imports <VoiceRecorder />. They're stateless and small enough that
// splitting them across files would only add file noise.

import React, { useEffect, useRef, useState } from 'react';
import { READING_SCRIPT, zoneFor } from './genres';

// How many bars in the visualizer. 48 gives a smooth, dense waveform
// without overwhelming low-end phones.
const BAR_COUNT = 48;

export default function VoiceRecorder({ onRecordingComplete, maxDurationMs = 120_000 }) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  // Live frequency spectrum sampled to BAR_COUNT bars (each 0-255).
  // Drives the bar heights in the visualizer — actually reflects what
  // the microphone is hearing.
  const [spectrum, setSpectrum] = useState(() => new Uint8Array(BAR_COUNT));

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(0);
  const tickRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }

  async function start() {
    setError(null);
    setPreviewUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      let mime = '';
      for (const m of mimeCandidates) {
        if (window.MediaRecorder && window.MediaRecorder.isTypeSupported(m)) { mime = m; break; }
      }
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
        const elapsed = Date.now() - startTimeRef.current;
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        if (typeof onRecordingComplete === 'function') {
          onRecordingComplete(blob, elapsed);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      setRecording(true);

      tickRef.current = setInterval(() => {
        const e = Date.now() - startTimeRef.current;
        setElapsedMs(e);
        if (e >= maxDurationMs) stop();
      }, 100);

      try {
        // Real-time frequency-spectrum visualizer. fftSize=512 gives 256
        // frequency bins. We sample the first ~96 bins (covers voice
        // fundamental + first few harmonics ≈ 0-8 kHz) and average them
        // down into BAR_COUNT bars so the rendering stays cheap on phones.
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75; // smoother bar motion
        source.connect(analyser);
        analyserRef.current = analyser;

        const binsToUse = Math.min(96, analyser.frequencyBinCount);
        const binsPerBar = Math.max(1, Math.floor(binsToUse / BAR_COUNT));
        const data = new Uint8Array(analyser.frequencyBinCount);

        const animate = () => {
          analyser.getByteFrequencyData(data);
          const sampled = new Uint8Array(BAR_COUNT);
          for (let b = 0; b < BAR_COUNT; b++) {
            let sum = 0;
            for (let k = 0; k < binsPerBar; k++) {
              sum += data[b * binsPerBar + k] || 0;
            }
            sampled[b] = Math.min(255, Math.round(sum / binsPerBar));
          }
          setSpectrum(sampled);
          rafRef.current = requestAnimationFrame(animate);
        };
        animate();
      } catch (_e) {
        /* analyzer is optional — recording still works without it */
      }
    } catch (e) {
      setError(
        `No pudimos acceder al micrófono: ${e.message}. Permite el acceso e intenta otra vez.`
      );
    }
  }

  function stop() {
    cleanup();
    setSpectrum(new Uint8Array(BAR_COUNT));
    setRecording(false);
  }

  const seconds = Math.floor(elapsedMs / 1000);
  const zone = zoneFor(seconds);

  const zoneToneClass = {
    neutral: 'text-white/70',
    good: 'text-amber-300',
    great: 'text-emerald-300',
    ideal: 'text-bougainvillea',
  }[zone.tone];

  // Visualizer bar heights driven by the live frequency spectrum.
  // Each bar maps to a slice of the FFT output → bars actually react to
  // what the microphone is picking up (not a synthetic sine pattern).
  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    if (!recording) return 4;
    // Scale 0-255 spectrum value to a 4-72 px bar with a slight floor so
    // the wave is always visible when audio is reaching the analyzer.
    const v = spectrum[i] || 0;
    return Math.max(4, Math.round(4 + (v / 255) * 68));
  });

  // Progress bar caps visually at the 90-second "ideal" mark.
  const progressPct = Math.min(100, (seconds / 90) * 100);

  return (
    <div className="space-y-5">
      <ReadingScriptPanel />

      <div className="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-6 sm:p-10">
        {/* Visualizer */}
        <div className="flex items-end justify-center gap-1 h-20 mb-6">
          {bars.map((h, i) => (
            <div
              key={i}
              className={`w-1.5 rounded-full transition-all duration-100 ${
                recording
                  ? 'bg-gradient-to-t from-bougainvillea to-bougainvillea/60'
                  : 'bg-white/10'
              }`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>

        {/* Record button */}
        <div className="flex flex-col items-center gap-5">
          {!recording && !previewUrl && (
            <button
              type="button"
              onClick={start}
              className="group relative w-40 h-40 rounded-full bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold transition-all pink-glow active:scale-95"
            >
              <span className="absolute inset-0 rounded-full ring-2 ring-bougainvillea/40 group-hover:ring-bougainvillea/70 transition" />
              <span className="material-symbols-outlined text-5xl">mic</span>
              <span className="block text-xs mt-1 tracking-widest">GRABAR</span>
            </button>
          )}
          {!recording && previewUrl && (
            <button
              type="button"
              onClick={start}
              className="rounded-full bg-white/10 hover:bg-white/20 border border-white/20 px-6 py-3 text-white font-semibold transition active:scale-95 flex items-center gap-2"
            >
              <span className="material-symbols-outlined">replay</span>
              Grabar otra vez
            </button>
          )}
          {recording && (
            <button
              type="button"
              onClick={stop}
              className="w-40 h-40 rounded-full bg-gradient-to-br from-bougainvillea to-[#d40b6e] text-white font-bold animate-pulse-glow active:scale-95 transition"
            >
              <span className="material-symbols-outlined text-5xl">stop</span>
              <span className="block text-xs mt-1 tracking-widest">PARAR</span>
            </button>
          )}

          {/* Timer */}
          <div className="text-center">
            <div className={`text-5xl font-mono font-bold ${zoneToneClass}`}>
              {String(Math.floor(seconds / 60)).padStart(2, '0')}:
              {String(seconds % 60).padStart(2, '0')}
            </div>
            <div className={`text-sm font-semibold mt-2 ${zoneToneClass}`}>{zone.label}</div>
          </div>

          {(recording || seconds > 0) && (
            <QualityProgressBar progressPct={progressPct} />
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm p-4 flex items-start gap-2">
          <span className="material-symbols-outlined text-rose-400">error</span>
          <span>{error}</span>
        </div>
      )}

      {previewUrl && !recording && (
        <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-5 animate-fadeIn">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-bougainvillea">headphones</span>
              Escucha tu grabación
            </div>
            <div
              className={`text-xs px-3 py-1 rounded-full font-semibold ${
                seconds >= 75 ? 'bg-bougainvillea/20 text-bougainvillea'
                  : seconds >= 45 ? 'bg-emerald-500/20 text-emerald-300'
                  : seconds >= 30 ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-rose-500/20 text-rose-300'
              }`}
            >
              {seconds}s
            </div>
          </div>
          <audio controls src={previewUrl} className="w-full" />
          {seconds < 30 && (
            <p className="text-xs text-rose-300 mt-3">
              Esta grabación es muy corta para clonar la voz. Re-graba con al menos 45 segundos.
            </p>
          )}
          {seconds >= 30 && seconds < 45 && (
            <p className="text-xs text-amber-300 mt-3">
              Aceptable, pero la calidad mejora mucho con 60-90 segundos.
            </p>
          )}
          {seconds >= 45 && seconds < 75 && (
            <p className="text-xs text-emerald-300 mt-3">
              Buena duración. Si quieres calidad ideal, intenta 75-90 segundos.
            </p>
          )}
          {seconds >= 75 && (
            <p className="text-xs text-bougainvillea mt-3">
              ✨ Excelente duración — calidad ideal para clonar la voz.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible 90-second reading-script panel. Defaults to open so the
 * customer sees the script before they hit record. Toggles closed for
 * customers who'd rather freestyle.
 */
function ReadingScriptPanel() {
  const [open, setOpen] = useState(true);
  const wordCount = READING_SCRIPT.trim().split(/\s+/).length;

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-bougainvillea">menu_book</span>
          <div>
            <div className="font-semibold text-white">Script para leer mientras grabas</div>
            <div className="text-xs text-white/50">
              ~90 segundos · {wordCount} palabras · Lee despacio y con naturalidad
            </div>
          </div>
        </div>
        <span
          className="material-symbols-outlined text-bougainvillea/70 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)' }}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 animate-fadeIn">
          <div className="bg-landing-bg/60 border border-bougainvillea/10 rounded-xl p-5 sm:p-6 text-white text-lg sm:text-xl leading-loose font-body font-medium tracking-wide">
            {READING_SCRIPT.split('\n\n').map((para, i) => (
              <p key={i} className="mb-4 last:mb-0">{para}</p>
            ))}
          </div>
          <p className="text-xs text-white/50 mt-3 flex items-start gap-1">
            <span className="material-symbols-outlined text-base text-bougainvillea">
              tips_and_updates
            </span>
            Tip: lee con tu voz natural, sin actuar. Solo necesitamos escuchar tu timbre real. Toma pausas si lo necesitas.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Visual quality bar with zone tick-marks. Fills from amber → emerald →
 * bougainvillea as the customer keeps recording. Marker positions:
 * 30s = Mínimo, 45s = Bueno, 75s = Ideal (out of a 90s "full bar").
 */
function QualityProgressBar({ progressPct }) {
  return (
    <div className="w-full max-w-md mt-2">
      <div className="relative h-4 bg-white/5 rounded-full overflow-hidden border border-white/10">
        <div
          className="h-full bg-gradient-to-r from-amber-400 via-emerald-400 to-bougainvillea transition-all duration-200 ease-out"
          style={{ width: `${progressPct}%` }}
        />
        {[
          { pct: (30 / 90) * 100, key: 'min' },
          { pct: (45 / 90) * 100, key: 'good' },
          { pct: (75 / 90) * 100, key: 'ideal' },
        ].map((m) => (
          <div
            key={m.key}
            className="absolute top-0 bottom-0 w-px bg-white/30"
            style={{ left: `${m.pct}%` }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-white/40 mt-1.5 tracking-wider uppercase font-semibold">
        <span>0s</span>
        <span>Mín 30s</span>
        <span>Bueno 45s</span>
        <span>Ideal 75-90s</span>
      </div>
    </div>
  );
}
