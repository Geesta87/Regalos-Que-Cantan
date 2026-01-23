import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import { createCheckout, validateCoupon } from '../services/api';
import genres from '../config/genres';

// Preview settings
const PREVIEW_START = 15;
const PREVIEW_DURATION = 20;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

export default function ComparisonPage() {
  const { formData, songData, setSongData, navigateTo } = useContext(AppContext);
  
  // Songs state
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Audio state
  const [playingId, setPlayingId] = useState(null);
  const [currentTimes, setCurrentTimes] = useState({});
  const [previewEnded, setPreviewEnded] = useState({});
  
  // Selection state
  const [selectedSongId, setSelectedSongId] = useState(null);
  const [purchaseBoth, setPurchaseBoth] = useState(false);
  
  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [isLoadingCoupon, setIsLoadingCoupon] = useState(false);
  
  // Checkout state
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  
  const audioRefs = useRef({});

  // Get genre display name
  const genreConfig = genres[formData.genre];
  const genreName = genreConfig?.name || formData.genre;
  const subGenreName = formData.subGenre && genreConfig?.subGenres?.[formData.subGenre]?.name;

  // Pricing
  const singlePrice = 19.99;
  const bundlePrice = 29.99;
  const bundleSavings = (singlePrice * 2) - bundlePrice;
  const discount = couponApplied?.discount || 0;
  const isFree = couponApplied?.free || false;
  const finalSinglePrice = isFree ? 0 : (singlePrice * (1 - discount / 100)).toFixed(2);
  const finalBundlePrice = isFree ? 0 : (bundlePrice * (1 - discount / 100)).toFixed(2);

  // Load songs from songData
  useEffect(() => {
    async function loadSongs() {
      try {
        console.log('📦 ComparisonPage received songData:', songData);
        
        const loadedSongs = [];
        
        // Check if we have songs array (new format)
        if (songData?.songs && Array.isArray(songData.songs) && songData.songs.length > 0) {
          console.log('✅ Found songs array:', songData.songs);
          loadedSongs.push(...songData.songs);
        } 
        // Check for song1/song2 format
        else if (songData?.song1) {
          console.log('✅ Found song1/song2 format');
          loadedSongs.push({ ...songData.song1, version: 1 });
          if (songData?.song2) {
            loadedSongs.push({ ...songData.song2, version: 2 });
          }
        }
        // Fallback - use songData itself as a single song
        else if (songData?.id) {
          console.log('✅ Using songData as single song');
          loadedSongs.push({
            id: songData.id,
            version: 1,
            audioUrl: songData.audioUrl,
            previewUrl: songData.previewUrl,
            imageUrl: songData.imageUrl,
            lyrics: songData.lyrics
          });
        }

        console.log('📋 Loaded songs:', loadedSongs);
        
        if (loadedSongs.length === 0) {
          console.error('❌ No songs found in songData!');
        }

        setSongs(loadedSongs.sort((a, b) => (a.version || 1) - (b.version || 1)));
      } catch (error) {
        console.error('Error loading songs:', error);
      } finally {
        setLoading(false);
      }
    }

    if (songData) {
      loadSongs();
    } else {
      console.warn('⚠️ No songData available');
      setLoading(false);
    }
  }, [songData]);

  // Audio playback handlers
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
      // Reset to preview start if needed
      if (audio.currentTime < PREVIEW_START || audio.currentTime >= PREVIEW_END) {
        audio.currentTime = PREVIEW_START;
        setPreviewEnded(prev => ({ ...prev, [songId]: false }));
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
      setPreviewEnded(prev => ({ ...prev, [songId]: true }));
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Coupon handling with GRATIS100 support
  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setIsLoadingCoupon(true);
    setCouponError('');
    
    // Check for GRATIS100 locally
    if (couponCode.trim().toUpperCase() === 'GRATIS100') {
      setCouponApplied({ 
        code: 'GRATIS100', 
        discount: 100,
        free: true 
      });
      setCouponError('');
      setIsLoadingCoupon(false);
      return;
    }
    
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

  // Checkout handling
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
      
      const codeToSend = couponApplied?.code || couponCode.trim().toUpperCase() || null;

      const result = await createCheckout(
        songIds,
        formData.email,
        codeToSend,
        purchaseBoth
      );
      
      // Handle free coupon
      if (result.free && result.success) {
        setSongData(prev => ({
          ...prev,
          paid: true,
          selectedSongIds: songIds
        }));
        navigateTo('success');
      } else if (result.url) {
        window.location.href = result.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Error al procesar el pago. Intenta de nuevo.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Select a single song
  const selectSong = (songId) => {
    setSelectedSongId(songId);
    setPurchaseBoth(false);
  };

  // Select both songs
  const selectBoth = () => {
    setPurchaseBoth(true);
    setSelectedSongId(null);
  };

  if (loading) {
    return (
      <div className="bg-forest text-white min-h-screen flex items-center justify-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-5xl text-gold animate-spin">progress_activity</span>
          <p className="mt-4 text-white/60">Cargando tus canciones...</p>
        </div>
      </div>
    );
  }

  // Fallback if no songs loaded
  if (!songs || songs.length === 0) {
    return (
      <div className="bg-forest text-white min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <span className="material-symbols-outlined text-5xl text-red-400 mb-4">error</span>
          <h2 className="text-2xl font-bold mb-4">No se encontraron canciones</h2>
          <p className="text-white/60 mb-6">Hubo un problema al cargar tus canciones. Por favor intenta de nuevo.</p>
          <button
            onClick={() => navigateTo('details')}
            className="px-8 py-4 bg-bougainvillea text-white rounded-full font-bold hover:scale-105 transition-transform"
          >
            Volver a intentar
          </button>
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
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-24 py-6 bg-forest/80 backdrop-blur-md">
        <h2 
          className="font-display text-white text-xl font-medium tracking-tight cursor-pointer"
          onClick={() => navigateTo('landing')}
        >
          RegalosQueCantan
        </h2>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-gold">library_music</span>
          <span className="text-gold text-sm font-bold">2 Versiones Listas</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative pt-24 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          
          {/* Title */}
          <div className="text-center mb-10">
            <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-3">
              ¡Elige tu favorita!
            </h1>
            <p className="text-white/60 text-lg">
              Hemos creado <span className="text-gold font-semibold">2 versiones únicas</span> para {formData.recipientName}
            </p>
            <p className="text-gold/80 text-sm mt-2 uppercase tracking-widest">
              {genreName}{subGenreName ? ` • ${subGenreName}` : ''}
            </p>
          </div>

          {/* Song Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {songs.map((song, index) => (
              <div
                key={song.id}
                onClick={() => selectSong(song.id)}
                className={`relative bg-white/[0.03] backdrop-blur-xl border-2 rounded-3xl overflow-hidden cursor-pointer transition-all duration-300 ${
                  selectedSongId === song.id 
                    ? 'border-gold shadow-[0_0_40px_rgba(212,175,55,0.3)] scale-[1.02]' 
                    : 'border-white/10 hover:border-gold/50 hover:shadow-lg'
                }`}
              >
                {/* Version Badge */}
                <div className="absolute top-4 left-4 z-10">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    index === 0 ? 'bg-blue-500/80 text-white' : 'bg-purple-500/80 text-white'
                  }`}>
                    Versión {song.version || index + 1}
                  </span>
                </div>

                {/* Selection Indicator */}
                {selectedSongId === song.id && (
                  <div className="absolute top-4 right-4 z-10">
                    <span className="material-symbols-outlined text-gold text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                      check_circle
                    </span>
                  </div>
                )}

                {/* Album Art */}
                <div className="relative h-48 bg-gradient-to-br from-gold/20 to-bougainvillea/20">
                  {song.imageUrl ? (
                    <img 
                      src={song.imageUrl} 
                      alt={`Versión ${song.version}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-6xl text-white/20">music_note</span>
                    </div>
                  )}
                  
                  {/* Play overlay on hover/selected */}
                  <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
                    playingId === song.id || selectedSongId === song.id ? 'opacity-100' : 'opacity-0 hover:opacity-100'
                  }`}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlay(song.id);
                      }}
                      className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-xl hover:scale-110 transition-transform"
                    >
                      <span className="material-symbols-outlined text-forest text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {playingId === song.id ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Song Info */}
                <div className="p-5">
                  <h3 className="text-lg font-bold text-white mb-1">
                    Para {formData.recipientName}
                  </h3>
                  <p className="text-gold/70 text-xs uppercase tracking-widest mb-4">
                    {genreName} • Versión {song.version || index + 1}
                  </p>

                  {/* Progress Bar */}
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-gold to-bougainvillea rounded-full transition-all"
                        style={{ width: `${((currentTimes[song.id] || 0) / PREVIEW_DURATION) * 100}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-white/50 font-mono w-12 text-right">
                      {formatTime(currentTimes[song.id] || 0)} / 0:20
                    </span>
                  </div>

                  {/* Preview Status */}
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${previewEnded[song.id] ? 'text-gold' : 'text-white/50'}`}>
                      {previewEnded[song.id] ? '🔒 Preview terminado' : playingId === song.id ? '▶️ Reproduciendo...' : '🎧 Toca para escuchar'}
                    </span>
                    {selectedSongId === song.id && (
                      <span className="text-gold text-xs font-bold">✓ Seleccionada</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Bundle Option */}
          {songs.length >= 2 && (
            <div 
              onClick={selectBoth}
              className={`relative bg-gradient-to-r from-gold/10 via-white/5 to-bougainvillea/10 backdrop-blur-xl border-2 rounded-2xl p-6 cursor-pointer transition-all mb-8 ${
                purchaseBoth 
                  ? 'border-gold shadow-[0_0_30px_rgba(212,175,55,0.3)]' 
                  : 'border-white/20 hover:border-gold/50'
              }`}
            >
              {/* Best Value Badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-gradient-to-r from-gold to-yellow-400 text-forest text-xs font-black px-4 py-1 rounded-full uppercase tracking-wider shadow-lg">
                  🎁 Mejor Valor
                </span>
              </div>

              {purchaseBoth && (
                <div className="absolute top-4 left-4">
                  <span className="material-symbols-outlined text-gold text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    check_circle
                  </span>
                </div>
              )}
              
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gold/20 rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-gold text-3xl">library_music</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">¡Llévate ambas versiones!</h3>
                    <p className="text-white/60 text-sm">Perfecto para compartir o tener más opciones</p>
                  </div>
                </div>
                <div className="text-center md:text-right">
                  {isFree ? (
                    <div className="text-green-400 text-3xl font-bold">¡GRATIS!</div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 justify-center md:justify-end">
                        <span className="text-white/40 line-through text-lg">${(singlePrice * 2).toFixed(2)}</span>
                        <span className="text-gold text-3xl font-bold">${couponApplied ? finalBundlePrice : bundlePrice}</span>
                      </div>
                      <span className="text-green-400 text-sm font-bold">¡AHORRA ${bundleSavings.toFixed(2)}!</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Pricing & Checkout */}
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-3xl p-6 md:p-8">
            {/* Price Summary */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-6">
              <div className="text-center md:text-left">
                <p className="text-white/50 text-sm mb-1">
                  {purchaseBoth ? '2 Canciones Seleccionadas' : selectedSongId ? '1 Canción Seleccionada' : 'Selecciona una opción'}
                </p>
                {isFree ? (
                  <div className="flex items-center gap-3">
                    <span className="text-white/40 line-through text-xl">
                      ${purchaseBoth ? bundlePrice : singlePrice.toFixed(2)}
                    </span>
                    <span className="text-green-400 text-4xl font-bold">¡GRATIS!</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-white text-4xl font-bold">
                      ${purchaseBoth 
                        ? (couponApplied ? finalBundlePrice : bundlePrice)
                        : (couponApplied ? finalSinglePrice : singlePrice.toFixed(2))
                      }
                    </span>
                    {(selectedSongId || purchaseBoth) && !isFree && (
                      <span className="bg-green-500 text-white text-[10px] font-black px-2 py-1 rounded uppercase">
                        {purchaseBoth ? '25% OFF' : '33% OFF'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Coupon Input */}
              <div className="w-full md:w-auto">
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Código de Cupón"
                    className="bg-white/5 border border-white/10 rounded-full py-3 px-6 text-sm w-full md:w-56 placeholder:text-white/20 text-white focus:border-gold focus:ring-1 focus:ring-gold"
                    disabled={!!couponApplied}
                  />
                  {!couponApplied ? (
                    <button 
                      onClick={handleApplyCoupon}
                      disabled={isLoadingCoupon || !couponCode.trim()}
                      className="absolute right-2 text-gold text-xs font-bold px-3 py-2 hover:text-white transition-colors disabled:opacity-50"
                    >
                      {isLoadingCoupon ? '...' : 'Aplicar'}
                    </button>
                  ) : (
                    <span className="absolute right-4 text-green-400 material-symbols-outlined text-sm">check_circle</span>
                  )}
                </div>
                {couponError && <p className="text-red-400 text-xs mt-2">{couponError}</p>}
                {couponApplied && (
                  <p className="text-green-400 text-xs mt-2">
                    {isFree ? '¡Cupón GRATIS aplicado!' : `¡-${couponApplied.discount}% aplicado!`}
                  </p>
                )}
              </div>
            </div>

            {/* Checkout Button */}
            <button
              onClick={handleCheckout}
              disabled={isCheckingOut || (!selectedSongId && !purchaseBoth)}
              className={`w-full py-5 rounded-2xl text-xl font-bold transition-all flex items-center justify-center gap-3 ${
                selectedSongId || purchaseBoth
                  ? 'bg-bougainvillea hover:bg-bougainvillea/90 text-white shadow-[0_0_30px_rgba(225,29,116,0.4)] hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-white/10 text-white/30 cursor-not-allowed'
              }`}
            >
              {isCheckingOut ? (
                <>
                  <span className="material-symbols-outlined animate-spin">progress_activity</span>
                  Procesando...
                </>
              ) : isFree && (selectedSongId || purchaseBoth) ? (
                <>
                  <span className="material-symbols-outlined">download</span>
                  Descargar {purchaseBoth ? 'Ambas Canciones' : 'Canción'} Gratis
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">credit_card</span>
                  {purchaseBoth ? 'Comprar Ambas Canciones' : selectedSongId ? 'Comprar Canción Seleccionada' : 'Selecciona una opción'}
                </>
              )}
            </button>

            {/* Trust Badges */}
            <div className="mt-6 flex flex-col items-center gap-4">
              <div className="flex items-center gap-6 opacity-50">
                <span className="text-white/70 text-sm font-bold">PayPal</span>
                <span className="text-white/70 text-sm font-bold">VISA</span>
                <span className="text-white/70 text-sm font-bold">Mastercard</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 border border-gold/20 rounded-lg bg-gold/5">
                <span className="material-symbols-outlined text-gold text-sm">verified_user</span>
                <span className="text-gold text-[11px] font-bold uppercase tracking-widest">
                  Garantía de Satisfacción
                </span>
              </div>
            </div>
          </div>

          {/* Back Link */}
          <div className="text-center mt-8">
            <button
              onClick={() => navigateTo('generating')}
              className="text-white/40 hover:text-white text-sm uppercase tracking-widest flex items-center justify-center gap-2 mx-auto transition-colors"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Volver
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
          <p className="text-white/20 text-[10px] uppercase tracking-widest">© 2025 • Hecho con alma en México.</p>
        </div>
      </footer>
    </div>
  );
}
