import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';
import SocialProofToast from '../components/SocialProofToast';

// Polaroid grid images — alternating album art + real customer reactions
const polaroidCards = [
  { src: '/images/album-art/corrido.jpg', alt: 'Corrido album artwork', rotate: 'rotate-[3deg]', offset: '' },
  { src: '/images/reactions/reaction1.jpg', alt: 'Customer reaction', rotate: '-rotate-[6deg]', offset: 'translate-y-8' },
  { src: '/images/album-art/bachata.jpg', alt: 'Bachata album artwork', rotate: 'rotate-[12deg]', offset: '', hasPlay: true },
  { src: '/images/reactions/reaction4.jpg', alt: 'Customer reaction', rotate: '-rotate-[2deg]', offset: '-translate-y-4' },
  { src: '/images/album-art/cumbia.jpg', alt: 'Cumbia album artwork', rotate: 'rotate-[6deg]', offset: 'translate-y-12' },
  { src: '/images/reactions/reaction6.jpg', alt: 'Customer reaction', rotate: '-rotate-[8deg]', offset: 'translate-x-4' },
];

// Testimonial video component with play/pause
function TestimonialVideo({ src, poster }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
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
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
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
  const { navigateTo } = useContext(AppContext);

  useEffect(() => {
    trackStep('landing');
  }, []);

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-landing-bg text-white antialiased overflow-x-hidden">
      {/* Social Proof Toast */}
      <SocialProofToast />

      {/* ─── Fixed Top Navbar ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b border-white/10 bg-landing-bg/80 backdrop-blur-md px-6 py-4 lg:px-20">
        <div className="flex items-center gap-2 text-landing-primary">
          <span className="material-symbols-outlined text-3xl">library_music</span>
          <h2 className="text-white text-xl font-extrabold tracking-tight">RegalosQueCantan</h2>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigateTo('genre')}
            className="bg-landing-primary hover:bg-landing-primary/90 text-white text-sm font-bold px-6 py-2.5 rounded-lg transition-all shadow-lg shadow-landing-primary/25"
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
                      <span className="material-symbols-outlined text-landing-primary text-6xl drop-shadow-lg">play_circle</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Layer 2: Gradient Overlay — stronger on mobile for readability */}
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-landing-bg via-landing-bg/90 to-landing-bg/60 md:via-landing-bg/80 md:to-landing-bg/40" />

        {/* Layer 3: Content */}
        <div className="relative z-20 flex flex-col items-center justify-center text-center px-6 max-w-4xl mx-auto">

          {/* Main Heading */}
          <h1 className="text-white text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight tracking-tight mb-6">
            Dale Algo Que <br />
            <span className="text-landing-primary">Nunca Va a Olvidar</span>
          </h1>

          {/* Subheading */}
          <p className="text-slate-300 text-lg md:text-xl font-normal leading-relaxed max-w-2xl mb-10">
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
            <div className="inline-flex items-center gap-2 bg-green-500/15 border border-green-500/30 rounded-full px-4 py-1.5 text-xs text-green-400 font-bold">
              ⚡ Lista en ~3 minutos · Entrega instantánea
            </div>
            <p className="text-landing-primary text-sm font-semibold flex items-center gap-2 bg-landing-primary/10 px-4 py-1.5 rounded-full border border-landing-primary/20">
              <span>✨</span>
              Desde <span className="line-through text-white/40 mx-1">$49.99</span> <span className="font-bold">$24.99</span> · Preview gratis
              <span>✨</span>
            </p>
          </div>

          {/* Trust Badges */}
          <div className="mt-16 flex flex-col sm:flex-row flex-wrap justify-center gap-8 opacity-60">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-landing-primary">verified_user</span>
              <span className="text-sm font-medium">Pago Seguro</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-landing-primary">speed</span>
              <span className="text-sm font-medium">Entrega en ~3 min</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-landing-primary">star</span>
              <span className="text-sm font-medium">+5000 Clientes Felices</span>
            </div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-landing-bg to-transparent z-20" />
      </main>

      {/* ─── Testimonial Videos Section ─── */}
      <section className="relative z-30 bg-landing-bg py-16 px-6 lg:px-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-landing-primary text-sm font-bold uppercase tracking-widest">Reacciones Reales</span>
            <h2 className="text-white text-3xl md:text-4xl font-extrabold mt-3">
              Mira lo que pasa cuando <span className="text-landing-primary">escuchan su canción</span>
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-4 md:gap-8 max-w-3xl mx-auto">
            <TestimonialVideo src="/videos/testimonial1.mp4" />
            <TestimonialVideo src="/videos/testimonial2.mp4" />
            <TestimonialVideo src="/videos/testimonial3.mp4" />
          </div>

          <p className="text-center text-slate-500 text-xs mt-6">Videos reales de clientes</p>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="relative z-30 bg-landing-bg border-t border-white/5 py-8 px-6 lg:px-20 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-slate-500 text-sm">© 2026 RegalosQueCantan · Hecho con ❤️</p>
        <div className="flex gap-6">
          <a className="text-slate-500 hover:text-landing-primary transition-colors text-xs" href="mailto:hola@regalosquecantan.com">Contacto</a>
        </div>
      </footer>
    </div>
  );
}
