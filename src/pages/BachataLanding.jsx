import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../App';
import SocialProofToast from '../components/SocialProofToast';
import { trackStep } from '../services/tracking';

// ============================================
// BACHATA — dedicated landing page
// Romantic rose/gold aesthetic. Romeo Santos / Prince Royce framing.
// Photo slots live under /images/bachata/*.jpg — each <PhotoFrame> shows a
// warm gradient fallback until the real gpt-image-2 photo is dropped in, so
// the page looks intentional even before the imagery lands.
// ============================================

// Bachata sample songs (audio slots — drop real MP3s under /samples/bachata/)
// Real, paid customer bachata songs (cut to 60s). No artist references here.
const bachataSamples = [
  { id: 1, title: 'Bachata Romántica', style: 'Romántica', emoji: '🌹', audioUrl: '/samples/bachata/muestra-romantica.mp3', tag: 'Romántica y emotiva' },
  { id: 2, title: 'Bachata Urbana Sensual', style: 'Urbana Sensual', emoji: '💋', audioUrl: '/samples/bachata/muestra-urbana.mp3', tag: 'Moderna y sensual' },
  { id: 3, title: 'Bachata Clásica Dominicana', style: 'Clásica', emoji: '🎸', audioUrl: '/samples/bachata/muestra-tradicional.mp3', tag: 'Auténtica dominicana' }
];

// Sub-styles — ids MUST match src/config/genres.js → bachata.subgenres
const bachataStyles = [
  { id: 'romantica', name: 'Romántica', emoji: '🌹', desc: 'Emotiva · Frank Reyes', popular: true },
  { id: 'urbana_sensual', name: 'Urbana Sensual', emoji: '💋', desc: 'Moderna · Romeo Santos' },
  { id: 'tradicional', name: 'Clásica Dominicana', emoji: '🎸', desc: 'Auténtica · Antony Santos' }
];

const testimonials = [
  { text: "Le hice una bachata a mi esposa para nuestro aniversario. Lloró desde el primer verso. Suena idéntica a Romeo Santos.", name: "José L.", location: "Nueva York, NY", rating: 5 },
  { text: "Pedí una bachata romántica para mi novia en San Valentín. Nunca la había visto tan emocionada. El mejor regalo.", name: "Anthony R.", location: "Miami, FL", rating: 5 },
  { text: "La guitarra, el bongó, todo suena profesional. Mi esposa la puso en repeat toda la semana. Vale cada centavo.", name: "Wilkin M.", location: "Boston, MA", rating: 5 }
];

const faqs = [
  { question: "¿Cómo suena una bachata personalizada?", answer: "Suena como Romeo Santos o Prince Royce — guitarra requinteada, bongós y ese ritmo sensual — pero con una letra de amor escrita solo para tu persona especial. Calidad de estudio profesional." },
  { question: "¿Puedo escuchar antes de pagar?", answer: "¡Sí! Recibes un preview gratis de 2 versiones únicas. Solo pagas si te enamora." },
  { question: "¿Cuánto tiempo tarda?", answer: "Tu bachata personalizada está lista en aproximadamente 3 minutos. Entrega 100% digital e instantánea." },
  { question: "¿Es un buen regalo romántico?", answer: "La bachata es el género del amor por excelencia. Una bachata con el nombre de tu pareja es uno de los regalos más emotivos y originales que puedes dar — perfecta para aniversarios, San Valentín o una declaración de amor." }
];

// Photo frame with warm gradient fallback (image drops in later, no layout shift)
function PhotoFrame({ src, alt, className = '', gradient = 'linear-gradient(135deg, #4c0519 0%, #9f1239 45%, #b45309 100%)', children }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: gradient }}>
      {!failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {/* Subtle texture over the fallback gradient */}
      {failed && (
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.25), transparent 55%)' }} />
      )}
      {children}
    </div>
  );
}

// Reaction video band — sits right above the hero. Autoplays muted + looping
// (browser policy), with a tap-to-unmute control.
function ReactionVideo() {
  const [muted, setMuted] = useState(true);
  const ref = useRef(null);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) v.play().catch(() => {});
  };
  return (
    <section className="bg-gradient-to-b from-[#0f0a0c] to-[#0a0708] pt-8 pb-6 px-6">
      <div className="max-w-xs mx-auto text-center">
        <span className="text-rose-400 uppercase tracking-[0.3em] text-[11px] font-bold">💕 Reacción Real</span>
        <p className="text-white/60 text-sm mt-2 mb-4">Mira lo que pasa cuando escuchan su canción</p>
        <div className="relative rounded-[28px] overflow-hidden border border-rose-500/30 shadow-2xl shadow-black/50 bg-black">
          <video
            ref={ref}
            src="/videos/testimonial3.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="w-full h-auto block"
          />
          <button
            onClick={toggle}
            aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/65 backdrop-blur border border-white/20 text-white text-xs font-bold pl-2.5 pr-3 py-2 hover:bg-black/85 transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-lg">{muted ? 'volume_off' : 'volume_up'}</span>
            {muted && <span>Toca para escuchar</span>}
          </button>
        </div>
      </div>
    </section>
  );
}

// Hero medley player — self-contained (own audio + state) so it never clashes
// with the samples player below. Plays the 3-song preview reel.
function MedleyPlayer() {
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onTime = () => setT(a.currentTime);
    const onMeta = () => setDur(a.duration || 0);
    const onEnd = () => { setPlaying(false); setT(0); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  };
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const seek = (e) => {
    const a = ref.current;
    if (!a || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * dur;
  };
  const pct = dur > 0 ? (t / dur) * 100 : 0;

  return (
    <div className="mx-auto mt-6 max-w-md">
      <audio ref={ref} src="/samples/bachata/bachata-medley.mp3" preload="metadata" />
      <div className="flex items-center gap-4 rounded-2xl border border-rose-500/30 bg-black/40 backdrop-blur px-5 py-4 shadow-lg shadow-black/30">
        <button
          onClick={toggle}
          aria-label={playing ? 'Pausar muestra' : 'Reproducir muestra'}
          className="w-12 h-12 shrink-0 rounded-full bg-rose-500 hover:bg-rose-400 flex items-center justify-center shadow-lg shadow-rose-500/30 transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
            {playing ? 'pause' : 'play_arrow'}
          </span>
        </button>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-white text-sm font-bold">🎧 Escucha una muestra</span>
            <span className="text-white/40 text-[11px] font-mono">{fmt(t)} / {fmt(dur)}</span>
          </div>
          <div onClick={seek} className="h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer">
            <div className="h-full bg-gradient-to-r from-rose-500 to-pink-400 rounded-full transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StarRating({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <span key={i} className={`text-lg ${i < rating ? 'text-rose-400' : 'text-white/20'}`}>★</span>
      ))}
    </div>
  );
}

function FAQItem({ question, answer, isOpen, onClick }) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button onClick={onClick} className="w-full p-5 flex items-center justify-between text-left bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
        <span className="font-semibold text-white pr-4">{question}</span>
        <span className={`material-symbols-outlined text-rose-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>expand_more</span>
      </button>
      {isOpen && <div className="px-5 pb-5 text-white/70">{answer}</div>}
    </div>
  );
}

export default function BachataLanding() {
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
    // Fire a dedicated ViewContent for ad optimization + clean attribution.
    trackStep('landing_bachata');
  }, []);

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
      audioRef.current.play().catch(() => {});
      setPlayingId(sample.id);
    }
  };
  const handlePause = () => {
    if (audioRef.current) { audioRef.current.pause(); setPlayingId(null); }
  };

  const enterFunnel = (style) => {
    setFormData(prev => ({
      ...prev,
      genre: 'bachata',
      genreName: 'Bachata',
      subGenre: style.id,
      subGenreName: style.name
    }));
    navigateTo('occasion');
  };

  const handleCreate = () => {
    if (!selectedStyle) {
      setStyleError(true);
      styleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    enterFunnel(selectedStyle);
  };

  return (
    <div className="min-h-screen bg-[#0a0708] flex flex-col">
      <style>{`
        @keyframes btnGlowRose {
          0%, 100% { box-shadow: 0 0 20px rgba(225,29,72,0.4), 0 0 40px rgba(225,29,72,0.2); }
          50% { box-shadow: 0 0 30px rgba(225,29,72,0.6), 0 0 60px rgba(225,29,72,0.3), 0 0 80px rgba(244,114,182,0.15); }
        }
        @keyframes floatSlow { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
      `}</style>
      <audio ref={audioRef} preload="metadata" />
      <SocialProofToast />

      {/* ==================== HEADER ==================== */}
      <header className="bg-[#0a0708]/80 backdrop-blur-md py-4 px-6 md:px-12 border-b border-white/5 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="cursor-pointer" onClick={() => navigateTo('landing')}>
            <h2 className="font-display text-white text-xl md:text-2xl font-medium tracking-tight">RegalosQueCantan</h2>
          </div>
          <button onClick={handleCreate} className="bg-rose-500 hover:bg-rose-400 text-white px-5 py-2 rounded-full text-sm font-bold transition-all">
            🌹 Crear Mi Bachata
          </button>
        </div>
      </header>

      {/* ==================== 1. HERO ==================== */}
      <section className="relative overflow-hidden">
        {/* Hero photo */}
        <div className="absolute inset-0">
          <PhotoFrame
            src="/images/bachata/hero.jpg"
            alt="Pareja bailando bachata en un ambiente romántico"
            className="w-full h-full"
            gradient="linear-gradient(135deg, #1a0410 0%, #4c0519 40%, #7c2d12 100%)"
          />
        </div>
        {/* Cinematic overlay — light enough to show the photo, dark at the base to blend into the next section */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,7,8,0.30) 0%, rgba(10,7,8,0.52) 55%, rgba(10,7,8,0.94) 100%)' }} />
        {/* Left-side scrim so the headline stays legible over any photo */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 70% at 50% 45%, rgba(10,7,8,0.55) 0%, transparent 75%)', pointerEvents: 'none' }} />
        {/* Rose glow */}
        <div className="absolute" style={{ top: '12%', left: '50%', transform: 'translateX(-50%)', width: 640, height: 420, background: 'radial-gradient(ellipse, rgba(225,29,72,0.22) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div className="relative z-20 container mx-auto px-6 text-center max-w-4xl" style={{ padding: '110px 24px 90px' }}>
          <span className="inline-flex items-center gap-2 bg-white/10 backdrop-blur border border-white/15 text-rose-200 rounded-full px-4 py-1.5 text-xs font-bold tracking-wide mb-6">
            🌹 EL GÉNERO DEL AMOR
          </span>
          <h1 className="text-white text-4xl md:text-6xl lg:text-7xl font-black leading-tight tracking-tighter font-display mb-6" style={{ textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
            Regala Una Bachata <br />
            <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-rose-400 via-pink-200 to-amber-300">
              Personalizada
            </span>
          </h1>
          <p className="text-white/75 text-lg md:text-xl font-light leading-relaxed max-w-2xl mx-auto mb-8" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
            Una canción de amor única con su nombre y su historia. Guitarra requinteada,
            bongós y ese ritmo sensual — estilo Romeo Santos y Prince Royce, lista en minutos.
          </p>
          <button
            onClick={handleCreate}
            className="group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-10 bg-rose-600 text-white text-lg font-bold shadow-2xl shadow-rose-500/30 transition-all hover:scale-105 active:scale-95"
            style={{ animation: 'btnGlowRose 2s ease-in-out infinite' }}
          >
            <span className="relative z-10">🌹 Crear Mi Bachata — $29.99</span>
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </button>

          {/* 3-song preview medley — plays right under the CTA */}
          <MedleyPlayer />

          <div className="mt-5 flex flex-wrap justify-center items-center gap-4">
            <span className="inline-flex items-center gap-2 bg-rose-500 text-white rounded-full px-5 py-2 text-xs font-bold">
              ⚡ Lista en ~3 minutos · Entrega instantánea
            </span>
            <span className="text-sm text-white/60">
              ✨ <span className="line-through text-white/30">$79.99</span> <span className="text-white font-extrabold text-base">$29.99</span> · Oferta por tiempo limitado · Preview gratis ✨
            </span>
          </div>
          <p className="mt-3 text-white/40 text-sm">✓ 2 versiones únicas • ✓ Letra personalizada • ✓ Descarga MP3</p>
        </div>
      </section>

      {/* ==================== REACTION VIDEO (below hero) ==================== */}
      <ReactionVideo />

      {/* ==================== 2. STYLE PICKER ==================== */}
      <section ref={styleRef} className="py-16 px-6 bg-[#0f0a0c]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-rose-500 text-white font-black text-lg">1</div>
            <div className="h-[2px] w-12 bg-white/10"></div>
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white/30 font-bold text-lg">2</div>
            <div className="h-[2px] w-12 bg-white/10"></div>
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white/30 font-bold text-lg">3</div>
          </div>
          <div className={`text-center mb-8 transition-all duration-300 ${styleError && !selectedStyle ? 'animate-pulse' : ''}`}>
            <h2 className="text-white text-3xl md:text-4xl font-black">Paso 1: Elige Tu Estilo de Bachata</h2>
            <p className="text-white/50 text-base mt-2">Cada estilo tiene su propio sabor romántico</p>
            {styleError && !selectedStyle && (
              <div className="inline-flex items-center gap-2 mt-3 bg-red-500/20 border border-red-500/40 rounded-full px-5 py-2">
                <span className="text-red-400 text-sm font-bold">Selecciona un estilo para continuar</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {bachataStyles.map((style) => (
              <button
                key={style.id}
                onClick={() => {
                  const newStyle = selectedStyle?.id === style.id ? null : style;
                  setSelectedStyle(newStyle);
                  setStyleError(false);
                  if (newStyle) setTimeout(() => enterFunnel(newStyle), 300);
                }}
                className={`relative rounded-2xl p-6 text-center transition-all duration-300 border-2 ${
                  selectedStyle?.id === style.id
                    ? 'border-rose-400 bg-rose-500/15 scale-[1.03] shadow-xl shadow-rose-500/25 ring-2 ring-rose-400/30'
                    : styleError && !selectedStyle
                    ? 'border-red-500/40 bg-white/[0.03] hover:border-rose-500/40 hover:bg-white/[0.06]'
                    : 'border-white/10 bg-white/[0.03] hover:border-rose-500/40 hover:bg-white/[0.06]'
                }`}
              >
                {style.popular && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-rose-500 text-white text-[10px] font-black px-3 py-0.5 rounded-full shadow-lg">POPULAR</div>
                )}
                <div className="text-4xl mb-2">{style.emoji}</div>
                <div className="text-white font-bold text-base">{style.name}</div>
                <div className="text-white/40 text-xs mt-1 leading-tight">{style.desc}</div>
                {selectedStyle?.id === style.id ? (
                  <div className="absolute top-2 right-2 w-6 h-6 bg-rose-400 rounded-full flex items-center justify-center shadow-lg">
                    <span className="text-white text-sm font-bold">✓</span>
                  </div>
                ) : (
                  <div className="absolute top-2 right-2 w-6 h-6 border-2 border-white/20 rounded-full"></div>
                )}
              </button>
            ))}
          </div>
          <div className="text-center mt-8">
            <button
              onClick={handleCreate}
              className={`inline-flex items-center gap-2 font-bold px-10 py-4 rounded-full text-lg transition-all shadow-lg ${
                selectedStyle ? 'bg-rose-500 hover:bg-rose-400 text-white hover:scale-105 active:scale-95 shadow-rose-500/30' : 'bg-white/10 text-white/40 cursor-default'
              }`}
            >
              {selectedStyle ? `🌹 Crear Bachata ${selectedStyle.name} — $29.99` : '👆 Selecciona un estilo arriba'}
            </button>
          </div>
        </div>
      </section>

      {/* ==================== 3. PHOTO STORY STRIP ==================== */}
      <section className="py-16 px-6 bg-[#0a0708]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <span className="text-rose-400 uppercase tracking-[0.3em] text-xs font-bold">💃 La Vibra</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">El Sonido Que Enamora</h2>
            <p className="text-white/60 mt-2 max-w-xl mx-auto">Guitarra requinteada, bongós y güira — el alma de República Dominicana en una canción hecha para tu persona especial.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <PhotoFrame src="/images/bachata/couple-dance.jpg" alt="Pareja bailando bachata pegados" className="rounded-2xl aspect-[4/5] border border-white/10"
              gradient="linear-gradient(135deg, #4c0519 0%, #be123c 100%)">
              <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-white font-bold text-lg">Para bailar pegados</p>
                <p className="text-white/60 text-sm">Ese momento de los dos</p>
              </div>
            </PhotoFrame>
            <PhotoFrame src="/images/bachata/guitar.jpg" alt="Guitarra requinto y bongós de bachata" className="rounded-2xl aspect-[4/5] border border-white/10 md:mt-8"
              gradient="linear-gradient(135deg, #7c2d12 0%, #b45309 100%)">
              <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-white font-bold text-lg">Sonido auténtico</p>
                <p className="text-white/60 text-sm">Requinto · bongó · güira</p>
              </div>
            </PhotoFrame>
            <PhotoFrame src="/images/bachata/reaction.jpg" alt="Reacción emotiva al escuchar su bachata" className="rounded-2xl aspect-[4/5] border border-white/10"
              gradient="linear-gradient(135deg, #500724 0%, #9d174d 100%)">
              <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-white font-bold text-lg">Su reacción</p>
                <p className="text-white/60 text-sm">Cuando escucha su nombre</p>
              </div>
            </PhotoFrame>
          </div>
        </div>
      </section>

      {/* ==================== 4. AUDIO SAMPLES ==================== */}
      <section className="py-16 px-6 bg-[#0f0a0c]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <span className="text-rose-400 uppercase tracking-[0.3em] text-xs font-bold">🎧 Escucha Ejemplos</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">Así Suenan Nuestras Bachatas</h2>
            <p className="text-white/60 mt-2">Canciones reales creadas para clientes</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {bachataSamples.map((sample) => {
              const isPlaying = playingId === sample.id;
              const progress = isPlaying && duration > 0 ? (currentTime / duration) * 100 : 0;
              return (
                <div key={sample.id} className={`rounded-2xl border transition-all duration-300 overflow-hidden ${isPlaying ? 'border-rose-400/60 bg-rose-500/10' : 'border-white/10 bg-white/[0.03] hover:border-rose-500/30'}`}>
                  <div className="p-5">
                    <div className="flex items-center gap-4">
                      <button onClick={() => isPlaying ? handlePause() : handlePlay(sample)}
                        className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-all ${isPlaying ? 'bg-rose-500 scale-110' : 'bg-white/10 hover:bg-rose-500/30'}`}>
                        <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>{isPlaying ? 'pause' : 'play_arrow'}</span>
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{sample.emoji}</span>
                          <h4 className="font-bold text-white text-sm truncate">{sample.title}</h4>
                        </div>
                        <p className="text-rose-400 text-xs font-semibold mt-0.5">{sample.tag}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-400 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-white/40 text-[10px] font-mono">{isPlaying ? `${Math.floor(currentTime)}s` : '1:00'}</span>
                    </div>
                  </div>
                  {isPlaying && (
                    <div className="bg-rose-500/10 px-5 py-2 flex items-center gap-2 border-t border-rose-500/20">
                      <span className="w-2 h-2 bg-rose-400 rounded-full animate-pulse" />
                      <span className="text-rose-400 text-xs font-bold">Reproduciendo</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-center text-white/30 text-xs mt-4">* Nombres cambiados por privacidad</p>
        </div>
      </section>

      {/* ==================== 5. HOW IT WORKS ==================== */}
      <section className="py-16 px-6 bg-[#0a0708]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-rose-400 uppercase tracking-[0.3em] text-xs font-bold">📝 Cómo Funciona</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">3 Pasos Simples</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: '🌹', step: '1', title: 'Elige Tu Estilo', desc: 'Romántica, urbana sensual o clásica dominicana. Tú decides la vibra.' },
              { icon: '💌', step: '2', title: 'Cuéntanos Su Historia', desc: 'Su nombre, la ocasión y los detalles que hacen único su amor.' },
              { icon: '🎶', step: '3', title: 'Recibe Tu Bachata', desc: 'En ~3 min recibes 2 versiones únicas en MP3 de alta calidad.' }
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-rose-500/15 border border-rose-500/20 flex items-center justify-center text-4xl">{item.icon}</div>
                <div className="text-rose-400 font-bold text-sm mb-2">PASO {item.step}</div>
                <h3 className="text-white text-xl font-bold mb-2">{item.title}</h3>
                <p className="text-white/60">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <button onClick={handleCreate} className="inline-flex items-center gap-2 bg-gradient-to-r from-rose-600 to-pink-500 text-white font-bold px-10 py-4 rounded-full text-lg transition-all hover:scale-105 active:scale-95 shadow-xl shadow-rose-500/20">
              🌹 Crear Mi Bachata
            </button>
          </div>
        </div>
      </section>

      {/* ==================== 6. TESTIMONIALS ==================== */}
      <section className="py-16 px-6 bg-[#0f0a0c]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-rose-400 uppercase tracking-[0.3em] text-xs font-bold">⭐ Testimonios</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">Lo Que Dicen Nuestros Clientes</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <div key={i} className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 hover:border-rose-500/30 transition-all">
                <StarRating rating={t.rating} />
                <p className="text-white/90 mt-4 mb-6 italic leading-relaxed">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center">
                    <span className="text-rose-400 font-bold">{t.name[0]}</span>
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

      {/* ==================== 7. PRICING ==================== */}
      <section className="py-16 px-6 bg-[#0a0708]">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <span className="text-rose-400 uppercase tracking-[0.3em] text-xs font-bold">💰 Precio</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">El Regalo Más Romántico</h2>
          </div>
          <div className="bg-white/[0.03] border-2 border-rose-500/50 rounded-3xl p-8 text-center relative overflow-hidden">
            <div className="absolute top-4 -right-8 bg-rose-500 text-white text-xs font-black px-10 py-1 rotate-45">🌹 62% OFF</div>
            <div className="text-5xl mb-3">🌹</div>
            <div className="mb-6">
              <span className="text-white/40 line-through text-2xl">$79.99</span>
              <div className="text-white text-5xl font-black">$29.99</div>
              <span className="text-rose-400 text-sm font-semibold">Precio por tiempo limitado • Ahorra $50</span>
            </div>
            <div className="space-y-3 text-left mb-8">
              {['Bachata completa (~2 minutos)','2 versiones únicas para elegir','Descarga MP3 de alta calidad','Letra 100% personalizada','Carátula de álbum única','Estilo que tú elijas'].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-white/80">
                  <span className="material-symbols-outlined text-rose-400">check_circle</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <button onClick={handleCreate} className="w-full inline-flex items-center justify-center gap-2 rounded-full h-14 bg-gradient-to-r from-rose-600 to-pink-500 text-white text-lg font-bold shadow-xl transition-all hover:scale-105 active:scale-95">
              🌹 Crear Mi Bachata
            </button>
            <p className="mt-4 text-white/50 text-sm flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-sm">lock</span>
              Preview GRATIS antes de pagar
            </p>
          </div>
          <div className="mt-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 text-center">
            <p className="text-rose-300 text-sm font-bold">🎁 ¿Quieres 2 canciones? Llévate ambas por $39.99 y ahorra $20</p>
          </div>
        </div>
      </section>

      {/* ==================== 8. FAQ ==================== */}
      <section className="py-16 px-6 bg-[#0f0a0c]">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-rose-400 uppercase tracking-[0.3em] text-xs font-bold">❓ Preguntas Frecuentes</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">¿Tienes Dudas?</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <FAQItem key={i} question={faq.question} answer={faq.answer} isOpen={openFAQ === i} onClick={() => setOpenFAQ(openFAQ === i ? null : i)} />
            ))}
          </div>
        </div>
      </section>

      {/* ==================== 9. FINAL CTA ==================== */}
      <section className="py-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0">
          <PhotoFrame src="/images/bachata/hero.jpg" alt="" className="w-full h-full"
            gradient="linear-gradient(135deg, #1a0410 0%, #4c0519 50%, #7c2d12 100%)" />
        </div>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,7,8,0.72) 0%, rgba(10,7,8,0.88) 100%)' }} />
        <div className="max-w-xl mx-auto text-center relative z-10">
          <div className="text-5xl mb-4">🌹</div>
          <h2 className="text-white text-3xl md:text-4xl font-black mb-4">Regala Una Bachata Inolvidable</h2>
          <p className="text-white/70 text-lg mb-8">Una canción de amor que llevará su nombre para siempre. Para aniversarios, San Valentín, o simplemente porque lo tuyo merece una canción.</p>
          <button onClick={handleCreate} className="group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-12 bg-gradient-to-r from-rose-600 to-pink-500 text-white text-xl font-bold shadow-2xl shadow-rose-500/30 transition-all hover:scale-105 active:scale-95">
            <span className="relative z-10">🌹 Crear Mi Bachata — $29.99</span>
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </button>
          <p className="mt-6 text-rose-300 font-semibold flex items-center justify-center gap-2">⚡ Lista en ~3 minutos · +500 bachatas creadas</p>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="py-8 px-6 bg-[#0a0708] border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="font-display text-white/30 text-lg">RegalosQueCantan</div>
          <div className="flex gap-6">
            <a className="text-white/30 hover:text-rose-400 transition-colors text-sm" href="/politica-de-privacidad">Privacidad</a>
            <a className="text-white/30 hover:text-rose-400 transition-colors text-sm" href="/terminos-de-servicio">Términos</a>
            <a className="text-white/30 hover:text-rose-400 transition-colors text-sm" href="#">Contacto</a>
          </div>
          <p className="text-white/20 text-sm">© 2026 RegalosQueCantan</p>
        </div>
      </footer>
    </div>
  );
}
