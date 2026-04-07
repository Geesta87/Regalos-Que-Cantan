import React, { useContext, useEffect } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateBreadcrumbData, generateFAQStructuredData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getGenreBySlug, getOccasionBySlug, getAllGenres, getAllOccasions, DEFAULT_GENRE_FAQS, DEFAULT_OCCASION_FAQS } from '../../data/seoData';

/**
 * ComboLanding - SEO Landing Page for genre+occasion combinations
 * Targets long-tail keywords like "Corridos Tumbados para Cumpleanos",
 * "Mariachi para Dia de las Madres", "Bachata de Aniversario", etc.
 */
export default function ComboLanding({ genreSlug, occasionSlug }) {
  const { navigateTo, setFormData } = useContext(AppContext);
  const genre = getGenreBySlug(genreSlug);
  const occasion = getOccasionBySlug(occasionSlug);

  useEffect(() => {
    if (!genre || !occasion) {
      navigateTo('generos');
    }
  }, [genre, occasion, navigateTo]);

  if (!genre || !occasion) return null;

  // Related combos: same genre with other occasions
  const sameGenreCombos = getAllOccasions()
    .filter(o => o.slug !== occasionSlug)
    .slice(0, 4);

  // Related combos: same occasion with other genres
  const sameOccasionCombos = getAllGenres()
    .filter(g => g.slug !== genreSlug)
    .slice(0, 4);

  const handleCreateSong = () => {
    setFormData(prev => ({
      ...prev,
      genre: genre.id,
      genreName: genre.name,
      occasion: occasion.id,
      occasionName: occasion.name
    }));
    navigateTo('names');
  };

  // SEO metadata
  const comboTitle = `${genre.name} para ${occasion.name}`;
  const pageTitle = `${comboTitle} — Cancion Personalizada | RegalosQueCantan`;
  const pageDescription = `Crea una cancion de ${genre.name.toLowerCase()} personalizada para ${occasion.name.toLowerCase()}. ${genre.description} El regalo perfecto para ${occasion.name.toLowerCase()} desde $29.99.`;
  const pageKeywords = [
    ...(genre.keywords ? genre.keywords.split(', ') : []),
    ...(occasion.keywords ? occasion.keywords.split(', ') : []),
    `${genre.name.toLowerCase()} para ${occasion.name.toLowerCase()}`,
    `cancion de ${genre.name.toLowerCase()} ${occasion.name.toLowerCase()}`,
    `regalo ${occasion.name.toLowerCase()} ${genre.name.toLowerCase()}`
  ].join(', ');

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Generos', path: '/generos' },
    { name: genre.name, path: `/generos/${genre.slug}` },
    { name: occasion.name, path: `/canciones/${genre.slug}-${occasion.slug}` }
  ];

  // Definition block text
  const definitionText = `Un ${genre.name.toLowerCase()} de ${occasion.name.toLowerCase()} personalizado es una cancion original en el estilo de ${genre.name.toLowerCase()}, creada exclusivamente para celebrar ${occasion.name.toLowerCase()}. ${genre.artists && genre.artists.length > 0 ? `Con el estilo de artistas como ${genre.artists.slice(0, 3).join(', ')}, ` : ''}esta cancion incluye el nombre de tu ser querido y detalles especiales que tu proporcionas. Lista en minutos desde $29.99.`;

  // Why this combo works
  const whyComboWorks = [
    `${genre.name} es uno de los generos mas populares del momento, y combinado con la emocion de ${occasion.name.toLowerCase()} crea un regalo verdaderamente unico e inolvidable.`,
    genre.artists && genre.artists.length > 0
      ? `Con un sonido inspirado en artistas como ${genre.artists.slice(0, 3).join(', ')}, tu cancion personalizada capturara la esencia del genero mientras celebra este momento especial.`
      : `Tu cancion personalizada capturara la esencia del genero mientras celebra este momento especial.`,
    `La combinacion de una letra personalizada con la energia de ${genre.name.toLowerCase()} hace que este regalo sea mucho mas significativo que cualquier otro obsequio tradicional para ${occasion.name.toLowerCase()}.`
  ];

  // Build FAQs: mix genre + occasion FAQs, plus one combo-specific
  const genreFaqs = genre.faqs || DEFAULT_GENRE_FAQS;
  const occasionFaqs = occasion.faqs || DEFAULT_OCCASION_FAQS;
  const comboSpecificFaq = {
    question: `¿Puedo pedir un ${genre.name.toLowerCase()} especificamente para ${occasion.name.toLowerCase()}?`,
    answer: `Si, al crear tu cancion puedes seleccionar ${genre.name} como genero y ${occasion.name} como ocasion. La letra se personalizara automaticamente para incluir referencias a ${occasion.name.toLowerCase()} junto con el nombre y detalles de tu ser querido, todo en el estilo musical de ${genre.name.toLowerCase()}.`
  };

  // Take first 2 from each set to avoid overwhelming the page, plus the combo FAQ
  const faqs = [
    comboSpecificFaq,
    ...genreFaqs.slice(0, 2),
    ...occasionFaqs.slice(0, 2)
  ];

  // Structured data
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `${genre.name} para ${occasion.name} Personalizado`,
    "description": `Cancion de ${genre.name.toLowerCase()} personalizada para ${occasion.name.toLowerCase()}. ${genre.description}`,
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
      "reviewCount": genre.reviewCount || 50
    }
  };

  const faqSchema = generateFAQStructuredData(faqs);
  const structuredData = [
    productSchema,
    generateBreadcrumbData(breadcrumbs),
    ...(faqSchema ? [faqSchema] : [])
  ];

  return (
    <>
      <SEOHead
        title={pageTitle}
        description={pageDescription}
        canonical={`/canciones/${genre.slug}-${occasion.slug}`}
        keywords={pageKeywords}
        ogImage={`/images/genres/${genre.slug}.jpg`}
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

        {/* Hero Section */}
        <section className="relative py-24 px-6 overflow-hidden">
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
              {comboTitle}
            </h1>

            <p className="text-xl text-white/60 mb-10 max-w-2xl mx-auto leading-relaxed">
              Sorprende con una cancion de {genre.name.toLowerCase()} completamente personalizada para celebrar {occasion.name.toLowerCase()}. Un regalo unico que recordaran para siempre.
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
              Crear Mi {genre.name} para {occasion.name}
            </button>

            {/* Price Badge */}
            <p className="mt-5 text-white/50">
              Desde <span className="font-bold text-white">$29.99</span> - Listo en minutos
            </p>
          </div>
        </section>

        {/* Definition Block -- AI-extractable snippet */}
        <section className="px-6 -mt-8 mb-8 relative z-10">
          <div className="max-w-3xl mx-auto">
            <div
              className="glass-morphism rounded-2xl p-6 md:p-8 border border-white/10"
              style={{ borderLeftWidth: '4px', borderLeftColor: genre.color }}
            >
              <p className="text-white/80 leading-relaxed text-lg">
                {definitionText}
              </p>
            </div>
          </div>
        </section>

        {/* Why this combo works */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-8 md:p-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-6 font-display">
                ¿Por que elegir {genre.name} para {occasion.name}?
              </h2>
              <div className="text-white/60 leading-relaxed space-y-4">
                {whyComboWorks.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
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

        {/* What's Included */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
              ¿Que incluye tu cancion?
            </h2>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">&#x1F3A4;</div>
                <h3 className="font-bold text-white mb-2">Letra Personalizada</h3>
                <p className="text-white/50 text-sm">
                  Con el nombre del destinatario y detalles especiales para {occasion.name.toLowerCase()}
                </p>
              </div>

              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">&#x1F3B5;</div>
                <h3 className="font-bold text-white mb-2">Musica Profesional</h3>
                <p className="text-white/50 text-sm">
                  Produccion de alta calidad en el estilo autentico de {genre.name}
                </p>
              </div>

              <div className="glass-morphism rounded-2xl p-6 text-center genre-card">
                <div className="text-4xl mb-4">&#x1F4F1;</div>
                <h3 className="font-bold text-white mb-2">Facil de Compartir</h3>
                <p className="text-white/50 text-sm">
                  Descarga MP3 instantanea para enviar por WhatsApp, redes o email
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-12 text-center font-display">
              ¿Como Funciona?
            </h2>

            <div className="grid md:grid-cols-4 gap-6">
              {[
                { num: '1', title: 'Elige el Genero', desc: `Ya tienes ${genre.name} seleccionado` },
                { num: '2', title: 'Agrega los Detalles', desc: 'Nombre, relacion, memorias especiales' },
                { num: '3', title: 'Se Crea tu Cancion', desc: '2 versiones unicas en minutos' },
                { num: '4', title: 'Descarga y Comparte', desc: 'MP3 de alta calidad instantaneo' }
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

        {/* Social Proof */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-10 text-center">
              <div className="flex items-center justify-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <span key={i} className="text-2xl">&#x2B50;</span>
                ))}
              </div>
              <p className="text-2xl mb-2">
                <span className="font-bold">{genre.reviewCount || 50}+</span> canciones de {genre.name} creadas
              </p>
              <p className="text-white/50 mb-8">
                4.9/5 calificacion promedio de nuestros clientes
              </p>

              {/* Testimonial */}
              <div className="glass-box rounded-xl p-6 max-w-xl mx-auto">
                <p className="text-white/80 italic mb-4">
                  "Le regalamos una cancion de {genre.name.toLowerCase()} para {occasion.name.toLowerCase()} y fue el mejor regalo que pudimos dar. Lloro de la emocion al escuchar su nombre en la cancion."
                </p>
                <p className="text-white/40 text-sm">
                  — Cliente verificado, {genre.name} para {occasion.name}
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
                    <span className="text-white/40 group-open:rotate-180 transition-transform ml-4 flex-shrink-0">&#x25BC;</span>
                  </summary>
                  <p className="text-white/60 mt-4 leading-relaxed">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Cross-links */}
        <section className="py-20 px-6 border-t border-white/5">
          <div className="max-w-4xl mx-auto">
            {/* Links to individual pages */}
            <div className="flex flex-wrap justify-center gap-4 mb-12">
              <SEOLink
                to={`generos/${genre.slug}`}
                className="glass-box px-6 py-3 rounded-full text-white/80 font-medium hover:text-white transition-all hover:scale-105"
                style={{ borderColor: `${genre.color}40` }}
              >
                {genre.icon} Mas canciones de {genre.name}
              </SEOLink>
              <SEOLink
                to={`ocasiones/${occasion.slug}`}
                className="glass-box px-6 py-3 rounded-full text-white/80 font-medium hover:text-white transition-all hover:scale-105"
                style={{ borderColor: `${occasion.color || genre.color}40` }}
              >
                {occasion.icon} Mas canciones para {occasion.name}
              </SEOLink>
            </div>

            {/* Same genre, other occasions */}
            <h3 className="text-xl font-bold mb-6 text-center font-display">
              {genre.name} para otras ocasiones
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
              {sameGenreCombos.map(o => (
                <SEOLink
                  key={o.slug}
                  to={`canciones/${genre.slug}-${o.slug}`}
                  className="glass-morphism rounded-2xl p-5 text-center genre-card block"
                >
                  <div className="text-3xl mb-3">{o.icon}</div>
                  <div className="font-medium text-white text-sm">{genre.name} para {o.name}</div>
                </SEOLink>
              ))}
            </div>

            {/* Same occasion, other genres */}
            <h3 className="text-xl font-bold mb-6 text-center font-display">
              Otros generos para {occasion.name}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {sameOccasionCombos.map(g => (
                <SEOLink
                  key={g.slug}
                  to={`canciones/${g.slug}-${occasion.slug}`}
                  className="glass-morphism rounded-2xl p-5 text-center genre-card block"
                >
                  <div className="text-3xl mb-3">{g.icon}</div>
                  <div className="font-medium text-white text-sm">{g.name} para {occasion.name}</div>
                </SEOLink>
              ))}
            </div>

            <div className="text-center mt-8 flex justify-center gap-6">
              <SEOLink
                to="generos"
                className="text-white/50 hover:text-white font-medium transition-colors"
              >
                Ver todos los generos
              </SEOLink>
              <SEOLink
                to="ocasiones"
                className="text-white/50 hover:text-white font-medium transition-colors"
              >
                Ver todas las ocasiones
              </SEOLink>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div
            className="absolute inset-0 opacity-20"
            style={{ background: `radial-gradient(ellipse at center, ${genre.color}30 0%, transparent 70%)` }}
          />
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-5 font-display">
              Haz este {occasion.name} inolvidable con {genre.name}
            </h2>
            <p className="text-white/60 mb-10 text-lg">
              En solo 5 minutos tendras una cancion de {genre.name.toLowerCase()} unica y personalizada para {occasion.name.toLowerCase()}. Un regalo que recordaran para siempre.
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
              Crear Mi Cancion Ahora
            </button>

            <div className="mt-8 flex items-center justify-center gap-6 text-sm text-white/40">
              <span>Sin suscripcion</span>
              <span>Pago unico</span>
              <span>Descarga inmediata</span>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-10 px-6 border-t border-white/5 text-center">
          <p className="text-white/30 text-sm">&copy; {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          <p className="mt-2 text-white/20 text-sm">Canciones personalizadas en generos latinos para cada ocasion especial.</p>
        </footer>
      </div>
    </>
  );
}
