import React, { useEffect, useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ⏱️ Preview limits
const PREVIEW_START = 10;
const PREVIEW_DURATION = 20;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

// 💰 Pricing
const SINGLE_PRICE = 29.99;
const BUNDLE_PRICE = 39.99;

// Robust payment check (same logic as AdminDashboard)
const isSongPaid = (song) => {
  if (!song) return false;
  if (song.paid === true || song.paid === 'true' || song.paid === 1) return true;
  if (song.is_paid === true) return true;
  if (song.payment_status === 'paid' || song.payment_status === 'completed' || song.payment_status === 'succeeded') return true;
  if (song.stripe_payment_id) return true;
  if (song.paid_at) return true;
  if (song.amount_paid && parseFloat(song.amount_paid) > 0) return true;
  return false;
};

// ⏰ Countdown Timer Component
function CountdownTimer() {
  const [timeLeft, setTimeLeft] = useState({ minutes: 30, seconds: 0 });
  const [expired, setExpired] = useState(false);
  const expireTimeRef = useRef(Date.now() + (30 * 60 * 1000));

  useEffect(() => {
    const tick = () => {
      const diff = expireTimeRef.current - Date.now();
      if (diff <= 0) { setExpired(true); return; }
      setTimeLeft({
        minutes: Math.floor(diff / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000)
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  if (expired) {
    return (
      <div style={{display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center'}}>
        <span style={{color: '#f87171', fontWeight: '700', fontSize: '14px'}}>⚠️ Tiempo expirado</span>
      </div>
    );
  }

  const pad = (n) => n.toString().padStart(2, '0');

  return (
    <div style={{display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center'}}>
      {[
        { val: pad(timeLeft.minutes), label: 'min' },
        { val: pad(timeLeft.seconds), label: 'seg' }
      ].map((unit, i) => (
        <div key={i} style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
          <div style={{
            background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '8px', padding: '6px 10px', minWidth: '44px', textAlign: 'center'
          }}>
            <span style={{fontSize: '20px', fontWeight: '900', color: '#f87171', fontVariantNumeric: 'tabular-nums'}}>
              {unit.val}
            </span>
          </div>
          <span style={{fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: '600'}}>{unit.label}</span>
          {i < 1 && <span style={{color: 'rgba(239,68,68,0.5)', fontWeight: '900', fontSize: '18px', marginLeft: '2px'}}>:</span>}
        </div>
      ))}
    </div>
  );
}

export default function ShareablePreviewPage() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  // Player state
  const [playingId, setPlayingId] = useState(null);
  const [currentTimes, setCurrentTimes] = useState({});
  const [playCounts, setPlayCounts] = useState({});

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [purchaseMode, setPurchaseMode] = useState(null);

  // Checkout state
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [emailInput, setEmailInput] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [allPaid, setAllPaid] = useState(false);

  // Social proof
  const [socialProofCount] = useState(Math.floor(Math.random() * 80) + 120); // 120-200 // 38-55

  const audioRefs = useRef({});

  const urlParams = new URLSearchParams(window.location.search);
  const songIdsParam = urlParams.get('song_ids') || urlParams.get('song_id') || urlParams.get('id');

  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100);
  }, []);

  useEffect(() => {
    if (songIdsParam) {
      loadSongs();
    } else {
      setError('No se encontró el enlace de la canción.');
      setLoading(false);
    }
  }, [songIdsParam]);

  const loadSongs = async () => {
    try {
      setLoading(true);
      const ids = songIdsParam.split(',').map(id => id.trim()).filter(Boolean);
      const { data, error: fetchError } = await supabase.from('songs').select('*').in('id', ids);
      if (fetchError || !data || data.length === 0) throw new Error('No se encontraron las canciones.');
      setSongs(data);
      if (data.every(s => isSongPaid(s))) setAllPaid(true);
      const email = data.find(s => s.email)?.email;
      if (email) setEmailInput(email);
      if (data.length === 1) {
        setSelectedIds(new Set([data[0].id]));
        setPurchaseMode('single');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ========== AUDIO CONTROLS ==========
  const stopAllAudio = () => {
    Object.values(audioRefs.current).forEach(a => { if (a) { a.pause(); a.currentTime = PREVIEW_START; } });
    setPlayingId(null);
  };

  const togglePlay = (songId) => {
    const audio = audioRefs.current[songId];
    if (!audio) return;
    if (playingId === songId) { audio.pause(); setPlayingId(null); }
    else {
      stopAllAudio();
      if (audio.currentTime < PREVIEW_START || audio.currentTime >= PREVIEW_END) audio.currentTime = PREVIEW_START;
      audio.volume = 0.8;
      audio.play().then(() => setPlayingId(songId)).catch(() => {});
    }
  };

  const handleTimeUpdate = (songId) => {
    const audio = audioRefs.current[songId];
    if (!audio) return;
    if (audio.currentTime >= PREVIEW_END) {
      audio.pause(); audio.currentTime = PREVIEW_START;
      setPlayingId(null);
      setCurrentTimes(p => ({ ...p, [songId]: 0 }));
      setPlayCounts(p => ({ ...p, [songId]: (p[songId] || 0) + 1 }));
      return;
    }
    if (audio.currentTime < PREVIEW_START) audio.currentTime = PREVIEW_START;
    setCurrentTimes(p => ({ ...p, [songId]: audio.currentTime - PREVIEW_START }));
  };

  const handleSeek = (songId, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audioRefs.current[songId]) audioRefs.current[songId].currentTime = PREVIEW_START + (percent * PREVIEW_DURATION);
  };

  const formatTime = (t) => {
    if (!t || isNaN(t) || t < 0) return '0:00';
    return `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  };

  // ========== SELECTION ==========
  const handleSelectSong = (songId) => {
    if (songs.length === 1) return;
    const n = new Set(selectedIds);
    n.has(songId) ? n.delete(songId) : n.add(songId);
    setSelectedIds(n);
    setPurchaseMode(n.size === 0 ? null : n.size === 1 ? 'single' : 'bundle');
  };

  const handleSelectBoth = () => {
    setSelectedIds(new Set(songs.map(s => s.id)));
    setPurchaseMode('bundle');
  };

  // ========== CHECKOUT ==========
  const handleBuy = async () => {
    if (allPaid) { window.location.href = `/success?song_ids=${songs.map(s => s.id).join(',')}`; return; }
    if (selectedIds.size === 0) return;
    const email = emailInput || songs.find(s => s.email)?.email;
    if (!email) { setShowEmailForm(true); return; }
    setCheckoutLoading(true); setCheckoutError(null);
    try {
      const idsArray = Array.from(selectedIds);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ songIds: idsArray, email, purchaseBoth: idsArray.length >= 2 })
      });
      const data = await res.json();
      if (!data.success || !data.url) throw new Error(data.error || 'Error al crear checkout.');
      window.location.href = data.url;
    } catch (err) {
      setCheckoutError(err.message || 'Error al procesar.');
      setCheckoutLoading(false);
    }
  };

  const currentPrice = purchaseMode === 'bundle' ? BUNDLE_PRICE : SINGLE_PRICE;
  const recipientName = songs[0]?.recipient_name || '';
  const createdAt = songs[0]?.created_at;

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div style={styles.fullScreen}>
        <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }`}</style>
        <div style={{textAlign: 'center'}}>
          <div style={{fontSize: '48px', marginBottom: '20px', animation: 'pulse 1.5s ease-in-out infinite'}}>🎵</div>
          <p style={{fontSize: '18px', color: 'rgba(255,255,255,0.8)'}}>Cargando preview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{...styles.fullScreen, padding: '20px'}}>
        <div style={{textAlign: 'center', maxWidth: '400px'}}>
          <div style={{fontSize: '48px', marginBottom: '16px'}}>😕</div>
          <p style={{color: '#f87171', marginBottom: '16px', fontSize: '18px'}}>{error}</p>
          <a href="/" style={{color: '#4ade80', textDecoration: 'underline'}}>Ir al inicio</a>
        </div>
      </div>
    );
  }

  if (songs.every(s => !s.audio_url)) {
    return (
      <div style={{...styles.fullScreen, padding: '20px'}}>
        <div style={styles.card}>
          <div style={{fontSize: '48px', marginBottom: '16px'}}>⏳</div>
          <h1 style={{fontSize: '22px', fontWeight: 'bold', marginBottom: '12px'}}>Canciones en proceso</h1>
          <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '15px', marginBottom: '24px'}}>
            Las canciones para <span style={{color: '#f74da6', fontWeight: '600'}}>{recipientName}</span> todavía se están generando.
          </p>
          <button onClick={loadSongs} style={styles.retryBtn}>🔄 Verificar de nuevo</button>
        </div>
      </div>
    );
  }

  // ==================== MAIN PREVIEW PAGE ====================
  return (
    <div style={{background: 'linear-gradient(160deg, #110d0f 0%, #181114 40%, #1e1519 70%, #151015 100%)', color: 'white', minHeight: '100vh', padding: '0 0 40px', overflow: 'hidden'}}>

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 20px rgba(242,13,128,0.3); } 50% { box-shadow: 0 0 35px rgba(242,13,128,0.5); } }
        @keyframes eq1 { 0%, 100% { height: 10px; } 50% { height: 28px; } }
        @keyframes eq2 { 0%, 100% { height: 20px; } 50% { height: 10px; } }
        @keyframes eq3 { 0%, 100% { height: 15px; } 50% { height: 30px; } }
        @keyframes eq4 { 0%, 100% { height: 8px; } 50% { height: 24px; } }
        @keyframes bounceIn { 0% { opacity: 0; transform: scale(0.3); } 50% { transform: scale(1.05); } 70% { transform: scale(0.95); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes urgentPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes slideIn { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes bundleGlow { 0%, 100% { box-shadow: 0 0 30px rgba(242,13,128,0.15), inset 0 0 30px rgba(242,13,128,0.05); } 50% { box-shadow: 0 0 50px rgba(242,13,128,0.3), inset 0 0 40px rgba(242,13,128,0.08); } }
      `}</style>

      {/* Hidden Audio */}
      {songs.map(song => song.audio_url && (
        <audio key={song.id} ref={el => audioRefs.current[song.id] = el} src={song.audio_url}
          onTimeUpdate={() => handleTimeUpdate(song.id)}
          onEnded={() => { setPlayingId(null); setCurrentTimes(p => ({...p, [song.id]: 0})); }}
          preload="auto" />
      ))}

      {/* ===== URGENCY TOP BAR ===== */}
      {!allPaid && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(239,68,68,0.15), rgba(239,68,68,0.08), rgba(239,68,68,0.15))',
          borderBottom: '1px solid rgba(239,68,68,0.2)',
          padding: '12px 16px', textAlign: 'center',
          animation: 'fadeInUp 0.5s ease-out'
        }}>
          <p style={{fontSize: '13px', color: '#fca5a5', margin: '0 0 8px 0', fontWeight: '600', animation: 'urgentPulse 2s ease-in-out infinite'}}>
            ⏰ Tu canción personalizada será eliminada en:
          </p>
          {createdAt && <CountdownTimer />}
        </div>
      )}

      <div style={{
        maxWidth: '520px', margin: '0 auto', padding: '20px 16px',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>

        {/* ===== SOCIAL PROOF BAR ===== */}
        {!allPaid && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            marginBottom: '20px', animation: 'slideIn 0.6s ease-out 0.3s both'
          }}>
            <div style={{display: 'flex'}}>
              {['🇲🇽', '🇺🇸', '🇨🇴'].map((flag, i) => (
                <div key={i} style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)', border: '2px solid #110d0f',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '14px', marginLeft: i > 0 ? '-8px' : '0', zIndex: 3 - i
                }}>{flag}</div>
              ))}
            </div>
            <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: 0}}>
              <span style={{color: '#4ade80', fontWeight: '700'}}>{socialProofCount} personas</span> compraron canciones esta semana
            </p>
          </div>
        )}

        {/* ===== HEADER ===== */}
        <div style={{
          textAlign: 'center', marginBottom: '24px',
          animation: 'bounceIn 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)'
        }}>
          <div style={{
            display: 'inline-block',
            background: 'linear-gradient(135deg, rgba(242,13,128,0.25), rgba(242,13,128,0.1))',
            borderRadius: '50px', padding: '8px 20px',
            border: '1px solid rgba(242,13,128,0.3)',
            marginBottom: '20px'
          }}>
            <span style={{fontSize: '13px', color: '#f74da6', fontWeight: '600', letterSpacing: '0.5px'}}>
              🎧 PREVIEW • 20 SEGUNDOS {songs.length > 1 ? `• ${songs.length} VERSIONES` : ''}
            </span>
          </div>

          <h1 style={{fontSize: '26px', fontWeight: 'bold', marginBottom: '8px'}}>
            🎵 {songs.length > 1 ? 'Dos canciones' : 'Una canción'} para
          </h1>

          <p style={{
            fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0',
            background: 'linear-gradient(90deg, #f74da6, #fbbf24, #f74da6)',
            backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            animation: 'shimmer 3s linear infinite'
          }}>
            {recipientName}
          </p>

          {songs[0]?.sender_name && (
            <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: 0}}>
              De: {songs[0].sender_name}
            </p>
          )}

          {songs.length > 1 && !allPaid && (
            <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.55)', marginTop: '12px', lineHeight: '1.5'}}>
              Escucha ambas versiones y elige tu favorita — o llévate las dos.
            </p>
          )}
        </div>

        {/* ===== SONG CARDS ===== */}
        {songs.map((song, index) => {
          if (!song.audio_url) return null;
          const isSelected = selectedIds.has(song.id);
          const isCurrentlyPlaying = playingId === song.id;
          const songTime = currentTimes[song.id] || 0;
          const progressPercent = (songTime / PREVIEW_DURATION) * 100;

          return (
            <div key={song.id} style={{
              background: isSelected
                ? 'linear-gradient(145deg, rgba(34,197,94,0.12), rgba(34,197,94,0.04))'
                : 'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
              borderRadius: '24px', padding: '24px',
              border: `2px solid ${isSelected ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.1)'}`,
              marginBottom: '16px',
              boxShadow: isSelected ? '0 8px 30px rgba(34,197,94,0.15)' : '0 8px 30px rgba(0,0,0,0.2)',
              transition: 'all 0.3s',
              animation: isVisible ? `fadeInUp 0.8s ease-out ${0.2 + index * 0.15}s both` : 'none'
            }}>
              {/* Version label */}
              {songs.length > 1 && (
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
                  <span style={{fontSize: '14px', fontWeight: '700', color: isSelected ? '#4ade80' : 'rgba(255,255,255,0.7)'}}>
                    {index === 0 ? '💫' : '🔥'} Versión {index + 1}
                  </span>
                  {isSelected && <span style={{fontSize: '12px', color: '#4ade80', fontWeight: '600'}}>✓ Seleccionada</span>}
                </div>
              )}

              {/* Player row */}
              <div style={{display: 'flex', gap: '16px', alignItems: 'center', marginBottom: songs.length > 1 && !allPaid ? '16px' : '0'}}>
                <div style={{
                  width: songs.length > 1 ? '90px' : '140px', height: songs.length > 1 ? '90px' : '140px',
                  minWidth: songs.length > 1 ? '90px' : '140px',
                  borderRadius: '14px', overflow: 'hidden', position: 'relative',
                  animation: isCurrentlyPlaying ? 'glow 2.5s ease-in-out infinite' : 'none',
                  background: 'linear-gradient(135deg, #1e3a5f, #4c1d95)',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
                }}>
                  {song.image_url ? (
                    <img src={song.image_url} alt="" style={{width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.5s', transform: isCurrentlyPlaying ? 'scale(1.05)' : 'scale(1)'}}
                      onError={(e) => { e.target.style.display = 'none'; }} />
                  ) : (
                    <span style={{fontSize: songs.length > 1 ? '40px' : '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>🎵</span>
                  )}
                  {isCurrentlyPlaying && (
                    <div style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: '30px', background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '3px', paddingBottom: '6px'}}>
                      {[0.6, 0.5, 0.7, 0.4, 0.8].map((dur, i) => (
                        <div key={i} style={{width: '3px', background: '#f74da6', borderRadius: '2px', animation: `eq${(i % 4) + 1} ${dur}s ease-in-out infinite`}} />
                      ))}
                    </div>
                  )}
                </div>

                <div style={{flex: 1}}>
                  <p style={{fontSize: '12px', color: '#f74da6', margin: '0 0 8px 0', textTransform: 'capitalize'}}>
                    {(song.genre_name || song.genre || '').replace(/_/g, ' ')}{song.occasion ? ` • ${song.occasion.replace(/_/g, ' ')}` : ''}
                  </p>
                  <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                    <button onClick={() => togglePlay(song.id)} style={{
                      width: '48px', height: '48px', minWidth: '48px', borderRadius: '50%', border: 'none',
                      background: isCurrentlyPlaying ? 'linear-gradient(135deg, #f74da6, #f20d80)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      boxShadow: isCurrentlyPlaying ? '0 4px 15px rgba(242,13,128,0.4)' : '0 4px 15px rgba(34,197,94,0.4)',
                      transition: 'all 0.3s'
                    }}>
                      {isCurrentlyPlaying ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#181114"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white" style={{marginLeft: '2px'}}><path d="M8 5v14l11-7z"/></svg>
                      )}
                    </button>
                    <div style={{flex: 1}}>
                      <div onClick={(e) => handleSeek(song.id, e)} style={{height: '6px', background: 'rgba(255,255,255,0.12)', borderRadius: '3px', cursor: 'pointer', overflow: 'hidden', marginBottom: '4px'}}>
                        <div style={{height: '100%', background: 'linear-gradient(90deg, #f74da6, #f20d80)', borderRadius: '3px', width: `${progressPercent || 0}%`, transition: 'width 0.1s'}} />
                      </div>
                      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(255,255,255,0.4)'}}>
                        <span>{formatTime(songTime)}</span>
                        <span>{formatTime(PREVIEW_DURATION)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Select button (multi-song only) */}
              {songs.length > 1 && !allPaid && (
                <button onClick={() => handleSelectSong(song.id)} style={{
                  width: '100%', padding: '12px',
                  background: isSelected ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                  border: `2px solid ${isSelected ? '#22c55e' : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: '12px', color: isSelected ? '#4ade80' : 'rgba(255,255,255,0.7)',
                  fontSize: '14px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s'
                }}>
                  {isSelected ? `✓ Seleccionada — $${SINGLE_PRICE}` : `Elegir Versión ${index + 1} — $${SINGLE_PRICE}`}
                </button>
              )}
            </div>
          );
        })}

        {/* ===== 🔥 PREMIUM BUNDLE CARD (multi-song only) ===== */}
        {songs.length > 1 && !allPaid && (
          <div
            onClick={handleSelectBoth}
            style={{
              position: 'relative',
              background: purchaseMode === 'bundle'
                ? 'linear-gradient(145deg, rgba(242,13,128,0.12), rgba(242,13,128,0.04))'
                : 'linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
              borderRadius: '24px', padding: '28px',
              border: `2px solid ${purchaseMode === 'bundle' ? '#f74da6' : 'rgba(255,255,255,0.1)'}`,
              marginBottom: '20px', cursor: 'pointer', transition: 'all 0.3s',
              animation: isVisible ? `fadeInUp 0.8s ease-out 0.5s both${purchaseMode === 'bundle' ? ', bundleGlow 3s ease-in-out infinite' : ''}` : 'none',
              overflow: 'hidden'
            }}
          >
            {/* "MEJOR VALOR" badge */}
            <div style={{
              position: 'absolute', top: '16px', right: '-30px',
              background: 'linear-gradient(90deg, #ef4444, #dc2626)',
              color: 'white', fontSize: '11px', fontWeight: '800',
              padding: '5px 40px', transform: 'rotate(35deg)',
              letterSpacing: '1px', boxShadow: '0 2px 8px rgba(239,68,68,0.4)'
            }}>
              MEJOR VALOR
            </div>

            {/* Big overlapping thumbnails — centered */}
            <div style={{display: 'flex', justifyContent: 'center', marginBottom: '20px'}}>
              <div style={{position: 'relative', width: '160px', height: '90px'}}>
                {songs.slice(0, 2).map((s, i) => (
                  <div key={s.id} style={{
                    position: 'absolute',
                    left: i === 0 ? '0' : '76px', top: i === 0 ? '0' : '4px',
                    width: '80px', height: '80px',
                    borderRadius: '16px', overflow: 'hidden',
                    border: `3px solid ${purchaseMode === 'bundle' ? '#f74da6' : 'rgba(255,255,255,0.2)'}`,
                    background: 'linear-gradient(135deg, #1e3a5f, #4c1d95)',
                    zIndex: i === 0 ? 2 : 1,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                    transition: 'all 0.3s',
                    transform: purchaseMode === 'bundle' ? `rotate(${i === 0 ? '-5' : '5'}deg) scale(1.02)` : `rotate(${i === 0 ? '-3' : '3'}deg)`
                  }}>
                    {s.image_url ? (
                      <img src={s.image_url} alt="" style={{width: '100%', height: '100%', objectFit: 'cover'}} onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <span style={{fontSize: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>
                        {i === 0 ? '💫' : '🔥'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Bundle text */}
            <div style={{textAlign: 'center'}}>
              <p style={{
                fontSize: '20px', fontWeight: '900', margin: '0 0 6px 0',
                color: purchaseMode === 'bundle' ? '#f74da6' : 'white'
              }}>
                {purchaseMode === 'bundle' ? '✓ ' : ''}Llevarme las dos canciones
              </p>
              <p style={{fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: '0 0 16px 0'}}>
                Ambas versiones completas • Descarga ilimitada
              </p>

              {/* Price comparison */}
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px'}}>
                <span style={{
                  fontSize: '16px', color: 'rgba(255,255,255,0.35)',
                  textDecoration: 'line-through', fontWeight: '600'
                }}>
                  ${(SINGLE_PRICE * 2).toFixed(2)}
                </span>
                <span style={{
                  fontSize: '32px', fontWeight: '900',
                  color: purchaseMode === 'bundle' ? '#f74da6' : 'white'
                }}>
                  ${BUNDLE_PRICE}
                </span>
              </div>

              {/* Savings callout */}
              <div style={{
                display: 'inline-block', marginTop: '8px',
                background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: '50px', padding: '4px 14px'
              }}>
                <span style={{fontSize: '13px', color: '#4ade80', fontWeight: '700'}}>
                  💰 Ahorras ${(SINGLE_PRICE * 2 - BUNDLE_PRICE).toFixed(2)} — precio especial
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ===== PREVIEW + URGENCY NOTICE ===== */}
        {!allPaid && (
          <div style={{
            textAlign: 'center', marginBottom: '20px',
            animation: isVisible ? 'fadeInUp 0.8s ease-out 0.45s both' : 'none'
          }}>
            <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: '0 0 6px 0'}}>
              🔒 Previews de 20 segundos. Compra para descargar la canción completa (~3 min).
            </p>
            <p style={{fontSize: '12px', color: '#fca5a5', margin: 0, fontWeight: '600'}}>
              ⚠️ Si no compras antes de que expire el tiempo, la canción será eliminada permanentemente.
            </p>
          </div>
        )}

        {/* ===== BUY CTA ===== */}
        <div style={{
          marginBottom: '24px',
          animation: isVisible ? `fadeInUp 0.8s ease-out ${songs.length > 1 ? '0.55s' : '0.4s'} both` : 'none'
        }}>
          {allPaid ? (
            <div style={{textAlign: 'center'}}>
              <div style={{
                background: 'rgba(34,197,94,0.15)', borderRadius: '14px',
                padding: '16px', marginBottom: '12px', border: '1px solid rgba(34,197,94,0.3)'
              }}>
                <p style={{fontSize: '15px', color: '#4ade80', margin: 0, fontWeight: '600'}}>
                  ✅ {songs.length > 1 ? '¡Estas canciones ya fueron compradas!' : '¡Esta canción ya fue comprada!'}
                </p>
              </div>
              <button onClick={() => { window.location.href = `/success?song_ids=${songs.map(s => s.id).join(',')}`; }} style={{
                width: '100%', padding: '20px',
                background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                color: 'white', fontWeight: 'bold', fontSize: '18px',
                border: 'none', borderRadius: '14px', cursor: 'pointer',
                boxShadow: '0 6px 25px rgba(34,197,94,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'
              }}>
                🎧 Ir a Descargar
              </button>
            </div>
          ) : (
            <>
              {/* Email form */}
              {showEmailForm && !emailInput && (
                <div style={{
                  background: 'rgba(255,255,255,0.06)', borderRadius: '14px',
                  padding: '20px', marginBottom: '12px', border: '1px solid rgba(255,255,255,0.12)'
                }}>
                  <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.7)', margin: '0 0 12px 0', textAlign: 'center'}}>
                    📧 Ingresa tu email para continuar:
                  </p>
                  <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="tu@email.com"
                    style={{
                      width: '100%', padding: '14px 16px', background: 'rgba(255,255,255,0.08)',
                      border: '2px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: 'white',
                      fontSize: '16px', outline: 'none', boxSizing: 'border-box'
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && emailInput && handleBuy()}
                  />
                </div>
              )}

              {checkoutError && (
                <div style={{
                  background: 'rgba(239,68,68,0.15)', borderRadius: '10px',
                  padding: '12px', marginBottom: '12px', border: '1px solid rgba(239,68,68,0.3)', textAlign: 'center'
                }}>
                  <p style={{fontSize: '13px', color: '#f87171', margin: 0}}>{checkoutError}</p>
                </div>
              )}

              {/* Main buy button */}
              <button
                onClick={handleBuy}
                disabled={checkoutLoading || selectedIds.size === 0 || (showEmailForm && !emailInput)}
                style={{
                  width: '100%', padding: '20px',
                  background: checkoutLoading || selectedIds.size === 0
                    ? 'rgba(255,255,255,0.1)'
                    : 'linear-gradient(90deg, #f74da6, #f20d80)',
                  color: checkoutLoading || selectedIds.size === 0 ? 'rgba(255,255,255,0.4)' : '#181114',
                  fontWeight: 'bold', fontSize: '18px',
                  border: 'none', borderRadius: '14px',
                  cursor: checkoutLoading || selectedIds.size === 0 ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  boxShadow: selectedIds.size > 0 && !checkoutLoading ? '0 6px 25px rgba(242,13,128,0.4)' : 'none',
                  animation: !checkoutLoading && selectedIds.size > 0 && Object.values(playCounts).some(c => c > 0) ? 'pulse 2s ease-in-out infinite' : 'none',
                  transition: 'all 0.3s',
                  opacity: (showEmailForm && !emailInput) ? 0.5 : 1
                }}
              >
                {checkoutLoading ? (
                  <>
                    <div style={{width: '20px', height: '20px', border: '3px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite'}} />
                    Procesando...
                  </>
                ) : selectedIds.size === 0 ? (
                  '👆 Elige una canción arriba'
                ) : (
                  `🎁 Comprar ${purchaseMode === 'bundle' ? 'Ambas' : 'Canción'} — $${currentPrice.toFixed(2)}`
                )}
              </button>

              {/* Trust + urgency under button */}
              <div style={{textAlign: 'center', marginTop: '12px'}}>
                <p style={{fontSize: '13px', color: 'rgba(255,255,255,0.45)', margin: 0}}>
                  💳 Pago seguro con Stripe • Descarga inmediata
                </p>
              </div>
            </>
          )}
        </div>

        {/* ===== SOCIAL PROOF TESTIMONIALS ===== */}
        {!allPaid && (
          <div style={{
            background: 'rgba(255,255,255,0.04)', borderRadius: '20px',
            padding: '20px', marginBottom: '24px',
            border: '1px solid rgba(255,255,255,0.08)',
            animation: isVisible ? 'fadeInUp 0.8s ease-out 0.6s both' : 'none'
          }}>
            <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.35)', margin: '0 0 12px 0', textAlign: 'center', fontWeight: '600', letterSpacing: '1px'}}>
              ⭐⭐⭐⭐⭐ LO QUE DICEN NUESTROS CLIENTES
            </p>
            {[
              { name: 'María G.', text: 'Mi mamá lloró cuando escuchó su nombre. ¡El mejor regalo que le he dado!', flag: '🇲🇽' },
              { name: 'Carlos R.', text: 'Le puse la canción a mi esposa y no podía creerlo. 100% vale la pena.', flag: '🇺🇸' }
            ].map((review, i) => (
              <div key={i} style={{
                padding: '12px', borderRadius: '12px',
                background: 'rgba(255,255,255,0.04)',
                marginBottom: i < 1 ? '8px' : '0'
              }}>
                <p style={{fontSize: '13px', color: 'rgba(255,255,255,0.6)', margin: '0 0 6px 0', fontStyle: 'italic', lineHeight: '1.5'}}>
                  "{review.text}"
                </p>
                <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.35)', margin: 0, fontWeight: '600'}}>
                  — {review.name} {review.flag}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ===== WHAT'S INCLUDED ===== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(242,13,128,0.12), rgba(225,29,116,0.08))',
          borderRadius: '20px', padding: '24px',
          border: '1px solid rgba(242,13,128,0.2)',
          marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.65s both' : 'none'
        }}>
          <h3 style={{fontSize: '18px', fontWeight: '700', marginBottom: '20px', textAlign: 'center'}}>
            ✨ ¿Qué incluye?
          </h3>
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
            {[
              { icon: '🎵', title: 'Canción completa', desc: `~3 minutos de música personalizada${purchaseMode === 'bundle' ? ' (x2)' : ''}` },
              { icon: '📥', title: 'Descarga MP3', desc: 'Descarga ilimitada para siempre' },
              { icon: '💌', title: 'Comparte fácil', desc: 'Envía por WhatsApp con un tap' },
              { icon: '🎁', title: 'Regalo único', desc: `${recipientName} va a escuchar su nombre en la canción` }
            ].map((item, i) => (
              <div key={i} style={{display: 'flex', alignItems: 'center', gap: '14px'}}>
                <div style={{
                  width: '44px', height: '44px', minWidth: '44px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px',
                  border: '2px solid rgba(255,255,255,0.15)'
                }}>
                  {item.icon}
                </div>
                <div>
                  <p style={{fontSize: '15px', fontWeight: '700', margin: '0 0 2px 0'}}>{item.title}</p>
                  <p style={{fontSize: '13px', color: 'rgba(255,255,255,0.55)', margin: 0}}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ===== EMOTIONAL FOOTER ===== */}
        <div style={{
          textAlign: 'center', marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.7s both' : 'none'
        }}>
          <p style={{
            fontSize: '15px', color: 'rgba(255,255,255,0.55)',
            fontStyle: 'italic', lineHeight: '1.6',
            maxWidth: '350px', margin: '0 auto'
          }}>
            "Imagina la cara de {recipientName} cuando escuche su nombre en esta canción. Eso no tiene precio." 🎁
          </p>
        </div>

        {/* Create your own */}
        <div style={{textAlign: 'center', animation: isVisible ? 'fadeInUp 0.8s ease-out 0.8s both' : 'none'}}>
          <a href="/" style={{
            display: 'inline-block', padding: '12px 28px',
            background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)',
            textDecoration: 'none', fontSize: '14px', borderRadius: '50px',
            border: '1px solid rgba(255,255,255,0.15)', transition: 'all 0.3s'
          }}>
            🎤 Crea tu propia canción personalizada
          </a>
        </div>

        <p style={{textAlign: 'center', marginTop: '30px', color: 'rgba(255,255,255,0.25)', fontSize: '12px'}}>
          RegalosQueCantan © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

const styles = {
  fullScreen: {
    background: 'linear-gradient(160deg, #110d0f, #181114, #151015)',
    color: 'white', minHeight: '100vh',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  card: {
    maxWidth: '420px', width: '100%',
    background: 'rgba(255,255,255,0.06)', borderRadius: '24px',
    padding: '40px 32px', textAlign: 'center',
    border: '1px solid rgba(255,255,255,0.1)'
  },
  retryBtn: {
    padding: '14px 28px', background: '#22c55e', color: 'white',
    border: 'none', borderRadius: '50px', fontWeight: '600',
    fontSize: '16px', cursor: 'pointer'
  }
};
