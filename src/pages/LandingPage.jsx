import React, { useContext, useEffect } from 'react';
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
        <div className="absolute inset-0 z-0 hidden md:flex items-center justify-center opacity-40 select-none pointer-events-none">
          <div className="polaroid-grid w-[120%] lg:w-[100%] max-w-6xl">
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

        {/* Layer 2: Gradient Overlay */}
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-landing-bg via-landing-bg/80 to-landing-bg/40" />

        {/* Layer 3: Content */}
        <div className="relative z-20 flex flex-col items-center justify-center text-center px-6 max-w-4xl mx-auto">

          {/* Occasions Badge */}
          <div className="inline-flex items-center gap-2 bg-landing-primary/10 border border-landing-primary/20 px-4 py-2 rounded-full text-landing-primary text-xs font-bold uppercase tracking-wider mb-4">
            🎵 Cumpleaños · Aniversarios · Bodas · O simplemente porque sí ✨
          </div>

          {/* Uppercase Label */}
          <span className="text-landing-primary uppercase tracking-[0.3em] text-xs font-bold bg-landing-primary/10 px-4 py-2 rounded-full border border-landing-primary/20 mb-6">
            Canciones Personalizadas
          </span>

          {/* Main Heading */}
          <h1 className="text-white text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight tracking-tight mb-6">
            Dale Algo Que <br />
            <span className="text-landing-primary">Nunca Va a Olvidar</span>
          </h1>

          {/* Subheading */}
          <p className="text-slate-300 text-lg md:text-xl font-normal leading-relaxed max-w-2xl mb-10">
            Una canción personalizada lista en minutos — el regalo más único que puedes dar.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <button
              onClick={() => navigateTo('genre')}
              className="w-full sm:w-auto min-w-[200px] bg-landing-primary hover:bg-landing-primary/90 text-white text-lg font-bold px-8 py-4 rounded-xl transition-all shadow-xl shadow-landing-primary/20 flex items-center justify-center gap-2 group"
            >
              🎵 Crear Mi Canción
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
            </button>
            <button
              onClick={() => navigateTo('genre')}
              className="w-full sm:w-auto min-w-[200px] bg-slate-800/50 hover:bg-slate-800 border border-white/10 text-white text-lg font-bold px-8 py-4 rounded-xl transition-all backdrop-blur-sm flex items-center justify-center gap-2"
            >
              Ver Ejemplos
              <span className="material-symbols-outlined">play_circle</span>
            </button>
          </div>

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
