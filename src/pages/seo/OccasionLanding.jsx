import React, { useContext, useEffect } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateOccasionStructuredData, generateBreadcrumbData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getOccasionBySlug, getAllOccasions, getGenreBySlug, getAllGenres } from '../../data/seoData';

/**
 * OccasionLanding - SEO Landing Page for individual occasions
 * 
 * This page is designed to rank for occasion-specific searches like:
 * - "regalo día de las madres único"
 * - "canción para cumpleaños personalizada"
 * - "regalo quinceañera original"
 */
export default function OccasionLanding({ occasionSlug }) {
  const { navigateTo, setFormData } = useContext(AppContext);
  const occasion = getOccasionBySlug(occasionSlug);
  
  // If occasion not found, redirect to occasions hub
  useEffect(() => {
    if (!occasion) {
      navigateTo('ocasiones');
    }
  }, [occasion, navigateTo]);
  
  if (!occasion) return null;
  
  // Get related occasions
  const relatedOccasions = getAllOccasions()
    .filter(o => o.slug !== occasionSlug)
    .slice(0, 4);
  
  // Get suggested genres for this occasion
  const suggestedGenres = (occasion.suggestedGenres || [])
    .map(slug => getGenreBySlug(slug))
    .filter(Boolean);
  
  // Handle CTA click - pre-select occasion and go to funnel
  const handleCreateSong = (genreSlug = null) => {
    const updates = {
      occasion: occasion.id,
      occasionName: occasion.name
    };
    
    if (genreSlug) {
      const genre = getGenreBySlug(genreSlug);
      if (genre) {
        updates.genre = genre.id;
        updates.genreName = genre.name;
      }
    }
    
    setFormData(prev => ({ ...prev, ...updates }));
    navigateTo(genreSlug ? 'names' : 'genre');
  };
  
  // Breadcrumb data
  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Ocasiones', path: '/ocasiones' },
    { name: occasion.name, path: `/ocasiones/${occasion.slug}` }
  ];

  return (
    <>
      <SEOHead
        title={occasion.title}
        description={occasion.metaDescription}
        canonical={`/ocasiones/${occasion.slug}`}
        keywords={occasion.keywords}
        ogImage={`/images/occasions/${occasion.slug}.jpg`}
        structuredData={[generateOccasionStructuredData(occasion), generateBreadcrumbData(breadcrumbs)]}
      />
      
      <div className="min-h-screen bg-[#F9F6F2]">
        {/* Hero Section */}
        <section 
          className="relative py-20 px-6"
          style={{ 
            background: `linear-gradient(135deg, ${occasion.color}15 0%, ${occasion.color}05 100%)` 
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
                      <SEOLink
                        to={item.path === '/' ? 'landing' : item.path.replace('/', '')}
                        className="hover:text-gray-900 transition-colors"
                      >
                        {item.name}
                      </SEOLink>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            
            {/* Icon */}
            <div 
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mx-auto mb-6"
              style={{ backgroundColor: `${occasion.color}20` }}
            >
              {occasion.icon}
            </div>
            
            {/* Title */}
            <h1 className="text-4xl md:text-5xl font-bold text-[#1A4338] mb-4">
              {occasion.heroTitle}
            </h1>
            
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              {occasion.heroSubtitle}
            </p>
            
            {/* CTA Button */}
            <button
              onClick={() => handleCreateSong()}
              className="px-8 py-4 rounded-full text-lg font-bold transition-all transform hover:scale-105 shadow-lg"
              style={{ 
                backgroundColor: occasion.color,
                color: 'white'
              }}
            >
              🎵 Crear Canción para {occasion.name}
            </button>
            
            {/* Price Badge */}
            <p className="mt-4 text-gray-500">
              Desde <span className="font-bold text-[#1A4338]">$29.99</span> • Listo en minutos
            </p>
          </div>
        </section>
        
        {/* Description Section */}
        <section className="py-16 px-6 bg-white">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-6">
              El Regalo Perfecto para {occasion.name}
            </h2>
            <div className="prose prose-lg text-gray-600">
              {occasion.longDescription ? (
                occasion.longDescription.split('\n\n').map((paragraph, i) => (
                  <p key={i} className="mb-4">{paragraph}</p>
                ))
              ) : (
                <p>{occasion.description}</p>
              )}
            </div>
          </div>
        </section>
        
        {/* Suggested Genres Section */}
        {suggestedGenres.length > 0 && (
          <section className="py-16 px-6 bg-[#F9F6F2]">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl font-bold text-[#1A4338] mb-4 text-center">
                Géneros Recomendados para {occasion.name}
              </h2>
              <p className="text-gray-600 text-center mb-8">
                Elige el estilo musical perfecto para tu regalo
              </p>
              
              <div className="grid md:grid-cols-2 gap-4">
                {suggestedGenres.map(genre => (
                  <button
                    key={genre.slug}
                    onClick={() => handleCreateSong(genre.slug)}
                    className="flex items-center gap-4 p-6 bg-white rounded-xl shadow-sm hover:shadow-md transition-all text-left group"
                  >
                    <div 
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ backgroundColor: `${genre.color}20` }}
                    >
                      {genre.icon}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-[#1A4338] group-hover:text-opacity-80">
                        {genre.name}
                      </h3>
                      <p className="text-sm text-gray-500 line-clamp-2">
                        {genre.description}
                      </p>
                    </div>
                    <span className="text-gray-400 group-hover:translate-x-1 transition-transform">
                      →
                    </span>
                  </button>
                ))}
              </div>
              
              <div className="text-center mt-6">
                <button
                  onClick={() => handleCreateSong()}
                  className="text-[#1A4338] font-medium hover:underline"
                >
                  Ver los 20+ géneros disponibles →
                </button>
              </div>
            </div>
          </section>
        )}
        
        {/* How It Works Section */}
        <section className="py-16 px-6 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              ¿Cómo Funciona?
            </h2>
            
            <div className="grid md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-[#1A4338] text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  1
                </div>
                <h3 className="font-bold text-[#1A4338] mb-2">Elige el Género</h3>
                <p className="text-gray-600 text-sm">
                  Corridos, cumbia, banda, bachata y más
                </p>
              </div>
              
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-[#1A4338] text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  2
                </div>
                <h3 className="font-bold text-[#1A4338] mb-2">Agrega los Detalles</h3>
                <p className="text-gray-600 text-sm">
                  Nombre, relación, memorias especiales
                </p>
              </div>
              
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-[#1A4338] text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  3
                </div>
                <h3 className="font-bold text-[#1A4338] mb-2">IA Crea la Canción</h3>
                <p className="text-gray-600 text-sm">
                  2 versiones únicas en minutos
                </p>
              </div>
              
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-[#1A4338] text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  4
                </div>
                <h3 className="font-bold text-[#1A4338] mb-2">Descarga y Comparte</h3>
                <p className="text-gray-600 text-sm">
                  MP3 de alta calidad instantáneo
                </p>
              </div>
            </div>
          </div>
        </section>
        
        {/* What's Included */}
        <section className="py-16 px-6 bg-[#F9F6F2]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              ¿Qué incluye tu canción?
            </h2>
            
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <div className="text-3xl mb-4">🎤</div>
                <h3 className="font-bold text-[#1A4338] mb-2">Letra Personalizada</h3>
                <p className="text-gray-600 text-sm">
                  Con el nombre del destinatario y detalles que tú proporcionas
                </p>
              </div>
              
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <div className="text-3xl mb-4">🎵</div>
                <h3 className="font-bold text-[#1A4338] mb-2">Música Profesional</h3>
                <p className="text-gray-600 text-sm">
                  Producción de alta calidad en el género que elijas
                </p>
              </div>
              
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <div className="text-3xl mb-4">📱</div>
                <h3 className="font-bold text-[#1A4338] mb-2">Fácil de Compartir</h3>
                <p className="text-gray-600 text-sm">
                  Descarga MP3 instantánea para enviar por WhatsApp, redes o email
                </p>
              </div>
            </div>
          </div>
        </section>
        
        {/* Social Proof */}
        <section className="py-16 px-6 bg-[#1A4338] text-white">
          <div className="max-w-4xl mx-auto text-center">
            <div className="flex items-center justify-center gap-1 mb-4">
              {[...Array(5)].map((_, i) => (
                <span key={i} className="text-2xl">⭐</span>
              ))}
            </div>
            <p className="text-xl mb-2">
              <span className="font-bold">{occasion.reviewCount}+</span> canciones creadas para {occasion.name}
            </p>
            <p className="text-white/70">
              4.9/5 calificación promedio de nuestros clientes
            </p>
            
            {/* Testimonial Preview */}
            <div className="mt-8 max-w-xl mx-auto bg-white/10 rounded-xl p-6">
              <p className="text-white/90 italic mb-4">
                "Mi mamá lloró de la emoción. Nunca pensé que un regalo pudiera significar tanto. La canción mencionaba cosas que solo nosotros sabíamos."
              </p>
              <p className="text-white/60 text-sm">
                — Cliente verificado, {occasion.name}
              </p>
            </div>
          </div>
        </section>
        
        {/* Final CTA */}
        <section className="py-20 px-6 bg-[#F9F6F2]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-[#1A4338] mb-4">
              Haz este {occasion.name} inolvidable
            </h2>
            <p className="text-gray-600 mb-8">
              En solo 5 minutos tendrás una canción única que recordarán para siempre.
            </p>
            
            <button
              onClick={() => handleCreateSong()}
              className="px-10 py-4 rounded-full text-xl font-bold transition-all transform hover:scale-105 shadow-xl"
              style={{ 
                backgroundColor: occasion.color,
                color: 'white'
              }}
            >
              🎤 Crear Mi Canción Ahora
            </button>
            
            <div className="mt-6 flex items-center justify-center gap-6 text-sm text-gray-500">
              <span>✓ Desde $29.99</span>
              <span>✓ Listo en minutos</span>
              <span>✓ Satisfacción garantizada</span>
            </div>
          </div>
        </section>
        
        {/* Related Occasions */}
        <section className="py-16 px-6 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              Otras ocasiones populares
            </h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {relatedOccasions.map(o => (
                <SEOLink
                  key={o.slug}
                  to={`ocasiones/${o.slug}`}
                  className="block p-4 rounded-xl border border-gray-200 hover:border-gray-300 transition-all text-center"
                >
                  <div className="text-2xl mb-2">{o.icon}</div>
                  <div className="font-medium text-[#1A4338] text-sm">{o.name}</div>
                </SEOLink>
              ))}
            </div>

            <div className="text-center mt-6">
              <SEOLink
                to="ocasiones"
                className="text-[#1A4338] font-medium hover:underline"
              >
                Ver todas las ocasiones →
              </SEOLink>
            </div>
          </div>
        </section>
        
        {/* FAQ Section for SEO */}
        <section className="py-16 px-6 bg-[#F9F6F2]">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              Preguntas Frecuentes
            </h2>
            
            <div className="space-y-4">
              <details className="bg-white rounded-xl p-6 group">
                <summary className="font-bold text-[#1A4338] cursor-pointer flex justify-between items-center">
                  ¿Cuánto tiempo tarda en crearse la canción?
                  <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p className="text-gray-600 mt-4">
                  Tu canción estará lista en solo 2-4 minutos. Nuestra IA genera dos versiones únicas para que elijas tu favorita.
                </p>
              </details>
              
              <details className="bg-white rounded-xl p-6 group">
                <summary className="font-bold text-[#1A4338] cursor-pointer flex justify-between items-center">
                  ¿Puedo escuchar la canción antes de pagar?
                  <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p className="text-gray-600 mt-4">
                  Sí, escuchas un preview de 20 segundos de cada versión antes de decidir. Así puedes asegurarte de que te encanta.
                </p>
              </details>
              
              <details className="bg-white rounded-xl p-6 group">
                <summary className="font-bold text-[#1A4338] cursor-pointer flex justify-between items-center">
                  ¿En qué formato recibo la canción?
                  <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p className="text-gray-600 mt-4">
                  Recibes un archivo MP3 de alta calidad que puedes descargar inmediatamente y compartir por WhatsApp, redes sociales o email.
                </p>
              </details>
              
              <details className="bg-white rounded-xl p-6 group">
                <summary className="font-bold text-[#1A4338] cursor-pointer flex justify-between items-center">
                  ¿Qué pasa si no me gusta la canción?
                  <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p className="text-gray-600 mt-4">
                  Ofrecemos dos versiones diferentes para que tengas opciones. Si ninguna te convence, contáctanos y buscaremos una solución.
                </p>
              </details>
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
