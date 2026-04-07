import React, { useEffect, useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { validateCoupon } from '../services/api';

const supabase = import.meta.env.VITE_SUPABASE_URL
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

// ⏱️ Preview limits
const PREVIEW_START = 10;
const PREVIEW_DURATION = 35;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

// 💰 Pricing
const SINGLE_PRICE = 29.99;
const BUNDLE_PRICE = 39.99;
const VIDEO_ADDON_PRICE = 9.99;

// Helper to get static genre image path
const getGenreImagePath = (genre) => {
  if (!genre) return null;
  return `/images/album-art/${genre}.jpg`;
};

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

// Version personality - matches ComparisonPage
const VERSION_VIBES = [
  { label: 'Emotiva', emoji: '💫', color: '#4f9cf7', gradient: 'linear-gradient(135deg, #2563eb, #3b82f6)', bgTint: 'rgba(59,130,246,0.12)' },
  { label: 'Enérgica', emoji: '🔥', color: '#a855f7', gradient: 'linear-gradient(135deg, #7c3aed, #9333ea)', bgTint: 'rgba(168,85,247,0.12)' }
];

// Extract lyrics preview (first meaningful lines)
const getLyricsPreview = (lyrics) => {
  if (!lyrics) return [];
  return lyrics
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('['))
    .slice(0, 10);
};

const formatTime = (t) => {
  if (!t || isNaN(t) || t < 0) return '0:00';
  return `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
};

// ⏰ Countdown Timer Component
function CountdownTimer({ createdAt }) {
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [expired, setExpired] = useState(false);
  const expireTimeRef = useRef(
    createdAt ? new Date(createdAt).getTime() + (24 * 60 * 60 * 1000) : Date.now() + (24 * 60 * 60 * 1000)
  );

  useEffect(() => {
    const tick = () => {
      const diff = expireTimeRef.current - Date.now();
      if (diff <= 0) { setExpired(true); return; }
      setTimeLeft({
        hours: Math.floor(diff / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000)
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  if (expired) {
    return (
      <div style={{display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center'}}>
        <span style={{color: '#f87171', fontWeight: '700', fontSize: '14px'}}>⚠️ ¡Compra ahora antes de que se elimine!</span>
      </div>
    );
  }

  const pad = (n) => n.toString().padStart(2, '0');

  return (
    <div style={{display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center'}}>
      {[
        { val: pad(timeLeft.hours), label: 'hrs' },
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
          {i < 2 && <span style={{color: 'rgba(239,68,68,0.5)', fontWeight: '900', fontSize: '18px', marginLeft: '2px'}}>:</span>}
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
  const [previewEnded, setPreviewEnded] = useState({});
  const [playCounts, setPlayCounts] = useState({});

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [purchaseMode, setPurchaseMode] = useState(null);

  // Lyrics expand state
  const [expandedLyrics, setExpandedLyrics] = useState({});

  // Checkout state
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [emailInput, setEmailInput] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [allPaid, setAllPaid] = useState(false);

  // Video addon
  const [videoAddon, setVideoAddon] = useState(false);

  // Social proof
  const [socialProofCount] = useState(Math.floor(Math.random() * 80) + 120);

  const audioRefs = useRef({});

  const urlParams = new URLSearchParams(window.location.search);
  const songIdsParam = urlParams.get('song_ids') || urlParams.get('song_id') || urlParams.get('id');

  // Coupon from URL param or sessionStorage (e.g. /corridos → CORRIDO5)
  const urlCoupon = urlParams.get('coupon') || sessionStorage.getItem('rqc_coupon');
  const [couponCode, setCouponCode] = useState(urlCoupon || '');
  const [couponApplied, setCouponApplied] = useState(null);

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

  // Auto-validate coupon from URL param
  useEffect(() => {
    if (urlCoupon) {
      validateCoupon(urlCoupon).then(data => {
        if (data.valid) {
          setCouponCode(data.code);
          setCouponApplied(data);
        }
      }).catch(() => {});
    }
  }, []);

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

      // Track email campaign attribution
      const utmSource = urlParams.get('utm_source');
      const utmCampaign = urlParams.get('utm_campaign');
      if (utmSource === 'email' && utmCampaign && supabase) {
        supabase.from('songs').update({ from_email_campaign: utmCampaign }).in('id', ids).then(() => {});
        sessionStorage.setItem('rqc_from_email', utmCampaign);
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
      setPreviewEnded(p => ({ ...p, [songId]: true }));
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

  // ========== SELECTION ==========
  const handleSelectSong = (songId) => {
    if (songs.length === 1) return;
    const n = new Set([songId]);
    setSelectedIds(n);
    setPurchaseMode('single');
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
        body: JSON.stringify({ songIds: idsArray, email, purchaseBoth: idsArray.length >= 2, videoAddon, couponCode: couponApplied?.code || null })
      });
      const data = await res.json();
      if (!data.success || !data.url) throw new Error(data.error || 'Error al crear checkout.');
      window.location.href = data.url;
    } catch (err) {
      setCheckoutError(err.message || 'Error al procesar.');
      setCheckoutLoading(false);
    }
  };

  const rawPrice = purchaseMode === 'bundle' ? BUNDLE_PRICE : SINGLE_PRICE;
  const discountedPrice = couponApplied
    ? couponApplied.free ? 0
    : couponApplied.type === 'percentage' ? parseFloat((rawPrice * (1 - couponApplied.discount / 100)).toFixed(2))
    : couponApplied.type === 'fixed' ? Math.max(0, rawPrice - couponApplied.discount)
    : rawPrice
    : rawPrice;
  const basePrice = discountedPrice;
  const currentPrice = basePrice + (videoAddon ? VIDEO_ADDON_PRICE : 0);
  const recipientName = songs[0]?.recipient_name || '';
  const createdAt = songs[0]?.created_at;
  const genreName = (songs[0]?.genre_name || songs[0]?.genre || '').replace(/_/g, ' ');
  const isBundleSelected = purchaseMode === 'bundle';

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
        @keyframes bounceIn { 0% { opacity: 0; transform: scale(0.3); } 50% { transform: scale(1.05); } 70% { transform: scale(0.95); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes urgentPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes slideIn { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes ribbonFloat { 0%, 100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(-4px); } }
        @keyframes btnPulse { 0%, 100% { box-shadow: 0 4px 18px var(--pulse-color); } 50% { box-shadow: 0 8px 30px var(--pulse-color), 0 0 60px var(--pulse-color); } }
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
          {createdAt && <CountdownTimer createdAt={createdAt} />}
        </div>
      )}

      <div style={{
        maxWidth: '900px', margin: '0 auto', padding: '30px 16px',
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
          textAlign: 'center', marginBottom: '10px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out' : 'none'
        }}>
          <h1 style={{fontSize: '24px', marginBottom: '6px', fontWeight: 'bold'}}>
            🎵 {songs.length > 1 ? 'Elige tu versión favorita' : 'Tu canción personalizada'}
          </h1>
          <p style={{color: 'rgba(255,255,255,0.7)', fontSize: '15px', margin: 0}}>
            {songs.length} {songs.length === 1 ? 'versión' : 'versiones'}
            {' • '}<span style={{color: '#f74da6', fontWeight: '600'}}>{genreName}</span>
          </p>
          <p style={{color: 'rgba(255,255,255,0.45)', fontSize: '12px', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center'}}>
            🔊 Sube el volumen y toca el botón para escuchar
          </p>
        </div>

        {/* ===== SOCIAL PROOF STRIP ===== */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '16px',
          marginBottom: '28px',
          flexWrap: 'wrap',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.2s both' : 'none'
        }}>
          {[
            { icon: '🔥', text: '147 canciones', sub: 'creadas hoy' },
            { icon: '⭐', text: '4.9/5', sub: 'satisfacción' },
            { icon: '🎁', text: 'Ideal para', sub: 'Cualquier Ocasión' }
          ].map((item, i) => (
            <span key={i} style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.6)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              {item.icon} <span style={{color: '#f74da6', fontWeight: '600'}}>{item.text}</span> {item.sub}
            </span>
          ))}
        </div>

        {/* ===== SONG CARDS (ComparisonPage style) ===== */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '20px',
          marginBottom: '20px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.3s both' : 'none'
        }}>
          {songs.map((song, index) => {
            if (!song.audio_url) return null;
            const isSelected = selectedIds.has(song.id);
            const isOtherSelected = (selectedIds.size > 0 && !isSelected && !isBundleSelected);
            const isPlaying = playingId === song.id;
            const vibe = VERSION_VIBES[index] || VERSION_VIBES[0];
            const lyricsPreview = getLyricsPreview(song.lyrics);
            const isExpanded = expandedLyrics[song.id];

            return (
              <div
                key={song.id}
                onClick={() => handleSelectSong(song.id)}
                style={{
                  background: isSelected
                    ? `linear-gradient(135deg, ${vibe.color}30, ${vibe.color}15)`
                    : 'linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))',
                  border: isSelected
                    ? `3px solid #f74da6`
                    : `2px solid ${vibe.color}35`,
                  borderRadius: '20px',
                  padding: '24px',
                  cursor: songs.length > 1 ? 'pointer' : 'default',
                  transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                  opacity: isOtherSelected ? 0.55 : 1,
                  transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                  boxShadow: isSelected
                    ? '0 0 35px rgba(242,13,128,0.4), 0 8px 32px rgba(0,0,0,0.4)'
                    : '0 4px 24px rgba(0,0,0,0.3)',
                  position: 'relative',
                  backdropFilter: 'blur(10px)'
                }}
              >
                {/* Radio indicator */}
                {songs.length > 1 && (
                  <div style={{
                    position: 'absolute', top: '15px', right: '15px',
                    width: '28px', height: '28px', borderRadius: '50%',
                    border: isSelected ? '3px solid #f20d80' : '3px solid rgba(255,255,255,0.3)',
                    background: isSelected ? '#f20d80' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s', zIndex: 2
                  }}>
                    {isSelected && <span style={{color: '#181114', fontSize: '16px', fontWeight: 'bold'}}>✓</span>}
                  </div>
                )}

                {/* Version badge */}
                <div style={{marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                  <span style={{
                    background: vibe.gradient,
                    padding: '7px 16px',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    boxShadow: `0 3px 12px ${vibe.color}50`,
                    letterSpacing: '0.3px'
                  }}>
                    {vibe.emoji} Versión {index + 1}
                  </span>
                  <span style={{fontSize: '13px', color: vibe.color, fontWeight: '700', letterSpacing: '0.5px'}}>
                    {vibe.label}
                  </span>
                </div>

                {/* Album art with glow */}
                <div style={{
                  height: '280px',
                  borderRadius: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '18px',
                  overflow: 'hidden',
                  position: 'relative',
                  animation: isPlaying ? 'glow 2s ease-in-out infinite' : 'none',
                  background: `linear-gradient(135deg, ${vibe.color}40, rgba(225,29,116,0.25))`,
                  boxShadow: `0 8px 30px ${vibe.color}25`,
                  border: `2px solid ${vibe.color}50`
                }}>
                  {(() => {
                    const staticImg = getGenreImagePath(song.genre);
                    const imgSrc = staticImg || song.image_url;
                    return imgSrc ? (
                      <img
                        src={imgSrc}
                        alt=""
                        style={{
                          width: '100%', height: '100%', objectFit: 'cover',
                          transition: 'transform 0.5s',
                          transform: isPlaying ? 'scale(1.05)' : 'scale(1)'
                        }}
                        onError={(e) => {
                          if (song.image_url && e.target.src !== song.image_url) {
                            e.target.src = song.image_url;
                          } else {
                            e.target.style.display = 'none';
                            e.target.parentElement.innerHTML = '<span style="font-size:72px">🎵</span>';
                          }
                        }}
                      />
                    ) : (
                      <span style={{fontSize: '72px'}}>🎵</span>
                    );
                  })()}

                  {/* Shine sweep effect */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 55%, transparent 60%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 4s ease-in-out infinite',
                    pointerEvents: 'none'
                  }} />

                  {/* Playing overlay with equalizer */}
                  {isPlaying && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      padding: '12px',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                      gap: '3px', height: '50px'
                    }}>
                      {[0.6, 0.5, 0.7, 0.8, 0.4].map((dur, i) => (
                        <div key={i} style={{
                          width: '4px', background: '#f20d80', borderRadius: '2px',
                          animation: `eq${(i % 3) + 1} ${dur}s ease-in-out infinite`
                        }} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Song info */}
                <h3 style={{fontSize: '18px', marginBottom: '4px', fontWeight: 'bold'}}>
                  Para {recipientName}
                </h3>
                <p style={{color: '#f74da6', fontSize: '13px', marginBottom: '12px', fontWeight: '500'}}>
                  {(song.genre_name || song.genre || '').replace(/_/g, ' ')}
                  {song.occasion ? ` • ${song.occasion.replace(/_/g, ' ')}` : ''}
                </p>

                {/* Lyrics preview */}
                {lyricsPreview.length > 0 && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedLyrics(prev => ({...prev, [song.id]: !prev[song.id]}));
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.09)',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      marginBottom: '15px',
                      borderLeft: `3px solid ${vibe.color}`,
                      cursor: 'pointer'
                    }}
                  >
                    <p style={{
                      fontSize: '11px', color: 'rgba(255,255,255,0.7)',
                      margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '1px'
                    }}>
                      📝 Vista previa de la letra
                    </p>
                    {lyricsPreview.slice(0, isExpanded ? 10 : 4).map((line, i) => (
                      <p key={i} style={{
                        fontSize: '13px', color: 'rgba(255,255,255,0.9)',
                        margin: i < (isExpanded ? 9 : 3) ? '0 0 3px 0' : 0,
                        fontStyle: 'italic', lineHeight: '1.4'
                      }}>
                        "{line}"
                      </p>
                    ))}
                    {lyricsPreview.length > 4 && (
                      <p style={{fontSize: '11px', color: vibe.color, margin: '6px 0 0 0'}}>
                        {isExpanded ? '▲ Ver menos' : '▼ Ver más letra...'}
                      </p>
                    )}
                  </div>
                )}

                {/* Play button */}
                <button
                  onClick={(e) => { e.stopPropagation(); togglePlay(song.id); }}
                  style={{
                    width: '100%', padding: '16px',
                    background: isPlaying
                      ? 'linear-gradient(90deg, #f74da6, #f20d80)'
                      : vibe.gradient,
                    color: isPlaying ? '#181114' : 'white',
                    border: 'none', borderRadius: '12px',
                    cursor: 'pointer', fontWeight: 'bold', fontSize: '15px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    transition: 'all 0.3s',
                    boxShadow: isPlaying ? '0 4px 20px rgba(242,13,128,0.5)' : `0 4px 18px ${vibe.color}40`,
                    animation: !isPlaying && !previewEnded[song.id] ? 'btnPulse 2s ease-in-out infinite' : 'none',
                    '--pulse-color': `${vibe.color}50`
                  }}
                >
                  {isPlaying ? '⏸ Pausar' : '▶ Escuchar Canción'}
                </button>

                {/* Progress bar */}
                <div
                  onClick={(e) => { e.stopPropagation(); handleSeek(song.id, e); }}
                  style={{marginTop: '12px', height: '6px', background: 'rgba(255,255,255,0.12)', borderRadius: '3px', overflow: 'hidden', cursor: 'pointer'}}
                >
                  <div style={{
                    height: '100%',
                    background: isPlaying ? 'linear-gradient(90deg, #f20d80, #f74da6)' : vibe.color,
                    borderRadius: '3px',
                    width: `${((currentTimes[song.id] || 0) / PREVIEW_DURATION) * 100}%`,
                    transition: 'width 0.1s'
                  }} />
                </div>
                <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '6px', textAlign: 'right'}}>
                  {formatTime(currentTimes[song.id] || 0)} / {formatTime(PREVIEW_DURATION)}
                </p>

                {/* Price */}
                <div style={{
                  marginTop: '12px', paddingTop: '15px',
                  borderTop: `1px solid ${vibe.color}30`,
                  textAlign: 'center'
                }}>
                  <div style={{ textAlign: 'center', marginBottom: '4px' }}>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                      Pago único · Para siempre
                    </p>
                  </div>
                  <span style={{fontSize: '32px', fontWeight: '800', color: isSelected ? '#f74da6' : 'white'}}>
                    ${SINGLE_PRICE}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ===== BUNDLE DEAL (2+ songs) ===== */}
        {songs.length >= 2 && !allPaid && (
          <>
            {/* OR Divider */}
            <div style={{
              display: 'flex', alignItems: 'center', margin: '30px 0', gap: '20px',
              animation: isVisible ? 'fadeInUp 0.8s ease-out 0.5s both' : 'none'
            }}>
              <div style={{flex: 1, height: '2px', background: 'linear-gradient(90deg, transparent, rgba(242,13,128,0.5))'}} />
              <span style={{
                color: '#f74da6', fontSize: '16px', fontWeight: 'bold',
                padding: '8px 20px', background: 'rgba(242,13,128,0.15)',
                borderRadius: '20px', border: '1px solid rgba(242,13,128,0.4)'
              }}>
                O MEJOR AÚN
              </span>
              <div style={{flex: 1, height: '2px', background: 'linear-gradient(90deg, rgba(242,13,128,0.5), transparent)'}} />
            </div>

            {/* Bundle card */}
            <div
              onClick={handleSelectBoth}
              style={{
                background: isBundleSelected
                  ? 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(242,13,128,0.15))'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
                border: isBundleSelected ? '3px solid #22c55e' : '2px solid rgba(255,255,255,0.18)',
                borderRadius: '20px', padding: '30px 25px',
                cursor: 'pointer', marginBottom: '30px',
                position: 'relative', transition: 'all 0.3s',
                transform: isBundleSelected ? 'scale(1.01)' : 'scale(1)',
                boxShadow: isBundleSelected ? '0 0 30px rgba(34,197,94,0.2)' : 'none',
                opacity: (selectedIds.size > 0 && !isBundleSelected) ? 0.6 : 1,
                animation: isVisible ? 'fadeInUp 0.8s ease-out 0.6s both' : 'none'
              }}
            >
              {/* Ribbon badge */}
              <div style={{
                position: 'absolute', top: '-14px', left: '50%',
                transform: 'translateX(-50%)',
                background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                color: 'white', padding: '8px 24px', borderRadius: '20px',
                fontSize: '13px', fontWeight: 'bold',
                boxShadow: '0 4px 15px rgba(34,197,94,0.4)',
                animation: 'ribbonFloat 3s ease-in-out infinite',
                whiteSpace: 'nowrap'
              }}>
                🎁 2 CANCIONES POR SOLO ${BUNDLE_PRICE}
              </div>

              {/* Radio indicator */}
              <div style={{
                position: 'absolute', top: '20px', right: '20px',
                width: '28px', height: '28px', borderRadius: '50%',
                border: isBundleSelected ? '3px solid #22c55e' : '3px solid rgba(255,255,255,0.3)',
                background: isBundleSelected ? '#22c55e' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s'
              }}>
                {isBundleSelected && <span style={{color: 'white', fontSize: '16px', fontWeight: 'bold'}}>✓</span>}
              </div>

              {/* Overlapping album arts */}
              <div style={{marginTop: '10px'}}>
                <div style={{
                  display: 'flex', justifyContent: 'center', gap: '0px', marginBottom: '18px'
                }}>
                  {songs.slice(0, 2).map((song, i) => (
                    <div key={song.id} style={{
                      width: '110px', height: '110px', borderRadius: '14px',
                      overflow: 'hidden', border: '3px solid #181114',
                      marginLeft: i > 0 ? '-20px' : 0,
                      position: 'relative', zIndex: songs.length - i,
                      background: `linear-gradient(135deg, ${VERSION_VIBES[i]?.color || '#3b82f6'}30, rgba(225,29,116,0.2))`,
                      boxShadow: `0 6px 20px ${VERSION_VIBES[i]?.color || '#3b82f6'}30`,
                      transition: 'transform 0.3s',
                    }}>
                      {(() => {
                        const staticImg = getGenreImagePath(song.genre);
                        const imgSrc = staticImg || song.image_url;
                        return imgSrc ? (
                          <img
                            src={imgSrc} alt=""
                            style={{width: '100%', height: '100%', objectFit: 'cover'}}
                            onError={(e) => {
                              if (song.image_url && e.target.src !== song.image_url) {
                                e.target.src = song.image_url;
                              } else {
                                e.target.style.display = 'none';
                                e.target.parentElement.innerHTML = '<span style="font-size:42px;display:flex;align-items:center;justify-content:center;height:100%">🎵</span>';
                              }
                            }}
                          />
                        ) : (
                          <span style={{fontSize: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>🎵</span>
                        );
                      })()}
                    </div>
                  ))}
                </div>

                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', flexWrap: 'wrap', gap: '20px'
                }}>
                  <div>
                    <h3 style={{fontSize: '20px', marginBottom: '8px', fontWeight: 'bold'}}>
                      🎁 ¡Llévate AMBAS versiones!
                    </h3>
                    <p style={{color: 'rgba(255,255,255,0.75)', fontSize: '14px', margin: '0 0 4px 0'}}>
                      Regala 2 versiones — deja que {recipientName} elija su favorita
                    </p>
                    <p style={{color: 'rgba(255,255,255,0.55)', fontSize: '13px', margin: 0}}>
                      💫 Emotiva + 🔥 Enérgica • Descarga instantánea
                    </p>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <p style={{color: 'rgba(255,255,255,0.45)', textDecoration: 'line-through', fontSize: '16px', margin: '0 0 5px 0'}}>
                      ${(SINGLE_PRICE * 2).toFixed(2)}
                    </p>
                    <p style={{
                      color: isBundleSelected ? '#22c55e' : '#f74da6',
                      fontSize: '36px', fontWeight: 'bold', margin: 0, lineHeight: 1
                    }}>
                      ${BUNDLE_PRICE}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ===== SELECTION SUMMARY ===== */}
        {selectedIds.size > 0 && (
          <div style={{
            background: 'rgba(242,13,128,0.15)',
            border: '2px solid #f74da6', borderRadius: '12px',
            padding: '15px 20px', marginBottom: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            animation: 'fadeInUp 0.4s ease-out'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <span style={{fontSize: '24px'}}>✓</span>
              <div>
                <p style={{margin: 0, fontWeight: 'bold', color: '#f74da6'}}>Seleccionado:</p>
                <p style={{margin: 0, fontSize: '14px'}}>
                  {isBundleSelected ? '2 Canciones (Ambas versiones)' : `1 Canción (Versión ${songs.findIndex(s => selectedIds.has(s.id)) + 1})`}
                </p>
              </div>
            </div>
            <div style={{textAlign: 'right'}}>
              {couponApplied && rawPrice !== discountedPrice && (
                <p style={{margin: 0, fontSize: '14px', textDecoration: 'line-through', color: 'rgba(255,255,255,0.4)'}}>
                  ${(rawPrice + (videoAddon ? VIDEO_ADDON_PRICE : 0)).toFixed(2)}
                </p>
              )}
              <p style={{margin: 0, fontSize: '24px', fontWeight: 'bold'}}>
                ${currentPrice.toFixed(2)}
              </p>
              {couponApplied && (
                <p style={{margin: 0, fontSize: '11px', color: '#4ade80'}}>
                  {couponApplied.code} aplicado
                </p>
              )}
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
              🔒 Previews de 35 segundos. Compra para descargar la canción completa (~3 min).
            </p>
            <p style={{fontSize: '12px', color: '#fca5a5', margin: 0, fontWeight: '600'}}>
              ⚠️ Si no compras antes de que expire el tiempo, la canción será eliminada permanentemente.
            </p>
          </div>
        )}

        {/* ===== VIDEO ADD-ON CARD ===== */}
        {!allPaid && selectedIds.size > 0 && (
          <>
            <style>{`
              @keyframes kbSlide1 { 0%{transform:scale(1);opacity:1} 12%{transform:scale(1.1) translate(-1%,1%);opacity:1} 14.28%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide2 { 0%{opacity:0} 14.28%{opacity:0} 14.29%{transform:scale(1.05);opacity:1} 26%{transform:scale(1.15) translate(1%,-1%);opacity:1} 28.57%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide3 { 0%{opacity:0} 28.57%{opacity:0} 28.58%{transform:scale(1);opacity:1} 40%{transform:scale(1.12) translate(-2%,1%);opacity:1} 42.86%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide4 { 0%{opacity:0} 42.86%{opacity:0} 42.87%{transform:scale(1.08);opacity:1} 54%{transform:scale(1.18) translate(1%,2%);opacity:1} 57.14%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide5 { 0%{opacity:0} 57.14%{opacity:0} 57.15%{transform:scale(1);opacity:1} 68%{transform:scale(1.1) translate(-1%,-1%);opacity:1} 71.43%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide6 { 0%{opacity:0} 71.43%{opacity:0} 71.44%{transform:scale(1.05);opacity:1} 82%{transform:scale(1.15) translate(2%,1%);opacity:1} 85.71%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide7 { 0%{opacity:0} 85.71%{opacity:0} 85.72%{transform:scale(1);opacity:1} 96%{transform:scale(1.12) translate(-1%,2%);opacity:1} 100%{opacity:0} }
              @keyframes videoProgress { 0%{width:0%} 100%{width:100%} }
              @keyframes softPulse { 0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,0.3)} 50%{box-shadow:0 0 0 8px rgba(139,92,246,0)} }
            `}</style>

            <div style={{ textAlign: 'center', margin: '8px 0 12px' }}>
              <span style={{
                fontSize: '13px', color: '#c4b5fd', fontWeight: '600',
                background: 'rgba(139,92,246,0.1)', padding: '6px 16px',
                borderRadius: '20px', border: '1px solid rgba(139,92,246,0.15)',
              }}>
                🎬 87% de clientes agregan el video
              </span>
            </div>

            <div
              onClick={() => setVideoAddon(!videoAddon)}
              style={{
                background: videoAddon
                  ? 'linear-gradient(160deg, rgba(109,40,217,0.25), rgba(79,70,229,0.15))'
                  : 'linear-gradient(160deg, rgba(109,40,217,0.08), rgba(0,0,0,0))',
                border: videoAddon ? '3px solid #8b5cf6' : '2px solid rgba(139,92,246,0.25)',
                borderRadius: '20px', padding: '0',
                cursor: 'pointer', marginBottom: '24px',
                transition: 'all 0.3s',
                overflow: 'hidden', position: 'relative',
                animation: videoAddon ? 'none' : 'softPulse 2.5s ease-in-out infinite',
                boxShadow: videoAddon ? '0 0 30px rgba(109,40,217,0.3)' : '0 4px 20px rgba(109,40,217,0.08)',
                transform: videoAddon ? 'scale(1.01)' : 'scale(1)',
              }}
            >
              {/* Checkmark */}
              <div style={{
                position: 'absolute', top: '16px', right: '16px', zIndex: 3,
                width: '32px', height: '32px', borderRadius: '50%',
                border: videoAddon ? '3px solid #22c55e' : '3px solid rgba(255,255,255,0.3)',
                background: videoAddon ? '#22c55e' : 'rgba(0,0,0,0.4)',
                backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
                boxShadow: videoAddon ? '0 4px 15px rgba(34,197,94,0.4)' : 'none',
              }}>
                {videoAddon && <span style={{color: 'white', fontSize: '18px', fontWeight: 'bold'}}>✓</span>}
              </div>

              {/* Video Preview — Phone Mockup */}
              <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                padding: '24px 20px 16px',
                background: 'linear-gradient(180deg, rgba(124,58,237,0.08), rgba(0,0,0,0))',
                borderRadius: '18px 18px 0 0',
              }}>
                <div style={{
                  position: 'relative', width: '180px', height: '320px',
                  borderRadius: '28px', overflow: 'hidden',
                  border: '4px solid rgba(255,255,255,0.15)',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(124,58,237,0.15)',
                  background: '#000',
                }}>
                  <div style={{
                    position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
                    width: '60px', height: '6px', borderRadius: '3px',
                    background: 'rgba(255,255,255,0.15)', zIndex: 3,
                  }} />
                  {[
                    '/images/reactions/25f07f4e0a324c9297bec1e7dea4a2f4_1768932502805.jpg',
                    '/images/reactions/1096b0152a804679bdc5a89467b0e975_1767305014374.jpg',
                    '/images/reactions/61ac53a945f641e6b8eab58ae4c587b9_1767302003068.jpg',
                    '/images/reactions/3facfa58430746a08dddac3bd0c8ecea_1767304653133.jpg',
                    '/images/reactions/7d8b70506a694af8bfa1f10109495bf5_1767302246147.jpg',
                    '/images/reactions/a61b55d5e427407b83039124c60ce64b_1767304563903.jpg',
                    '/images/reactions/39b7035b4c88495392e645d0123e1bcd_1767302646323.jpg',
                  ].map((src, i) => (
                    <img key={i} src={src} alt="" style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                      objectPosition: 'center 30%',
                      animation: `kbSlide${i + 1} 35s ease-in-out infinite`,
                      opacity: i === 0 ? 1 : 0,
                      filter: 'brightness(0.9)',
                    }} />
                  ))}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px', background: 'linear-gradient(0deg, rgba(0,0,0,0.85), transparent)', pointerEvents: 'none' }} />
                  <div style={{
                    position: 'absolute', top: '45%', left: '50%', transform: 'translate(-50%,-50%)',
                    width: '48px', height: '48px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid rgba(255,255,255,0.3)',
                  }}>
                    <span style={{ fontSize: '18px', marginLeft: '3px', color: 'white' }}>▶</span>
                  </div>
                  <div style={{ position: 'absolute', bottom: '28px', left: '10px', right: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {(() => {
                        const genreKey = songs[0]?.genre;
                        const imgSrc = genreKey ? `/images/album-art/${genreKey}.jpg` : null;
                        return imgSrc ? (
                          <img src={imgSrc} alt="" style={{
                            width: '28px', height: '28px', borderRadius: '6px',
                            objectFit: 'cover', border: '1.5px solid rgba(255,255,255,0.3)',
                          }} />
                        ) : null;
                      })()}
                      <div>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: 'white', margin: 0, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                          Para {recipientName}
                        </p>
                        <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)', margin: 0 }}>Video con fotos</p>
                      </div>
                    </div>
                  </div>
                  <div style={{ position: 'absolute', bottom: '10px', left: '10px', right: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>0:00</span>
                    <div style={{ flex: 1, height: '2px', borderRadius: '1px', background: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
                      <div style={{ width: '35%', height: '100%', background: 'white', animation: 'videoProgress 20s linear infinite' }} />
                    </div>
                    <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>3:24</span>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div style={{padding: '18px 20px'}}>
                <div style={{ marginBottom: '12px' }}>
                  <h3 style={{fontSize: '18px', fontWeight: '800', margin: '0 0 4px', color: '#e9d5ff'}}>
                    🎬 Video para {recipientName}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.3)', textDecoration: 'line-through' }}>$29.99</span>
                    <span style={{ fontSize: '24px', fontWeight: '900', color: '#a855f7' }}>Solo ${VIDEO_ADDON_PRICE}</span>
                    <span style={{
                      fontSize: '11px', fontWeight: 'bold', color: '#22c55e',
                      background: 'rgba(34,197,94,0.15)', padding: '3px 10px', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.2)',
                    }}>Ahorra 67%</span>
                  </div>
                  <p style={{color: 'rgba(255,255,255,0.5)', fontSize: '13px', margin: 0, lineHeight: 1.5}}>
                    Sube tus fotos y creamos un video cinematográfico con la canción. También puedes grabar un mensaje personal de video para {recipientName} — ¡gratis y opcional!
                  </p>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px',
                  padding: '12px', borderRadius: '14px',
                  background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.12)',
                }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      width: '48px', height: '48px', borderRadius: '12px', margin: '0 auto 6px',
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
                    }}>🎵</div>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Solo audio</p>
                  </div>
                  <div style={{ fontSize: '18px', color: '#7c3aed', fontWeight: '900' }}>→</div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      width: '48px', height: '48px', borderRadius: '12px', margin: '0 auto 6px',
                      background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
                      boxShadow: '0 4px 15px rgba(124,58,237,0.3)',
                    }}>🎬</div>
                    <p style={{ fontSize: '11px', color: '#c4b5fd', margin: 0, fontWeight: '600' }}>Video + Audio</p>
                  </div>
                </div>

                <div style={{display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px'}}>
                  {['Efecto Ken Burns', 'Video HD 1080p', 'MP4 descargable', 'Tus fotos favoritas', '🎤 Graba tu mensaje personal — ¡gratis!'].map((feat, i) => (
                    <span key={i} style={{
                      fontSize: '11px', color: i === 4 ? '#ec4899' : 'rgba(255,255,255,0.8)',
                      background: i === 4 ? 'rgba(236,72,153,0.1)' : 'rgba(139,92,246,0.1)', borderRadius: '8px',
                      padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px',
                      border: i === 4 ? '1px solid rgba(236,72,153,0.25)' : '1px solid rgba(139,92,246,0.15)',
                      fontWeight: i === 4 ? '700' : '400'
                    }}>
                      <span style={{color: i === 4 ? '#ec4899' : '#a78bfa'}}>✓</span> {feat}
                    </span>
                  ))}
                </div>

                <div style={{
                  width: '100%', padding: '14px', borderRadius: '14px',
                  textAlign: 'center', fontWeight: '800', fontSize: '15px',
                  transition: 'all 0.3s',
                  background: videoAddon
                    ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                    : 'linear-gradient(90deg, #7c3aed, #a855f7)',
                  color: 'white',
                  boxShadow: videoAddon
                    ? '0 4px 20px rgba(34,197,94,0.3)'
                    : '0 4px 20px rgba(124,58,237,0.3)',
                }}>
                  {videoAddon
                    ? '✓ Video agregado'
                    : `🎬 ¡Sí, quiero el video para ${recipientName}!`
                  }
                </div>

                <p style={{
                  textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)',
                  margin: '10px 0 0', fontStyle: 'italic',
                }}>
                  Solo disponible al momento de la compra
                </p>
              </div>
            </div>
          </>
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
                  `🎁 Comprar ${isBundleSelected ? 'Ambas' : 'Canción'}${videoAddon ? ' + Video' : ''} — $${currentPrice.toFixed(2)}`
                )}
              </button>

              {/* Trust under button */}
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
              { icon: '🎵', title: 'Canción completa', desc: `~3 minutos de música personalizada${isBundleSelected ? ' (x2)' : ''}` },
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
