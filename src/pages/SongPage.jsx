import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Helmet } from 'react-helmet-async';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ═══════════════════════════════════════
// DEDICATION GENERATOR
// ═══════════════════════════════════════
const generateDedication = (song) => {
  const r = song.recipient_name || 'alguien especial';
  const occasion = song.occasion || '';
  const relationship = song.relationship || '';
  const msgs = {
    cumpleanos: [
      `Esta canción fue creada para celebrar tu día, ${r}. Que la música te acompañe siempre. 🎂`,
      `Feliz cumpleaños, ${r}. Alguien quiso regalarte algo único — una canción solo para ti.`,
      `${r}, hoy es tu día y esta canción es tuya. Cada nota fue pensada para ti. 🎁`,
    ],
    aniversario: [
      `${r}, esta canción celebra el amor que han construido juntos. Cada nota cuenta su historia. 💕`,
      `Para ${r} — porque hay amores que merecen su propia canción.`,
      `Esta melodía fue creada para celebrar un amor que sigue creciendo, ${r}. 💍`,
    ],
    declaracion: [
      `${r}, alguien quiso decirte algo especial — y eligió hacerlo con una canción. 💌`,
      `Esta canción lleva un mensaje que las palabras solas no podían expresar, ${r}.`,
    ],
    san_valentin: [
      `${r}, esta canción es una carta de amor hecha música. Feliz San Valentín. ❤️`,
      `Para ${r} — porque el amor merece su propia melodía. Feliz día del amor. 💝`,
    ],
    boda: [
      `${r}, esta canción celebra el inicio de una nueva historia juntos. 💒`,
      `Para ${r} — que esta melodía sea parte del soundtrack de su amor. 🥂`,
    ],
    graduacion: [
      `Felicidades, ${r}. Esta canción celebra todo lo que has logrado. 🎓`,
      `${r}, lo lograste. Esta canción es para ti y todo tu esfuerzo. 🌟`,
    ],
    dia_madres: [
      `Para ${r} — la mujer que lo da todo. Esta canción es un abrazo hecho música. 🌷`,
      `${r}, gracias por todo. Esta canción lleva todo el amor que mereces. 💐`,
    ],
    dia_padres: [
      `Para ${r} — gracias por ser ese pilar inquebrantable. Esta canción es para ti. 💙`,
      `${r}, esta canción celebra todo lo que haces por los tuyos. 🫂`,
    ],
    amistad: [
      `${r}, esta canción celebra una amistad que vale oro. 🤝`,
      `Para ${r} — porque los mejores amigos merecen su propia canción. ✨`,
    ],
  };
  const relMsgs = {
    pareja: `Con todo el amor del mundo para ${r}. 💕`,
    esposo: `Para ${r} — el amor de mi vida. Esta canción es nuestra. ❤️`,
    esposa: `Para ${r} — el amor de mi vida. Esta canción es nuestra. ❤️`,
    mama: `Para la mejor mamá del mundo, ${r}. Te quiero con toda el alma. 🌷`,
    papa: `Para el mejor papá del mundo, ${r}. Gracias por todo. 💙`,
    hijo: `Para ${r} — mi mayor orgullo. Esta canción es para ti. ⭐`,
    hija: `Para ${r} — mi mayor orgullo. Esta canción es para ti. ⭐`,
    amigo: `${r}, esta canción celebra nuestra amistad. ¡Va por ti! 🎉`,
    amiga: `${r}, esta canción celebra nuestra amistad. ¡Va por ti! 🎉`,
    abuela: `Para ${r} — gracias por tanto amor. Esta canción es un abrazo para ti. 🤍`,
    abuelo: `Para ${r} — gracias por tanto amor. Esta canción es un abrazo para ti. 🤍`,
  };
  const pool = msgs[occasion] || [
    `${r}, alguien quiso darte algo único — una canción creada solo para ti. 🎵`,
    `Esta canción fue hecha con mucho cariño para ti, ${r}. Disfrútala. 💫`,
  ];
  const seed = (song.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  if (relationship && relMsgs[relationship] && seed % 5 < 2) return relMsgs[relationship];
  return pool[seed % pool.length];
};

const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// ═══════════════════════════════════════
// SONG SELECTOR (combo with 2 songs)
// ═══════════════════════════════════════
function SongSelector({ songs, activeIndex, onSelect, template }) {
  if (songs.length <= 1) return null;
  const themes = {
    golden_hour: { active: '#f4c025', activeBg: 'rgba(244,192,37,0.15)', border: 'rgba(244,192,37,0.25)', bg: 'rgba(255,255,255,0.07)', textActive: 'rgba(255,255,255,0.9)', textInactive: 'rgba(255,255,255,0.4)', labelInactive: 'rgba(255,255,255,0.35)', font: "'Plus Jakarta Sans', sans-serif" },
    lavender_dream: { active: '#9947eb', activeBg: 'rgba(153,71,235,0.08)', border: 'rgba(153,71,235,0.15)', bg: 'white', textActive: '#0f172a', textInactive: '#94a3b8', labelInactive: '#94a3b8', font: "'Newsreader', serif" },
    electric_magenta: { active: '#f20d59', activeBg: 'rgba(242,13,89,0.15)', border: 'rgba(242,13,89,0.25)', bg: 'rgba(255,255,255,0.05)', textActive: 'rgba(255,255,255,0.9)', textInactive: 'rgba(255,255,255,0.4)', labelInactive: 'rgba(255,255,255,0.35)', font: "'Space Grotesk', sans-serif" },
  };
  const c = themes[template] || themes.golden_hour;

  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', width: '100%', maxWidth: 420 }}>
      {songs.map((s, i) => {
        const isActive = i === activeIndex;
        const genre = (s.genre_name || s.genre || '').replace(/_/g, ' ');
        return (
          <button key={s.id} onClick={() => onSelect(i)} style={{
            flex: 1, padding: '12px 10px', borderRadius: 14, textAlign: 'center', cursor: 'pointer',
            border: `1.5px solid ${isActive ? c.active : c.border}`,
            background: isActive ? c.activeBg : c.bg,
            transition: 'all 0.25s', transform: isActive ? 'scale(1.02)' : 'scale(1)',
            fontFamily: c.font, color: 'inherit',
          }}>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: isActive ? c.active : c.labelInactive, marginBottom: 2 }}>
              Canción {i + 1}
            </span>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: isActive ? c.textActive : c.textInactive, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {genre || `#${i + 1}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function SongPage({ songId: propSongId }) {
  const [allSongs, setAllSongs] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading → mystery → sender → countdown → flash → ready
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [showLyrics, setShowLyrics] = useState(false);
  const [countdownNum, setCountdownNum] = useState(3);
  const [confettiPieces, setConfettiPieces] = useState([]);
  const audioRef = useRef(null);
  const vizRef = useRef(null);

  // Parse song IDs — supports /song/id1,id2 for combos
  const songIds = useMemo(() => {
    if (propSongId) return propSongId.split(',').filter(Boolean);
    const m = window.location.pathname.match(/\/song\/(.+)/);
    if (m) return m[1].split(',').filter(Boolean);
    const p = new URLSearchParams(window.location.search);
    const raw = p.get('id') || p.get('song_id') || p.get('song_ids') || '';
    return raw.split(',').filter(Boolean);
  }, [propSongId]);

  // Fetch songs
  useEffect(() => {
    if (!songIds.length) { setError('No se encontró la canción'); setLoading(false); return; }
    (async () => {
      try {
        const { data, error: e } = await supabase.from('songs').select('*').in('id', songIds);
        if (e) throw e;
        if (!data || data.length === 0) throw new Error('Canción no encontrada');
        const ordered = songIds.map(id => data.find(s => s.id === id)).filter(Boolean);
        if (ordered.length === 0) throw new Error('Canción no encontrada');
        if (!ordered[0].audio_url) throw new Error('Esta canción aún no está lista');
        setAllSongs(ordered);
        setLoading(false);
        setPhase('mystery');
      } catch (err) { setError(err.message); setLoading(false); }
    })();
  }, [songIds]);

  const song = allSongs[activeIndex] || null;
  const isCombo = allSongs.length > 1;

  // Switch songs
  const switchSong = (idx) => {
    if (idx === activeIndex) return;
    const a = audioRef.current;
    if (a) { a.pause(); a.currentTime = 0; }
    setIsPlaying(false); setTime(0); setDur(0); setShowLyrics(false);
    setActiveIndex(idx);
  };

  // Audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !song) return;
    a.src = song.audio_url;
    a.load();
    const h = {
      loadedmetadata: () => setDur(a.duration),
      timeupdate: () => setTime(a.currentTime),
      ended: () => {
        setIsPlaying(false);
        if (isCombo && activeIndex < allSongs.length - 1) {
          setTimeout(() => {
            switchSong(activeIndex + 1);
            setTimeout(() => { audioRef.current?.play().catch(() => {}); setIsPlaying(true); }, 300);
          }, 1500);
        }
      },
    };
    Object.entries(h).forEach(([e, fn]) => a.addEventListener(e, fn));
    return () => Object.entries(h).forEach(([e, fn]) => a.removeEventListener(e, fn));
  }, [song, activeIndex]);

  // Visualizer
  useEffect(() => {
    if (!isPlaying) return;
    let raf;
    const tick = () => {
      vizRef.current?.querySelectorAll('.sp-vbar').forEach((bar, i) => {
        bar.style.height = (6 + Math.sin(Date.now() / (150 + i * 25) + i * 0.8) * 14 + Math.random() * 8) + 'px';
        bar.style.opacity = '0.85';
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

  const shareUrl = useMemo(() => {
    const ids = allSongs.map(s => s.id).join(',');
    return `https://regalosquecantan.com/song/${ids}`;
  }, [allSongs]);

  const share = (name) => {
    const text = `🎵 ¡Escucha ${isCombo ? 'estas canciones' : 'esta canción'} que hicieron para ${name || 'ti'}! 🎁\n\n${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const nativeShare = (name) => {
    if (navigator.share) {
      navigator.share({ title: `🎵 ${isCombo ? '2 canciones' : 'Canción'} para ${name}`, url: shareUrl }).catch(() => {});
    } else { navigator.clipboard.writeText(shareUrl); alert('¡Link copiado!'); }
  };

  const download = () => {
    if (!song?.audio_url) return;
    const a = document.createElement('a');
    a.href = song.audio_url;
    a.download = `cancion-para-${song.recipient_name || 'ti'}${isCombo ? `-${activeIndex + 1}` : ''}.mp3`;
    a.click();
  };

  // ═══════════════════════════════════════
  // GIFT REVEAL SEQUENCE
  // ═══════════════════════════════════════
  const startReveal = () => {
    setPhase('envelope');
    setTimeout(() => {
      setPhase('countdown');
      setCountdownNum(3);
      setTimeout(() => setCountdownNum(2), 1000);
      setTimeout(() => setCountdownNum(1), 2000);
      setTimeout(() => {
        // Launch confetti
        const pieces = Array.from({ length: 80 }, (_, i) => ({
          id: i,
          left: Math.random() * 100,
          delay: Math.random() * 0.6,
          duration: 2.5 + Math.random() * 2,
          color: ['#f4c025', '#f20d59', '#9947eb', '#25D366', '#ff6b8a', '#fde68a', '#ffffff'][Math.floor(Math.random() * 7)],
          size: 6 + Math.random() * 8,
          rotation: Math.random() * 360,
        }));
        setConfettiPieces(pieces);
        setPhase('flash');
        // Auto-play audio
        setTimeout(() => {
          const a = audioRef.current;
          if (a) { a.play().catch(() => {}); setIsPlaying(true); }
        }, 800);
        // Transition to ready
        setTimeout(() => setPhase('ready'), 2500);
      }, 3000);
    }, 5500);
  };

  const dedication = useMemo(() => song ? generateDedication(song) : '', [song]);
  const progress = dur > 0 ? (time / dur) * 100 : 0;
  const template = 'golden_hour';

  // Clear confetti after animation completes
  useEffect(() => {
    if (confettiPieces.length > 0) {
      const timer = setTimeout(() => setConfettiPieces([]), 6000);
      return () => clearTimeout(timer);
    }
  }, [confettiPieces]);

  // Confetti overlay (persists across phase transitions)
  const confettiOverlay = confettiPieces.length > 0 ? (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      {confettiPieces.map(p => (
        <div key={p.id} style={{
          position: 'absolute', top: -20, left: `${p.left}%`, width: p.size, height: p.size * 0.6,
          background: p.color, borderRadius: 2,
          animation: `confettiFall ${p.duration}s ease-in ${p.delay}s both`,
          transform: `rotate(${p.rotation}deg)`,
        }} />
      ))}
      <style>{`@keyframes confettiFall{0%{transform:translateY(-20vh) rotate(0deg);opacity:1}80%{opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:0}}`}</style>
    </div>
  ) : null;

  // ─── LOADING ───
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a1408', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <style>{SHARED_CSS}</style>
        <div style={{ fontSize: 40, animation: 'spPulse 2s ease-in-out infinite' }}>🎵</div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>Preparando tu canción...</p>
      </div>
    );
  }

  // ─── ERROR ───
  if (error || !song) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a1408', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 12, fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'white' }}>
        <style>{SHARED_CSS}</style>
        <div style={{ fontSize: 56 }}>🎵</div>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>{error || 'Canción no encontrada'}</h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Es posible que este link haya expirado.</p>
      </div>
    );
  }

  // ─── SHARED DATA ───
  const recipient = song.recipient_name || 'Alguien Especial';
  const sender = song.sender_name || '';
  const genre = (song.genre_name || song.genre || '').replace(/_/g, ' ');
  const photoUrl = song.photo_url || allSongs[0]?.photo_url || null;

  const head = (
    <Helmet>
      <title>🎵 {isCombo ? '2 canciones' : 'Canción'} para {recipient} | RegalosQueCantan</title>
      <meta property="og:title" content={`🎵 ${isCombo ? '2 canciones' : 'Una canción'} para ${recipient}`} />
      <meta property="og:description" content={`${sender ? `${sender} te dedicó` : 'Te dedicaron'} ${isCombo ? '2 canciones personalizadas' : 'una canción personalizada'}. ¡Escúchala${isCombo ? 's' : ''} ahora!`} />
      <meta property="og:url" content={shareUrl} />
      <meta property="og:type" content="music.song" />
      <meta name="robots" content="noindex, nofollow" />
    </Helmet>
  );

  const audioEl = <audio ref={audioRef} preload="metadata" />;

  // ═══════════════════════════════════════
  // REVEAL SCREENS (before template)
  // ═══════════════════════════════════════
  const REVEAL_CSS = `
    @keyframes revealPulse{0%,100%{box-shadow:0 0 20px rgba(244,192,37,0.2), 0 0 60px rgba(244,192,37,0.1)}50%{box-shadow:0 0 40px rgba(244,192,37,0.4), 0 0 80px rgba(244,192,37,0.2)}}
    @keyframes revealFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
    @keyframes revealFadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes revealFadeInSlow{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
    @keyframes revealGlow{0%,100%{opacity:0.3}50%{opacity:0.7}}
    @keyframes countdownPop{0%{transform:scale(0.3);opacity:0}20%{transform:scale(1.15);opacity:1}100%{transform:scale(1);opacity:1}}
    @keyframes countdownRing{0%{transform:scale(0.8);opacity:0.8}100%{transform:scale(2.5);opacity:0}}
    @keyframes flashBurst{0%{transform:scale(0);opacity:1}100%{transform:scale(4);opacity:0}}
    @keyframes confettiFall{0%{transform:translateY(-20vh) rotate(0deg);opacity:1}80%{opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:0}}
    @keyframes nameReveal{0%{opacity:0;transform:scale(0.7);letter-spacing:0.3em}50%{opacity:1;transform:scale(1.05);letter-spacing:0.15em}100%{opacity:1;transform:scale(1);letter-spacing:0.08em}}
    @keyframes subtitleSlide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes sparkle{0%,100%{opacity:0;transform:scale(0)}50%{opacity:1;transform:scale(1)}}
    @keyframes heartbeat{0%,100%{transform:scale(1)}14%{transform:scale(1.1)}28%{transform:scale(1)}}
  `;

  // Screen 1: Mystery — "Alguien te dedicó algo muy especial"
  if (phase === 'mystery') {
    return (
      <>{head}{audioEl}
        <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 50% 30%, #1a1408 0%, #0a0804 60%, #000 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'white', position: 'relative', overflow: 'hidden' }}>
          <style>{SHARED_CSS}{REVEAL_CSS}</style>
          {/* Ambient glow */}
          <div style={{ position: 'absolute', top: '25%', left: '50%', transform: 'translate(-50%, -50%)', width: '60vw', height: '60vw', maxWidth: 400, maxHeight: 400, background: 'radial-gradient(circle, rgba(244,192,37,0.12) 0%, rgba(244,192,37,0.03) 50%, transparent 70%)', borderRadius: '50%', animation: 'revealGlow 3s ease-in-out infinite', pointerEvents: 'none' }} />
          {/* Floating sparkles */}
          {['✦','✧','♪','✦','♫'].map((s, i) => (
            <span key={i} style={{ position: 'absolute', color: 'rgba(244,192,37,0.15)', fontSize: 12 + i * 3, top: `${15 + i * 15}%`, left: `${10 + i * 18}%`, animation: `sparkle ${2 + i * 0.5}s ease-in-out ${i * 0.8}s infinite` }}>{s}</span>
          ))}
          {/* Gift icon */}
          <div style={{ fontSize: 64, marginBottom: 32, animation: 'revealFloat 3s ease-in-out infinite, revealFadeIn 1s ease-out both' }}>🎁</div>
          {/* Name */}
          <h1 style={{ fontSize: 'clamp(28px, 7vw, 44px)', fontWeight: 800, textAlign: 'center', marginBottom: 12, animation: 'revealFadeIn 1s ease-out 0.3s both', lineHeight: 1.2 }}>
            <span style={{ color: '#f4c025' }}>{recipient}</span>...
          </h1>
          {/* Mystery text */}
          <p style={{ fontSize: 'clamp(16px, 4vw, 22px)', color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontWeight: 300, lineHeight: 1.6, maxWidth: 340, marginBottom: 48, animation: 'revealFadeIn 1s ease-out 0.8s both' }}>
            alguien te dedicó algo<br/>
            <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontStyle: 'italic' }}>muy especial</span>
          </p>
          {/* CTA Button */}
          <button
            onClick={startReveal}
            style={{
              padding: '18px 48px', borderRadius: 999, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #f4c025 0%, #e8a810 100%)',
              color: '#1a1408', fontSize: 18, fontWeight: 800, fontFamily: "'Plus Jakarta Sans', sans-serif",
              animation: 'revealFadeIn 0.8s ease-out 1.3s both, revealPulse 2s ease-in-out 2.1s infinite',
              display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: '0 8px 32px rgba(244,192,37,0.3)',
            }}
          >
            Abrir Mi Regalo <span style={{ fontSize: 22 }}>🎁</span>
          </button>
          {/* Subtle brand */}
          <p style={{ position: 'absolute', bottom: 24, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.15)', fontWeight: 500 }}>RegalosQueCantan.com</p>
        </div>
      </>
    );
  }

  // Screen 2: Envelope Reveal — sealed envelope opens to reveal sender
  if (phase === 'envelope') {
    const ENVELOPE_CSS = `
      @keyframes envFloat {
        0% { opacity: 0; transform: translateY(80px) scale(0.8); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes envGlow {
        0%, 100% { box-shadow: 0 20px 60px rgba(244,192,37,0.15), 0 0 0 rgba(244,192,37,0); }
        50% { box-shadow: 0 20px 60px rgba(244,192,37,0.3), 0 0 80px rgba(244,192,37,0.1); }
      }
      @keyframes envShake {
        0%, 100% { transform: rotate(0deg); }
        15% { transform: rotate(-2deg); }
        30% { transform: rotate(2deg); }
        45% { transform: rotate(-1.5deg); }
        60% { transform: rotate(1.5deg); }
        75% { transform: rotate(-0.5deg); }
        90% { transform: rotate(0.5deg); }
      }
      @keyframes envFlapOpen {
        0% { transform: rotateX(0deg); }
        100% { transform: rotateX(180deg); }
      }
      @keyframes envCardSlide {
        0% { transform: translateY(0); opacity: 0; }
        30% { opacity: 1; }
        100% { transform: translateY(-120px); opacity: 1; }
      }
      @keyframes envCardContent {
        0% { opacity: 0; transform: translateY(10px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes envSenderName {
        0% { opacity: 0; transform: scale(0.8); letter-spacing: 0.2em; }
        50% { transform: scale(1.05); letter-spacing: 0.05em; }
        100% { opacity: 1; transform: scale(1); letter-spacing: 0.02em; }
      }
      @keyframes envSubtext {
        0% { opacity: 0; transform: translateY(8px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes envSeal {
        0% { opacity: 1; transform: scale(1); }
        50% { transform: scale(1.3); opacity: 0.8; }
        100% { transform: scale(0); opacity: 0; }
      }
      @keyframes envSparkle {
        0%, 100% { opacity: 0; transform: scale(0) rotate(0deg); }
        50% { opacity: 1; transform: scale(1) rotate(180deg); }
      }
    `;

    return (
      <>{head}{audioEl}
        <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 50% 40%, #1a1408 0%, #0a0804 60%, #000 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'white', position: 'relative', overflow: 'hidden' }}>
          <style>{SHARED_CSS}{REVEAL_CSS}{ENVELOPE_CSS}</style>

          {/* Ambient glow */}
          <div style={{ position: 'absolute', top: '35%', left: '50%', transform: 'translate(-50%, -50%)', width: '70vw', height: '70vw', maxWidth: 450, maxHeight: 450, background: 'radial-gradient(circle, rgba(244,192,37,0.1) 0%, rgba(244,192,37,0.02) 50%, transparent 70%)', borderRadius: '50%', animation: 'revealGlow 3s ease-in-out infinite', pointerEvents: 'none' }} />

          {/* Floating sparkles around envelope */}
          {['✦','✧','✦','♪','✧','✦'].map((s, i) => (
            <span key={i} style={{ position: 'absolute', color: 'rgba(244,192,37,0.2)', fontSize: 10 + i * 2, top: `${20 + (i % 3) * 25}%`, left: `${8 + i * 15}%`, animation: `envSparkle ${2 + i * 0.4}s ease-in-out ${1.5 + i * 0.3}s infinite`, pointerEvents: 'none' }}>{s}</span>
          ))}

          {/* Envelope container */}
          <div style={{ position: 'relative', animation: 'envFloat 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>

            {/* The card that slides up from inside */}
            <div style={{
              position: 'absolute',
              bottom: '50%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 220,
              minHeight: 160,
              background: 'linear-gradient(170deg, #fffef7 0%, #fdf6e3 50%, #faf0d1 100%)',
              borderRadius: '12px 12px 4px 4px',
              padding: '20px 16px',
              textAlign: 'center',
              zIndex: 5,
              animation: 'envCardSlide 1s cubic-bezier(0.34, 1.2, 0.64, 1) 2.3s both',
              boxShadow: '0 -4px 20px rgba(244,192,37,0.15)',
            }}>
              {/* "Con todo el cariño de..." */}
              <p style={{
                fontSize: 12, color: 'rgba(0,0,0,0.4)', fontWeight: 400, letterSpacing: '0.08em',
                marginBottom: 8, fontStyle: 'italic',
                animation: 'envCardContent 0.6s ease-out 3.0s both',
              }}>
                Con todo el cariño de...
              </p>

              {/* Sender name */}
              <h2 style={{
                fontSize: 'clamp(22px, 6vw, 32px)', fontWeight: 800, color: '#1a1408',
                lineHeight: 1.1, marginBottom: 6,
                animation: 'envSenderName 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 3.4s both',
              }}>
                {sender || 'Alguien especial'} <span style={{ fontSize: '0.8em' }}>💛</span>
              </h2>

              {/* "te dedicó una canción..." */}
              <p style={{
                fontSize: 11, color: 'rgba(0,0,0,0.45)', fontWeight: 300, fontStyle: 'italic',
                lineHeight: 1.5,
                animation: 'envSubtext 0.6s ease-out 4.2s both',
              }}>
                te dedicó {isCombo ? '2 canciones únicas' : 'una canción única'}<br/>en el mundo
              </p>

              {/* Small decorative line on card */}
              <div style={{
                width: 40, height: 1.5, background: 'linear-gradient(90deg, transparent, rgba(244,192,37,0.5), transparent)',
                margin: '10px auto 0',
                animation: 'envSubtext 0.6s ease-out 4.4s both',
              }} />
            </div>

            {/* Envelope body */}
            <div style={{
              width: 260, height: 180,
              background: 'linear-gradient(180deg, #d4a024 0%, #c4912a 40%, #b8832e 100%)',
              borderRadius: '4px 4px 12px 12px',
              position: 'relative',
              zIndex: 10,
              animation: 'envGlow 2s ease-in-out 0.9s infinite, envShake 0.6s ease-in-out 1.2s both',
              overflow: 'visible',
            }}>
              {/* Inner shadow on envelope body */}
              <div style={{ position: 'absolute', inset: 0, borderRadius: '4px 4px 12px 12px', background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 30%, rgba(0,0,0,0.1) 100%)', pointerEvents: 'none' }} />

              {/* V-fold lines on envelope body */}
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                background: 'linear-gradient(135deg, transparent 48%, rgba(0,0,0,0.06) 49%, rgba(0,0,0,0.06) 51%, transparent 52%), linear-gradient(225deg, transparent 48%, rgba(0,0,0,0.06) 49%, rgba(0,0,0,0.06) 51%, transparent 52%)',
                pointerEvents: 'none', borderRadius: '4px 4px 12px 12px',
              }} />

              {/* Wax seal (disappears when flap opens) */}
              <div style={{
                position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)',
                width: 36, height: 36, borderRadius: '50%',
                background: 'radial-gradient(circle at 40% 35%, #e84040, #b81c1c)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, zIndex: 30,
                animation: 'envSeal 0.4s ease-in 1.4s both',
              }}>
                ♪
              </div>
            </div>

            {/* Envelope flap (triangle on top) */}
            <div style={{
              position: 'absolute', top: 0, left: 0, width: 260, height: 0,
              zIndex: 20,
              transformOrigin: 'top center',
              perspective: 600,
            }}>
              <div style={{
                width: 0, height: 0,
                borderLeft: '130px solid transparent',
                borderRight: '130px solid transparent',
                borderTop: '100px solid #c99520',
                transformOrigin: 'top center',
                animation: 'envFlapOpen 0.8s cubic-bezier(0.4, 0, 0.2, 1) 1.5s both',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))',
              }} />
            </div>
          </div>

          {/* Brand */}
          <p style={{ position: 'absolute', bottom: 24, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.15)', fontWeight: 500 }}>RegalosQueCantan.com</p>
        </div>
      </>
    );
  }

  // Screen 3: Countdown 3...2...1
  if (phase === 'countdown') {
    const subtitles = { 3: '🎸 Preparando los instrumentos...', 2: '🎤 Afinando la voz...', 1: '🎵 ¡Aquí viene!' };
    return (
      <>{head}{audioEl}
        <div style={{ minHeight: '100vh', background: '#0a0804', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'white', position: 'relative', overflow: 'hidden' }}>
          <style>{SHARED_CSS}{REVEAL_CSS}</style>
          {/* Pulsing ring */}
          <div key={`ring-${countdownNum}`} style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', border: '2px solid rgba(244,192,37,0.4)', animation: 'countdownRing 1s ease-out both' }} />
          <div key={`ring2-${countdownNum}`} style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', border: '1px solid rgba(244,192,37,0.2)', animation: 'countdownRing 1s ease-out 0.2s both' }} />
          {/* Number */}
          <div key={`num-${countdownNum}`} style={{ fontSize: 'clamp(80px, 20vw, 140px)', fontWeight: 900, color: '#f4c025', animation: 'countdownPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both', textShadow: '0 0 60px rgba(244,192,37,0.4), 0 0 120px rgba(244,192,37,0.2)' }}>
            {countdownNum}
          </div>
          {/* Subtitle */}
          <p key={`sub-${countdownNum}`} style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', marginTop: 24, animation: 'subtitleSlide 0.4s ease-out 0.2s both', fontWeight: 300 }}>
            {subtitles[countdownNum]}
          </p>
          {/* "Para [name]" reminder */}
          <p style={{ position: 'absolute', bottom: 60, fontSize: 14, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
            Para <span style={{ color: 'rgba(244,192,37,0.5)' }}>{recipient}</span>
          </p>
        </div>
      </>
    );
  }

  // Screen 4: Flash Burst + Confetti + Name Reveal
  if (phase === 'flash') {
    return (
      <>{head}{audioEl}{confettiOverlay}
        <div style={{ minHeight: '100vh', background: '#0a0804', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'white', position: 'relative', overflow: 'hidden' }}>
          <style>{SHARED_CSS}{REVEAL_CSS}</style>
          {/* White flash burst */}
          <div style={{ position: 'absolute', width: 100, height: 100, background: 'radial-gradient(circle, rgba(244,192,37,0.8) 0%, rgba(244,192,37,0) 70%)', borderRadius: '50%', animation: 'flashBurst 1s ease-out both' }} />
          {/* Name reveal */}
          <div style={{ textAlign: 'center', zIndex: 50, animation: 'nameReveal 1.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.3s both' }}>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.3em', textTransform: 'uppercase', fontWeight: 300, marginBottom: 12 }}>🎵 {isCombo ? '2 canciones' : 'Una canción'}</p>
            <h1 style={{ fontSize: 'clamp(40px, 10vw, 72px)', fontWeight: 900, lineHeight: 1, textShadow: '0 0 40px rgba(244,192,37,0.3)' }}>
              Para <span style={{ color: '#f4c025' }}>{recipient}</span>
            </h1>
            {sender && (
              <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', marginTop: 16, animation: 'revealFadeIn 0.6s ease-out 1s both', fontStyle: 'italic' }}>
                Con amor, <strong style={{ color: 'rgba(255,255,255,0.9)' }}>{sender}</strong>
              </p>
            )}
          </div>
          {/* Photo polaroid effect */}
          {photoUrl && (
            <div style={{
              position: 'absolute', bottom: '15%', zIndex: 40,
              padding: 8, background: 'white', borderRadius: 4,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              animation: 'revealFadeInSlow 1.5s ease-out 1s both',
              transform: 'rotate(-3deg)',
            }}>
              <img src={photoUrl} alt="" style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 2 }} />
              <p style={{ textAlign: 'center', fontSize: 12, color: '#333', fontWeight: 600, marginTop: 6, fontFamily: "'Newsreader', serif", fontStyle: 'italic' }}>
                {recipient} 💛
              </p>
            </div>
          )}
        </div>
      </>
    );
  }

  // Lyrics block builder
  const lyricsBlock = (textColor, bgStyle, sectionColor) => {
    if (!song.lyrics) return null;
    return (
      <div className={`sp-lyrics-slide ${showLyrics ? 'open' : ''}`} style={{ width: '100%' }}>
        <div className="sp-lyrics-scroll" style={{ ...bgStyle, borderRadius: 16, padding: '20px 24px', maxHeight: '40vh', overflowY: 'auto', marginTop: 8 }}>
          {song.lyrics.split('\n').map((line, i) => (
            <p key={i} style={{
              fontSize: line.startsWith('[') ? 10 : 14,
              letterSpacing: line.startsWith('[') ? '0.2em' : 0,
              textTransform: line.startsWith('[') ? 'uppercase' : 'none',
              fontWeight: line.startsWith('[') ? 600 : 400,
              color: line.startsWith('[') ? sectionColor : textColor,
              lineHeight: '1.8', margin: line.startsWith('[') ? '14px 0 4px' : '1px 0',
              textAlign: 'center',
            }}>{line || '\u00A0'}</p>
          ))}
        </div>
      </div>
    );
  };

  // Brand footer (no CTA)
  const brandFooter = (color, textColor) => (
    <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color, opacity: 0.3 }} />
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em', color: textColor, fontWeight: 500, margin: 0 }}>RegalosQueCantan.com</p>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color, opacity: 0.3 }} />
    </div>
  );

  // ═══════════════════════════════════════
  // TEMPLATE 1: GOLDEN HOUR
  // ═══════════════════════════════════════
  if (template === 'golden_hour') {
    return (
      <>{head}{audioEl}{confettiOverlay}
        <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #1a1408 0%, #2a1f10 25%, #1e1508 50%, #0f0c04 100%)', position: 'relative', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'white' }}>
          <style>{SHARED_CSS}{T1_CSS}</style>
          <div style={{ position: 'fixed', top: '-15%', right: '-15%', width: '60vw', height: '60vh', background: 'rgba(244,192,37,0.06)', filter: 'blur(140px)', borderRadius: '50%' }} />
          <div style={{ position: 'fixed', bottom: '-15%', left: '-15%', width: '50vw', height: '50vh', background: 'rgba(200,150,50,0.04)', filter: 'blur(120px)', borderRadius: '50%' }} />
          <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 50% 20%, rgba(244,192,37,0.05) 0%, transparent 60%)' }} />
          <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
            {['♪','♫','♬','♩','✦'].map((n, i) => (
              <span key={i} className="t1-particle" style={{ left: `${8 + i * 17}%`, fontSize: 10 + i * 2, animationDuration: `${10 + i * 2}s`, animationDelay: `${i * 1.5}s` }}>{n}</span>
            ))}
          </div>
          <main style={{ position: 'relative', zIndex: 10, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <header className="t1-anim1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, background: '#f4c025', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(244,192,37,0.2)' }}>
                  <span style={{ fontSize: 16 }}>🎵</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>RegalosQueCantan</span>
              </div>
              <button onClick={() => nativeShare(recipient)} className="t1-glass" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 999, cursor: 'pointer', color: 'white', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(16px)' }}>
                <span style={{ color: '#f4c025', fontSize: 14 }}>📤</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Compartir</span>
              </button>
            </header>
            <div style={{ flex: 1, minHeight: 40 }} />
            {/* Center */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '0 24px 16px' }}>
              <div className="t1-anim1" style={{ marginBottom: 24 }}>
                <div className="t1-glass" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderRadius: 999 }}>
                  <span style={{ fontSize: 12 }}>🎵</span>
                  <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
                    {isCombo ? 'Alguien te dedicó 2 canciones' : 'Alguien te dedicó una canción'}
                  </span>
                </div>
              </div>
              <h1 className="t1-anim2" style={{ fontSize: 'clamp(36px, 8vw, 64px)', fontWeight: 800, lineHeight: 0.95, marginBottom: 8, textShadow: '0 4px 30px rgba(0,0,0,0.3)' }}>
                Para <span style={{ color: '#f4c025' }}>{recipient}</span>
              </h1>
              <p className="t1-anim2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', marginBottom: isCombo ? 20 : 32, fontWeight: 300 }}>
                {sender && <><em>con amor,</em> <strong style={{ color: 'rgba(255,255,255,0.9)' }}>{sender}</strong></>}
                {sender && genre && <span style={{ color: 'rgba(255,255,255,0.25)', margin: '0 8px' }}>·</span>}
                {genre && <span style={{ color: 'rgba(244,192,37,0.7)', fontSize: 13, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{genre}</span>}
              </p>
              {isCombo && <div className="t1-anim2" style={{ marginBottom: 24, width: '100%', display: 'flex', justifyContent: 'center' }}><SongSelector songs={allSongs} activeIndex={activeIndex} onSelect={switchSong} template="golden_hour" /></div>}
              {/* Glass player */}
              <div className="t1-anim3" style={{ width: '100%', maxWidth: 420, padding: 28, borderRadius: 20, boxShadow: '0 25px 50px rgba(0,0,0,0.2)', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', marginBottom: 24 }}>
                <div ref={vizRef} style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 3, height: 32, marginBottom: 24 }}>
                  {Array.from({ length: 20 }).map((_, i) => (<div key={i} className="sp-vbar" style={{ width: 3, height: isPlaying ? 14 : 4, borderRadius: 99, background: 'linear-gradient(to top, #f4c025, #fde68a)', opacity: isPlaying ? 0.85 : 0.3, transition: 'height 0.1s, opacity 0.3s' }} />))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 24 }}>
                  <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10); }} style={{ color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 24 }}>⏪</button>
                  <button onClick={toggle} style={{ width: 72, height: 72, borderRadius: '50%', background: '#f4c025', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(244,192,37,0.3)', fontSize: 32, color: '#1a1408', paddingLeft: isPlaying ? 0 : 3 }}>{isPlaying ? '⏸' : '▶'}</button>
                  <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.min(dur, audioRef.current.currentTime + 10); }} style={{ color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 24 }}>⏩</button>
                </div>
                <div>
                  <div onClick={seek} style={{ position: 'relative', width: '100%', height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 99, cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #f4c025, #fde68a)', borderRadius: 99, transition: 'width 0.15s' }} />
                    <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, borderRadius: '50%', background: '#f4c025', boxShadow: '0 0 8px rgba(244,192,37,0.4)', left: `${progress}%`, transition: 'left 0.15s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)' }}>{fmt(time)}</span>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)' }}>{fmt(dur)}</span>
                  </div>
                </div>
              </div>
              {/* Buttons */}
              <div className="t1-anim4" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
                {song.lyrics && <button onClick={() => setShowLyrics(!showLyrics)} className="t1-glass" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 999, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', color: 'white', fontSize: 14, fontWeight: 600 }}>📝 {showLyrics ? 'Cerrar Letra' : 'Ver Letra'}</button>}
                <button onClick={download} className="t1-glass" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 999, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', color: 'white', fontSize: 14, fontWeight: 600 }}>⬇️ Descargar</button>
                <button onClick={() => share(recipient)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 999, cursor: 'pointer', border: 'none', background: 'rgba(37,211,102,0.9)', color: 'white', fontSize: 14, fontWeight: 600, boxShadow: '0 4px 16px rgba(37,211,102,0.2)' }}>💬 WhatsApp</button>
              </div>
            </div>
            {/* Lyrics */}
            <div style={{ padding: '0 24px', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: 420 }}>
                {lyricsBlock('rgba(255,255,255,0.75)', { background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)' }, 'rgba(244,192,37,0.5)')}
              </div>
            </div>
            {/* Dedication */}
            <div className="t1-anim5" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'center' }}>
              <div className="t1-glass" style={{ width: '100%', maxWidth: 420, borderRadius: 20, padding: 20, position: 'relative' }}>
                <span style={{ position: 'absolute', top: 16, left: 20, fontSize: 20, color: 'rgba(244,192,37,0.5)' }}>❝</span>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, fontStyle: 'italic', paddingLeft: 32 }}>{dedication}</p>
              </div>
            </div>
            {brandFooter('rgba(244,192,37,0.3)', 'rgba(255,255,255,0.15)')}
          </main>
        </div>
      </>
    );
  }

  // ═══════════════════════════════════════
  // TEMPLATE 2: LAVENDER DREAM
  // ═══════════════════════════════════════
  if (template === 'lavender_dream') {
    return (
      <>{head}{audioEl}{confettiOverlay}
        <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top right, #fdfbf7 0%, #f0e9f7 100%)', fontFamily: "'Newsreader', serif", color: '#334155', position: 'relative' }}>
          <style>{SHARED_CSS}{T2_CSS}</style>
          <div style={{ position: 'fixed', top: 20, left: 20, width: 256, height: 256, background: 'rgba(153,71,235,0.05)', borderRadius: '50%', filter: 'blur(100px)', pointerEvents: 'none' }} />
          <div style={{ position: 'fixed', bottom: 20, right: 20, width: 384, height: 384, background: 'rgba(153,71,235,0.1)', borderRadius: '50%', filter: 'blur(120px)', pointerEvents: 'none' }} />
          <main style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', padding: '32px 24px 48px' }}>
            <header className="t2-anim1" style={{ textAlign: 'center', marginBottom: 32, maxWidth: 600 }}>
              <span style={{ color: '#9947eb', fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: 11, display: 'block', marginBottom: 12 }}>RegalosQueCantan Presenta</span>
              <h1 style={{ fontSize: 'clamp(28px, 5.5vw, 48px)', color: '#0f172a', fontWeight: 300, fontStyle: 'italic', marginBottom: 12, lineHeight: 1.15 }}>
                {isCombo ? '2 canciones especiales' : 'Una canción especial'} para {recipient}
              </h1>
            </header>
            {isCombo && <div className="t2-anim1" style={{ marginBottom: 20, width: '100%', display: 'flex', justifyContent: 'center' }}><SongSelector songs={allSongs} activeIndex={activeIndex} onSelect={switchSong} template="lavender_dream" /></div>}
            <div className="t2-anim2 t2-brushed" style={{ width: '100%', maxWidth: 500, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(153,71,235,0.1)' }}>
              {photoUrl && (
                <div style={{ padding: '20px 20px 0' }}>
                  <div style={{ aspectRatio: '16/10', width: '100%', borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.12)', position: 'relative' }}>
                    <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(153,71,235,0.08)', mixBlendMode: 'multiply' }} />
                  </div>
                </div>
              )}
              <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <h2 style={{ fontSize: 20, color: '#0f172a', fontWeight: 600 }}>Para {recipient}</h2>
                  <p style={{ color: 'rgba(153,71,235,0.7)', fontWeight: 500, fontSize: 14 }}>{genre}{song.occasion ? ` · ${song.occasion.replace(/_/g, ' ')}` : ''}</p>
                </div>
                {dur > 0 && <div style={{ textAlign: 'right' }}><span style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 2 }}>Duración</span><span style={{ color: '#334155', fontFamily: 'monospace' }}>{fmt(dur)}</span></div>}
              </div>
              <div style={{ padding: '0 24px 20px', borderTop: '1px solid rgba(153,71,235,0.06)', paddingTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <div style={{ height: 1, width: 32, background: 'rgba(153,71,235,0.25)' }} />
                  <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(153,71,235,0.5)', fontWeight: 700 }}>Dedicatoria</span>
                </div>
                <p style={{ fontSize: 17, lineHeight: 1.7, color: '#475569', fontWeight: 300, fontStyle: 'italic' }}>{dedication}</p>
                {sender && <p style={{ textAlign: 'right', color: '#9947eb', fontWeight: 500, marginTop: 8, fontSize: 15 }}>— Con amor, {sender}</p>}
              </div>
              {/* Player */}
              <div style={{ padding: '0 24px 24px' }}>
                <div onClick={seek} style={{ height: 6, width: '100%', background: 'rgba(153,71,235,0.08)', borderRadius: 999, position: 'relative', cursor: 'pointer', marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${progress}%`, background: '#9947eb', borderRadius: 999, position: 'relative', transition: 'width 0.15s' }}>
                    <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translate(50%, -50%)', width: 16, height: 16, background: 'white', border: '2px solid #9947eb', borderRadius: '50%', boxShadow: '0 2px 6px rgba(0,0,0,0.1)' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, letterSpacing: '0.15em', fontWeight: 700, color: '#94a3b8' }}>{fmt(time)}</span>
                  <span style={{ fontSize: 10, letterSpacing: '0.15em', fontWeight: 700, color: '#94a3b8' }}>{fmt(dur)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32, marginTop: 16 }}>
                  <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10); }} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 24 }}>⏪</button>
                  <button onClick={toggle} style={{ width: 64, height: 64, borderRadius: '50%', background: '#9947eb', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(153,71,235,0.35)', fontSize: 28, color: 'white', paddingLeft: isPlaying ? 0 : 3 }}>{isPlaying ? '⏸' : '▶'}</button>
                  <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.min(dur, audioRef.current.currentTime + 10); }} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 24 }}>⏩</button>
                </div>
              </div>
            </div>
            {/* Actions */}
            <div className="t2-anim3" style={{ marginTop: 28, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
              {song.lyrics && <button onClick={() => setShowLyrics(!showLyrics)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 999, background: 'white', border: '1px solid rgba(153,71,235,0.2)', color: '#475569', cursor: 'pointer', fontSize: 14, fontWeight: 500, fontFamily: "'Newsreader', serif" }}>📝 {showLyrics ? 'Cerrar Letra' : 'Ver Letra'}</button>}
              <button onClick={download} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 999, background: 'white', border: '1px solid rgba(153,71,235,0.2)', color: '#475569', cursor: 'pointer', fontSize: 14, fontWeight: 500, fontFamily: "'Newsreader', serif" }}>⬇️ Descargar</button>
              <button onClick={() => share(recipient)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 999, background: '#25D366', border: 'none', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: "'Newsreader', serif", boxShadow: '0 4px 12px rgba(37,211,102,0.2)' }}>💬 WhatsApp</button>
            </div>
            <div style={{ width: '100%', maxWidth: 500, marginTop: 8, display: 'flex', justifyContent: 'center' }}>
              {lyricsBlock('#475569', { background: 'linear-gradient(135deg, #fff 0%, #fdfbf7 50%, #f7f2fb 100%)', border: '1px solid rgba(153,71,235,0.08)' }, 'rgba(153,71,235,0.5)')}
            </div>
            <footer className="t2-anim4" style={{ marginTop: 36, textAlign: 'center' }}>
              <p style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Regalos<span style={{ color: '#9947eb', fontWeight: 300, fontStyle: 'italic' }}>QueCantan</span></p>
            </footer>
          </main>
        </div>
      </>
    );
  }

  // ═══════════════════════════════════════
  // TEMPLATE 3: ELECTRIC MAGENTA (default fallback)
  // ═══════════════════════════════════════
  return (
    <>{head}{audioEl}{confettiOverlay}
      <div style={{ minHeight: '100vh', background: '#0a0507', fontFamily: "'Space Grotesk', sans-serif", color: 'white', overflow: 'hidden' }}>
        <style>{SHARED_CSS}{T3_CSS}</style>
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0.15, zIndex: 60, mixBlendMode: 'overlay', background: 'radial-gradient(circle at center, transparent 0%, #000 100%)' }} />
        <main style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          {/* Header */}
          <header className="t3-anim1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', zIndex: 50 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, height: 32, background: '#f20d59', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 14 }}>🎵</span></div>
              <span style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: 16, letterSpacing: '-0.03em' }}>RegalosQueCantan</span>
            </div>
            <button onClick={() => nativeShare(recipient)} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)', padding: '8px 16px', borderRadius: 999, cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12 }}>📤</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em' }}>Share</span>
            </button>
          </header>
          {/* Photo hero */}
          <section style={{ position: 'relative', height: photoUrl ? '45vh' : '25vh', width: '100%', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #0a0507 0%, transparent 40%)', zIndex: 10 }} />
            {photoUrl ? (
              <><div style={{ position: 'absolute', inset: 0, background: 'rgba(242,13,89,0.08)', mixBlendMode: 'overlay', zIndex: 10 }} />
              <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(1) brightness(0.7)' }} /></>
            ) : (
              <div style={{ width: '100%', height: '100%', background: 'linear-gradient(180deg, #1a0a10 0%, #0a0507 100%)' }} />
            )}
            <div className="t3-anim2" style={{ position: 'absolute', bottom: 32, left: 24, zIndex: 20, maxWidth: '85%' }}>
              <p style={{ fontSize: 'clamp(20px, 4.5vw, 36px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-0.05em', lineHeight: 1.05 }}>
                {dedication.replace(/[💕❤️🎵💫🎂🎁💌🌹💒🥂🎓🌟🌷💐🤍💙⭐🎉✨🤝🫂💝]/g, '').trim()}
              </p>
            </div>
          </section>
          {/* Player section */}
          <section style={{ flex: 1, width: '100%', background: '#0a0507', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 24px 80px', borderTop: '1px solid rgba(242,13,89,0.15)' }}>
            <div ref={vizRef} style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 4, height: 64, marginBottom: 24, opacity: 0.7 }}>
              {Array.from({ length: 15 }).map((_, i) => (<div key={i} className="sp-vbar" style={{ width: 4, height: isPlaying ? 14 : 6, borderRadius: 99, background: 'linear-gradient(to top, #f20d59, #ff5c93)', filter: 'drop-shadow(0 0 6px rgba(242,13,89,0.5))', transition: 'height 0.1s, opacity 0.3s', opacity: isPlaying ? 0.85 : 0.3 }} />))}
            </div>
            <div className="t3-anim3" style={{ textAlign: 'center', width: '100%', maxWidth: 500 }}>
              <h1 style={{ fontSize: 'clamp(24px, 5.5vw, 42px)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.05em', marginBottom: 4 }}>Para {recipient}</h1>
              <p style={{ color: '#f20d59', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 500 }}>De {sender || 'Alguien especial'} · {genre}</p>
            </div>
            {isCombo && <div className="t3-anim3" style={{ marginTop: 20, width: '100%', display: 'flex', justifyContent: 'center' }}><SongSelector songs={allSongs} activeIndex={activeIndex} onSelect={switchSong} template="electric_magenta" /></div>}
            {/* Progress */}
            <div className="t3-anim3" style={{ width: '100%', maxWidth: 500, marginTop: 24 }}>
              <div onClick={seek} style={{ position: 'relative', width: '100%', height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden', cursor: 'pointer' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${progress}%`, background: '#f20d59', filter: 'drop-shadow(0 0 6px rgba(242,13,89,0.5))', transition: 'width 0.15s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)' }}>{fmt(time)}</span>
                <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)' }}>{fmt(dur)}</span>
              </div>
            </div>
            {/* Controls */}
            <div className="t3-anim4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, marginTop: 24 }}>
              <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10); }} style={{ color: 'rgba(255,255,255,0.5)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 24 }}>⏪</button>
              <button onClick={toggle} style={{ width: 72, height: 72, borderRadius: '50%', background: '#f20d59', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(242,13,89,0.3)', fontSize: 32, color: 'white', paddingLeft: isPlaying ? 0 : 3 }}>{isPlaying ? '⏸' : '▶'}</button>
              <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.min(dur, audioRef.current.currentTime + 10); }} style={{ color: 'rgba(255,255,255,0.5)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 24 }}>⏩</button>
            </div>
            {/* Action buttons */}
            <div className="t3-anim4" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 24 }}>
              {song.lyrics && <button onClick={() => setShowLyrics(!showLyrics)} style={{ padding: '10px 24px', border: '1px solid rgba(242,13,89,0.3)', background: 'transparent', color: 'rgba(255,255,255,0.7)', borderRadius: 4, fontSize: 12, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer', fontFamily: "'Space Grotesk'" }}>{showLyrics ? 'Cerrar Letra' : 'Ver Letra'}</button>}
              <button onClick={download} style={{ padding: '10px 24px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.7)', borderRadius: 4, fontSize: 12, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer', fontFamily: "'Space Grotesk'" }}>Descargar</button>
              <button onClick={() => share(recipient)} style={{ padding: '10px 24px', border: 'none', background: '#25D366', color: 'white', borderRadius: 4, fontSize: 12, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer', fontFamily: "'Space Grotesk'" }}>💬 WhatsApp</button>
            </div>
            {/* Lyrics */}
            <div style={{ width: '100%', maxWidth: 500, marginTop: 8 }}>
              {lyricsBlock('rgba(255,255,255,0.7)', { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(242,13,89,0.1)', borderRadius: 4 }, 'rgba(242,13,89,0.5)')}
            </div>
            {/* Brand */}
            <div style={{ position: 'absolute', bottom: 20, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', fontWeight: 700 }}>RegalosQueCantan.com</p>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

// ═══════════════════════════════════════
// CSS
// ═══════════════════════════════════════
const SHARED_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
button:active{transform:scale(0.97)}
@keyframes spPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.08);opacity:0.7}}
.sp-lyrics-slide{max-height:0;overflow:hidden;opacity:0;transition:max-height 0.4s ease,opacity 0.3s ease}
.sp-lyrics-slide.open{max-height:50vh;opacity:1}
.sp-lyrics-scroll::-webkit-scrollbar{width:3px}
.sp-lyrics-scroll::-webkit-scrollbar-track{background:transparent}
.sp-lyrics-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:10px}
`;

const T1_CSS = `
@keyframes t1Float{0%{opacity:0;transform:translateY(30px)}15%{opacity:0.15}85%{opacity:0.15}100%{opacity:0;transform:translateY(-100vh) rotate(15deg)}}
@keyframes t1FadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
@keyframes t1Scale{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}
.t1-particle{position:absolute;color:rgba(244,192,37,0.15);animation:t1Float linear infinite}
.t1-glass{background:rgba(255,255,255,0.07);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.12)}
.t1-anim1{animation:t1FadeUp 0.8s ease-out 0.2s both}
.t1-anim2{animation:t1FadeUp 0.8s ease-out 0.4s both}
.t1-anim3{animation:t1Scale 0.8s ease-out 0.6s both}
.t1-anim4{animation:t1FadeUp 0.6s ease-out 0.9s both}
.t1-anim5{animation:t1FadeUp 0.6s ease-out 1.1s both}
`;

const T2_CSS = `
@keyframes t2FadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.t2-brushed{background:linear-gradient(135deg,#fff 0%,#fdfbf7 50%,#f7f2fb 100%);box-shadow:inset 0 1px 1px rgba(255,255,255,0.8),0 10px 40px -10px rgba(153,71,235,0.15)}
.t2-anim1{animation:t2FadeUp 0.7s ease-out 0.2s both}
.t2-anim2{animation:t2FadeUp 0.7s ease-out 0.4s both}
.t2-anim3{animation:t2FadeUp 0.7s ease-out 0.6s both}
.t2-anim4{animation:t2FadeUp 0.7s ease-out 0.9s both}
`;

const T3_CSS = `
@keyframes t3FadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
@keyframes t3SlideDown{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}}
.t3-anim1{animation:t3SlideDown 0.7s ease-out 0.2s both}
.t3-anim2{animation:t3FadeUp 0.8s ease-out 0.4s both}
.t3-anim3{animation:t3FadeUp 0.8s ease-out 0.7s both}
.t3-anim4{animation:t3FadeUp 0.6s ease-out 1.0s both}
`;
