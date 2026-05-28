// src/components/clonamivoz/CoachingPanel.jsx
//
// Collapsible "how do I record?" coaching panel for /clonamivoz.
// Shown under the recorder for customers who don't want to read the script
// and need an alternative (hum, freestyle "la la la," etc).
//
// The warning about Cielito Lindo / Las Mañanitas is intentional: Suno's
// copyright filter rejected those during the test harness's first runs.
// Keep that callout. Ported JSX from
// suno-voice-clone-test/web-app/components/CoachingPanel.tsx.

import React, { useState } from 'react';

export default function CoachingPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <span className="font-semibold text-bougainvillea flex items-center gap-2">
          <span className="material-symbols-outlined">help</span>
          ¿Necesitas ayuda? Mira cómo grabar
        </span>
        <span
          className="material-symbols-outlined text-bougainvillea/70 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)' }}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm animate-fadeIn">
          <p className="text-white/80">
            No necesitas saber cantar bien. Nuestra IA solo necesita escuchar tu voz.
            Escoge la opción más fácil para ti:
          </p>

          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="font-semibold text-white mb-1 flex items-center gap-2">
              <span className="material-symbols-outlined text-bougainvillea text-base">
                music_note
              </span>
              Opción 1: Tararea una melodía inventada{' '}
              <span className="text-bougainvillea text-xs uppercase tracking-wider">la más fácil</span>
            </div>
            <p className="text-white/70">
              Tararea cualquier melodía que se te ocurra por 45-60 segundos. Inventa
              la melodía sobre la marcha. Solo sigue tarareando con la boca cerrada.
            </p>
            <div className="mt-2 bg-amber-500/10 border-l-4 border-amber-500 px-3 py-2 text-xs text-amber-200">
              <strong>⚠ No tararees</strong> Cielito Lindo, Las Mañanitas, ni canciones famosas — la IA las detecta como copyright y rechaza la grabación.
            </div>
          </div>

          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="font-semibold text-white mb-1 flex items-center gap-2">
              <span className="material-symbols-outlined text-bougainvillea text-base">
                menu_book
              </span>
              Opción 2: Lee el script de arriba
            </div>
            <p className="text-white/70 italic">
              Léelo despacio, con melodía. Cántalo o casi-cántalo. Tómate tu tiempo.
            </p>
            <p className="text-white/50 text-xs mt-2">
              El script de 90 segundos está diseñado para capturar todos los sonidos
              de tu voz — lo abres arriba del botón de grabar.
            </p>
          </div>

          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="font-semibold text-white mb-1 flex items-center gap-2">
              <span className="material-symbols-outlined text-bougainvillea text-base">
                graphic_eq
              </span>
              Opción 3: Inventa palabras "la la la"
            </div>
            <p className="text-white/70">
              Canta "la la la, da da da" con una melodía que tú inventes. Sin palabras reales, sin tonada conocida.
            </p>
          </div>

          <div className="bg-bougainvillea/10 rounded-xl border border-bougainvillea/30 p-3 text-xs text-bougainvillea/90 flex flex-wrap gap-x-4 gap-y-1">
            <span>✓ Habitación tranquila</span>
            <span>✓ Cerca del micrófono</span>
            <span>✓ Una toma es suficiente</span>
          </div>
        </div>
      )}
    </div>
  );
}
