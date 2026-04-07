import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateBreadcrumbData, generateFAQStructuredData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getGenreBySlug } from '../../data/seoData';

/**
 * DiaDeLasMadresLanding - Seasonal SEO landing page for Mother's Day (May 10, Mexico)
 * Aggressive urgency-driven page with heavy emotional appeal for the Latino market.
 * Standalone route at /dia-de-las-madres for maximum SEO targeting.
 */
export default function DiaDeLasMadresLanding() {
  const { navigateTo, setFormData } = useContext(AppContext);

  const handleCreateSong = (genreSlug = null) => {
    const updates = {
      occasion: 'dia-de-las-madres',
      occasionName: 'Día de las Madres'
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
    { name: 'Día de las Madres', path: '/dia-de-las-madres' }
  ];

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Canción Personalizada para el Día de las Madres",
    "description": "Canción personalizada para mamá con su nombre en mariachi, bolero, ranchera y más géneros latinos.",
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
      "reviewCount": 312
    }
  };

  const faqs = [
    { question: '¿Puedo crear la canción el mismo 10 de Mayo?', answer: 'Sí, tu canción estará lista en 2-4 minutos. Puedes crearla el mismo día y enviarla por WhatsApp al instante.' },
    { question: '¿Qué género es mejor para mamá?', answer: 'Depende de sus gustos. Mariachi y ranchera son los más populares para mamás tradicionales. Bolero para las románticas. Cumbia para las fiesteras. Tú conoces a tu mamá mejor que nadie.' },
    { question: '¿Puedo incluir su apodo cariñoso?', answer: 'Claro que sí. "Mami", "Jefa", "Madre", "Ma" — cualquier nombre cariñoso se incorpora naturalmente en la letra.' },
    { question: '¿Cuánto cuesta la canción para mamá?', answer: 'Una canción individual cuesta $29.99 USD. Sin suscripción, pago único. Recibes 2 versiones para elegir tu favorita.' },
    { question: '¿Cómo se la envío a mamá?', answer: 'Descargas el MP3 al instante y lo envías por WhatsApp, mensaje de texto, email o redes sociales. También puedes reproducirla en una bocina durante la celebración.' },
    { question: '¿La canción menciona el nombre de mamá?', answer: 'Sí, la letra incluye su nombre, apodo, y los detalles personales que tú proporciones. Es una canción 100% única creada solo para ella.' }
  ];

  const structuredData = [
    productSchema,
    generateBreadcrumbData(breadcrumbs),
    generateFAQStructuredData(faqs)
  ].filter(Boolean);

  const mamaGenres = [
    { slug: 'mariachi', pitch: 'El clásico que nunca falla. Trompetas, violines y todo el sentimiento de México para mamá.' },
    { slug: 'bolero', pitch: 'Romántico, elegante, atemporal. Para la mamá que ama las canciones de sentimiento profundo.' },
    { slug: 'ranchera', pitch: 'Con toda el alma mexicana. Para la mamá que se emociona con la música de raíz.' },
    { slug: 'balada', pitch: 'Suave, emotiva, perfecta para dedicar. Para la mamá que ama las letras que llegan al corazón.' },
    { slug: 'norteno', pitch: 'Acordeón y bajo sexto. Para la mamá norteña que lleva la tradición en la sangre.' }
  ].map(item => {
    const genre = getGenreBySlug(item.slug);
    return genre ? { ...genre, pitch: item.pitch } : null;
  }).filter(Boolean);

  const testimonials = [
    {
      text: 'Mi mamá no paraba de llorar. La canción mencionaba su sazón, cómo nos despertaba temprano para la escuela... fue el mejor regalo que le he dado en 30 años.',
      author: 'Carlos M.',
      location: 'Guadalajara, Jalisco',
      genre: 'Mariachi'
    },
    {
      text: 'Se la mandé por WhatsApp a las 7am del 10 de Mayo. Me llamó llorando antes de que terminara la canción. Mis hermanos me preguntan dónde la conseguí.',
      author: 'Ana L.',
      location: 'Monterrey, Nuevo León',
      genre: 'Ranchera'
    },
    {
      text: 'Pensé que no iba a llegar a tiempo con el regalo. Creé la canción en 3 minutos desde mi teléfono y se la puse durante la comida. Toda la familia lloró.',
      author: 'Roberto S.',
      location: 'Ciudad de México',
      genre: 'Bolero'
    }
  ];

  const accentColor = '#EC4899';

  return (
    <>
      <SEOHead
        title="Canción para Mamá este 10 de Mayo | RegalosQueCantan"
        description="Sorprende a mamá con una canción personalizada este Día de las Madres. Con su nombre, en mariachi, bolero o ranchera. Lista en minutos desde $29.99."
        canonical="/dia-de-las-madres"
        keywords="regalo día de las madres, canción para mamá, 10 de mayo, regalo mamá original, serenata mamá, canción personalizada mamá"
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

        {/* Urgency Banner */}
        <div
          className="py-3 px-4 text-center text-sm md:text-base font-bold tracking-wide"
          style={{ background: 'linear-gradient(90deg, #c9184a, #EC4899, #c9184a)', color: 'white' }}
        >
          🔥 El 10 de Mayo se acerca — Crea la canción perfecta para mamá antes de que sea tarde 🔥
        </div>

        {/* Hero Section */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: `radial-gradient(ellipse at center top, ${accentColor}40 0%, transparent 70%)` }}
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

            {/* Icon */}
            <div
              className="w-28 h-28 rounded-2xl flex items-center justify-center text-6xl mx-auto mb-8 glass-morphism"
              style={{ boxShadow: `0 0 60px ${accentColor}40` }}
            >
              👩‍👧
            </div>

            <h1 className="text-4xl md:text-6xl font-bold mb-5 font-display leading-tight">
              Este 10 de Mayo,{' '}
              <span style={{ color: accentColor }}>hazla llorar de emoción</span>
            </h1>

            <p className="text-xl md:text-2xl text-white/60 mb-10 max-w-2xl mx-auto leading-relaxed">
              Regálale a mamá una canción con su nombre, sus memorias y todo tu amor.
              Personalizada. Única. Solo para ella.
            </p>

            <button
              onClick={() => handleCreateSong()}
              className="px-12 py-5 rounded-full text-xl font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{
                background: 'linear-gradient(135deg, #c9184a, #EC4899)',
                color: 'white',
                boxShadow: '0 4px 40px rgba(236, 72, 153, 0.5)'
              }}
            >
              🎵 Crear la Canción para Mamá
            </button>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm text-white/50">
              <span>✅ Lista en 2-4 minutos</span>
              <span>✅ Desde $29.99</span>
              <span>✅ Envía por WhatsApp al instante</span>
            </div>
          </div>
        </section>

        {/* Definition Block */}
        <section className="px-6 -mt-8 mb-8 relative z-10">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-6 md:p-8 border border-white/10" style={{ borderLeftWidth: '4px', borderLeftColor: accentColor }}>
              <p className="text-white/80 leading-relaxed text-lg">
                <strong>Una canción personalizada para el Día de las Madres</strong> es un regalo musical único creado
                con inteligencia artificial que incluye el nombre de tu mamá, memorias familiares y detalles
                personales en la letra. Disponible en mariachi, bolero, ranchera, norteño y más de 20 géneros
                latinos. Se genera en minutos y se entrega como archivo MP3 listo para compartir por WhatsApp o
                reproducir durante la celebración del 10 de Mayo.
              </p>
            </div>
          </div>
        </section>

        {/* Why a Song for Mom */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-8 md:p-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-6 font-display">
                💝 ¿Por Qué una Canción para Mamá?
              </h2>
              <div className="text-white/60 leading-relaxed space-y-4 text-lg">
                <p>
                  Mamá ya tiene perfumes. Ya tiene flores. Ya tiene la taza que dice "Mejor Mamá del Mundo".
                  Este 10 de Mayo, dale algo que <strong className="text-white">nunca ha recibido</strong>:
                  una canción que cuente SU historia.
                </p>
                <p>
                  Imagina su cara cuando escuche su nombre en una canción de mariachi. Cuando la letra
                  mencione cómo te preparaba el lonche para la escuela, cómo te cantaba para dormir,
                  cómo siempre tuvo las palabras perfectas cuando más las necesitabas.
                </p>
                <p>
                  No es una canción genérica. No es una playlist de Spotify. Es <strong className="text-white">SU
                  canción</strong> — la que va a escuchar una y otra vez, la que va a presumir con sus
                  amigas, la que va a guardar como su tesoro más preciado.
                </p>
                <p className="text-white font-semibold" style={{ color: accentColor }}>
                  Porque mamá no merece un regalo cualquiera. Merece algo que la haga sentir lo que
                  siente por ti: un amor que no cabe en palabras... pero sí en una canción.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Genre Recommendations for Mom */}
        {mamaGenres.length > 0 && (
          <section className="py-20 px-6">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center font-display">
                🎶 Géneros Perfectos para Mamá
              </h2>
              <p className="text-white/50 text-center mb-10 max-w-xl mx-auto">
                Los favoritos de miles de hijos e hijas que ya sorprendieron a mamá
              </p>

              <div className="grid md:grid-cols-2 gap-4">
                {mamaGenres.map(genre => (
                  <div
                    key={genre.slug}
                    className="glass-morphism rounded-2xl p-6 hover:bg-white/[0.06] transition-all group genre-card"
                  >
                    <div className="flex items-center gap-4 mb-3">
                      <div
                        className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 glass-box"
                        style={{ borderColor: `${genre.color || accentColor}40` }}
                      >
                        {genre.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-white text-lg">
                          {genre.name}
                        </h3>
                      </div>
                    </div>
                    <p className="text-sm text-white/50 mb-4">
                      {genre.pitch}
                    </p>
                    <button
                      onClick={() => handleCreateSong(genre.slug)}
                      className="w-full py-3 rounded-xl font-bold text-sm transition-all hover:scale-[1.02]"
                      style={{
                        background: `linear-gradient(135deg, ${genre.color || accentColor}90, ${genre.color || accentColor}60)`,
                        color: 'white'
                      }}
                    >
                      🎤 Crear en {genre.name} para Mamá
                    </button>
                  </div>
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

        {/* Personalization Ideas */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-8 md:p-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-8 font-display">
                ✨ Ideas para Personalizar la Canción de Mamá
              </h2>
              <p className="text-white/50 mb-6">
                Mientras más detalles agregues, más especial será la canción. Aquí algunas ideas:
              </p>

              <div className="grid md:grid-cols-2 gap-4">
                {[
                  { icon: '💕', title: 'Su apodo cariñoso', desc: '"Mami", "Jefa", "Gordita", "Ma" — el nombre que solo tú le dices' },
                  { icon: '👧', title: 'Un recuerdo de la infancia', desc: 'Cuando te llevaba a la escuela, te curaba las rodillas raspadas, te leía cuentos' },
                  { icon: '🙏', title: 'Agradece sus sacrificios', desc: 'Las desveladas, los dobles turnos, todo lo que dejó por ti' },
                  { icon: '🍳', title: 'Su comida o tradición especial', desc: 'Sus enchiladas, su mole, el café de los domingos, las posadas en su casa' },
                  { icon: '💪', title: 'Su fortaleza', desc: 'Cómo sacó adelante a la familia, cómo nunca se rindió' },
                  { icon: '🏠', title: 'Lo que significa "hogar"', desc: 'Que donde está ella, está tu hogar. Que su abrazo es tu lugar seguro' }
                ].map((idea, i) => (
                  <div key={i} className="flex gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                    <span className="text-2xl flex-shrink-0">{idea.icon}</span>
                    <div>
                      <h3 className="font-bold text-white text-sm mb-1">{idea.title}</h3>
                      <p className="text-white/40 text-sm">{idea.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center font-display">
              ❤️ Lo Que Dicen Nuestros Clientes
            </h2>
            <p className="text-white/50 text-center mb-10">
              Más de 300 canciones creadas para mamá — 4.9/5 calificación promedio
            </p>

            <div className="grid md:grid-cols-3 gap-6">
              {testimonials.map((t, i) => (
                <div key={i} className="glass-morphism rounded-2xl p-6 genre-card">
                  <div className="flex items-center gap-1 mb-4">
                    {[...Array(5)].map((_, j) => (
                      <span key={j} className="text-lg">⭐</span>
                    ))}
                  </div>
                  <p className="text-white/80 italic mb-4 leading-relaxed text-sm">
                    "{t.text}"
                  </p>
                  <div className="border-t border-white/10 pt-3">
                    <p className="text-white font-semibold text-sm">{t.author}</p>
                    <p className="text-white/40 text-xs">{t.location} — Canción de {t.genre}</p>
                    <p className="text-xs mt-1" style={{ color: accentColor }}>✓ Cliente verificado</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Last Minute Gift */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div
              className="rounded-2xl p-8 md:p-10 text-center border"
              style={{
                background: `linear-gradient(135deg, ${accentColor}15, transparent, ${accentColor}10)`,
                borderColor: `${accentColor}30`
              }}
            >
              <div className="text-5xl mb-6">⚡</div>
              <h2 className="text-2xl md:text-3xl font-bold mb-4 font-display">
                El Regalo de Último Minuto Perfecto
              </h2>
              <p className="text-white/60 leading-relaxed mb-6 max-w-lg mx-auto">
                ¿Se te olvidó? ¿No encontraste nada? ¿Estás lejos de mamá?
                No importa. Tu canción estará lista en <strong className="text-white">2 a 4 minutos</strong>.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { icon: '⏱️', label: 'Lista en minutos' },
                  { icon: '📱', label: 'Envía por WhatsApp' },
                  { icon: '📦', label: 'Sin envío físico' },
                  { icon: '🌎', label: 'Desde cualquier lugar' }
                ].map((item, i) => (
                  <div key={i} className="text-center">
                    <div className="text-3xl mb-2">{item.icon}</div>
                    <p className="text-white/60 text-sm font-medium">{item.label}</p>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleCreateSong()}
                className="px-10 py-4 rounded-full text-lg font-bold transition-all transform hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #c9184a, #EC4899)',
                  color: 'white',
                  boxShadow: '0 4px 30px rgba(236, 72, 153, 0.4)'
                }}
              >
                🎵 Crear Canción Ahora — Lista en Minutos
              </button>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
              Preguntas Frecuentes — Día de las Madres
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

        {/* Cross Links */}
        <section className="py-20 px-6 border-t border-white/5">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-10 text-center font-display">
              Explora Más
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SEOLink
                to="ocasiones/dia-de-las-madres"
                className="glass-morphism rounded-2xl p-5 text-center genre-card block"
              >
                <div className="text-3xl mb-3">👩‍👧</div>
                <div className="font-medium text-white text-sm">Día de las Madres</div>
                <div className="text-white/30 text-xs mt-1">Página de ocasión</div>
              </SEOLink>

              <SEOLink
                to="generos"
                className="glass-morphism rounded-2xl p-5 text-center genre-card block"
              >
                <div className="text-3xl mb-3">🎶</div>
                <div className="font-medium text-white text-sm">Todos los Géneros</div>
                <div className="text-white/30 text-xs mt-1">20+ estilos</div>
              </SEOLink>

              <SEOLink
                to="ocasiones"
                className="glass-morphism rounded-2xl p-5 text-center genre-card block"
              >
                <div className="text-3xl mb-3">🎉</div>
                <div className="font-medium text-white text-sm">Todas las Ocasiones</div>
                <div className="text-white/30 text-xs mt-1">Cumpleaños, bodas y más</div>
              </SEOLink>

              <SEOLink
                to="como-funciona"
                className="glass-morphism rounded-2xl p-5 text-center genre-card block"
              >
                <div className="text-3xl mb-3">❓</div>
                <div className="font-medium text-white text-sm">Cómo Funciona</div>
                <div className="text-white/30 text-xs mt-1">Paso a paso</div>
              </SEOLink>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div
            className="absolute inset-0 opacity-25"
            style={{ background: `radial-gradient(ellipse at center, ${accentColor}40 0%, transparent 70%)` }}
          />
          <div className="relative max-w-2xl mx-auto text-center">
            <div className="text-5xl mb-6">👩‍👧‍👦</div>
            <h2 className="text-3xl md:text-4xl font-bold mb-5 font-display">
              Mamá lo dio todo por ti.
              <br />
              <span style={{ color: accentColor }}>Dale algo que nunca olvidará.</span>
            </h2>
            <p className="text-white/60 mb-10 text-lg max-w-lg mx-auto">
              Una canción con su nombre, tus recuerdos y todo el amor que sientes.
              En el género que ella ama. Lista en minutos.
            </p>

            <button
              onClick={() => handleCreateSong()}
              className="px-14 py-5 rounded-full text-xl font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{
                background: 'linear-gradient(135deg, #c9184a, #EC4899)',
                color: 'white',
                boxShadow: '0 4px 40px rgba(236, 72, 153, 0.5)'
              }}
            >
              🎤 Crear la Canción de Mamá Ahora
            </button>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-white/40">
              <span>✓ Desde $29.99</span>
              <span>✓ 2-4 minutos</span>
              <span>✓ Envía por WhatsApp</span>
              <span>✓ Satisfacción garantizada</span>
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
