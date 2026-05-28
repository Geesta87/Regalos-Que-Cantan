// src/components/clonamivoz/SongResult.jsx
//
// Renders the two finished Suno variants for the Clone Mi Voz tier.
// Each version gets its own audio player + download link. The grouping
// header celebrates and shows the resolved title.
//
// Suno typically returns 2 variants per generation. We render however
// many came back (1 or 2) and degrade gracefully if zero (the parent's
// polling loop should already have surfaced an error in that case).

import React from 'react';

export default function SongResult({ title, audioUrls = [], onCreateAnother }) {
  if (!audioUrls || audioUrls.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5 animate-fadeIn">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 mb-3">
          <span className="material-symbols-outlined text-emerald-400 text-5xl">
            celebration
          </span>
        </div>
        <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mb-1">
          ¡Tu canción está lista!
        </h2>
        {title && (
          <p className="text-white/70 text-lg italic font-display">"{title}"</p>
        )}
        <p className="text-white/60 mt-1">
          Tenemos {audioUrls.length} {audioUrls.length === 1 ? 'versión' : 'versiones'}. Escúchalas.
        </p>
      </div>

      {audioUrls.map((url, i) => (
        <div
          key={`${i}-${url}`}
          className="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-xl font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-bougainvillea">
                  music_note
                </span>
                Versión {i + 1}
              </div>
            </div>
            <a
              href={url}
              download
              className="text-sm bg-bougainvillea hover:brightness-110 text-white font-bold px-4 py-2 rounded-lg transition flex items-center gap-1"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="material-symbols-outlined text-base">download</span>
              Descargar
            </a>
          </div>
          <audio controls src={url} className="w-full" />
        </div>
      ))}

      {onCreateAnother && (
        <button
          type="button"
          onClick={onCreateAnother}
          className="w-full rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-bougainvillea/30 text-white font-semibold py-3 transition flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add</span>
          Crear otra canción
        </button>
      )}
    </section>
  );
}
