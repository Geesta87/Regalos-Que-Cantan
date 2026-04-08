import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../App';
import SocialProofToast from '../components/SocialProofToast';

// ============================================
// CORRIDO SAMPLE SONGS
// ============================================
const corridoSamples = [
  {
    id: 1,
    title: 'Corrido Tumbado',
    style: 'Tumbado',
    emoji: '🔥',
    audioUrl: '/samples/corridos/tumbado.mp3',
    tag: 'Estilo Peso Pluma'
  },
  {
    id: 2,
    title: 'Corrido Alterado',
    style: 'Alterado',
    emoji: '⚡',
    audioUrl: '/samples/corridos/alterado.mp3',
    tag: 'Estilo El Komander'
  },
  {
    id: 3,
    title: 'Corrido Clásico',
    style: 'Clásico',
    emoji: '🎺',
    audioUrl: '/samples/corridos/clasico.mp3',
    tag: 'Estilo Tigres del Norte'
  }
];

// Corrido sub-genres for selection
const corridoStyles = [
  { id: 'tumbados', name: 'Tumbados', emoji: '🔥', desc: 'Moderno · Peso Pluma, Junior H', popular: true },
  { id: 'tradicional', name: 'Clásico', emoji: '🎺', desc: 'Épico · Los Tigres del Norte' },
  { id: 'romantico', name: 'Romántico', emoji: '💕', desc: 'Sentimental · Dedicatoria de amor' },
  { id: 'belico', name: 'Bélico', emoji: '⚡', desc: 'Pesado · Luis R Conriquez' },
  { id: 'alterados', name: 'Alterados', emoji: '🎸', desc: 'Intenso · El Komander' }
];

const testimonials = [
  {
    text: "Le hice un corrido tumbado a mi hermano para su cumpleaños. Se quedó sin palabras. El mejor regalo que le he dado.",
    name: "Daniel R.",
    location: "Houston, TX",
    rating: 5
  },
  {
    text: "Ordené un corrido clásico para mi papá. Toda la familia lloró. Suena como si fuera de Los Tigres.",
    name: "María G.",
    location: "Los Angeles, CA",
    rating: 5
  },
  {
    text: "Mi novia no podía creer que le hice un corrido romántico con su nombre. Ya van 3 que ordeno.",
    name: "Carlos M.",
    location: "San Antonio, TX",
    rating: 5
  }
];

const faqs = [
  {
    question: "¿Cómo suena un corrido personalizado?",
    answer: "Suena como canción profesional de estudio. Puedes elegir estilo tumbado (Peso Pluma), clásico (Tigres del Norte), romántico, bélico, o alterados. Incluye acordeón, bajo sexto, tuba y más."
  },
  {
    question: "¿Puedo escuchar antes de pagar?",
    answer: "¡Sí! Recibes un preview gratis de 2 versiones únicas. Solo pagas si te gusta."
  },
  {
    question: "¿Cuánto tiempo tarda?",
    answer: "Tu corrido personalizado está listo en aproximadamente 3 minutos. Entrega 100% digital e instantánea."
  },
  {
    question: "¿Qué información necesitan?",
    answer: "Solo necesitamos el nombre del homenajeado, la ocasión (cumpleaños, logro, dedicatoria, etc.), y detalles especiales que quieras incluir en la letra."
  }
];

// Star Rating
function StarRating({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <span key={i} className={`text-lg ${i < rating ? 'text-emerald-400' : 'text-white/20'}`}>★</span>
      ))}
    </div>
  );
}

// FAQ Item
function FAQItem({ question, answer, isOpen, onClick }) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button onClick={onClick} className="w-full p-5 flex items-center justify-between text-left bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
        <span className="font-semibold text-white pr-4">{question}</span>
        <span className={`material-symbols-outlined text-emerald-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>expand_more</span>
      </button>
      {isOpen && <div className="px-5 pb-5 text-white/70">{answer}</div>}
    </div>
  );
}

export default function CorridosLanding() {
  const { navigateTo, setFormData } = useContext(AppContext);
  const [playingId, setPlayingId] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [openFAQ, setOpenFAQ] = useState(null);
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [styleError, setStyleError] = useState(false);
  const audioRef = useRef(null);
  const styleRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Audio logic
  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    const onEnd = () => { setPlayingId(null); setCurrentTime(0); };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, [playingId]);

  const handlePlay = (sample) => {
    if (audioRef.current) {
      audioRef.current.src = sample.audioUrl;
      audioRef.current.play();
      setPlayingId(sample.id);
    }
  };

  const handlePause = () => {
    if (audioRef.current) { audioRef.current.pause(); setPlayingId(null); }
  };

  const handleCreateCorrido = () => {
    // Require sub-genre selection before entering the funnel
    if (!selectedStyle) {
      setStyleError(true);
      styleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setFormData(prev => ({
      ...prev,
      genre: 'corrido',
      genreName: 'Corrido',
      subGenre: selectedStyle.id,
      subGenreName: selectedStyle.name
    }));
    // Persist coupon so checkout pages auto-apply the $24.99 ad price
    sessionStorage.setItem('rqc_coupon', 'CORRIDO5');
    navigateTo('occasion');
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <style>{`
        @keyframes btnGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(16,185,129,0.4), 0 0 40px rgba(16,185,129,0.2); }
          50% { box-shadow: 0 0 30px rgba(16,185,129,0.6), 0 0 60px rgba(16,185,129,0.3), 0 0 80px rgba(16,185,129,0.15); }
        }
      `}</style>
      <audio ref={audioRef} preload="metadata" />
      <SocialProofToast />

      {/* Urgency bar removed for cleaner look */}

      {/* ==================== HEADER ==================== */}
      <header className="bg-[#0a0a0a]/80 backdrop-blur-md py-4 px-6 md:px-12 border-b border-white/5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="cursor-pointer" onClick={() => navigateTo('landing')}>
            <h2 className="font-display text-white text-xl md:text-2xl font-medium tracking-tight">
              RegalosQueCantan
            </h2>
          </div>
          <button
            onClick={handleCreateCorrido}
            className="bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2 rounded-full text-sm font-bold transition-all"
          >
            🎺 Crear Mi Corrido
          </button>
        </div>
      </header>

      {/* ==================== 1. HERO SECTION — Polaroid photos ==================== */}
      <section className="relative overflow-hidden" style={{ background: '#000' }}>
        {/* Hero background — clean, no polaroid photos */}

        {/* Dark overlay */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.65) 50%, rgba(0,0,0,0.9) 100%)', pointerEvents: 'none' }} />

        {/* Green glow */}
        <div className="absolute" style={{ top: '15%', left: '50%', transform: 'translateX(-50%)', width: 600, height: 400, background: 'radial-gradient(ellipse, rgba(16,185,129,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div className="relative z-20 container mx-auto px-6 text-center max-w-4xl" style={{ padding: '100px 24px 80px' }}>
          <h1 className="text-white text-4xl md:text-6xl lg:text-7xl font-black leading-tight tracking-tighter font-display mb-6" style={{ textShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
            Regala Un Corrido <br />
            <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-emerald-200 to-emerald-400">
              Personalizado
            </span>
          </h1>

          <p className="text-white/70 text-lg md:text-xl font-light leading-relaxed max-w-2xl mx-auto mb-8" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
            Un corrido único con el nombre, la historia y el estilo que tú elijas.
            Estilo Peso Pluma, Tigres del Norte, o el que prefieras — listo en minutos.
          </p>

          <button
            onClick={handleCreateCorrido}
            className="group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-10 bg-emerald-600 text-white text-lg font-bold shadow-2xl shadow-emerald-500/30 transition-all hover:scale-105 active:scale-95 animate-[btnGlow_2s_ease-in-out_infinite]"
            style={{ animation: 'btnGlow 2s ease-in-out infinite' }}
          >
            <span className="relative z-10">🎺 Crear Mi Corrido — $24.99</span>
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </button>

          <div className="mt-5 flex flex-wrap justify-center items-center gap-4">
            <span className="inline-flex items-center gap-2 bg-green-500 text-white rounded-full px-5 py-2 text-xs font-bold">
              ⚡ Listo en ~3 minutos · Entrega instantánea
            </span>
            <span className="text-sm text-white/60">
              ✨ Desde <span className="line-through text-white/30">$49.99</span> <span className="text-white font-extrabold text-base">$24.99</span> · Preview gratis ✨
            </span>
          </div>

          <p className="mt-3 text-white/40 text-sm">
            ✓ 2 versiones únicas • ✓ Letra personalizada • ✓ Descarga MP3
          </p>
        </div>
      </section>

      {/* ==================== 2. CORRIDO STYLES PICKER ==================== */}
      <section ref={styleRef} className="py-16 px-6 bg-[#0f0f0f]">
        <div className="max-w-4xl mx-auto">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500 text-black font-black text-lg">1</div>
            <div className="h-[2px] w-12 bg-white/10"></div>
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white/30 font-bold text-lg">2</div>
            <div className="h-[2px] w-12 bg-white/10"></div>
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white/30 font-bold text-lg">3</div>
          </div>

          <div className={`text-center mb-8 transition-all duration-300 ${styleError && !selectedStyle ? 'animate-pulse' : ''}`}>
            <h2 className="text-white text-3xl md:text-4xl font-black">
              Paso 1: Elige Tu Estilo de Corrido
            </h2>
            <p className="text-white/50 text-base mt-2">Cada estilo tiene su propio sonido y vibra</p>
            {styleError && !selectedStyle && (
              <div className="inline-flex items-center gap-2 mt-3 bg-red-500/20 border border-red-500/40 rounded-full px-5 py-2">
                <span className="text-red-400 text-sm font-bold">Selecciona un estilo para continuar</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
            {corridoStyles.map((style) => (
              <button
                key={style.id}
                onClick={() => {
                  const newStyle = selectedStyle?.id === style.id ? null : style;
                  setSelectedStyle(newStyle);
                  setStyleError(false);
                  if (newStyle) {
                    setFormData(prev => ({
                      ...prev,
                      genre: 'corrido',
                      genreName: 'Corrido',
                      subGenre: newStyle.id,
                      subGenreName: newStyle.name
                    }));
                    sessionStorage.setItem('rqc_coupon', 'CORRIDO5');
                    setTimeout(() => navigateTo('occasion'), 300);
                  }
                }}
                className={`relative rounded-2xl p-5 text-center transition-all duration-300 border-2 ${
                  selectedStyle?.id === style.id
                    ? 'border-emerald-400 bg-emerald-500/15 scale-[1.03] shadow-xl shadow-emerald-500/25 ring-2 ring-emerald-400/30'
                    : styleError && !selectedStyle
                    ? 'border-red-500/40 bg-white/[0.03] hover:border-emerald-500/40 hover:bg-white/[0.06]'
                    : 'border-white/10 bg-white/[0.03] hover:border-emerald-500/40 hover:bg-white/[0.06]'
                }`}
              >
                {style.popular && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-black text-[10px] font-black px-3 py-0.5 rounded-full shadow-lg">
                    POPULAR
                  </div>
                )}
                <div className="text-4xl mb-2">{style.emoji}</div>
                <div className="text-white font-bold text-base">{style.name}</div>
                <div className="text-white/40 text-xs mt-1 leading-tight">{style.desc}</div>
                {selectedStyle?.id === style.id ? (
                  <div className="absolute top-2 right-2 w-6 h-6 bg-emerald-400 rounded-full flex items-center justify-center shadow-lg">
                    <span className="text-black text-sm font-bold">✓</span>
                  </div>
                ) : (
                  <div className="absolute top-2 right-2 w-6 h-6 border-2 border-white/20 rounded-full"></div>
                )}
              </button>
            ))}
          </div>

          <div className="text-center mt-8">
            <button
              onClick={handleCreateCorrido}
              className={`inline-flex items-center gap-2 font-bold px-10 py-4 rounded-full text-lg transition-all shadow-lg ${
                selectedStyle
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-black hover:scale-105 active:scale-95 shadow-emerald-500/30'
                  : 'bg-white/10 text-white/40 cursor-default'
              }`}
            >
              {selectedStyle
                ? `🎺 Crear Corrido ${selectedStyle.name} — $24.99`
                : '👆 Selecciona un estilo arriba'
              }
            </button>
          </div>
        </div>
      </section>

      {/* ==================== 3. AUDIO SAMPLES ==================== */}
      <section className="py-16 px-6 bg-[#0a0a0a]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <span className="text-emerald-400 uppercase tracking-[0.3em] text-xs font-bold">🎧 Escucha Ejemplos</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">
              Así Suenan Nuestros Corridos
            </h2>
            <p className="text-white/60 mt-2">Canciones reales creadas para clientes</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {corridoSamples.map((sample) => {
              const isPlaying = playingId === sample.id;
              const progress = isPlaying && duration > 0 ? (currentTime / duration) * 100 : 0;
              return (
                <div
                  key={sample.id}
                  className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                    isPlaying ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-white/10 bg-white/[0.03] hover:border-emerald-500/30'
                  }`}
                >
                  <div className="p-5">
                    <div className="flex items-center gap-4">
                      {/* Play button */}
                      <button
                        onClick={() => isPlaying ? handlePause() : handlePlay(sample)}
                        className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-all ${
                          isPlaying ? 'bg-emerald-500 scale-110' : 'bg-white/10 hover:bg-emerald-500/30'
                        }`}
                      >
                        <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {isPlaying ? 'pause' : 'play_arrow'}
                        </span>
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{sample.emoji}</span>
                          <h4 className="font-bold text-white text-sm truncate">{sample.title}</h4>
                        </div>
                        <p className="text-emerald-400 text-xs font-semibold mt-0.5">{sample.tag}</p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-4 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-white/40 text-[10px] font-mono">{isPlaying ? `${Math.floor(currentTime)}s` : '0:35'}</span>
                    </div>
                  </div>
                  {isPlaying && (
                    <div className="bg-emerald-500/10 px-5 py-2 flex items-center gap-2 border-t border-emerald-500/20">
                      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                      <span className="text-emerald-400 text-xs font-bold">Reproduciendo</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-center text-white/30 text-xs mt-4">* Nombres cambiados por privacidad</p>
        </div>
      </section>

      {/* ==================== 4. HOW IT WORKS ==================== */}
      <section className="py-16 px-6 bg-[#0f0f0f]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-emerald-400 uppercase tracking-[0.3em] text-xs font-bold">📝 Cómo Funciona</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">3 Pasos Simples</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: '🎺', step: '1', title: 'Elige Tu Estilo', desc: 'Tumbado, clásico, romántico, bélico o alterados. Tú decides.' },
              { icon: '📝', step: '2', title: 'Cuéntanos La Historia', desc: 'Nombres, ocasión y los detalles que hacen única tu canción.' },
              { icon: '🎵', step: '3', title: 'Recibe Tu Corrido', desc: 'En ~3 min recibes 2 versiones únicas en MP3 de alta calidad.' }
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-4xl">
                  {item.icon}
                </div>
                <div className="text-emerald-400 font-bold text-sm mb-2">PASO {item.step}</div>
                <h3 className="text-white text-xl font-bold mb-2">{item.title}</h3>
                <p className="text-white/60">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <button
              onClick={handleCreateCorrido}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold px-10 py-4 rounded-full text-lg transition-all hover:scale-105 active:scale-95 shadow-xl shadow-emerald-500/20"
            >
              🎺 Crear Mi Corrido
            </button>
          </div>
        </div>
      </section>

      {/* ==================== 5. TESTIMONIALS ==================== */}
      <section className="py-16 px-6 bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-emerald-400 uppercase tracking-[0.3em] text-xs font-bold">⭐ Testimonios</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">Lo Que Dicen Nuestros Clientes</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <div key={i} className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 hover:border-emerald-500/30 transition-all">
                <StarRating rating={t.rating} />
                <p className="text-white/90 mt-4 mb-6 italic leading-relaxed">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <span className="text-emerald-400 font-bold">{t.name[0]}</span>
                  </div>
                  <div>
                    <p className="text-white font-semibold">{t.name}</p>
                    <p className="text-white/50 text-sm">{t.location}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== 6. PRICING ==================== */}
      <section className="py-16 px-6 bg-[#0f0f0f]">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <span className="text-emerald-400 uppercase tracking-[0.3em] text-xs font-bold">💰 Precio</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">El Regalo Más Chingón</h2>
          </div>

          <div className="bg-white/[0.03] border-2 border-emerald-500/50 rounded-3xl p-8 text-center relative overflow-hidden">
            <div className="absolute top-4 -right-8 bg-emerald-500 text-black text-xs font-black px-10 py-1 rotate-45">
              🔥 OFERTA
            </div>

            <div className="text-5xl mb-3">🎺</div>
            <div className="mb-6">
              <span className="text-white/40 line-through text-lg">$49.99</span>
              <div className="text-white text-5xl font-black">$24.99</div>
              <span className="text-emerald-400 text-sm font-semibold">Pago único • Acceso de por vida</span>
            </div>

            <div className="space-y-3 text-left mb-8">
              {[
                'Corrido completo (~2 minutos)',
                '2 versiones únicas para elegir',
                'Descarga MP3 de alta calidad',
                'Letra 100% personalizada',
                'Carátula de álbum única',
                'Estilo que tú elijas'
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-white/80">
                  <span className="material-symbols-outlined text-green-400">check_circle</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleCreateCorrido}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full h-14 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-lg font-bold shadow-xl transition-all hover:scale-105 active:scale-95"
            >
              🎺 Crear Mi Corrido
            </button>

            <p className="mt-4 text-white/50 text-sm flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-sm">lock</span>
              Preview GRATIS antes de pagar
            </p>
          </div>

          {/* Bundle upsell hint */}
          <div className="mt-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-center">
            <p className="text-emerald-400 text-sm font-bold">🎁 ¿Quieres 2 corridos? Ahorra $10 con el bundle por $39.99</p>
          </div>
        </div>
      </section>

      {/* ==================== 7. FAQ ==================== */}
      <section className="py-16 px-6 bg-[#0a0a0a]">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-emerald-400 uppercase tracking-[0.3em] text-xs font-bold">❓ Preguntas Frecuentes</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">¿Tienes Dudas?</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <FAQItem key={i} question={faq.question} answer={faq.answer} isOpen={openFAQ === i} onClick={() => setOpenFAQ(openFAQ === i ? null : i)} />
            ))}
          </div>
        </div>
      </section>

      {/* ==================== 8. FINAL CTA ==================== */}
      <section className="py-20 px-6 bg-gradient-to-b from-[#0f0f0f] to-[#0a0a0a] relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-15">
          <div className="absolute top-10 left-[20%] text-6xl">🎺</div>
          <div className="absolute bottom-10 right-[20%] text-6xl">🔥</div>
        </div>

        <div className="max-w-xl mx-auto text-center relative z-10">
          <div className="text-5xl mb-4">🎺</div>
          <h2 className="text-white text-3xl md:text-4xl font-black mb-4">
            Regala Un Corrido Único
          </h2>
          <p className="text-white/70 text-lg mb-8">
            Un corrido personalizado que recordará para siempre.
            Para cumpleaños, logros, o simplemente porque se lo merece.
          </p>

          <button
            onClick={handleCreateCorrido}
            className="group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-12 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-xl font-bold shadow-2xl shadow-emerald-500/30 transition-all hover:scale-105 active:scale-95"
          >
            <span className="relative z-10">🎺 Crear Mi Corrido — $24.99</span>
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </button>

          <p className="mt-6 text-emerald-400 font-semibold flex items-center justify-center gap-2">
            ⚡ Listo en ~3 minutos · +500 corridos creados
          </p>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="py-8 px-6 bg-[#0a0a0a] border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="font-display text-white/30 text-lg">RegalosQueCantan</div>
          <div className="flex gap-6">
            <a className="text-white/30 hover:text-emerald-400 transition-colors text-sm" href="/politica-de-privacidad">Privacidad</a>
            <a className="text-white/30 hover:text-emerald-400 transition-colors text-sm" href="/terminos-de-servicio">Términos</a>
            <a className="text-white/30 hover:text-emerald-400 transition-colors text-sm" href="#">Contacto</a>
          </div>
          <p className="text-white/20 text-sm">© 2026 RegalosQueCantan</p>
        </div>
      </footer>
    </div>
  );
}
