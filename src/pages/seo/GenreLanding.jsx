import React, { useContext, useEffect } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateGenreStructuredData, generateBreadcrumbData } from '../../components/SEOHead';
import { getGenreBySlug, getAllGenres, getAllOccasions } from '../../data/seoData';

/**
 * GenreLanding - SEO Landing Page for individual genres
 * 
 * This page is designed to rank for genre-specific searches like:
 * - "corrido personalizado"
 * - "canción de cumbia para cumpleaños"
 * - "banda sinaloense personalizada"
 */
export default function GenreLanding({ genreSlug }) {
  const { navigateTo, setFormData } = useContext(AppContext);
  const genre = getGenreBySlug(genreSlug);
  
  // If genre not found, redirect to genres hub
  useEffect(() => {
    if (!genre) {
      navigateTo('generos');
    }
  }, [genre, navigateTo]);
  
  if (!genre) return null;
  
  // Get related genres (same category or popular)
  const relatedGenres = getAllGenres()
    .filter(g => g.slug !== genreSlug)
    .slice(0, 4);
  
  // Get suggested occasions for this genre
  const suggestedOccasions = getAllOccasions()
    .filter(o => genre.popularFor?.some(pf => o.name.toLowerCase().includes(pf.toLowerCase())))
    .slice(0, 4);
  
  // Handle CTA click - pre-select genre and go to funnel
  const handleCreateSong = () => {
    setFormData(prev => ({
      ...prev,
      genre: genre.id,
      genreName: genre.name
    }));
    navigateTo('occasion');
  };
  
  // Breadcrumb data for structured data
  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Géneros', path: '/generos' },
    { name: genre.name, path: `/generos/${genre.slug}` }
  ];

  return (
    <>
      <SEOHead
        title={genre.title}
        description={genre.metaDescription}
        canonical={`/generos/${genre.slug}`}
        keywords={genre.keywords}
        ogImage={`/images/genres/${genre.slug}.jpg`}
        structuredData={generateGenreStructuredData(genre)}
      />
      
      <div className="min-h-screen bg-[#F9F6F2]">
        {/* Hero Section */}
        <section 
          className="relative py-20 px-6"
          style={{ 
            background: `linear-gradient(135deg, ${genre.color}15 0%, ${genre.color}05 100%)` 
          }}
        >
          <div className="max-w-4xl mx-auto text-center">
            {/* Breadcrumbs */}
            <nav className="mb-8" aria-label="Breadcrumb">
              <ol className="flex items-center justify-center gap-2 text-sm text-gray-500">
                {breadcrumbs.map((item, index) => (
                  <li key={item.path} className="flex items-center gap-2">
                    {index > 0 && <span>/</span>}
                    {index === breadcrumbs.length - 1 ? (
                      <span className="text-gray-900 font-medium">{item.name}</span>
                    ) : (
                      <button 
                        onClick={() => navigateTo(item.path === '/' ? 'landing' : item.path.replace('/', ''))}
                        className="hover:text-gray-900 transition-colors"
                      >
                        {item.name}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            
            {/* Icon */}
            <div 
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mx-auto mb-6"
              style={{ backgroundColor: `${genre.color}20` }}
            >
              {genre.icon}
            </div>
            
            {/* Title */}
            <h1 className="text-4xl md:text-5xl font-bold text-[#1A4338] mb-4">
              {genre.heroTitle}
            </h1>
            
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              {genre.heroSubtitle}
            </p>
            
            {/* CTA Button */}
            <button
              onClick={handleCreateSong}
              className="px-8 py-4 rounded-full text-lg font-bold transition-all transform hover:scale-105 shadow-lg"
              style={{ 
                backgroundColor: genre.color,
                color: 'white'
              }}
            >
              🎵 Crear Mi {genre.name} Ahora
            </button>
            
            {/* Price Badge */}
            <p className="mt-4 text-gray-500">
              Desde <span className="font-bold text-[#1A4338]">$19.99</span> • Listo en minutos
            </p>
          </div>
        </section>
        
        {/* Description Section */}
        <section className="py-16 px-6 bg-white">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-6">
              ¿Qué es un {genre.name} Personalizado?
            </h2>
            <div className="prose prose-lg text-gray-600">
              {genre.longDescription ? (
                genre.longDescription.split('\n\n').map((paragraph, i) => (
                  <p key={i} className="mb-4">{paragraph}</p>
                ))
              ) : (
                <p>{genre.description}</p>
              )}
            </div>
            
            {/* Artists Reference */}
            {genre.artists && genre.artists.length > 0 && (
              <div className="mt-8 p-6 bg-gray-50 rounded-xl">
                <h3 className="font-bold text-[#1A4338] mb-3">
                  Estilo inspirado en artistas como:
                </h3>
                <div className="flex flex-wrap gap-2">
                  {genre.artists.map(artist => (
                    <span 
                      key={artist}
                      className="px-4 py-2 bg-white rounded-full text-sm text-gray-700 shadow-sm"
                    >
                      {artist}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
        
        {/* Features Section */}
        <section className="py-16 px-6 bg-[#F9F6F2]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              ¿Qué incluye tu {genre.name}?
            </h2>
            
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <div className="text-3xl mb-4">✨</div>
                <h3 className="font-bold text-[#1A4338] mb-2">100% Personalizado</h3>
                <p className="text-gray-600 text-sm">
                  Letra única con el nombre de tu ser querido y detalles especiales que tú proporcionas.
                </p>
              </div>
              
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <div className="text-3xl mb-4">🎵</div>
                <h3 className="font-bold text-[#1A4338] mb-2">2 Versiones</h3>
                <p className="text-gray-600 text-sm">
                  Generamos dos versiones únicas para que elijas tu favorita o te quedes con ambas.
                </p>
              </div>
              
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <div className="text-3xl mb-4">⚡</div>
                <h3 className="font-bold text-[#1A4338] mb-2">Listo en Minutos</h3>
                <p className="text-gray-600 text-sm">
                  Nuestra IA crea tu canción en 2-4 minutos. Descarga instantánea en MP3.
                </p>
              </div>
            </div>
          </div>
        </section>
        
        {/* Popular For Section */}
        {genre.popularFor && genre.popularFor.length > 0 && (
          <section className="py-16 px-6 bg-white">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
                Perfecto para estas ocasiones
              </h2>
              
              <div className="flex flex-wrap justify-center gap-4">
                {genre.popularFor.map(occasion => (
                  <div 
                    key={occasion}
                    className="px-6 py-3 rounded-full border-2 text-[#1A4338] font-medium"
                    style={{ borderColor: genre.color }}
                  >
                    {occasion}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        
        {/* Social Proof */}
        <section className="py-16 px-6 bg-[#1A4338] text-white">
          <div className="max-w-4xl mx-auto text-center">
            <div className="flex items-center justify-center gap-1 mb-4">
              {[...Array(5)].map((_, i) => (
                <span key={i} className="text-2xl">⭐</span>
              ))}
            </div>
            <p className="text-xl mb-2">
              <span className="font-bold">{genre.reviewCount}+</span> canciones de {genre.name} creadas
            </p>
            <p className="text-white/70">
              4.9/5 calificación promedio de nuestros clientes
            </p>
          </div>
        </section>
        
        {/* CTA Section */}
        <section className="py-20 px-6 bg-[#F9F6F2]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-[#1A4338] mb-4">
              ¿Listo para crear tu {genre.name}?
            </h2>
            <p className="text-gray-600 mb-8">
              En solo 5 minutos tendrás una canción única que tu ser querido nunca olvidará.
            </p>
            
            <button
              onClick={handleCreateSong}
              className="px-10 py-4 rounded-full text-xl font-bold transition-all transform hover:scale-105 shadow-xl"
              style={{ 
                backgroundColor: genre.color,
                color: 'white'
              }}
            >
              🎤 Crear Mi Canción Ahora
            </button>
            
            <div className="mt-6 flex items-center justify-center gap-6 text-sm text-gray-500">
              <span>✓ Sin suscripción</span>
              <span>✓ Pago único</span>
              <span>✓ Descarga inmediata</span>
            </div>
          </div>
        </section>
        
        {/* Related Genres */}
        <section className="py-16 px-6 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              Explora otros géneros
            </h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {relatedGenres.map(g => (
                <button
                  key={g.slug}
                  onClick={() => navigateTo(`generos/${g.slug}`)}
                  className="p-4 rounded-xl border border-gray-200 hover:border-gray-300 transition-all text-center"
                >
                  <div className="text-2xl mb-2">{g.icon}</div>
                  <div className="font-medium text-[#1A4338] text-sm">{g.name}</div>
                </button>
              ))}
            </div>
            
            <div className="text-center mt-6">
              <button
                onClick={() => navigateTo('generos')}
                className="text-[#1A4338] font-medium hover:underline"
              >
                Ver los 20+ géneros disponibles →
              </button>
            </div>
          </div>
        </section>
        
        {/* Footer */}
        <footer className="py-8 px-6 bg-[#1A4338] text-white/70 text-center text-sm">
          <p>© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          <p className="mt-2">Canciones personalizadas con inteligencia artificial.</p>
        </footer>
      </div>
    </>
  );
}
