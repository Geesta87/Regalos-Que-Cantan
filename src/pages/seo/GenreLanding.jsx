import React, { useContext, useEffect } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateGenreStructuredData, generateBreadcrumbData, generateFAQStructuredData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getGenreBySlug, getAllGenres, getAllOccasions, DEFAULT_GENRE_FAQS, COMBO_ROUTES } from '../../data/seoData';

/**
 * GenreLanding - SEO Landing Page for individual genres
 * Premium dark theme design matching main landing page
 */
export default function GenreLanding({ genreSlug }) {
  const { navigateTo, setFormData } = useContext(AppContext);
  const genre = getGenreBySlug(genreSlug);

  useEffect(() => {
    if (!genre) {
      navigateTo('generos');
    }
  }, [genre, navigateTo]);

  if (!genre) return null;

  const relatedGenres = getAllGenres()
    .filter(g => g.slug !== genreSlug)
    .slice(0, 4);

  const suggestedOccasions = getAllOccasions()
    .filter(o => genre.popularFor?.some(pf => o.name.toLowerCase().includes(pf.toLowerCase())))
    .slice(0, 4);

  const genreCombos = COMBO_ROUTES
    .filter(c => c.genreSlug === genreSlug)
    .map(c => ({ ...c, occasion: getAllOccasions().find(o => o.slug === c.occasionSlug) }))
    .filter(c => c.occasion);

  const handleCreateSong = () => {
    setFormData(prev => ({
      ...prev,
      genre: genre.id,
      genreName: genre.name
    }));
    navigateTo('occasion');
  };

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Géneros', path: '/generos' },
    { name: genre.name, path: `/generos/${genre.slug}` }
  ];

  const faqs = genre.faqs || DEFAULT_GENRE_FAQS;
  const faqSchema = generateFAQStructuredData(faqs);
  const structuredData = [
    generateGenreStructuredData(genre),
    generateBreadcrumbData(breadcrumbs),
    ...(faqSchema ? [faqSchema] : [])
  ];

  return (
    <>
      <SEOHead
        title={genre.title}
        description={genre.metaDescription}
        canonical={`/generos/${genre.slug}`}
        keywords={genre.keywords}
        ogImage={`/images/genres/${genre.slug}.jpg`}
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {/* Hero Section */}
        <section className="relative py-24 px-6 overflow-hidden">
          {/* Radial glow background */}
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: `radial-gradient(ellipse at center top, ${genre.color}40 0%, transparent 70%)` }}
          />

          <div className="relative max-w-4xl mx-auto text-center">
            {/* Breadcrumbs */}
            <nav className="mb-10" aria-label="Breadcrumb">
              <ol className="flex items-center justify-center gap-2 text-sm text-white/50">
                {breadcrumbs.map((item, index) => (
                  <li key={item.path} className="flex items-center gap-2">
                    {index > 0 && <span className="text-white/30">/</span>}
                    {index === breadcrumbs.length - 1 ? (
                      <span className="text-white/80 font-medium">{item.name}</span>
                    ) : (
                      <SEOLink
                        to={item.path === '/' ? 'landing' : item.path.replace('/', '')}
                        className="hover:text-white transition-colors"
                      >
                        {item.name}
                      </SEOLink>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            {/* Glass icon card */}
            <div
              className="w-24 h-24 rounded-2xl flex items-center justify-center text-5xl mx-auto mb-8 glass-morphism"
              style={{ boxShadow: `0 0 40px ${genre.color}30` }}
            >
              {genre.icon}
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-6xl font-bold mb-5 font-display">
              {genre.heroTitle}
            </h1>

            <p className="text-xl text-white/60 mb-10 max-w-2xl mx-auto leading-relaxed">
              {genre.heroSubtitle}
            </p>

            {/* CTA Button */}
            <button
              onClick={handleCreateSong}
              className="px-10 py-4 rounded-full text-lg font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{
                background: 'linear-gradient(135deg, #c9184a, #a01540)',
                color: 'white',
                boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)'
              }}
            >
              🎵 Crear Mi {genre.name} Ahora
            </button>

            {/* Price Badge */}
            <p className="mt-5 text-white/50">
              Desde <span className="font-bold text-white">$29.99</span> • Listo en minutos
            </p>
          </div>
        </section>

        {/* Definition Block — AI-extractable snippet */}
        {genre.definitionBlock && (
          <section className="px-6 -mt-8 mb-8 relative z-10">
            <div className="max-w-3xl mx-auto">
              <div className="glass-morphism rounded-2xl p-6 md:p-8 border border-white/10" style={{ borderLeftWidth: '4px', borderLeftColor: genre.color }}>
                <p className="text-white/80 leading-relaxed text-lg">
                  {genre.definitionBlock}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Description Section */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-8 md:p-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-6 font-display">
                ¿Qué es un {genre.name} Personalizado?
              </h2>
              <div className="text-white/60 leading-relaxed space-y-4">
                {genre.longDescription ? (
                  genre.longDescription.split('\n\n').map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))
                ) : (
                  <p>{genre.description}</p>
                )}
              </div>

              {/* Artists Reference */}
              {genre.artists && genre.artists.length > 0 && (
                <div className="mt-8 pt-6 border-t border-white/10">
                  <h3 className="font-bold text-white/80 mb-4">
                    Estilo inspirado en artistas como:
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {genre.artists.map(artist => (
                      <span
                        key={artist}
                        className="glass-box px-4 py-2 rounded-full text-sm text-white/80"
                      >
                        {artist}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Audio Demo Section (conditional) */}
        {genre.demoAudio && (
          <section className="py-12 px-6">
            <div className="max-w-3xl mx-auto">
              <div className="glass-morphism rounded-2xl p-8 text-center">
                <h2 className="text-xl font-bold mb-2 font-display">🎧 Escucha un Ejemplo</h2>
                <p className="text-white/50 text-sm mb-6">Preview de una canción de {genre.name} personalizada</p>
                <audio
                  controls
                  className="w-full max-w-md mx-auto"
                  preload="none"
                  style={{ filter: 'invert(1) hue-rotate(180deg) brightness(0.8)' }}
                >
                  <source src={genre.demoAudio} type="audio/mpeg" />
                  Tu navegador no soporta audio.
                </audio>
              </div>
            </div>
          </section>
        )}

        {/* Features Section */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
              ¿Qué incluye tu {genre.name}?
            </h2>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">✨</div>
                <h3 className="font-bold text-white mb-2">100% Personalizado</h3>
                <p className="text-white/50 text-sm">
                  Letra única con el nombre de tu ser querido y detalles especiales que tú proporcionas.
                </p>
              </div>

              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">🎵</div>
                <h3 className="font-bold text-white mb-2">2 Versiones</h3>
                <p className="text-white/50 text-sm">
                  Generamos dos versiones únicas para que elijas tu favorita o te quedes con ambas.
                </p>
              </div>

              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">⚡</div>
                <h3 className="font-bold text-white mb-2">Listo en Minutos</h3>
                <p className="text-white/50 text-sm">
                  Tu canción se crea en 2-4 minutos. Descarga instantánea en MP3.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Perfect For Section — cross-linked to occasions */}
        {genre.popularFor && genre.popularFor.length > 0 && (
          <section className="py-20 px-6">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
                Perfecto para estas ocasiones
              </h2>

              <div className="flex flex-wrap justify-center gap-4">
                {suggestedOccasions.length > 0 ? (
                  suggestedOccasions.map(occasion => (
                    <SEOLink
                      key={occasion.slug}
                      to={`ocasiones/${occasion.slug}`}
                      className="glass-box px-6 py-3 rounded-full text-white/80 font-medium hover:text-white transition-all hover:scale-105"
                      style={{ borderColor: `${genre.color}40` }}
                    >
                      {occasion.icon} {occasion.name}
                    </SEOLink>
                  ))
                ) : (
                  genre.popularFor.map(occasion => (
                    <div
                      key={occasion}
                      className="glass-box px-6 py-3 rounded-full text-white/80 font-medium"
                      style={{ borderColor: `${genre.color}40` }}
                    >
                      {occasion}
                    </div>
                  ))
                )}
              </div>

              <div className="text-center mt-6">
                <SEOLink
                  to="ocasiones"
                  className="text-white/50 hover:text-white text-sm transition-colors"
                >
                  Ver todas las ocasiones →
                </SEOLink>
              </div>
            </div>
          </section>
        )}

        {/* Combo Pages — genre + occasion cross-links */}
        {genreCombos.length > 0 && (
          <section className="py-20 px-6">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center font-display">
                {genre.name} para Cada Ocasión
              </h2>
              <p className="text-white/50 text-center mb-10">
                Descubre cómo suena tu {genre.name.toLowerCase()} en cada celebración
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                {genreCombos.map(c => (
                  <SEOLink
                    key={c.occasionSlug}
                    to={`canciones/${c.genreSlug}-${c.occasionSlug}`}
                    className="flex items-center gap-4 glass-morphism rounded-2xl p-5 hover:bg-white/[0.06] transition-all group"
                  >
                    <span className="text-2xl">{c.occasion.icon}</span>
                    <div className="flex-1">
                      <h3 className="font-bold text-white group-hover:text-landing-primary transition-colors">
                        {genre.name} para {c.occasion.name}
                      </h3>
                      <p className="text-sm text-white/40">Canción personalizada desde $29.99</p>
                    </div>
                    <span className="text-white/30 group-hover:text-white/60 transition-all">→</span>
                  </SEOLink>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Social Proof */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-10 text-center">
              <div className="flex items-center justify-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <span key={i} className="text-2xl">⭐</span>
                ))}
              </div>
              <p className="text-2xl mb-2">
                <span className="font-bold">{genre.reviewCount}+</span> canciones de {genre.name} creadas
              </p>
              <p className="text-white/50">
                4.9/5 calificación promedio de nuestros clientes
              </p>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
              Preguntas Frecuentes
            </h2>

            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <details key={index} className="glass-morphism rounded-2xl p-6 group">
                  <summary className="font-bold text-white cursor-pointer flex justify-between items-center">
                    {faq.question}
                    <span className="text-white/40 group-open:rotate-180 transition-transform ml-4 flex-shrink-0">▼</span>
                  </summary>
                  <p className="text-white/60 mt-4 leading-relaxed">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div
            className="absolute inset-0 opacity-20"
            style={{ background: `radial-gradient(ellipse at center, ${genre.color}30 0%, transparent 70%)` }}
          />
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-5 font-display">
              ¿Listo para crear tu {genre.name}?
            </h2>
            <p className="text-white/60 mb-10 text-lg">
              En solo 5 minutos tendrás una canción única que tu ser querido nunca olvidará.
            </p>

            <button
              onClick={handleCreateSong}
              className="px-12 py-5 rounded-full text-xl font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{
                background: 'linear-gradient(135deg, #c9184a, #a01540)',
                color: 'white',
                boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)'
              }}
            >
              🎤 Crear Mi Canción Ahora
            </button>

            <div className="mt-8 flex items-center justify-center gap-6 text-sm text-white/40">
              <span>✓ Sin suscripción</span>
              <span>✓ Pago único</span>
              <span>✓ Descarga inmediata</span>
            </div>
          </div>
        </section>

        {/* Related Genres */}
        <section className="py-20 px-6 border-t border-white/5">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-10 text-center font-display">
              Explora otros géneros
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {relatedGenres.map(g => (
                <SEOLink
                  key={g.slug}
                  to={`generos/${g.slug}`}
                  className="glass-morphism rounded-2xl p-5 text-center genre-card block"
                >
                  <div className="text-3xl mb-3">{g.icon}</div>
                  <div className="font-medium text-white text-sm">{g.name}</div>
                </SEOLink>
              ))}
            </div>

            <div className="text-center mt-8">
              <SEOLink
                to="generos"
                className="text-white/50 hover:text-white font-medium transition-colors"
              >
                Ver los 20+ géneros disponibles →
              </SEOLink>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-10 px-6 border-t border-white/5 text-center">
          <p className="text-white/30 text-sm">© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          <p className="mt-2 text-white/20 text-sm">Canciones personalizadas en géneros latinos para cada ocasión especial.</p>
        </footer>
      </div>
    </>
  );
}
