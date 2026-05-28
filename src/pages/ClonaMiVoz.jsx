// src/pages/ClonaMiVoz.jsx
//
// Page for /clonamivoz — the Clone Mi Voz voice-cloning tier.
//
// Standalone funnel (NOT integrated with the main genre→artist→subgenre→…
// funnel by design — see CLAUDE.md / planning docs). The customer flow is:
//
//   intro     → marketing hero + how-it-works + genre preview + CTA
//   record    → VoiceRecorder + CoachingPanel; on stop → 'configure'
//   configure → genre picker + StoryForm (Claude lyrics) + editable lyrics
//               + optional vocal-gender hint; "Crear mi canción" submits
//   uploading → POST /upload-customer-voice
//   submitting→ POST /generate-cloned-voice-song
//   polling   → loop POST /cloned-voice-status every 5s until terminal
//   done      → SongResult with 1-2 audio URLs + "Crear otra canción"
//   error     → red banner with retry link back to 'configure'
//
// This page intentionally does NOT touch the existing AppContext / formData
// (the Mureka funnel state). It runs its own state because the two funnels
// share no fields.
//
// Stripe is NOT wired up yet — the page is open and free to use. That's
// fine while we self-test internally. The CLAUDE.md rules still apply
// (no shared edge-function changes, no main funnel touches).

import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import VoiceRecorder from '../components/clonamivoz/VoiceRecorder';
import CoachingPanel from '../components/clonamivoz/CoachingPanel';
import StoryForm from '../components/clonamivoz/StoryForm';
import SongResult from '../components/clonamivoz/SongResult';
import { GENRES } from '../components/clonamivoz/genres';
import {
  uploadCustomerVoice,
  generateClonedVoiceSong,
  getClonedVoiceStatus,
} from '../services/clonamivoz';

const STAGES = {
  INTRO: 'intro',
  RECORD: 'record',
  CONFIGURE: 'configure',
  UPLOADING: 'uploading',
  SUBMITTING: 'submitting',
  POLLING: 'polling',
  DONE: 'done',
  ERROR: 'error',
};

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60; // 60 × 5s = 5 min ceiling

const HOW_IT_WORKS = [
  {
    num: '1',
    icon: 'mic',
    title: 'Graba tu voz',
    desc: 'Tararea o canta por 45-90 segundos. No necesitas saber cantar.',
  },
  {
    num: '2',
    icon: 'music_note',
    title: 'Escoge el género',
    desc: 'Romántico, balada, banda, corrido, ranchera o mariachi.',
  },
  {
    num: '3',
    icon: 'auto_awesome',
    title: 'Recibe tu canción',
    desc: 'Creamos una canción única en tu voz en 2-3 minutos.',
  },
];

export default function ClonaMiVoz() {
  const [stage, setStage] = useState(STAGES.INTRO);

  // Voice + upload
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [voiceSampleId, setVoiceSampleId] = useState(null);

  // Generation inputs
  const [genreSlug, setGenreSlug] = useState(GENRES[0].slug);
  const [lyrics, setLyrics] = useState('');
  const [title, setTitle] = useState('');
  const [emotionalModifiers, setEmotionalModifiers] = useState('');
  const [storyContext, setStoryContext] = useState(null);
  const [vocalGender, setVocalGender] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // Generation outputs
  const [clonedVoiceSongId, setClonedVoiceSongId] = useState(null);
  const [audioUrls, setAudioUrls] = useState([]);
  const [finalTitle, setFinalTitle] = useState('');

  // Status
  const [error, setError] = useState(null);
  const [elapsedPolls, setElapsedPolls] = useState(0);

  const selectedGenre = GENRES.find((g) => g.slug === genreSlug) || GENRES[0];

  function handleRecordingComplete(blob, durationMs) {
    setAudioBlob(blob);
    setAudioDurationMs(durationMs);
    setStage(STAGES.CONFIGURE);
  }

  async function submit() {
    if (!audioBlob) {
      setError('Graba tu voz primero.');
      setStage(STAGES.ERROR);
      return;
    }
    if (!lyrics.trim()) {
      setError('Agrega o genera la letra de la canción.');
      setStage(STAGES.ERROR);
      return;
    }

    setError(null);

    // 1. Upload voice
    setStage(STAGES.UPLOADING);
    const uploadRes = await uploadCustomerVoice(audioBlob, {
      customerEmail: customerEmail || undefined,
      durationSeconds: audioDurationMs / 1000,
    });
    if (!uploadRes.ok) {
      setError(`No pudimos subir tu grabación: ${uploadRes.message || uploadRes.error}`);
      setStage(STAGES.ERROR);
      return;
    }
    setVoiceSampleId(uploadRes.voice_sample_id);

    // 2. Submit Suno job
    setStage(STAGES.SUBMITTING);
    const genRes = await generateClonedVoiceSong({
      voiceSampleId: uploadRes.voice_sample_id,
      lyrics: lyrics.trim(),
      title: title || `cancion-${Date.now()}`,
      genreSlug,
      recipientName: storyContext?.recipientName,
      relationship: storyContext?.relationship,
      occasion: storyContext?.occasion,
      story: storyContext?.story,
      customerEmail: customerEmail || undefined,
      vocalGender,
      emotionalModifiers,
      language: storyContext?.language || 'es',
    });
    if (!genRes.ok) {
      setError(`No pudimos enviar la canción: ${genRes.message || genRes.error}`);
      setStage(STAGES.ERROR);
      return;
    }
    setClonedVoiceSongId(genRes.cloned_voice_song_id);

    // 3. Poll for finished audio
    setStage(STAGES.POLLING);
    pollUntilDone(genRes.cloned_voice_song_id);
  }

  async function pollUntilDone(songId) {
    let polls = 0;
    while (polls < MAX_POLLS) {
      polls += 1;
      setElapsedPolls(polls);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const statusRes = await getClonedVoiceStatus(songId);
      if (!statusRes.ok) {
        // network/transient — keep trying until we hit MAX_POLLS
        continue;
      }
      if (statusRes.status === 'success') {
        setAudioUrls(statusRes.audio_urls || []);
        setFinalTitle(statusRes.title || title);
        setStage(STAGES.DONE);
        return;
      }
      if (statusRes.status === 'failed') {
        setError(
          statusRes.error_message ||
            'La generación de la canción falló. Intenta otra vez.'
        );
        setStage(STAGES.ERROR);
        return;
      }
      // status is still generating_song / generating_lyrics / pending — keep polling
    }
    setError(
      `Se acabó el tiempo (${(MAX_POLLS * POLL_INTERVAL_MS) / 1000}s). La canción podría seguir generándose — intenta otra vez en unos minutos.`
    );
    setStage(STAGES.ERROR);
  }

  function resetAll() {
    setStage(STAGES.INTRO);
    setAudioBlob(null);
    setAudioDurationMs(0);
    setVoiceSampleId(null);
    setLyrics('');
    setTitle('');
    setEmotionalModifiers('');
    setStoryContext(null);
    setVocalGender('');
    setClonedVoiceSongId(null);
    setAudioUrls([]);
    setFinalTitle('');
    setError(null);
    setElapsedPolls(0);
  }

  // =============================== Render =================================

  return (
    <div className="min-h-screen bg-landing-bg text-white font-body">
      <Helmet>
        <title>Clona Mi Voz · RegalosQueCantan</title>
        <meta
          name="description"
          content="Graba tu voz y recibe una canción personalizada cantada por ti. Romántico, balada, banda, corrido, ranchera o mariachi."
        />
        {/* No-index for now — internal beta */}
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-10">
        <PageHeader />

        {stage === STAGES.INTRO && <IntroSection onStart={() => setStage(STAGES.RECORD)} />}

        {stage !== STAGES.INTRO && (
          <ProgressSteps stage={stage} />
        )}

        {stage === STAGES.RECORD && (
          <section className="space-y-4">
            <div className="text-center">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mb-2">
                Graba tu voz
              </h2>
              <p className="text-white/60">
                Tararea o canta por 45-90 segundos en un lugar tranquilo.
              </p>
            </div>
            <VoiceRecorder onRecordingComplete={handleRecordingComplete} />
            <CoachingPanel />
          </section>
        )}

        {(stage === STAGES.CONFIGURE ||
          stage === STAGES.UPLOADING ||
          stage === STAGES.SUBMITTING ||
          stage === STAGES.ERROR) && (
          <section className="space-y-6">
            {/* Re-record bar */}
            <div className="flex items-center justify-between rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-3 pl-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-emerald-400">
                  check_circle
                </span>
                <span className="text-white/80">
                  Grabación lista · {Math.round(audioDurationMs / 1000)}s
                </span>
              </div>
              <button
                type="button"
                onClick={() => setStage(STAGES.RECORD)}
                className="text-sm text-bougainvillea hover:brightness-110 font-semibold underline"
              >
                Re-grabar
              </button>
            </div>

            {/* Genre picker */}
            <div>
              <h3 className="font-display text-2xl font-bold text-white mb-4">
                Escoge el género
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {GENRES.map((g) => {
                  const selected = g.slug === genreSlug;
                  return (
                    <button
                      key={g.slug}
                      type="button"
                      onClick={() => setGenreSlug(g.slug)}
                      className={`text-left rounded-2xl p-4 transition active:scale-95 ${
                        selected
                          ? 'bg-gradient-to-br from-bougainvillea to-[#d40b6e] text-white pink-glow border border-bougainvillea'
                          : 'bg-white/5 backdrop-blur-sm border border-white/10 text-white hover:border-bougainvillea/40'
                      }`}
                    >
                      <div className="text-4xl mb-2">{g.emoji}</div>
                      <div className="font-display font-bold text-lg">{g.labelEs}</div>
                      <div
                        className={`text-xs mt-1 ${
                          selected ? 'text-white/90' : 'text-white/50'
                        }`}
                      >
                        {g.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Story → AI lyrics */}
            <StoryForm
              genreSlug={selectedGenre.slug}
              onLyricsGenerated={(generatedLyrics, generatedTitle, emo, ctx) => {
                setLyrics(generatedLyrics);
                if (generatedTitle) setTitle(generatedTitle);
                if (emo) setEmotionalModifiers(emo);
                setStoryContext(ctx);
                setTimeout(() => {
                  const el = document.getElementById('cv-lyrics-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
              }}
            />

            {/* Editable lyrics */}
            <div id="cv-lyrics-section">
              <h3 className="font-display text-2xl font-bold text-white mb-2">
                Letra de la canción
              </h3>
              <p className="text-sm text-white/50 mb-3">
                {lyrics
                  ? '✏️ Edita libremente. '
                  : 'Genera la letra arriba o escríbela aquí. '}
                Usa{' '}
                <code className="text-xs bg-white/10 text-bougainvillea px-1.5 py-0.5 rounded">
                  [Verse]
                </code>
                ,{' '}
                <code className="text-xs bg-white/10 text-bougainvillea px-1.5 py-0.5 rounded">
                  [Chorus]
                </code>
                ,{' '}
                <code className="text-xs bg-white/10 text-bougainvillea px-1.5 py-0.5 rounded">
                  [Bridge]
                </code>{' '}
                para estructurar.
              </p>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={14}
                placeholder={
                  '[Verse]\nHoy te canto, mi querida [nombre]...\n[Chorus]\nTe amo con todo mi corazón...'
                }
                className="w-full rounded-2xl bg-landing-bg/40 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-4 text-sm font-mono text-white placeholder-white/30"
              />
              <div className="text-xs text-white/40 mt-1 text-right">
                {lyrics.length} / 5000
              </div>
            </div>

            {/* Advanced */}
            <details className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-white/80 flex items-center gap-2">
                <span className="material-symbols-outlined text-bougainvillea text-base">
                  tune
                </span>
                Opciones avanzadas
              </summary>
              <div className="mt-4 space-y-3 animate-fadeIn">
                <div>
                  <label
                    htmlFor="cv-title"
                    className="block text-sm font-semibold text-white/80 mb-1"
                  >
                    Título de la canción
                  </label>
                  <input
                    id="cv-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={80}
                    className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cv-vocal-gender"
                    className="block text-sm font-semibold text-white/80 mb-1"
                  >
                    Género vocal{' '}
                    <span className="text-white/40 font-normal">(opcional)</span>
                  </label>
                  <select
                    id="cv-vocal-gender"
                    value={vocalGender}
                    onChange={(e) => setVocalGender(e.target.value)}
                    className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white"
                  >
                    <option value="">Detección automática</option>
                    <option value="m">Masculino</option>
                    <option value="f">Femenino</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="cv-email"
                    className="block text-sm font-semibold text-white/80 mb-1"
                  >
                    Email{' '}
                    <span className="text-white/40 font-normal">
                      (opcional — para recuperar la canción)
                    </span>
                  </label>
                  <input
                    id="cv-email"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    maxLength={200}
                    placeholder="tu@email.com"
                    className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white placeholder-white/30"
                  />
                </div>
              </div>
            </details>

            {/* Submit */}
            <div className="pt-2">
              <button
                type="button"
                onClick={submit}
                disabled={stage === STAGES.UPLOADING || stage === STAGES.SUBMITTING}
                className="w-full rounded-2xl bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold text-lg py-4 pink-glow transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">auto_awesome</span>
                {stage === STAGES.UPLOADING && 'Subiendo tu grabación…'}
                {stage === STAGES.SUBMITTING && 'Procesando…'}
                {stage !== STAGES.UPLOADING &&
                  stage !== STAGES.SUBMITTING &&
                  'Crear mi canción'}
              </button>
              <p className="text-xs text-white/40 mt-2 text-center">
                Generación 1-3 minutos · No cierres esta página · Beta interno
              </p>
            </div>

            {stage === STAGES.ERROR && error && (
              <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4 text-sm text-rose-200 flex items-start gap-2">
                <span className="material-symbols-outlined text-rose-400">error</span>
                <span>{error}</span>
              </div>
            )}
          </section>
        )}

        {stage === STAGES.POLLING && (
          <section className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-8 sm:p-12 text-center space-y-4 animate-fadeIn">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-bougainvillea/20 border border-bougainvillea/30 animate-bounce-slow mb-2">
              <span className="material-symbols-outlined text-bougainvillea text-5xl">
                graphic_eq
              </span>
            </div>
            <h2 className="font-display text-3xl font-bold text-white">
              Creando tu canción…
            </h2>
            <p className="text-white/60">
              Estamos generando dos versiones para ti. Esto toma 1-3 minutos.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-white/50">
              <span className="w-2 h-2 rounded-full bg-bougainvillea animate-pulse" />
              <span>Tiempo: {elapsedPolls * (POLL_INTERVAL_MS / 1000)}s</span>
            </div>
            {clonedVoiceSongId && (
              <div className="bg-landing-bg/60 rounded-xl p-3 text-xs text-white/50 mt-4 border border-white/5">
                <code className="text-bougainvillea">{clonedVoiceSongId}</code>
                <br />
                <span className="text-white/40">
                  Si cierras esta página, guarda este ID para recuperar tu canción.
                </span>
              </div>
            )}
          </section>
        )}

        {stage === STAGES.DONE && (
          <SongResult title={finalTitle} audioUrls={audioUrls} onCreateAnother={resetAll} />
        )}

        {stage === STAGES.ERROR && error && stage !== STAGES.CONFIGURE && (
          <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-5 space-y-3">
            <h2 className="font-bold text-rose-200 flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              Algo salió mal
            </h2>
            <p className="text-sm text-rose-200/80">{error}</p>
            <button
              type="button"
              onClick={() => setStage(STAGES.CONFIGURE)}
              className="text-sm text-bougainvillea underline font-semibold"
            >
              Volver a configurar
            </button>
          </div>
        )}

        <FooterDisclaimer />
      </div>
    </div>
  );
}

// =========================== Sub-sections ===========================

function PageHeader() {
  return (
    <header className="flex items-center justify-between">
      <a href="/" className="font-display text-xl font-bold text-white">
        Regalos<span className="text-bougainvillea">Que</span>Cantan
      </a>
      <div className="inline-flex items-center gap-1.5 bg-bougainvillea/10 border border-bougainvillea/30 text-bougainvillea text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest">
        <span className="material-symbols-outlined text-xs">science</span>
        Beta interno
      </div>
    </header>
  );
}

function IntroSection({ onStart }) {
  return (
    <div className="space-y-12 sm:space-y-16">
      <section className="text-center py-8 sm:py-12 px-2 relative">
        <div className="inline-flex items-center gap-2 bg-bougainvillea/10 border border-bougainvillea/30 text-bougainvillea text-xs font-semibold px-3 py-1.5 rounded-full mb-6 uppercase tracking-wider">
          <span className="material-symbols-outlined text-base">auto_awesome</span>
          Nuevo · Tu voz, tu canción
        </div>
        <h1 className="font-display text-5xl sm:text-7xl font-bold leading-tight tracking-tight">
          <span className="text-white">Tu voz, en una</span>
          <br />
          <span className="bg-gradient-to-r from-bougainvillea via-[#d40b6e] to-bougainvillea bg-clip-text text-transparent">
            canción única
          </span>
        </h1>
        <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed mt-6">
          Graba tu voz por unos segundos y crearemos una canción personalizada
          <em className="text-white"> cantada por ti</em>. Para cumpleaños, aniversarios, o cualquier momento especial.
        </p>
        <button
          type="button"
          onClick={onStart}
          className="mt-10 inline-flex items-center gap-2 bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold text-lg px-10 py-4 rounded-full pink-glow transition active:scale-95"
        >
          <span className="material-symbols-outlined">mic</span>
          Empezar ahora
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
        <div className="mt-3 text-xs text-white/40">
          Toma ~5 minutos · Generación en 2-3 minutos
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {HOW_IT_WORKS.map((s) => (
          <div
            key={s.num}
            className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 p-6 text-center hover:border-bougainvillea/30 transition"
          >
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-bougainvillea/10 border border-bougainvillea/30 mb-3">
              <span className="material-symbols-outlined text-bougainvillea text-3xl">
                {s.icon}
              </span>
            </div>
            <div className="text-xs font-bold text-bougainvillea tracking-widest uppercase mb-2">
              Paso {s.num}
            </div>
            <div className="font-display font-bold text-white text-xl mb-2">
              {s.title}
            </div>
            <div className="text-sm text-white/60">{s.desc}</div>
          </div>
        ))}
      </section>

      <section className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 p-6 sm:p-8">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-white mb-1 text-center">
          Géneros disponibles
        </h2>
        <p className="text-center text-sm text-white/50 mb-6">
          Seis géneros latinos clásicos para empezar
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 sm:gap-4">
          {GENRES.map((g) => (
            <div key={g.slug} className="text-center group cursor-default">
              <div className="text-4xl mb-2 transition group-hover:scale-110">
                {g.emoji}
              </div>
              <div className="text-xs font-bold text-white/80 group-hover:text-bougainvillea transition uppercase tracking-wider">
                {g.labelEs}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProgressSteps({ stage }) {
  const steps = ['record', 'configure', 'polling', 'done'];
  const labels = {
    record: 'Grabar',
    configure: 'Configurar',
    polling: 'Generando',
    done: 'Listo',
  };
  const order = ['record', 'configure', 'uploading', 'submitting', 'polling', 'done'];
  return (
    <ol className="flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold">
      {steps.map((s, i) => {
        const isActive =
          stage === s ||
          (s === 'polling' &&
            (stage === STAGES.UPLOADING || stage === STAGES.SUBMITTING));
        const isPast = order.indexOf(stage) > order.indexOf(s);
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition ${
                isActive
                  ? 'bg-bougainvillea text-white pink-glow'
                  : isPast
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-white/5 text-white/40 border border-white/10'
              }`}
            >
              {isPast ? '✓' : i + 1}
            </span>
            <span
              className={`hidden sm:inline ${
                isActive
                  ? 'text-bougainvillea'
                  : isPast
                  ? 'text-emerald-300'
                  : 'text-white/40'
              }`}
            >
              {labels[s]}
            </span>
            {i < steps.length - 1 && <span className="text-white/10 mx-1">─</span>}
          </li>
        );
      })}
    </ol>
  );
}

function FooterDisclaimer() {
  return (
    <footer className="pt-8 border-t border-white/5 text-xs text-white/40 space-y-2 text-center">
      <p>
        Al grabar tu voz aceptas que la procesemos para crear tu canción
        personalizada. Tu grabación se borra automáticamente después de 30 días.
      </p>
      <p>
        <a
          href="/politica-de-privacidad"
          className="underline hover:text-bougainvillea"
        >
          Política de privacidad
        </a>
        {' · '}
        <a
          href="/terminos-de-servicio"
          className="underline hover:text-bougainvillea"
        >
          Términos
        </a>
      </p>
    </footer>
  );
}
