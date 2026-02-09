import React, { useEffect, useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ✅ REC 1: Confetti particle system
function Confetti() {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const colors = ['#f5d77a', '#e11d74', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];
    const particles = [];
    
    for (let i = 0; i < 150; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 10 + 5,
        h: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: Math.random() * 3 + 2,
        wobble: Math.random() * 10,
        wobbleSpeed: Math.random() * 0.05 + 0.02,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 6,
        opacity: 1
      });
    }
    
    let frame = 0;
    let animId;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;
      
      let alive = false;
      particles.forEach(p => {
        p.y += p.speed;
        p.x += Math.sin(frame * p.wobbleSpeed + p.wobble) * 1.5;
        p.rotation += p.rotSpeed;
        
        if (frame > 180) {
          p.opacity = Math.max(0, p.opacity - 0.008);
        }
        
        if (p.opacity > 0 && p.y < canvas.height + 20) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      });
      
      if (alive) {
        animId = requestAnimationFrame(animate);
      }
    };
    
    animate();
    return () => cancelAnimationFrame(animId);
  }, []);
  
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 50
      }}
    />
  );
}

export default function SuccessPage() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [autoPlayed, setAutoPlayed] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  
  const audioRef = useRef(null);

  const urlParams = new URLSearchParams(window.location.search);
  const songIdsParam = urlParams.get('song_ids') || urlParams.get('song_id');

  // Entrance animation
  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100);
    setTimeout(() => setShowConfetti(false), 5000);
  }, []);

  useEffect(() => {
    if (songIdsParam) {
      loadSongs();
    } else {
      setError('No se encontró el ID de la canción');
      setLoading(false);
    }
  }, [songIdsParam]);

  // ✅ REC 2: Auto-play when song loads
  useEffect(() => {
    if (autoPlayed || !currentSong?.audio_url || !audioRef.current) return;
    
    const timer = setTimeout(() => {
      try {
        audioRef.current.volume = 0.7;
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            setIsPlaying(true);
            setAutoPlayed(true);
          }).catch(() => {
            setAutoPlayed(true);
          });
        }
      } catch (e) {
        setAutoPlayed(true);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [currentSong, autoPlayed]);

  const loadSongs = async () => {
    try {
      setLoading(true);
      const songIds = songIdsParam.split(',').filter(id => id.trim());

      const { data, error: fetchError } = await supabase
        .from('songs')
        .select('*')
        .in('id', songIds);

      if (fetchError) throw new Error('Error al cargar la canción');
      if (!data || data.length === 0) throw new Error('No se encontró la canción');

      setSongs(data);
      setCurrentSong(data[0]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.volume = 1.0;
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    if (audioRef.current) audioRef.current.currentTime = percent * duration;
  };

  const formatTime = (time) => {
    if (!time || isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleDownload = async (song) => {
    const target = song || currentSong;
    if (!target?.audio_url) return;
    
    setDownloading(true);
    try {
      const response = await fetch(target.audio_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cancion-para-${target.recipient_name || 'ti'}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      window.open(target.audio_url, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    for (const song of songs) {
      await handleDownload(song);
    }
  };

  const handleShareWhatsApp = () => {
    const name = currentSong?.recipient_name || '';
    const text = `🎵 ¡Escucha esta canción que hice especialmente para ${name}! 🎁\n\n${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const recipientName = currentSong?.recipient_name || 'ti';
  const senderName = currentSong?.sender_name || '';
  const genre = currentSong?.genre || '';
  const occasion = currentSong?.occasion?.replace(/_/g, ' ') || '';

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div style={{background: 'linear-gradient(160deg, #0f2027, #1a3a2f, #162832)', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }`}</style>
        <div style={{textAlign: 'center'}}>
          <div style={{fontSize: '48px', marginBottom: '20px', animation: 'pulse 1.5s ease-in-out infinite'}}>🎵</div>
          <p style={{fontSize: '18px', color: 'rgba(255,255,255,0.8)'}}>Cargando tu canción...</p>
        </div>
      </div>
    );
  }

  // ==================== ERROR ====================
  if (error) {
    return (
      <div style={{background: 'linear-gradient(160deg, #0f2027, #1a3a2f, #162832)', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'}}>
        <div style={{textAlign: 'center'}}>
          <p style={{color: '#f87171', marginBottom: '16px', fontSize: '18px'}}>{error}</p>
          <a href="/" style={{color: '#4ade80', textDecoration: 'underline'}}>Volver al inicio</a>
        </div>
      </div>
    );
  }

  // ==================== SONG NOT READY ====================
  if (!currentSong?.audio_url) {
    return (
      <div style={{background: 'linear-gradient(160deg, #0f2027, #1a3a2f, #162832)', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'}}>
        <div style={{maxWidth: '420px', width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: '24px', padding: '40px 32px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)'}}>
          <div style={{width: '80px', height: '80px', margin: '0 auto 24px', borderRadius: '50%', background: 'rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <span style={{fontSize: '40px'}}>🎵</span>
          </div>
          <h1 style={{fontSize: '24px', fontWeight: 'bold', marginBottom: '16px'}}>¡Pago Exitoso!</h1>
          <p style={{color: 'rgba(255,255,255,0.7)', marginBottom: '24px', fontSize: '16px'}}>
            Tu canción para <span style={{color: '#4ade80', fontWeight: '600'}}>{currentSong?.recipient_name}</span> está siendo creada.
          </p>
          <div style={{background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '16px', marginBottom: '24px'}}>
            <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.6)', margin: '0 0 8px 0'}}>Recibirás un email cuando esté lista.</p>
            <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: 0}}>Tiempo estimado: 2-5 minutos</p>
          </div>
          <button
            onClick={loadSongs}
            style={{padding: '14px 28px', background: '#22c55e', color: 'white', border: 'none', borderRadius: '50px', fontWeight: '600', fontSize: '16px', cursor: 'pointer'}}
          >
            🔄 Verificar Estado
          </button>
        </div>
      </div>
    );
  }

  // ==================== MAIN SUCCESS PAGE ====================
  return (
    <div style={{background: 'linear-gradient(160deg, #0f2027 0%, #1a3a2f 40%, #1e3a24 70%, #162832 100%)', color: 'white', minHeight: '100vh', padding: '20px 16px 40px', overflow: 'hidden'}}>
      
      {/* ✅ REC 1: Confetti celebration */}
      {showConfetti && <Confetti />}

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
          0%, 100% { box-shadow: 0 0 25px rgba(212,175,55,0.3), 0 0 50px rgba(212,175,55,0.1); }
          50% { box-shadow: 0 0 40px rgba(212,175,55,0.5), 0 0 80px rgba(212,175,55,0.2); }
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
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>

      {/* Hidden Audio */}
      <audio
        ref={audioRef}
        src={currentSong.audio_url}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />

      <div style={{
        maxWidth: '480px', margin: '0 auto',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        
        {/* ===== REC 3: Hero moment header ===== */}
        <div style={{
          textAlign: 'center', marginBottom: '28px',
          animation: 'bounceIn 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)'
        }}>
          <div style={{
            width: '80px', height: '80px', margin: '0 auto 20px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 30px rgba(34,197,94,0.4)',
            animation: 'float 3s ease-in-out infinite'
          }}>
            <span style={{fontSize: '40px'}}>✓</span>
          </div>
          
          <h1 style={{fontSize: '28px', fontWeight: 'bold', marginBottom: '10px'}}>
            🎉 ¡La canción está lista!
          </h1>
          
          <div style={{
            background: 'linear-gradient(135deg, rgba(212,175,55,0.2), rgba(225,29,116,0.12))',
            borderRadius: '14px', padding: '16px 24px',
            border: '1px solid rgba(212,175,55,0.25)',
            marginBottom: '8px'
          }}>
            <p style={{
              fontSize: '22px', fontWeight: 'bold', margin: '0 0 6px 0',
              background: 'linear-gradient(90deg, #f5d77a, #fbbf24, #f5d77a)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'shimmer 3s linear infinite'
            }}>
              🎁 Para {recipientName}
            </p>
            {/* ✅ REC 7: Emotional copy */}
            <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.65)', margin: 0, fontStyle: 'italic', lineHeight: '1.5'}}>
              {recipientName} va a escuchar su nombre en una canción por primera vez.
              <br />Eso es algo que no se olvida. ❤️
            </p>
          </div>
        </div>

        {/* ===== REC 2: Full song player with album art + equalizer ===== */}
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
            width: '200px', height: '200px', margin: '0 auto 20px',
            borderRadius: '18px', overflow: 'hidden',
            position: 'relative',
            animation: isPlaying ? 'glow 2.5s ease-in-out infinite' : 'none',
            background: 'linear-gradient(135deg, #1e3a5f, #4c1d95)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.4)'
          }}>
            {currentSong.image_url ? (
              <img 
                src={currentSong.image_url} 
                alt="" 
                style={{width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.5s', transform: isPlaying ? 'scale(1.05)' : 'scale(1)'}}
                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="font-size:80px;display:flex;align-items:center;justify-content:center;height:100%">🎵</span>'; }}
              />
            ) : (
              <span style={{fontSize: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>🎵</span>
            )}
            
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

          {/* Song details */}
          <div style={{textAlign: 'center', marginBottom: '20px'}}>
            <h2 style={{fontSize: '20px', fontWeight: 'bold', marginBottom: '4px'}}>
              Para {recipientName}
            </h2>
            {senderName && (
              <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: '0 0 4px 0'}}>
                De: {senderName}
              </p>
            )}
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
              width: `${(currentTime / duration) * 100 || 0}%`,
              transition: 'width 0.1s'
            }} />
          </div>

          {/* Time display */}
          <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'rgba(255,255,255,0.5)'}}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Multi-song selector */}
        {songs.length > 1 && (
          <div style={{
            background: 'rgba(255,255,255,0.05)', borderRadius: '16px',
            padding: '16px', marginBottom: '24px',
            border: '1px solid rgba(255,255,255,0.1)',
            animation: isVisible ? 'fadeInUp 0.8s ease-out 0.3s both' : 'none'
          }}>
            <h3 style={{fontSize: '15px', fontWeight: '700', marginBottom: '12px', textAlign: 'center'}}>
              🎵 Tus {songs.length} Canciones
            </h3>
            <div style={{display: 'flex', gap: '10px'}}>
              {songs.map((song, index) => (
                <button
                  key={song.id}
                  onClick={() => { setCurrentSong(song); setIsPlaying(false); setCurrentTime(0); setAutoPlayed(false); }}
                  style={{
                    flex: 1, padding: '12px',
                    borderRadius: '12px',
                    background: currentSong.id === song.id 
                      ? 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(34,197,94,0.1))' 
                      : 'rgba(255,255,255,0.05)',
                    border: `2px solid ${currentSong.id === song.id ? '#22c55e' : 'rgba(255,255,255,0.1)'}`,
                    color: 'white', cursor: 'pointer', textAlign: 'center',
                    transition: 'all 0.3s'
                  }}
                >
                  <span style={{fontSize: '14px', fontWeight: '600'}}>
                    {index === 0 ? '💫' : '🔥'} Versión {index + 1}
                  </span>
                  {currentSong.id === song.id && (
                    <span style={{display: 'block', fontSize: '11px', color: '#4ade80', marginTop: '4px'}}>
                      ▶ Reproduciendo
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ===== REC 6: Download buttons ===== */}
        <div style={{
          marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.4s both' : 'none'
        }}>
          <button
            onClick={() => handleDownload(currentSong)}
            disabled={downloading}
            style={{
              width: '100%', padding: '18px',
              background: 'linear-gradient(90deg, #f5d77a, #d4af37)',
              color: '#1a3a2f', fontWeight: 'bold', fontSize: '18px',
              border: 'none', borderRadius: '14px',
              cursor: downloading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              boxShadow: '0 6px 25px rgba(212,175,55,0.4)',
              opacity: downloading ? 0.7 : 1,
              transition: 'all 0.3s',
              marginBottom: '10px'
            }}
          >
            {downloading ? '⏳ Descargando...' : '⬇️ Descargar MP3'}
          </button>

          {songs.length > 1 && (
            <button
              onClick={handleDownloadAll}
              disabled={downloading}
              style={{
                width: '100%', padding: '14px',
                background: 'rgba(255,255,255,0.08)',
                color: 'white', fontWeight: '600', fontSize: '15px',
                border: '2px solid rgba(255,255,255,0.15)', borderRadius: '14px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                transition: 'all 0.3s'
              }}
            >
              📦 Descargar Todas ({songs.length} canciones)
            </button>
          )}
        </div>

        {/* ===== REC 4: Shareable preview card + share buttons ===== */}
        <div style={{
          background: 'linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))',
          borderRadius: '20px', padding: '24px',
          border: '1px solid rgba(255,255,255,0.12)',
          marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.5s both' : 'none'
        }}>
          <h3 style={{fontSize: '18px', fontWeight: '700', marginBottom: '16px', textAlign: 'center'}}>
            💝 Comparte el regalo
          </h3>

          {/* Preview card */}
          <div style={{
            background: 'linear-gradient(135deg, #1a3a2f, #0f2027)',
            borderRadius: '16px', padding: '20px',
            textAlign: 'center', marginBottom: '20px',
            border: '2px solid rgba(212,175,55,0.3)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <div style={{
              width: '80px', height: '80px', margin: '0 auto 12px',
              borderRadius: '12px', overflow: 'hidden',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)'
            }}>
              {currentSong.image_url ? (
                <img src={currentSong.image_url} alt="" style={{width: '100%', height: '100%', objectFit: 'cover'}}
                  onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="font-size:40px;display:flex;align-items:center;justify-content:center;height:100%">🎵</span>'; }}
                />
              ) : (
                <span style={{fontSize: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>🎵</span>
              )}
            </div>
            <p style={{fontSize: '16px', fontWeight: 'bold', margin: '0 0 4px 0', color: '#f5d77a'}}>
              🎵 Una canción para {recipientName}
            </p>
            <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: 0}}>
              Creada especialmente — hecha con ❤️
            </p>
          </div>

          {/* Share buttons */}
          <div style={{display: 'flex', gap: '10px'}}>
            <button
              onClick={handleShareWhatsApp}
              style={{
                flex: 1, padding: '14px',
                background: '#25D366', color: 'white',
                border: 'none', borderRadius: '12px',
                fontSize: '15px', fontWeight: '700',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                boxShadow: '0 4px 15px rgba(37,211,102,0.3)',
                transition: 'all 0.3s'
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp
            </button>

            <button
              onClick={handleCopyLink}
              style={{
                flex: 1, padding: '14px',
                background: linkCopied ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)',
                color: linkCopied ? '#4ade80' : 'white',
                border: `2px solid ${linkCopied ? '#22c55e' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: '12px',
                fontSize: '15px', fontWeight: '700',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                transition: 'all 0.3s'
              }}
            >
              {linkCopied ? '✓ ¡Copiado!' : '🔗 Copiar Link'}
            </button>
          </div>
        </div>

        {/* ===== REC 5: Gifting instructions — 3 steps ===== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(212,175,55,0.12), rgba(225,29,116,0.08))',
          borderRadius: '20px', padding: '24px',
          border: '1px solid rgba(212,175,55,0.2)',
          marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.6s both' : 'none'
        }}>
          <h3 style={{fontSize: '18px', fontWeight: '700', marginBottom: '20px', textAlign: 'center'}}>
            🎁 ¿Cómo regalarlo?
          </h3>
          
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
            {[
              { icon: '⬇️', title: 'Descarga la canción', desc: 'Toca el botón de descargar arriba' },
              { icon: '💬', title: 'Envíala por WhatsApp', desc: 'Comparte el archivo o link con un mensaje especial' },
              { icon: '😭❤️', title: 'Mira su reacción', desc: `¡${recipientName} no lo va a creer!` }
            ].map((item, i) => (
              <div key={i} style={{display: 'flex', alignItems: 'center', gap: '14px'}}>
                <div style={{
                  width: '48px', height: '48px', minWidth: '48px',
                  borderRadius: '50%',
                  background: i === 2 
                    ? 'linear-gradient(135deg, #e11d74, #c026d3)' 
                    : 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '22px',
                  border: i === 2 ? 'none' : '2px solid rgba(255,255,255,0.15)',
                  boxShadow: i === 2 ? '0 4px 15px rgba(225,29,116,0.4)' : 'none'
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

        {/* ===== REC 7: Emotional reinforcement footer ===== */}
        <div style={{
          textAlign: 'center', marginBottom: '24px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.7s both' : 'none'
        }}>
          <p style={{
            fontSize: '15px', color: 'rgba(255,255,255,0.6)',
            fontStyle: 'italic', lineHeight: '1.6',
            maxWidth: '350px', margin: '0 auto'
          }}>
            "De todas las cosas que puedes regalar, una canción con su nombre es algo que {recipientName} va a recordar para siempre."
          </p>
        </div>

        {/* Back to home */}
        <div style={{textAlign: 'center', animation: isVisible ? 'fadeInUp 0.8s ease-out 0.8s both' : 'none'}}>
          <a 
            href="/"
            style={{color: 'rgba(255,255,255,0.5)', textDecoration: 'none', fontSize: '14px'}}
          >
            ← Crear otra canción
          </a>
        </div>

        <p style={{textAlign: 'center', marginTop: '30px', color: 'rgba(255,255,255,0.25)', fontSize: '12px'}}>
          RegalosQueCantan © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
