import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Helmet } from 'react-helmet-async';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Occasion display names
const occasionNames = {
  cumpleanos: 'Cumpleaños',
  aniversario: 'Aniversario',
  declaracion: 'Declaración de Amor',
  san_valentin: 'San Valentín',
  boda: 'Boda',
  graduacion: 'Graduación',
  dia_madres: 'Día de las Madres',
  dia_padres: 'Día del Padre',
  amistad: 'Amistad',
  navidad: 'Navidad',
  otro: 'Especial'
};

// Format seconds to mm:ss
const formatTime = (sec) => {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default function SongPage({ songId: propSongId }) {
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showDedication, setShowDedication] = useState(false);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const audioRef = useRef(null);

  // Get song ID from prop or URL
  const songId = propSongId || (() => {
    const path = window.location.pathname;
    const match = path.match(/\/song\/(.+)/);
    if (match) return match[1];
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || params.get('song_id');
  })();

  // Fetch song data
  useEffect(() => {
    if (!songId) {
      setError('No se encontró la canción');
      setLoading(false);
      return;
    }

    const fetchSong = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('songs')
          .select('*')
          .eq('id', songId)
          .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error('Canción no encontrada');
        if (!data.audio_url) throw new Error('Esta canción aún no está lista');

        setSong(data);
        setTimeout(() => setRevealed(true), 300);
      } catch (err) {
        console.error('Error fetching song:', err);
        setError(err.message || 'Error al cargar la canción');
      } finally {
        setLoading(false);
      }
    };

    fetchSong();
  }, [songId]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => { setDuration(audio.duration); setAudioLoaded(true); };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setIsPlaying(false);
    const onCanPlay = () => setAudioLoaded(true);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('canplay', onCanPlay);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [song]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); } else { audio.play().catch(() => {}); }
    setIsPlaying(!isPlaying);
  };

  const seekTo = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * duration;
  };

  const handleShare = () => {
    const url = `https://regalosquecantan.com/song/${songId}`;
    const text = `🎵 ¡Escucha esta canción que hicieron especialmente para ${song?.recipient_name || 'mí'}! 🎁\n\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleDownload = () => {
    if (!song?.audio_url) return;
    const a = document.createElement('a');
    a.href = song.audio_url;
    a.download = `cancion-para-${song.recipient_name || 'ti'}.mp3`;
    a.click();
  };

  const handleCreateOwn = () => {
    window.location.href = 'https://regalosquecantan.com';
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return ''; }
  };

  // Loading state
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#e8d5c4',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16,
      }}>
        <div style={{ fontSize: 48, animation: 'pulse 1.5s ease-in-out infinite' }}>🎵</div>
        <p style={{ fontFamily: "'Karla', sans-serif", color: '#6b5744', fontSize: 14 }}>
          Cargando tu canción...
        </p>
        <style>{`@keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }`}</style>
      </div>
    );
  }

  // Error state
  if (error || !song) {
    return (
      <div style={{
        minHeight: '100vh', background: '#e8d5c4',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16, padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 48 }}>😔</div>
        <h2 style={{ fontFamily: "'Karla', sans-serif", color: '#3d2b1f', fontSize: 20, margin: 0 }}>
          {error || 'Canción no encontrada'}
        </h2>
        <p style={{ fontFamily: "'Karla', sans-serif", color: '#8a7456', fontSize: 14, margin: 0 }}>
          Es posible que este link haya expirado o no sea válido.
        </p>
        <button onClick={handleCreateOwn} style={{
          marginTop: 8, padding: '14px 32px', background: '#c0392b',
          border: 'none', borderRadius: 10, color: '#fff', fontSize: 15,
          fontWeight: 600, cursor: 'pointer',
        }}>
          🎵 Crea tu propia canción
        </button>
      </div>
    );
  }

  const recipientName = song.recipient_name || 'Alguien Especial';
  const senderName = song.sender_name || '';
  const genreName = song.genre_name || song.genre || '';
  const subGenreName = song.sub_genre || '';
  const occasionLabel = occasionNames[song.occasion] || song.occasion || '';
  const dedication = song.details || '';
  const lyrics = song.lyrics || '';
  const dateLabel = formatDate(song.created_at);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      {/* Dynamic OG Meta Tags */}
      <Helmet>
        <title>🎵 Canción para {recipientName} | RegalosQueCantan</title>
        <meta name="description" content={`Una canción personalizada creada especialmente para ${recipientName}. ${occasionLabel ? `Para ${occasionLabel}.` : ''} Escúchala ahora.`} />
        <meta property="og:type" content="music.song" />
        <meta property="og:url" content={`https://regalosquecantan.com/song/${songId}`} />
        <meta property="og:title" content={`🎵 Una canción para ${recipientName}`} />
        <meta property="og:description" content={`${senderName ? `${senderName} te dedicó` : 'Te dedicaron'} una canción personalizada. ¡Escúchala ahora!`} />
        <meta property="og:image" content="https://regalosquecantan.com/images/og-song-share.jpg" />
        <meta property="og:site_name" content="RegalosQueCantan" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`🎵 Una canción para ${recipientName}`} />
        <meta name="twitter:description" content={`${senderName ? `${senderName} te dedicó` : 'Te dedicaron'} una canción personalizada. ¡Escúchala ahora!`} />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {/* Hidden audio element */}
      {song.audio_url && (
        <audio ref={audioRef} src={song.audio_url} preload="metadata" />
      )}

      <div style={{
        minHeight: '100vh',
        background: '#e8d5c4',
        fontFamily: "system-ui, sans-serif",
        position: 'relative',
        overflow: 'hidden',
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Karla:wght@300;400;500;600&display=swap');
          @keyframes dropIn { from{opacity:0;transform:translateY(-40px) rotate(-5deg)} to{opacity:1;transform:translateY(0) rotate(0deg)} }
          @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
          @keyframes noteFloat { 0%{opacity:0;transform:translateY(0) rotate(0)} 20%{opacity:0.3} 100%{opacity:0;transform:translateY(-100px) rotate(20deg)} }
        `}</style>

        {/* Craft paper grid texture */}
        <div style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0.3,
          backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 24px, rgba(0,0,0,0.02) 24px, rgba(0,0,0,0.02) 25px),
            repeating-linear-gradient(90deg, transparent, transparent 24px, rgba(0,0,0,0.02) 24px, rgba(0,0,0,0.02) 25px)`,
        }} />

        {/* Washi tape decoration */}
        <div style={{
          position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%) rotate(-3deg)',
          width: 120, height: 26, background: 'rgba(255,182,193,0.5)',
          borderRadius: 2, zIndex: 10,
          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.3) 5px, rgba(255,255,255,0.3) 10px)',
          opacity: revealed ? 1 : 0, transition: 'opacity 0.5s',
        }} />

        <div style={{
          maxWidth: 420, margin: '0 auto', padding: '56px 20px 36px',
          position: 'relative',
        }}>

          {/* ===== POLAROID CARD ===== */}
          <div style={{
            background: '#fff',
            padding: '14px 14px 0',
            borderRadius: 2,
            boxShadow: '0 4px 30px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
            transform: revealed ? 'rotate(-1.5deg)' : 'translateY(-40px)',
            opacity: revealed ? 1 : 0,
            transition: 'all 0.6s ease-out',
            marginBottom: 20,
          }}>
            {/* Photo area — album art / visualizer */}
            <div style={{
              width: '100%', aspectRatio: '1',
              background: 'linear-gradient(135deg, #2c1810, #3d2317, #1a0e08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', position: 'relative',
              overflow: 'hidden', borderRadius: 1,
            }}>
              {/* Floating notes when playing */}
              {isPlaying && (
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
                  {['♪','♫','♬','🎵','♩'].map((n, i) => (
                    <span key={`${Math.floor(currentTime)}-${i}`} style={{
                      position: 'absolute',
                      left: `${15 + i * 16}%`, bottom: '20%',
                      fontSize: 14 + i * 3, color: 'rgba(232,213,196,0.25)',
                      animation: `noteFloat ${2.5 + i * 0.4}s ease-out forwards`,
                    }}>{n}</span>
                  ))}
                </div>
              )}

              {/* Visualizer bars */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 3, marginBottom: 16, height: 32,
              }}>
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} style={{
                    width: 5, borderRadius: 3,
                    height: isPlaying ? `${14 + Math.sin(Date.now() / 200 + i) * 10 + Math.random() * 8}px` : 6,
                    background: '#e8d5c4',
                    transition: 'height 0.12s',
                  }} />
                ))}
              </div>

              <div style={{ fontSize: 52, marginBottom: 6, lineHeight: 1 }}>🎶</div>
              <p style={{
                fontFamily: "'Caveat', cursive", fontSize: 20,
                color: '#e8d5c4', margin: '0 0 2px',
              }}>
                {genreName.replace(/_/g, ' ')}
              </p>
              {subGenreName && (
                <p style={{
                  fontFamily: "'Karla', sans-serif", fontSize: 11,
                  color: 'rgba(232,213,196,0.5)', margin: 0, letterSpacing: 1,
                }}>
                  {subGenreName}
                </p>
              )}

              {/* Play button overlay */}
              <button onClick={togglePlay} style={{
                position: 'absolute', inset: 0, background: 'transparent',
                border: 'none', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {!isPlaying && audioLoaded && (
                  <div style={{
                    width: 68, height: 68, borderRadius: '50%',
                    background: 'rgba(232,213,196,0.9)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, color: '#2c1810', paddingLeft: 4,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                  }}>▶</div>
                )}
                {!audioLoaded && (
                  <div style={{
                    width: 68, height: 68, borderRadius: '50%',
                    background: 'rgba(232,213,196,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, color: '#2c1810',
                    fontFamily: "'Karla', sans-serif",
                  }}>Cargando...</div>
                )}
              </button>

              {/* Progress bar at bottom of photo */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: 3, background: 'rgba(0,0,0,0.3)',
                cursor: 'pointer',
              }} onClick={seekTo}>
                <div style={{
                  height: '100%', width: `${progress}%`,
                  background: '#e8d5c4', transition: 'width 0.1s',
                }} />
              </div>
            </div>

            {/* Time display */}
            {duration > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '6px 4px 0', fontSize: 11,
                fontFamily: "'Karla', sans-serif", color: '#999',
              }}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            )}

            {/* Polaroid bottom — handwritten name */}
            <div style={{ padding: '14px 6px 18px', textAlign: 'center' }}>
              <p style={{
                fontFamily: "'Caveat', cursive",
                fontSize: 34, color: '#333', margin: '0 0 2px',
                lineHeight: 1.1,
              }}>
                Para {recipientName} ❤️
              </p>
              <p style={{
                fontFamily: "'Caveat', cursive",
                fontSize: 16, color: '#999', margin: 0,
              }}>
                {senderName ? `de ${senderName}` : ''}
                {senderName && dateLabel ? ' · ' : ''}
                {dateLabel}
              </p>
              {occasionLabel && (
                <span style={{
                  display: 'inline-block', marginTop: 6,
                  padding: '3px 12px', borderRadius: 12,
                  background: 'rgba(192,57,43,0.08)',
                  fontSize: 12, color: '#c0392b',
                  fontFamily: "'Karla', sans-serif", fontWeight: 500,
                }}>
                  💕 {occasionLabel}
                </span>
              )}
            </div>
          </div>

          {/* ===== PAUSE/PLAY MINI CONTROL (visible when scrolled past polaroid) ===== */}
          {isPlaying && (
            <button onClick={togglePlay} style={{
              position: 'fixed', bottom: 20, right: 20, zIndex: 100,
              width: 52, height: 52, borderRadius: '50%',
              background: '#c0392b', border: 'none', cursor: 'pointer',
              color: '#fff', fontSize: 20,
              boxShadow: '0 4px 20px rgba(192,57,43,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              ⏸
            </button>
          )}

          {/* ===== STICKY NOTE — DEDICATION ===== */}
          {dedication && (
            <div style={{
              opacity: revealed ? 1 : 0,
              transform: revealed ? 'rotate(1.5deg)' : 'translateY(20px)',
              transition: 'all 0.6s ease-out 0.2s',
            }}>
              <button onClick={() => setShowDedication(!showDedication)} style={{
                width: '100%', padding: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{
                  background: '#fff9b1',
                  padding: '18px 20px',
                  borderRadius: 2,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
                  position: 'relative',
                  marginBottom: 16,
                }}>
                  {/* Pin */}
                  <div style={{
                    position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%)',
                    width: 14, height: 14, borderRadius: '50%',
                    background: 'radial-gradient(circle at 40% 40%, #e74c3c, #c0392b)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  }} />
                  <p style={{
                    fontFamily: "'Karla', sans-serif", fontSize: 12,
                    color: '#999', margin: '0 0 6px', textTransform: 'uppercase',
                    letterSpacing: 1.5, fontWeight: 600,
                  }}>
                    💌 Dedicatoria {showDedication ? '▲' : '▼'}
                  </p>
                  {showDedication && (
                    <p style={{
                      fontFamily: "'Caveat', cursive",
                      fontSize: 19, color: '#555', lineHeight: 1.5,
                      margin: 0, textAlign: 'center',
                    }}>
                      "{dedication}"
                    </p>
                  )}
                  {!showDedication && (
                    <p style={{
                      fontFamily: "'Caveat', cursive",
                      fontSize: 16, color: '#888', margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      "{dedication.slice(0, 60)}{dedication.length > 60 ? '...' : ''}"
                    </p>
                  )}
                </div>
              </button>
            </div>
          )}

          {/* ===== LYRICS ON LINED PAPER ===== */}
          {lyrics && (
            <div style={{
              opacity: revealed ? 1 : 0,
              transform: revealed ? 'rotate(-0.5deg)' : 'translateY(20px)',
              transition: 'all 0.6s ease-out 0.3s',
              marginBottom: 20,
            }}>
              <button onClick={() => setShowLyrics(!showLyrics)} style={{
                width: '100%', padding: '12px 16px',
                background: '#fff', border: 'none',
                borderRadius: showLyrics ? '2px 2px 0 0' : 2,
                cursor: 'pointer',
                fontFamily: "'Caveat', cursive", fontSize: 18,
                color: '#888', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                textAlign: 'center',
              }}>
                {showLyrics ? 'Cerrar letra ✕' : '📝 Ver la letra de tu canción'}
              </button>
              {showLyrics && (
                <div style={{
                  background: '#fff',
                  padding: '14px 22px 18px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  maxHeight: 340, overflowY: 'auto',
                  backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, #e8e8e8 27px, #e8e8e8 28px)',
                  backgroundPositionY: 8,
                  borderRadius: '0 0 2px 2px',
                }}>
                  {lyrics.split('\n').map((line, i) => (
                    <p key={i} style={{
                      fontFamily: line.startsWith('[') ? "'Karla', sans-serif" : "'Caveat', cursive",
                      fontSize: line.startsWith('[') ? 11 : 18,
                      color: line.startsWith('[') ? '#c0a882' : '#444',
                      letterSpacing: line.startsWith('[') ? 2 : 0,
                      textTransform: line.startsWith('[') ? 'uppercase' : 'none',
                      fontWeight: line.startsWith('[') ? 600 : 400,
                      margin: line.startsWith('[') ? '14px 0 4px' : '2px 0',
                      lineHeight: '28px',
                      textAlign: 'center',
                    }}>
                      {line || '\u00A0'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ===== ACTION BUTTONS ===== */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 10,
            opacity: revealed ? 1 : 0,
            transition: 'opacity 0.6s ease-out 0.4s',
          }}>
            {/* WhatsApp share */}
            <button onClick={handleShare} style={{
              padding: '15px', background: '#25D366', border: 'none',
              borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'Karla', sans-serif",
              boxShadow: '0 3px 15px rgba(37,211,102,0.3)',
            }}>
              💬 Compartir por WhatsApp
            </button>

            {/* Download */}
            <button onClick={handleDownload} style={{
              padding: '14px', background: 'rgba(61,43,31,0.08)',
              border: '1px solid rgba(61,43,31,0.15)', borderRadius: 10,
              color: '#3d2b1f', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'Karla', sans-serif",
            }}>
              ⬇️ Descargar canción
            </button>

            {/* CTA — Create your own */}
            <button onClick={handleCreateOwn} style={{
              padding: '16px',
              background: 'linear-gradient(135deg, #c0392b, #e74c3c)',
              border: 'none', borderRadius: 10,
              color: '#fff', fontSize: 16, fontWeight: 700,
              cursor: 'pointer', fontFamily: "'Karla', sans-serif",
              boxShadow: '0 4px 20px rgba(192,57,43,0.3)',
              marginTop: 4,
            }}>
              🎵 ¡Crea una canción para alguien especial!
            </button>
            <p style={{
              textAlign: 'center', fontSize: 12,
              color: '#a89278', fontFamily: "'Karla', sans-serif",
              margin: '2px 0 0',
            }}>
              Canciones personalizadas desde $19.99 — Listas en minutos
            </p>
          </div>

          {/* ===== FOOTER ===== */}
          <p style={{
            textAlign: 'center', fontSize: 11, color: '#a89278',
            marginTop: 28, fontFamily: "'Karla', sans-serif",
          }}>
            RegalosQueCantan.com · Canciones únicas hechas con IA + amor
          </p>
        </div>
      </div>
    </>
  );
}
