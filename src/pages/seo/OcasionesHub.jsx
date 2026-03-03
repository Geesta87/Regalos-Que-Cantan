import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateBreadcrumbData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getAllOccasions, getFeaturedOccasions, getCurrentSeasonalOccasions } from '../../data/seoData';

/**
 * OcasionesHub - SEO Hub page for all occasions
 * Premium dark glass-morphism design
 */
export default function OcasionesHub() {
  const { navigateTo } = useContext(AppContext);
  const allOccasions = getAllOccasions();
  const featuredOccasions = getFeaturedOccasions();
  const seasonalOccasions = getCurrentSeasonalOccasions();

  const breadcrumbData = generateBreadcrumbData([
    { name: 'Inicio', path: '/' },
    { name: 'Ocasiones', path: '/ocasiones' }
  ]);

  const itemListData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Ocasiones para Canciones Personalizadas",
    "description": "Canciones personalizadas para cumpleaños, día de las madres, aniversarios, bodas, quinceañeras y más ocasiones especiales",
    "numberOfItems": allOccasions.length,
    "itemListElement": allOccasions.map((occasion, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": occasion.name,
      "url": `https://regalosquecantan.com/ocasiones/${occasion.slug}`
    }))
  };

  const structuredData = [breadcrumbData, itemListData];

  return (
    <>
      <SEOHead
        title="Ocasiones para Canciones Personalizadas"
        description="Crea canciones personalizadas para cualquier ocasión: cumpleaños, día de las madres, aniversarios, bodas, quinceañeras, graduaciones y más. El regalo más único y emotivo."
        canonical="/ocasiones"
        keywords="regalo cumpleaños, regalo día de las madres, regalo aniversario, regalo boda, regalo quinceañera, canción personalizada, regalo único, regalo original"
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {/* Header */}
        <header className="flex items-center justify-between px-6 md:px-10 py-4 border-b border-white/5 sticky top-0 z-50 bg-landing-bg/80 backdrop-blur-md">
          <SEOLink
            to="landing"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 bg-landing-primary rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">🎵</span>
            </div>
            <h2 className="text-white text-xl font-bold tracking-tight">RegalosQueCantan</h2>
          </SEOLink>
          <div className="flex flex-1 justify-end gap-4 md:gap-8 items-center">
            <nav className="hidden md:flex items-center gap-8">
              <SEOLink to="generos" className="text-white/60 text-sm font-medium hover:text-white transition-colors">
                Géneros
              </SEOLink>
              <SEOLink to="ocasiones" className="text-landing-primary text-sm font-medium">
                Ocasiones
              </SEOLink>
            </nav>
            <SEOLink
              to="landing"
              className="flex items-center justify-center rounded-lg h-10 px-5 glass-morphism text-white text-sm font-bold hover:bg-white/10 transition-all"
            >
              Inicio
            </SEOLink>
          </div>
        </header>

        {/* Seasonal Banner */}
        {seasonalOccasions.length > 0 && (
          <div className="py-4 px-6" style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)' }}>
            <div className="max-w-[1000px] mx-auto text-center">
              <p className="text-white font-bold text-lg">
                🎉 ¡{seasonalOccasions[0].name} se acerca! Crea tu canción ahora
              </p>
              <SEOLink
                to={`ocasiones/${seasonalOccasions[0].slug}`}
                className="inline-block mt-3 px-6 py-2 bg-white/20 text-white rounded-full text-sm font-medium hover:bg-white/30 transition-colors backdrop-blur-sm"
              >
                Ver canciones para {seasonalOccasions[0].name} →
              </SEOLink>
            </div>
          </div>
        )}

        {/* Hero */}
        <section className="relative py-20 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(ellipse at center top, #f20d8040 0%, transparent 70%)' }} />
          <div className="relative max-w-[1000px] mx-auto">
            <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight font-display mb-5">
              Una Canción para<br/>Cada Ocasión
            </h1>
            <p className="text-white/50 text-lg max-w-xl">
              El regalo más único y emotivo para los momentos más importantes de la vida.
            </p>
          </div>
        </section>

        {/* Occasion Grid */}
        <main className="px-4 md:px-6 pb-10">
          <div className="max-w-[1000px] mx-auto">
            <div className="flex items-center gap-2 mb-8 px-2">
              <span className="text-landing-primary text-xl">⭐</span>
              <h2 className="text-white/60 text-xs font-bold uppercase tracking-widest">Todas las Ocasiones</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {allOccasions.map((occasion) => (
                <SEOLink
                  key={occasion.slug}
                  to={`ocasiones/${occasion.slug}`}
                  className="glass-morphism rounded-2xl p-6 text-center genre-card block group"
                >
                  <div className="text-4xl mb-4">{occasion.icon}</div>
                  <h3 className="text-white text-lg font-bold mb-1 group-hover:text-landing-primary transition-colors">{occasion.name}</h3>
                  <p className="text-white/40 text-xs line-clamp-2 mb-3">
                    {occasion.description?.split('.')[0] || 'Ocasión especial'}
                  </p>
                  {occasion.featured && (
                    <span className="inline-flex items-center gap-1 text-landing-primary text-xs font-medium">
                      <span>⭐</span> Popular
                    </span>
                  )}
                </SEOLink>
              ))}
            </div>

            {/* Why a Song Gift */}
            <div className="mt-20">
              <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
                ¿Por Qué Regalar una Canción?
              </h2>

              <div className="grid md:grid-cols-3 gap-6">
                <div className="glass-morphism rounded-2xl p-8 text-center genre-card">
                  <div className="text-4xl mb-4">💎</div>
                  <h3 className="font-bold text-white mb-2">Único e Irrepetible</h3>
                  <p className="text-white/40 text-sm">
                    No existe otra canción igual en el mundo. Es un regalo 100% exclusivo.
                  </p>
                </div>

                <div className="glass-morphism rounded-2xl p-8 text-center genre-card">
                  <div className="text-4xl mb-4">😭</div>
                  <h3 className="font-bold text-white mb-2">Emotivo</h3>
                  <p className="text-white/40 text-sm">
                    Escuchar su nombre en una canción provoca emociones que no olvidarán.
                  </p>
                </div>

                <div className="glass-morphism rounded-2xl p-8 text-center genre-card">
                  <div className="text-4xl mb-4">♾️</div>
                  <h3 className="font-bold text-white mb-2">Para Siempre</h3>
                  <p className="text-white/40 text-sm">
                    A diferencia de flores o chocolates, la canción la pueden escuchar siempre.
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom CTA */}
            <div className="mt-16 mb-10 flex flex-col items-center gap-6">
              <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                <SEOLink
                  to="generos"
                  className="flex items-center justify-center gap-2 rounded-full h-14 px-8 glass-morphism text-white hover:bg-white/10 transition-all text-base font-bold"
                >
                  🎵 Explorar por Género
                </SEOLink>
                <SEOLink
                  to="genre"
                  className="flex items-center justify-center gap-2 rounded-full h-14 px-8 text-white text-base font-bold animate-pulse-glow"
                  style={{
                    background: 'linear-gradient(135deg, #c9184a, #a01540)',
                    boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)'
                  }}
                >
                  Crear Mi Canción →
                </SEOLink>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 py-12 px-6 md:px-10">
          <div className="max-w-[1000px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="text-3xl">🎵</span>
                <span className="font-bold text-lg text-white">RegalosQueCantan</span>
              </div>
              <p className="text-sm text-white/30">Canciones personalizadas con inteligencia artificial para los momentos más especiales.</p>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="font-bold text-white/50 uppercase text-xs tracking-widest">Navegación</h4>
              <div className="flex flex-col gap-2 text-sm text-white/40">
                <SEOLink to="landing" className="hover:text-white transition-colors text-left">Inicio</SEOLink>
                <SEOLink to="generos" className="hover:text-white transition-colors text-left">Géneros</SEOLink>
                <SEOLink to="ocasiones" className="hover:text-white transition-colors text-left">Ocasiones</SEOLink>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="font-bold text-white/50 uppercase text-xs tracking-widest">Soporte</h4>
              <div className="flex flex-col gap-2 text-sm text-white/40">
                <a href="mailto:hola@regalosquecantan.com" className="hover:text-white transition-colors">Contáctanos</a>
              </div>
            </div>
          </div>
          <div className="max-w-[1000px] mx-auto mt-12 pt-8 border-t border-white/5 text-center text-xs text-white/20">
            <p>© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          </div>
        </footer>
      </div>
    </>
  );
}
