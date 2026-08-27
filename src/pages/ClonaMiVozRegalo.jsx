// src/pages/ClonaMiVozRegalo.jsx
//
// Recipient-facing GIFT PAGE for a finished Clone Mi Voz song (/regalo?id=<uuid>).
//
// Why (2026-08-27): the buyer's deliverable used to end at two bare audio
// players. This page is the shareable moment — a styled cover, the
// dedication, the song — and every share advertises the product (the CTA
// at the bottom points new visitors at /clonamivoz).
//
// Data comes from the existing cloned-voice-status endpoint (anon JWT, the
// id is an unguessable UUID). Only 'success' rows render the full gift;
// anything else shows a tasteful "still in the works" screen. No buyer
// controls here — this page is for the RECIPIENT.

import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { getClonedVoiceStatus } from '../services/clonamivoz';
import { GENRES } from '../components/clonamivoz/genres';

// CSS cover art: gradient per genre family (no per-song image generation
// needed — brand-palette gradients + the genre emoji read as designed art).
const COVER_GRADIENTS = {
  romantico: 'from-rose-500/80 via-pink-600/70 to-fuchsia-700/80',
  balada: 'from-indigo-500/80 via-purple-600/70 to-fuchsia-700/80',
  banda: 'from-amber-500/80 via-orange-600/70 to-red-700/80',
  corrido: 'from-stone-500/80 via-amber-700/70 to-stone-800/80',
  ranchera: 'from-red-500/80 via-rose-700/70 to-purple-800/80',
  mariachi: 'from-emerald-500/80 via-teal-600/70 to-cyan-700/80',
  cumbia: 'from-yellow-400/80 via-orange-500/70 to-pink-600/80',
  norteno: 'from-orange-400/80 via-amber-600/70 to-yellow-700/80',
  bolero: 'from-rose-400/80 via-red-600/70 to-rose-900/80',
  cristiana: 'from-sky-400/80 via-blue-600/70 to-indigo-800/80',
  pop_ballad_en: 'from-violet-500/80 via-purple-600/70 to-indigo-700/80',
  country_en: 'from-amber-400/80 via-orange-600/70 to-amber-800/80',
  rnb_soul_en: 'from-purple-500/80 via-fuchsia-600/70 to-rose-700/80',
  acoustic_singer_en: 'from-teal-400/80 via-emerald-600/70 to-green-800/80',
};

export default function ClonaMiVozRegalo() {
  const [state, setState] = useState('loading'); // loading | notfound | pending | ready
  const [song, setSong] = useState(null);
  const [copied, setCopied] = useState(false);

  const songId = new URLSearchParams(window.location.search).get('id');

  useEffect(() => {
    if (!songId) {
      setState('notfound');
      return;
    }
    let alive = true;
    getClonedVoiceStatus(songId)
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setState('notfound');
          return;
        }
        setSong(res);
        setState(res.status === 'success' && (res.audio_urls || []).length > 0 ? 'ready' : 'pending');
      })
      .catch(() => { if (alive) setState('notfound'); });
    return () => { alive = false; };
  }, [songId]);

  const genre = GENRES.find((g) => g.slug === song?.genre_slug);
  const gradient = COVER_GRADIENTS[song?.genre_slug] || COVER_GRADIENTS.romantico;
  const recipient = song?.recipient_name || '';
  const pageUrl = `${window.location.origin}/regalo?id=${songId}`;
  const shareText = recipient
    ? `🎁🎶 Una canción hecha especialmente para ${recipient} — escúchala aquí: ${pageUrl}`
    : `🎁🎶 Te hicieron una canción — escúchala aquí: ${pageUrl}`;

  function copyLink() {
    try {
      navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* older browsers — non-fatal */ }
  }

  return (
    <div className="min-h-screen bg-landing-bg text-white font-body">
      <Helmet>
        <title>{recipient ? `Una canción para ${recipient}` : 'Un regalo que canta'} · RegalosQueCantan</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-16 space-y-8">
        {state === 'loading' && (
          <div className="text-center py-24 text-white/50">
            <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
          </div>
        )}

        {state === 'notfound' && (
          <div className="text-center py-24 space-y-3">
            <div className="text-5xl">🎁</div>
            <h1 className="font-display text-2xl font-bold">No encontramos este regalo</h1>
            <p className="text-white/60 text-sm">Revisa que el enlace esté completo, o pide que te lo reenvíen.</p>
          </div>
        )}

        {state === 'pending' && (
          <div className="text-center py-24 space-y-3">
            <div className="text-5xl">🎶</div>
            <h1 className="font-display text-2xl font-bold">Este regalo aún se está preparando</h1>
            <p className="text-white/60 text-sm">Vuelve a abrir el enlace en unos minutos.</p>
          </div>
        )}

        {state === 'ready' && song && (
          <>
            {/* Cover */}
            <div className={`relative rounded-3xl bg-gradient-to-br ${gradient} p-10 sm:p-14 text-center overflow-hidden shadow-2xl`}>
              <div className="absolute inset-0 bg-black/25" />
              <div className="relative space-y-4">
                <div className="text-xs uppercase tracking-[0.3em] text-white/80 font-semibold">
                  Un regalo que canta
                </div>
                <div className="text-6xl drop-shadow-lg">{genre?.emoji || '🎶'}</div>
                {recipient && (
                  <div className="font-display text-4xl sm:text-5xl font-bold drop-shadow">
                    Para {recipient}
                  </div>
                )}
                {song.title && (
                  <div className="text-white/90 italic font-display text-lg">“{song.title}”</div>
                )}
                <div className="text-xs text-white/70">
                  Cantada con la voz de quien te quiere{genre ? ` · ${genre.labelEs}` : ''}
                </div>
              </div>
            </div>

            {/* Players */}
            <div className="space-y-4">
              {(song.audio_urls || []).map((url, i) => (
                <div key={`${i}-${url}`} className="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/15 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-display text-lg font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-bougainvillea">music_note</span>
                      {song.audio_urls.length > 1 ? `Versión ${i + 1}` : 'Tu canción'}
                    </div>
                    <a
                      href={url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm bg-white/10 hover:bg-white/20 text-white font-semibold px-3.5 py-2 rounded-lg transition flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-base">download</span>
                      Guardar
                    </a>
                  </div>
                  <audio controls preload="none" src={url} className="w-full" />
                </div>
              ))}
            </div>

            {/* Lyrics */}
            {song.lyrics && (
              <details className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white/80 flex items-center gap-2">
                  <span className="material-symbols-outlined text-bougainvillea text-base">lyrics</span>
                  Ver la letra
                </summary>
                <pre className="mt-3 whitespace-pre-wrap text-sm text-white/70 font-body leading-relaxed">
                  {song.lyrics.replace(/\[[^\]]*\]\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}
                </pre>
              </details>
            )}

            {/* Share */}
            <div className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 space-y-3">
              <div className="text-sm font-semibold text-white/85">Comparte este regalo</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center rounded-xl bg-[#25D366]/90 hover:bg-[#25D366] text-white font-bold py-3 transition"
                >
                  Compartir por WhatsApp
                </a>
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex-1 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold py-3 transition"
                >
                  {copied ? '✓ Enlace copiado' : 'Copiar enlace'}
                </button>
              </div>
            </div>

            {/* Viral CTA */}
            <div className="text-center rounded-3xl bg-gradient-to-br from-bougainvillea/15 to-[#d40b6e]/15 border border-bougainvillea/30 p-6 space-y-3">
              <div className="font-display text-xl font-bold">¿Te gustó?</div>
              <p className="text-sm text-white/70">
                Graba tu propia voz y regálale una canción única a alguien especial.
              </p>
              <a
                href="/clonamivoz"
                className="inline-flex items-center gap-2 bg-gradient-to-br from-bougainvillea to-[#d40b6e] hover:brightness-110 text-white font-bold px-8 py-3 rounded-full pink-glow transition"
              >
                <span className="material-symbols-outlined">mic</span>
                Crear una canción con MI voz
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
