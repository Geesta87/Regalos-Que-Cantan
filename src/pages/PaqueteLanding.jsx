import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../App';
import SocialProofToast from '../components/SocialProofToast';
import { trackStep } from '../services/tracking';
import genres from '../config/genres';

// ============================================
// PAQUETE — bundle landing: personalized song ($29.99) + optional Pixar-style
// animated video (+$29). The page the bundle ad points to.
//
// Flow (mirrors BachataLanding so there is NO redundant genre re-selection):
//   tap a genre -> pick its sub-style in a panel -> jump straight to 'occasion'.
// Song-only vs Song+Video is a page-level toggle; the choice sets
// formData.wantsAnimadoVideo which the downstream funnel/upsell reads.
//
// Hero video slot: /videos/paquete-ad.mp4   Genre imagery: /images/paquete/*.png
// ============================================

const featuredGenres = [
  { id: 'corrido', name: 'Corrido', img: '/images/paquete/corrido.png' },
  { id: 'banda', name: 'Banda', img: '/images/paquete/banda.png' },
  { id: 'mariachi', name: 'Mariachi', img: '/images/paquete/mariachi.png' },
  { id: 'bachata', name: 'Bachata', img: '/images/paquete/bachata.png' },
  { id: 'balada', name: 'Balada Romántica', img: '/images/paquete/balada.png' },
];

// Sub-styles pulled straight from the genre config so they match the funnel exactly.
const subStylesFor = (genreId) =>
  Object.entries(genres[genreId]?.subGenres || {}).map(([id, s]) => ({ id, name: s.name, desc: s.description }));

const SONG_PRICE = 29.99;
const VIDEO_PRICE = 29;

// Real Animado video samples (60s cuts). Neutral labels — no customer names shown.
const V = 'v=2'; // bump when re-cutting samples (same filenames) so browsers fetch fresh
const animadoSamples = [
  { src: `/videos/animado-sample-1.mp4?${V}`, poster: `/images/paquete/animado-poster-1.jpg?${V}`, label: 'En familia' },
  { src: `/videos/animado-sample-2.mp4?${V}`, poster: `/images/paquete/animado-poster-2.jpg?${V}`, label: 'Un recién nacido' },
  { src: `/videos/animado-sample-3.mp4?${V}`, poster: `/images/paquete/animado-poster-3.jpg?${V}`, label: 'Estilo rancho' },
  { src: `/videos/animado-sample-4.mp4?${V}`, poster: `/images/paquete/animado-poster-4.jpg?${V}`, label: 'Para tu pareja' },
  { src: `/videos/animado-sample-5.mp4?${V}`, poster: `/images/paquete/animado-poster-5.jpg?${V}`, label: 'Un momento feliz' },
  { src: `/videos/animado-sample-6.mp4?${V}`, poster: `/images/paquete/animado-poster-6.jpg?${V}`, label: 'Para mamá' },
  { src: `/videos/animado-sample-7.mp4?${V}`, poster: `/images/paquete/animado-poster-7.jpg?${V}`, label: 'Padre e hija' },
  { src: `/videos/animado-sample-8.mp4?${V}`, poster: `/images/paquete/animado-poster-8.jpg?${V}`, label: 'Una graduación' },
];

const testimonials = [
  { text: 'Le regalé la canción con el video animado a mi mamá y no paraba de llorar. Verse a ella en la caricatura fue demasiado.', name: 'Guadalupe R.', location: 'Los Ángeles, CA', rating: 5 },
  { text: 'El corrido salió idéntico a lo que quería y el video animado quedó como de película. El mejor regalo que he dado.', name: 'Miguel A.', location: 'Houston, TX', rating: 5 },
  { text: 'Pedí una bachata con su video para mi esposa. La puso en la tele en la fiesta y todos quedaron sorprendidos.', name: 'Anthony P.', location: 'Nueva York, NY', rating: 5 },
];

const faqs = [
  { question: '¿Puedo llevar solo la canción?', answer: '¡Claro! Puedes llevar solo la canción por $29.99. El video animado es completamente opcional — lo agregas por $29 más solo si lo quieres.' },
  { question: '¿En qué estilos puedo pedir la canción?', answer: 'En el que quieras: corrido, banda, mariachi, bachata, balada romántica y muchos más. Tú eliges el género y el estilo, y nosotros lo hacemos sonar profesional.' },
  { question: '¿Cómo se hace el video animado?', answer: 'Subes unas fotos y las convertimos en una animación estilo Pixar que acompaña la canción. Un recuerdo único que van a querer compartir.' },
  { question: '¿Puedo escuchar antes de pagar?', answer: '¡Sí! Recibes un preview gratis de la canción. Solo pagas si te encanta.' },
  { question: '¿Cuánto tarda?', answer: 'La canción está lista en ~3 minutos. El video animado toma un poco más y te lo entregamos digital apenas está listo.' },
];

function StarRating({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <span key={i} className={`text-lg ${i < rating ? 'text-amber-400' : 'text-white/20'}`}>★</span>
      ))}
    </div>
  );
}

// Autoplay muted + loop (browser policy), tap to unmute. Reused for hero ad + sample.
function AutoVideo({ src, maxW = 'max-w-[300px]' }) {
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
    <div className={`relative mx-auto ${maxW} rounded-[28px] overflow-hidden border border-amber-400/30 shadow-2xl shadow-black/50 bg-black`}>
      <video ref={ref} src={src} autoPlay muted loop playsInline preload="metadata" className="w-full h-auto block" />
      <button
        onClick={toggle}
        aria-label={muted ? 'Activar sonido' : 'Silenciar'}
        className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/65 backdrop-blur border border-white/20 text-white text-xs font-bold pl-2.5 pr-3 py-2 hover:bg-black/85 transition-all active:scale-95"
      >
        <span className="material-symbols-outlined text-lg">{muted ? 'volume_off' : 'volume_up'}</span>
        {muted && <span>Toca para escuchar</span>}
      </button>
    </div>
  );
}

// Gallery tile — shows a poster; only fetches/plays the video on tap (keeps page light).
function GalleryVideo({ src, poster, label }) {
  const [play, setPlay] = useState(false);
  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black aspect-[9/16]">
      {/* Real-client ribbon — always on top of poster + video */}
      <span className="absolute top-2 left-2 z-20 inline-flex items-center gap-1 bg-amber-500 text-black text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full shadow-lg pointer-events-none">
        <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
        Cliente Real
      </span>
      {play ? (
        <video src={src} autoPlay controls playsInline className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <button onClick={() => setPlay(true)} className="group absolute inset-0 w-full h-full" aria-label={`Reproducir ${label}`}>
          <img src={poster} alt={label} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/25 group-hover:bg-black/10 transition-colors" />
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
          </span>
          <div className="absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/75 to-transparent text-left">
            <span className="text-white text-xs font-bold drop-shadow">{label}</span>
          </div>
        </button>
      )}
    </div>
  );
}

function FAQItem({ question, answer, isOpen, onClick }) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button onClick={onClick} className="w-full p-5 flex items-center justify-between text-left bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
        <span className="font-semibold text-white pr-4">{question}</span>
        <span className={`material-symbols-outlined text-amber-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>expand_more</span>
      </button>
      {isOpen && <div className="px-5 pb-5 text-white/70">{answer}</div>}
    </div>
  );
}

export default function PaqueteLanding() {
  const { navigateTo, setFormData } = useContext(AppContext);
  const [openFAQ, setOpenFAQ] = useState(null);
  const [withVideo, setWithVideo] = useState(true);   // song+video by default; song-only is one tap
  const [modalGenre, setModalGenre] = useState(null); // which genre's sub-styles are open

  useEffect(() => {
    window.scrollTo(0, 0);
    trackStep('landing_paquete');
  }, []);

  const total = withVideo ? SONG_PRICE + VIDEO_PRICE : SONG_PRICE;
  const priceLabel = `$${total.toFixed(2).replace('.00', '')}`;

  // Commit the genre + sub-style + video choice into the funnel, then jump past
  // the genre picker straight to 'occasion' (no redundant re-selection).
  const enterFunnel = (genreId, genreName, sub) => {
    setFormData(prev => ({
      ...prev,
      genre: genreId,
      genreName,
      subGenre: sub ? sub.id : '',
      subGenreName: sub ? sub.name : '',
      artistInspiration: '',
      customStyle: '',
      subGenrePrompt: '',
      genreStyle: '',
      wantsAnimadoVideo: withVideo,
      fromPaquete: true, // routes to the dedicated /paquete/checkout page after generation
    }));
    applyVideoPreselect();
    trackStep('paquete_start', { with_video: withVideo, value: withVideo ? SONG_PRICE + VIDEO_PRICE : SONG_PRICE, genre: genreId });
    setModalGenre(null);
    navigateTo('occasion');
  };

  // Pre-tick the Animado video add-on on the checkout page when the buyer chose
  // "Canción + Video". ComparisonPage reads rqc_preselect_extra and pre-selects
  // the 'animado' tile, which rides the single bundled Stripe checkout ($29 line item).
  const applyVideoPreselect = () => {
    try {
      if (withVideo) sessionStorage.setItem('rqc_bundle_video', '1');
      else sessionStorage.removeItem('rqc_bundle_video');
    } catch { /* sessionStorage unavailable — ignore */ }
  };

  // "Otro género" → full genre catalog (regular funnel), carrying the video choice.
  const startCreate = () => {
    setFormData(prev => ({ ...prev, wantsAnimadoVideo: withVideo, fromPaquete: true }));
    applyVideoPreselect();
    trackStep('paquete_start', { with_video: withVideo, value: withVideo ? SONG_PRICE + VIDEO_PRICE : SONG_PRICE, genre: 'other' });
    navigateTo('genre');
  };

  // Primary CTAs scroll down to the on-page genre picker (featured genres + "Otro género").
  const genresRef = useRef(null);
  const goToGenres = () => genresRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const modalSubs = modalGenre ? subStylesFor(modalGenre.id) : [];

  return (
    <div className="min-h-screen bg-[#0a0806] flex flex-col">
      <style>{`
        @keyframes btnGlowGold {
          0%, 100% { box-shadow: 0 0 20px rgba(245,158,11,0.4), 0 0 40px rgba(245,158,11,0.2); }
          50% { box-shadow: 0 0 30px rgba(245,158,11,0.6), 0 0 60px rgba(245,158,11,0.3), 0 0 80px rgba(251,191,36,0.15); }
        }
      `}</style>
      <SocialProofToast />

      {/* ==================== HEADER ==================== */}
      <header className="bg-[#0a0806]/80 backdrop-blur-md py-4 px-6 md:px-12 border-b border-white/5 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="cursor-pointer" onClick={() => navigateTo('landing')}>
            <h2 className="font-display text-white text-xl md:text-2xl font-medium tracking-tight">RegalosQueCantan</h2>
          </div>
          <button onClick={goToGenres} className="bg-amber-500 hover:bg-amber-400 text-black px-5 py-2 rounded-full text-sm font-black transition-all">
            Crear Mi Regalo
          </button>
        </div>
      </header>

      {/* ==================== HERO ==================== */}
      <section className="relative overflow-hidden pt-12 pb-14 px-6">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 60% at 50% 30%, rgba(245,158,11,0.14) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <span className="inline-flex items-center gap-2 bg-white/10 backdrop-blur border border-white/15 text-amber-200 rounded-full px-4 py-1.5 text-xs font-bold tracking-wide mb-6">
            🎁 EL REGALO PERFECTO
          </span>
          <h1 className="text-white text-4xl md:text-6xl font-black leading-tight tracking-tighter font-display mb-5" style={{ textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
            Una Canción Con Su Nombre<br />
            <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-300">
              y un Video Animado
            </span>
          </h1>
          <p className="text-white/75 text-lg md:text-xl font-light leading-relaxed max-w-2xl mx-auto mb-8">
            Una canción personalizada en el estilo que quieras — corrido, banda, mariachi, bachata o balada.
            Súmale un video animado estilo Pixar… o llévate solo la canción. Tú eliges.
          </p>

          <AutoVideo src="/videos/paquete-ad.mp4" />

          <div className="mt-8">
            <button
              onClick={goToGenres}
              className="group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-10 bg-amber-500 text-black text-lg font-black shadow-2xl transition-all hover:scale-105 active:scale-95"
              style={{ animation: 'btnGlowGold 2s ease-in-out infinite' }}
            >
              <span className="relative z-10">🎁 Crear Mi Regalo — {priceLabel}</span>
            </button>
            <p className="mt-4 text-white/50 text-sm">✓ Preview gratis antes de pagar</p>
          </div>
        </div>
      </section>

      {/* ==================== CHOOSE: SONG ONLY vs SONG + VIDEO ==================== */}
      <section className="py-14 px-6 bg-[#0f0b08]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <span className="text-amber-400 uppercase tracking-[0.3em] text-xs font-bold">🎛️ Arma Tu Regalo</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">Elige Tu Opción</h2>
            <p className="text-white/50 text-base mt-2">¿Solo la canción, o la canción con su video animado?</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Song only */}
            <button
              onClick={() => setWithVideo(false)}
              className={`text-left rounded-3xl border-2 p-8 transition-all relative ${!withVideo ? 'border-amber-400 bg-amber-500/[0.08] ring-2 ring-amber-400/30' : 'border-white/10 bg-white/[0.03] hover:border-amber-500/40'}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-4xl">🎵</div>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${!withVideo ? 'bg-amber-400' : 'border-2 border-white/20'}`}>
                  {!withVideo && <span className="text-black text-sm font-black">✓</span>}
                </div>
              </div>
              <h3 className="text-white text-2xl font-black mt-3">Solo La Canción</h3>
              <p className="text-amber-400 font-black text-xl mt-1">$29.99</p>
              <p className="text-white/60 mt-3 text-sm">Canción profesional con su nombre y su historia, en el estilo que elijas. 2 versiones, lista en ~3 min.</p>
            </button>
            {/* Song + video */}
            <button
              onClick={() => setWithVideo(true)}
              className={`text-left rounded-3xl border-2 p-8 transition-all relative overflow-hidden ${withVideo ? 'border-amber-400 bg-amber-500/[0.10] ring-2 ring-amber-400/30' : 'border-white/10 bg-white/[0.03] hover:border-amber-500/40'}`}
            >
              <div className="absolute top-4 -right-9 bg-amber-500 text-black text-[11px] font-black px-10 py-1 rotate-45">POPULAR</div>
              <div className="flex items-center justify-between">
                <div className="text-4xl">🎵🎬</div>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${withVideo ? 'bg-amber-400' : 'border-2 border-white/20'}`}>
                  {withVideo && <span className="text-black text-sm font-black">✓</span>}
                </div>
              </div>
              <h3 className="text-white text-2xl font-black mt-3">Canción + Video Animado</h3>
              <p className="text-amber-400 font-black text-xl mt-1">$58.99 <span className="text-white/40 text-sm font-semibold">($29.99 + $29)</span></p>
              <p className="text-white/60 mt-3 text-sm">Todo lo de la canción, más un video animado estilo Pixar que cuenta <span className="text-white/90 font-semibold">su historia</span> — usando el contexto de la canción y sus fotos. El regalo completo.</p>
            </button>
          </div>
          <div className="text-center mt-8">
            <button onClick={goToGenres} className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-black px-10 py-4 rounded-full text-lg transition-all hover:scale-105 active:scale-95 shadow-lg">
              🎁 Continuar — {priceLabel}
            </button>
            <p className="mt-3 text-white/40 text-sm">Preview gratis · Solo pagas si te encanta</p>
          </div>
        </div>
      </section>

      {/* ==================== ANIMADO SAMPLE + STORY-IN-VIDEO ==================== */}
      <section className="py-14 px-6 bg-[#0a0806]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <span className="text-amber-400 uppercase tracking-[0.3em] text-xs font-bold">🎬 El Video Animado</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">Su Historia Cobra Vida</h2>
            <p className="text-white/60 mt-3 max-w-2xl mx-auto">
              No es un video genérico. Tomamos <span className="text-white/90 font-semibold">la historia y el contexto de tu canción</span> — su nombre, su momento, su relación —
              y lo convertimos en una animación estilo Pixar hecha solo para ellos.
            </p>
          </div>
          {/* 3 story points */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
            {[
              { icon: 'auto_stories', t: 'Basado en tu canción', d: 'La animación sigue la historia y la letra que creamos.' },
              { icon: 'photo_camera', t: 'Hecho con sus fotos', d: 'Convertimos sus fotos en personajes estilo Pixar.' },
              { icon: 'favorite', t: 'Un recuerdo para siempre', d: 'Un video único para ver y compartir una y otra vez.' },
            ].map((f) => (
              <div key={f.t} className="flex gap-4 bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                <div className="w-12 h-12 shrink-0 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                  <span className="material-symbols-outlined text-amber-400">{f.icon}</span>
                </div>
                <div>
                  <h3 className="text-white font-bold">{f.t}</h3>
                  <p className="text-white/60 text-sm">{f.d}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Real sample gallery */}
          <div className="text-center mb-6">
            <h3 className="text-white text-xl font-black">Ejemplos Reales</h3>
            <p className="text-white/50 text-sm">Toca para reproducir · muestras de 1 minuto</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {animadoSamples.map((s) => (
              <GalleryVideo key={s.src} src={s.src} poster={s.poster} label={s.label} />
            ))}
          </div>

          <div className="text-center mt-10">
            <button onClick={() => { setWithVideo(true); goToGenres(); }} className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-black px-10 py-4 rounded-full text-lg transition-all hover:scale-105 active:scale-95 shadow-lg">
              🎬 Quiero Mi Canción + Video
            </button>
            <p className="text-white/30 text-xs mt-4">* Muestras reales de videos animados, recortadas a 1 minuto.</p>
          </div>
        </div>
      </section>

      {/* ==================== GENRES (tap → sub-styles popup) ==================== */}
      <section ref={genresRef} className="py-14 px-6 bg-[#0a0806] scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <span className="text-amber-400 uppercase tracking-[0.3em] text-xs font-bold">🎸 El Estilo Que Quieras</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">Elige El Género</h2>
            <p className="text-white/60 mt-2">Toca un estilo — eliges tu sabor y seguimos</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {featuredGenres.map((g) => (
              <button key={g.id} onClick={() => setModalGenre(g)} className="group relative rounded-2xl overflow-hidden border border-white/10 aspect-[3/4] hover:border-amber-400/60 transition-all hover:scale-[1.03]">
                <img src={g.img} alt={g.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-3 text-center">
                  <span className="text-white font-black text-sm md:text-base drop-shadow">{g.name}</span>
                </div>
              </button>
            ))}
            {/* Otro género — opens the full catalog from the regular funnel */}
            <button onClick={startCreate} className="group relative rounded-2xl overflow-hidden border-2 border-dashed border-amber-400/40 bg-amber-500/[0.04] aspect-[3/4] hover:border-amber-400 hover:bg-amber-500/[0.08] transition-all flex flex-col items-center justify-center gap-2 text-center p-3">
              <span className="material-symbols-outlined text-amber-400 text-4xl">library_music</span>
              <span className="text-white font-black text-sm md:text-base">Otro género</span>
              <span className="text-white/50 text-xs leading-tight">Ver todos los estilos</span>
            </button>
          </div>
        </div>
      </section>

      {/* ==================== HOW IT WORKS ==================== */}
      <section className="py-14 px-6 bg-[#0f0b08]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-amber-400 uppercase tracking-[0.3em] text-xs font-bold">📝 Cómo Funciona</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">3 Pasos Simples</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: '🎸', step: '1', title: 'Elige El Estilo', desc: 'Corrido, banda, mariachi, bachata, balada… el género que más le guste.' },
              { icon: '💌', step: '2', title: 'Cuéntanos Su Historia', desc: 'Su nombre, la ocasión y los detalles. Si quieres el video, subes sus fotos.' },
              { icon: '🎁', step: '3', title: 'Recibe Su Regalo', desc: 'La canción en ~3 minutos y el video animado listo para sorprender.' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center text-4xl">{item.icon}</div>
                <div className="text-amber-400 font-bold text-sm mb-2">PASO {item.step}</div>
                <h3 className="text-white text-xl font-bold mb-2">{item.title}</h3>
                <p className="text-white/60">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== TESTIMONIALS ==================== */}
      <section className="py-14 px-6 bg-[#0a0806]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-amber-400 uppercase tracking-[0.3em] text-xs font-bold">⭐ Testimonios</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">Lo Que Dicen Nuestros Clientes</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <div key={i} className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 hover:border-amber-500/30 transition-all">
                <StarRating rating={t.rating} />
                <p className="text-white/90 mt-4 mb-6 italic leading-relaxed">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <span className="text-amber-400 font-bold">{t.name[0]}</span>
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

      {/* ==================== FAQ ==================== */}
      <section className="py-14 px-6 bg-[#0f0b08]">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-amber-400 uppercase tracking-[0.3em] text-xs font-bold">❓ Preguntas Frecuentes</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">¿Tienes Dudas?</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <FAQItem key={i} question={faq.question} answer={faq.answer} isOpen={openFAQ === i} onClick={() => setOpenFAQ(openFAQ === i ? null : i)} />
            ))}
          </div>
        </div>
      </section>

      {/* ==================== FINAL CTA ==================== */}
      <section className="py-20 px-6 relative overflow-hidden bg-[#0a0806]">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(245,158,11,0.12) 0%, transparent 70%)' }} />
        <div className="max-w-xl mx-auto text-center relative z-10">
          <div className="text-5xl mb-4">🎁</div>
          <h2 className="text-white text-3xl md:text-4xl font-black mb-4">El Regalo Que Nunca Van A Olvidar</h2>
          <p className="text-white/70 text-lg mb-8">Una canción con su nombre — y, si quieres, un video animado que van a atesorar para siempre.</p>
          <button onClick={goToGenres} className="group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-12 bg-amber-500 text-black text-xl font-black shadow-2xl transition-all hover:scale-105 active:scale-95">
            🎁 Crear Mi Regalo — {priceLabel}
          </button>
          <p className="mt-6 text-amber-300 font-semibold flex items-center justify-center gap-2">⚡ Canción lista en ~3 minutos</p>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="py-8 px-6 bg-[#0a0806] border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="font-display text-white/30 text-lg">RegalosQueCantan</div>
          <div className="flex gap-6">
            <a className="text-white/30 hover:text-amber-400 transition-colors text-sm" href="/politica-de-privacidad">Privacidad</a>
            <a className="text-white/30 hover:text-amber-400 transition-colors text-sm" href="/terminos-de-servicio">Términos</a>
          </div>
          <p className="text-white/20 text-sm">© 2026 RegalosQueCantan</p>
        </div>
      </footer>

      {/* ==================== SUB-STYLE MODAL ==================== */}
      {modalGenre && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setModalGenre(null)}>
          <div className="bg-[#141010] border border-amber-500/20 rounded-3xl p-6 md:p-8 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white text-2xl font-black">Estilo de {modalGenre.name}</h3>
              <button onClick={() => setModalGenre(null)} className="text-white/40 hover:text-white p-1"><span className="material-symbols-outlined">close</span></button>
            </div>
            <p className="text-white/50 text-sm mb-5">
              Elige el sabor · {withVideo ? 'Canción + Video ($58.99)' : 'Solo canción ($29.99)'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {modalSubs.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => enterFunnel(modalGenre.id, modalGenre.name, sub)}
                  className="text-left p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:border-amber-400/60 hover:bg-amber-500/[0.06] transition-all"
                >
                  <div className="text-white font-bold text-sm">{sub.name}</div>
                  {sub.desc && <div className="text-white/40 text-xs mt-1 leading-tight">{sub.desc}</div>}
                </button>
              ))}
            </div>
            <button
              onClick={() => enterFunnel(modalGenre.id, modalGenre.name, null)}
              className="w-full mt-5 rounded-full h-12 bg-amber-500 hover:bg-amber-400 text-black font-black transition-all"
            >
              Continuar con {modalGenre.name} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
