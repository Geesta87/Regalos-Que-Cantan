import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import { createCheckout, checkSongStatus } from '../services/api';
import { trackStep } from '../services/tracking';

// Dedicated checkout for /paquete buyers (song + Animado bundle, or song-only).
// Replaces /comparison for this funnel ONLY: no $9.99 video addon, no karaoke,
// no coupons, no gift-SMS — one product, one price. Regular customers never land here.
// Look & feel matches PaqueteLanding (dark #0a0806 + gold), not the neon checkout.

const PREVIEW_START = 10;
const PREVIEW_DURATION = 40;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

const SONG_PRICE = 29.99;
const BOTH_VERSIONS_UPGRADE = 10; // "ambas versiones" add-on
const VIDEO_PRICE = 29;

const fmt = (n) => `$${n.toFixed(2)}`;

// Same genre album art the regular comparison page shows (consistent brand look);
// falls back to the AI-generated per-song cover, then a music note.
const getGenreImagePath = (genre) => (genre ? `/images/album-art/${genre}.jpg` : null);

export default function PaqueteCheckout() {
  const context = useContext(AppContext);
  const { formData = {}, songData = {}, navigateTo = () => {} } = context || {};

  const withVideo = formData?.wantsAnimadoVideo === true;

  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSongId, setSelectedSongId] = useState(null);
  const [bothVersions, setBothVersions] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutEmail, setCheckoutEmail] = useState('');

  // Audio preview state
  const audioRefs = useRef({});
  const stopTimerRef = useRef(null);
  const [playingId, setPlayingId] = useState(null);
  const [currentTimes, setCurrentTimes] = useState({});

  // Song 2 background polling (fast funnel hands us song2PendingId)
  const [song2Loading, setSong2Loading] = useState(false);
  const song2PollRef = useRef(null);
  const song2Started = useRef(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    trackStep('paquete_checkout', { with_video: withVideo });
  }, [withVideo]);

  // ── Load songs: songData first, localStorage recovery second ──
  useEffect(() => {
    const norm = (s, version) => ({
      id: s.id,
      version,
      audioUrl: s.audio_url || s.audioUrl,
      previewUrl: s.preview_url || s.previewUrl || s.audio_url || s.audioUrl,
      imageUrl: s.image_url || s.imageUrl,
      genre: s.genre,
    });
    try {
      const loaded = [];
      if (songData?.song1) {
        loaded.push(norm(songData.song1, 1));
        if (songData?.song2) loaded.push(norm(songData.song2, 2));
      }
      if (loaded.length > 0) {
        setSongs(loaded);
        setSelectedSongId(loaded[0].id);
        setLoading(false);
        localStorage.setItem('rqc_comparison_songs', JSON.stringify(loaded.map((s) => s.id)));
        return;
      }
      // Recovery after refresh: re-fetch by saved ids
      const saved = localStorage.getItem('rqc_comparison_songs');
      const ids = saved ? JSON.parse(saved) : [];
      if (Array.isArray(ids) && ids.length > 0) {
        Promise.all(ids.map((id) => checkSongStatus(id).catch(() => null))).then((results) => {
          const recovered = results
            .filter((r) => r && r.song)
            .map((r, i) => norm(r.song, i + 1));
          if (recovered.length > 0) {
            setSongs(recovered);
            setSelectedSongId(recovered[0].id);
          } else {
            setError('No pudimos cargar tu canción. Escríbenos por WhatsApp y te ayudamos.');
          }
          setLoading(false);
        });
        return;
      }
      setError('No hay canciones disponibles.');
      setLoading(false);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, [songData]);

  // ── Poll for song 2 when it's still generating ──
  useEffect(() => {
    const pendingId = songData?.song2PendingId;
    if (!pendingId || song2Started.current || loading || songs.length === 0 || songs.length >= 2) return;
    song2Started.current = true;
    setSong2Loading(true);
    const poll = async () => {
      try {
        const status = await checkSongStatus(pendingId);
        if (status.status === 'completed' && status.song) {
          clearInterval(song2PollRef.current);
          const s = status.song;
          setSongs((prev) => {
            const updated = [...prev, {
              id: s.id, version: 2,
              audioUrl: s.audio_url,
              previewUrl: s.preview_url || s.audio_url,
              imageUrl: s.image_url,
            }].sort((a, b) => (a.version || 1) - (b.version || 1));
            localStorage.setItem('rqc_comparison_songs', JSON.stringify(updated.map((x) => x.id)));
            return updated;
          });
          setSong2Loading(false);
        } else if (status.status === 'failed') {
          clearInterval(song2PollRef.current);
          setSong2Loading(false);
        }
      } catch { /* keep polling */ }
    };
    poll();
    song2PollRef.current = setInterval(poll, 8000);
    return () => clearInterval(song2PollRef.current);
  }, [songData, loading, songs.length]);

  useEffect(() => () => {
    clearTimeout(stopTimerRef.current);
    Object.values(audioRefs.current).forEach((a) => { try { a.pause(); } catch { /* ignore */ } });
  }, []);

  // ── 40s preview playback ──
  const handlePlay = (songId) => {
    const audio = audioRefs.current[songId];
    if (!audio) return;
    if (playingId === songId) {
      audio.pause();
      setPlayingId(null);
      clearTimeout(stopTimerRef.current);
      return;
    }
    Object.entries(audioRefs.current).forEach(([id, a]) => { if (id !== songId) try { a.pause(); } catch { /* ignore */ } });
    clearTimeout(stopTimerRef.current);
    if (audio.currentTime < PREVIEW_START || audio.currentTime >= PREVIEW_END) {
      audio.currentTime = PREVIEW_START;
    }
    audio.play().catch(() => {});
    setPlayingId(songId);
    stopTimerRef.current = setTimeout(() => {
      try { audio.pause(); audio.currentTime = PREVIEW_START; } catch { /* ignore */ }
      setPlayingId(null);
      setCurrentTimes((p) => ({ ...p, [songId]: PREVIEW_DURATION }));
    }, (PREVIEW_END - audio.currentTime) * 1000 + 300);
  };

  const onTimeUpdate = (songId) => {
    const audio = audioRefs.current[songId];
    if (!audio) return;
    setCurrentTimes((p) => ({ ...p, [songId]: Math.max(0, Math.min(PREVIEW_DURATION, audio.currentTime - PREVIEW_START)) }));
    if (audio.currentTime >= PREVIEW_END) {
      audio.pause();
      audio.currentTime = PREVIEW_START;
      setPlayingId(null);
    }
  };

  // ── Pricing ──
  const songTotal = bothVersions ? SONG_PRICE + BOTH_VERSIONS_UPGRADE : SONG_PRICE;
  const total = songTotal + (withVideo ? VIDEO_PRICE : 0);

  // ── Checkout ──
  const email = formData?.email || checkoutEmail;
  const handleCheckout = async () => {
    if (checkoutLoading) return;
    if (!email) return;
    const target = selectedSongId || songs[0]?.id;
    if (!target) return;
    setCheckoutLoading(true);
    try {
      const songIds = bothVersions && songs.length >= 2 ? songs.map((s) => s.id) : [target];
      const animadoCount = withVideo ? 1 : 0;
      const animadoIds = withVideo ? [target] : [];
      trackStep('paquete_checkout_pay', { with_video: withVideo, both_versions: bothVersions, value: total });
      const result = await createCheckout(
        songIds, email, null, bothVersions && songs.length >= 2, '',
        false, 0, false, [], animadoCount, animadoIds, null, false
      );
      if (result?.url) {
        window.location.href = result.url;
      } else {
        throw new Error('No checkout URL');
      }
    } catch (e) {
      setCheckoutLoading(false);
      setError('No pudimos iniciar el pago. Intenta de nuevo o escríbenos por WhatsApp.');
    }
  };

  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const recipient = formData?.recipientName || '';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0806] flex items-center justify-center text-white">
        <div className="text-center px-6">
          <div className="text-4xl mb-4 animate-pulse">🎁</div>
          <p className="text-white/70">Preparando tu regalo…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0806] text-white pb-28">
      {/* Header */}
      <header className="px-6 pt-8 pb-2 text-center">
        <p className="text-amber-400/90 text-xs font-bold tracking-[0.2em] uppercase mb-2">🎁 Tu regalo está listo</p>
        <h1 className="text-2xl md:text-3xl font-extrabold leading-tight">
          {recipient ? <>La canción de <span className="text-amber-300">{recipient}</span></> : 'Tu canción'} ya suena así
        </h1>
        <p className="text-white/50 text-sm mt-2">Escucha las 2 versiones y elige tu favorita — muestras de 40 segundos.</p>
      </header>

      {error && (
        <div className="mx-6 my-4 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {/* Song versions */}
      <section className="px-5 mt-6 grid gap-4 md:grid-cols-2 md:max-w-3xl md:mx-auto">
        {songs.map((song) => {
          const isSel = selectedSongId === song.id && !bothVersions;
          const isPlaying = playingId === song.id;
          const t = currentTimes[song.id] || 0;
          return (
            <button
              key={song.id}
              onClick={() => { setSelectedSongId(song.id); setBothVersions(false); }}
              className={`text-left rounded-2xl border-2 p-4 transition-all ${isSel && !bothVersions ? 'border-amber-400 bg-amber-400/5' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${isSel ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70'}`}>
                  Versión {song.version}
                </span>
                {isSel && <span className="text-amber-300 text-lg">✓</span>}
              </div>
              {(() => {
                const imgSrc = getGenreImagePath(song.genre || formData?.genre) || song.imageUrl;
                return imgSrc ? (
                  <img
                    src={imgSrc}
                    alt={`Versión ${song.version}`}
                    className="w-full aspect-square object-cover rounded-xl mb-3"
                    onError={(e) => {
                      // static genre art missing → fall back to the song's AI cover
                      if (song.imageUrl && e.target.src !== song.imageUrl) e.target.src = song.imageUrl;
                      else e.target.style.display = 'none';
                    }}
                  />
                ) : null;
              })()}
              <audio
                ref={(el) => { if (el) audioRefs.current[song.id] = el; }}
                src={song.previewUrl || song.audioUrl}
                preload="metadata"
                onTimeUpdate={() => onTimeUpdate(song.id)}
              />
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); handlePlay(song.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handlePlay(song.id); } }}
                className={`block w-full text-center rounded-xl py-3 font-bold transition-colors ${isPlaying ? 'bg-amber-400 text-black' : 'bg-white/10 hover:bg-white/20 text-white'}`}
              >
                {isPlaying ? '❚❚ Pausar' : '▶ Escuchar'}
              </span>
              <div className="flex justify-between text-[11px] text-white/40 mt-2">
                <span>{mmss(t)} / 0:40</span>
              </div>
            </button>
          );
        })}
        {song2Loading && (
          <div className="rounded-2xl border-2 border-dashed border-white/10 p-6 flex flex-col items-center justify-center text-white/40 text-sm min-h-[200px]">
            <div className="animate-spin text-2xl mb-3">🎵</div>
            Versión 2 en camino…
          </div>
        )}
      </section>

      {/* Both versions add-on */}
      {songs.length >= 2 && (
        <section className="px-5 mt-4 md:max-w-3xl md:mx-auto">
          <button
            onClick={() => setBothVersions((v) => !v)}
            className={`w-full rounded-2xl border-2 px-4 py-4 flex items-center justify-between transition-all ${bothVersions ? 'border-amber-400 bg-amber-400/5' : 'border-white/10 bg-white/[0.03]'}`}
          >
            <span className="text-left">
              <span className="block font-bold text-sm">🎁 Llévate ambas versiones</span>
              <span className="block text-white/50 text-xs mt-0.5">Las 2 canciones completas, tuyas para siempre</span>
            </span>
            <span className="text-amber-300 font-extrabold whitespace-nowrap ml-3">+ ${BOTH_VERSIONS_UPGRADE}</span>
          </button>
        </section>
      )}

      {/* Order summary */}
      <section className="px-5 mt-6 md:max-w-3xl md:mx-auto">
        <div className="rounded-2xl border border-amber-400/50 bg-amber-400/[0.06] p-5">
          <p className="inline-block bg-amber-400 text-black text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full mb-4">
            {withVideo ? '🎁 El regalo completo' : '🎵 Tu canción'}
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/90">🎵 Canción personalizada{bothVersions ? ' · ambas versiones' : ''}</span>
              <span className="font-bold">{fmt(songTotal)}</span>
            </div>
            {withVideo && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/90">🎬 Video animado estilo Pixar</span>
                <span className="font-bold">{fmt(VIDEO_PRICE)}</span>
              </div>
            )}
          </div>
          <div className="border-t border-white/10 mt-4 pt-4 flex items-center justify-between">
            <span className="font-extrabold">Total</span>
            <span className="text-amber-300 text-2xl font-extrabold">{fmt(total)}</span>
          </div>
          {withVideo && (
            <p className="text-white/40 text-[11px] mt-3">Después del pago subes sus fotos y creamos el video animado con su historia.</p>
          )}
        </div>

        {!formData?.email && (
          <input
            type="email"
            value={checkoutEmail}
            onChange={(e) => setCheckoutEmail(e.target.value)}
            placeholder="📧 tu@email.com"
            className="w-full mt-4 rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-amber-400"
          />
        )}
      </section>

      {/* Sticky pay button */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-[#0a0806] via-[#0a0806]/95 to-transparent px-5 pt-6 pb-5">
        <div className="md:max-w-3xl md:mx-auto">
          <button
            onClick={handleCheckout}
            disabled={checkoutLoading || !email || (!selectedSongId && !bothVersions)}
            className="w-full rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 text-black font-extrabold text-lg py-4 shadow-[0_0_30px_rgba(245,158,11,0.35)] disabled:opacity-50 transition-opacity"
          >
            {checkoutLoading ? 'Un momento…' : `💳 Pagar ${fmt(total)}`}
          </button>
          <p className="text-center text-white/35 text-[11px] mt-2">🔒 Pago seguro con Stripe · Entrega digital inmediata</p>
        </div>
      </div>
    </div>
  );
}
