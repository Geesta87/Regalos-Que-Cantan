import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateBreadcrumbData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getAllGenres, getFeaturedGenres } from '../../data/seoData';

/**
 * GenerosHub - SEO Hub page for all music genres
 * Talavera UI Design
 */
export default function GenerosHub() {
  const { navigateTo } = useContext(AppContext);
  const allGenres = getAllGenres();
  const featuredGenres = getFeaturedGenres();

  const breadcrumbData = generateBreadcrumbData([
    { name: 'Inicio', path: '/' },
    { name: 'Géneros', path: '/generos' }
  ]);

  const itemListData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Géneros Musicales para Canciones Personalizadas",
    "description": "Más de 20 géneros de música latina disponibles para crear canciones personalizadas con IA",
    "numberOfItems": allGenres.length,
    "itemListElement": allGenres.map((genre, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": genre.name,
      "url": `https://regalosquecantan.com/generos/${genre.slug}`
    }))
  };

  const structuredData = [breadcrumbData, itemListData];

  // Genre images mapping (placeholder URLs - replace with actual images)
  const genreImages = {
    'corridos-tumbados': 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=300&fit=crop',
    'cumbia': 'https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=400&h=300&fit=crop',
    'banda-sinaloense': 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400&h=300&fit=crop',
    'norteno': 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=300&fit=crop',
    'mariachi': 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=400&h=300&fit=crop',
    'bachata': 'https://images.unsplash.com/photo-1545959570-a94084071b5d?w=400&h=300&fit=crop',
    'reggaeton': 'https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=400&h=300&fit=crop',
    'salsa': 'https://images.unsplash.com/photo-1547153760-18fc86324498?w=400&h=300&fit=crop',
    'bolero': 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=300&fit=crop',
    'ranchera': 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400&h=300&fit=crop',
    'vallenato': 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=300&fit=crop',
    'merengue': 'https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=400&h=300&fit=crop',
    'pop-latino': 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=300&fit=crop',
    'balada': 'https://images.unsplash.com/photo-1545959570-a94084071b5d?w=400&h=300&fit=crop',
  };

  const getGenreImage = (slug) => {
    return genreImages[slug] || 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=300&fit=crop';
  };

  return (
    <>
      <SEOHead
        title="Géneros Musicales para Canciones Personalizadas"
        description="Explora más de 20 géneros de música latina para tu canción personalizada: corridos tumbados, cumbia, banda, norteño, mariachi, bachata, reggaeton y más. Crea el regalo perfecto."
        canonical="/generos"
        keywords="géneros musicales, música latina, corridos, cumbia, banda, norteño, mariachi, bachata, reggaeton, canciones personalizadas"
        structuredData={structuredData}
      />

      {/* Talavera Pattern Styles */}
      <style>{`
        .talavera-pattern-bg {
          background-color: #ffffff;
          background-image: linear-gradient(30deg, #1A4338 12%, transparent 12.5%, transparent 87%, #1A4338 87.5%, #1A4338), 
                            linear-gradient(150deg, #1A4338 12%, transparent 12.5%, transparent 87%, #1A4338 87.5%, #1A4338), 
                            linear-gradient(30deg, #1A4338 12%, transparent 12.5%, transparent 87%, #1A4338 87.5%, #1A4338), 
                            linear-gradient(150deg, #1A4338 12%, transparent 12.5%, transparent 87%, #1A4338 87.5%, #1A4338), 
                            linear-gradient(60deg, #1A433877 25%, transparent 25.5%, transparent 75%, #1A433877 75%, #1A433877), 
                            linear-gradient(60deg, #1A433877 25%, transparent 25.5%, transparent 75%, #1A433877 75%, #1A433877);
          background-size: 20px 35px;
          background-position: 0 0, 0 0, 10px 18px, 10px 18px, 0 0, 10px 18px;
        }
      `}</style>

      <div className="min-h-screen bg-[#F9F6F2] font-['Inter',sans-serif] text-[#111318]">
        {/* Top Navigation Bar */}
        <header className="flex items-center justify-between whitespace-nowrap border-b border-solid border-[#f0f1f5] px-6 md:px-10 py-4 bg-white/80 backdrop-blur-md sticky top-0 z-50">
          <SEOLink
            to="landing"
            className="flex items-center gap-3 text-[#1A4338] hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 bg-[#1A4338] rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">🎵</span>
            </div>
            <h2 className="text-[#111318] text-xl font-bold leading-tight tracking-[-0.015em]">RegalosQueCantan</h2>
          </SEOLink>
          <div className="flex flex-1 justify-end gap-4 md:gap-8 items-center">
            <nav className="hidden md:flex items-center gap-9">
              <SEOLink
                to="generos"
                className="text-[#1A4338] text-sm font-medium hover:text-[#D4AF37] transition-colors"
              >
                Géneros
              </SEOLink>
              <SEOLink
                to="ocasiones"
                className="text-[#111318] text-sm font-medium hover:text-[#1A4338] transition-colors"
              >
                Ocasiones
              </SEOLink>
            </nav>
            <SEOLink
              to="landing"
              className="flex min-w-[84px] cursor-pointer items-center justify-center rounded-lg h-10 px-5 bg-[#1A4338]/10 text-[#1A4338] hover:bg-[#1A4338] hover:text-white transition-all text-sm font-bold border border-[#1A4338]/20"
            >
              <span className="truncate">Inicio</span>
            </SEOLink>
          </div>
        </header>

        <main className="flex flex-1 justify-center py-10 px-4 md:px-6">
          <div className="flex flex-col max-w-[1000px] flex-1">
            {/* Page Heading */}
            <div className="flex flex-wrap justify-between gap-3 p-4 mb-6">
              <div className="flex min-w-72 flex-col gap-3">
                <h1 className="text-[#1A4338] text-4xl md:text-5xl font-black leading-tight tracking-[-0.033em]">
                  Elige Tu<br/>Herencia Musical
                </h1>
                <p className="text-[#606e8a] text-lg font-normal max-w-xl">
                  Más de 20 géneros de música latina para crear la canción personalizada perfecta. Cada género trae un alma única a tu mensaje.
                </p>
              </div>
            </div>

            {/* Featured Genres Section */}
            <div className="px-4 mb-4">
              <div className="flex items-center gap-2 mb-6">
                <span className="text-[#D4AF37] text-xl">⭐</span>
                <h2 className="text-[#1A4338] text-xs font-bold uppercase tracking-widest">Géneros Más Populares</h2>
              </div>
            </div>

            {/* Genre Grid with Talavera Accents */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 p-4">
              {allGenres.map((genre) => (
                <SEOLink
                  key={genre.slug}
                  to={`generos/${genre.slug}`}
                  className="group relative flex flex-col p-[2px] rounded-xl overflow-hidden bg-white border border-[#1A4338]/10 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-left"
                >
                  {/* Talavera Pattern Background */}
                  <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity talavera-pattern-bg"></div>
                  
                  <div className="relative bg-white m-1 rounded-lg flex flex-col h-full overflow-hidden">
                    {/* Genre Image */}
                    <div
                      className="h-48 bg-cover bg-center relative"
                      role="img"
                      aria-label={`Canción de ${genre.name} personalizada`}
                      style={{
                        backgroundImage: `linear-gradient(0deg, rgba(26, 67, 56, 0.6) 0%, transparent 100%), url("${getGenreImage(genre.slug)}")`
                      }}
                    >
                      {/* Icon overlay */}
                      <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-xl">
                        {genre.icon}
                      </div>
                    </div>
                    
                    {/* Genre Info */}
                    <div className="p-5 flex flex-col gap-2">
                      <h3 className="text-[#1A4338] text-xl font-bold">{genre.name}</h3>
                      <p className="text-xs text-slate-500 uppercase font-bold tracking-wide line-clamp-1">
                        {genre.description?.split('.')[0] || 'Estilo único'}
                      </p>
                      {genre.featured && (
                        <span className="inline-flex items-center gap-1 text-[#D4AF37] text-xs font-medium mt-1">
                          <span>⭐</span> Popular
                        </span>
                      )}
                    </div>
                  </div>
                </SEOLink>
              ))}
            </div>

            {/* Action Footer */}
            <div className="mt-12 mb-20 p-4 flex flex-col items-center gap-6">
              <p className="text-[#606e8a] text-sm italic text-center">
                La estética Talavera honra nuestra herencia compartida con un toque de lujo moderno.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                <SEOLink
                  to="ocasiones"
                  className="flex min-w-[200px] items-center justify-center gap-2 rounded-xl h-14 px-8 bg-white border-2 border-[#1A4338] text-[#1A4338] hover:bg-[#1A4338]/5 transition-all text-base font-bold"
                >
                  <span>🎁</span>
                  Ver Ocasiones
                </SEOLink>
                <SEOLink
                  to="genre"
                  className="flex min-w-[240px] items-center justify-center gap-2 rounded-xl h-14 px-8 bg-[#1A4338] text-white hover:bg-[#1A4338]/90 transition-all text-base font-bold shadow-lg shadow-[#1A4338]/30"
                >
                  Crear Mi Canción
                  <span>→</span>
                </SEOLink>
              </div>
            </div>
          </div>
        </main>

        {/* Minimalist Patterned Footer */}
        <footer className="w-full bg-white border-t border-[#1A4338]/10 py-12 px-6 md:px-10">
          <div className="max-w-[1000px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-[#1A4338]">
                <span className="text-3xl">🎵</span>
                <span className="font-bold text-lg">RegalosQueCantan</span>
              </div>
              <p className="text-sm text-slate-500">Fusionando la belleza atemporal de la cerámica Talavera con el poder emocional de la canción.</p>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="font-bold text-[#1A4338] uppercase text-xs tracking-widest">Navegación</h4>
              <div className="flex flex-col gap-2 text-sm text-[#111318]">
                <SEOLink to="landing" className="hover:text-[#1A4338] transition-colors text-left">Cómo Funciona</SEOLink>
                <SEOLink to="generos" className="hover:text-[#1A4338] transition-colors text-left">Catálogo de Géneros</SEOLink>
                <SEOLink to="ocasiones" className="hover:text-[#1A4338] transition-colors text-left">Guía de Regalos</SEOLink>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="font-bold text-[#1A4338] uppercase text-xs tracking-widest">Soporte</h4>
              <div className="flex flex-col gap-2 text-sm text-[#111318]">
                <a href="mailto:hola@regalosquecantan.com" className="hover:text-[#1A4338] transition-colors">Contáctanos</a>
              </div>
            </div>
          </div>
          <div className="max-w-[1000px] mx-auto mt-12 pt-8 border-t border-[#1A4338]/5 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-400">
            <p>© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
            <div className="flex gap-4">
              <span className="cursor-pointer hover:text-[#1A4338] transition-colors">🌐</span>
              <span className="cursor-pointer hover:text-[#1A4338] transition-colors">🛡️</span>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
