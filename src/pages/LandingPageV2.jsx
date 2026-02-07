import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../App';
import Header from '../components/Header';
import { trackStep } from '../services/tracking';

// ============================================
// SAMPLE SONGS - Your actual customer samples
// ============================================
const sampleSongs = [
  {
    id: 1,
    title: 'Para Mi Amor',
    genre: 'Romántica',
    emoji: '💕',
    audioUrl: '/samples/sample-romantica-1.mp3',
    imageUrl: null,
    duration: '2:00'
  },
  {
    id: 2,
    title: 'María, Mi Morenita',
    genre: 'Romántica',
    emoji: '💖',
    audioUrl: '/samples/sample-romantica-2.mp3',
    imageUrl: null,
    duration: '1:30'
  },
  {
    id: 3,
    title: 'Mi Regalo Especial',
    genre: 'Balada',
    emoji: '🎵',
    audioUrl: '/samples/sample-3.mp3',
    imageUrl: null,
    duration: '2:00'
  }
];

// Testimonials data
const testimonials = [
  {
    id: 1,
    text: "Mi esposa lloró cuando escuchó la canción. El mejor regalo que le he dado en 15 años de matrimonio.",
    name: "Roberto M.",
    location: "San Antonio, TX",
    rating: 5
  },
  {
    id: 2,
    text: "La ordené para el cumpleaños de mi mamá. Toda la familia terminó llorando. Vale cada centavo.",
    name: "María G.",
    location: "Los Angeles, CA",
    rating: 5
  },
  {
    id: 3,
    text: "Pensé que iba a sonar como robot pero suena REAL. Increíble calidad. Ya ordené otra para mi hermana.",
    name: "Carlos H.",
    location: "Houston, TX",
    rating: 5
  }
];

// FAQ data
const faqs = [
  {
    question: "¿Cuánto tiempo tarda en generarse mi canción?",
    answer: "Aproximadamente 2-3 minutos. Recibes tu canción casi instantáneamente."
  },
  {
    question: "¿Puedo escuchar antes de pagar?",
    answer: "¡Sí! Escuchas un preview de 20 segundos completamente gratis antes de decidir."
  },
  {
    question: "¿Qué recibo exactamente?",
    answer: "2 versiones únicas de tu canción en MP3 de alta calidad, la letra completa personalizada, y una carátula de álbum única."
  },
  {
    question: "¿Llega a tiempo para San Valentín?",
    answer: "¡Entrega digital instantánea! Ordena hoy, recibe hoy. No hay envío físico que esperar."
  }
];

// Audio Player Component for Samples
function SamplePlayer({ sample, isPlaying, onPlay, onPause, currentTime, duration }) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  
  return (
    <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden hover:border-gold/50 transition-all group">
      {/* Album Art with Play Button */}
      <div className="relative aspect-square">
        <div className="absolute inset-0 bg-gradient-to-br from-gold/20 to-bougainvillea/20 flex items-center justify-center">
          <span className="text-6xl">{sample.emoji}</span>
        </div>
        {sample.imageUrl && (
          <img 
            src={sample.imageUrl} 
            alt={sample.title}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => e.target.style.display = 'none'}
          />
        )}
        {/* Play/Pause Button Overlay */}
        <button
          onClick={() => isPlaying ? onPause() : onPlay(sample)}
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-xl transform hover:scale-110 transition-transform">
            <span className="material-symbols-outlined text-forest text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              {isPlaying ? 'pause' : 'play_arrow'}
            </span>
          </div>
        </button>
        {/* Playing indicator */}
        {isPlaying && (
          <div className="absolute top-3 right-3 bg-bougainvillea text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
            Reproduciendo
          </div>
        )}
      </div>
      
      {/* Song Info */}
      <div className="p-4">
        <h4 className="font-bold text-white text-lg">{sample.title}</h4>
        <p className="text-gold text-sm">{sample.genre}</p>
        
        {/* Progress Bar */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gold transition-all duration-200"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <span className="text-white/50 text-xs font-mono">
            {isPlaying ? `${Math.floor(currentTime)}s` : sample.duration}
          </span>
        </div>
      </div>
    </div>
  );
}

// Star Rating Component
function StarRating({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <span key={i} className={`text-lg ${i < rating ? 'text-gold' : 'text-white/20'}`}>★</span>
      ))}
    </div>
  );
}

// FAQ Accordion Item
function FAQItem({ question, answer, isOpen, onClick }) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={onClick}
        className="w-full p-5 flex items-center justify-between text-left bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
      >
        <span className="font-semibold text-white pr-4">{question}</span>
        <span className={`material-symbols-outlined text-gold transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 text-white/70">
          {answer}
        </div>
      )}
    </div>
  );
}

export default function LandingPageV2() {
  const { navigateTo } = useContext(AppContext);
  const [playingSample, setPlayingSample] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [openFAQ, setOpenFAQ] = useState(null);
  const audioRef = useRef(null);

  // Track page view
  useEffect(() => {
    trackStep('landing_v2');
  }, []);

  // Audio player logic
  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current;
      
      const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
      const handleLoadedMetadata = () => setDuration(audio.duration);
      const handleEnded = () => {
        setPlayingSample(null);
        setCurrentTime(0);
      };
      
      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('ended', handleEnded);
      
      return () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('ended', handleEnded);
      };
    }
  }, [playingSample]);

  const handlePlay = (sample) => {
    if (audioRef.current) {
      if (playingSample?.id === sample.id) {
        audioRef.current.play();
      } else {
        audioRef.current.src = sample.audioUrl;
        audioRef.current.play();
      }
      setPlayingSample(sample);
    }
  };

  const handlePause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingSample(null);
    }
  };

  return (
    <div className="min-h-screen bg-background-dark flex flex-col">
      {/* Hidden Audio Element */}
      <audio ref={audioRef} preload="metadata" />

      {/* 💘 Valentine's Sticky Urgency Bar */}
      <div className="bg-gradient-to-r from-red-600 via-red-500 to-red-600 text-white text-center py-3 px-4 font-bold text-sm md:text-base sticky top-0 z-50 shadow-lg">
        💘 ¡Ordena antes del 12 de Feb para San Valentín! ⏰ Solo quedan unos días
      </div>

      {/* Header */}
      <header className="bg-forest/80 backdrop-blur-md py-4 px-6 md:px-12">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div 
            className="cursor-pointer"
            onClick={() => navigateTo('landing')}
          >
            <h2 className="font-display text-white text-xl md:text-2xl font-medium tracking-tight">
              RegalosQueCantan
            </h2>
          </div>
          <button 
            onClick={() => navigateTo('genre')}
            className="bg-bougainvillea hover:bg-bougainvillea/80 text-white px-4 py-2 rounded-full text-sm font-bold transition-all"
          >
            Crear Canción
          </button>
        </div>
      </header>
      
      {/* ==================== HERO SECTION ==================== */}
      <section className="relative py-16 md:py-24 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 w-full h-full bg-forest">
          <div 
            className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-40"
            style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=1920")' }}
          />
          <div className="hero-gradient absolute inset-0 z-10" />
          
          {/* Floating Hearts */}
          <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
            <div className="absolute top-20 left-[10%] text-5xl animate-bounce opacity-60" style={{ animationDelay: '0s', animationDuration: '3s' }}>💕</div>
            <div className="absolute top-32 right-[15%] text-4xl animate-bounce opacity-50" style={{ animationDelay: '0.5s', animationDuration: '4s' }}>💖</div>
            <div className="absolute top-48 left-[25%] text-3xl animate-bounce opacity-50" style={{ animationDelay: '1s', animationDuration: '3.5s' }}>💗</div>
            <div className="absolute bottom-32 right-[25%] text-5xl animate-bounce opacity-50" style={{ animationDelay: '0.7s', animationDuration: '4s' }}>💕</div>
          </div>
        </div>

        {/* Content */}
        <div className="relative z-20 container mx-auto px-6 text-center max-w-4xl">
          {/* Valentine's Banner */}
          <div className="bg-gradient-to-r from-red-600 via-red-500 to-red-600 border-2 border-red-400 rounded-2xl px-6 py-3 mb-6 inline-block shadow-lg shadow-red-500/40 animate-pulse">
            <span className="text-white text-sm md:text-base font-bold flex items-center justify-center gap-2">
              <span>💘</span>
              <span>¡San Valentín está aquí!</span>
              <span>💘</span>
            </span>
          </div>
          
          <h1 className="text-white text-4xl md:text-6xl lg:text-7xl font-black leading-tight tracking-tighter font-display mb-6">
            Regala Una Canción <br />
            <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-gold via-white to-gold">
              Personalizada
            </span>
          </h1>
          
          <p className="text-white/70 text-lg md:text-xl font-light leading-relaxed max-w-2xl mx-auto mb-8">
            Crea una canción única con los nombres, la historia y el género que elijas. 
            El regalo perfecto que recordarán para siempre.
          </p>

          <button 
            onClick={() => navigateTo('genre')}
            className="group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-10 bg-bougainvillea text-white text-lg font-bold shadow-2xl shadow-bougainvillea/30 transition-all hover:scale-105 active:scale-95"
          >
            <span className="material-symbols-outlined mr-2">music_note</span>
            <span className="relative z-10">Crear Mi Canción</span>
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </button>
          
          <p className="mt-4 text-white/60 text-sm">
            ✓ Preview gratis antes de pagar • ✓ Desde <span className="line-through text-white/40">$29.99</span> <span className="text-gold font-bold">$19.99</span>
          </p>
        </div>
      </section>

      {/* ==================== AUDIO SAMPLES SECTION ==================== */}
      <section className="py-16 px-6 bg-background-dark">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-gold uppercase tracking-[0.3em] text-xs font-bold">🎧 Escucha Ejemplos Reales</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3 mb-3">
              Canciones Creadas Por Clientes
            </h2>
            <p className="text-white/60 max-w-xl mx-auto">
              Escucha cómo suenan las canciones personalizadas. 100% creadas con IA, 100% únicas.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {sampleSongs.map((sample) => (
              <SamplePlayer
                key={sample.id}
                sample={sample}
                isPlaying={playingSample?.id === sample.id}
                onPlay={handlePlay}
                onPause={handlePause}
                currentTime={playingSample?.id === sample.id ? currentTime : 0}
                duration={playingSample?.id === sample.id ? duration : 0}
              />
            ))}
          </div>
          
          <p className="text-center text-white/40 text-sm mt-6">
            * Nombres cambiados por privacidad. Canciones reales de clientes.
          </p>
        </div>
      </section>

      {/* ==================== TESTIMONIALS SECTION ==================== */}
      <section className="py-16 px-6 bg-forest">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-gold uppercase tracking-[0.3em] text-xs font-bold">⭐ Testimonios</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">
              Lo Que Dicen Nuestros Clientes
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((testimonial) => (
              <div 
                key={testimonial.id}
                className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-6 hover:border-gold/30 transition-all"
              >
                <StarRating rating={testimonial.rating} />
                <p className="text-white/90 mt-4 mb-6 italic leading-relaxed">
                  "{testimonial.text}"
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center">
                    <span className="text-gold font-bold">{testimonial.name[0]}</span>
                  </div>
                  <div>
                    <p className="text-white font-semibold">{testimonial.name}</p>
                    <p className="text-white/50 text-sm">{testimonial.location}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== HOW IT WORKS SECTION ==================== */}
      <section className="py-16 px-6 bg-background-dark">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-gold uppercase tracking-[0.3em] text-xs font-bold">📝 Cómo Funciona</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">
              3 Pasos Simples
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gold/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-gold text-4xl">music_note</span>
              </div>
              <div className="text-gold font-bold text-sm mb-2">PASO 1</div>
              <h3 className="text-white text-xl font-bold mb-2">Elige Tu Género</h3>
              <p className="text-white/60">
                Corrido, Banda, Bachata, Ranchera, Reggaetón y muchos más.
              </p>
            </div>

            {/* Step 2 */}
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gold/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-gold text-4xl">edit_note</span>
              </div>
              <div className="text-gold font-bold text-sm mb-2">PASO 2</div>
              <h3 className="text-white text-xl font-bold mb-2">Cuéntanos La Historia</h3>
              <p className="text-white/60">
                Nombres, ocasión, y los detalles especiales que hacen única tu canción.
              </p>
            </div>

            {/* Step 3 */}
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gold/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-gold text-4xl">download</span>
              </div>
              <div className="text-gold font-bold text-sm mb-2">PASO 3</div>
              <h3 className="text-white text-xl font-bold mb-2">Recibe Tu Canción</h3>
              <p className="text-white/60">
                En ~3 minutos recibes 2 versiones únicas listas para regalar.
              </p>
            </div>
          </div>

          <div className="text-center mt-10">
            <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-5 py-2">
              <span className="material-symbols-outlined text-gold">schedule</span>
              <span className="text-gold font-semibold">Listo en ~3 minutos</span>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== PRICING SECTION ==================== */}
      <section className="py-16 px-6 bg-forest">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <span className="text-gold uppercase tracking-[0.3em] text-xs font-bold">💰 Precio</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">
              Un Regalo Que No Tiene Precio
            </h2>
          </div>

          <div className="bg-white/[0.03] backdrop-blur-xl border-2 border-gold/50 rounded-3xl p-8 text-center relative overflow-hidden">
            {/* Valentine's ribbon */}
            <div className="absolute top-4 -right-8 bg-red-500 text-white text-xs font-bold px-10 py-1 rotate-45">
              💘 San Valentín
            </div>

            <div className="mb-6">
              <span className="text-white/40 line-through text-2xl">$29.99</span>
              <div className="text-white text-5xl font-black">$19.99</div>
              <span className="text-gold text-sm font-semibold">Pago único • Acceso de por vida</span>
            </div>

            <div className="space-y-3 text-left mb-8">
              <div className="flex items-center gap-3 text-white/80">
                <span className="material-symbols-outlined text-green-400">check_circle</span>
                <span>Canción completa (~2 minutos)</span>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <span className="material-symbols-outlined text-green-400">check_circle</span>
                <span>2 versiones únicas para elegir</span>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <span className="material-symbols-outlined text-green-400">check_circle</span>
                <span>Descarga MP3 de alta calidad</span>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <span className="material-symbols-outlined text-green-400">check_circle</span>
                <span>Letra 100% personalizada</span>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <span className="material-symbols-outlined text-green-400">check_circle</span>
                <span>Carátula de álbum única</span>
              </div>
            </div>

            <button 
              onClick={() => navigateTo('genre')}
              className="w-full group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-14 bg-bougainvillea text-white text-lg font-bold shadow-xl transition-all hover:scale-105 active:scale-95"
            >
              <span className="material-symbols-outlined mr-2">music_note</span>
              Crear Mi Canción
            </button>

            <p className="mt-4 text-white/50 text-sm flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-sm">lock</span>
              Preview GRATIS antes de pagar
            </p>
          </div>

          <div className="flex items-center justify-center gap-4 mt-6 opacity-50">
            <span className="text-white text-xl font-bold">VISA</span>
            <span className="text-white text-xl font-bold">Mastercard</span>
            <span className="text-white text-sm">PayPal</span>
          </div>
        </div>
      </section>

      {/* ==================== FAQ SECTION ==================== */}
      <section className="py-16 px-6 bg-background-dark">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-gold uppercase tracking-[0.3em] text-xs font-bold">❓ Preguntas Frecuentes</span>
            <h2 className="text-white text-3xl md:text-4xl font-black mt-3">
              ¿Tienes Dudas?
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, index) => (
              <FAQItem
                key={index}
                question={faq.question}
                answer={faq.answer}
                isOpen={openFAQ === index}
                onClick={() => setOpenFAQ(openFAQ === index ? null : index)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ==================== FINAL CTA SECTION ==================== */}
      <section className="py-20 px-6 bg-gradient-to-b from-forest to-background-dark relative overflow-hidden">
        {/* Background hearts */}
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <div className="absolute top-10 left-[20%] text-6xl">💕</div>
          <div className="absolute bottom-10 right-[20%] text-6xl">💖</div>
        </div>

        <div className="max-w-xl mx-auto text-center relative z-10">
          <div className="text-5xl mb-4">💘</div>
          <h2 className="text-white text-3xl md:text-4xl font-black mb-4">
            Regala Algo Único
          </h2>
          <p className="text-white/70 text-lg mb-8">
            Una canción personalizada que recordará para siempre. 
            El regalo perfecto para San Valentín.
          </p>

          <button 
            onClick={() => navigateTo('genre')}
            className="group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-12 bg-gradient-to-r from-bougainvillea to-red-500 text-white text-xl font-bold shadow-2xl shadow-bougainvillea/30 transition-all hover:scale-105 active:scale-95"
          >
            <span className="material-symbols-outlined mr-2 text-2xl">favorite</span>
            <span className="relative z-10">Crear Mi Canción</span>
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </button>

          <p className="mt-6 text-red-400 font-semibold flex items-center justify-center gap-2">
            <span className="material-symbols-outlined">schedule</span>
            Ordena antes del 12 de Feb para San Valentín
          </p>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="py-8 px-6 bg-background-dark border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="font-display text-white/30 text-lg">RegalosQueCantan</div>
          <div className="flex gap-6">
            <a className="text-white/30 hover:text-gold transition-colors text-sm" href="#">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-sm" href="#">Términos</a>
            <a className="text-white/30 hover:text-gold transition-colors text-sm" href="#">Contacto</a>
          </div>
          <p className="text-white/20 text-sm">© 2025 • Hecho con ❤️ en México</p>
        </div>
      </footer>
    </div>
  );
}
