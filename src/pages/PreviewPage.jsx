import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import { createCheckout, validateCoupon, regenerateSong } from '../services/api';
import genres from '../config/genres';
import { trackStep } from '../services/tracking';

// Preview settings - skip intro, play 20 seconds of vocals
const PREVIEW_START = 15;  // Skip 15s intro
const PREVIEW_DURATION = 20;  // Play 20 seconds
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;  // Stop at 35s

export default function PreviewPage() {
  const { formData, songData, setSongData, navigateTo } = useContext(AppContext);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(PREVIEW_DURATION);
  const [previewEnded, setPreviewEnded] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [isLoadingCoupon, setIsLoadingCoupon] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const audioRef = useRef(null);

  // Check if can regenerate (max 2 versions)
  const canRegenerate = songData?.canRegenerate !== false && (songData?.version || 1) < 2;

  // Get genre display name
  const genreConfig = genres[formData.genre];
  const genreName = genreConfig?.name || formData.genre;
  const subGenreName = formData.subGenre && genreConfig?.subGenres?.[formData.subGenre]?.name;

  // Calculate price
  const basePrice = 19.99;
  const originalPrice = 29.99;
  const discount = couponApplied?.discount || 0;
  const finalPrice = (basePrice * (1 - discount / 100)).toFixed(2);

  // Track page view
  useEffect(() => {
    trackStep('preview');
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.addEventListener('timeupdate', handleTimeUpdate);
      audioRef.current.addEventListener('ended', handleEnded);
      audioRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);
      
      return () => {
        if (audioRef.current) {
          audioRef.current.removeEventListener('timeupdate', handleTimeUpdate);
          audioRef.current.removeEventListener('ended', handleEnded);
          audioRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        }
      };
    }
  }, [songData?.previewUrl]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const time = audioRef.current.currentTime;
      const previewTime = Math.max(0, time - PREVIEW_START);
      setCurrentTime(Math.min(previewTime, PREVIEW_DURATION));
      
      if (time >= PREVIEW_END) {
        audioRef.current.pause();
        setIsPlaying(false);
        setPreviewEnded(true);
        audioRef.current.currentTime = PREVIEW_START;
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = PREVIEW_START;
      setDuration(PREVIEW_DURATION);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setPreviewEnded(true);
    if (audioRef.current) {
      audioRef.current.currentTime = PREVIEW_START;
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        if (previewEnded || audioRef.current.currentTime < PREVIEW_START || audioRef.current.currentTime >= PREVIEW_END) {
          audioRef.current.currentTime = PREVIEW_START;
          setPreviewEnded(false);
          setCurrentTime(0);
        }
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRegenerate = async () => {
    if (!canRegenerate) return;
    
    setIsRegenerating(true);
    try {
      const result = await regenerateSong(songData.id);
      
      if (result.success) {
        const firstSong = { ...songData, version: 1 };
        
        setSongData({
          ...result.song,
          firstSong,
          canRegenerate: false,
          version: 2
        });
        
        navigateTo('generating');
      } else {
        alert(result.error || 'Error al regenerar. Intenta de nuevo.');
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Regenerate error:', error);
      }
      alert('Error al regenerar. Intenta de nuevo.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    
    setIsLoadingCoupon(true);
    setCouponError('');
    
    try {
      const result = await validateCoupon(couponCode);
      setCouponApplied(result);
      setCouponError('');
    } catch (error) {
      setCouponError('Código inválido o expirado');
      setCouponApplied(null);
    } finally {
      setIsLoadingCoupon(false);
    }
  };

  const handleCheckout = async () => {
    setIsCheckingOut(true);
    try {
      const codeToSend = couponApplied?.code || couponCode.trim().toUpperCase() || null;
      
      const result = await createCheckout(
        [songData.id],
        formData.email,
        codeToSend
      );
      
      if (result.url) {
        window.location.href = result.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Checkout error:', error);
      }
      alert('Error al procesar el pago. Intenta de nuevo.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleBack = () => {
    navigateTo('details');
  };

  const formatLyrics = (lyrics) => {
    if (!lyrics) return [];
    return lyrics.split('\n\n').filter(section => section.trim());
  };

  const lyricsSections = formatLyrics(songData?.lyrics);

  return (
    <div className="bg-forest text-white antialiased min-h-screen">
      {/* 💘 Valentine's Sticky Urgency Bar */}
      <div className="bg-gradient-to-r from-red-600 via-red-500 to-red-600 text-white text-center py-3 px-4 font-bold text-sm md:text-base sticky top-0 z-[60] shadow-lg">
        💘 ¡Ordena antes del 12 de Feb para San Valentín! ⏰ Solo quedan unos días
      </div>

      {songData?.previewUrl && (
        <audio ref={audioRef} src={songData.previewUrl} preload="metadata" />
      )}

      <header className="fixed top-12 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-24 py-6">
        <div 
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigateTo('landing')}
        >
          <h2 className="font-display text-white text-xl font-medium tracking-tight">
            RegalosQueCantan
          </h2>
        </div>
        <div className="hidden md:block">
          <span className="text-[10px] uppercase tracking-widest text-red-400 font-bold bg-red-500/20 px-4 py-2 rounded-full border border-red-400/50">
            💘 San Valentín
          </span>
        </div>
      </header>

      <main className="relative pt-32 pb-20 flex flex-col items-center justify-center overflow-hidden min-h-screen">
        <div className="absolute inset-0 w-full h-full -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-forest to-background-dark"></div>
          <div className="absolute inset-0 opacity-5" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M50 0 L100 50 L50 100 L0 50 Z M50 20 L80 50 L50 80 L20 50 Z' fill='%23fff' fill-rule='evenodd'/%3E%3C/svg%3E")`,
            backgroundSize: '80px 80px'
          }}></div>
        </div>

        <div className="relative z-20 container mx-auto px-6 max-w-3xl">
          <div className="text-center mb-10">
            <h1 className="font-display text-white text-4xl md:text-5xl font-bold mb-4 tracking-tight">
              Escucha tu creación
            </h1>
            <p className="text-gold/90 text-lg font-light max-w-md mx-auto">
              Hemos preparado algo mágico para ti. Revisa tu canción antes de finalizar el pedido.
            </p>
          </div>

          <div className="relative group mb-8">
            <div className="absolute -inset-1 bg-gradient-to-r from-gold/20 via-white/5 to-gold/20 rounded-[2.5rem] blur-xl opacity-40"></div>
            <div className="relative bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl p-6 md:p-8">
              
              <div className="absolute top-6 right-6">
                <span className={`text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-1.5 shadow-lg ${previewEnded ? 'bg-white/20' : 'bg-bougainvillea'}`}>
                  <span className="material-symbols-outlined text-xs">
                    {previewEnded ? 'lock' : 'headphones'}
                  </span>
                  {previewEnded ? 'Preview terminado' : 'Muestra de 20s'}
                </span>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-8">
                <div className="w-40 h-40 md:w-48 md:h-48 shrink-0 relative">
                  {songData?.imageUrl ? (
                    <img 
                      src={songData.imageUrl} 
                      alt="Album Art"
                      className="w-full h-full object-cover rounded-xl shadow-lg border-2 border-white/10"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div 
                    className={`w-full h-full bg-gradient-to-br from-gold/30 to-bougainvillea/30 rounded-xl items-center justify-center border-2 border-white/10 shadow-lg ${songData?.imageUrl ? 'hidden' : 'flex'}`}
                  >
                    <span className="material-symbols-outlined text-7xl text-white/40">music_note</span>
                  </div>
                </div>

                <div className="flex-1 w-full text-center md:text-left">
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold text-white mb-1">
                      Canción para {formData.recipientName}
                    </h3>
                    <p className="text-gold uppercase tracking-[0.2em] text-xs font-bold">
                      {genreName}{subGenreName ? ` - ${subGenreName}` : ''} • Para {formData.recipientName}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 h-10 mb-6 bg-white/5 rounded-lg px-4 border border-white/5">
                    <div className="flex-1 h-1 bg-white/10 rounded-full relative overflow-hidden">
                      <div 
                        className="absolute left-0 top-0 h-full bg-gold rounded-full transition-all"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-[10px] text-white/60 font-mono ml-3 uppercase tracking-tighter">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>

                  <div className="flex items-center justify-center md:justify-start gap-6">
                    <button 
                      onClick={togglePlay}
                      className="w-12 h-12 bg-white text-forest rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
                    >
                      <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {isPlaying ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
                        {previewEnded ? 'Compra para escuchar completa' : 'Escuchando preview'}
                      </span>
                      <span className="text-xs text-gold font-medium">
                        {previewEnded ? '🔒 Preview terminado' : 'Lista para descarga'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {canRegenerate && (
            <div className="text-center mb-8">
              <button
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white font-medium transition-all disabled:opacity-50"
              >
                {isRegenerating ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                    Regenerando...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-lg">refresh</span>
                    No me convence, regenerar otra versión
                  </>
                )}
              </button>
              <p className="text-white/40 text-xs mt-2">
                Tienes 1 regeneración gratuita disponible
              </p>
            </div>
          )}

          <div className="relative bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[2rem] overflow-hidden shadow-xl mb-12 p-8 md:p-10 text-center">
            <h3 className="font-display text-gold text-2xl mb-8 tracking-wide">
              Letra de tu canción
            </h3>
            
            <div className="relative max-h-64 overflow-hidden">
              <div className="space-y-6 italic font-display text-lg md:text-xl text-white/90 leading-relaxed">
                {lyricsSections.slice(0, 2).map((section, index) => (
                  <p key={index} className={index === 1 ? 'text-gold/80' : ''}>
                    {section.split('\n').map((line, i) => (
                      <React.Fragment key={i}>
                        {line}
                        {i < section.split('\n').length - 1 && <br />}
                      </React.Fragment>
                    ))}
                  </p>
                ))}
                
                {lyricsSections.length > 2 && (
                  <div className="pt-4 blur-sm opacity-30 select-none">
                    {lyricsSections[2]?.split('\n').slice(0, 2).join('\n')}
                  </div>
                )}
              </div>
              
              <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-forest/95 to-transparent pointer-events-none"></div>
            </div>
            
            <div className="mt-6">
              <span className="text-[10px] uppercase tracking-[0.3em] text-gold/60 font-bold">
                [ Adquiere la versión completa para ver toda la letra ]
              </span>
            </div>
          </div>

          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-3xl p-8">
            {/* Valentine's Promo Banner */}
            <div className="bg-gradient-to-r from-red-600/20 to-pink-600/20 border border-red-400/30 rounded-2xl p-4 mb-6 text-center">
              <p className="text-red-400 font-bold text-sm">
                💘 Regalo perfecto para San Valentín • ¡Entrega digital instantánea!
              </p>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
              <div className="text-center md:text-left">
                <div className="flex items-center gap-3 justify-center md:justify-start">
                  {couponApplied?.free ? (
                    <>
                      <span className="text-white/40 line-through text-xl">${basePrice}</span>
                      <span className="text-green-400 text-4xl font-bold tracking-tight">¡GRATIS!</span>
                    </>
                  ) : (
                    <>
                      <span className="text-white/40 line-through text-xl">${originalPrice}</span>
                      <span className="text-white text-4xl font-bold tracking-tight">
                        ${couponApplied ? finalPrice : basePrice.toFixed(2)}
                      </span>
                      <span className="bg-green-500 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-tighter">
                        {couponApplied ? `${discount + 33}% OFF` : '33% OFF'}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-1 uppercase tracking-widest">
                  {couponApplied?.free ? 'Cupón 100% de descuento aplicado' : 'Pago único • Acceso de por vida'}
                </p>
              </div>

              <div className="w-full md:w-auto">
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Código de Cupón"
                    className="bg-white/5 border border-white/10 rounded-full py-3 px-6 text-sm focus:ring-gold focus:border-gold w-full md:w-64 placeholder:text-white/20 text-white"
                    disabled={!!couponApplied}
                  />
                  {!couponApplied ? (
                    <button 
                      onClick={handleApplyCoupon}
                      disabled={isLoadingCoupon || !couponCode.trim()}
                      className="absolute right-2 text-gold text-xs font-bold uppercase tracking-widest hover:text-white transition-colors px-4 py-2 disabled:opacity-50"
                    >
                      {isLoadingCoupon ? '...' : 'Aplicar'}
                    </button>
                  ) : (
                    <span className="absolute right-4 text-green-400 material-symbols-outlined text-sm">check_circle</span>
                  )}
                </div>
                {couponError && (
                  <p className="text-red-400 text-xs mt-2 text-center md:text-left">{couponError}</p>
                )}
                {couponApplied && (
                  <p className="text-green-400 text-xs mt-2 text-center md:text-left">
                    {couponApplied.free ? '¡Cupón GRATIS aplicado!' : `¡Cupón aplicado! -${couponApplied.discount}% adicional`}
                  </p>
                )}
              </div>
            </div>

            <div className="text-center">
              <button
                onClick={handleCheckout}
                disabled={isCheckingOut}
                className="group relative w-full inline-flex items-center justify-center overflow-hidden rounded-full h-20 px-16 bg-gradient-to-r from-bougainvillea to-red-600 text-white text-xl font-bold transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_25px_rgba(225,29,116,0.4)] disabled:opacity-70 disabled:cursor-not-allowed"
              >
                <span className="relative z-10 flex items-center gap-3">
                  {isCheckingOut ? (
                    <>
                      <span className="material-symbols-outlined animate-spin">progress_activity</span>
                      Procesando...
                    </>
                  ) : couponApplied?.free ? (
                    <>
                      <span className="material-symbols-outlined">download</span>
                      Descargar Canción Gratis
                    </>
                  ) : (
                    <>
                      <span>💘</span>
                      Comprar Regalo de San Valentín
                    </>
                  )}
                </span>
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
              </button>

              {/* All sales final disclaimer */}
              <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '10px', marginTop: '12px', lineHeight: 1.5, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto' }}>
                Al comprar aceptas que todas las ventas son finales. Escucha la vista previa antes de comprar. No se ofrecen reembolsos.
              </p>
            </div>

            <div className="mt-8 flex flex-col items-center gap-6">
              <div className="flex items-center gap-6 opacity-60">
                <svg className="h-5" viewBox="0 0 124 33" fill="currentColor">
                  <path d="M46.211 6.749h-6.839a.95.95 0 0 0-.939.802l-2.766 17.537a.57.57 0 0 0 .564.658h3.265a.95.95 0 0 0 .939-.803l.746-4.73a.95.95 0 0 1 .938-.803h2.165c4.505 0 7.105-2.18 7.784-6.5.306-1.89.013-3.375-.872-4.415-.972-1.142-2.696-1.746-4.985-1.746zM47 13.154c-.374 2.454-2.249 2.454-4.062 2.454h-1.032l.724-4.583a.57.57 0 0 1 .563-.481h.473c1.235 0 2.4 0 3.002.704.359.42.469 1.044.332 1.906zM66.654 13.075h-3.275a.57.57 0 0 0-.563.481l-.145.916-.229-.332c-.709-1.029-2.29-1.373-3.868-1.373-3.619 0-6.71 2.741-7.312 6.586-.313 1.918.132 3.752 1.22 5.031.998 1.176 2.426 1.666 4.125 1.666 2.916 0 4.533-1.875 4.533-1.875l-.146.91a.57.57 0 0 0 .562.66h2.95a.95.95 0 0 0 .939-.803l1.77-11.209a.568.568 0 0 0-.561-.658zm-4.565 6.374c-.316 1.871-1.801 3.127-3.695 3.127-.951 0-1.711-.305-2.199-.883-.484-.574-.668-1.391-.514-2.301.295-1.855 1.805-3.152 3.67-3.152.93 0 1.686.309 2.184.892.499.589.697 1.411.554 2.317zM84.096 13.075h-3.291a.954.954 0 0 0-.787.417l-4.539 6.686-1.924-6.425a.953.953 0 0 0-.912-.678h-3.234a.57.57 0 0 0-.541.754l3.625 10.638-3.408 4.811a.57.57 0 0 0 .465.9h3.287a.949.949 0 0 0 .781-.408l10.946-15.8a.57.57 0 0 0-.468-.895z"/>
                  <path d="M94.992 6.749h-6.84a.95.95 0 0 0-.938.802l-2.766 17.537a.569.569 0 0 0 .562.658h3.51a.665.665 0 0 0 .656-.562l.785-4.971a.95.95 0 0 1 .938-.803h2.164c4.506 0 7.105-2.18 7.785-6.5.307-1.89.012-3.375-.873-4.415-.971-1.142-2.694-1.746-4.983-1.746zm.789 6.405c-.373 2.454-2.248 2.454-4.062 2.454h-1.031l.725-4.583a.568.568 0 0 1 .562-.481h.473c1.234 0 2.4 0 3.002.704.359.42.468 1.044.331 1.906zM115.434 13.075h-3.273a.567.567 0 0 0-.562.481l-.145.916-.23-.332c-.709-1.029-2.289-1.373-3.867-1.373-3.619 0-6.709 2.741-7.311 6.586-.312 1.918.131 3.752 1.219 5.031 1 1.176 2.426 1.666 4.125 1.666 2.916 0 4.533-1.875 4.533-1.875l-.146.91a.57.57 0 0 0 .564.66h2.949a.95.95 0 0 0 .938-.803l1.771-11.209a.571.571 0 0 0-.565-.658zm-4.565 6.374c-.314 1.871-1.801 3.127-3.695 3.127-.949 0-1.711-.305-2.199-.883-.484-.574-.666-1.391-.514-2.301.297-1.855 1.805-3.152 3.67-3.152.93 0 1.686.309 2.184.892.501.589.699 1.411.554 2.317zM119.295 7.23l-2.807 17.858a.569.569 0 0 0 .562.658h2.822c.469 0 .867-.34.939-.803l2.768-17.536a.57.57 0 0 0-.562-.659h-3.16a.571.571 0 0 0-.562.482z" fill="#009cde"/>
                  <path d="M7.266 29.154l.523-3.322-1.165-.027H1.061L4.927 1.292a.316.316 0 0 1 .314-.268h9.38c3.114 0 5.263.648 6.385 1.927.526.6.861 1.227 1.023 1.917.17.724.173 1.589.007 2.644l-.012.077v.676l.526.298a3.69 3.69 0 0 1 1.065.812c.45.513.741 1.165.864 1.938.127.795.085 1.741-.123 2.812-.24 1.232-.628 2.305-1.152 3.183a6.547 6.547 0 0 1-1.825 2c-.696.494-1.523.869-2.458 1.109-.906.236-1.939.355-3.072.355h-.73c-.522 0-1.029.188-1.427.525a2.21 2.21 0 0 0-.744 1.328l-.055.299-.924 5.855-.042.215c-.011.068-.03.102-.058.125a.155.155 0 0 1-.096.035H7.266z" fill="#003087"/>
                  <path d="M23.048 7.667c-.028.179-.06.362-.096.55-1.237 6.351-5.469 8.545-10.874 8.545H9.326c-.661 0-1.218.48-1.321 1.132L6.596 26.83l-.399 2.533a.704.704 0 0 0 .695.814h4.881c.578 0 1.069-.42 1.16-.99l.048-.248.919-5.832.059-.32c.09-.572.582-.992 1.16-.992h.73c4.729 0 8.431-1.92 9.513-7.476.452-2.321.218-4.259-.978-5.622a4.667 4.667 0 0 0-1.336-1.03z" fill="#003087"/>
                  <path d="M21.754 7.151a9.757 9.757 0 0 0-1.203-.267 15.284 15.284 0 0 0-2.426-.177h-7.352a1.172 1.172 0 0 0-1.159.992L8.05 17.605l-.045.289a1.336 1.336 0 0 1 1.321-1.132h2.752c5.405 0 9.637-2.195 10.874-8.545.037-.188.068-.371.096-.55a6.594 6.594 0 0 0-1.017-.429 9.045 9.045 0 0 0-.277-.087z" fill="#012169"/>
                </svg>
                <span className="text-white/60 text-2xl font-bold">VISA</span>
                <span className="text-white/60 text-xl font-bold">Mastercard</span>
              </div>

              <div className="flex items-center gap-2 px-4 py-2 border border-gold/20 rounded-lg bg-gold/5">
                <span className="material-symbols-outlined text-gold text-sm">verified_user</span>
                <span className="text-gold text-[11px] font-bold uppercase tracking-widest">
                  Pago 100% Seguro
                </span>
              </div>
            </div>
          </div>

          <div className="mt-12 text-center">
            <button
              onClick={handleBack}
              className="text-white/40 hover:text-white transition-colors text-sm uppercase tracking-widest flex items-center justify-center gap-2 group"
            >
              <span className="material-symbols-outlined text-sm group-hover:-translate-x-1 transition-transform">arrow_back</span>
              Volver a editar detalles
            </button>
          </div>
        </div>

        <div className="absolute top-40 left-10 w-24 h-24 border-l border-t border-gold/10 hidden lg:block"></div>
        <div className="absolute bottom-40 right-10 w-24 h-24 border-r border-b border-gold/10 hidden lg:block"></div>
      </main>

      <footer className="bg-background-dark py-10 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="font-display text-white/30 text-lg tracking-wider uppercase">RegalosQueCantan</div>
          <div className="flex gap-8">
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Ayuda</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Términos</a>
          </div>
          <p className="text-white/20 text-[10px] uppercase tracking-widest">© {new Date().getFullYear()} • Hecho con alma en México.</p>
        </div>
      </footer>
    </div>
  );
}
