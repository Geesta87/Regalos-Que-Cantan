import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateOrganizationData, generateBreadcrumbData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';

export default function SobreNosotros() {
  const { navigateTo } = useContext(AppContext);

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Sobre Nosotros', path: '/sobre-nosotros' }
  ];

  const structuredData = [
    generateOrganizationData(),
    generateBreadcrumbData(breadcrumbs)
  ];

  return (
    <>
      <SEOHead
        title="Sobre Nosotros — RegalosQueCantan"
        description="Conoce a RegalosQueCantan: creamos canciones personalizadas para la comunidad latina. Corridos, cumbia, banda, mariachi y 20+ géneros. Nuestra misión es hacer cada celebración inolvidable."
        canonical="/sobre-nosotros"
        keywords="sobre regalos que cantan, quienes somos, canciones personalizadas IA, empresa canciones latinas"
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {/* Hero */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at center top, #0891B240 0%, transparent 70%)' }} />
          <div className="relative max-w-4xl mx-auto text-center">
            <nav className="mb-10" aria-label="Breadcrumb">
              <ol className="flex items-center justify-center gap-2 text-sm text-white/50">
                {breadcrumbs.map((item, index) => (
                  <li key={item.path} className="flex items-center gap-2">
                    {index > 0 && <span className="text-white/30">/</span>}
                    {index === breadcrumbs.length - 1 ? (
                      <span className="text-white/80 font-medium">{item.name}</span>
                    ) : (
                      <SEOLink to="landing" className="hover:text-white transition-colors">{item.name}</SEOLink>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            <h1 className="text-4xl md:text-6xl font-bold mb-5 font-display">
              Sobre Nosotros
            </h1>
            <p className="text-xl text-white/60 max-w-2xl mx-auto leading-relaxed">
              Hacemos que cada celebración latina sea inolvidable con el poder de la música personalizada
            </p>
          </div>
        </section>

        {/* Mission */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-8 md:p-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-6 font-display">
                Nuestra Misión
              </h2>
              <div className="text-white/60 leading-relaxed space-y-4">
                <p>
                  En la cultura latina, la música no es solo entretenimiento — es la forma en que expresamos amor, celebramos logros y honramos a quienes más queremos. Una serenata, un corrido dedicado, una cumbia que pone a bailar a toda la familia.
                </p>
                <p>
                  RegalosQueCantan nació para democratizar ese poder emocional de la música personalizada. Antes, dedicar una canción original requería contratar compositores, músicos y estudios de grabación — un lujo fuera del alcance de la mayoría.
                </p>
                <p>
                  Hoy, gracias a la inteligencia artificial, cualquier persona puede crear una canción profesional, personalizada con nombres y detalles únicos, en minutos y a un precio accesible. No reemplazamos a los músicos — hacemos posible lo que antes era imposible para millones de familias.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Values */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
              Lo Que Nos Define
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="glass-morphism rounded-2xl p-8 text-center genre-card">
                <div className="text-4xl mb-4">🎯</div>
                <h3 className="font-bold text-white text-lg mb-3">100% Latino</h3>
                <p className="text-white/50 text-sm">
                  Más de 20 géneros latinos auténticos: corridos, cumbia, banda, mariachi, bachata, reggaeton y más. Creados para nuestra comunidad.
                </p>
              </div>
              <div className="glass-morphism rounded-2xl p-8 text-center genre-card">
                <div className="text-4xl mb-4">❤️</div>
                <h3 className="font-bold text-white text-lg mb-3">Hecho con Amor</h3>
                <p className="text-white/50 text-sm">
                  Cada canción es creada para un momento especial. Entendemos la emoción detrás de cada regalo porque somos parte de la misma comunidad.
                </p>
              </div>
              <div className="glass-morphism rounded-2xl p-8 text-center genre-card">
                <div className="text-4xl mb-4">⚡</div>
                <h3 className="font-bold text-white text-lg mb-3">Tecnología Accesible</h3>
                <p className="text-white/50 text-sm">
                  IA de última generación a un precio justo. Sin suscripciones, sin sorpresas. Un pago, una canción única para siempre.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="glass-morphism rounded-2xl p-10">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                <div>
                  <div className="text-3xl md:text-4xl font-bold mb-2" style={{ color: '#c9184a' }}>20+</div>
                  <p className="text-white/50 text-sm">Géneros Latinos</p>
                </div>
                <div>
                  <div className="text-3xl md:text-4xl font-bold mb-2" style={{ color: '#c9184a' }}>2,000+</div>
                  <p className="text-white/50 text-sm">Canciones Creadas</p>
                </div>
                <div>
                  <div className="text-3xl md:text-4xl font-bold mb-2" style={{ color: '#c9184a' }}>4.9/5</div>
                  <p className="text-white/50 text-sm">Calificación Promedio</p>
                </div>
                <div>
                  <div className="text-3xl md:text-4xl font-bold mb-2" style={{ color: '#c9184a' }}>2-4 min</div>
                  <p className="text-white/50 text-sm">Tiempo de Entrega</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works link */}
        <section className="py-12 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-white/50 mb-4">¿Quieres saber cómo creamos tu canción?</p>
            <SEOLink
              to="como-funciona"
              className="text-landing-primary hover:text-white font-medium transition-colors text-lg"
            >
              Ver cómo funciona →
            </SEOLink>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(ellipse at center, #c9184a30 0%, transparent 70%)' }} />
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-5 font-display">
              Crea tu primera canción
            </h2>
            <p className="text-white/60 mb-10 text-lg">
              Únete a miles de familias latinas que ya han sorprendido a sus seres queridos.
            </p>
            <button
              onClick={() => navigateTo('genre')}
              className="px-12 py-5 rounded-full text-xl font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white', boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)' }}
            >
              🎤 Crear Mi Canción Ahora
            </button>
            <div className="mt-8 flex items-center justify-center gap-6 text-sm text-white/40">
              <span>✓ Desde $29.99</span>
              <span>✓ Listo en minutos</span>
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
