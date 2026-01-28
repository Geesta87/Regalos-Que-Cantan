import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead from '../../components/SEOHead';
import { getAllGenres, getFeaturedGenres } from '../../data/seoData';

/**
 * GenerosHub - SEO Hub page for all music genres
 * 
 * This page ranks for searches like:
 * - "géneros de música personalizada"
 * - "tipos de canciones personalizadas"
 * - "música latina personalizada"
 */
export default function GenerosHub() {
  const { navigateTo } = useContext(AppContext);
  const allGenres = getAllGenres();
  const featuredGenres = getFeaturedGenres();
  
  // Group genres by category for better organization
  const genreCategories = {
    'Regional Mexicano': allGenres.filter(g => 
      ['corridos-tumbados', 'corrido-clasico', 'banda-sinaloense', 'norteno', 'mariachi', 'ranchera', 'regional-mexicano', 'huapango', 'son-jarocho'].includes(g.slug)
    ),
    'Tropical': allGenres.filter(g => 
      ['cumbia', 'cumbia-nortena', 'cumbia-colombiana', 'cumbia-texana', 'salsa', 'merengue'].includes(g.slug)
    ),
    'Romántico': allGenres.filter(g => 
      ['bachata', 'bolero', 'balada', 'vallenato'].includes(g.slug)
    ),
    'Urbano & Pop': allGenres.filter(g => 
      ['reggaeton', 'pop-latino'].includes(g.slug)
    )
  };

  const structuredData = {
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

  return (
    <>
      <SEOHead
        title="Géneros Musicales para Canciones Personalizadas"
        description="Explora más de 20 géneros de música latina para tu canción personalizada: corridos tumbados, cumbia, banda, norteño, mariachi, bachata, reggaeton y más. Crea el regalo perfecto."
        canonical="/generos"
        keywords="géneros musicales, música latina, corridos, cumbia, banda, norteño, mariachi, bachata, reggaeton, canciones personalizadas"
        structuredData={structuredData}
      />
      
      <div className="min-h-screen bg-[#F9F6F2]">
        {/* Hero Section */}
        <section className="py-20 px-6 bg-gradient-to-b from-[#1A4338] to-[#2D5A4A] text-white">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Elige Tu Género Musical
            </h1>
            <p className="text-xl text-white/80 max-w-2xl mx-auto">
              Más de 20 géneros de música latina para crear la canción personalizada perfecta
            </p>
          </div>
        </section>
        
        {/* Featured Genres */}
        <section className="py-16 px-6">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              ⭐ Géneros Más Populares
            </h2>
            
            <div className="grid md:grid-cols-3 gap-6">
              {featuredGenres.slice(0, 6).map(genre => (
                <button
                  key={genre.slug}
                  onClick={() => navigateTo(`generos/${genre.slug}`)}
                  className="group bg-white rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all text-left"
                >
                  <div className="flex items-start gap-4">
                    <div 
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ backgroundColor: `${genre.color}20` }}
                    >
                      {genre.icon}
                    </div>
                    <div>
                      <h3 className="font-bold text-[#1A4338] text-lg group-hover:text-opacity-80">
                        {genre.name}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                        {genre.description}
                      </p>
                      <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                        <span>⭐ 4.9</span>
                        <span>•</span>
                        <span>{genre.reviewCount}+ canciones</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
        
        {/* All Genres by Category */}
        {Object.entries(genreCategories).map(([category, genres]) => (
          <section key={category} className="py-12 px-6 even:bg-white">
            <div className="max-w-6xl mx-auto">
              <h2 className="text-xl font-bold text-[#1A4338] mb-6">
                {category}
              </h2>
              
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {genres.map(genre => (
                  <button
                    key={genre.slug}
                    onClick={() => navigateTo(`generos/${genre.slug}`)}
                    className="group p-4 rounded-xl border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all text-center"
                  >
                    <div className="text-2xl mb-2">{genre.icon}</div>
                    <div className="font-medium text-[#1A4338] text-sm group-hover:text-opacity-80">
                      {genre.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>
        ))}
        
        {/* CTA Section */}
        <section className="py-20 px-6 bg-[#1A4338] text-white">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">
              ¿No sabes cuál elegir?
            </h2>
            <p className="text-white/70 mb-8">
              Empieza a crear tu canción y nosotros te ayudamos a encontrar el género perfecto
            </p>
            <button
              onClick={() => navigateTo('genre')}
              className="px-8 py-4 bg-[#D4AF37] text-[#1A4338] rounded-full text-lg font-bold hover:bg-[#E5C349] transition-colors"
            >
              🎵 Crear Mi Canción
            </button>
          </div>
        </section>
        
        {/* Footer */}
        <footer className="py-8 px-6 bg-[#0F2922] text-white/50 text-center text-sm">
          <p>© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
        </footer>
      </div>
    </>
  );
}
