import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import { createCheckout, validateCoupon, checkSongStatus } from '../services/api';
import genres from '../config/genres';

// Preview settings
const PREVIEW_START = 15;
const PREVIEW_DURATION = 20;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

export default function ComparisonPage() {
  const { formData, songData, navigateTo } = useContext(AppContext);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState(null);
  const [currentTimes, setCurrentTimes] = useState({});
  const [selectedSongId, setSelectedSongId] = useState(null);
  const [purchaseBoth, setPurchaseBoth] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [isLoadingCoupon, setIsLoadingCoupon] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const audioRefs = useRef({});

  // Get genre display name
  const genreConfig = genres[formData.genre];
  const genreName = genreConfig?.name || formData.genre;

  // Pricing
  const singlePrice = 19.99;
  const bundlePrice = 29.99;
  const discount = couponApplied?.discount || 0;
  const finalSinglePrice = (singlePrice * (1 - discount / 100)).toFixed(2);
  const finalBundlePrice = (bundlePrice * (1 - discount / 100)).toFixed(2);

  // Load both songs - either from songData.firstSong or fetch via API
  useEffect(() => {
    async function loadSongs() {
      try {
        const loadedSongs = [];
        
        // If we have firstSong stored, use it
        if (songData?.firstSong) {
          loadedSongs.push({ 
            ...songData.firstSong, 
            version: 1 
          });
        }
        
        // Add current song (version 2)
        if (songData?.id) {
          loadedSongs.push({
            id: songData.id,
            sessionId: songData.sessionId,
            version: songData.version || 2,
            audioUrl: songData.audioUrl,
            previewUrl: songData.previewUrl,
            imageUrl: songData.imageUrl,
            lyrics: songData.lyrics,
            recipientName: formData.recipientName,
            genre: songData.genre,
            genreName: songData.genreName
          });
        }

        // If we only have one song and a sessionId, try to fetch the other
        if (loadedSongs.length === 1 && songData?.sessionId) {
          // Fetch session songs from API would go here
          // For now, just use what we have
        }

        setSongs(loadedSongs.sort((a, b) => (a.version || 1) - (b.version || 1)));
      } catch (error) {
        console.error('Error loading songs:', error);
      } finally {
        setLoading(false);
      }
    }

    loadSongs();
  }, [songData, formData]);

  // Handle audio playback with 20s preview
  const handlePlay = (songId) => {
    // Pause any currently playing
    Object.keys(audioRefs.current).forEach(id => {
      if (id !== songId && audioRefs.current[id]) {
        audioRefs.current[id].pause();
      }
    });

    const audio = audioRefs.current[songId];
    if (!audio) return;

    if (playingId === songId) {
      audio.pause();
      setPlayingId(null);
    } else {
      // Reset to preview start if outside window
      if (audio.currentTime < PREVIEW_START || audio.currentTime >= PREVIEW_END) {
        audio.currentTime = PREVIEW_START;
      }
      audio.play();
      setPlayingId(songId);
    }
  };

  const handleTimeUpdate = (songId, audio) => {
    const time = audio.currentTime;
    const previewTime = Math.max(0, time - PREVIEW_START);
    
    setCurrentTimes(prev => ({
      ...prev,
      [songId]: Math.min(previewTime, PREVIEW_DURATION)
    }));

    // Stop at preview end
    if (time >= PREVIEW_END) {
      audio.pause();
      audio.currentTime = PREVIEW_START;
      setPlayingId(null);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setIsLoadingCoupon(true);
    setCouponError('');
    
    try {
      const result = await validateCoupon(couponCode);
      setCouponApplied(result);
    } catch (error) {
      setCouponError('Código inválido o expirado');
      setCouponApplied(null);
    } finally {
      setIsLoadingCoupon(false);
    }
  };

  const handleCheckout = async () => {
    if (!selectedSongId && !purchaseBoth) {
      alert('Selecciona una canción o elige ambas');
      return;
    }

    setIsCheckingOut(true);
    try {
      const songIds = purchaseBoth 
        ? songs.map(s => s.id) 
        : [selectedSongId];

      const result = await createCheckout(
        songIds,
        formData.email,
        couponApplied?.code || null,
        purchaseBoth
      );
      
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Error al procesar el pago. Intenta de nuevo.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-forest text-white min-h-screen flex items-center justify-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-5xl text-gold animate-spin">progress_activity</span>
          <p className="mt-4 text-white/60">Cargando canciones...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-forest text-white antialiased min-h-screen">
      {/* Hidden audio elements */}
      {songs.map(song => (
        <audio
          key={song.id}
          ref={el => audioRefs.current[song.id] = el}
          src={song.audioUrl || song.previewUrl}
          preload="metadata"
          onLoadedMetadata={(e) => e.target.currentTime = PREVIEW_START}
          onTimeUpdate={(e) => handleTimeUpdate(song.id, e.target)}
          onEnded={() => setPlayingId(null)}
        />
      ))}

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-24 py-6 bg-forest/80 backdrop-blur-sm border-b border-white/5">
        <div onClick={() => navigateTo('landing')} className="cursor-pointer">
          <h2 className="font-display text-white text-xl font-medium tracking-tight">
            RegalosQueCantan
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-gold font-bold bg-white/5 px-4 py-2 rounded-full border border-gold/20">
          🎵 2 Versiones Disponibles
        </span>
      </header>

      {/* Main Content */}
      <main className="relative pt-28 pb-20 min-h-screen">
        <div className="container mx-auto px-6 max-w-5xl">
          {/* Title */}
          <div className="text-center mb-12">
            <h1 className="font-display text-white text-4xl md:text-5xl font-bold mb-4">
              ¡Elige tu favorita!
            </h1>
            <p className="text-gold/90 text-lg font-light max-w-md mx-auto">
              Escucha ambas versiones y selecciona la que más te guste, o llévate las dos con descuento.
            </p>
          </div>

          {/* Songs Grid */}
          <div className="grid md:grid-cols-2 gap-6 mb-10">
            {songs.map((song, index) => (
              <div 
                key={song.id}
                onClick={() => {
                  setSelectedSongId(song.id);
                  setPurchaseBoth(false);
                }}
                className={`relative bg-white/[0.03] backdrop-blur-xl border-2 rounded-2xl p-6 cursor-pointer transition-all ${
                  selectedSongId === song.id && !purchaseBoth
                    ? 'border-bougainvillea shadow-[0_0_30px_rgba(225,29,116,0.3)]' 
                    : 'border-white/10 hover:border-white/30'
                }`}
              >
                {/* Version Badge */}
                <div className="absolute top-4 right-4">
                  <span className="bg-gold/20 text-gold text-[10px] font-bold px-3 py-1 rounded-full uppercase">
                    Versión {song.version || index + 1}
                  </span>
                </div>

                {/* Selection indicator */}
                {selectedSongId === song.id && !purchaseBoth && (
                  <div className="absolute top-4 left-4">
                    <span className="material-symbols-outlined text-bougainvillea text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                      check_circle
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-4 mb-4 mt-4">
                  {/* Album Art */}
                  <div className="w-20 h-20 shrink-0">
                    {song.imageUrl ? (
                      <img 
                        src={song.imageUrl} 
                        alt="Album Art"
                        className="w-full h-full object-cover rounded-lg border border-white/10"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-gold/30 to-bougainvillea/30 rounded-lg flex items-center justify-center">
                        <span className="material-symbols-outlined text-3xl text-white/40">music_note</span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white">
                      Para {formData.recipientName}
                    </h3>
                    <p className="text-gold/80 text-xs uppercase tracking-widest">
                      {genreName}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gold rounded-full transition-all"
                      style={{ width: `${((currentTimes[song.id] || 0) / PREVIEW_DURATION) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/40 font-mono">
                    {formatTime(currentTimes[song.id] || 0)} / 0:20
                  </span>
                </div>

                {/* Play Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlay(song.id);
                  }}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {playingId === song.id ? 'pause' : 'play_arrow'}
                  </span>
                  <span className="text-sm font-medium">
                    {playingId === song.id ? 'Pausar' : 'Escuchar Preview'}
                  </span>
                </button>
              </div>
            ))}
          </div>

          {/* Bundle Option */}
          {songs.length >= 2 && (
            <div 
              onClick={() => {
                setPurchaseBoth(true);
                setSelectedSongId(null);
              }}
              className={`relative bg-gradient-to-r from-gold/10 to-bougainvillea/10 backdrop-blur-xl border-2 rounded-2xl p-6 cursor-pointer transition-all mb-10 ${
                purchaseBoth 
                  ? 'border-gold shadow-[0_0_30px_rgba(212,175,55,0.3)]' 
                  : 'border-white/10 hover:border-gold/50'
              }`}
            >
              {purchaseBoth && (
                <div className="absolute top-4 left-4">
                  <span className="material-symbols-outlined text-gold text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    check_circle
                  </span>
                </div>
              )}
              
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gold/20 rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-gold text-2xl">library_music</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">🎁 ¡Llévate ambas versiones!</h3>
                    <p className="text-white/60 text-sm">Perfecto para compartir con más personas o tener opciones</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <span className="text-white/40 line-through">${(singlePrice * 2).toFixed(2)}</span>
                    <span className="text-gold text-2xl font-bold">${couponApplied ? finalBundlePrice : bundlePrice}</span>
                  </div>
                  <span className="text-green-400 text-xs font-bold">AHORRA ${(singlePrice * 2 - bundlePrice).toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Pricing Summary */}
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-6 mb-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
              <div>
                <p className="text-white/60 text-sm mb-1">
                  {purchaseBoth ? 'Paquete de 2 canciones' : selectedSongId ? 'Canción seleccionada' : 'Selecciona una opción arriba'}
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-white text-3xl font-bold">
                    ${purchaseBoth 
                      ? (couponApplied ? finalBundlePrice : bundlePrice)
                      : (couponApplied ? finalSinglePrice : singlePrice.toFixed(2))
                    }
                  </span>
                  {(selectedSongId || purchaseBoth) && (
                    <span className="bg-green-500 text-white text-[10px] font-black px-2 py-0.5 rounded">
                      {purchaseBoth ? '25% OFF' : '33% OFF'}
                    </span>
                  )}
                </div>
              </div>

              {/* Coupon */}
              <div className="w-full md:w-auto">
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Código de Cupón"
                    className="bg-white/5 border border-white/10 rounded-full py-3 px-6 text-sm w-full md:w-56 placeholder:text-white/20 text-white"
                    disabled={!!couponApplied}
                  />
                  {!couponApplied ? (
                    <button 
                      onClick={handleApplyCoupon}
                      disabled={isLoadingCoupon}
                      className="absolute right-2 text-gold text-xs font-bold px-3 py-2 hover:text-white transition-colors"
                    >
                      {isLoadingCoupon ? '...' : 'Aplicar'}
                    </button>
                  ) : (
                    <span className="absolute right-4 text-green-400 material-symbols-outlined text-sm">check_circle</span>
                  )}
                </div>
                {couponError && <p className="text-red-400 text-xs mt-1">{couponError}</p>}
                {couponApplied && <p className="text-green-400 text-xs mt-1">-{couponApplied.discount}% aplicado</p>}
              </div>
            </div>

            {/* Checkout Button */}
            <button
              onClick={handleCheckout}
              disabled={isCheckingOut || (!selectedSongId && !purchaseBoth)}
              className="w-full py-5 bg-bougainvillea hover:bg-bougainvillea/90 disabled:bg-white/10 disabled:cursor-not-allowed rounded-xl text-white text-lg font-bold transition-all shadow-[0_0_25px_rgba(225,29,116,0.4)] disabled:shadow-none flex items-center justify-center gap-3"
            >
              {isCheckingOut ? (
                <>
                  <span className="material-symbols-outlined animate-spin">progress_activity</span>
                  Procesando...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">credit_card</span>
                  {purchaseBoth ? 'Comprar Ambas Canciones' : selectedSongId ? 'Comprar Canción Seleccionada' : 'Selecciona una opción'}
                </>
              )}
            </button>

            {/* Trust Badges */}
            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="flex items-center gap-6 opacity-50">
                <span className="text-white/60 text-sm font-bold">PayPal</span>
                <span className="text-white/60 text-sm font-bold">VISA</span>
                <span className="text-white/60 text-sm font-bold">Mastercard</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 border border-gold/20 rounded-lg bg-gold/5">
                <span className="material-symbols-outlined text-gold text-xs">verified_user</span>
                <span className="text-gold text-[10px] font-bold uppercase tracking-widest">
                  Garantía de Satisfacción
                </span>
              </div>
            </div>
          </div>

          {/* Back Link */}
          <div className="text-center">
            <button
              onClick={() => navigateTo('preview')}
              className="text-white/40 hover:text-white text-sm uppercase tracking-widest flex items-center justify-center gap-2 mx-auto"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Volver a la vista individual
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-background-dark py-10 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="font-display text-white/30 text-lg">RegalosQueCantan</div>
          <div className="flex gap-8">
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Ayuda</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Privacidad</a>
          </div>
          <p className="text-white/20 text-[10px] uppercase tracking-widest">© 2024 • Hecho con alma en México.</p>
        </div>
      </footer>
    </div>
  );
}
