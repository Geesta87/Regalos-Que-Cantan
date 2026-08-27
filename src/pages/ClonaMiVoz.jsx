// src/pages/ClonaMiVoz.jsx
//
// Page for /clonamivoz — the Clone Mi Voz voice-cloning tier.
//
// Standalone funnel (NOT integrated with the main genre→artist→subgenre…
// funnel by design). The customer flow:
//
//   intro              → marketing hero + how-it-works + genre preview
//   record             → VoiceRecorder + CoachingPanel
//   configure          → genre picker + StoryForm + editable lyrics + email
//   uploading          → POST /upload-customer-voice
//   submitting_preview → POST /generate-cloned-voice-preview
//   generating_preview → poll /cloned-voice-status
//   preview_ready      → audio player + "Comprar canción $69" → Stripe
//   redirecting        → Stripe checkout opens
//   (Stripe round-trip)
//   awaiting_payment   → returned from Stripe with ?paid=1; polling for paid → generating_song
//   generating_song    → poll for full song generation (paid → success)
//   done               → SongResult with 2 audio URLs + "Crear otra"
//   error              → red banner with retry
//
// This page does NOT touch the existing AppContext / formData (Mureka
// funnel state). It runs its own state — the two funnels share no fields.
//
// Stripe is REAL. $69 USD per song. See create-clonamivoz-checkout +
// clonamivoz-stripe-webhook edge functions for the backend.

import React, { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import VoiceRecorder from '../components/clonamivoz/VoiceRecorder';
import CoachingPanel from '../components/clonamivoz/CoachingPanel';
import StoryForm from '../components/clonamivoz/StoryForm';
import SongResult from '../components/clonamivoz/SongResult';
import { GENRES } from '../components/clonamivoz/genres';
import {
  findCustomerVoices,
  uploadCustomerVoice,
  generateClonedVoicePreview,
  setPreviewGenre,
  createClonamivozCheckout,
  bypassClonamivozPayment,
  getClonedVoiceStatus,
  enrollVoice,
} from '../services/clonamivoz';
import { blobToWav } from '../components/clonamivoz/wav';
import { analyzeMelody } from '../components/clonamivoz/melody';

const STAGES = {
  INTRO: 'intro',
  RECORD: 'record',
  // Monotone check (2026-08-27): a flat take produces a monotone clone, so
  // we measure melodic range before enrolling and offer a re-record.
  MELODY_WARNING: 'melody_warning',
  // Suno Voice enrollment (2026-08-08): real voice cloning between the
  // sample recording and the story/configure step. See startEnrollment().
  ENROLL_UPLOADING: 'enroll_uploading',
  ENROLL_PHRASE_WAIT: 'enroll_phrase_wait',
  ENROLL_PHRASE_RECORD: 'enroll_phrase_record',
  ENROLL_CREATING: 'enroll_creating',
  ENROLL_FAILED: 'enroll_failed',
  CONFIGURE: 'configure',
  UPLOADING: 'uploading',
  SUBMITTING_PREVIEW: 'submitting_preview',
  GENERATING_PREVIEW: 'generating_preview',
  PREVIEW_READY: 'preview_ready',
  REDIRECTING: 'redirecting',
  AWAITING_PAYMENT: 'awaiting_payment',
  GENERATING_SONG: 'generating_song',
  DONE: 'done',
  ERROR: 'error',
};

const POLL_INTERVAL_MS = 5000;
const MAX_PREVIEW_POLLS = 72; // 72 × 5s = 6 min ceiling — the preview is now a FULL song render
const MAX_SONG_POLLS = 60;    // 60 × 5s = 5 min ceiling for full song

const PRICE_USD = '$69';

const HOW_IT_WORKS = [
  {
    num: '1',
    icon: 'mic',
    title: 'Graba tu voz',
    desc: 'Tararea o canta por 45-90 segundos. No necesitas saber cantar.',
  },
  {
    num: '2',
    icon: 'graphic_eq',
    title: 'Escucha una prueba',
    desc: 'Escucha gratis los primeros 40 segundos de tu canción real.',
  },
  {
    num: '3',
    icon: 'celebration',
    title: 'Recibe tu canción',
    desc: 'Al comprar, tu canción completa se desbloquea al instante.',
  },
];

// Localstorage key — persists across Stripe redirect round-trip so we
// can recover the in-progress order context when the customer comes back.
const PENDING_ORDER_KEY = 'rqc_clonamivoz_pending';

function loadPendingOrder() {
  try {
    const raw = localStorage.getItem(PENDING_ORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePendingOrder(state) {
  try {
    localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(state));
  } catch {
    /* localStorage may be disabled — non-fatal */
  }
}

function clearPendingOrder() {
  try {
    localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    /* non-fatal */
  }
}

export default function ClonaMiVoz() {
  const [stage, setStage] = useState(STAGES.INTRO);

  // Internal test mode (?test=1): shows the no-payment bypass button. The
  // server-side CLONAMIVOZ_BYPASS_ENABLED secret is the real gate — this
  // only keeps the button out of customers' sight. Read once on mount;
  // the Stripe-return effect strips other params but leaves ?test alone.
  const [isTestMode] = useState(
    () => new URLSearchParams(window.location.search).get('test') === '1'
  );

  // Voice + upload
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [voiceSampleId, setVoiceSampleId] = useState(null);

  // Suno Voice enrollment (real cloning). voiceTaskId is the Kie
  // voice-creation task id — it doubles as the personaId the generation
  // functions use. null → legacy upload-cover engine (saved voices,
  // enrollment failures, old browsers).
  const [voiceTaskId, setVoiceTaskId] = useState(null);
  const [enrollPhrase, setEnrollPhrase] = useState(null);
  const [enrollError, setEnrollError] = useState(null);

  // Generation inputs
  const [genreSlug, setGenreSlug] = useState(GENRES[0].slug);
  // Recording-stage language ('es' or 'en') drives which reading script
  // shows in the VoiceRecorder. Genre is picked later (in CONFIGURE) so
  // this lets the customer choose their reading language up front.
  const [recordingLanguage, setRecordingLanguage] = useState('es');
  const [lyrics, setLyrics] = useState('');
  const [title, setTitle] = useState('');
  const [emotionalModifiers, setEmotionalModifiers] = useState('');
  const [lyricsModelUsed, setLyricsModelUsed] = useState('');
  const [storyContext, setStoryContext] = useState(null);
  const [vocalGender, setVocalGender] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // Generation outputs
  const [clonedVoiceSongId, setClonedVoiceSongId] = useState(null);
  const [previewAudioUrl, setPreviewAudioUrl] = useState(null);
  // Genre A/B (2026-08-27): previews already generated this session, keyed
  // by genre slug — replayable instantly while comparing genres.
  const [previewCache, setPreviewCache] = useState({});
  const [switchError, setSwitchError] = useState(null);
  const [audioUrls, setAudioUrls] = useState([]);
  const [finalTitle, setFinalTitle] = useState('');

  // Status
  const [error, setError] = useState(null);
  const [elapsedPolls, setElapsedPolls] = useState(0);
  const pollAbortRef = useRef(false);

  const selectedGenre = GENRES.find((g) => g.slug === genreSlug) || GENRES[0];

  // ---------------- Handle Stripe redirect return ----------------
  // ?paid=1&song_id=...  → Stripe says payment succeeded; poll for full song
  // ?cancelled=1&song_id → customer bailed; restore preview_ready state
  useEffect(() => {
    const url = new URL(window.location.href);
    const paidFlag = url.searchParams.get('paid');
    const cancelledFlag = url.searchParams.get('cancelled');
    const songIdFromUrl = url.searchParams.get('song_id');

    if (!songIdFromUrl) return;

    // Clean the URL so the flags don't re-trigger on remount.
    url.searchParams.delete('paid');
    url.searchParams.delete('cancelled');
    url.searchParams.delete('song_id');
    url.searchParams.delete('session_id');
    window.history.replaceState({}, '', url.pathname + (url.search ? '?' + url.searchParams.toString() : ''));

    if (paidFlag === '1') {
      // Restore order context from localStorage (so the success page shows
      // the right title etc), then start polling for the full song.
      const pending = loadPendingOrder();
      if (pending) {
        setClonedVoiceSongId(pending.clonedVoiceSongId || songIdFromUrl);
        setTitle(pending.title || '');
        setLyrics(pending.lyrics || '');
        setGenreSlug(pending.genreSlug || GENRES[0].slug);
        setCustomerEmail(pending.customerEmail || '');
        setPreviewAudioUrl(pending.previewAudioUrl || null);
        setStoryContext(pending.storyContext || null);
      } else {
        setClonedVoiceSongId(songIdFromUrl);
      }
      setStage(STAGES.AWAITING_PAYMENT);
      pollUntilDone(songIdFromUrl, /*expectingPayment=*/ true);
    } else if (cancelledFlag === '1') {
      // Customer cancelled at Stripe — restore preview_ready so they
      // can hear the preview again and try again if they want.
      const pending = loadPendingOrder();
      if (pending && pending.previewAudioUrl) {
        setClonedVoiceSongId(pending.clonedVoiceSongId || songIdFromUrl);
        setTitle(pending.title || '');
        setLyrics(pending.lyrics || '');
        setGenreSlug(pending.genreSlug || GENRES[0].slug);
        setCustomerEmail(pending.customerEmail || '');
        setPreviewAudioUrl(pending.previewAudioUrl);
        setStoryContext(pending.storyContext || null);
        setStage(STAGES.PREVIEW_READY);
      }
    }
    // We intentionally only run this on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abort any in-flight polling when component unmounts.
  useEffect(() => {
    return () => {
      pollAbortRef.current = true;
    };
  }, []);

  // Melodic-range verdict for the last main recording (null = not analyzed).
  const [melodyInfo, setMelodyInfo] = useState(null);
  // Gender inferred from the recording's median pitch ('m'|'f'|null). Used
  // as the Suno hint whenever the customer leaves "Detección automática".
  const [autoGender, setAutoGender] = useState(null);

  // What we actually send to Suno: an explicit choice always wins; the
  // pitch-derived inference fills in when the customer left it on auto.
  const effectiveVocalGender = vocalGender || autoGender || '';

  async function handleRecordingComplete(blob, durationMs) {
    setAudioBlob(blob);
    setAudioDurationMs(durationMs);

    // Monotone gate: measure melodic range BEFORE spending enrollment/Kie
    // quota. Fail-open — any analysis problem proceeds as normal.
    try {
      const verdict = await analyzeMelody(blob);
      if (verdict.ok && verdict.inferredGender) {
        setAutoGender(verdict.inferredGender);
      }
      if (verdict.ok && verdict.monotone) {
        setMelodyInfo(verdict);
        setStage(STAGES.MELODY_WARNING);
        return;
      }
    } catch {
      /* fail-open */
    }
    setMelodyInfo(null);
    startEnrollment(blob, durationMs);
  }

  /** Customer chose to keep the flat take anyway. */
  function continueDespiteMonotone() {
    setMelodyInfo(null);
    startEnrollment(audioBlob, audioDurationMs);
  }

  // -------------------------------------------------------------------
  // Suno Voice enrollment (2026-08-08) — real voice cloning.
  //
  // Sequence: WAV-encode the sample → upload → Kie voice/validate →
  // poll for the verification phrase → customer SINGS the phrase (second
  // short recording) → Kie voice/generate → poll until the voice is
  // ready → voiceTaskId set → CONFIGURE. The phrase expires ~10-15 min
  // after 'start', so this whole block runs as one uninterrupted screen
  // sequence. Any failure lands on ENROLL_FAILED, which offers a retry
  // (new phrase) or continuing with the legacy engine — the page can
  // never dead-end.
  // -------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function startEnrollment(blob, durationMs) {
    setEnrollError(null);
    setEnrollPhrase(null);
    setVoiceTaskId(null);
    pollAbortRef.current = false;
    setStage(STAGES.ENROLL_UPLOADING);

    const wav = await blobToWav(blob);
    if (!wav.type.includes('wav')) {
      // Old browser couldn't re-encode; Kie would silently discard the
      // original WebM. Skip enrollment, keep the legacy engine.
      setStage(STAGES.CONFIGURE);
      return;
    }
    const up = await uploadCustomerVoice(wav, {
      customerEmail: customerEmail || undefined,
      durationSeconds: durationMs / 1000,
    });
    if (!up.ok) {
      setEnrollError(`No pudimos subir tu grabación: ${up.message || up.error}`);
      setStage(STAGES.ENROLL_FAILED);
      return;
    }
    setVoiceSampleId(up.voice_sample_id);
    setAudioBlob(null); // uploaded — submit() must not re-upload

    await beginPhraseFlow(up.voice_sample_id);
  }

  /**
   * Kick off (or restart) validate → phrase polling for a sample.
   *
   * Self-healing: if Kie stays silent for ~45s (its task can silently
   * evaporate when its first audio fetch fails — see the enroll fn), we
   * automatically re-'start' once, which the backend maps to a FRESH
   * storage path + fresh task. Only after the second silent run do we
   * surface the failure screen.
   */
  async function beginPhraseFlow(sampleId) {
    setEnrollError(null);
    setEnrollPhrase(null);

    for (let attempt = 0; attempt < 2; attempt++) {
      if (pollAbortRef.current) return;
      const st = await enrollVoice('start', { voiceSampleId: sampleId, language: recordingLanguage });
      if (!st.ok) {
        setEnrollError(st.message || 'No pudimos iniciar la clonación de tu voz.');
        setStage(STAGES.ENROLL_FAILED);
        return;
      }
      setStage(STAGES.ENROLL_PHRASE_WAIT);

      // ~45s of polling per attempt (15 × 3s).
      for (let i = 0; i < 15; i++) {
        if (pollAbortRef.current) return;
        await sleep(3000);
        const ph = await enrollVoice('phrase', { voiceSampleId: sampleId });
        if (ph.ok && ph.status === 'phrase_ready' && ph.phrase) {
          setEnrollPhrase(ph.phrase);
          setStage(STAGES.ENROLL_PHRASE_RECORD);
          return;
        }
        if (ph.ok && ph.status === 'failed') {
          setEnrollError(ph.message || 'No pudimos analizar tu grabación.');
          setStage(STAGES.ENROLL_FAILED);
          return;
        }
      }
      // Silent timeout — loop restarts with a fresh Kie task on a fresh path.
    }

    setEnrollError('La preparación de tu voz tardó demasiado.');
    setStage(STAGES.ENROLL_FAILED);
  }

  /** Customer finished singing the verification phrase. */
  async function handlePhraseRecorded(blob, durationMs) {
    setStage(STAGES.ENROLL_CREATING);
    const wav = await blobToWav(blob);
    const up = await uploadCustomerVoice(wav, {
      customerEmail: customerEmail || undefined,
      durationSeconds: durationMs / 1000,
    });
    if (!up.ok) {
      setEnrollError(`No pudimos subir la verificación: ${up.message || up.error}`);
      setStage(STAGES.ENROLL_FAILED);
      return;
    }
    const v = await enrollVoice('verify', { voiceSampleId, verifySampleId: up.voice_sample_id });
    if (!v.ok || v.status === 'failed') {
      setEnrollError(v.message || 'La verificación no fue aceptada. Intenta de nuevo.');
      setStage(STAGES.ENROLL_FAILED);
      return;
    }
    for (let i = 0; i < 36; i++) {
      if (pollAbortRef.current) return;
      await sleep(5000);
      const st = await enrollVoice('status', { voiceSampleId });
      if (st.ok && st.status === 'ready' && st.voice_task_id) {
        setVoiceTaskId(st.voice_task_id);
        setStage(STAGES.CONFIGURE);
        return;
      }
      if (st.ok && st.status === 'failed') {
        setEnrollError(st.message || 'No se pudo crear tu voz.');
        setStage(STAGES.ENROLL_FAILED);
        return;
      }
    }
    setEnrollError('La creación de tu voz tardó demasiado.');
    setStage(STAGES.ENROLL_FAILED);
  }

  /**
   * Called by SavedVoicePicker when the customer picks a previously
   * saved voice sample by email. Skips the upload step entirely —
   * submit() detects audioBlob is null and uses voiceSampleId directly.
   */
  function handlePickSavedVoice({ voiceSampleId: pickedId, durationSeconds, email }) {
    setAudioBlob(null);
    setVoiceSampleId(pickedId);
    setAudioDurationMs((durationSeconds || 0) * 1000);
    if (email) setCustomerEmail(email);
    setStage(STAGES.CONFIGURE);
  }

  // -------------------------------------------------------------------
  // Step A — Generate preview (the cheap voice match — FREE, no email)
  // -------------------------------------------------------------------
  async function submit() {
    // Need EITHER a fresh recording OR a previously-saved voice sample.
    if (!audioBlob && !voiceSampleId) {
      setError('Graba tu voz primero (o selecciona una grabación anterior).');
      setStage(STAGES.ERROR);
      return;
    }
    if (!lyrics.trim()) {
      setError('Agrega o genera la letra de la canción.');
      setStage(STAGES.ERROR);
      return;
    }
    // Email is NOT required here — only at the Stripe step. The preview
    // is free, so we let anyone try it without committing an email.

    setError(null);
    pollAbortRef.current = false;

    // 1. Upload voice (only if it's a fresh recording — skip when re-using
    //    a previously-saved voice_sample_id).
    let activeVoiceSampleId = voiceSampleId;
    if (audioBlob) {
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
      activeVoiceSampleId = uploadRes.voice_sample_id;
      setVoiceSampleId(activeVoiceSampleId);
    }

    // 2. Submit preview Suno job (uses the freshly uploaded sample OR
    //    a previously-saved one selected via "ya grabé antes").
    setStage(STAGES.SUBMITTING_PREVIEW);
    const previewRes = await generateClonedVoicePreview({
      clonedVoiceSongId: clonedVoiceSongId || undefined, // retry path
      voiceSampleId: activeVoiceSampleId,
      lyrics: lyrics.trim(),
      title: title || `cancion-${Date.now()}`,
      genreSlug,
      recipientName: storyContext?.recipientName,
      relationship: storyContext?.relationship,
      occasion: storyContext?.occasion,
      story: storyContext?.story,
      customerEmail: customerEmail || undefined,
      vocalGender: effectiveVocalGender,
      emotionalModifiers,
      lyricsModelUsed,
      language: storyContext?.language || 'es',
      // Real cloned voice when enrollment succeeded; null → legacy engine.
      voiceTaskId: voiceTaskId || undefined,
    });
    if (!previewRes.ok) {
      setError(`No pudimos crear la prueba: ${previewRes.message || previewRes.error}`);
      setStage(STAGES.ERROR);
      return;
    }
    setClonedVoiceSongId(previewRes.cloned_voice_song_id);

    // Persist pending order to survive Stripe round-trip later.
    savePendingOrder({
      clonedVoiceSongId: previewRes.cloned_voice_song_id,
      title,
      lyrics,
      genreSlug,
      customerEmail,
      storyContext,
    });

    // 3. Poll until preview is ready (or full song success in case
    // they come back to an already-paid order)
    setStage(STAGES.GENERATING_PREVIEW);
    pollUntilDone(previewRes.cloned_voice_song_id, /*expectingPayment=*/ false);
  }

  // -------------------------------------------------------------------
  // Step B — Pay $69 and go to Stripe
  // -------------------------------------------------------------------
  async function payNow() {
    if (!clonedVoiceSongId) {
      setError('Algo se perdió. Vuelve a empezar.');
      setStage(STAGES.ERROR);
      return;
    }
    if (!customerEmail || !customerEmail.includes('@')) {
      setError('Necesitamos tu email para procesar el pago.');
      setStage(STAGES.ERROR);
      return;
    }
    setError(null);
    setStage(STAGES.REDIRECTING);

    // Re-save in case anything changed since preview started.
    savePendingOrder({
      clonedVoiceSongId,
      title,
      lyrics,
      genreSlug,
      customerEmail,
      previewAudioUrl,
      storyContext,
    });

    const res = await createClonamivozCheckout({
      clonedVoiceSongId,
      email: customerEmail,
    });
    if (!res.ok || !res.checkout_url) {
      setError(`No pudimos iniciar el pago: ${res.message || res.error}`);
      setStage(STAGES.PREVIEW_READY);
      return;
    }
    // Redirect to Stripe — page unloads, we resume via ?paid=1 on return.
    window.location.href = res.checkout_url;
  }

  /**
   * TESTING-MODE bypass — skip Stripe entirely and fire the full song
   * generation directly. Only works while the Supabase secret
   * CLONAMIVOZ_BYPASS_ENABLED='true'. The frontend always exposes the
   * button; the server-side env var is what actually gates access.
   *
   * Mirrors the post-Stripe path: marks the row paid, kicks off
   * generate-cloned-voice-song, then polls for completion just like a
   * real paid order would.
   */
  async function bypassPayNow() {
    if (!clonedVoiceSongId) {
      setError('Algo se perdió. Vuelve a empezar.');
      setStage(STAGES.ERROR);
      return;
    }
    if (!customerEmail || !customerEmail.includes('@')) {
      setError('Necesitamos tu email para enviar la canción.');
      setStage(STAGES.ERROR);
      return;
    }
    setError(null);
    setStage(STAGES.AWAITING_PAYMENT);

    const res = await bypassClonamivozPayment({
      clonedVoiceSongId,
      email: customerEmail,
    });
    if (!res.ok) {
      setError(
        res.error === 'bypass_disabled'
          ? 'El modo prueba está desactivado. Usa el botón de pago de Stripe.'
          : `No pudimos saltar el pago: ${res.message || res.error}`
      );
      setStage(STAGES.PREVIEW_READY);
      return;
    }
    // Row is now paid + generation kicked off. Poll just like a real
    // paid order would.
    setStage(STAGES.GENERATING_SONG);
    pollUntilDone(clonedVoiceSongId, true);
  }

  // -------------------------------------------------------------------
  // Genre A/B on the preview screen (2026-08-27, owner request): compare
  // how the same cloned voice sounds across genres before paying.
  // Cached genres replay instantly (a set-genre call keeps the row's
  // genre honest for the paid song); new genres re-render the preview.
  // -------------------------------------------------------------------
  async function switchPreviewGenre(slug) {
    if (slug === genreSlug || stage !== STAGES.PREVIEW_READY) return;
    setSwitchError(null);
    const prevSlug = genreSlug;
    setGenreSlug(slug);

    if (previewCache[slug]) {
      // Already rendered this session — flip the row's genre (no Kie call)
      // and replay that genre's teaser. The server also flips the row's
      // audio columns to this genre's full render (pre-pay model), and
      // returns the authoritative teaser URL.
      const res = await setPreviewGenre({ clonedVoiceSongId, genreSlug: slug });
      if (!res.ok) {
        setGenreSlug(prevSlug);
        setSwitchError(res.message || 'No pudimos cambiar el género. Intenta otra vez.');
        return;
      }
      setPreviewAudioUrl(res.preview_audio_url || previewCache[slug]);
      savePendingOrder({
        clonedVoiceSongId, title, lyrics, genreSlug: slug,
        customerEmail, previewAudioUrl: previewCache[slug], storyContext,
      });
      return;
    }

    if (!voiceSampleId) {
      // Session lost the voice reference (e.g. Stripe round-trip reload) —
      // can't submit a new render without it.
      setGenreSlug(prevSlug);
      setSwitchError('Para probar un género nuevo, vuelve a empezar el proceso.');
      return;
    }

    // New genre — re-render the preview on the SAME order row.
    setStage(STAGES.SUBMITTING_PREVIEW);
    const res = await generateClonedVoicePreview({
      clonedVoiceSongId,
      voiceSampleId,
      lyrics: lyrics.trim(),
      title: title || `cancion-${Date.now()}`,
      genreSlug: slug,
      recipientName: storyContext?.recipientName,
      relationship: storyContext?.relationship,
      occasion: storyContext?.occasion,
      story: storyContext?.story,
      customerEmail: customerEmail || undefined,
      vocalGender: effectiveVocalGender,
      emotionalModifiers,
      lyricsModelUsed,
      language: storyContext?.language || 'es',
      voiceTaskId: voiceTaskId || undefined,
    });
    if (!res.ok) {
      setGenreSlug(prevSlug);
      setSwitchError(
        res.error === 'preview_limit_reached'
          ? (res.message || 'Alcanzaste el límite de pruebas por hoy.')
          : `No pudimos crear la prueba: ${res.message || res.error}`
      );
      setStage(STAGES.PREVIEW_READY);
      return;
    }
    setStage(STAGES.GENERATING_PREVIEW);
    pollUntilDone(clonedVoiceSongId, false, slug);
  }

  // -------------------------------------------------------------------
  // Polling loop — handles both preview and full-song paths
  // -------------------------------------------------------------------
  async function pollUntilDone(songId, expectingPayment, genreForCache = genreSlug) {
    pollAbortRef.current = false;
    let polls = 0;
    const maxPolls = expectingPayment ? MAX_SONG_POLLS : MAX_PREVIEW_POLLS;
    while (polls < maxPolls) {
      if (pollAbortRef.current) return;
      polls += 1;
      setElapsedPolls(polls);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (pollAbortRef.current) return;

      const statusRes = await getClonedVoiceStatus(songId);
      if (!statusRes.ok) {
        // Transient network issue — keep trying.
        continue;
      }

      // PREVIEW path — preview is ready, show the audio player + pay button
      if (statusRes.status === 'preview_ready') {
        setPreviewAudioUrl(statusRes.preview_audio_url || null);
        // Remember which genre this render belongs to (genre A/B replay).
        if (statusRes.preview_audio_url) {
          setPreviewCache((p) => ({ ...p, [genreForCache]: statusRes.preview_audio_url }));
        }
        setFinalTitle(statusRes.title || title);
        // Update saved pending so cancel-and-return knows the preview URL.
        // genreForCache, not the genreSlug closure — a genre-A/B render
        // starts polling in the same tick as setGenreSlug, so the state
        // value here can still be the previous genre.
        savePendingOrder({
          clonedVoiceSongId: songId,
          title,
          lyrics,
          genreSlug: genreForCache,
          customerEmail,
          previewAudioUrl: statusRes.preview_audio_url || null,
          storyContext,
        });
        setStage(STAGES.PREVIEW_READY);
        return;
      }

      // After Stripe success, the webhook flips status to 'paid' and
      // kicks off the full song. We keep polling until generating_song
      // → success.
      if (statusRes.status === 'paid') {
        // Webhook received, full song queued — keep polling
        setStage(STAGES.GENERATING_SONG);
        continue;
      }
      if (statusRes.status === 'generating_song') {
        setStage(STAGES.GENERATING_SONG);
        continue;
      }

      if (statusRes.status === 'success') {
        setAudioUrls(statusRes.audio_urls || []);
        setFinalTitle(statusRes.title || title);
        setStage(STAGES.DONE);
        clearPendingOrder();
        return;
      }

      if (statusRes.status === 'failed') {
        setError(
          statusRes.error_message ||
            'La generación falló. Si tu pago se procesó, contacta a soporte.'
        );
        setStage(STAGES.ERROR);
        return;
      }
      // Other states (generating_preview, awaiting_payment) — keep polling.
    }
    setError(
      expectingPayment
        ? `Se acabó el tiempo esperando tu canción. Si pagaste, contacta soporte con este código: ${songId}`
        : `Se acabó el tiempo creando la prueba. Intenta otra vez.`
    );
    setStage(STAGES.ERROR);
  }

  function resetAll() {
    pollAbortRef.current = true;
    setStage(STAGES.INTRO);
    setAudioBlob(null);
    setAudioDurationMs(0);
    setVoiceSampleId(null);
    setLyrics('');
    setTitle('');
    setEmotionalModifiers('');
    setLyricsModelUsed('');
    setStoryContext(null);
    setVocalGender('');
    setClonedVoiceSongId(null);
    setPreviewAudioUrl(null);
    setPreviewCache({});
    setSwitchError(null);
    setMelodyInfo(null);
    setAutoGender(null);
    setAudioUrls([]);
    setFinalTitle('');
    setError(null);
    setElapsedPolls(0);
    clearPendingOrder();
  }

  // =============================== Render =================================

  const configureStages = new Set([
    STAGES.CONFIGURE,
    STAGES.UPLOADING,
    STAGES.SUBMITTING_PREVIEW,
  ]);
  const showConfigureSection = configureStages.has(stage);

  return (
    <div className="min-h-screen bg-landing-bg text-white font-body">
      <Helmet>
        <title>Clona Mi Voz · RegalosQueCantan</title>
        <meta
          name="description"
          content="Graba tu voz y recibe una canción personalizada cantada por ti. Romántico, balada, banda, corrido, ranchera, mariachi, cumbia, norteño, bolero o cristiana."
        />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-10">
        <PageHeader />

        {stage === STAGES.INTRO && <IntroSection onStart={() => setStage(STAGES.RECORD)} />}

        {stage !== STAGES.INTRO && <ProgressSteps stage={stage} />}

        {stage === STAGES.RECORD && (
          <section className="space-y-4">
            <div className="text-center">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mb-2">
                {recordingLanguage === 'en' ? 'Record your voice' : 'Graba tu voz'}
              </h2>
              <p className="text-white/60">
                {recordingLanguage === 'en'
                  ? 'Hum or sing for 45-90 seconds in a quiet place.'
                  : 'Tararea o canta por 45-90 segundos en un lugar tranquilo.'}
              </p>
            </div>

            {/* Recording language toggle. Spanish/English determines which
                reading script + UI copy the recorder shows. Genre is picked
                later in CONFIGURE. */}
            <div className="flex items-center justify-center gap-2 text-sm">
              <span className="text-white/50">
                {recordingLanguage === 'en' ? 'Reading language:' : 'Idioma de lectura:'}
              </span>
              <div className="inline-flex rounded-full bg-white/5 border border-white/10 p-0.5">
                <button
                  type="button"
                  onClick={() => setRecordingLanguage('es')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                    recordingLanguage === 'es'
                      ? 'bg-bougainvillea text-white'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  Español
                </button>
                <button
                  type="button"
                  onClick={() => setRecordingLanguage('en')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                    recordingLanguage === 'en'
                      ? 'bg-bougainvillea text-white'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  English
                </button>
              </div>
            </div>

            {/* Returning customer: skip recording by entering email */}
            <SavedVoicePicker onPick={handlePickSavedVoice} />
            <VoiceRecorder
              onRecordingComplete={handleRecordingComplete}
              language={recordingLanguage}
            />
            <CoachingPanel />
          </section>
        )}

        {/* ---- Monotone warning (flat take = monotone clone) ---- */}
        {stage === STAGES.MELODY_WARNING && (
          <section className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-amber-400/40 p-8 sm:p-10 text-center space-y-5 animate-fadeIn">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/30">
              <span className="material-symbols-outlined text-amber-300 text-4xl">graphic_eq</span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
              {recordingLanguage === 'en'
                ? 'Your recording sounds a bit flat'
                : 'Tu grabación suena un poco plana'}
            </h2>
            <p className="text-white/70 max-w-md mx-auto">
              {recordingLanguage === 'en'
                ? 'Your cloned voice copies the melody of this recording — a flat take makes every song sound monotone. Try again and EXAGGERATE: go high, go low, like singing in the shower. Off-key is totally fine.'
                : 'Tu voz clonada copia la melodía de esta grabación — una toma plana hace que todas las canciones suenen monótonas. Intenta de nuevo y EXAGERA: sube alto, baja bajo, como cantando en la regadera. Desafinar no importa.'}
            </p>
            {melodyInfo?.rangeSemitones != null && (
              <p className="text-xs text-white/40">
                {recordingLanguage === 'en'
                  ? `Detected melodic range: ~${melodyInfo.rangeSemitones} semitones — singing usually spans 5 or more.`
                  : `Rango de melodía detectado: ~${melodyInfo.rangeSemitones} semitonos — cantar suele pasar de 5.`}
              </p>
            )}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setStage(STAGES.RECORD)}
                className="rounded-2xl bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold px-8 py-3.5 pink-glow transition active:scale-95 flex items-center gap-2"
              >
                <span className="material-symbols-outlined">mic</span>
                {recordingLanguage === 'en' ? 'Record again with more melody' : 'Volver a grabar con más melodía'}
              </button>
              <button
                type="button"
                onClick={continueDespiteMonotone}
                className="text-sm text-white/50 hover:text-white/80 underline"
              >
                {recordingLanguage === 'en' ? 'Continue anyway' : 'Continuar así de todos modos'}
              </button>
            </div>
          </section>
        )}

        {/* ---- Suno Voice enrollment stages (real cloning) ---- */}
        {(stage === STAGES.ENROLL_UPLOADING || stage === STAGES.ENROLL_PHRASE_WAIT) && (
          <section className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-8 sm:p-12 text-center space-y-4 animate-fadeIn">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-bougainvillea/20 border border-bougainvillea/30 animate-bounce-slow mb-2">
              <span className="material-symbols-outlined text-bougainvillea text-5xl">
                fingerprint
              </span>
            </div>
            <h2 className="font-display text-3xl font-bold text-white">
              Preparando tu voz…
            </h2>
            <p className="text-white/60">
              Estamos analizando tu grabación para clonar tu voz. Toma menos de un
              minuto. <strong className="text-white/80">No cierres esta página.</strong>
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-white/50">
              <span className="w-2 h-2 rounded-full bg-bougainvillea animate-pulse" />
              <span>
                {stage === STAGES.ENROLL_UPLOADING ? 'Subiendo tu grabación…' : 'Generando tu frase de verificación…'}
              </span>
            </div>
          </section>
        )}

        {stage === STAGES.ENROLL_PHRASE_RECORD && (
          <section className="space-y-4 animate-fadeIn">
            <div className="text-center">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mb-2">
                Último paso: canta esta frase
              </h2>
              <p className="text-white/60">
                Así confirmamos que la voz es tuya. Cántala{' '}
                <strong className="text-white/85">2-3 veces seguidas, despacio y claro</strong>{' '}
                (unos 15-25 segundos), con cualquier melodía.
              </p>
            </div>
            <div className="rounded-2xl bg-bougainvillea/10 border-2 border-bougainvillea/40 p-6 text-center">
              <div className="text-xs uppercase tracking-widest text-bougainvillea/80 font-semibold mb-2">
                Tu frase de verificación
              </div>
              <div className="font-display text-2xl sm:text-3xl font-bold text-white leading-snug">
                “{enrollPhrase}”
              </div>
              <div className="mt-3 text-xs text-amber-200 bg-amber-500/10 border-l-4 border-amber-500 px-3 py-2 rounded inline-block">
                ⏱ La frase caduca en unos minutos — grábala ahora mismo.
              </div>
            </div>
            <VoiceRecorder
              onRecordingComplete={handlePhraseRecorded}
              language={recordingLanguage}
              maxDurationMs={35_000}
              minDurationSec={8}
              showScript={false}
            />
          </section>
        )}

        {stage === STAGES.ENROLL_CREATING && (
          <section className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-8 sm:p-12 text-center space-y-4 animate-fadeIn">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-bougainvillea/20 border border-bougainvillea/30 animate-bounce-slow mb-2">
              <span className="material-symbols-outlined text-bougainvillea text-5xl">
                record_voice_over
              </span>
            </div>
            <h2 className="font-display text-3xl font-bold text-white">
              Creando tu voz…
            </h2>
            <p className="text-white/60">
              Verificando tu frase y clonando tu voz. Suele tomar 1-2 minutos.{' '}
              <strong className="text-white/80">No cierres esta página.</strong>
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-white/50">
              <span className="w-2 h-2 rounded-full bg-bougainvillea animate-pulse" />
              <span>Clonando…</span>
            </div>
          </section>
        )}

        {stage === STAGES.ENROLL_FAILED && (
          <section className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-8 sm:p-10 text-center space-y-5 animate-fadeIn">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/30">
              <span className="material-symbols-outlined text-amber-300 text-4xl">warning</span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
              No pudimos clonar tu voz esta vez
            </h2>
            {enrollError && <p className="text-white/60 text-sm">{enrollError}</p>}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              {voiceSampleId && (
                <button
                  type="button"
                  onClick={() => beginPhraseFlow(voiceSampleId)}
                  className="px-6 py-3 rounded-full bg-gradient-to-br from-bougainvillea to-[#d40b6e] text-white font-bold pink-glow active:scale-95 transition"
                >
                  Intentar de nuevo
                </button>
              )}
              <button
                type="button"
                onClick={() => { setVoiceTaskId(null); setStage(STAGES.CONFIGURE); }}
                className="px-6 py-3 rounded-full bg-white/10 border border-white/15 text-white/80 font-semibold active:scale-95 transition"
              >
                Continuar sin clonación avanzada
              </button>
            </div>
            <p className="text-xs text-white/40">
              “Continuar” usa nuestro método clásico — tu canción igual se crea con tu grabación.
            </p>
          </section>
        )}

        {showConfigureSection && (
          <section className="space-y-6">
            {/* Re-record bar */}
            <div className="flex items-center justify-between rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-3 pl-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-emerald-400">check_circle</span>
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
                      <div className={`text-xs mt-1 ${selected ? 'text-white/90' : 'text-white/50'}`}>
                        {g.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Story → lyrics. defaultLanguage flows from the recording
                stage so the user doesn't have to pick language twice;
                they can still override here. */}
            <StoryForm
              genreSlug={selectedGenre.slug}
              defaultLanguage={recordingLanguage}
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
                <code className="text-xs bg-white/10 text-bougainvillea px-1.5 py-0.5 rounded">[Verse]</code>,{' '}
                <code className="text-xs bg-white/10 text-bougainvillea px-1.5 py-0.5 rounded">[Chorus]</code>,{' '}
                <code className="text-xs bg-white/10 text-bougainvillea px-1.5 py-0.5 rounded">[Bridge]</code>{' '}
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
              <div className="text-xs text-white/40 mt-1 text-right">{lyrics.length} / 5000</div>
            </div>

            {/* Email — OPTIONAL here. Only required at the Stripe payment
                step (or if reusing a saved voice). Letting them skip it
                lowers friction for the free preview. */}
            <div>
              <label htmlFor="cv-email" className="block text-sm font-semibold text-white/80 mb-1">
                Tu email{' '}
                <span className="text-white/40 font-normal">
                  (opcional — te lo pediremos cuando vayas a pagar)
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

            {/* Advanced */}
            <details className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-white/80 flex items-center gap-2">
                <span className="material-symbols-outlined text-bougainvillea text-base">tune</span>
                Opciones avanzadas
              </summary>
              <div className="mt-4 space-y-3 animate-fadeIn">
                <div>
                  <label htmlFor="cv-title" className="block text-sm font-semibold text-white/80 mb-1">
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
                  <label htmlFor="cv-vocal-gender" className="block text-sm font-semibold text-white/80 mb-1">
                    Género vocal <span className="text-white/40 font-normal">(opcional)</span>
                  </label>
                  <select
                    id="cv-vocal-gender"
                    value={vocalGender}
                    onChange={(e) => setVocalGender(e.target.value)}
                    className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white"
                  >
                    <option value="">
                      {autoGender === 'm'
                        ? 'Detección automática (voz masculina detectada)'
                        : autoGender === 'f'
                        ? 'Detección automática (voz femenina detectada)'
                        : 'Detección automática'}
                    </option>
                    <option value="m">Masculino</option>
                    <option value="f">Femenino</option>
                  </select>
                </div>
              </div>
            </details>

            {/* Submit — now triggers PREVIEW (free), not full song */}
            <div className="pt-2">
              <button
                type="button"
                onClick={submit}
                disabled={stage === STAGES.UPLOADING || stage === STAGES.SUBMITTING_PREVIEW}
                className="w-full rounded-2xl bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold text-lg py-4 pink-glow transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">play_circle</span>
                {stage === STAGES.UPLOADING && 'Subiendo tu grabación…'}
                {stage === STAGES.SUBMITTING_PREVIEW && 'Iniciando prueba…'}
                {stage !== STAGES.UPLOADING && stage !== STAGES.SUBMITTING_PREVIEW &&
                  'Escuchar una prueba con mi voz (gratis)'}
              </button>
              <p className="text-xs text-white/40 mt-2 text-center">
                Escuchas el comienzo de tu canción real antes de pagar · Tarda 2-4 minutos
              </p>
            </div>
          </section>
        )}

        {/* Preview generating */}
        {stage === STAGES.GENERATING_PREVIEW && (
          <PollingPanel
            title="Creando tu prueba…"
            subtitle="Estamos creando tu canción completa con tu voz. Tarda 2-4 minutos."
            elapsedSec={elapsedPolls * (POLL_INTERVAL_MS / 1000)}
            songId={clonedVoiceSongId}
            note="No cierres esta página. Guarda este código por si acaso."
          />
        )}

        {/* Preview ready — show audio, then ASK FOR PAYMENT */}
        {stage === STAGES.PREVIEW_READY && (
          <section className="space-y-5 animate-fadeIn">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 mb-3">
                <span className="material-symbols-outlined text-emerald-400 text-5xl">
                  graphic_eq
                </span>
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mb-1">
                ¡Esta es tu voz!
              </h2>
              <p className="text-white/70">
                Estás escuchando el comienzo de tu canción REAL. ¿Te gusta cómo suena?
              </p>
            </div>

            <div className="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-5 space-y-3">
              <div className="font-display text-xl font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-bougainvillea">music_note</span>
                El comienzo de tu canción
              </div>
              {previewAudioUrl ? (
                <audio controls src={previewAudioUrl} className="w-full" autoPlay />
              ) : (
                <div className="text-sm text-amber-300">
                  No pudimos cargar la prueba. Intenta volver a crear.
                </div>
              )}
              <p className="text-xs text-white/40">
                Estos son los primeros 40 segundos de tu canción REAL — exactamente lo que
                recibirás. Al comprar se desbloquea completa (2-3 min), con dos versiones y
                descarga permanente.
              </p>
            </div>

            {/* Genre A/B — hear the same voice in other genres before paying */}
            <div className="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-4 sm:p-5 space-y-3">
              <div className="text-sm font-semibold text-white/85 flex items-center gap-2">
                <span className="material-symbols-outlined text-bougainvillea text-base">tune</span>
                ¿Con cuál género suena mejor tu voz?
              </div>
              <p className="text-xs text-white/50">
                Toca un género para escuchar tu voz en ese estilo. Los marcados con ✓ ya están
                listos y suenan al instante; uno nuevo tarda 2-4 minutos. La canción completa se
                hará con el género que dejes seleccionado.
              </p>
              <div className="flex flex-wrap gap-2">
                {GENRES.map((g) => {
                  const active = g.slug === genreSlug;
                  const cached = !!previewCache[g.slug];
                  return (
                    <button
                      key={g.slug}
                      type="button"
                      onClick={() => switchPreviewGenre(g.slug)}
                      disabled={active}
                      className={`rounded-full px-3.5 py-2 text-sm font-semibold transition active:scale-95 flex items-center gap-1.5 ${
                        active
                          ? 'bg-gradient-to-br from-bougainvillea to-[#d40b6e] text-white border border-bougainvillea cursor-default'
                          : 'bg-white/5 border border-white/15 text-white/80 hover:border-bougainvillea/50 hover:text-white'
                      }`}
                    >
                      <span>{g.emoji}</span>
                      <span>{g.labelEs}</span>
                      {!active && cached && <span className="text-emerald-300 text-xs">✓</span>}
                      {!active && !cached && (
                        <span className="material-symbols-outlined text-white/40 text-sm">schedule</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {switchError && (
                <div className="text-xs text-amber-300 flex items-start gap-1.5">
                  <span className="material-symbols-outlined text-sm">warning</span>
                  <span>{switchError}</span>
                </div>
              )}
            </div>

            {/* CTA — Pay $69. Email is required HERE (Stripe needs it). */}
            <div className="rounded-3xl bg-gradient-to-br from-bougainvillea/10 to-[#d40b6e]/10 border border-bougainvillea/30 p-6 sm:p-8 space-y-4">
              <div className="text-center space-y-2">
                <div className="font-display text-4xl sm:text-5xl font-bold text-white">
                  {PRICE_USD} <span className="text-lg text-white/60 font-body font-normal">USD</span>
                </div>
                <div className="text-sm text-white/70">
                  Canción completa cantada en tu voz · 2 versiones · descarga permanente
                </div>
              </div>

              {/* Email required for payment */}
              <div>
                <label htmlFor="cv-pay-email" className="block text-sm font-semibold text-white/80 mb-1">
                  Tu email <span className="text-bougainvillea">*</span>
                  <span className="text-white/40 font-normal ml-1">
                    (para tu canción y recibo)
                  </span>
                </label>
                <input
                  id="cv-pay-email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  maxLength={200}
                  placeholder="tu@email.com"
                  required
                  className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-3 text-sm text-white placeholder-white/30"
                />
              </div>

              {/* PRIMARY CTA — real Stripe payment. Until 2026-08-27 the
                  hierarchy was inverted: the free test-bypass was the big
                  button and Stripe was a footnote link, so the page could
                  never take a real customer. */}
              <button
                type="button"
                onClick={payNow}
                disabled={!customerEmail || !customerEmail.includes('@')}
                className="w-full rounded-2xl bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold text-lg py-4 pink-glow transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">lock</span>
                Comprar mi canción · {PRICE_USD}
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
              <p className="text-xs text-white/40 text-center">
                Pago seguro con Stripe · Tu canción completa se desbloquea AL INSTANTE
              </p>

              {/* TEST MODE — only visible with ?test=1 in the URL. The
                  server still gates the endpoint via the
                  CLONAMIVOZ_BYPASS_ENABLED secret; this flag only hides
                  the button from customers. */}
              {isTestMode && (
                <>
                  <div className="rounded-xl bg-amber-500/10 border border-amber-400/40 px-3 py-2 text-xs text-amber-200 text-center">
                    🧪 Modo prueba interno: generar sin pagar (requiere
                    CLONAMIVOZ_BYPASS_ENABLED en el servidor).
                  </div>
                  <button
                    type="button"
                    onClick={bypassPayNow}
                    disabled={!customerEmail || !customerEmail.includes('@')}
                    className="w-full rounded-2xl bg-white/10 border border-amber-400/40 hover:bg-white/15 text-amber-200 font-bold py-3 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined">science</span>
                    Generar canción completa (gratis – modo prueba)
                  </button>
                </>
              )}
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setStage(STAGES.CONFIGURE)}
                className="text-sm text-white/40 hover:text-bougainvillea underline"
              >
                Cambiar género o letra y volver a crear la prueba
              </button>
            </div>
          </section>
        )}

        {/* Redirecting to Stripe */}
        {stage === STAGES.REDIRECTING && (
          <section className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-8 sm:p-12 text-center space-y-4 animate-fadeIn">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-bougainvillea/20 border border-bougainvillea/30 animate-pulse mb-2">
              <span className="material-symbols-outlined text-bougainvillea text-4xl">
                lock
              </span>
            </div>
            <h2 className="font-display text-2xl font-bold text-white">
              Llevándote al pago seguro…
            </h2>
            <p className="text-white/60 text-sm">
              Te estamos redirigiendo a Stripe.
            </p>
          </section>
        )}

        {/* Awaiting payment / generating song */}
        {(stage === STAGES.AWAITING_PAYMENT || stage === STAGES.GENERATING_SONG) && (
          <PollingPanel
            title="¡Pago recibido! Creando tu canción…"
            subtitle="Estamos generando dos versiones completas con tu voz. Esto toma 1-3 minutos."
            elapsedSec={elapsedPolls * (POLL_INTERVAL_MS / 1000)}
            songId={clonedVoiceSongId}
            note="No cierres esta página. Guarda este código para recuperar tu canción si algo falla."
          />
        )}

        {stage === STAGES.DONE && (
          <SongResult
            title={finalTitle}
            audioUrls={audioUrls}
            onCreateAnother={resetAll}
            songId={clonedVoiceSongId}
            recipientName={storyContext?.recipientName}
          />
        )}

        {stage === STAGES.ERROR && error && (
          <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-5 space-y-3">
            <h2 className="font-bold text-rose-200 flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              Algo salió mal
            </h2>
            <p className="text-sm text-rose-200/80 whitespace-pre-wrap">{error}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStage(STAGES.CONFIGURE)}
                className="text-sm text-bougainvillea underline font-semibold"
              >
                Volver a configurar
              </button>
              {clonedVoiceSongId && (
                <span className="text-xs text-white/40">
                  Código: <code className="text-bougainvillea">{clonedVoiceSongId}</code>
                </span>
              )}
            </div>
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
        Beta
      </div>
    </header>
  );
}

/**
 * Before/after demo (2026-08-27): nothing sells voice cloning like HEARING
 * it. Renders only when both demo files are deployed at
 * public/clonamivoz/demo-raw.mp3 (a snippet of the raw recording) and
 * public/clonamivoz/demo-song.mp3 (a snippet of the finished song) — drop
 * the files in and the section appears on the next deploy, no code change.
 */
function BeforeAfterDemo() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all(
      ['/clonamivoz/demo-raw.mp3', '/clonamivoz/demo-song.mp3'].map((u) =>
        fetch(u, { method: 'HEAD' })
          .then((r) => r.ok && !(r.headers.get('content-type') || '').includes('text/html'))
          .catch(() => false)
      )
    ).then(([raw, song]) => {
      if (alive) setAvailable(raw && song);
    });
    return () => { alive = false; };
  }, []);

  if (!available) return null;

  return (
    <section className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-bougainvillea/30 p-6 sm:p-8 space-y-5">
      <div className="text-center">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
          Escucha la diferencia
        </h2>
        <p className="text-sm text-white/60 mt-1.5">
          Una grabación casera de unos segundos se convierte en una canción completa —
          cantada con la misma voz.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-landing-bg/50 border border-white/10 p-4 space-y-2">
          <div className="text-xs uppercase tracking-widest text-white/50 font-semibold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base">mic</span>
            1 · Así se grabó
          </div>
          <audio controls preload="none" src="/clonamivoz/demo-raw.mp3" className="w-full" />
        </div>
        <div className="rounded-2xl bg-bougainvillea/10 border border-bougainvillea/40 p-4 space-y-2">
          <div className="text-xs uppercase tracking-widest text-bougainvillea font-semibold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base">music_note</span>
            2 · Así quedó la canción
          </div>
          <audio controls preload="none" src="/clonamivoz/demo-song.mp3" className="w-full" />
        </div>
      </div>
    </section>
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
          Prueba gratis · Solo pagas si te gusta · {PRICE_USD} USD
        </div>
      </section>

      <BeforeAfterDemo />

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
            <div className="font-display font-bold text-white text-xl mb-2">{s.title}</div>
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
              <div className="text-4xl mb-2 transition group-hover:scale-110">{g.emoji}</div>
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
  // 5 visible steps. Stage states map to one of these visual steps.
  const steps = [
    { key: 'record',    label: 'Grabar' },
    { key: 'configure', label: 'Letra' },
    { key: 'preview',   label: 'Prueba' },
    { key: 'pay',       label: 'Pagar' },
    { key: 'done',      label: 'Listo' },
  ];

  const stageToStep = {
    [STAGES.RECORD]: 'record',
    [STAGES.ENROLL_UPLOADING]: 'record',
    [STAGES.ENROLL_PHRASE_WAIT]: 'record',
    [STAGES.ENROLL_PHRASE_RECORD]: 'record',
    [STAGES.ENROLL_CREATING]: 'record',
    [STAGES.ENROLL_FAILED]: 'record',
    [STAGES.CONFIGURE]: 'configure',
    [STAGES.UPLOADING]: 'configure',
    [STAGES.SUBMITTING_PREVIEW]: 'preview',
    [STAGES.GENERATING_PREVIEW]: 'preview',
    [STAGES.PREVIEW_READY]: 'pay',
    [STAGES.REDIRECTING]: 'pay',
    [STAGES.AWAITING_PAYMENT]: 'done',
    [STAGES.GENERATING_SONG]: 'done',
    [STAGES.DONE]: 'done',
  };
  const currentKey = stageToStep[stage] || 'record';
  const currentIdx = steps.findIndex((s) => s.key === currentKey);

  return (
    <ol className="flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold">
      {steps.map((s, i) => {
        const isActive = i === currentIdx;
        const isPast = i < currentIdx || stage === STAGES.DONE;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-bold text-xs transition ${
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
                isActive ? 'text-bougainvillea' : isPast ? 'text-emerald-300' : 'text-white/40'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-white/10 mx-1">─</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Shared "we're cooking" panel used during preview generation AND
 * full-song generation. Differs only in the title/subtitle copy.
 */
function PollingPanel({ title, subtitle, elapsedSec, songId, note }) {
  return (
    <section className="rounded-3xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-8 sm:p-12 text-center space-y-4 animate-fadeIn">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-bougainvillea/20 border border-bougainvillea/30 animate-bounce-slow mb-2">
        <span className="material-symbols-outlined text-bougainvillea text-5xl">
          graphic_eq
        </span>
      </div>
      <h2 className="font-display text-3xl font-bold text-white">{title}</h2>
      <p className="text-white/60">{subtitle}</p>
      <div className="flex items-center justify-center gap-2 text-sm text-white/50">
        <span className="w-2 h-2 rounded-full bg-bougainvillea animate-pulse" />
        <span>Tiempo: {elapsedSec}s</span>
      </div>
      {songId && (
        <div className="bg-landing-bg/60 rounded-xl p-3 text-xs text-white/50 mt-4 border border-white/5">
          <code className="text-bougainvillea break-all">{songId}</code>
          <br />
          <span className="text-white/40">{note}</span>
        </div>
      )}
    </section>
  );
}

/**
 * Returning-customer voice picker. Collapsed by default — shows a small
 * "¿Ya grabaste antes? Usar mi voz guardada" link.  When opened, asks
 * for email, looks up saved voice samples via find-customer-voices,
 * and lets the user pick one to skip the recording step entirely.
 *
 * Calls onPick({ voiceSampleId, durationSeconds, email }) when the user
 * selects a saved voice. The parent skips upload and goes straight to
 * the configure step.
 */
function SavedVoicePicker({ onPick }) {
  const [open, setOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [voices, setVoices] = useState(null); // null = not yet searched
  const [error, setError] = useState(null);

  async function search() {
    setError(null);
    setVoices(null);
    if (!emailInput.trim() || !emailInput.includes('@')) {
      setError('Escribe un email válido.');
      return;
    }
    setSearching(true);
    const res = await findCustomerVoices(emailInput.trim().toLowerCase());
    setSearching(false);
    if (!res.ok) {
      setError(res.message || res.error || 'No pudimos buscar tus grabaciones.');
      return;
    }
    setVoices(res.voices || []);
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  if (!open) {
    return (
      <div className="text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-bougainvillea hover:brightness-110 font-semibold inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
        >
          <span className="material-symbols-outlined text-base">history</span>
          ¿Ya grabaste tu voz antes? Búscala con tu email
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-bougainvillea/30 p-5 space-y-3 animate-fadeIn">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-bougainvillea">
              record_voice_over
            </span>
            Usa tu voz guardada
          </div>
          <p className="text-xs text-white/60 mt-1">
            Si ya grabaste tu voz antes, escribe el email que usaste y la encontraremos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-white/40 hover:text-white"
          aria-label="Cerrar"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="email"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
          placeholder="tu@email.com"
          maxLength={200}
          className="flex-1 rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white placeholder-white/30"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching}
          className="rounded-lg bg-bougainvillea hover:brightness-110 text-white font-semibold px-4 py-2 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {searching ? (
            <>
              <span className="material-symbols-outlined animate-spin text-base">
                progress_activity
              </span>
              Buscando…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-base">search</span>
              Buscar
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-300 flex items-start gap-1">
          <span className="material-symbols-outlined text-sm text-rose-400">error</span>
          {error}
        </div>
      )}

      {/* Results */}
      {voices !== null && voices.length === 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200">
          No encontramos grabaciones con ese email. Recuerda que las
          grabaciones se borran automáticamente después de 30 días.
          Puedes grabar una nueva ahora abajo. ↓
        </div>
      )}

      {voices && voices.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-white/60 uppercase tracking-wider">
            Tus grabaciones ({voices.length})
          </div>
          {voices.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() =>
                onPick({
                  voiceSampleId: v.id,
                  durationSeconds: v.duration_seconds || 0,
                  email: emailInput.trim().toLowerCase(),
                })
              }
              className="w-full text-left rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-bougainvillea/40 p-3 transition active:scale-[0.99] flex items-center gap-3"
            >
              <span className="material-symbols-outlined text-bougainvillea">
                graphic_eq
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white">
                  Grabación del {formatDate(v.created_at)}
                </div>
                <div className="text-xs text-white/50">
                  {v.duration_seconds
                    ? `${Math.round(v.duration_seconds)} segundos`
                    : 'duración desconocida'}
                </div>
              </div>
              <span className="material-symbols-outlined text-white/40">
                arrow_forward
              </span>
            </button>
          ))}
          <p className="text-[10px] text-white/40 text-center pt-1">
            Las grabaciones se borran automáticamente 30 días después de subirse.
          </p>
        </div>
      )}
    </div>
  );
}

function FooterDisclaimer() {
  return (
    <footer className="pt-8 border-t border-white/5 text-xs text-white/40 space-y-2 text-center">
      <p>
        Al grabar tu voz aceptas que la procesemos para crear tu canción personalizada.
        Tu grabación se borra automáticamente después de 30 días.
      </p>
      <p>
        <a href="/politica-de-privacidad" className="underline hover:text-bougainvillea">
          Política de privacidad
        </a>
        {' · '}
        <a href="/terminos-de-servicio" className="underline hover:text-bougainvillea">
          Términos
        </a>
      </p>
    </footer>
  );
}
