// src/components/clonamivoz/VoiceRecorder.jsx
//
// Voice capture for the /clonamivoz tier.
//
// What this component does
// ------------------------
//   1. Manages MediaRecorder lifecycle (start / stop / cleanup on unmount)
//   2. Live RMS frequency-spectrum visualizer (real soundwave from the mic)
//   3. Live timer + zoneFor() encouragement messaging
//   4. QualityProgressBar with 30s / 45s / 75s tick marks
//   5. Collapsible ReadingScriptPanel with humming bonus instructions
//   6. POST-RECORDING: decodes the audio Blob with Web Audio API and
//      computes a quality verdict (duration, volume, noise floor, clipping,
//      silence percentage, expressiveness). The "Continuar" button is GATED
//      on a passable verdict — critical issues (too short, too quiet,
//      heavy clipping, too noisy) hard-block; warnings show but allow
//      proceed.
//
// Why the verdict gating matters
// ------------------------------
// The Suno call costs ~$0.10 per generation. If we send it 8 seconds of
// silence (because the customer's mic was muted), we burn money AND the
// customer gets a useless preview. The verdict screen catches all of that
// BEFORE we spend the quota, AND coaches them through a re-record with
// specific advice ("acércate al micrófono", "busca un lugar más silencioso").

import React, { useEffect, useRef, useState } from 'react';
import { READING_SCRIPT, HUMMING_INSTRUCTION, zoneFor } from './genres';

const BAR_COUNT = 48;

// ---------------------------------------------------------------------------
// Quality verdict thresholds. Tuned to be strict on things that DEFINITELY
// break voice cloning, lenient on cosmetic stuff.
// ---------------------------------------------------------------------------
const MIN_DURATION_SEC = 30;        // hard floor — Suno needs at least this
const IDEAL_DURATION_SEC = 60;      // soft target
const MIN_SIGNAL_LEVEL = 0.03;      // RMS — anything quieter is "muted mic"
const GOOD_SIGNAL_LEVEL = 0.08;
const MAX_CLIPPING_PCT = 0.005;     // >0.5% clipped samples = distortion
const MAX_SILENCE_PCT = 0.55;       // >55% silence = mostly nothing recorded
const MIN_SNR = 4;                  // signal:noise floor ratio for "noisy"
const GOOD_SNR = 12;
const MIN_EXPRESSIVENESS = 0.25;    // coefficient of variation of RMS

// ---------------------------------------------------------------------------
// Audio analysis. Reads the recorded Blob, decodes to PCM, walks 50ms
// windows to compute the metrics the verdict screen needs.
// ---------------------------------------------------------------------------
async function analyzeAudioBlob(blob) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0); // mono first channel
    const sampleRate = audioBuffer.sampleRate;
    const durationSec = audioBuffer.duration;

    const windowSize = Math.max(1, Math.floor(sampleRate * 0.05)); // 50ms
    const numWindows = Math.floor(data.length / windowSize);

    const rmsValues = [];
    let peakAmplitude = 0;
    let clippedSamples = 0;

    for (let w = 0; w < numWindows; w++) {
      let sum = 0;
      for (let i = 0; i < windowSize; i++) {
        const sample = data[w * windowSize + i];
        sum += sample * sample;
        const abs = Math.abs(sample);
        if (abs > peakAmplitude) peakAmplitude = abs;
        if (abs > 0.99) clippedSamples++;
      }
      rmsValues.push(Math.sqrt(sum / windowSize));
    }

    ctx.close().catch(() => {});

    if (rmsValues.length === 0) {
      return { durationSec, error: 'no_windows' };
    }

    const meanRms =
      rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
    const sortedRms = [...rmsValues].sort((a, b) => a - b);
    const noiseFloor = sortedRms[Math.floor(sortedRms.length * 0.1)] || 0;
    const signalLevel = sortedRms[Math.floor(sortedRms.length * 0.9)] || 0;
    const variance =
      rmsValues.reduce((s, r) => s + (r - meanRms) ** 2, 0) / rmsValues.length;
    const stdDev = Math.sqrt(variance);

    const silenceThreshold = Math.max(noiseFloor * 2, 0.005);
    const silentWindows = rmsValues.filter((r) => r < silenceThreshold).length;
    const silentPct = silentWindows / rmsValues.length;

    return {
      durationSec,
      meanRms,
      peakAmplitude,
      noiseFloor,
      signalLevel,
      snr: signalLevel / Math.max(noiseFloor, 0.001),
      expressiveness: stdDev / Math.max(meanRms, 0.001),
      clippedPct: clippedSamples / data.length,
      silentPct,
    };
  } catch (e) {
    console.warn('[VoiceRecorder] audio analysis failed:', e);
    return null;
  }
}

/**
 * Build a verdict from analysis numbers. Each metric becomes a "check"
 * with status 'good' | 'warn' | 'fail'. Overall verdict:
 *   - 'fail'   if ANY check is fail (blocks Continuar)
 *   - 'warn'   if any check is warn (allows Continuar with caution)
 *   - 'good'   if all checks are good
 */
function computeVerdict(analysis) {
  if (!analysis) {
    return {
      overall: 'unknown',
      checks: [
        {
          key: 'unknown',
          status: 'warn',
          label: 'No pudimos analizar tu grabación',
          help: 'Si suena bien al reproducirla, continúa de todos modos.',
        },
      ],
    };
  }

  const checks = [];

  // Duration
  if (analysis.durationSec < MIN_DURATION_SEC) {
    checks.push({
      key: 'duration',
      status: 'fail',
      label: `Muy corta (${Math.round(analysis.durationSec)}s)`,
      help: `Necesitas grabar mínimo ${MIN_DURATION_SEC} segundos. Lo ideal son ${IDEAL_DURATION_SEC}-90 segundos.`,
    });
  } else if (analysis.durationSec < IDEAL_DURATION_SEC) {
    checks.push({
      key: 'duration',
      status: 'warn',
      label: `Duración aceptable (${Math.round(analysis.durationSec)}s)`,
      help: `Vas bien, pero con 60-90 segundos la calidad mejora bastante.`,
    });
  } else {
    checks.push({
      key: 'duration',
      status: 'good',
      label: `Duración: ${Math.round(analysis.durationSec)} segundos`,
    });
  }

  // Volume / signal level
  if (analysis.signalLevel < MIN_SIGNAL_LEVEL) {
    checks.push({
      key: 'volume',
      status: 'fail',
      label: 'Volumen demasiado bajo',
      help: 'Casi no se escucha tu voz. Acércate al micrófono o sube el volumen de tu mic.',
    });
  } else if (analysis.signalLevel < GOOD_SIGNAL_LEVEL) {
    checks.push({
      key: 'volume',
      status: 'warn',
      label: 'Volumen un poco bajo',
      help: 'Se escucha, pero podría ser más fuerte. Acércate un poco al micrófono.',
    });
  } else {
    checks.push({
      key: 'volume',
      status: 'good',
      label: 'Volumen: bueno',
    });
  }

  // Clipping
  if (analysis.clippedPct > MAX_CLIPPING_PCT) {
    checks.push({
      key: 'clipping',
      status: 'fail',
      label: 'Audio saturado',
      help: 'Tu voz está demasiado alta y se distorsiona. Aléjate un poco del micrófono.',
    });
  }

  // Noise floor / SNR
  if (analysis.snr < MIN_SNR) {
    checks.push({
      key: 'noise',
      status: 'fail',
      label: 'Mucho ruido de fondo',
      help: 'Hay demasiado ruido ambiente. Busca un lugar más silencioso (cuarto cerrado, sin ventiladores).',
    });
  } else if (analysis.snr < GOOD_SNR) {
    checks.push({
      key: 'noise',
      status: 'warn',
      label: 'Algo de ruido de fondo',
      help: 'Aceptable. Si puedes, intenta en un lugar más callado.',
    });
  } else {
    checks.push({
      key: 'noise',
      status: 'good',
      label: 'Ruido de fondo: bajo',
    });
  }

  // Silence percentage
  if (analysis.silentPct > MAX_SILENCE_PCT) {
    checks.push({
      key: 'silence',
      status: 'fail',
      label: 'Mucho silencio en la grabación',
      help: 'Más de la mitad de la grabación está vacía. Habla o tararea durante todo el tiempo, sin pausas largas.',
    });
  }

  // Expressiveness (variability of RMS — flat monotone won't clone well)
  if (analysis.expressiveness < MIN_EXPRESSIVENESS) {
    checks.push({
      key: 'expressive',
      status: 'warn',
      label: 'Voz un poco monótona',
      help: 'Para mejor calidad, intenta variar el tono. Tararear ayuda mucho con esto.',
    });
  } else {
    checks.push({
      key: 'expressive',
      status: 'good',
      label: 'Variabilidad de voz: buena',
    });
  }

  const overall = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
    ? 'warn'
    : 'good';

  return { overall, checks };
}

// ===========================================================================
// Main component
// ===========================================================================

export default function VoiceRecorder({ onRecordingComplete, maxDurationMs = 120_000 }) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [spectrum, setSpectrum] = useState(() => new Uint8Array(BAR_COUNT));

  // After-recording state — held locally until customer clicks Continuar.
  const [pendingBlob, setPendingBlob] = useState(null);
  const [pendingDurationMs, setPendingDurationMs] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [verdict, setVerdict] = useState(null); // { overall, checks } or null

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
    setPendingBlob(null);
    setPendingDurationMs(0);
    setVerdict(null);
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
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
        const elapsed = Date.now() - startTimeRef.current;
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPendingBlob(blob);
        setPendingDurationMs(elapsed);
        // Run analysis in background; show verdict when done.
        setAnalyzing(true);
        const analysis = await analyzeAudioBlob(blob);
        setVerdict(computeVerdict(analysis));
        setAnalyzing(false);
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
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
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
        /* analyzer is optional */
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

  /** Discard the pending blob and let the customer start over. */
  function discardAndRetry() {
    setPendingBlob(null);
    setPendingDurationMs(0);
    setVerdict(null);
    setPreviewUrl(null);
    setElapsedMs(0);
    // Don't auto-start — they tap GRABAR themselves.
  }

  /** Pass the pending blob up to the parent and continue the flow. */
  function continueWithPending() {
    if (!pendingBlob) return;
    if (typeof onRecordingComplete === 'function') {
      onRecordingComplete(pendingBlob, pendingDurationMs);
    }
  }

  const seconds = Math.floor(elapsedMs / 1000);
  const zone = zoneFor(seconds);

  const zoneToneClass = {
    neutral: 'text-white/70',
    good: 'text-amber-300',
    great: 'text-emerald-300',
    ideal: 'text-bougainvillea',
  }[zone.tone];

  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    if (!recording) return 4;
    const v = spectrum[i] || 0;
    return Math.max(4, Math.round(4 + (v / 255) * 68));
  });

  const progressPct = Math.min(100, (seconds / 90) * 100);

  // True when we have a take that needs verdict + customer decision.
  const hasPendingTake = pendingBlob && !recording;

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
          {!recording && !pendingBlob && (
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
          {!recording && pendingBlob && (
            <button
              type="button"
              onClick={discardAndRetry}
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

      {/* AFTER-RECORDING panel: preview + verdict + continue/retry */}
      {hasPendingTake && (
        <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-5 space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-bougainvillea">
                headphones
              </span>
              Escucha tu grabación
            </div>
            <div className="text-xs px-3 py-1 rounded-full font-semibold bg-white/10 text-white/70">
              {Math.round(pendingDurationMs / 1000)}s
            </div>
          </div>

          {previewUrl && <audio controls src={previewUrl} className="w-full" />}

          {/* Verdict panel */}
          {analyzing && (
            <div className="flex items-center gap-2 text-sm text-white/60 pt-2 border-t border-white/5">
              <span className="material-symbols-outlined animate-spin text-bougainvillea">
                progress_activity
              </span>
              Analizando la calidad de tu grabación…
            </div>
          )}

          {!analyzing && verdict && (
            <VerdictPanel verdict={verdict} onContinue={continueWithPending} onRetry={discardAndRetry} />
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Sub-components
// ===========================================================================

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
              ~75 segundos · {wordCount} palabras · luego tararea 15 segundos
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
        <div className="px-4 pb-4 space-y-4 animate-fadeIn">
          {/* Spoken script */}
          <div className="bg-landing-bg/60 border border-bougainvillea/10 rounded-xl p-5 sm:p-6 text-white text-lg sm:text-xl leading-loose font-body font-medium tracking-wide">
            {READING_SCRIPT.split('\n\n').map((para, i) => (
              <p key={i} className="mb-4 last:mb-0">
                {para}
              </p>
            ))}
          </div>

          {/* Humming bonus — visually distinct so they don't miss it */}
          <div className="rounded-xl bg-bougainvillea/10 border-2 border-bougainvillea/40 p-4 sm:p-5">
            <div className="flex items-start gap-2 mb-2">
              <span className="material-symbols-outlined text-bougainvillea text-2xl">
                music_note
              </span>
              <div>
                <div className="font-bold text-white text-base">
                  {HUMMING_INSTRUCTION.title}
                </div>
                <div className="text-xs text-bougainvillea/90 font-semibold mt-0.5">
                  {HUMMING_INSTRUCTION.subtitle}
                </div>
              </div>
            </div>
            <p className="text-sm text-white/90 leading-relaxed">
              {HUMMING_INSTRUCTION.body}
            </p>
            <div className="mt-3 text-xs text-amber-200 bg-amber-500/10 border-l-4 border-amber-500 px-3 py-2 rounded">
              {HUMMING_INSTRUCTION.warning}
            </div>
          </div>

          <p className="text-xs text-white/50 flex items-start gap-1">
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

/**
 * Quality verdict panel. Shows the per-check results with color codes,
 * an overall verdict banner, and the action buttons. "Continuar" is
 * disabled when the verdict is 'fail' — forces the customer to re-record
 * before they can waste a paid Suno call on garbage.
 */
function VerdictPanel({ verdict, onContinue, onRetry }) {
  const overallStyles = {
    good: {
      bg: 'bg-emerald-500/15 border-emerald-500/40',
      icon: 'check_circle',
      iconColor: 'text-emerald-400',
      title: 'Calidad: Excelente',
      sub: 'Tu grabación está perfecta para clonar tu voz.',
    },
    warn: {
      bg: 'bg-amber-500/15 border-amber-500/40',
      icon: 'warning',
      iconColor: 'text-amber-300',
      title: 'Calidad: Aceptable',
      sub: 'Puedes continuar, pero la calidad mejoraría con una mejor grabación.',
    },
    fail: {
      bg: 'bg-rose-500/15 border-rose-500/40',
      icon: 'error',
      iconColor: 'text-rose-400',
      title: 'Hay que volver a grabar',
      sub: 'Detectamos problemas que afectarían mucho la calidad de tu canción.',
    },
    unknown: {
      bg: 'bg-white/5 border-white/15',
      icon: 'help',
      iconColor: 'text-white/60',
      title: 'No pudimos analizar',
      sub: 'Si suena bien al reproducirla, continúa.',
    },
  }[verdict.overall];

  const checkStyles = {
    good: { icon: 'check_circle', color: 'text-emerald-400' },
    warn: { icon: 'warning', color: 'text-amber-300' },
    fail: { icon: 'error', color: 'text-rose-400' },
  };

  return (
    <div className="space-y-3 pt-2 border-t border-white/5">
      {/* Overall banner */}
      <div className={`rounded-xl border ${overallStyles.bg} p-4 flex items-start gap-3`}>
        <span className={`material-symbols-outlined ${overallStyles.iconColor} text-2xl`}>
          {overallStyles.icon}
        </span>
        <div>
          <div className="font-bold text-white">{overallStyles.title}</div>
          <div className="text-xs text-white/70 mt-0.5">{overallStyles.sub}</div>
        </div>
      </div>

      {/* Per-check list */}
      <ul className="space-y-1.5">
        {verdict.checks.map((c) => {
          const s = checkStyles[c.status] || checkStyles.warn;
          return (
            <li key={c.key} className="flex items-start gap-2 text-sm">
              <span className={`material-symbols-outlined ${s.color} text-base mt-0.5`}>
                {s.icon}
              </span>
              <div className="flex-1">
                <div className="text-white/90">{c.label}</div>
                {c.help && c.status !== 'good' && (
                  <div className="text-xs text-white/50 mt-0.5">{c.help}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        {verdict.overall !== 'fail' ? (
          <button
            type="button"
            onClick={onContinue}
            className="flex-1 rounded-xl bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold py-3 pink-glow transition active:scale-95 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined">arrow_forward</span>
            Continuar con esta grabación
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="flex-1 rounded-xl bg-white/5 border border-white/10 text-white/40 font-semibold py-3 cursor-not-allowed"
          >
            Hay que grabar otra vez
          </button>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white font-semibold px-5 py-3 transition active:scale-95 flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">replay</span>
          Grabar otra vez
        </button>
      </div>
    </div>
  );
}
