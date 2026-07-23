import React, { useContext, useEffect } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateBreadcrumbData, generateFAQStructuredData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getAllGenres, getAllOccasions } from '../../data/seoData';

/**
 * CancionesParaRegalarLanding — the canonical home for the head "canciones para
 * regalar" gifting cluster (our single largest non-branded search demand per
 * Search Console: "canciones para regalar", "canción para regalar", "regalar una
 * canción", "regalar canción personalizada", "canciones por encargo", etc.).
 *
 * Deliberately its OWN page rather than an occasion-template entry: the occasion
 * template hardcodes sentence frames ("Haz este {ocasión} inolvidable") that only
 * read correctly for a real occasion noun. A category head-term needs its own copy.
 *
 * Integrity note: NO fabricated aggregateRating / invented review counts here. The
 * only quantitative social proof is the real songs-created figure.
 */
export default function CancionesParaRegalarLanding() {
  const { navigateTo, setFormData } = useContext(AppContext);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const handleCreateSong = (genreSlug = null) => {
    const updates = {};
    if (genreSlug) {
      const genre = getAllGenres().find(g => g.slug === genreSlug);
      if (genre) { updates.genre = genre.id; updates.genreName = genre.name; }
    }
    setFormData(prev => ({ ...prev, ...updates }));
    navigateTo(genreSlug ? 'occasion' : 'occasion');
  };

  const popularGenres = ['corridos-tumbados', 'cumbia', 'norteno', 'banda-sinaloense', 'bachata', 'mariachi']
    .map(slug => getAllGenres().find(g => g.slug === slug))
    .filter(Boolean);

  const topOccasions = getAllOccasions().slice(0, 8);

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Canciones para Regalar', path: '/canciones-para-regalar' }
  ];

  // Answers written to match REAL queries seen in Search Console (e.g. "cuánto
  // cuesta una canción personalizada", "canción personalizada pareja").
  const faqs = [
    { question: '¿Cuánto cuesta una canción personalizada para regalar?', answer: 'Una canción personalizada cuesta $29.99 USD. Es un pago único, sin suscripción, e incluye dos versiones para que elijas tu favorita o te quedes con ambas. Está lista para descargar y regalar en minutos.' },
    { question: '¿A quién le puedo regalar una canción?', answer: 'A quien quieras sorprender: tu pareja, tu mamá o papá, un amigo, tus hijos, tus abuelos. Funciona para aniversarios, cumpleaños, bodas, el Día de las Madres, o simplemente para decir "te quiero" sin ocasión.' },
    { question: '¿Puedo regalar una canción para una pareja o aniversario?', answer: 'Sí. Es uno de los regalos más pedidos. Incluimos los nombres de los dos, cómo se conocieron y los detalles de su historia, en el género que más les guste: bachata, bolero, norteño y más.' },
    { question: '¿Cómo entrego la canción de regalo?', answer: 'Recibes un archivo MP3 de alta calidad al instante. Lo puedes enviar por WhatsApp, ponerlo en una tarjeta con un código QR, reproducirlo en la fiesta, o compartirlo por redes sociales y email.' },
    { question: '¿Cuánto tarda en estar lista?', answer: 'Entre 2 y 4 minutos. Escuchas un preview gratis de cada versión antes de pagar, así te aseguras de que te encanta antes de regalarla.' },
    { question: '¿En qué géneros puedo pedir la canción?', answer: 'En más de 20 géneros de música latina: corridos tumbados, cumbia, norteño, banda, mariachi, bachata, bolero, reggaetón y más. Tú eliges el estilo que mejor va con la persona.' }
  ];

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Canción Personalizada para Regalar",
    "description": "Una canción personalizada hecha para regalar: con el nombre de esa persona y su historia, en más de 20 géneros de música latina. Lista en minutos.",
    "brand": { "@type": "Brand", "name": "RegalosQueCantan" },
    "offers": {
      "@type": "Offer",
      "price": "29.99",
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock",
      "url": "https://regalosquecantan.com/canciones-para-regalar"
    }
    // No aggregateRating on purpose — added only when wired to real reviews.
  };

  const structuredData = [
    productSchema,
    generateBreadcrumbData(breadcrumbs),
    generateFAQStructuredData(faqs)
  ].filter(Boolean);

  return (
    <>
      <SEOHead
        title="Canciones para Regalar: el Regalo Musical Personalizado"
        description="¿Buscas canciones para regalar? Creamos una canción personalizada con el nombre de esa persona y su historia, en corridos, cumbia, bachata y más. Lista en minutos desde $29.99."
        canonical="/canciones-para-regalar"
        keywords="canciones para regalar, canción para regalar, regalar una canción, regalar canción personalizada, canciones personalizadas para regalar, canciones de regalo, canciones por encargo, regalo musical personalizado"
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

        {/* Hero */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at center top, #c9184a40 0%, transparent 70%)' }} />
          <div className="relative max-w-4xl mx-auto text-center">
            <nav className="mb-10" aria-label="Breadcrumb">
              <ol className="flex items-center justify-center gap-2 text-sm text-white/50">
                <li><SEOLink to="landing" className="hover:text-white transition-colors">Inicio</SEOLink></li>
                <li className="text-white/30">/</li>
                <li className="text-white/80 font-medium">Canciones para Regalar</li>
              </ol>
            </nav>

            <h1 className="text-4xl md:text-6xl font-bold mb-5 font-display">
              Canciones para Regalar
            </h1>
            <p className="text-xl text-white/60 mb-6 max-w-2xl mx-auto leading-relaxed">
              El regalo que nadie más va a dar: una canción personalizada, con su nombre y su historia, hecha solo para esa persona.
            </p>

            {/* Definition block — AI-extractable, front-loaded answer */}
            <div className="max-w-2xl mx-auto mb-10">
              <div className="glass-morphism rounded-2xl p-6 border border-white/10 text-left" style={{ borderLeftWidth: '4px', borderLeftColor: '#c9184a' }}>
                <p className="text-white/80 leading-relaxed">
                  Una canción para regalar es una canción personalizada creada exclusivamente para alguien especial:
                  incluye su nombre, tu mensaje y los detalles de su historia, en el género latino que elijas
                  —corridos, cumbia, bachata, mariachi y más—. Está lista en minutos y se entrega en MP3 para
                  compartir por WhatsApp. Desde $29.99 USD, pago único.
                </p>
              </div>
            </div>

            <button
              onClick={() => handleCreateSong()}
              className="px-10 py-4 rounded-full text-lg font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white', boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)' }}
            >
              🎵 Crear una Canción para Regalar
            </button>
            <p className="mt-5 text-white/50">Desde <span className="font-bold text-white">$29.99</span> • Listo en minutos • Preview gratis</p>
          </div>
        </section>

        {/* Why a song is the gift */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-8 md:p-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-6 font-display">¿Por qué regalar una canción?</h2>
              <div className="text-white/60 leading-relaxed space-y-4">
                <p>Los regalos comunes se olvidan. Una canción con el nombre de esa persona, que cuenta su historia y dice lo que sientes, se guarda para siempre y se escucha una y otra vez.</p>
                <p>No hace falta una fecha especial. Puedes regalar una canción para un cumpleaños o un aniversario, para el Día de las Madres o del Padre, para una boda o una quinceañera —o simplemente porque quieres decir "te quiero" de una forma que nadie olvida.</p>
                <p>Tú das los detalles, nosotros la componemos en el género que más le guste. En minutos tienes un regalo único en el mundo, imposible de comprar en cualquier tienda.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Genres */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center font-display">Elige el género para tu regalo</h2>
            <p className="text-white/50 text-center mb-10">Más de 20 géneros de música latina — elige el estilo de esa persona</p>
            <div className="grid md:grid-cols-2 gap-4">
              {popularGenres.map(genre => (
                <SEOLink
                  key={genre.slug}
                  to={`generos/${genre.slug}`}
                  className="flex items-center gap-4 glass-morphism rounded-2xl p-6 hover:bg-white/[0.06] transition-all group"
                >
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 glass-box" style={{ borderColor: `${genre.color}40` }}>{genre.icon}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white group-hover:text-landing-primary transition-colors">{genre.name}</h3>
                    <p className="text-sm text-white/40 line-clamp-2">{genre.description}</p>
                  </div>
                  <span className="text-white/30 group-hover:text-white/60 group-hover:translate-x-1 transition-all flex-shrink-0">→</span>
                </SEOLink>
              ))}
            </div>
            <div className="text-center mt-8">
              <SEOLink to="generos" className="text-white/50 hover:text-white font-medium transition-colors">Ver los 20+ géneros disponibles →</SEOLink>
            </div>
          </div>
        </section>

        {/* Occasions cross-links */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center font-display">¿Para qué ocasión lo vas a regalar?</h2>
            <p className="text-white/50 text-center mb-10">Cada ocasión tiene su canción perfecta</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {topOccasions.map(o => (
                <SEOLink key={o.slug} to={`ocasiones/${o.slug}`} className="glass-morphism rounded-2xl p-5 text-center genre-card block">
                  <div className="text-3xl mb-3">{o.icon}</div>
                  <div className="font-medium text-white text-sm">{o.name}</div>
                </SEOLink>
              ))}
            </div>
            <div className="text-center mt-8">
              <SEOLink to="ocasiones" className="text-white/50 hover:text-white font-medium transition-colors">Ver todas las ocasiones →</SEOLink>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-12 text-center font-display">Cómo regalar una canción en minutos</h2>
            <div className="grid md:grid-cols-4 gap-6">
              {[
                { num: '1', title: 'Elige el Género', desc: 'El estilo que más le guste a esa persona' },
                { num: '2', title: 'Cuenta su Historia', desc: 'Nombre, relación y los detalles que la hacen única' },
                { num: '3', title: 'Se Crea la Canción', desc: '2 versiones únicas, listas en minutos' },
                { num: '4', title: 'Regálala', desc: 'Descarga el MP3 y envíalo por WhatsApp' }
              ].map(step => (
                <div key={step.num} className="text-center">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white' }}>{step.num}</div>
                  <h3 className="font-bold text-white mb-2">{step.title}</h3>
                  <p className="text-white/50 text-sm">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Honest social proof — real songs-created figure, no invented ratings */}
        <section className="py-16 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <div className="glass-morphism rounded-2xl p-10">
              <p className="text-3xl md:text-4xl font-bold mb-2">Más de 40,000 canciones creadas</p>
              <p className="text-white/50">para familias latinas que quisieron regalar algo que se recuerda</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">Preguntas Frecuentes</h2>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <details key={index} className="glass-morphism rounded-2xl p-6 group">
                  <summary className="font-bold text-white cursor-pointer flex justify-between items-center">
                    {faq.question}
                    <span className="text-white/40 group-open:rotate-180 transition-transform ml-4 flex-shrink-0">▼</span>
                  </summary>
                  <p className="text-white/60 mt-4 leading-relaxed">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(ellipse at center, #c9184a30 0%, transparent 70%)' }} />
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-5 font-display">Regala algo que nunca van a olvidar</h2>
            <p className="text-white/60 mb-10 text-lg">En solo unos minutos tienes una canción única, hecha solo para esa persona.</p>
            <button
              onClick={() => handleCreateSong()}
              className="px-12 py-5 rounded-full text-xl font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white', boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)' }}
            >
              🎤 Crear Mi Canción para Regalar
            </button>
            <div className="mt-8 flex items-center justify-center gap-6 text-sm text-white/40">
              <span>✓ Desde $29.99</span>
              <span>✓ Listo en minutos</span>
              <span>✓ Preview gratis</span>
            </div>
          </div>
        </section>

        <footer className="py-10 px-6 border-t border-white/5 text-center">
          <p className="text-white/30 text-sm">© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          <p className="mt-2 text-white/20 text-sm">Canciones personalizadas para regalar en géneros latinos, para cada persona y ocasión.</p>
        </footer>
      </div>
    </>
  );
}
