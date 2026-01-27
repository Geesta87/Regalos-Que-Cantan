import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import { createCheckout, validateCoupon } from '../services/api';
import genres from '../config/genres';

// Preview settings
const PREVIEW_START = 15;
const PREVIEW_DURATION = 20;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

export default function ComparisonPage() {
  // Debug: Log that component is mounting
  console.log('🎵 ComparisonPage MOUNTING');
  
  const context = useContext(AppContext);
  console.log('📦 Context received:', context);
  
  // Safely destructure with defaults
  const { 
    formData = {}, 
    songData = {}, 
    setSongData = () => {}, 
    navigateTo = () => {} 
  } = context || {};
  
  console.log('📋 formData:', formData);
  console.log('🎵 songData:', songData);
  
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
  const subGenreName = formData?.subGenre && genreConfig?.subGenres?.[formData.subGenre]?.name;

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
    console.log('🔄 useEffect running, songData:', songData);
    
    try {
      const loadedSongs = [];
      
      if (songData?.songs && Array.isArray(songData.songs) && songData.songs.length > 0) {
        console.log('✅ Found songs array:', songData.songs);
        loadedSongs.push(...songData.songs);
      } 
      else if (songData?.song1) {
        console.log('✅ Found song1/song2 format');
        loadedSongs.push({ ...songData.song1, version: 1 });
        if (songData?.song2) {
          loadedSongs.push({ ...songData.song2, version: 2 });
        }
      }
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

      console.log('📋 Final loaded songs:', loadedSongs);
      
      setSongs(loadedSongs.sort((a, b) => (a.version || 1) - (b.version || 1)));
      
      if (loadedSongs.length > 0) {
        setLoading(false);
        if (loadedSongs.length === 1) {
          setSelectedSongId(loadedSongs[0].id);
        }
      } else {
        setError('No songs available');
        setLoading(false);
      }
    } catch (err) {
      console.error('Error loading songs:', err);
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
        
        audio.play().catch(err => console.error('Play error:', err));
        setPlayingId(songId);
      }
    } catch (err) {
      console.error('Play toggle error:', err);
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
      console.error('Time update error:', err);
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
    
    if (couponCode.trim().toUpperCase() === 'GRATIS100') {
      setCouponApplied({ code: 'GRATIS100', discount: 100, free: true });
      setIsLoadingCoupon(false);
      return;
    }
    
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

  // FIXED: Always use result.url which includes song_id
  const handleCheckout = async () => {
    if (!selectedSongId && !purchaseBoth) {
      alert('Selecciona una canción o elige ambas');
      return;
    }

    setIsCheckingOut(true);
    try {
      const songIds = purchaseBoth ? songs.map(s => s.id) : [selectedSongId];
      const codeToSend = couponApplied?.code || couponCode.trim().toUpperCase() || null;

      console.log('Checkout - songIds:', songIds);
      console.log('Checkout - coupon:', codeToSend);

      const result = await createCheckout(songIds[0], formData?.email, codeToSend);
      
      console.log('Checkout result:', result);

      // FIXED: Always use result.url (includes song_id parameter)
      if (result.url) {
        window.location.href = result.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      console.error('Checkout error:', err);
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

  if (loading) {
    console.log('🔄 Rendering loading state');
    return (
      <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{textAlign: 'center'}}>
          <p style={{fontSize: '24px'}}>⏳ Cargando tus canciones...</p>
        </div>
      </div>
    );
  }

  if (error) {
    console.log('❌ Rendering error state:', error);
    return (
      <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{textAlign: 'center'}}>
          <p style={{fontSize: '24px'}}>❌ Error: {error}</p>
          <button onClick={() => navigateTo('details')} style={{padding: '12px 24px', background: '#e11d74', color: 'white', border: 'none', borderRadius: '8px', marginTop: '20px', cursor: 'pointer'}}>
            Volver a intentar
          </button>
        </div>
      </div>
    );
  }

  if (!songs || songs.length === 0) {
    console.log('⚠️ Rendering no songs state');
    return (
      <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{textAlign: 'center'}}>
          <p style={{fontSize: '24px'}}>⚠️ No se encontraron canciones</p>
          <button onClick={() => navigateTo('details')} style={{padding: '12px 24px', background: '#e11d74', color: 'white', border: 'none', borderRadius: '8px', marginTop: '20px', cursor: 'pointer'}}>
            Volver a intentar
          </button>
        </div>
      </div>
    );
  }

  console.log('✅ Rendering main content with', songs.length, 'songs');
  
  return (
    <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh', padding: '20px'}}>
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

      <div style={{maxWidth: '900px', margin: '0 auto', paddingTop: '60px'}}>
        <h1 style={{fontSize: '32px', textAlign: 'center', marginBottom: '10px'}}>¡Elige tu favorita!</h1>
        <p style={{textAlign: 'center', color: '#d4af37', marginBottom: '40px'}}>
          {songs.length} versiones para {formData?.recipientName || 'ti'}
        </p>

        {/* Song Cards */}
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '30px'}}>
          {songs.map((song, index) => (
            <div
              key={song.id}
              onClick={() => selectSong(song.id)}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: selectedSongId === song.id ? '3px solid #d4af37' : '2px solid rgba(255,255,255,0.1)',
                borderRadius: '16px',
                padding: '20px',
                cursor: 'pointer',
                transition: 'all 0.3s'
              }}
            >
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                <span style={{background: index === 0 ? '#3b82f6' : '#8b5cf6', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold'}}>
                  Versión {song.version || index + 1}
                </span>
                {selectedSongId === song.id && <span style={{color: '#d4af37', fontSize: '24px'}}>✓</span>}
              </div>

              <div style={{height: '150px', background: 'linear-gradient(135deg, rgba(212,175,55,0.2), rgba(225,29,116,0.2))', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '15px'}}>
                {song.imageUrl ? (
                  <img src={song.imageUrl} alt="" style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px'}} />
                ) : (
                  <span style={{fontSize: '48px'}}>🎵</span>
                )}
              </div>

              <h3 style={{fontSize: '18px', marginBottom: '5px'}}>Para {formData?.recipientName || 'ti'}</h3>
              <p style={{color: '#d4af37', fontSize: '12px', marginBottom: '15px'}}>{genreName}</p>

              <button
                onClick={(e) => { e.stopPropagation(); handlePlay(song.id); }}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: playingId === song.id ? '#d4af37' : 'rgba(255,255,255,0.1)',
                  color: playingId === song.id ? '#1a3a2f' : 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {playingId === song.id ? '⏸ Pausar' : '▶ Escuchar Preview'}
              </button>

              <div style={{marginTop: '10px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px'}}>
                <div style={{height: '100%', background: '#d4af37', borderRadius: '2px', width: `${((currentTimes[song.id] || 0) / PREVIEW_DURATION) * 100}%`, transition: 'width 0.1s'}} />
              </div>
              <p style={{fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '5px', textAlign: 'right'}}>
                {formatTime(currentTimes[song.id] || 0)} / 0:20
              </p>
            </div>
          ))}
        </div>

        {/* Bundle Option */}
        {songs.length >= 2 && (
          <div
            onClick={selectBoth}
            style={{
              background: 'linear-gradient(90deg, rgba(212,175,55,0.1), rgba(225,29,116,0.1))',
              border: purchaseBoth ? '3px solid #d4af37' : '2px solid rgba(255,255,255,0.2)',
              borderRadius: '16px',
              padding: '20px',
              cursor: 'pointer',
              marginBottom: '30px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '15px'
            }}
          >
            <div>
              <h3 style={{fontSize: '20px', marginBottom: '5px'}}>🎁 ¡Llévate ambas versiones!</h3>
              <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '14px'}}>Perfecto para compartir</p>
            </div>
            <div style={{textAlign: 'right'}}>
              <p style={{color: 'rgba(255,255,255,0.4)', textDecoration: 'line-through'}}>${(singlePrice * 2).toFixed(2)}</p>
              <p style={{color: '#d4af37', fontSize: '28px', fontWeight: 'bold'}}>${bundlePrice}</p>
              <p style={{color: '#22c55e', fontSize: '12px', fontWeight: 'bold'}}>¡AHORRA ${bundleSavings.toFixed(2)}!</p>
            </div>
          </div>
        )}

        {/* Checkout */}
        <div style={{background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', marginBottom: '20px'}}>
            <div>
              <p style={{color: 'rgba(255,255,255,0.5)', fontSize: '14px', marginBottom: '5px'}}>
                {purchaseBoth ? '2 Canciones' : selectedSongId ? '1 Canción' : 'Selecciona'}
              </p>
              <p style={{fontSize: '32px', fontWeight: 'bold'}}>
                {isFree ? '¡GRATIS!' : `$${purchaseBoth ? bundlePrice : singlePrice.toFixed(2)}`}
              </p>
            </div>

            <div>
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="Código de Cupón"
                disabled={!!couponApplied}
                style={{padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', marginRight: '10px'}}
              />
              {!couponApplied && (
                <button onClick={handleApplyCoupon} style={{padding: '12px 16px', background: '#d4af37', color: '#1a3a2f', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'}}>
                  Aplicar
                </button>
              )}
              {couponApplied && <span style={{color: '#22c55e'}}>✓ Aplicado</span>}
            </div>
          </div>

          <button
            onClick={handleCheckout}
            disabled={isCheckingOut || (!selectedSongId && !purchaseBoth)}
            style={{
              width: '100%',
              padding: '20px',
              background: (selectedSongId || purchaseBoth) ? '#e11d74' : 'rgba(255,255,255,0.1)',
              color: (selectedSongId || purchaseBoth) ? 'white' : 'rgba(255,255,255,0.3)',
              border: 'none',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: (selectedSongId || purchaseBoth) ? 'pointer' : 'not-allowed'
            }}
          >
            {isCheckingOut ? '⏳ Procesando...' : isFree ? 'Descargar Gratis' : purchaseBoth ? 'Comprar Ambas' : selectedSongId ? 'Comprar Seleccionada' : 'Selecciona una opción'}
          </button>
        </div>

        <p style={{textAlign: 'center', marginTop: '30px', color: 'rgba(255,255,255,0.3)', fontSize: '12px'}}>
          RegalosQueCantan © 2025
        </p>
      </div>
    </div>
  );
}
