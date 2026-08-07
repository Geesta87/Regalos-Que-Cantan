import React, { useContext, useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { AppContext } from '../App';
import genres from '../config/genres';
import { trackStep } from '../services/tracking';
import { checkEmail } from '../services/emailValidation';

// /crear — Heyflow-style micro-step funnel.
// One decision per full screen. Single-select tiles auto-advance after a short
// selected-state flash (~380ms) with a slide transition, which is what gives
// click-funnels their momentum; free-text screens use an explicit Continuar.
// The structural fixes from the 2026-08 UX audit are load-bearing here:
// phone back button = previous screen, every keystroke persists and restores
// synchronously after a reload, and inputs are boxed and high-contrast.
// Feeds the same formData context and hands off to GeneratingPage untouched.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_KEY = 'rqc_crear_simple';
const AUTO_ADVANCE_MS = 380;

const RELATIONSHIPS = [
  { id: 'madre', name: 'Mi mamá', icon: 'face_4' },
  { id: 'padre', name: 'Mi papá', icon: 'face' },
  { id: 'pareja', name: 'Mi pareja', icon: 'favorite' },
  { id: 'hijo', name: 'Mi hijo / hija', icon: 'child_care' },
  { id: 'hermano', name: 'Mi hermano / hermana', icon: 'group' },
  { id: 'abuelo', name: 'Mi abuelo / abuela', icon: 'elderly' },
  { id: 'amigo', name: 'Mi amigo / amiga', icon: 'diversity_3' },
  { id: 'yo_mismo', name: 'Es para mí', icon: 'person' },
  { id: 'otro', name: 'Otra persona', icon: 'more_horiz' },
];

const OCCASIONS = [
  { id: 'cumpleanos', name: 'Cumpleaños', icon: 'cake' },
  { id: 'dia_madre', name: 'Día de la Madre', icon: 'local_florist' },
  { id: 'dia_padre', name: 'Día del Padre', icon: 'family_restroom' },
  { id: 'aniversario', name: 'Aniversario', icon: 'favorite' },
  { id: 'amor', name: 'Amor / Pareja', icon: 'volunteer_activism' },
  { id: 'boda', name: 'Boda', icon: 'diamond' },
  { id: 'graduacion', name: 'Graduación', icon: 'school' },
  { id: 'quinceanera', name: 'Quinceañera', icon: 'celebration' },
  { id: 'agradecimiento', name: 'Agradecimiento', icon: 'redeem' },
  { id: 'memorial', name: 'En memoria', icon: 'eco' },
  { id: 'navidad', name: 'Navidad', icon: 'ac_unit' },
  { id: 'otro', name: 'Otra ocasión', icon: 'edit_note' },
];

const MAIN_GENRES = [
  { id: 'corrido', desc: 'Historias con guitarras y tuba', icon: 'music_note' },
  { id: 'banda', desc: 'Fiesta sinaloense con tambora', icon: 'queue_music' },
  { id: 'romantica', desc: 'Lenta y emotiva, para dedicar', icon: 'favorite' },
  { id: 'ranchera', desc: 'La clásica de siempre', icon: 'piano' },
  { id: 'mariachi', desc: 'Serenata tradicional', icon: 'library_music' },
  { id: 'bachata', desc: 'Romántica y para bailar', icon: 'graphic_eq' },
  { id: 'cumbia', desc: 'Alegre, para que todos bailen', icon: 'album' },
  { id: 'cristiana', desc: 'De fe y alabanza', icon: 'church' },
];

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* start fresh */ }
  return {};
}

export default function SimpleCreateFlow() {
  const { updateFormData, navigateTo } = useContext(AppContext);
  const saved = useRef(loadSaved()).current;

  const [answers, setAnswers] = useState({
    relationship: saved.relationship || '',
    customRelationship: saved.customRelationship || '',
    recipientName: saved.recipientName || '',
    senderName: saved.senderName || '',
    occasion: saved.occasion || '',
    customOccasion: saved.customOccasion || '',
    genre: saved.genre || '',
    voiceType: saved.voiceType || '',
    storySpecial: saved.storySpecial || '',
    storyMemory: saved.storyMemory || '',
    storyMessage: saved.storyMessage || '',
    useOwnLyrics: saved.useOwnLyrics || false,
    ownLyrics: saved.ownLyrics || '',
    email: saved.email || '',
  });
  const [stepIndex, setStepIndex] = useState(saved.stepIndex || 0);
  const [anim, setAnim] = useState('forward');
  const [hint, setHint] = useState('');
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const advancing = useRef(false);

  const isForSelf = answers.relationship === 'yo_mismo';

  // The screen sequence adapts to the answers (skip name when it's for
  // yourself, extra screen when "otra ocasión", own-lyrics replaces the three
  // guided story screens).
  const steps = useMemo(() => {
    const s = ['relationship'];
    if (answers.relationship === 'otro') s.push('customRelationship');
    if (!isForSelf) s.push('recipientName');
    s.push('senderName', 'occasion');
    if (answers.occasion === 'otro') s.push('customOccasion');
    s.push('genre', 'voice');
    if (answers.useOwnLyrics) s.push('ownLyrics');
    else s.push('storySpecial', 'storyMemory', 'storyMessage');
    s.push('final');
    return s;
  }, [answers.relationship, isForSelf, answers.occasion, answers.useOwnLyrics]);

  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const progress = ((Math.min(stepIndex, steps.length - 1) + 1) / steps.length) * 100;

  const set = (field, value) => {
    setAnswers(prev => ({ ...prev, [field]: value }));
    setHint('');
  };

  // Persist every change immediately so a reload or app-switch never loses work.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...answers, stepIndex }));
    } catch { /* storage unavailable */ }
  }, [answers, stepIndex]);

  // Phone back button = previous screen.
  useEffect(() => {
    window.history.replaceState({ page: 'crear', wizardIndex: stepIndex }, '', '/crear');
    const onPop = (e) => {
      if (e.state && e.state.page === 'crear' && typeof e.state.wizardIndex === 'number') {
        setAnim('back');
        setStepIndex(e.state.wizardIndex);
        setHint('');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Funnel analytics — map micro-steps onto the classic step names so the
  // existing dashboards keep working.
  useEffect(() => {
    const map = {
      relationship: 'names', customRelationship: 'names', recipientName: 'names', senderName: 'names',
      occasion: 'occasion', customOccasion: 'occasion', genre: 'genre', voice: 'genre',
      storySpecial: 'details', storyMemory: 'details', storyMessage: 'details', ownLyrics: 'details',
      final: 'email',
    };
    trackStep(map[step] || 'names', { funnel_variant: 'simple_v2', micro_step: step });
    window.scrollTo(0, 0);
  }, [step]);

  const goNext = () => {
    if (stepIndex >= steps.length - 1) return;
    const next = stepIndex + 1;
    setAnim('forward');
    window.history.pushState({ page: 'crear', wizardIndex: next }, '', '/crear');
    setStepIndex(next);
    setHint('');
    advancing.current = false;
  };

  const goBack = () => {
    if (stepIndex === 0) {
      navigateTo('landing');
      return;
    }
    window.history.back();
  };

  const jumpTo = (id) => {
    const idx = steps.indexOf(id);
    if (idx >= 0) {
      setAnim('back');
      window.history.pushState({ page: 'crear', wizardIndex: idx }, '', '/crear');
      setStepIndex(idx);
    }
  };

  // Single-select tile: paint the selection, breathe for a beat, slide on.
  const selectAndAdvance = (field, value) => {
    if (advancing.current) return;
    advancing.current = true;
    setAnswers(prev => ({ ...prev, [field]: value }));
    setHint('');
    setTimeout(() => {
      advancing.current = false;
      goNext();
    }, AUTO_ADVANCE_MS);
  };

  const composeDetails = () => {
    const parts = [];
    if (answers.storySpecial.trim()) parts.push(`Apodos y lo que la hace especial: ${answers.storySpecial.trim()}`);
    if (answers.storyMemory.trim()) parts.push(`Recuerdos o momentos importantes: ${answers.storyMemory.trim()}`);
    if (answers.storyMessage.trim()) parts.push(`Lo que quiero decirle con la canción: ${answers.storyMessage.trim()}`);
    return parts.join('\n');
  };
  const storyLength = composeDetails().length;

  const recipientDisplay = isForSelf ? answers.senderName.trim() : answers.recipientName.trim();

  const handleSubmit = async () => {
    const result = checkEmail(answers.email);
    if (!result.ok) return setHint(result.message);
    if (submitting) return;
    setSubmitting(true);

    const genreConfig = genres[answers.genre];
    const finalSender = answers.senderName.trim();
    const finalRecipient = isForSelf ? finalSender : answers.recipientName.trim();

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

  // ---------- building blocks ----------

  const Tile = ({ selected, onClick, icon, label, sub }) => (
    <button
      type="button"
      onClick={onClick}
      className={`sc-tile group relative flex items-center gap-3.5 w-full rounded-xl border bg-white px-4 py-4 text-left transition-all duration-150 ${
        selected
          ? 'border-primary ring-2 ring-primary/25 shadow-[0_4px_20px_rgba(242,13,128,0.12)]'
          : 'border-neutral-200 hover:border-neutral-300 hover:shadow-sm'
      }`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
        selected ? 'bg-primary text-white' : 'bg-neutral-100 text-neutral-500 group-hover:text-neutral-700'
      }`}>
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-snug text-neutral-900">{label}</span>
        {sub && <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500">{sub}</span>}
      </span>
      <span className={`material-symbols-outlined shrink-0 text-[20px] transition-opacity ${
        selected ? 'text-primary opacity-100' : 'opacity-0'
      }`}>check_circle</span>
    </button>
  );

  const Question = ({ kicker, title, sub, children }) => (
    <div>
      {kicker && <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">{kicker}</p>}
      <h1 className="font-display text-[28px] md:text-[34px] font-bold leading-[1.15] text-neutral-900">{title}</h1>
      {sub && <p className="mt-3 text-[15px] leading-relaxed text-neutral-500">{sub}</p>}
      <div className="mt-7">{children}</div>
    </div>
  );

  const TextField = ({ id, value, onChange, label, example, textarea, autoFocus, onEnter }) => (
    <div>
      {label && <label htmlFor={id} className="mb-2 block text-[14px] font-semibold text-neutral-700">{label}</label>}
      {textarea ? (
        <textarea
          id={id}
          value={value}
          onChange={onChange}
          className="h-36 w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-3.5 text-[16px] leading-relaxed text-neutral-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          autoFocus={autoFocus}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={onChange}
          onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }}
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3.5 text-[17px] text-neutral-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          autoComplete="off"
          autoFocus={autoFocus}
        />
      )}
      {example && <p className="mt-2 text-[13px] text-neutral-400">{example}</p>}
    </div>
  );

  const ContinueBtn = ({ onClick, label = 'Continuar', disabled }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-[16px] font-bold text-white shadow-[0_6px_24px_rgba(242,13,128,0.3)] transition-all hover:brightness-105 active:scale-[0.985] disabled:opacity-50"
    >
      {label}
      <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
    </button>
  );

  const SkipLink = ({ onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto mt-4 block text-[13px] font-medium text-neutral-400 underline-offset-4 hover:text-neutral-600 hover:underline"
    >
      Omitir este paso
    </button>
  );

  // ---------- screens ----------

  const screen = () => {
    switch (step) {
      case 'relationship':
        return (
          <Question title="¿Para quién es la canción?" sub="Elige a la persona especial que la va a recibir.">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {RELATIONSHIPS.map(rel => (
                <Tile
                  key={rel.id}
                  icon={rel.icon}
                  label={rel.name}
                  selected={answers.relationship === rel.id}
                  onClick={() => selectAndAdvance('relationship', rel.id)}
                />
              ))}
            </div>
          </Question>
        );

      case 'customRelationship':
        return (
          <Question title="¿Quién es esa persona para ti?">
            <TextField
              id="sc-customrel"
              value={answers.customRelationship}
              onChange={e => set('customRelationship', e.target.value.slice(0, 50))}
              example="Ejemplo: mi madrina, mi suegra, mi compadre"
              autoFocus
              onEnter={() => answers.customRelationship.trim().length >= 3 && goNext()}
            />
            <ContinueBtn onClick={() => {
              if (answers.customRelationship.trim().length < 3) return setHint('Escribe quién es esa persona para continuar.');
              goNext();
            }} />
          </Question>
        );

      case 'recipientName':
        return (
          <Question
            title="¿Cómo se llama?"
            sub="Su nombre se cantará dentro de la canción, así que revisa que esté bien escrito."
          >
            <TextField
              id="sc-recipient"
              value={answers.recipientName}
              onChange={e => set('recipientName', e.target.value)}
              example="Ejemplo: María Elena"
              autoFocus
              onEnter={() => answers.recipientName.trim().length >= 2 && goNext()}
            />
            <ContinueBtn onClick={() => {
              if (answers.recipientName.trim().length < 2) return setHint('Escribe su nombre para continuar — es el nombre que se cantará.');
              goNext();
            }} />
          </Question>
        );

      case 'senderName':
        return (
          <Question
            title={isForSelf ? '¿Cómo te llamas?' : '¿De parte de quién?'}
            sub={isForSelf ? undefined : 'La canción puede mencionar de quién viene este regalo.'}
          >
            <TextField
              id="sc-sender"
              value={answers.senderName}
              onChange={e => set('senderName', e.target.value)}
              label="Tu nombre"
              example="Ejemplo: Roberto"
              autoFocus
              onEnter={() => answers.senderName.trim().length >= 2 && goNext()}
            />
            <ContinueBtn onClick={() => {
              if (answers.senderName.trim().length < 2) return setHint('Escribe tu nombre para continuar.');
              goNext();
            }} />
          </Question>
        );

      case 'occasion':
        return (
          <Question title="¿Qué están celebrando?" sub="La letra se adapta a la ocasión.">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {OCCASIONS.map(occ => (
                <Tile
                  key={occ.id}
                  icon={occ.icon}
                  label={occ.name}
                  selected={answers.occasion === occ.id}
                  onClick={() => selectAndAdvance('occasion', occ.id)}
                />
              ))}
            </div>
          </Question>
        );

      case 'customOccasion':
        return (
          <Question title="Cuéntanos qué celebras">
            <TextField
              id="sc-customocc"
              value={answers.customOccasion}
              onChange={e => set('customOccasion', e.target.value.slice(0, 500))}
              example="Ejemplo: mi hermano abrió su propio negocio después de años de esfuerzo"
              textarea
              autoFocus
            />
            <ContinueBtn onClick={() => {
              if (answers.customOccasion.trim().length < 10) return setHint('Cuéntanos brevemente qué celebras para poder escribir la letra.');
              goNext();
            }} />
          </Question>
        );

      case 'genre':
        return (
          <Question
            title="¿Qué música le gusta?"
            sub="Elige el estilo que suene a lo que se escucha en su casa."
          >
            <div className="grid grid-cols-1 gap-2.5">
              {MAIN_GENRES.map(g => (
                <Tile
                  key={g.id}
                  icon={g.icon}
                  label={genres[g.id]?.name || g.id}
                  sub={g.desc}
                  selected={answers.genre === g.id}
                  onClick={() => selectAndAdvance('genre', g.id)}
                />
              ))}
            </div>
            {!showAllGenres ? (
              <button
                type="button"
                onClick={() => setShowAllGenres(true)}
                className="mx-auto mt-5 flex items-center gap-1.5 text-[14px] font-semibold text-primary"
              >
                Ver todos los estilos
                <span className="material-symbols-outlined text-[18px]">expand_more</span>
              </button>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {Object.entries(genres)
                  .filter(([id]) => !MAIN_GENRES.some(m => m.id === id))
                  .map(([id, data]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectAndAdvance('genre', id)}
                      className={`rounded-xl border bg-white px-3 py-3 text-[14px] font-semibold text-neutral-800 transition-all ${
                        answers.genre === id
                          ? 'border-primary ring-2 ring-primary/25'
                          : 'border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      {data.name}
                    </button>
                  ))}
              </div>
            )}
          </Question>
        );

      case 'voice':
        return (
          <Question title="¿Qué voz prefieres?" sub="Quien interpretará la canción.">
            <div className="grid grid-cols-1 gap-3">
              <Tile
                icon="record_voice_over"
                label="Voz masculina"
                sub="Fuerte y profunda"
                selected={answers.voiceType === 'male'}
                onClick={() => selectAndAdvance('voiceType', 'male')}
              />
              <Tile
                icon="interpreter_mode"
                label="Voz femenina"
                sub="Suave y emotiva"
                selected={answers.voiceType === 'female'}
                onClick={() => selectAndAdvance('voiceType', 'female')}
              />
            </div>
          </Question>
        );

      case 'storySpecial':
        return (
          <Question
            kicker="Su historia · 1 de 3"
            title={isForSelf ? '¿Qué te hace especial?' : `¿Qué hace especial a ${recipientDisplay || 'esa persona'}?`}
            sub="Escríbelo como lo contarías platicando. Con esto componemos la letra — no tienes que redactar bonito."
          >
            <TextField
              id="sc-special"
              value={answers.storySpecial}
              onChange={e => set('storySpecial', e.target.value.slice(0, 400))}
              example='Ejemplo: le decimos "La Jefa", hace los mejores tamales de diciembre'
              textarea
              autoFocus
            />
            <ContinueBtn onClick={goNext} />
            <SkipLink onClick={goNext} />
            <button
              type="button"
              onClick={() => set('useOwnLyrics', true)}
              className="mx-auto mt-6 block text-[13px] text-neutral-400 underline-offset-4 hover:text-neutral-600 hover:underline"
            >
              Ya tengo mi propia letra escrita
            </button>
          </Question>
        );

      case 'storyMemory':
        return (
          <Question
            kicker="Su historia · 2 de 3"
            title="¿Qué recuerdo debe mencionar la canción?"
            sub="Un momento, una anécdota o una fecha que signifique mucho."
          >
            <TextField
              id="sc-memory"
              value={answers.storyMemory}
              onChange={e => set('storyMemory', e.target.value.slice(0, 600))}
              example="Ejemplo: llegó de Guanajuato hace 30 años y sacó adelante a 4 hijos ella sola"
              textarea
              autoFocus
            />
            <ContinueBtn onClick={goNext} />
            <SkipLink onClick={goNext} />
          </Question>
        );

      case 'storyMessage':
        return (
          <Question
            kicker="Su historia · 3 de 3"
            title={isForSelf ? '¿Qué quieres que diga de ti?' : '¿Qué quieres decirle?'}
            sub="El mensaje del corazón de la canción."
          >
            <TextField
              id="sc-message"
              value={answers.storyMessage}
              onChange={e => set('storyMessage', e.target.value.slice(0, 400))}
              example="Ejemplo: que estamos orgullosos de ella y que la amamos"
              textarea
              autoFocus
            />
            <ContinueBtn onClick={goNext} />
            <SkipLink onClick={goNext} />
          </Question>
        );

      case 'ownLyrics':
        return (
          <Question
            title="Tu letra, palabra por palabra"
            sub="Cantaremos exactamente lo que escribas aquí. Solo para letras completas ya escritas."
          >
            <TextField
              id="sc-lyrics"
              value={answers.ownLyrics}
              onChange={e => set('ownLyrics', e.target.value.slice(0, 4000))}
              textarea
              autoFocus
            />
            <button
              type="button"
              onClick={() => set('useOwnLyrics', false)}
              className="mt-3 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
            >
              Mejor contesten unas preguntas y escriban la letra por mí
            </button>
            <ContinueBtn onClick={() => {
              if (answers.ownLyrics.trim().length < 20) return setHint('Pega tu letra completa, o usa las preguntas guiadas y nosotros la escribimos.');
              goNext();
            }} />
          </Question>
        );

      case 'final': {
        const summaryRows = [
          { label: 'Para', value: isForSelf ? `${answers.senderName.trim()} (para ti)` : recipientDisplay, target: 'relationship' },
          { label: 'Ocasión', value: answers.occasion === 'otro' ? answers.customOccasion.trim() : OCCASIONS.find(o => o.id === answers.occasion)?.name, target: 'occasion' },
          { label: 'Estilo', value: genres[answers.genre]?.name, target: 'genre' },
          { label: 'Voz', value: answers.voiceType === 'male' ? 'Masculina' : 'Femenina', target: 'voice' },
        ];
        return (
          <Question
            kicker="Último paso"
            title="Recibe tu canción"
            sub="Escúchala completa antes de decidir si la compras."
          >
            <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white shadow-sm">
              {summaryRows.map(row => (
                <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">{row.label}</p>
                    <p className="truncate text-[15px] font-semibold text-neutral-900">{row.value || '—'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => jumpTo(row.target)}
                    className="shrink-0 text-[13px] font-semibold text-primary"
                  >
                    Cambiar
                  </button>
                </div>
              ))}
            </div>

            {!answers.useOwnLyrics && storyLength < 20 && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
                <span className="material-symbols-outlined mt-0.5 text-[20px] text-amber-500">info</span>
                <div>
                  <p className="text-[14px] font-semibold text-neutral-900">Tu canción aún no tiene historia</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-neutral-600">
                    Sin detalles, la letra será genérica. Un solo recuerdo la hace suya.
                  </p>
                  <button
                    type="button"
                    onClick={() => jumpTo('storySpecial')}
                    className="mt-1.5 text-[13px] font-bold text-primary"
                  >
                    Agregar detalles
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6">
              <label htmlFor="sc-email" className="mb-2 block text-[14px] font-semibold text-neutral-700">
                Tu correo electrónico
              </label>
              <input
                id="sc-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={answers.email}
                onChange={e => set('email', e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3.5 text-[17px] text-neutral-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="mt-2 text-[13px] text-neutral-400">Aquí te enviamos la canción terminada.</p>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="mt-6 w-full rounded-xl bg-primary px-6 py-4 text-[16px] font-bold text-white shadow-[0_6px_24px_rgba(242,13,128,0.3)] transition-all hover:brightness-105 active:scale-[0.985] disabled:opacity-60"
            >
              {submitting ? 'Creando tu canción…' : 'Crear mi canción — escúchala gratis'}
            </button>

            <div className="mt-5 flex items-center justify-center gap-5 text-neutral-400">
              <span className="flex items-center gap-1.5 text-[12px] font-medium">
                <span className="material-symbols-outlined text-[16px]">lock</span> Pago seguro
              </span>
              <span className="flex items-center gap-1.5 text-[12px] font-medium">
                <span className="material-symbols-outlined text-[16px]">schedule</span> Lista en ~3 min
              </span>
              <span className="flex items-center gap-1.5 text-[12px] font-medium">
                <span className="material-symbols-outlined text-[16px]">star</span> +5,000 clientes
              </span>
            </div>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-neutral-400">
              Al continuar aceptas los <a href="/terminos-de-servicio" className="underline">términos de servicio</a> y la{' '}
              <a href="/politica-de-privacidad" className="underline">política de privacidad</a>.
            </p>
          </Question>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] font-body">
      <style>{`
        @keyframes scSlideForward {
          from { opacity: 0; transform: translateX(28px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes scSlideBack {
          from { opacity: 0; transform: translateX(-28px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .sc-forward { animation: scSlideForward 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
        .sc-back { animation: scSlideBack 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
      `}</style>

      {/* Top bar: back chevron, wordmark, progress line */}
      <header className="sticky top-0 z-40 bg-[#FAFAF8]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
          <button
            type="button"
            onClick={goBack}
            aria-label="Regresar"
            className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <span className="font-display text-[17px] font-bold tracking-tight text-neutral-900">RegalosQueCantan</span>
          <span className="w-10 text-right text-[12px] font-semibold tabular-nums text-neutral-400">
            {Math.min(stepIndex + 1, steps.length)}/{steps.length}
          </span>
        </div>
        <div className="h-[3px] w-full bg-neutral-200/70">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-5 pb-24 pt-8 md:pt-12">
        <div key={step} className={anim === 'forward' ? 'sc-forward' : 'sc-back'}>
          {screen()}

          {hint && (
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
              <span className="material-symbols-outlined mt-0.5 text-[19px] text-primary">error</span>
              <p className="text-[14px] font-medium leading-snug text-neutral-800">{hint}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
