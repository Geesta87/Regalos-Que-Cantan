import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { AppContext } from '../App';
import genres from '../config/genres';
import { trackStep } from '../services/tracking';
import { checkEmail } from '../services/emailValidation';

// Simplified "one question per screen" creation flow (/crear).
// Built for buyers with little tech experience (see docs/ux-audit-song-creation-2026-08.md):
// boxed high-contrast inputs, no auto-advance, phone back button = previous
// question, progress survives refresh/app-switch, buttons explain what's
// missing instead of sitting disabled. Feeds the same formData context and
// hands off to the existing GeneratingPage — no backend changes.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_KEY = 'rqc_crear_simple';
const TOTAL_STEPS = 7;

// Main genres with plain-language descriptions an abuela recognizes.
const MAIN_GENRES = [
  { id: 'corrido', emoji: '🎸', desc: 'Historias con guitarras y tuba' },
  { id: 'banda', emoji: '🎺', desc: 'Fiesta sinaloense, pura energía' },
  { id: 'romantica', emoji: '❤️', desc: 'Lenta y emotiva, para dedicar' },
  { id: 'ranchera', emoji: '🤠', desc: 'La clásica de siempre, con sentimiento' },
  { id: 'mariachi', emoji: '🎻', desc: 'Serenata tradicional mexicana' },
  { id: 'bachata', emoji: '💃', desc: 'Romántica y para bailar' },
  { id: 'cumbia', emoji: '🪇', desc: 'Alegre, para que todos bailen' },
  { id: 'cristiana', emoji: '🙏', desc: 'De fe y alabanza' },
];

const OCCASIONS = [
  { id: 'cumpleanos', name: 'Cumpleaños', emoji: '🎂' },
  { id: 'dia_madre', name: 'Día de la Madre', emoji: '🌷' },
  { id: 'dia_padre', name: 'Día del Padre', emoji: '🤠' },
  { id: 'aniversario', name: 'Aniversario', emoji: '💞' },
  { id: 'amor', name: 'Amor / Pareja', emoji: '❤️' },
  { id: 'boda', name: 'Boda', emoji: '💍' },
  { id: 'graduacion', name: 'Graduación', emoji: '🎓' },
  { id: 'quinceanera', name: 'Quinceañera', emoji: '👑' },
  { id: 'agradecimiento', name: 'Agradecimiento', emoji: '🙏' },
  { id: 'memorial', name: 'En Memoria', emoji: '🕊️' },
  { id: 'navidad', name: 'Navidad', emoji: '🎄' },
  { id: 'otro', name: 'Otra ocasión', emoji: '✨' },
];

const RELATIONSHIPS = [
  { id: 'madre', name: 'Mi mamá', emoji: '👩' },
  { id: 'padre', name: 'Mi papá', emoji: '👨' },
  { id: 'pareja', name: 'Mi pareja / esposo(a)', emoji: '💑' },
  { id: 'hijo', name: 'Mi hijo(a)', emoji: '🧒' },
  { id: 'hermano', name: 'Mi hermano(a)', emoji: '🤝' },
  { id: 'abuelo', name: 'Mi abuelo(a)', emoji: '👵' },
  { id: 'amigo', name: 'Mi amigo(a)', emoji: '😊' },
  { id: 'yo_mismo', name: 'Es para mí', emoji: '⭐' },
  { id: 'otro', name: 'Otra persona', emoji: '👥' },
];

// Load saved progress synchronously so a refresh or app-switch never shows
// blank fields (root cause of "el sistema me saca" in the audit).
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted or unavailable — start fresh */ }
  return {};
}

export default function SimpleCreateFlow() {
  const { updateFormData, navigateTo } = useContext(AppContext);
  const saved = useRef(loadSaved()).current;

  const [step, setStep] = useState(saved.step || 1);
  const [answers, setAnswers] = useState({
    relationship: saved.relationship || '',
    customRelationship: saved.customRelationship || '',
    recipientName: saved.recipientName || '',
    senderName: saved.senderName || '',
    occasion: saved.occasion || '',
    customOccasion: saved.customOccasion || '',
    genre: saved.genre || '',
    voiceType: saved.voiceType || '',
    storyNickname: saved.storyNickname || '',
    storyMemory: saved.storyMemory || '',
    storyMessage: saved.storyMessage || '',
    storyExtra: saved.storyExtra || '',
    useOwnLyrics: saved.useOwnLyrics || false,
    ownLyrics: saved.ownLyrics || '',
    email: saved.email || '',
  });
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [hint, setHint] = useState('');            // friendly "what's missing" message
  const [emptyStoryConfirm, setEmptyStoryConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const topRef = useRef(null);

  const isForSelf = answers.relationship === 'yo_mismo';

  const set = (field, value) => {
    setAnswers(prev => ({ ...prev, [field]: value }));
    setHint('');
  };

  // Persist every change immediately.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...answers, step }));
    } catch { /* storage full/unavailable */ }
  }, [answers, step]);

  // Phone back button = previous question. We push one history entry per step;
  // popstate walks the wizard back instead of dumping the user out of the site.
  useEffect(() => {
    window.history.replaceState({ page: 'crear', wizardStep: step }, '', '/crear');
    const onPop = (e) => {
      if (e.state && e.state.page === 'crear' && e.state.wizardStep) {
        setStep(e.state.wizardStep);
        setHint('');
        setEmptyStoryConfirm(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stepNames = { 1: 'names', 2: 'names', 3: 'occasion', 4: 'genre', 5: 'genre', 6: 'details', 7: 'email' };
    trackStep(stepNames[step] || 'names', { funnel_variant: 'simple_v1', simple_step: step });
    window.scrollTo(0, 0);
  }, [step]);

  const goTo = (n) => {
    window.history.pushState({ page: 'crear', wizardStep: n }, '', '/crear');
    setStep(n);
    setHint('');
    setEmptyStoryConfirm(false);
  };

  const goBack = () => {
    if (step > 1) {
      window.history.back(); // popstate handler moves the wizard back
    } else {
      navigateTo('landing');
    }
  };

  // Compose the story the same way a CS agent would summarize it — labeled
  // sections read better for the lyric composer than a raw blob.
  const composeDetails = () => {
    const parts = [];
    if (answers.storyNickname.trim()) parts.push(`Apodos y lo que la hace especial: ${answers.storyNickname.trim()}`);
    if (answers.storyMemory.trim()) parts.push(`Recuerdos o momentos importantes: ${answers.storyMemory.trim()}`);
    if (answers.storyMessage.trim()) parts.push(`Lo que quiero decirle con la canción: ${answers.storyMessage.trim()}`);
    if (answers.storyExtra.trim()) parts.push(`Más detalles: ${answers.storyExtra.trim()}`);
    return parts.join('\n');
  };

  const storyLength = composeDetails().length;

  // ---- per-step validation, with friendly guidance instead of dead buttons ----
  const tryNext = () => {
    switch (step) {
      case 1: {
        if (!answers.relationship) return setHint('Toca una de las opciones de arriba para decirnos para quién es. ☝️');
        if (answers.relationship === 'otro' && answers.customRelationship.trim().length < 3)
          return setHint('Escribe quién es esa persona (por ejemplo: "mi madrina").');
        if (!isForSelf && answers.recipientName.trim().length < 2)
          return setHint('Escribe el nombre de la persona en la caja blanca. Ese nombre se cantará en la canción. ☝️');
        return goTo(2);
      }
      case 2: {
        if (answers.senderName.trim().length < 2)
          return setHint('Escribe tu nombre en la caja blanca. ☝️');
        return goTo(3);
      }
      case 3: {
        if (!answers.occasion) return setHint('Toca la ocasión que celebras. ☝️');
        if (answers.occasion === 'otro' && answers.customOccasion.trim().length < 10)
          return setHint('Cuéntanos brevemente qué celebras (por ejemplo: "se recupera de una operación").');
        return goTo(4);
      }
      case 4: {
        if (!answers.genre) return setHint('Toca el tipo de música que le gusta. ☝️');
        return goTo(5);
      }
      case 5: {
        if (!answers.voiceType) return setHint('Toca una de las dos tarjetas: voz de hombre o voz de mujer. ☝️');
        return goTo(6);
      }
      case 6: {
        if (answers.useOwnLyrics) {
          if (answers.ownLyrics.trim().length < 20)
            return setHint('Pega aquí tu letra completa, o regresa a las preguntas y nosotros la escribimos por ti.');
          return goTo(7);
        }
        if (storyLength < 20 && !emptyStoryConfirm) {
          setEmptyStoryConfirm(true);
          return;
        }
        return goTo(7);
      }
      default:
        return;
    }
  };

  const handleSubmit = async () => {
    const result = checkEmail(answers.email);
    if (!result.ok) return setHint(result.message);
    if (submitting) return;
    setSubmitting(true);

    const genreConfig = genres[answers.genre];
    const finalSender = answers.senderName.trim();
    const finalRecipient = isForSelf ? finalSender : answers.recipientName.trim();

    // Write everything into the shared funnel state so GeneratingPage and the
    // rest of the existing pipeline work untouched.
    updateFormData('genre', answers.genre);
    updateFormData('genreName', genreConfig?.name || answers.genre);
    updateFormData('subGenre', '');
    updateFormData('subGenreName', '');
    updateFormData('customStyle', '');
    updateFormData('occasion', answers.occasion);
    updateFormData('customOccasion', answers.occasion === 'otro' ? answers.customOccasion.trim() : '');
    updateFormData('emotionalTone', answers.occasion === 'otro' ? 'celebracion' : '');
    updateFormData('recipientName', finalRecipient);
    updateFormData('senderName', finalSender);
    updateFormData('relationship', answers.relationship);
    if (answers.relationship === 'otro') updateFormData('customRelationship', answers.customRelationship.trim());
    updateFormData('voiceType', answers.voiceType);
    updateFormData('useCustomLyrics', answers.useOwnLyrics);
    updateFormData('customLyrics', answers.useOwnLyrics ? answers.ownLyrics : '');
    updateFormData('details', answers.useOwnLyrics ? '' : composeDetails());
    updateFormData('songwriterNotes', '');
    updateFormData('email', answers.email.trim());

    // Same lead capture + pixel event as the classic EmailStep.
    try {
      supabase.rpc('upsert_email_lead', {
        p_email: answers.email.trim().toLowerCase(),
        p_source: 'email_step',
        p_genre: answers.genre || null,
        p_occasion: answers.occasion || null,
        p_recipient_name: finalRecipient || null,
      }).then(() => {});
    } catch { /* silent */ }
    try {
      if (window.fbq) {
        window.fbq('track', 'Lead', {
          content_name: `${genreConfig?.name || answers.genre} - ${answers.occasion}`,
          content_category: answers.genre || 'song',
          value: 29.99,
          currency: 'USD',
        });
      }
    } catch { /* pixel blocked */ }

    navigateTo('generating');
  };

  // ---------- shared UI pieces ----------

  const genreName = genres[answers.genre]?.name || '';
  const occasionName = answers.occasion === 'otro'
    ? answers.customOccasion
    : OCCASIONS.find(o => o.id === answers.occasion)?.name || '';
  const relationshipName = answers.relationship === 'otro'
    ? answers.customRelationship
    : RELATIONSHIPS.find(r => r.id === answers.relationship)?.name || '';

  const inputClass = 'w-full bg-white border-2 border-[#d8cfc4] focus:border-bougainvillea rounded-xl px-4 py-4 text-lg text-[#2b2018] placeholder:text-[#b3a089] outline-none shadow-sm';

  const Card = ({ selected, onClick, children, className = '' }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-2xl border-2 px-4 py-4 transition-all active:scale-[0.98] ${
        selected
          ? 'border-bougainvillea bg-bougainvillea/10 shadow-md'
          : 'border-[#e5dcd2] bg-white hover:border-bougainvillea/40 shadow-sm'
      } ${className}`}
    >
      {children}
    </button>
  );

  const questionTitle = {
    1: '¿Para quién es la canción?',
    2: '¿Quién se la regala?',
    3: '¿Qué están celebrando?',
    4: '¿Qué música le gusta?',
    5: '¿Voz de hombre o de mujer?',
    6: isForSelf ? 'Cuéntanos tu historia' : `Cuéntanos de ${answers.recipientName.trim() || 'esa persona'}`,
    7: '¡Ya casi está lista!',
  }[step];

  return (
    <div ref={topRef} className="min-h-screen bg-[#FBF5EE] text-[#2b2018] font-body flex flex-col">
      {/* Header: brand (not a link — a mis-tap must never throw progress away) + big progress */}
      <header className="bg-white border-b border-[#eee3d8] px-5 py-4 sticky top-0 z-40">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="font-display text-lg font-bold text-[#2b2018]">RegalosQueCantan</span>
            <span className="text-base font-bold text-bougainvillea">Paso {step} de {TOTAL_STEPS}</span>
          </div>
          <div className="h-2.5 w-full bg-[#f0e6da] rounded-full overflow-hidden">
            <div
              className="h-full bg-bougainvillea rounded-full transition-all duration-500"
              style={{ width: `${Math.round((step / TOTAL_STEPS) * 100)}%` }}
            />
          </div>
        </div>
      </header>

      <main className="flex-grow px-5 py-8 pb-40">
        <div className="max-w-lg mx-auto">
          <h1 className="font-display text-3xl font-black leading-tight mb-2">{questionTitle}</h1>

          {/* ---------------- STEP 1: recipient ---------------- */}
          {step === 1 && (
            <div className="space-y-6 mt-6">
              <div className="grid grid-cols-2 gap-3">
                {RELATIONSHIPS.map(rel => (
                  <Card
                    key={rel.id}
                    selected={answers.relationship === rel.id}
                    onClick={() => set('relationship', rel.id)}
                  >
                    <span className="text-2xl mr-2 align-middle">{rel.emoji}</span>
                    <span className="text-base font-semibold align-middle">{rel.name}</span>
                    {answers.relationship === rel.id && <span className="float-right text-bougainvillea text-xl font-black">✓</span>}
                  </Card>
                ))}
              </div>

              {answers.relationship === 'otro' && (
                <div>
                  <label className="block text-base font-bold mb-2">¿Quién es esa persona para ti?</label>
                  <input
                    type="text"
                    value={answers.customRelationship}
                    onChange={e => set('customRelationship', e.target.value.slice(0, 50))}
                    className={inputClass}
                  />
                  <p className="text-sm text-[#8a7a68] mt-2">Por ejemplo: mi madrina, mi suegra, mi compadre</p>
                </div>
              )}

              {answers.relationship && !isForSelf && (
                <div>
                  <label className="block text-base font-bold mb-2" htmlFor="sc-recipient">
                    ¿Cómo se llama? <span className="font-normal text-[#8a7a68]">(este nombre se cantará)</span>
                  </label>
                  <input
                    id="sc-recipient"
                    type="text"
                    value={answers.recipientName}
                    onChange={e => set('recipientName', e.target.value)}
                    className={inputClass}
                    autoComplete="off"
                  />
                  <p className="text-sm text-[#8a7a68] mt-2">Por ejemplo: María Elena</p>
                </div>
              )}
            </div>
          )}

          {/* ---------------- STEP 2: sender ---------------- */}
          {step === 2 && (
            <div className="space-y-4 mt-6">
              <p className="text-lg text-[#6b5b4a]">
                {isForSelf ? 'Escribe tu nombre.' : 'La canción dirá de parte de quién viene este regalo.'}
              </p>
              <div>
                <label className="block text-base font-bold mb-2" htmlFor="sc-sender">Tu nombre</label>
                <input
                  id="sc-sender"
                  type="text"
                  value={answers.senderName}
                  onChange={e => set('senderName', e.target.value)}
                  className={inputClass}
                  autoComplete="name"
                />
                <p className="text-sm text-[#8a7a68] mt-2">Por ejemplo: Roberto</p>
              </div>
            </div>
          )}

          {/* ---------------- STEP 3: occasion ---------------- */}
          {step === 3 && (
            <div className="space-y-6 mt-6">
              <div className="grid grid-cols-2 gap-3">
                {OCCASIONS.map(occ => (
                  <Card
                    key={occ.id}
                    selected={answers.occasion === occ.id}
                    onClick={() => set('occasion', occ.id)}
                  >
                    <span className="text-2xl mr-2 align-middle">{occ.emoji}</span>
                    <span className="text-base font-semibold align-middle">{occ.name}</span>
                    {answers.occasion === occ.id && <span className="float-right text-bougainvillea text-xl font-black">✓</span>}
                  </Card>
                ))}
              </div>
              {answers.occasion === 'otro' && (
                <div>
                  <label className="block text-base font-bold mb-2">Cuéntanos qué celebras</label>
                  <textarea
                    value={answers.customOccasion}
                    onChange={e => set('customOccasion', e.target.value.slice(0, 500))}
                    className={`${inputClass} h-28 resize-none`}
                  />
                  <p className="text-sm text-[#8a7a68] mt-2">Por ejemplo: mi hermano abrió su propio negocio</p>
                </div>
              )}
            </div>
          )}

          {/* ---------------- STEP 4: genre ---------------- */}
          {step === 4 && (
            <div className="space-y-4 mt-6">
              <p className="text-lg text-[#6b5b4a]">No te preocupes si no sabes de música — elige lo que suene a lo que escucha en casa.</p>
              <div className="space-y-3">
                {MAIN_GENRES.map(g => (
                  <Card
                    key={g.id}
                    selected={answers.genre === g.id}
                    onClick={() => set('genre', g.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{g.emoji}</span>
                      <div className="flex-1">
                        <p className="text-lg font-bold">{genres[g.id]?.name || g.id}</p>
                        <p className="text-sm text-[#8a7a68]">{g.desc}</p>
                      </div>
                      {answers.genre === g.id && <span className="text-bougainvillea text-2xl font-black">✓</span>}
                    </div>
                  </Card>
                ))}
              </div>

              {!showAllGenres ? (
                <button
                  type="button"
                  onClick={() => setShowAllGenres(true)}
                  className="w-full text-center text-bougainvillea font-bold py-3 text-base underline underline-offset-4"
                >
                  Ver más tipos de música
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(genres)
                    .filter(([id]) => !MAIN_GENRES.some(m => m.id === id))
                    .map(([id, data]) => (
                      <Card
                        key={id}
                        selected={answers.genre === id}
                        onClick={() => set('genre', id)}
                        className="!py-3"
                      >
                        <span className="text-sm font-semibold">{data.name}</span>
                        {answers.genre === id && <span className="float-right text-bougainvillea font-black">✓</span>}
                      </Card>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ---------------- STEP 5: voice ---------------- */}
          {step === 5 && (
            <div className="space-y-4 mt-6">
              <p className="text-lg text-[#6b5b4a]">¿Quién quieres que cante la canción?</p>
              <div className="grid grid-cols-1 gap-4">
                <Card selected={answers.voiceType === 'male'} onClick={() => set('voiceType', 'male')}>
                  <div className="flex items-center gap-4 py-2">
                    <span className="text-4xl">👨‍🎤</span>
                    <div className="flex-1">
                      <p className="text-xl font-bold">Voz de hombre</p>
                      <p className="text-sm text-[#8a7a68]">Fuerte y profunda</p>
                    </div>
                    {answers.voiceType === 'male' && <span className="text-bougainvillea text-2xl font-black">✓</span>}
                  </div>
                </Card>
                <Card selected={answers.voiceType === 'female'} onClick={() => set('voiceType', 'female')}>
                  <div className="flex items-center gap-4 py-2">
                    <span className="text-4xl">👩‍🎤</span>
                    <div className="flex-1">
                      <p className="text-xl font-bold">Voz de mujer</p>
                      <p className="text-sm text-[#8a7a68]">Suave y emotiva</p>
                    </div>
                    {answers.voiceType === 'female' && <span className="text-bougainvillea text-2xl font-black">✓</span>}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ---------------- STEP 6: guided story ---------------- */}
          {step === 6 && !answers.useOwnLyrics && (
            <div className="space-y-6 mt-4">
              <p className="text-lg text-[#6b5b4a]">
                No tienes que redactar nada. Contesta lo que puedas, como si nos lo contaras platicando. Con eso escribimos la letra por ti.
              </p>

              <div>
                <label className="block text-base font-bold mb-2">
                  {isForSelf ? '¿Cómo te dicen de cariño? ¿Qué te hace especial?' : '¿Cómo le dices de cariño? ¿Qué la hace especial?'}
                </label>
                <textarea
                  value={answers.storyNickname}
                  onChange={e => set('storyNickname', e.target.value.slice(0, 400))}
                  className={`${inputClass} h-24 resize-none`}
                />
                <p className="text-sm text-[#8a7a68] mt-1">Por ejemplo: le decimos "La Jefa", hace los mejores tamales de diciembre</p>
              </div>

              <div>
                <label className="block text-base font-bold mb-2">¿Qué recuerdo o momento quieres que mencione la canción?</label>
                <textarea
                  value={answers.storyMemory}
                  onChange={e => set('storyMemory', e.target.value.slice(0, 600))}
                  className={`${inputClass} h-24 resize-none`}
                />
                <p className="text-sm text-[#8a7a68] mt-1">Por ejemplo: llegó de Guanajuato hace 30 años y sacó adelante a 4 hijos ella sola</p>
              </div>

              <div>
                <label className="block text-base font-bold mb-2">¿Qué le quieres decir con esta canción?</label>
                <textarea
                  value={answers.storyMessage}
                  onChange={e => set('storyMessage', e.target.value.slice(0, 400))}
                  className={`${inputClass} h-24 resize-none`}
                />
                <p className="text-sm text-[#8a7a68] mt-1">Por ejemplo: que estamos orgullosos de ella y que la amamos</p>
              </div>

              <div>
                <label className="block text-base font-bold mb-2">
                  ¿Algo más? <span className="font-normal text-[#8a7a68]">(nombres, fechas, lugares — opcional)</span>
                </label>
                <textarea
                  value={answers.storyExtra}
                  onChange={e => set('storyExtra', e.target.value.slice(0, 600))}
                  className={`${inputClass} h-24 resize-none`}
                />
              </div>

              <div className="bg-white border-2 border-[#eee3d8] rounded-xl p-4">
                <p className="text-sm text-[#6b5b4a]">
                  ✍️ <strong>Revisa los nombres y las fechas.</strong> La canción se escribe exactamente con lo que pongas aquí.
                </p>
              </div>

              <button
                type="button"
                onClick={() => set('useOwnLyrics', true)}
                className="text-sm text-[#8a7a68] underline underline-offset-4"
              >
                ¿Ya tienes escrita tu propia letra completa? Úsala aquí
              </button>

              {emptyStoryConfirm && (
                <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-5 space-y-4">
                  <p className="text-lg font-bold">Todavía no nos cuentas nada 🙁</p>
                  <p className="text-base text-[#6b5b4a]">
                    Sin detalles, la canción solo va a decir el nombre de {isForSelf ? 'quien la recibe' : (answers.recipientName.trim() || 'tu ser querido')} y va a sonar como cualquier canción — no como la suya. Con una sola frase que escribas arriba ya queda mucho mejor.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setEmptyStoryConfirm(false); window.scrollTo(0, 0); }}
                    className="w-full bg-bougainvillea text-white text-lg font-bold rounded-full py-4"
                  >
                    Escribir algo (recomendado)
                  </button>
                  <button
                    type="button"
                    onClick={() => goTo(7)}
                    className="w-full text-sm text-[#8a7a68] underline underline-offset-4 py-1"
                  >
                    Continuar sin detalles
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ---------------- STEP 6-alt: own lyrics ---------------- */}
          {step === 6 && answers.useOwnLyrics && (
            <div className="space-y-4 mt-4">
              <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4">
                <p className="text-base font-bold mb-1">⚠️ Solo para letras ya escritas</p>
                <p className="text-sm text-[#6b5b4a]">
                  Cantaremos <strong>exactamente</strong> lo que pegues aquí, palabra por palabra. Si solo tienes ideas o recuerdos, mejor{' '}
                  <button type="button" onClick={() => set('useOwnLyrics', false)} className="text-bougainvillea font-bold underline">
                    contesta las preguntas
                  </button>{' '}
                  y nosotros escribimos la letra.
                </p>
              </div>
              <textarea
                value={answers.ownLyrics}
                onChange={e => set('ownLyrics', e.target.value.slice(0, 4000))}
                placeholder="Pega aquí tu letra completa..."
                className={`${inputClass} h-72`}
              />
            </div>
          )}

          {/* ---------------- STEP 7: summary + email ---------------- */}
          {step === 7 && (
            <div className="space-y-6 mt-4">
              <p className="text-lg text-[#6b5b4a]">Revisa que todo esté bien y dinos a dónde te la enviamos.</p>

              <div className="bg-white border-2 border-[#eee3d8] rounded-2xl p-5 space-y-3">
                {[
                  { label: 'Para', value: isForSelf ? `${answers.senderName.trim()} (para ti)` : `${answers.recipientName.trim()} (${relationshipName})`, edit: 1 },
                  { label: 'De parte de', value: answers.senderName.trim(), edit: 2 },
                  { label: 'Ocasión', value: occasionName, edit: 3 },
                  { label: 'Música', value: genreName, edit: 4 },
                  { label: 'Voz', value: answers.voiceType === 'male' ? 'De hombre' : 'De mujer', edit: 5 },
                  {
                    label: answers.useOwnLyrics ? 'Tu letra' : 'Su historia',
                    value: answers.useOwnLyrics
                      ? `${answers.ownLyrics.trim().slice(0, 90)}${answers.ownLyrics.trim().length > 90 ? '…' : ''}`
                      : (storyLength ? `${composeDetails().slice(0, 90)}${storyLength > 90 ? '…' : ''}` : 'Sin detalles'),
                    edit: 6,
                  },
                ].map(row => (
                  <div key={row.label} className="flex items-start justify-between gap-3 border-b border-[#f3ece3] last:border-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide text-[#8a7a68]">{row.label}</p>
                      <p className="text-base font-semibold break-words">{row.value || '—'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => goTo(row.edit)}
                      className="text-bougainvillea text-sm font-bold underline underline-offset-4 shrink-0"
                    >
                      Cambiar
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-base font-bold mb-2" htmlFor="sc-email">Tu correo electrónico</label>
                <input
                  id="sc-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={answers.email}
                  onChange={e => set('email', e.target.value)}
                  className={inputClass}
                />
                <p className="text-sm text-[#8a7a68] mt-2">Ahí te llega tu canción. Por ejemplo: maria@gmail.com</p>
              </div>

              <p className="text-xs text-[#8a7a68]">
                Al continuar aceptas los <a href="/terminos-de-servicio" className="underline">términos</a> y la{' '}
                <a href="/politica-de-privacidad" className="underline">política de privacidad</a>. Escuchar la canción es gratis.
              </p>
            </div>
          )}

          {/* Friendly guidance when something is missing */}
          {hint && (
            <div className="mt-6 bg-bougainvillea/10 border-2 border-bougainvillea rounded-xl px-4 py-3">
              <p className="text-base font-semibold text-[#2b2018]">{hint}</p>
            </div>
          )}
        </div>
      </main>

      {/* Fixed bottom navigation — same two buttons, same place, every step */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-[#eee3d8] px-5 py-4 z-40">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="shrink-0 border-2 border-[#d8cfc4] text-[#6b5b4a] font-bold rounded-full px-5 py-4 text-base active:scale-95 transition-transform"
          >
            ← Atrás
          </button>
          {step < 7 ? (
            <button
              type="button"
              onClick={tryNext}
              className="flex-1 bg-bougainvillea text-white text-lg font-bold rounded-full py-4 shadow-lg active:scale-[0.98] transition-transform"
            >
              Siguiente →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 bg-bougainvillea text-white text-lg font-bold rounded-full py-4 shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {submitting ? 'Creando…' : '🎵 Escuchar mi canción gratis'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
