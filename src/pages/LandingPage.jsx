import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';
import SocialProofToast from '../components/SocialProofToast';
import { CenzoMark, CenzoSignature, CenzoHero } from '../components/Cenzo';

// Polaroid grid images — alternating album art + real customer reactions
const polaroidCards = [
  { src: '/images/album-art/corrido.jpg', alt: 'Corrido album artwork', rotate: 'rotate-[3deg]', offset: '' },
  { src: '/images/reactions/reaction2.jpg', alt: 'Customer reaction', rotate: '-rotate-[6deg]', offset: 'translate-y-8' },
  { src: '/images/album-art/bachata.jpg', alt: 'Bachata album artwork', rotate: 'rotate-[12deg]', offset: '', hasPlay: true },
  { src: '/images/reactions/reaction4.jpg', alt: 'Customer reaction', rotate: '-rotate-[2deg]', offset: '-translate-y-4' },
  { src: '/images/album-art/cumbia.jpg', alt: 'Cumbia album artwork', rotate: 'rotate-[6deg]', offset: 'translate-y-12' },
  { src: '/images/reactions/reaction6.jpg', alt: 'Customer reaction', rotate: '-rotate-[8deg]', offset: 'translate-x-4' },
];

// Testimonial video component with play/pause
function TestimonialVideo({ src }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  // Show thumbnail on mobile by seeking to 0.1s once metadata loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const showThumb = () => { video.currentTime = 0.1; };
    video.addEventListener('loadeddata', showThumb);
    return () => video.removeEventListener('loadeddata', showThumb);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.currentTime = 0;
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  return (
    <div
      className="relative aspect-[9/16] w-full rounded-2xl overflow-hidden bg-slate-900 cursor-pointer group shadow-xl"
      onClick={togglePlay}
    >
      {/* preload="none": these are testimonials nobody has asked to watch yet. "auto"
          pulled all three clips in full on every landing view — the single biggest slice
          of Vercel Fast Data Transfer. The poster keeps the card looking right. */}
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="none"
        poster={src.replace('/videos/', '/images/posters/').replace(/\.mp4$/, '.jpg')}
        className="w-full h-full object-cover"
        onEnded={() => setPlaying(false)}
      />
      {/* Play overlay */}
      {!playing && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center transition-opacity">
          <div className="w-16 h-16 bg-landing-primary/90 rounded-full flex items-center justify-center shadow-xl shadow-landing-primary/30">
            <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LandingPage() {
  const { navigateTo, setFormData } = useContext(AppContext);

  useEffect(() => {
    trackStep('landing');
    // A normal (non-/paquete) visitor must never inherit a stale bundle intent from a
    // prior /paquete visit in the same browser. Clear it here so ONLY fresh /paquete
    // "Canción + Video" buyers ever get the $58.99 auto-select. /paquete never routes
    // through this page, so its intent is untouched.
    setFormData((prev) => ((prev?.wantsAnimadoVideo || prev?.fromPaquete) ? { ...prev, wantsAnimadoVideo: false, fromPaquete: false } : prev));
  }, [setFormData]);

  return (
    <div className="night-sky relative flex min-h-screen w-full flex-col text-white antialiased overflow-x-hidden">
      {/* Social Proof Toast */}
      <SocialProofToast />

      {/* ─── Fixed Top Navbar ─── */}
      {/* On a 375px phone the old row wanted 517px, so "Tienda" and the whole
          "Empezar" CTA rendered off-screen. Below `sm` the wordmark gives way to
          Cenzo's mark and the two secondary buttons drop to icons, which keeps
          the CTA on screen. Everything returns at `sm` and up. */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-2 border-b border-white/10 bg-landing-bg/80 backdrop-blur-md px-4 py-3 sm:px-6 sm:py-4 lg:px-20">
        <div className="flex items-center gap-2 text-gold min-w-0">
          <CenzoMark size={40} className="sm:hidden" />
          <CenzoMark size={48} className="hidden sm:block" />
          <h2 className="hidden sm:block text-white text-xl font-extrabold tracking-tight truncate">RegalosQueCantan</h2>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-4 shrink-0">
          <a
            href="https://giftsthatsing.com/?utm_source=rqc&utm_medium=lang_switch&utm_campaign=header"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 md:gap-2 bg-white hover:bg-white/90 text-landing-bg text-sm md:text-base font-extrabold px-2.5 py-2 sm:px-4 sm:py-2.5 md:px-5 md:py-3 rounded-lg transition-all shadow-lg ring-2 ring-white/40 hover:ring-white/70"
            title="English version — Gifts That Sing"
            aria-label="English version"
          >
            <span aria-hidden="true" className="text-base md:text-lg">🇺🇸</span>
            <span className="hidden sm:inline">English</span>
          </a>
          <button
            onClick={() => navigateTo('store')}
            className="inline-flex items-center gap-1.5 bg-white/8 hover:bg-white/15 border border-white/15 hover:border-white/30 text-white text-xs md:text-sm font-semibold px-2.5 py-2 sm:px-3 md:px-4 md:py-2.5 rounded-lg transition-all"
            title="Ver todos los productos y complementos"
            aria-label="Tienda"
          >
            <span aria-hidden="true">🛍️</span>
            <span className="hidden sm:inline">Tienda</span>
          </button>
          <button
            onClick={() => navigateTo('recoverSong')}
            className="hidden md:inline-flex items-center gap-1.5 bg-white/8 hover:bg-white/15 border border-white/15 hover:border-white/30 text-white text-xs md:text-sm font-semibold px-3 py-2 md:px-4 md:py-2.5 rounded-lg transition-all"
            title="Recupera tu canción si ya compraste"
          >
            <span aria-hidden="true">🎵</span>
            <span>Mi canción</span>
          </button>
          <button
            onClick={() => navigateTo('genre')}
            className="bg-landing-primary hover:bg-landing-primary/90 text-sm font-bold px-3.5 py-2 sm:px-5 sm:py-2.5 md:px-6 rounded-lg transition-all shadow-lg shadow-landing-primary/25 whitespace-nowrap"
          >
            Empezar
          </button>
        </div>
      </header>

      {/* ─── Hero Section ─── */}
      <main className="relative flex flex-1 flex-col items-center justify-center pt-24 overflow-hidden">

        {/* Layer 1: Polaroid Mosaic Background */}
        <div className="absolute inset-0 z-0 flex items-center justify-center opacity-30 md:opacity-40 select-none pointer-events-none">
          <div className="polaroid-grid w-[140%] md:w-[120%] lg:w-[100%] max-w-6xl">
            {polaroidCards.map((card, i) => (
              <div
                key={i}
                className={`bg-white p-3 pb-10 rounded-sm polaroid-shadow transform ${card.rotate} ${card.offset}`}
              >
                <div className="aspect-square bg-slate-800 rounded-sm overflow-hidden relative">
                  <img
                    src={card.src}
                    alt={card.alt}
                    className={`w-full h-full object-cover ${card.hasPlay ? 'grayscale opacity-80' : ''}`}
                    loading="lazy"
                  />
                  {card.hasPlay && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="material-symbols-outlined text-gold text-6xl drop-shadow-lg">play_circle</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Layer 2: Gradient Overlay — purely visual, must not capture clicks */}
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-landing-bg via-landing-bg/80 to-landing-bg/40 md:via-landing-bg/65 md:to-landing-bg/25 pointer-events-none" />

        {/* Layer 3: Content */}
        <div className="relative z-20 flex flex-col items-center justify-center text-center px-6 max-w-4xl mx-auto">

          {/* Cenzo — he opens the page, wings out, lit from above */}
          <CenzoHero className="w-64 sm:w-72 md:w-80 lg:w-96 mb-1 md:mb-3" />

          {/* Main Heading */}
          <h1 className="text-white text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight tracking-tight mb-6">
            Dale Algo Que <br />
            <span className="text-gold">Nunca Va a Olvidar</span>
          </h1>

          {/* Subheading */}
          <p className="text-ink-2 text-lg md:text-xl font-normal leading-relaxed max-w-2xl mb-10">
            Una canción personalizada lista en minutos — el regalo más único que puedes dar.
          </p>

          {/* CTA Button */}
          <button
            onClick={() => navigateTo('genre')}
            className="min-w-[200px] bg-landing-primary hover:bg-landing-primary/90 text-white text-lg font-bold px-8 py-4 rounded-xl transition-all shadow-xl shadow-landing-primary/20 flex items-center justify-center gap-2 group"
          >
            🎵 Crear Mi Canción
            <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
          </button>

          {/* Delivery + Pricing Badges */}
          <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
            <div className="inline-flex items-center gap-2 bg-turquesa/15 border border-turquesa/30 rounded-full px-4 py-1.5 text-xs text-turquesa font-bold">
              ⚡ Lista en ~3 minutos · Entrega instantánea
            </div>
            <p className="text-gold text-sm font-semibold flex items-center gap-2 bg-gold/10 px-4 py-1.5 rounded-full border border-gold/20">
              <span>✨</span>
              Desde <span className="line-through text-white/55 mx-1">$59.99</span> <span className="font-bold">$29.99</span> · Preview gratis
              <span>✨</span>
            </p>
          </div>

          {/* Existing customer recovery — visible chip-style CTA */}
          <div className="mt-6">
            <a
              href="/mi-cancion"
              onClick={(e) => { e.preventDefault(); navigateTo('recoverSong'); }}
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 border border-white/20 hover:border-landing-primary/50 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-all shadow-md cursor-pointer"
            >
              <span aria-hidden="true">🎵</span>
              <span>Ya hiciste tu canción —</span>
              <span className="text-turquesa">encuéntrala aquí</span>
              <span aria-hidden="true">→</span>
            </a>
          </div>

          {/* Trust Badges */}
          <div className="mt-16 flex flex-col sm:flex-row flex-wrap justify-center gap-8 opacity-60">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-gold">verified_user</span>
              <span className="text-sm font-medium">Pago Seguro</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-gold">speed</span>
              <span className="text-sm font-medium">Entrega en ~3 min</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-gold">star</span>
              <span className="text-sm font-medium">+5000 Clientes Felices</span>
            </div>
          </div>

          {/* English version handoff — visible chip, prominent but secondary to primary CTA */}
          <a
            href="https://giftsthatsing.com/?utm_source=rqc&utm_medium=hero_subtext&utm_campaign=hero_subtext"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 border-2 border-white/30 hover:border-white text-white text-sm font-bold px-5 py-3 rounded-full transition-all shadow-md"
          >
            <span aria-hidden="true" className="text-lg">🇺🇸</span>
            <span>¿Prefieres tu canción en inglés? Visita Gifts That Sing</span>
            <span aria-hidden="true">→</span>
          </a>
        </div>

        {/* Bottom fade — purely visual, must NOT capture clicks
            (was eating taps on the recovery chip / trust badges on mobile) */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-landing-bg to-transparent z-20 pointer-events-none" />
      </main>

      {/* ─── Testimonial Videos Section ─── */}
      <section className="relative z-30 bg-landing-bg py-16 px-6 lg:px-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-gold text-sm font-bold uppercase tracking-widest">Reacciones Reales</span>
            <h2 className="text-white text-3xl md:text-4xl font-extrabold mt-3">
              Mira lo que pasa cuando <span className="text-gold">escuchan su canción</span>
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-4 md:gap-8 max-w-3xl mx-auto">
            <TestimonialVideo src="/videos/testimonial3.mp4" />
            <TestimonialVideo src="/videos/testimonial1.mp4" />
            <TestimonialVideo src="/videos/testimonial2.mp4" />
          </div>

          <p className="text-center text-ink-3 text-xs mt-6">Videos reales de clientes</p>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="relative z-30 bg-landing-bg border-t border-white/5 py-8 px-6 lg:px-20 flex flex-col md:flex-row justify-between items-center gap-4">
        <CenzoSignature className="justify-center mb-3" />
          <p className="text-ink-3 text-sm">© 2026 RegalosQueCantan · Hecho con ❤️</p>
        <div className="flex flex-wrap items-center justify-center gap-5">
          <a
            className="text-ink-2 hover:text-gold transition-colors text-xs font-semibold inline-flex items-center gap-1"
            href="/mi-cancion"
            onClick={(e) => { e.preventDefault(); navigateTo('recoverSong'); }}
          >
            🎵 Recuperar mi canción
          </a>
          <a className="text-ink-3 hover:text-gold transition-colors text-xs" href="mailto:hola@regalosquecantan.com">Contacto</a>
        </div>
      </footer>
    </div>
  );
}
