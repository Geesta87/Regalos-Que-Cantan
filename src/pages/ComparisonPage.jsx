import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import { createCheckout, validateCoupon, supabase } from '../services/api';
import genres from '../config/genres';
import { trackStep } from '../services/tracking';

// Preview settings
const PREVIEW_START = 15;
const PREVIEW_DURATION = 20;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

export default function ComparisonPage() {
  const context = useContext(AppContext);
  
  const { 
    formData = {}, 
    songData = {}, 
    setSongData = () => {}, 
    navigateTo = () => {} 
  } = context || {};
  
  // Songs state
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
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

  // Safely get genre display name
  const genreConfig = genres?.[formData?.genre];
  const genreName = genreConfig?.name || formData?.genre || 'Género';

  // Pricing
  const singlePrice = 19.99;
  const bundlePrice = 29.99;
  const bundleSavings = (singlePrice * 2) - bundlePrice;
  const isFree = couponApplied?.free || false;

  // Check if something is selected
  const hasSelection = selectedSongId || purchaseBoth;

  // Track page view
  useEffect(() => {
    trackStep('comparison');
  }, []);

  // Helper function to fetch songs from database by IDs
  const fetchSongsFromIds = async (songIds) => {
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .in('id', songIds);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        const loadedSongs = data.map((song, index) => ({
          id: song.id,
          version: song.version || index + 1,
          audioUrl: song.audio_url,
          previewUrl: song.preview_url || song.audio_url,
          imageUrl: song.image_url,
          lyrics: song.lyrics
        }));
        setSongs(loadedSongs.sort((a, b) => (a.version || 1) - (b.version || 1)));
        setLoading(false);
      } else {
        setError('No se encontraron las canciones');
        setLoading(false);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Error fetching songs from URL params:', err);
      }
      setError('Error al cargar las canciones');
      setLoading(false);
    }
  };

  // Load songs from songData OR URL parameters
  useEffect(() => {
    try {
      const loadedSongs = [];
      
      if (songData?.songs && Array.isArray(songData.songs) && songData.songs.length > 0) {
        loadedSongs.push(...songData.songs);
      } 
      else if (songData?.song1) {
        loadedSongs.push({ ...songData.song1, version: 1 });
        if (songData?.song2) {
          loadedSongs.push({ ...songData.song2, version: 2 });
        }
      }
      else if (songData?.id) {
        loadedSongs.push({
          id: songData.id,
          version: 1,
          audioUrl: songData.audioUrl,
          previewUrl: songData.previewUrl,
          imageUrl: songData.imageUrl,
          lyrics: songData.lyrics
        });
      }
      
      if (loadedSongs.length > 0) {
        setSongs(loadedSongs.sort((a, b) => (a.version || 1) - (b.version || 1)));
        setLoading(false);
        return;
      }
      
      const params = new URLSearchParams(window.location.search);
      const songIdsParam = params.get('song_ids');
      const singleSongId = params.get('song_id');
      
      if (songIdsParam) {
        const songIds = songIdsParam.split(',').filter(id => id.trim());
        if (songIds.length > 0) {
          fetchSongsFromIds(songIds);
          return;
        }
      } else if (singleSongId) {
        fetchSongsFromIds([singleSongId]);
        return;
      }
      
      setError('No songs available');
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [songData]);

  const handlePlay = (songId) => {
    try {
      const audio = audioRefs.current[songId];
      if (!audio) return;

      if (playingId === songId) {
        audio.pause();
        setPlayingId(null);
      } else {
        Object.values(audioRefs.current).forEach(a => { if (a) a.pause(); });
        
        if (previewEnded[songId] || audio.currentTime < PREVIEW_START || audio.currentTime >= PREVIEW_END) {
          audio.currentTime = PREVIEW_START;
          setPreviewEnded(prev => ({ ...prev, [songId]: false }));
          setCurrentTimes(prev => ({ ...prev, [songId]: 0 }));
        }
        
        audio.play().catch(err => {
          if (import.meta.env.DEV) console.error('Play error:', err);
        });
        setPlayingId(songId);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Play toggle error:', err);
    }
  };

  const handleTimeUpdate = (songId, audio) => {
    if (!audio) return;
    try {
      const time = audio.currentTime;
      const previewTime = Math.max(0, time - PREVIEW_START);
      
      setCurrentTimes(prev => ({
        ...prev,
        [songId]: Math.min(previewTime, PREVIEW_DURATION)
      }));

      if (time >= PREVIEW_END) {
        audio.pause();
        audio.currentTime = PREVIEW_START;
        setPlayingId(null);
        setPreviewEnded(prev => ({ ...prev, [songId]: true }));
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Time update error:', err);
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
    } catch (err) {
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
      const songIdsToCheckout = purchaseBoth 
        ? songs.map(s => s.id)
        : [selectedSongId];
      
      const codeToSend = couponApplied?.code || couponCode.trim().toUpperCase() || null;

      const result = await createCheckout(songIdsToCheckout, formData?.email, codeToSend);

      if (result.url) {
        window.location.href = result.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Checkout error:', err);
      alert('Error al procesar el pago. Intenta de nuevo.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const selectSong = (songId) => {
    setSelectedSongId(songId);
    setPurchaseBoth(false);
  };

  const selectBoth = () => {
    setPurchaseBoth(true);
    setSelectedSongId(null);
  };

  const getSelectionLabel = () => {
    if (purchaseBoth) return '2 Canciones (Ambas versiones)';
    if (selectedSongId) {
      const song = songs.find(s => s.id === selectedSongId);
      return `1 Canción (Versión ${song?.version || 1})`;
    }
    return null;
  };

  if (loading) {
    return (
      <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{textAlign: 'center'}}>
          <div style={{fontSize: '48px', marginBottom: '20px'}}>⏳</div>
          <p style={{fontSize: '20px'}}>Cargando tus canciones...</p>
        </div>
      </div>
    );
  }

  if (error || !songs || songs.length === 0) {
    return (
      <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{textAlign: 'center'}}>
          <p style={{fontSize: '24px'}}>❌ {error || 'No se encontraron canciones'}</p>
          <button onClick={() => navigateTo('details')} style={{padding: '12px 24px', background: '#e11d74', color: 'white', border: 'none', borderRadius: '8px', marginTop: '20px', cursor: 'pointer'}}>
            Volver a intentar
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh'}}>
      {/* CSS Animation for audio bars */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scaleY(1); }
          50% { opacity: 0.7; transform: scaleY(0.7); }
        }
      `}</style>

      {/* 💘 Valentine's Urgency Bar */}
      <div style={{
        background: 'linear-gradient(90deg, #dc2626, #ef4444, #dc2626)',
        padding: '12px 20px',
        textAlign: 'center',
        fontWeight: 'bold',
        fontSize: '15px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
      }}>
        💘 ¡Ordena antes del 12 de Feb para San Valentín! ⏰
      </div>

      {/* Audio elements */}
      {songs.map(song => (
        <audio
          key={song.id}
          ref={el => audioRefs.current[song.id] = el}
          src={song.audioUrl || song.previewUrl}
          preload="metadata"
          onLoadedMetadata={(e) => { if (e.target) e.target.currentTime = PREVIEW_START; }}
          onTimeUpdate={(e) => handleTimeUpdate(song.id, e.target)}
          onEnded={() => setPlayingId(null)}
        />
      ))}

      <div style={{maxWidth: '900px', margin: '0 auto', padding: '20px', paddingTop: '40px'}}>
        
        {/* Header */}
        <div style={{textAlign: 'center', marginBottom: '40px'}}>
          <div style={{fontSize: '56px', marginBottom: '15px'}}>🎵</div>
          <h1 style={{fontSize: '32px', marginBottom: '10px', fontWeight: 'bold'}}>
            Paso Final: Elige tu canción
          </h1>
          <p style={{color: '#d4af37', fontSize: '18px', marginBottom: '20px'}}>
            {songs.length} versiones creadas para <strong>{formData?.recipientName || 'ti'}</strong>
          </p>
          
          {/* Instruction box */}
          <div style={{
            background: 'rgba(212, 175, 55, 0.1)',
            border: '2px solid',
            borderImage: 'linear-gradient(90deg, #dc2626, #d4af37, #dc2626) 1',
            borderRadius: '12px',
            padding: '15px 25px',
            display: 'inline-block'
          }}>
            <p style={{margin: 0, fontSize: '16px'}}>
              👇 <strong>Selecciona UNA versión</strong> o elige <span style={{color: '#22c55e', fontWeight: 'bold'}}>ambas</span> con descuento
            </p>
          </div>
        </div>

        {/* Song Cards */}
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px'}}>
          {songs.map((song, index) => {
            const isSelected = selectedSongId === song.id;
            const isOtherSelected = (selectedSongId && !isSelected) || purchaseBoth;
            const isPlaying = playingId === song.id;
            
            const gradientBg = index === 0 
              ? 'linear-gradient(135deg, #1e40af, #3b82f6, #60a5fa)' 
              : 'linear-gradient(135deg, #6b21a8, #8b5cf6, #a78bfa)';
            
            return (
              <div
                key={song.id}
                onClick={() => selectSong(song.id)}
                style={{
                  background: isSelected 
                    ? 'linear-gradient(135deg, rgba(212,175,55,0.2), rgba(212,175,55,0.1))' 
                    : 'rgba(255,255,255,0.03)',
                  border: isSelected ? '3px solid #d4af37' : '2px solid rgba(255,255,255,0.1)',
                  borderRadius: '20px',
                  padding: '24px',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                  opacity: isOtherSelected ? 0.5 : 1,
                  transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                  boxShadow: isSelected ? '0 0 30px rgba(212,175,55,0.3)' : 'none',
                  position: 'relative'
                }}
              >
                {/* Radio indicator */}
                <div style={{
                  position: 'absolute',
                  top: '15px',
                  right: '15px',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  border: isSelected ? '3px solid #d4af37' : '3px solid rgba(255,255,255,0.3)',
                  background: isSelected ? '#d4af37' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 5
                }}>
                  {isSelected && <span style={{color: '#1a3a2f', fontSize: '16px', fontWeight: 'bold'}}>✓</span>}
                </div>

                {/* Version badge */}
                <div style={{marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                  <span style={{
                    background: index === 0 ? '#3b82f6' : '#8b5cf6', 
                    padding: '6px 14px', 
                    borderRadius: '20px', 
                    fontSize: '13px', 
                    fontWeight: 'bold'
                  }}>
                    Versión {song.version || index + 1}
                  </span>
                  {index === 0 && (
                    <span style={{
                      background: 'rgba(212,175,55,0.2)',
                      color: '#d4af37',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 'bold'
                    }}>
                      ⭐ Más popular
                    </span>
                  )}
                </div>

                {/* Album art with play button */}
                <div style={{
                  height: '180px', 
                  borderRadius: '12px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  marginBottom: '15px',
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  {/* Gradient fallback */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: gradientBg,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 0
                  }}>
                    <span style={{fontSize: '48px', opacity: 0.5}}>🎵</span>
                    <span style={{fontSize: '14px', opacity: 0.7, marginTop: '5px'}}>Versión {song.version || index + 1}</span>
                  </div>
                  
                  {/* Image with error fallback */}
                  {song.imageUrl && (
                    <img 
                      src={song.imageUrl} 
                      alt="" 
                      style={{width: '100%', height: '100%', objectFit: 'cover', position: 'relative', zIndex: 1}} 
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  
                  {/* Large play button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePlay(song.id); }}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: '70px',
                      height: '70px',
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.95)',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                      zIndex: 10
                    }}
                  >
                    {isPlaying ? (
                      <span style={{fontSize: '28px', color: '#1a3a2f'}}>⏸</span>
                    ) : (
                      <span style={{fontSize: '32px', color: '#1a3a2f', marginLeft: '4px'}}>▶</span>
                    )}
                  </button>
                </div>

                {/* Song info */}
                <h3 style={{fontSize: '18px', marginBottom: '5px', fontWeight: 'bold'}}>
                  Para {formData?.recipientName || 'ti'}
                </h3>
                <p style={{color: '#d4af37', fontSize: '13px', marginBottom: '15px'}}>{genreName}</p>

                {/* Playing status */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px',
                  background: isPlaying ? 'rgba(212,175,55,0.1)' : 'rgba(255,255,255,0.03)',
                  borderRadius: '8px',
                  marginBottom: '10px'
                }}>
                  {isPlaying ? (
                    <>
                      <div style={{display: 'flex', alignItems: 'flex-end', gap: '2px', height: '16px'}}>
                        {[1,2,3,4].map(i => (
                          <div key={i} style={{
                            width: '3px',
                            background: '#d4af37',
                            animation: `pulse 0.5s ease-in-out infinite`,
                            animationDelay: `${i * 0.1}s`,
                            height: `${8 + (i % 3) * 4}px`
                          }} />
                        ))}
                      </div>
                      <span style={{color: '#d4af37', fontSize: '13px'}}>Reproduciendo...</span>
                    </>
                  ) : previewEnded[song.id] ? (
                    <span style={{color: 'rgba(255,255,255,0.5)', fontSize: '13px'}}>🔄 Clic en ▶ para escuchar de nuevo</span>
                  ) : (
                    <span style={{color: 'rgba(255,255,255,0.5)', fontSize: '13px'}}>👆 Clic en ▶ para escuchar preview</span>
                  )}
                </div>

                {/* Progress bar */}
                <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px'}}>
                  <div style={{flex: 1, height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden'}}>
                    <div style={{
                      width: `${((currentTimes[song.id] || 0) / PREVIEW_DURATION) * 100}%`,
                      height: '100%',
                      background: '#d4af37',
                      transition: 'width 0.1s'
                    }} />
                  </div>
                  <span style={{fontSize: '12px', color: 'rgba(255,255,255,0.5)'}}>
                    {formatTime(currentTimes[song.id] || 0)} / {formatTime(PREVIEW_DURATION)}
                  </span>
                </div>

                {/* Lyrics preview */}
                {song.lyrics && (
                  <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderLeft: '3px solid #d4af37',
                    padding: '12px',
                    borderRadius: '0 8px 8px 0',
                    marginBottom: '10px'
                  }}>
                    <p style={{
                      margin: 0,
                      fontSize: '13px',
                      fontStyle: 'italic',
                      color: 'rgba(255,255,255,0.8)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}>
                      "{song.lyrics.split('\n')[0]}"
                    </p>
                    <p style={{margin: '5px 0 0', fontSize: '11px', color: 'rgba(255,255,255,0.4)'}}>
                      🎤 Preview de la letra
                    </p>
                  </div>
                )}

                {/* Price */}
                <p style={{textAlign: 'center', fontSize: '26px', fontWeight: 'bold', marginTop: '10px', color: isSelected ? '#d4af37' : 'white'}}>
                  ${singlePrice}
                </p>
              </div>
            );
          })}
        </div>

        {/* Valentine's Divider */}
        {songs.length >= 2 && (
          <div style={{display: 'flex', alignItems: 'center', gap: '15px', margin: '30px 0'}}>
            <div style={{flex: 1, height: '2px', background: 'rgba(255,255,255,0.1)'}}></div>
            <span style={{
              color: 'white',
              fontSize: '14px',
              fontWeight: 'bold',
              padding: '10px 20px',
              background: 'linear-gradient(90deg, #dc2626, #e11d74)',
              borderRadius: '20px',
              animation: 'pulse 2s ease-in-out infinite'
            }}>
              💝 OFERTA SAN VALENTÍN
            </span>
            <div style={{flex: 1, height: '2px', background: 'rgba(255,255,255,0.1)'}}></div>
          </div>
        )}

        {/* Bundle Option */}
        {songs.length >= 2 && (
          <div
            onClick={selectBoth}
            style={{
              background: purchaseBoth 
                ? 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(212,175,55,0.2))' 
                : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
              border: purchaseBoth ? '3px solid #22c55e' : '3px dashed rgba(34,197,94,0.5)',
              borderRadius: '20px',
              padding: '25px',
              cursor: 'pointer',
              marginBottom: '30px',
              position: 'relative',
              transition: 'all 0.3s',
              transform: purchaseBoth ? 'scale(1.01)' : 'scale(1)',
              boxShadow: purchaseBoth ? '0 0 30px rgba(34,197,94,0.2)' : 'none',
              opacity: selectedSongId ? 0.6 : 1
            }}
          >
            <div style={{
              position: 'absolute',
              top: '-12px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'linear-gradient(90deg, #dc2626, #22c55e)',
              color: 'white',
              padding: '8px 24px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: 'bold',
              boxShadow: '0 4px 15px rgba(34,197,94,0.4)'
            }}>
              💘 REGALO PERFECTO - AHORRA ${bundleSavings.toFixed(2)}
            </div>

            <div style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: purchaseBoth ? '3px solid #22c55e' : '3px solid rgba(255,255,255,0.3)',
              background: purchaseBoth ? '#22c55e' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {purchaseBoth && <span style={{color: 'white', fontSize: '16px', fontWeight: 'bold'}}>✓</span>}
            </div>

            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', marginTop: '10px'}}>
              <div>
                <h3 style={{fontSize: '22px', marginBottom: '8px', fontWeight: 'bold'}}>
                  🎁 ¡Regala AMBAS versiones!
                </h3>
                <p style={{color: 'rgba(255,255,255,0.7)', fontSize: '15px', margin: 0}}>
                  ✓ Dos estilos únicos • ✓ Descarga instantánea • ✓ Acceso de por vida
                </p>
              </div>
              <div style={{textAlign: 'right'}}>
                <p style={{color: 'rgba(255,255,255,0.4)', textDecoration: 'line-through', fontSize: '16px', margin: '0 0 5px 0'}}>
                  ${(singlePrice * 2).toFixed(2)}
                </p>
                <p style={{color: purchaseBoth ? '#22c55e' : '#d4af37', fontSize: '36px', fontWeight: 'bold', margin: 0}}>
                  ${bundlePrice}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Selection Summary */}
        {hasSelection && (
          <div style={{
            background: 'rgba(212,175,55,0.1)',
            border: '2px solid #d4af37',
            borderRadius: '12px',
            padding: '15px 20px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <span style={{fontSize: '24px'}}>✓</span>
              <div>
                <p style={{margin: 0, fontWeight: 'bold', color: '#d4af37'}}>Seleccionado:</p>
                <p style={{margin: 0, fontSize: '14px'}}>{getSelectionLabel()}</p>
              </div>
            </div>
            <div style={{textAlign: 'right'}}>
              <p style={{margin: 0, fontSize: '24px', fontWeight: 'bold'}}>
                {isFree ? '¡GRATIS!' : `$${purchaseBoth ? bundlePrice : singlePrice.toFixed(2)}`}
              </p>
            </div>
          </div>
        )}

        {/* Checkout Section */}
        <div style={{background: 'rgba(255,255,255,0.03)', borderRadius: '20px', padding: '25px'}}>
          
          <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap'}}>
            <input
              type="text"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              placeholder="¿Tienes un código de cupón?"
              disabled={!!couponApplied}
              style={{
                flex: 1,
                minWidth: '200px',
                padding: '14px 18px', 
                background: 'rgba(255,255,255,0.05)', 
                border: '2px solid rgba(255,255,255,0.1)', 
                borderRadius: '10px', 
                color: 'white',
                fontSize: '15px'
              }}
            />
            {!couponApplied ? (
              <button 
                onClick={handleApplyCoupon}
                disabled={isLoadingCoupon || !couponCode.trim()}
                style={{
                  padding: '14px 24px', 
                  background: couponCode.trim() ? '#d4af37' : 'rgba(255,255,255,0.1)', 
                  color: couponCode.trim() ? '#1a3a2f' : 'rgba(255,255,255,0.3)', 
                  border: 'none', 
                  borderRadius: '10px', 
                  cursor: couponCode.trim() ? 'pointer' : 'not-allowed', 
                  fontWeight: 'bold',
                  fontSize: '15px'
                }}
              >
                {isLoadingCoupon ? '...' : 'Aplicar'}
              </button>
            ) : (
              <span style={{
                color: '#22c55e', 
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '14px 20px',
                background: 'rgba(34,197,94,0.1)',
                borderRadius: '10px'
              }}>
                ✓ {couponApplied.code} aplicado
              </span>
            )}
          </div>
          {couponError && (
            <p style={{color: '#ef4444', fontSize: '14px', marginTop: '-10px', marginBottom: '15px'}}>{couponError}</p>
          )}

          <button
            onClick={handleCheckout}
            disabled={isCheckingOut || !hasSelection}
            style={{
              width: '100%',
              padding: '22px',
              background: hasSelection ? 'linear-gradient(90deg, #e11d74, #be185d)' : 'rgba(255,255,255,0.1)',
              color: hasSelection ? 'white' : 'rgba(255,255,255,0.3)',
              border: 'none',
              borderRadius: '14px',
              fontSize: '20px',
              fontWeight: 'bold',
              cursor: hasSelection ? 'pointer' : 'not-allowed',
              boxShadow: hasSelection ? '0 4px 20px rgba(225,29,116,0.4)' : 'none'
            }}
          >
            {isCheckingOut ? (
              <span>⏳ Procesando...</span>
            ) : !hasSelection ? (
              <span>👆 Primero selecciona una opción arriba</span>
            ) : isFree ? (
              <span>🎉 Descargar Gratis</span>
            ) : (
              <span>💳 {purchaseBoth ? 'Comprar Ambas Canciones' : 'Comprar Canción Seleccionada'}</span>
            )}
          </button>

          <div style={{display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '20px', flexWrap: 'wrap'}}>
            <span style={{color: 'rgba(255,255,255,0.4)', fontSize: '12px'}}>🔒 Pago Seguro</span>
            <span style={{color: 'rgba(255,255,255,0.4)', fontSize: '12px'}}>⚡ Descarga Instantánea</span>
            <span style={{color: 'rgba(255,255,255,0.4)', fontSize: '12px'}}>✨ Calidad Premium</span>
          </div>
        </div>

        <p style={{textAlign: 'center', marginTop: '30px', color: 'rgba(255,255,255,0.3)', fontSize: '12px'}}>
          RegalosQueCantan © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
