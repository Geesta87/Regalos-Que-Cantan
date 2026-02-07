import React, { useContext, useEffect, useRef } from 'react';
import { AppContext } from '../App';
import Header from '../components/Header';

// Real people photos (reactions/testimonials)
const realPeopleImages = [
  '/images/reactions/reaction1.jpg',
  '/images/reactions/reaction2.jpg',
  '/images/reactions/reaction3.jpg',
  '/images/reactions/reaction4.jpg',
  '/images/reactions/reaction5.png',
  '/images/reactions/reaction6.jpg',
  '/images/reactions/reaction7.jpg',
  '/images/reactions/reaction8.jpg',
  '/images/reactions/reaction9.jpg',
];

// Genre/occasion artwork images
const genreImages = [
  '/images/genres/corrido.png',
  '/images/genres/nortena.png',
  '/images/genres/banda.png',
  '/images/genres/cumbia.png',
  '/images/genres/mariachi.png',
  '/images/genres/tamborazo.png',
  '/images/occasions/san_valentin.png',
  '/images/occasions/cumpleanos.png',
  '/images/occasions/aniversario.png',
  '/images/occasions/quinceanera.png',
  '/images/occasions/graduacion.png',
];

// Shuffle array function
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Create alternating pattern: Real Person → Genre → Real Person → Genre
const createAlternatingImages = () => {
  const shuffledPeople = shuffleArray(realPeopleImages);
  const shuffledGenres = shuffleArray(genreImages);
  
  const alternating = [];
  const maxLength = Math.max(shuffledPeople.length, shuffledGenres.length);
  
  for (let i = 0; i < maxLength; i++) {
    // Add real person photo
    if (i < shuffledPeople.length) {
      alternating.push({ src: shuffledPeople[i], type: 'person' });
    }
    // Add genre artwork
    if (i < shuffledGenres.length) {
      alternating.push({ src: shuffledGenres[i], type: 'genre' });
    }
  }
  
  return alternating;
};

export default function LandingPage() {
  const { navigateTo } = useContext(AppContext);
  const scrollRef = useRef(null);
  
  // Create alternating images once on mount
  const [alternatingImages] = React.useState(() => createAlternatingImages());
  
  // Duplicate for seamless loop
  const carouselImages = [...alternatingImages, ...alternatingImages];

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    let animationId;
    let scrollPos = 0;
    const scrollSpeed = 0.5; // pixels per frame

    const animate = () => {
      scrollPos += scrollSpeed;
      
      // Reset position when we've scrolled through the first set of images
      const halfWidth = scrollContainer.scrollWidth / 2;
      if (scrollPos >= halfWidth) {
        scrollPos = 0;
      }
      
      scrollContainer.scrollLeft = scrollPos;
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    // Pause on hover
    const handleMouseEnter = () => cancelAnimationFrame(animationId);
    const handleMouseLeave = () => {
      animationId = requestAnimationFrame(animate);
    };

    scrollContainer.addEventListener('mouseenter', handleMouseEnter);
    scrollContainer.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      cancelAnimationFrame(animationId);
      scrollContainer.removeEventListener('mouseenter', handleMouseEnter);
      scrollContainer.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background-dark flex flex-col">
      <Header variant="landing" />
      
      {/* Hero Section */}
      <section className="relative flex-1 flex flex-col items-center justify-center overflow-hidden py-16 md:py-24">
        {/* Background */}
        <div className="absolute inset-0 w-full h-full bg-forest">
          <div 
            className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-40"
            style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=1920")' }}
          />
          <div className="hero-gradient absolute inset-0 z-10" />
          <div className="papel-picado-overlay absolute inset-0 z-10 text-white" />
          
          {/* Floating Hearts for Valentine's */}
          <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
            <div className="absolute top-20 left-[10%] text-4xl animate-bounce opacity-30" style={{ animationDelay: '0s', animationDuration: '3s' }}>💕</div>
            <div className="absolute top-32 right-[15%] text-3xl animate-bounce opacity-25" style={{ animationDelay: '0.5s', animationDuration: '4s' }}>💖</div>
            <div className="absolute top-48 left-[25%] text-2xl animate-bounce opacity-20" style={{ animationDelay: '1s', animationDuration: '3.5s' }}>💗</div>
            <div className="absolute top-24 right-[30%] text-3xl animate-bounce opacity-30" style={{ animationDelay: '1.5s', animationDuration: '4.5s' }}>💘</div>
            <div className="absolute bottom-40 left-[20%] text-2xl animate-bounce opacity-25" style={{ animationDelay: '2s', animationDuration: '3s' }}>❤️</div>
            <div className="absolute bottom-32 right-[25%] text-4xl animate-bounce opacity-20" style={{ animationDelay: '0.7s', animationDuration: '4s' }}>💕</div>
          </div>
        </div>

        {/* Content */}
        <div className="relative z-20 container mx-auto px-6 text-center flex flex-col items-center gap-6 max-w-5xl">
          {/* Valentine's Day Promo Banner */}
          <div className="bg-gradient-to-r from-pink-500/20 via-red-500/20 to-pink-500/20 border border-pink-400/30 rounded-2xl px-6 py-3 mb-4 backdrop-blur-sm animate-pulse">
            <span className="text-pink-300 text-sm font-medium flex items-center justify-center gap-2">
              <span>💘</span>
              <span>¡San Valentín está aquí! Regala una canción única</span>
              <span>💘</span>
            </span>
          </div>
          
          <span className="text-gold uppercase tracking-[0.3em] text-xs font-bold bg-gold/10 px-4 py-2 rounded-full border border-gold/20">
            Canciones Personalizadas con IA
          </span>
          <h1 className="text-white text-5xl md:text-7xl lg:text-8xl font-black leading-none tracking-tighter font-display">
            Tu Historia, <br />
            <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-gold via-white to-gold">
              Tu Canción
            </span>
          </h1>
          <p className="text-white/70 text-lg md:text-xl font-light leading-relaxed max-w-2xl mx-auto">
            Crea una canción única para alguien especial en minutos.
          </p>

          <button 
            onClick={() => navigateTo('genre')}
            className="group relative flex min-w-[280px] md:min-w-[340px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-10 bg-bougainvillea text-white text-lg font-bold shadow-2xl shadow-bougainvillea/30 transition-all hover:scale-105 active:scale-95 mt-4"
          >
            <span className="material-symbols-outlined mr-2">music_note</span>
            <span className="relative z-10">Crear Mi Canción</span>
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </button>
          
          <p className="text-pink-300/80 text-sm flex items-center gap-2">
            <span>💝</span>
            Preview gratis • ¡Ordena antes del 14 de Feb!
            <span>💝</span>
          </p>
        </div>
      </section>

      {/* Auto-scrolling Carousel - Alternating Real People & Genre Art */}
      <section className="py-8 overflow-hidden bg-background-dark/50">
        <div 
          ref={scrollRef}
          className="flex gap-4 overflow-x-hidden cursor-grab active:cursor-grabbing"
          style={{ scrollBehavior: 'auto' }}
        >
          {carouselImages.map((image, index) => (
            <div
              key={index}
              onClick={() => navigateTo('genre')}
              className={`flex-shrink-0 w-48 h-48 md:w-64 md:h-64 rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all hover:scale-105 cursor-pointer group ${
                image.type === 'person' 
                  ? 'hover:shadow-gold/30 ring-2 ring-gold/20' 
                  : 'hover:shadow-primary/20'
              }`}
            >
              <div className="relative w-full h-full">
                <img 
                  src={image.src} 
                  alt=""
                  className="w-full h-full object-cover"
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center shadow-xl transform scale-75 group-hover:scale-100 transition-transform">
                    <span className="material-symbols-outlined text-forest text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                  </div>
                </div>
                {/* Type indicator badge */}
                {image.type === 'person' && (
                  <div className="absolute bottom-2 left-2 bg-gold/90 text-forest text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                    ⭐ Cliente Real
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Simple Footer */}
      <footer className="py-6 px-6 text-center bg-background-dark">
        <p className="text-white/20 text-xs">© 2025 RegalosQueCantan • Hecho con ❤️</p>
      </footer>
    </div>
  );
}
