import React, { useContext, useEffect } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateOccasionStructuredData, generateBreadcrumbData, generateFAQStructuredData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getOccasionBySlug, getAllOccasions, getGenreBySlug, DEFAULT_OCCASION_FAQS } from '../../data/seoData';

/**
 * OccasionLanding - SEO Landing Page for individual occasions
 * Premium dark theme design matching main landing page
 */
export default function OccasionLanding({ occasionSlug }) {
  const { navigateTo, setFormData } = useContext(AppContext);
  const occasion = getOccasionBySlug(occasionSlug);

  useEffect(() => {
    if (!occasion) {
      navigateTo('ocasiones');
    }
  }, [occasion, navigateTo]);

  if (!occasion) return null;

  const relatedOccasions = getAllOccasions()
    .filter(o => o.slug !== occasionSlug)
    .slice(0, 4);

  const suggestedGenres = (occasion.suggestedGenres || [])
    .map(slug => getGenreBySlug(slug))
    .filter(Boolean);

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

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Ocasiones', path: '/ocasiones' },
    { name: occasion.name, path: `/ocasiones/${occasion.slug}` }
  ];

  const faqs = occasion.faqs || DEFAULT_OCCASION_FAQS;
  const faqSchema = generateFAQStructuredData(faqs);
  const structuredData = [
    generateOccasionStructuredData(occasion),
    generateBreadcrumbData(breadcrumbs),
    ...(faqSchema ? [faqSchema] : [])
  ];

  return (
    <>
      <SEOHead
        title={occasion.title}
        description={occasion.metaDescription}
        canonical={`/ocasiones/${occasion.slug}`}
        keywords={occasion.keywords}
        ogImage={`/images/occasions/${occasion.slug}.jpg`}
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {/* Hero Section */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: `radial-gradient(ellipse at center top, ${occasion.color}40 0%, transparent 70%)` }}
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
              style={{ boxShadow: `0 0 40px ${occasion.color}30` }}
            >
              {occasion.icon}
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-6xl font-bold mb-5 font-display">
              {occasion.heroTitle}
            </h1>

            <p className="text-xl text-white/60 mb-10 max-w-2xl mx-auto leading-relaxed">
              {occasion.heroSubtitle}
            </p>

            {/* CTA Button */}
            <button
              onClick={() => handleCreateSong()}
              className="px-10 py-4 rounded-full text-lg font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{
                background: 'linear-gradient(135deg, #c9184a, #a01540)',
                color: 'white',
                boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)'
              }}
            >
              🎵 Crear Canción para {occasion.name}
            </button>

            <p className="mt-5 text-white/50">
              Desde <span className="font-bold text-white">$24.99</span> • Listo en minutos
            </p>
          </div>
        </section>

        {/* Definition Block — AI-extractable snippet */}
        {occasion.definitionBlock && (
          <section className="px-6 -mt-8 mb-8 relative z-10">
            <div className="max-w-3xl mx-auto">
              <div className="glass-morphism rounded-2xl p-6 md:p-8 border border-white/10" style={{ borderLeftWidth: '4px', borderLeftColor: occasion.color }}>
                <p className="text-white/80 leading-relaxed text-lg">
                  {occasion.definitionBlock}
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
                El Regalo Perfecto para {occasion.name}
              </h2>
              <div className="text-white/60 leading-relaxed space-y-4">
                {occasion.longDescription ? (
                  occasion.longDescription.split('\n\n').map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))
                ) : (
                  <p>{occasion.description}</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Suggested Genres Section */}
        {suggestedGenres.length > 0 && (
          <section className="py-20 px-6">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center font-display">
                Géneros Recomendados para {occasion.name}
              </h2>
              <p className="text-white/50 text-center mb-10">
                Elige el estilo musical perfecto para tu regalo
              </p>

              <div className="grid md:grid-cols-2 gap-4">
                {suggestedGenres.map(genre => (
                  <SEOLink
                    key={genre.slug}
                    to={`generos/${genre.slug}`}
                    onClick={(e) => {
                      e.preventDefault();
                      handleCreateSong(genre.slug);
                    }}
                    className="flex items-center gap-4 glass-morphism rounded-2xl p-6 hover:bg-white/[0.06] transition-all group"
                  >
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 glass-box"
                      style={{ borderColor: `${genre.color}40` }}
                    >
                      {genre.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white group-hover:text-landing-primary transition-colors">
                        {genre.name}
                      </h3>
                      <p className="text-sm text-white/40 line-clamp-2">
                        {genre.description}
                      </p>
                    </div>
                    <span className="text-white/30 group-hover:text-white/60 group-hover:translate-x-1 transition-all flex-shrink-0">
                      →
                    </span>
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
        )}

        {/* How It Works Section */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-12 text-center font-display">
              ¿Cómo Funciona?
            </h2>

            <div className="grid md:grid-cols-4 gap-6">
              {[
                { num: '1', title: 'Elige el Género', desc: 'Corridos, cumbia, banda, bachata y más' },
                { num: '2', title: 'Agrega los Detalles', desc: 'Nombre, relación, memorias especiales' },
                { num: '3', title: 'IA Crea la Canción', desc: '2 versiones únicas en minutos' },
                { num: '4', title: 'Descarga y Comparte', desc: 'MP3 de alta calidad instantáneo' }
              ].map(step => (
                <div key={step.num} className="text-center">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4"
                    style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white' }}
                  >
                    {step.num}
                  </div>
                  <h3 className="font-bold text-white mb-2">{step.title}</h3>
                  <p className="text-white/50 text-sm">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What's Included */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
              ¿Qué incluye tu canción?
            </h2>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">🎤</div>
                <h3 className="font-bold text-white mb-2">Letra Personalizada</h3>
                <p className="text-white/50 text-sm">
                  Con el nombre del destinatario y detalles que tú proporcionas
                </p>
              </div>

              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">🎵</div>
                <h3 className="font-bold text-white mb-2">Música Profesional</h3>
                <p className="text-white/50 text-sm">
                  Producción de alta calidad en el género que elijas
                </p>
              </div>

              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">📱</div>
                <h3 className="font-bold text-white mb-2">Fácil de Compartir</h3>
                <p className="text-white/50 text-sm">
                  Descarga MP3 instantánea para enviar por WhatsApp, redes o email
                </p>
              </div>
            </div>
          </div>
        </section>

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
                <span className="font-bold">{occasion.reviewCount}+</span> canciones creadas para {occasion.name}
              </p>
              <p className="text-white/50 mb-8">
                4.9/5 calificación promedio de nuestros clientes
              </p>

              {/* Testimonial */}
              <div className="glass-box rounded-xl p-6 max-w-xl mx-auto">
                <p className="text-white/80 italic mb-4">
                  "Mi mamá lloró de la emoción. Nunca pensé que un regalo pudiera significar tanto. La canción mencionaba cosas que solo nosotros sabíamos."
                </p>
                <p className="text-white/40 text-sm">
                  — Cliente verificado, {occasion.name}
                </p>
              </div>
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

        {/* Final CTA */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div
            className="absolute inset-0 opacity-20"
            style={{ background: `radial-gradient(ellipse at center, ${occasion.color}30 0%, transparent 70%)` }}
          />
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-5 font-display">
              Haz este {occasion.name} inolvidable
            </h2>
            <p className="text-white/60 mb-10 text-lg">
              En solo 5 minutos tendrás una canción única que recordarán para siempre.
            </p>

            <button
              onClick={() => handleCreateSong()}
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
              <span>✓ Desde $24.99</span>
              <span>✓ Listo en minutos</span>
              <span>✓ Satisfacción garantizada</span>
            </div>
          </div>
        </section>

        {/* Related Occasions */}
        <section className="py-20 px-6 border-t border-white/5">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-10 text-center font-display">
              Otras ocasiones populares
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {relatedOccasions.map(o => (
                <SEOLink
                  key={o.slug}
                  to={`ocasiones/${o.slug}`}
                  className="glass-morphism rounded-2xl p-5 text-center genre-card block"
                >
                  <div className="text-3xl mb-3">{o.icon}</div>
                  <div className="font-medium text-white text-sm">{o.name}</div>
                </SEOLink>
              ))}
            </div>

            <div className="text-center mt-8">
              <SEOLink
                to="ocasiones"
                className="text-white/50 hover:text-white font-medium transition-colors"
              >
                Ver todas las ocasiones →
              </SEOLink>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-10 px-6 border-t border-white/5 text-center">
          <p className="text-white/30 text-sm">© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          <p className="mt-2 text-white/20 text-sm">Canciones personalizadas con inteligencia artificial.</p>
        </footer>
      </div>
    </>
  );
}
