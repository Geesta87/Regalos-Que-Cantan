import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateBreadcrumbData, generateFAQStructuredData } from '../../components/SEOHead';
import { getGenreBySlug } from '../../data/seoData';

/**
 * DiaDeLasMadresLanding - Modern, urgency-driven Mother's Day landing page
 * Minimal copy, countdown timer, video testimonials, strong CTA
 */

function TestimonialVideo({ src }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

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
      className="relative aspect-[9/16] w-full rounded-2xl overflow-hidden bg-black cursor-pointer group shadow-2xl"
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="auto"
        className="w-full h-full object-cover"
        onEnded={() => setPlaying(false)}
      />
      {!playing && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
          <div className="w-16 h-16 bg-pink-500/90 rounded-full flex items-center justify-center shadow-xl shadow-pink-500/30">
            <span className="text-white text-3xl ml-1">&#9654;</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CountdownTimer() {
  const [timeLeft, setTimeLeft] = useState({});

  useEffect(() => {
    const targetDate = new Date('2026-05-10T00:00:00-06:00'); // May 10, Mexico time
    const update = () => {
      const now = new Date();
      const diff = targetDate - now;
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, mins: 0, secs: 0 });
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        mins: Math.floor((diff / (1000 * 60)) % 60),
        secs: Math.floor((diff / 1000) % 60)
      });
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const units = [
    { val: timeLeft.days, label: 'DIAS' },
    { val: timeLeft.hours, label: 'HRS' },
    { val: timeLeft.mins, label: 'MIN' },
    { val: timeLeft.secs, label: 'SEG' }
  ];

  return (
    <div className="flex items-center gap-2 justify-center">
      {units.map((u, i) => (
        <React.Fragment key={u.label}>
          <div className="flex flex-col items-center">
            <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2 min-w-[52px] text-center">
              <span className="text-2xl md:text-3xl font-black text-white tabular-nums">{String(u.val ?? 0).padStart(2, '0')}</span>
            </div>
            <span className="text-[10px] text-white/40 font-bold mt-1 tracking-wider">{u.label}</span>
          </div>
          {i < 3 && <span className="text-white/20 font-bold text-xl mt-[-16px]">:</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function DiaDeLasMadresLanding() {
  const { navigateTo, setFormData } = useContext(AppContext);

  const handleCreateSong = () => {
    setFormData(prev => ({
      ...prev,
      occasion: 'dia-de-las-madres',
      occasionName: 'Dia de las Madres'
    }));
    navigateTo('genre');
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Dia de las Madres', path: '/dia-de-las-madres' }
  ];

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Cancion Personalizada para el Dia de las Madres",
    "description": "Cancion personalizada para mama con su nombre en mariachi, bolero, ranchera y mas generos latinos.",
    "brand": { "@type": "Brand", "name": "RegalosQueCantan" },
    "offers": {
      "@type": "Offer",
      "price": "29.99",
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.9",
      "reviewCount": 312
    }
  };

  const faqs = [
    { question: 'Puedo crear la cancion el mismo 10 de Mayo?', answer: 'Si, tu cancion estara lista en 2-4 minutos. Puedes crearla el mismo dia y enviarla por WhatsApp al instante.' },
    { question: 'Que genero es mejor para mama?', answer: 'Depende de sus gustos. Mariachi y ranchera son los mas populares para mamas tradicionales. Bolero para las romanticas. Cumbia para las fiesteras.' },
    { question: 'Cuanto cuesta la cancion para mama?', answer: 'Una cancion individual cuesta $29.99 USD. Pago unico. Recibes 2 versiones para elegir tu favorita.' },
  ];

  const structuredData = [
    productSchema,
    generateBreadcrumbData(breadcrumbs),
    generateFAQStructuredData(faqs)
  ].filter(Boolean);

  return (
    <>
      <SEOHead
        title="Cancion para Mama | Dia de las Madres 2026 | RegalosQueCantan"
        description="Sorprende a mama con una cancion personalizada este Dia de las Madres. Con su nombre, en mariachi, bolero o ranchera. Lista en minutos desde $29.99."
        canonical="/dia-de-las-madres"
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-[#0a0a0a] text-white overflow-x-hidden">

        {/* ─── URGENCY BAR ─── */}
        <div className="bg-gradient-to-r from-pink-600 via-rose-500 to-pink-600 text-white text-center py-2.5 px-4 font-bold text-sm sticky top-0 z-50">
          <span className="animate-pulse inline-block mr-1">&#10071;</span>
          El 10 de Mayo se acerca — No te quedes sin el regalo perfecto para mama
          <span className="animate-pulse inline-block ml-1">&#10071;</span>
        </div>

        {/* ─── HERO SECTION ─── */}
        <section className="relative px-6 pt-16 pb-20 md:pt-24 md:pb-28 overflow-hidden">
          {/* Background glow */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-pink-500/10 rounded-full blur-[120px]"></div>
          </div>

          {/* Scattered reaction photos behind hero */}
          <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden opacity-30 md:opacity-40">
            {[
              { src: '/images/reactions/reaction9.jpg', style: 'top-[5%] left-[-2%] md:left-[3%] w-32 md:w-44 rotate-[-8deg]' },
              { src: '/images/reactions/reaction2.jpg', style: 'top-[8%] right-[-2%] md:right-[3%] w-28 md:w-40 rotate-[6deg]' },
              { src: '/images/reactions/reaction6.jpg', style: 'bottom-[10%] left-[0%] md:left-[5%] w-28 md:w-40 rotate-[10deg]' },
              { src: '/images/reactions/reaction7.jpg', style: 'bottom-[5%] right-[0%] md:right-[5%] w-32 md:w-44 rotate-[-6deg]' },
            ].map((photo, i) => (
              <div key={i} className={`absolute ${photo.style} rounded-2xl overflow-hidden shadow-2xl`}>
                <img src={photo.src} alt="" className="w-full h-auto object-cover" loading="lazy" />
              </div>
            ))}
          </div>

          <div className="relative z-10 max-w-3xl mx-auto text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-pink-500/10 border border-pink-500/20 rounded-full px-5 py-2 mb-8">
              <span className="text-pink-400 text-sm font-bold">&#127801; Dia de las Madres 2026</span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tight mb-6">
              No le regales{' '}
              <span className="bg-gradient-to-r from-pink-400 via-rose-400 to-pink-300 bg-clip-text text-transparent">
                lo mismo de siempre
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg md:text-xl text-white/50 max-w-xl mx-auto mb-8 leading-relaxed">
              Este 10 de Mayo, regalale algo que nunca ha recibido.
              <br className="hidden md:block" />
              Una cancion con su nombre, unica en el mundo.
            </p>

            {/* Countdown */}
            <div className="mb-10">
              <p className="text-white/30 text-xs font-bold tracking-widest uppercase mb-3">Faltan</p>
              <CountdownTimer />
            </div>

            {/* CTA */}
            <style>{`
              @keyframes ctaGlow {
                0%, 100% { box-shadow: 0 0 20px rgba(236,72,153,0.4), 0 0 60px rgba(236,72,153,0.1); }
                50% { box-shadow: 0 0 30px rgba(236,72,153,0.6), 0 0 80px rgba(236,72,153,0.2); }
              }
            `}</style>
            <button
              onClick={handleCreateSong}
              className="inline-flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white font-extrabold text-lg md:text-xl px-10 py-5 rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
              style={{ animation: 'ctaGlow 2s ease-in-out infinite' }}
            >
              <span className="text-2xl">&#127908;</span>
              Crear la Cancion para Mama
            </button>

            {/* Trust badges */}
            <div className="flex items-center justify-center gap-6 mt-6 text-white/30 text-sm">
              <span>&#9989; Lista en 3 min</span>
              <span>&#9989; Desde $29.99</span>
              <span>&#9989; Preview gratis</span>
            </div>

            {/* Social proof counter */}
            <p className="mt-8 text-white/20 text-sm">
              <span className="text-pink-400 font-bold">2,847+</span> canciones creadas para mama este mes
            </p>
          </div>
        </section>

        {/* ─── VIDEO TESTIMONIALS ─── */}
        <section className="px-6 pb-20">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-black text-white">
                Mira como reaccionan al escuchar su cancion
              </h2>
              <p className="text-white/40 text-sm mt-2">Reacciones reales de nuestros clientes</p>
            </div>

            <div className="grid grid-cols-3 gap-3 md:gap-6 max-w-2xl mx-auto">
              <TestimonialVideo src="/videos/testimonial3.mp4" />
              <TestimonialVideo src="/videos/testimonial1.mp4" />
              <TestimonialVideo src="/videos/testimonial2.mp4" />
            </div>
          </div>
        </section>

        {/* ─── SECOND CTA ─── */}
        <section className="px-6 pb-20">
          <div className="max-w-xl mx-auto text-center">
            <div className="bg-gradient-to-b from-white/[0.04] to-transparent border border-white/10 rounded-3xl p-10">
              <p className="text-white/40 text-sm font-bold tracking-widest uppercase mb-3">Pago unico · Sin suscripcion</p>
              <div className="flex items-center justify-center gap-3 mb-2">
                <span className="text-white/30 line-through text-xl">$59.99</span>
                <span className="text-5xl font-black text-white">$29.99</span>
              </div>
              <p className="text-white/30 text-sm mb-8">2 versiones unicas · Descarga MP3 · Tuya para siempre</p>

              <button
                onClick={handleCreateSong}
                className="w-full inline-flex items-center justify-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white font-extrabold text-lg px-8 py-5 rounded-full transition-all duration-300 hover:scale-[1.02] active:scale-95"
                style={{ animation: 'ctaGlow 2s ease-in-out infinite' }}
              >
                <span className="text-xl">&#127801;</span>
                Sorprender a Mama Ahora
              </button>

              <p className="text-white/20 text-xs mt-4">
                &#128274; Pago seguro · No necesitas cuenta · Listo en minutos
              </p>
            </div>
          </div>
        </section>

        {/* ─── FAQ (minimal) ─── */}
        <section className="px-6 pb-20">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-bold text-center text-white/60 mb-6">Preguntas frecuentes</h2>
            <div className="space-y-4">
              {faqs.map((faq, i) => (
                <details key={i} className="group border border-white/10 rounded-xl overflow-hidden">
                  <summary className="flex items-center justify-between px-5 py-4 cursor-pointer text-white font-semibold text-sm hover:bg-white/[0.03]">
                    {faq.question}
                    <span className="text-white/30 group-open:rotate-45 transition-transform text-xl">+</span>
                  </summary>
                  <div className="px-5 pb-4 text-white/40 text-sm leading-relaxed">
                    {faq.answer}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ─── FOOTER CTA ─── */}
        <section className="px-6 pb-16">
          <div className="max-w-2xl mx-auto text-center">
            <p className="text-white/20 text-sm mb-4">No esperes al ultimo momento</p>
            <button
              onClick={handleCreateSong}
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-pink-500/20 border border-white/10 hover:border-pink-500/30 text-white font-bold px-8 py-4 rounded-full transition-all text-sm"
            >
              &#127908; Crear Cancion para Mama — $29.99
            </button>
          </div>
        </section>

      </div>
    </>
  );
}
