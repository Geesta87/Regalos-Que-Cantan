import React, { useEffect, useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ⏱️ Preview limits
const PREVIEW_START = 10;   // Skip first 10s (intro)
const PREVIEW_DURATION = 20; // Play 20 seconds
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION; // Stop at 30s

export default function ShareablePreviewPage() {
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [playCount, setPlayCount] = useState(0);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [emailInput, setEmailInput] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  const audioRef = useRef(null);

  const urlParams = new URLSearchParams(window.location.search);
  const songId = urlParams.get('song_id') || urlParams.get('id');

  // Entrance animation
  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100);
  }, []);

  // Load song from Supabase
  useEffect(() => {
    if (songId) {
      loadSong();
    } else {
      setError('No se encontró el enlace de la canción.');
      setLoading(false);
    }
  }, [songId]);

  const loadSong = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('songs')
        .select('*')
        .eq('id', songId)
        .single();

      if (fetchError || !data) throw new Error('No se encontró la canción.');

      setSong(data);

      // Check if already paid — use robust payment check (status field is for generation, NOT payment)
      const songIsPaid = (
        data.paid === true || data.paid === 'true' || data.paid === 1 ||
        data.is_paid === true ||
        data.payment_status === 'paid' || data.payment_status === 'completed' || data.payment_status === 'succeeded' ||
        !!data.stripe_payment_id ||
        !!data.paid_at ||
        (data.amount_paid && parseFloat(data.amount_paid) > 0)
      );
      
      if (songIsPaid) {
        setAlreadyPaid(true);
      }

      // Pre-fill email if available
      if (data.email) {
        setEmailInput(data.email);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 🔒 Enforce 20-second preview limit
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const time = audioRef.current.currentTime;

    // If past preview end, stop playback
    if (time >= PREVIEW_END) {
      audioRef.current.pause();
      audioRef.current.currentTime = PREVIEW_START;
      setIsPlaying(false);
      setCurrentTime(0);
      setPlayCount(prev => prev + 1);
      return;
    }

    // If somehow before preview start, jump forward
    if (time < PREVIEW_START) {
      audioRef.current.currentTime = PREVIEW_START;
    }

    setCurrentTime(time - PREVIEW_START);
  };

  const togglePlay = () => {
    if (!audioRef.current || !song?.audio_url) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Always start from preview start point
      if (audioRef.current.currentTime < PREVIEW_START || audioRef.current.currentTime >= PREVIEW_END) {
        audioRef.current.currentTime = PREVIEW_START;
      }
      audioRef.current.volume = 0.8;
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {});
    }
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = PREVIEW_START + (percent * PREVIEW_DURATION);
    if (audioRef.current) {
      audioRef.current.currentTime = seekTime;
    }
  };

  const formatTime = (time) => {
    if (!time || isNaN(time) || time < 0) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleBuy = async () => {
    // If already paid, go to success page
    if (alreadyPaid) {
      window.location.href = `/success?song_id=${songId}`;
      return;
    }

    // Need email to create checkout
    const email = emailInput || song?.email;
    if (!email) {
      setShowEmailForm(true);
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            songIds: [songId],
            email: email,
          }),
        }
      );

      const data = await response.json();

      if (!data.success || !data.url) {
        throw new Error(data.error || 'Error al crear el checkout.');
      }

      // Redirect to Stripe
      window.location.href = data.url;
    } catch (err) {
      console.error('Checkout error:', err);
      setCheckoutError(err.message || 'Error al procesar. Intenta de nuevo.');
      setCheckoutLoading(false);
    }
  };

  const recipientName = song?.recipient_name || '';
  const senderName = song?.sender_name || '';
  const genre = song?.genre || '';
  const occasion = song?.occasion?.replace(/_/g, ' ') || '';
  const progressPercent = (currentTime / PREVIEW_DURATION) * 100;

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div style={{background: 'linear-gradient(160deg, #0f2027, #1a3a2f, #162832)', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }`}</style>
        <div style={{textAlign: 'center'}}>
          <div style={{fontSize: '48px', marginBottom: '20px', animation: 'pulse 1.5s ease-in-out infinite'}}>🎵</div>
          <p style={{fontSize: '18px', color: 'rgba(255,255,255,0.8)'}}>Cargando preview...</p>
        </div>
      </div>
    );
  }

  // ==================== ERROR ====================
  if (error) {
    return (
      <div style={{background: 'linear-gradient(160deg, #0f2027, #1a3a2f, #162832)', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'}}>
        <div style={{textAlign: 'center', maxWidth: '400px'}}>
          <div style={{fontSize: '48px', marginBottom: '16px'}}>😕</div>
          <p style={{color: '#f87171', marginBottom: '16px', fontSize: '18px'}}>{error}</p>
          <a href="/" style={{color: '#4ade80', textDecoration: 'underline', fontSize: '16px'}}>Ir al inicio</a>
        </div>
      </div>
    );
  }

  // ==================== NO AUDIO YET ====================
  if (!song?.audio_url) {
    return (
      <div style={{background: 'linear-gradient(160deg, #0f2027, #1a3a2f, #162832)', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'}}>
        <div style={{maxWidth: '420px', width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: '24px', padding: '40px 32px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)'}}>
          <div style={{fontSize: '48px', marginBottom: '16px'}}>⏳</div>
          <h1 style={{fontSize: '22px', fontWeight: 'bold', marginBottom: '12px'}}>Canción en proceso</h1>
          <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '15px', marginBottom: '24px'}}>
            La canción para <span style={{color: '#f5d77a', fontWeight: '600'}}>{recipientName}</span> todavía se está generando.
          </p>
          <button
            onClick={loadSong}
            style={{padding: '14px 28px', background: '#22c55e', color: 'white', border: 'none', borderRadius: '50px', fontWeight: '600', fontSize: '16px', cursor: 'pointer'}}
          >
            🔄 Verificar de nuevo
          </button>
        </div>
      </div>
    );
  }

  // ==================== MAIN PREVIEW PAGE ====================
  return (
    <div style={{background: 'linear-gradient(160deg, #0f2027 0%, #1a3a2f 40%, #1e3a24 70%, #162832 100%)', color: 'white', minHeight: '100vh', padding: '20px 16px 40px', overflow: 'hidden'}}>

      {/* CSS Animations */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 20px rgba(212,175,55,0.3); }
          50% { box-shadow: 0 0 35px rgba(212,175,55,0.5); }
        }
        @keyframes eq1 { 0%, 100% { height: 10px; } 50% { height: 28px; } }
        @keyframes eq2 { 0%, 100% { height: 20px; } 50% { height: 10px; } }
        @keyframes eq3 { 0%, 100% { height: 15px; } 50% { height: 30px; } }
        @keyframes eq4 { 0%, 100% { height: 8px; } 50% { height: 24px; } }
        @keyframes bounceIn {
          0% { opacity: 0; transform: scale(0.3); }
          50% { transform: scale(1.05); }
          70% { transform: scale(0.95); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Hidden Audio — Full song loads but playback is restricted */}
      <audio
        ref={audioRef}
        src={song.audio_url}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
        preload="auto"
      />

      <div style={{
        maxWidth: '480px', margin: '0 auto',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>

        {/* ===== Header ===== */}
        <div style={{
          textAlign: 'center', marginBottom: '24px',
          animation: 'bounceIn 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)'
        }}>
          {/* Preview badge */}
          <div style={{
            display: 'inline-block',
            background: 'linear-gradient(135deg, rgba(212,175,55,0.25), rgba(212,175,55,0.1))',
            borderRadius: '50px', padding: '8px 20px',
            border: '1px solid rgba(212,175,55,0.3)',
            marginBottom: '20px'
          }}>
            <span style={{fontSize: '13px', color: '#f5d77a', fontWeight: '600', letterSpacing: '0.5px'}}>
              🎧 PREVIEW • 20 SEGUNDOS
            </span>
          </div>

          <h1 style={{fontSize: '26px', fontWeight: 'bold', marginBottom: '8px'}}>
            🎵 Una canción para
          </h1>

          <p style={{
            fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0',
            background: 'linear-gradient(90deg, #f5d77a, #fbbf24, #f5d77a)',
            backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            animation: 'shimmer 3s linear infinite'
          }}>
            {recipientName}
          </p>

          {senderName && (
            <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: 0}}>
              De: {senderName}
            </p>
          )}
        </div>

        {/* ===== Player Card ===== */}
        <div style={{
          background: 'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
          borderRadius: '24px', padding: '28px',
          border: '1px solid rgba(255,255,255,0.12)',
          marginBottom: '24px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.2s both' : 'none'
        }}>
          {/* Album art */}
          <div style={{
            width: '180px', height: '180px', margin: '0 auto 20px',
            borderRadius: '18px', overflow: 'hidden',
            position: 'relative',
            animation: isPlaying ? 'glow 2.5s ease-in-out infinite' : 'none',
            background: 'linear-gradient(135deg, #1e3a5f, #4c1d95)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.4)'
          }}>
            {song.image_url ? (
              <img
                src={song.image_url}
                alt=""
                style={{width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.5s', transform: isPlaying ? 'scale(1.05)' : 'scale(1)'}}
                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="font-size:70px;display:flex;align-items:center;justify-content:center;height:100%">🎵</span>'; }}
              />
            ) : (
              <span style={{fontSize: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>🎵</span>
            )}

            {/* Equalizer overlay when playing */}
            {isPlaying && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: '50px',
                background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                gap: '4px', paddingBottom: '10px'
              }}>
                {[0.6, 0.5, 0.7, 0.4, 0.8, 0.5, 0.6].map((dur, i) => (
                  <div key={i} style={{
                    width: '4px', background: '#f5d77a', borderRadius: '2px',
                    animation: `eq${(i % 4) + 1} ${dur}s ease-in-out infinite`
                  }} />
                ))}
              </div>
            )}
          </div>

          {/* Genre / occasion info */}
          <div style={{textAlign: 'center', marginBottom: '20px'}}>
            <p style={{fontSize: '13px', color: '#f5d77a', margin: 0, textTransform: 'capitalize'}}>
              {genre}{occasion ? ` • ${occasion}` : ''}
            </p>
          </div>

          {/* Play/Pause button */}
          <button
            onClick={togglePlay}
            style={{
              width: '72px', height: '72px', margin: '0 auto 16px',
              borderRadius: '50%', border: 'none',
              background: isPlaying
                ? 'linear-gradient(135deg, #f5d77a, #d4af37)'
                : 'linear-gradient(135deg, #22c55e, #16a34a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: isPlaying
                ? '0 6px 25px rgba(212,175,55,0.5)'
                : '0 6px 25px rgba(34,197,94,0.5)',
              transition: 'all 0.3s'
            }}
          >
            {isPlaying ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="#1a3a2f">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white" style={{marginLeft: '3px'}}>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Progress bar */}
          <div
            onClick={handleSeek}
            style={{
              height: '8px', background: 'rgba(255,255,255,0.12)',
              borderRadius: '4px', cursor: 'pointer',
              marginBottom: '8px', overflow: 'hidden'
            }}
          >
            <div style={{
              height: '100%',
              background: 'linear-gradient(90deg, #f5d77a, #d4af37)',
              borderRadius: '4px',
              width: `${progressPercent || 0}%`,
              transition: 'width 0.1s'
            }} />
          </div>

          {/* Time display */}
          <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'rgba(255,255,255,0.5)'}}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(PREVIEW_DURATION)}</span>
          </div>

          {/* Preview notice */}
          <div style={{
            textAlign: 'center', marginTop: '16px',
            background: 'rgba(255,255,255,0.05)', borderRadius: '10px', padding: '10px'
          }}>
            <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.45)', margin: 0}}>
              🔒 Este es un preview de 20 segundos. Compra la canción completa para descargarla.
            </p>
          </div>
        </div>

        {/* ===== Buy CTA ===== */}
        <div style={{
          marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.4s both' : 'none'
        }}>
          {/* Already paid — go to downloads */}
          {alreadyPaid ? (
            <div style={{textAlign: 'center'}}>
              <div style={{
                background: 'rgba(34,197,94,0.15)', borderRadius: '14px',
                padding: '16px', marginBottom: '12px',
                border: '1px solid rgba(34,197,94,0.3)'
              }}>
                <p style={{fontSize: '15px', color: '#4ade80', margin: 0, fontWeight: '600'}}>
                  ✅ ¡Esta canción ya fue comprada!
                </p>
              </div>
              <button
                onClick={() => window.location.href = `/success?song_id=${songId}`}
                style={{
                  width: '100%', padding: '20px',
                  background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                  color: 'white', fontWeight: 'bold', fontSize: '18px',
                  border: 'none', borderRadius: '14px',
                  cursor: 'pointer',
                  boxShadow: '0 6px 25px rgba(34,197,94,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'
                }}
              >
                🎧 Ir a Descargar
              </button>
            </div>
          ) : (
            <>
              {/* Email form (shown if we don't have their email) */}
              {showEmailForm && !emailInput && (
                <div style={{
                  background: 'rgba(255,255,255,0.06)', borderRadius: '14px',
                  padding: '20px', marginBottom: '12px',
                  border: '1px solid rgba(255,255,255,0.12)'
                }}>
                  <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.7)', margin: '0 0 12px 0', textAlign: 'center'}}>
                    📧 Ingresa tu email para continuar:
                  </p>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="tu@email.com"
                    style={{
                      width: '100%', padding: '14px 16px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '2px solid rgba(255,255,255,0.15)',
                      borderRadius: '10px', color: 'white',
                      fontSize: '16px', outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && emailInput && handleBuy()}
                  />
                </div>
              )}

              {/* Checkout error message */}
              {checkoutError && (
                <div style={{
                  background: 'rgba(239,68,68,0.15)', borderRadius: '10px',
                  padding: '12px', marginBottom: '12px',
                  border: '1px solid rgba(239,68,68,0.3)', textAlign: 'center'
                }}>
                  <p style={{fontSize: '13px', color: '#f87171', margin: 0}}>{checkoutError}</p>
                </div>
              )}

              {/* Main buy button */}
              <button
                onClick={handleBuy}
                disabled={checkoutLoading || (showEmailForm && !emailInput)}
                style={{
                  width: '100%', padding: '20px',
                  background: checkoutLoading
                    ? 'rgba(255,255,255,0.15)'
                    : 'linear-gradient(90deg, #f5d77a, #d4af37)',
                  color: checkoutLoading ? 'rgba(255,255,255,0.6)' : '#1a3a2f',
                  fontWeight: 'bold', fontSize: '18px',
                  border: 'none', borderRadius: '14px',
                  cursor: checkoutLoading ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  boxShadow: checkoutLoading ? 'none' : '0 6px 25px rgba(212,175,55,0.4)',
                  animation: !checkoutLoading && playCount > 0 ? 'pulse 2s ease-in-out infinite' : 'none',
                  transition: 'all 0.3s',
                  opacity: (showEmailForm && !emailInput) ? 0.5 : 1
                }}
              >
                {checkoutLoading ? (
                  <>
                    <div style={{
                      width: '20px', height: '20px', border: '3px solid rgba(255,255,255,0.3)',
                      borderTopColor: 'white', borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite'
                    }} />
                    Procesando...
                  </>
                ) : (
                  '🎁 Comprar Canción Completa'
                )}
              </button>

              <p style={{textAlign: 'center', fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: '10px'}}>
                💳 Pago seguro con Stripe • Incluye descarga MP3
              </p>
            </>
          )}
        </div>

        {/* ===== What you get ===== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(212,175,55,0.12), rgba(225,29,116,0.08))',
          borderRadius: '20px', padding: '24px',
          border: '1px solid rgba(212,175,55,0.2)',
          marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.5s both' : 'none'
        }}>
          <h3 style={{fontSize: '18px', fontWeight: '700', marginBottom: '20px', textAlign: 'center'}}>
            ✨ ¿Qué incluye?
          </h3>

          <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
            {[
              { icon: '🎵', title: 'Canción completa', desc: '~3 minutos de música personalizada' },
              { icon: '📥', title: 'Descarga MP3', desc: 'Descarga ilimitada para siempre' },
              { icon: '💌', title: 'Comparte fácil', desc: 'Envía por WhatsApp con un tap' }
            ].map((item, i) => (
              <div key={i} style={{display: 'flex', alignItems: 'center', gap: '14px'}}>
                <div style={{
                  width: '44px', height: '44px', minWidth: '44px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '20px',
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

        {/* ===== Emotional footer ===== */}
        <div style={{
          textAlign: 'center', marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.6s both' : 'none'
        }}>
          <p style={{
            fontSize: '15px', color: 'rgba(255,255,255,0.55)',
            fontStyle: 'italic', lineHeight: '1.6',
            maxWidth: '350px', margin: '0 auto'
          }}>
            "Imagina la cara de {recipientName} cuando escuche su nombre en esta canción. Eso no tiene precio." 🎁
          </p>
        </div>

        {/* Create your own CTA */}
        <div style={{
          textAlign: 'center',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.7s both' : 'none'
        }}>
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '12px 28px',
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none', fontSize: '14px',
              borderRadius: '50px',
              border: '1px solid rgba(255,255,255,0.15)',
              transition: 'all 0.3s'
            }}
          >
            🎤 Crea tu propia canción personalizada
          </a>
        </div>

        {/* Footer */}
        <p style={{textAlign: 'center', marginTop: '30px', color: 'rgba(255,255,255,0.25)', fontSize: '12px'}}>
          RegalosQueCantan © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
