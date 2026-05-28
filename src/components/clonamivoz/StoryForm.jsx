// src/components/clonamivoz/StoryForm.jsx
//
// Collects recipient + occasion + relationship + story for the Claude
// lyric generation step. Calls generate-cloned-voice-lyrics via the
// clonamivoz service wrapper.
//
// Ported (JSX, no TS) from suno-voice-clone-test/web-app/components/StoryForm.tsx,
// but talks to the RQC Supabase edge function (anon JWT) instead of the
// Next.js /api/generate-lyrics route used by the standalone test app.
//
// The parent owns the generated lyrics state — we just bubble them up via
// onLyricsGenerated(lyrics, title, emotionalModifiers).

import React, { useState } from 'react';
import { generateClonedVoiceLyrics } from '../../services/clonamivoz';

const OCCASIONS = [
  'Cumpleaños',
  'Aniversario',
  'Día de las Madres',
  'Día del Padre',
  'Quinceañera',
  'Boda',
  'San Valentín',
  'Navidad',
  'Sólo porque sí',
  'Otra ocasión',
];

const RELATIONSHIPS = [
  'Mi esposa',
  'Mi esposo',
  'Mi mamá',
  'Mi papá',
  'Mi abuela',
  'Mi abuelo',
  'Mi hija',
  'Mi hijo',
  'Mi hermana',
  'Mi hermano',
  'Mi novia',
  'Mi novio',
  'Mi mejor amiga',
  'Mi mejor amigo',
  'Otra relación',
];

export default function StoryForm({ genreSlug, onLyricsGenerated, defaultLanguage = 'es' }) {
  const [recipient, setRecipient] = useState('');
  const [occasion, setOccasion] = useState(OCCASIONS[0]);
  const [occasionCustom, setOccasionCustom] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0]);
  const [relationshipCustom, setRelationshipCustom] = useState('');
  const [story, setStory] = useState('');
  // Default to whatever the user picked at the recording stage so they
  // don't have to choose language twice. They can still override here.
  const [language, setLanguage] = useState(defaultLanguage);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function generate() {
    setError(null);

    const finalOccasion = occasion === 'Otra ocasión' ? occasionCustom.trim() : occasion;
    const finalRelationship =
      relationship === 'Otra relación' ? relationshipCustom.trim() : relationship;

    if (!recipient.trim()) {
      setError('Falta el nombre del destinatario.');
      return;
    }
    if (!finalOccasion) {
      setError('Falta la ocasión.');
      return;
    }
    if (!finalRelationship) {
      setError('Falta la relación.');
      return;
    }
    if (!story.trim() || story.trim().length < 20) {
      setError('Cuéntanos un poco más sobre la historia (al menos 20 caracteres).');
      return;
    }

    setBusy(true);
    try {
      const result = await generateClonedVoiceLyrics({
        recipientName: recipient.trim(),
        occasion: finalOccasion,
        relationship: finalRelationship,
        story: story.trim(),
        genreSlug,
        language,
      });
      if (!result.ok) {
        setError(`Error: ${result.error || 'desconocido'}${result.message ? ' — ' + result.message : ''}`);
        return;
      }
      onLyricsGenerated(result.lyrics, result.title, result.emotional_modifiers, {
        recipientName: recipient.trim(),
        relationship: finalRelationship,
        occasion: finalOccasion,
        story: story.trim(),
        language,
      });
    } catch (e) {
      setError(`Error de red: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-5 sm:p-6 space-y-4 animate-fadeIn">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-bougainvillea text-3xl">
          auto_awesome
        </span>
        <div>
          <h3 className="font-display text-xl font-bold text-white">Cuéntanos tu historia</h3>
          <p className="text-sm text-white/60">
            Llena los detalles y escribiremos la letra de la canción por ti.
            Después puedes editarla a mano si quieres.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="cv-recipient" className="block text-sm font-semibold text-white/80 mb-1">
            ¿Para quién es la canción?
          </label>
          <input
            id="cv-recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Erica, mi mamá Lupe…"
            maxLength={50}
            className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white placeholder-white/30"
          />
        </div>

        <div>
          <label htmlFor="cv-relationship" className="block text-sm font-semibold text-white/80 mb-1">
            Tu relación con ella/él
          </label>
          <select
            id="cv-relationship"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white"
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {relationship === 'Otra relación' && (
            <input
              value={relationshipCustom}
              onChange={(e) => setRelationshipCustom(e.target.value)}
              placeholder="Especifica…"
              maxLength={40}
              className="mt-2 w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white placeholder-white/30"
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="cv-occasion" className="block text-sm font-semibold text-white/80 mb-1">
            Ocasión
          </label>
          <select
            id="cv-occasion"
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white"
          >
            {OCCASIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {occasion === 'Otra ocasión' && (
            <input
              value={occasionCustom}
              onChange={(e) => setOccasionCustom(e.target.value)}
              placeholder="Especifica…"
              maxLength={60}
              className="mt-2 w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white placeholder-white/30"
            />
          )}
        </div>

        <div>
          <label htmlFor="cv-language" className="block text-sm font-semibold text-white/80 mb-1">
            Idioma de la letra
          </label>
          <select
            id="cv-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-2.5 text-sm text-white"
          >
            <option value="es">Español</option>
            <option value="spanglish">Spanglish</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="cv-story" className="block text-sm font-semibold text-white/80 mb-1">
          Cuéntanos la historia
          <span className="text-white/40 font-normal ml-1">
            (recuerdos, detalles, qué quieres decirle, qué la hace especial)
          </span>
        </label>
        <textarea
          id="cv-story"
          value={story}
          onChange={(e) => setStory(e.target.value)}
          rows={6}
          maxLength={1500}
          placeholder="Ej: Llevamos 15 años casados. Nos conocimos en una boda en Guadalajara. Le encantan las flores y los amaneceres. Es la mejor mamá del mundo para nuestros 3 hijos. Quiero que sepa que es la luz de mi vida…"
          className="w-full rounded-2xl bg-landing-bg/60 border border-white/10 focus:border-bougainvillea/50 focus:outline-none p-3.5 text-sm text-white placeholder-white/30"
        />
        <div className="text-xs text-white/40 mt-1 text-right">{story.length} / 1500</div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm p-3 flex items-start gap-2">
          <span className="material-symbols-outlined text-rose-400 text-base">error</span>
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="w-full rounded-2xl bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold py-3.5 pink-glow transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {busy ? (
          <>
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
            Escribiendo la letra…
          </>
        ) : (
          <>
            <span className="material-symbols-outlined">auto_awesome</span>
            Generar letra
          </>
        )}
      </button>

      <p className="text-xs text-white/40 text-center">
        Tarda 10-30 segundos · Puedes editar la letra después · No cierres esta página
      </p>
    </div>
  );
}
