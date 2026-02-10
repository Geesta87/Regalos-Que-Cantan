import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Helmet } from 'react-helmet-async';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── DEDICATION GENERATOR ───
// Builds a beautiful personalized message from song context (no raw buyer details)
const generateDedication = (song) => {
  const recipient = song.recipient_name || 'alguien especial';
  const sender = song.sender_name || '';
  const occasion = song.occasion || '';
  const relationship = song.relationship || '';

  const occasionMessages = {
    cumpleanos: [
      `Esta canción fue creada para celebrar tu día, ${recipient}. Que la música te acompañe siempre. 🎂`,
      `Feliz cumpleaños, ${recipient}. Alguien quiso regalarte algo único — una canción solo para ti.`,
      `${recipient}, hoy es tu día y esta canción es tuya. Cada nota fue pensada para ti. 🎁`,
    ],
    aniversario: [
      `${recipient}, esta canción celebra el amor que han construido juntos. Cada nota cuenta su historia. 💕`,
      `Para ${recipient} — porque hay amores que merecen su propia canción.`,
      `Esta melodía fue creada para celebrar un amor que sigue creciendo, ${recipient}. 💍`,
    ],
    declaracion: [
      `${recipient}, alguien quiso decirte algo especial — y eligió hacerlo con una canción. 💌`,
      `Esta canción lleva un mensaje que las palabras solas no podían expresar, ${recipient}.`,
      `Para ${recipient} — porque hay sentimientos que solo se pueden cantar. 🌹`,
    ],
    san_valentin: [
      `${recipient}, esta canción es una carta de amor hecha música. Feliz San Valentín. ❤️`,
      `Para ${recipient} — porque el amor merece su propia melodía. Feliz día del amor. 💝`,
      `${recipient}, alguien te ama tanto que te escribió una canción. Feliz San Valentín. 🌹`,
    ],
    boda: [
      `${recipient}, esta canción celebra el inicio de una nueva historia juntos. 💒`,
      `Para ${recipient} — que esta melodía sea parte del soundtrack de su amor. 🥂`,
    ],
    graduacion: [
      `Felicidades, ${recipient}. Esta canción celebra todo lo que has logrado. 🎓`,
      `${recipient}, lo lograste. Esta canción es para ti y todo tu esfuerzo. 🌟`,
    ],
    dia_madres: [
      `Para ${recipient} — la mujer que lo da todo. Esta canción es un abrazo hecho música. 🌷`,
      `${recipient}, gracias por todo. Esta canción lleva todo el amor que mereces. 💐`,
      `Feliz día, ${recipient}. Alguien quiso recordarte lo especial que eres. 🤍`,
    ],
    dia_padres: [
      `Para ${recipient} — gracias por ser ese pilar inquebrantable. Esta canción es para ti. 💙`,
      `${recipient}, esta canción celebra todo lo que haces por los tuyos. Feliz día. 🫂`,
    ],
    amistad: [
      `${recipient}, esta canción celebra una amistad que vale oro. 🤝`,
      `Para ${recipient} — porque los mejores amigos merecen su propia canción. ✨`,
    ],
    otro: [
      `${recipient}, alguien quiso darte algo único — una canción creada solo para ti. 🎵`,
      `Esta canción fue hecha con mucho cariño para ti, ${recipient}. Disfrútala. 💫`,
    ],
  };

  const relationshipFlavor = {
    pareja: `Con todo el amor del mundo para ${recipient}. 💕`,
    esposo: `Para ${recipient} — el amor de mi vida. Esta canción es nuestra. ❤️`,
    esposa: `Para ${recipient} — el amor de mi vida. Esta canción es nuestra. ❤️`,
    mama: `Para la mejor mamá del mundo, ${recipient}. Te quiero con toda el alma. 🌷`,
    papa: `Para el mejor papá del mundo, ${recipient}. Gracias por todo. 💙`,
    hijo: `Para ${recipient} — mi mayor orgullo. Esta canción es para ti. ⭐`,
    hija: `Para ${recipient} — mi mayor orgullo. Esta canción es para ti. ⭐`,
    amigo: `${recipient}, esta canción celebra nuestra amistad. ¡Va por ti! 🎉`,
    amiga: `${recipient}, esta canción celebra nuestra amistad. ¡Va por ti! 🎉`,
    abuela: `Para ${recipient} — gracias por tanto amor. Esta canción es un abrazo para ti. 🤍`,
    abuelo: `Para ${recipient} — gracias por tanto amor. Esta canción es un abrazo para ti. 🤍`,
  };

  const pool = occasionMessages[occasion] || occasionMessages['otro'];
  const seed = (song.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  
  if (relationship && relationshipFlavor[relationship] && seed % 5 < 2) {
    return relationshipFlavor[relationship];
  }
  
  return pool[seed % pool.length];
};

const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// ─── MAIN COMPONENT ───
export default function SongPage({ songId: propSongId }) {
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [showLyrics, setShowLyrics] = useState(false);
  const audioRef = useRef(null);
  const vizRef = useRef(null);

  const songId = propSongId || (() => {
    const m = window.location.pathname.match(/\/song\/(.+)/);
    if (m) return m[1];
    const p = new URLSearchParams(window.location.search);
    return p.get('id') || p.get('song_id');
  })();

  useEffect(() => {
    if (!songId) { setError('No se encontró la canción'); setLoading(false); return; }
    (async () => {
      try {
        const { data, error: e } = await supabase.from('songs').select('*').eq('id', songId).single();
        if (e) throw e;
        if (!data) throw new Error('Canción no encontrada');
        if (!data.audio_url) throw new Error('Esta canción aún no está lista');
        setSong(data);
        setLoading(false);
        setTimeout(() => setPhase('reveal'), 100);
        setTimeout(() => setPhase('ready'), 1200);
      } catch (err) {
        setError(err.message); setLoading(false);
      }
    })();
  }, [songId]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const h = {
      loadedmetadata: () => setDur(a.duration),
      timeupdate: () => setTime(a.currentTime),
      ended: () => setIsPlaying(false),
    };
    Object.entries(h).forEach(([e, fn]) => a.addEventListener(e, fn));
    return () => Object.entries(h).forEach(([e, fn]) => a.removeEventListener(e, fn));
  }, [song]);

  useEffect(() => {
    if (!isPlaying) return;
    let raf;
    const tick = () => {
      vizRef.current?.querySelectorAll('.vbar').forEach((bar, i) => {
        const h = 8 + Math.sin(Date.now() / (180 + i * 30) + i * 0.7) * 18 + Math.random() * 6;
        bar.style.height = `${h}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) a.pause(); else a.play().catch(() => {});
    setIsPlaying(!isPlaying);
  };

  const seek = (e) => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * dur;
  };

  const share = () => {
    const url = `https://regalosquecantan.com/song/${songId}`;
    const text = `🎵 ¡Escucha esta canción que hicieron para ${song?.recipient_name || 'ti'}! 🎁\n\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const download = () => {
    if (!song?.audio_url) return;
    const a = document.createElement('a');
    a.href = song.audio_url;
    a.download = `cancion-para-${song.recipient_name || 'ti'}.mp3`;
    a.click();
  };

  const dedication = useMemo(() => song ? generateDedication(song) : '', [song]);
  const progress = dur > 0 ? (time / dur) * 100 : 0;

  if (loading) {
    return (
      <div className="sp-loading-wrap">
        <style>{CSS}</style>
        <div className="sp-loading-icon">🎵</div>
        <div className="sp-loading-bar"><div className="sp-loading-fill" /></div>
        <p className="sp-loading-text">Preparando tu canción...</p>
      </div>
    );
  }

  if (error || !song) {
    return (
      <div className="sp-error-wrap">
        <style>{CSS}</style>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🎵</div>
        <h2 className="sp-error-title">{error || 'Canción no encontrada'}</h2>
        <p className="sp-error-sub">Es posible que este link haya expirado.</p>
        <button onClick={() => window.location.href = 'https://regalosquecantan.com'} className="sp-cta-btn">
          Crear una canción →
        </button>
      </div>
    );
  }

  const recipient = song.recipient_name || 'Alguien Especial';
  const sender = song.sender_name || '';
  const genre = (song.genre_name || song.genre || '').replace(/_/g, ' ');
  const photoUrl = song.photo_url || null;
  const isRevealed = phase === 'reveal' || phase === 'ready';
  const isReady = phase === 'ready';

  return (
    <>
      <Helmet>
        <title>🎵 Canción para {recipient} | RegalosQueCantan</title>
        <meta property="og:title" content={`🎵 Una canción para ${recipient}`} />
        <meta property="og:description" content={`${sender ? `${sender} te dedicó` : 'Te dedicaron'} una canción personalizada. ¡Escúchala ahora!`} />
        <meta property="og:image" content="https://regalosquecantan.com/images/og-song-share.jpg" />
        <meta property="og:url" content={`https://regalosquecantan.com/song/${songId}`} />
        <meta property="og:type" content="music.song" />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {song.audio_url && <audio ref={audioRef} src={song.audio_url} preload="metadata" />}

      <div className="sp-page">
        <style>{CSS}</style>

        {/* Ambient particles */}
        <div className="sp-particles">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="sp-particle" style={{
              left: `${10 + i * 15}%`,
              animationDelay: `${i * 1.8}s`,
              animationDuration: `${8 + i * 2}s`,
              fontSize: [14, 10, 16, 11, 13, 9][i],
            }}>
              {['♪', '♫', '✦', '♬', '·', '♩'][i]}
            </div>
          ))}
        </div>

        <div className="sp-container">

          {/* Header badge */}
          <div className={`sp-badge ${isRevealed ? 'sp-fadeUp' : ''}`}>
            <span className="sp-badge-icon">🎵</span>
            <span className="sp-badge-text">Alguien te dedicó una canción</span>
          </div>

          {/* POLAROID */}
          <div className={`sp-polaroid ${isRevealed ? 'sp-dropIn' : ''}`}>
            <div className="sp-tape" />

            {/* Art area */}
            <div className="sp-art" onClick={toggle}>
              {photoUrl ? (
                <img src={photoUrl} alt="" className="sp-photo" />
              ) : (
                <div className="sp-art-gradient">
                  <div className="sp-art-pattern" />
                  <span className="sp-genre-tag">{genre}</span>
                  
                  <div ref={vizRef} className="sp-viz">
                    {[...Array(12)].map((_, i) => (
                      <div key={i} className="vbar" style={{
                        height: isPlaying ? 14 : 4,
                        opacity: isPlaying ? 0.9 : 0.35,
                      }} />
                    ))}
                  </div>

                  <div className="sp-play-btn" style={{
                    opacity: isPlaying ? 0 : 1,
                    transform: isPlaying ? 'scale(0.8)' : 'scale(1)',
                  }}>
                    ▶
                  </div>
                </div>
              )}

              {/* Progress */}
              <div className="sp-progress-track" onClick={(e) => { e.stopPropagation(); seek(e); }}>
                <div className="sp-progress-fill" style={{ width: `${progress}%` }} />
                {progress > 0 && <div className="sp-progress-dot" style={{ left: `${progress}%` }} />}
              </div>
            </div>

            {/* Caption */}
            <div className="sp-caption">
              <h1 className="sp-recipient">Para {recipient}</h1>
              {sender && <p className="sp-sender">con amor, {sender}</p>}
            </div>
          </div>

          {/* Time controls */}
          {dur > 0 && (
            <div className={`sp-time-row ${isReady ? 'sp-fadeUp' : ''}`}>
              <span className="sp-time">{fmt(time)}</span>
              <button onClick={toggle} className="sp-mini-play">
                {isPlaying ? '⏸' : '▶️'}
              </button>
              <span className="sp-time">{fmt(dur)}</span>
            </div>
          )}

          {/* Dedication */}
          <div className={`sp-dedication ${isReady ? 'sp-fadeUp sp-delay-1' : ''}`}>
            <p className="sp-dedication-text">{dedication}</p>
          </div>

          {/* Lyrics */}
          {song.lyrics && (
            <div className={`sp-lyrics-section ${isReady ? 'sp-fadeUp sp-delay-2' : ''}`}>
              <button onClick={() => setShowLyrics(!showLyrics)} className="sp-lyrics-toggle">
                {showLyrics ? '✕ Cerrar letra' : '♫ Leer la letra'}
              </button>
              {showLyrics && (
                <div className="sp-lyrics-card">
                  {song.lyrics.split('\n').map((line, i) => (
                    <p key={i} className={line.startsWith('[') ? 'sp-lyric-section' : 'sp-lyric-line'}>
                      {line || '\u00A0'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className={`sp-actions ${isReady ? 'sp-fadeUp sp-delay-3' : ''}`}>
            <button onClick={share} className="sp-share-btn">
              <span style={{ fontSize: 18 }}>💬</span>
              Compartir por WhatsApp
            </button>
            <button onClick={download} className="sp-download-btn">
              ⬇️ Descargar canción
            </button>
          </div>

          {/* CTA */}
          <div className={`sp-cta-section ${isReady ? 'sp-fadeUp sp-delay-4' : ''}`}>
            <div className="sp-divider">
              <div className="sp-divider-line" />
              <span className="sp-divider-star">✦</span>
              <div className="sp-divider-line" />
            </div>
            <p className="sp-cta-label">¿Quieres regalar una canción así?</p>
            <button onClick={() => window.location.href = 'https://regalosquecantan.com'} className="sp-cta-btn">
              🎵 Crear mi canción — desde $19.99
            </button>
            <p className="sp-cta-sub">Lista en minutos · Corridos, Cumbia, Banda, Bachata y más</p>
          </div>

          <p className="sp-footer">RegalosQueCantan.com</p>
        </div>

        {/* Floating pause */}
        {isPlaying && (
          <button onClick={toggle} className="sp-floating-pause">⏸</button>
        )}
      </div>
    </>
  );
}

// ─── ALL STYLES VIA CSS ───
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

*, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

/* ── Page ── */
.sp-page {
  min-height: 100vh;
  background: #faf6f1;
  background-image: 
    radial-gradient(ellipse at 20% 0%, rgba(201,168,124,0.06) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 100%, rgba(180,140,100,0.05) 0%, transparent 60%);
  position: relative;
  overflow: hidden;
}

.sp-container {
  max-width: 400px;
  margin: 0 auto;
  padding: 40px 24px 48px;
  position: relative;
  z-index: 1;
}

/* ── Particles ── */
.sp-particles { position: fixed; inset: 0; pointer-events: none; z-index: 0; }
.sp-particle {
  position: absolute;
  color: #c9a87c;
  opacity: 0;
  animation: spFloat linear infinite;
}

/* ── Badge ── */
.sp-badge {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; margin-bottom: 28px;
  opacity: 0;
}
.sp-badge-icon { font-size: 14px; }
.sp-badge-text {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 13px; color: #a09080; letter-spacing: 0.5px;
  font-style: italic;
}

/* ── Polaroid ── */
.sp-polaroid {
  background: #fff;
  padding: 12px;
  border-radius: 3px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.1);
  margin-bottom: 20px;
  position: relative;
  opacity: 0;
}

.sp-tape {
  position: absolute; top: -10px; left: 50%; transform: translateX(-50%) rotate(-2deg);
  width: 80px; height: 22px;
  background: linear-gradient(135deg, rgba(200,180,160,0.45), rgba(220,200,180,0.35));
  border-radius: 1px; z-index: 10;
}

/* ── Art ── */
.sp-art {
  width: 100%; aspect-ratio: 1;
  border-radius: 2px; overflow: hidden;
  position: relative; cursor: pointer;
}
.sp-photo { width: 100%; height: 100%; object-fit: cover; }
.sp-art-gradient {
  width: 100%; height: 100%;
  background: linear-gradient(160deg, #1a1210 0%, #2a1f18 30%, #1e1612 60%, #140e0a 100%);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  position: relative;
}
.sp-art-pattern {
  position: absolute; inset: 0; opacity: 0.04;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(255,255,255,0.15) 1px, transparent 1px),
    radial-gradient(circle at 80% 70%, rgba(255,255,255,0.1) 1px, transparent 1px);
  background-size: 60px 60px, 80px 80px;
}
.sp-genre-tag {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 13px; color: rgba(232,213,196,0.4);
  letter-spacing: 3px; text-transform: uppercase;
  margin-bottom: 24px; position: relative;
}

/* ── Visualizer ── */
.sp-viz {
  display: flex; align-items: flex-end; gap: 3.5px;
  height: 40px; margin-bottom: 20px; position: relative;
}
.vbar {
  width: 4px; border-radius: 2px;
  background: linear-gradient(to top, #c9a87c, #e8d5c4);
  transition: height 0.1s ease, opacity 0.3s;
}

.sp-play-btn {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(250,246,241,0.92);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; color: #2a1f18; padding-left: 3px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.25);
  transition: opacity 0.3s, transform 0.3s;
  position: absolute;
}

/* ── Progress ── */
.sp-progress-track {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 4px; background: rgba(0,0,0,0.25);
  cursor: pointer; z-index: 5;
}
.sp-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #c9a87c, #e8d5c4);
  transition: width 0.15s linear;
}
.sp-progress-dot {
  position: absolute; top: -3px;
  width: 10px; height: 10px; border-radius: 50%;
  background: #faf6f1; border: 2px solid #c9a87c;
  transform: translateX(-50%);
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}

/* ── Caption ── */
.sp-caption { padding: 16px 8px 10px; text-align: center; }
.sp-recipient {
  font-family: 'Playfair Display', 'Georgia', serif;
  font-size: 28px; font-weight: 700; color: #2a1f18;
  margin: 0 0 4px; line-height: 1.2; letter-spacing: -0.3px;
}
.sp-sender {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 15px; color: #a09080;
  font-style: italic; margin: 0;
}

/* ── Time ── */
.sp-time-row {
  display: flex; align-items: center; justify-content: center;
  gap: 16px; margin-bottom: 20px; opacity: 0;
}
.sp-time {
  font-family: 'DM Mono', 'Courier New', monospace;
  font-size: 12px; color: #b0a090; letter-spacing: 1px;
}
.sp-mini-play {
  width: 36px; height: 36px; border-radius: 50%;
  background: #2a1f18; border: none;
  color: #faf6f1; font-size: 13px;
  cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  box-shadow: 0 2px 10px rgba(0,0,0,0.15);
  transition: transform 0.15s;
}
.sp-mini-play:active { transform: scale(0.92); }

/* ── Dedication ── */
.sp-dedication {
  background: linear-gradient(135deg, rgba(201,168,124,0.08), rgba(201,168,124,0.03));
  border: 1px solid rgba(201,168,124,0.15);
  border-radius: 16px; padding: 22px 24px;
  margin-bottom: 18px; text-align: center; opacity: 0;
}
.sp-dedication-text {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 16px; line-height: 1.65; color: #5a4a3a;
  margin: 0; font-style: italic;
}

/* ── Lyrics ── */
.sp-lyrics-section { opacity: 0; margin-bottom: 18px; }
.sp-lyrics-toggle {
  width: 100%; padding: 14px;
  background: transparent;
  border: 1px solid rgba(160,144,128,0.2);
  border-radius: 12px; cursor: pointer;
  font-family: 'Lora', 'Georgia', serif;
  font-size: 14px; color: #a09080;
  transition: all 0.2s;
}
.sp-lyrics-toggle:hover { background: rgba(201,168,124,0.05); }
.sp-lyrics-card {
  background: #fff;
  padding: 20px 24px;
  border-radius: 0 0 12px 12px;
  border: 1px solid rgba(160,144,128,0.12);
  border-top: none;
  max-height: 360px; overflow-y: auto;
}
.sp-lyric-section {
  font-family: 'DM Mono', 'Courier New', monospace;
  font-size: 10px; color: #c0a882;
  letter-spacing: 2px; text-transform: uppercase;
  margin: 16px 0 4px; text-align: center;
}
.sp-lyric-line {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 15px; color: #4a3a2a; line-height: 1.8;
  margin: 1px 0; text-align: center;
}

/* ── Actions ── */
.sp-actions {
  display: flex; flex-direction: column; gap: 10px;
  margin-top: 18px; opacity: 0;
}
.sp-share-btn {
  padding: 16px; border: none; border-radius: 14px;
  background: #25D366; color: #fff;
  font-size: 15px; font-weight: 600; cursor: pointer;
  font-family: 'DM Sans', system-ui, sans-serif;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  box-shadow: 0 4px 16px rgba(37,211,102,0.25);
  transition: transform 0.15s, box-shadow 0.15s;
}
.sp-share-btn:hover { box-shadow: 0 6px 24px rgba(37,211,102,0.35); }
.sp-share-btn:active { transform: scale(0.97); }

.sp-download-btn {
  padding: 14px; border: 1.5px solid rgba(42,31,24,0.12);
  border-radius: 14px; background: transparent;
  color: #5a4a3a; font-size: 14px; font-weight: 500;
  cursor: pointer;
  font-family: 'DM Sans', system-ui, sans-serif;
  transition: background 0.2s;
}
.sp-download-btn:hover { background: rgba(42,31,24,0.04); }

/* ── CTA ── */
.sp-cta-section { margin-top: 32px; text-align: center; opacity: 0; }
.sp-divider { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.sp-divider-line { flex: 1; height: 1px; background: rgba(160,144,128,0.2); }
.sp-divider-star { color: #c9a87c; font-size: 12px; }
.sp-cta-label {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 16px; color: #5a4a3a; margin-bottom: 14px;
  font-style: italic;
}
.sp-cta-btn {
  width: 100%; padding: 17px 24px;
  background: linear-gradient(135deg, #2a1f18, #3d2b1f);
  border: none; border-radius: 14px;
  color: #faf6f1; font-size: 15px; font-weight: 600;
  cursor: pointer;
  font-family: 'DM Sans', system-ui, sans-serif;
  box-shadow: 0 4px 20px rgba(42,31,24,0.2);
  letter-spacing: 0.3px;
  transition: transform 0.15s, box-shadow 0.15s;
}
.sp-cta-btn:hover { box-shadow: 0 6px 28px rgba(42,31,24,0.3); }
.sp-cta-btn:active { transform: scale(0.97); }
.sp-cta-sub {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 12px; color: #b0a090; margin-top: 10px;
  font-style: italic;
}

/* ── Footer ── */
.sp-footer {
  text-align: center; font-size: 11px; color: #c0b0a0;
  margin-top: 32px; letter-spacing: 1.5px;
  font-family: 'DM Mono', 'Courier New', monospace;
}

/* ── Floating Pause ── */
.sp-floating-pause {
  position: fixed; bottom: 24px; right: 24px; z-index: 100;
  width: 48px; height: 48px; border-radius: 50%;
  background: #2a1f18; border: none;
  color: #faf6f1; font-size: 18px; cursor: pointer;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s;
}
.sp-floating-pause:active { transform: scale(0.9); }

/* ── Loading ── */
.sp-loading-wrap {
  min-height: 100vh; background: #faf6f1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 20px;
}
.sp-loading-icon { font-size: 40px; animation: spPulse 2s ease-in-out infinite; }
.sp-loading-bar {
  width: 120px; height: 2px; background: rgba(160,144,128,0.15);
  border-radius: 1px; overflow: hidden;
}
.sp-loading-fill {
  width: 40%; height: 100%; background: #c9a87c;
  border-radius: 1px; animation: spSlide 1.5s ease-in-out infinite;
}
.sp-loading-text {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 13px; color: #a09080; font-style: italic;
}

/* ── Error ── */
.sp-error-wrap {
  min-height: 100vh; background: #faf6f1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 24px; text-align: center; gap: 8px;
}
.sp-error-title {
  font-family: 'Playfair Display', 'Georgia', serif;
  font-size: 22px; color: #2a1f18; margin: 0;
}
.sp-error-sub {
  font-family: 'Lora', 'Georgia', serif;
  font-size: 14px; color: #a09080; margin: 0; font-style: italic;
}

/* ── Animations ── */
@keyframes spFloat {
  0% { opacity: 0; transform: translateY(30px) rotate(0deg); }
  15% { opacity: 0.15; }
  85% { opacity: 0.15; }
  100% { opacity: 0; transform: translateY(-100vh) rotate(25deg); }
}

@keyframes spDropIn {
  0% { opacity: 0; transform: rotate(-4deg) translateY(-30px) scale(0.96); }
  60% { opacity: 1; transform: rotate(-0.5deg) translateY(4px) scale(1.01); }
  100% { opacity: 1; transform: rotate(-1.2deg) translateY(0) scale(1); }
}

@keyframes spFadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes spPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.7; }
}

@keyframes spSlide {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(200%); }
  100% { transform: translateX(-100%); }
}

.sp-dropIn { animation: spDropIn 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
.sp-fadeUp { animation: spFadeUp 0.6s ease-out forwards; }
.sp-delay-1 { animation-delay: 0.15s; }
.sp-delay-2 { animation-delay: 0.25s; }
.sp-delay-3 { animation-delay: 0.35s; }
.sp-delay-4 { animation-delay: 0.5s; }

/* Scrollbar */
.sp-lyrics-card::-webkit-scrollbar { width: 4px; }
.sp-lyrics-card::-webkit-scrollbar-track { background: transparent; }
.sp-lyrics-card::-webkit-scrollbar-thumb { background: rgba(160,144,128,0.2); border-radius: 2px; }
`;
