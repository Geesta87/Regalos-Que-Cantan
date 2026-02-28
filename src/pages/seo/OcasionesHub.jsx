import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateBreadcrumbData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getAllOccasions, getFeaturedOccasions, getCurrentSeasonalOccasions } from '../../data/seoData';

/**
 * OcasionesHub - SEO Hub page for all occasions
 * Talavera UI Design
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

  // Occasion images mapping
  const occasionImages = {
    'cumpleanos': 'https://images.unsplash.com/photo-1464349153735-7db50ed83c84?w=400&h=300&fit=crop',
    'dia-de-las-madres': 'https://images.unsplash.com/photo-1462275646964-a0e3571f4f9f?w=400&h=300&fit=crop',
    'dia-del-padre': 'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?w=400&h=300&fit=crop',
    'aniversario': 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=400&h=300&fit=crop',
    'boda': 'https://images.unsplash.com/photo-1519741497674-611481863552?w=400&h=300&fit=crop',
    'quinceanera': 'https://images.unsplash.com/photo-1519340241574-2cec6aef0c01?w=400&h=300&fit=crop',
    'graduacion': 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=400&h=300&fit=crop',
    'san-valentin': 'https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=400&h=300&fit=crop',
    'navidad': 'https://images.unsplash.com/photo-1512389142860-9c449e58a814?w=400&h=300&fit=crop',
    'declaracion-amor': 'https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=400&h=300&fit=crop',
    'despedida': 'https://images.unsplash.com/photo-1436891620584-47fd0e565afb?w=400&h=300&fit=crop',
    'agradecimiento': 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=400&h=300&fit=crop',
  };

  const getOccasionImage = (slug) => {
    return occasionImages[slug] || 'https://images.unsplash.com/photo-1464349153735-7db50ed83c84?w=400&h=300&fit=crop';
  };

  return (
    <>
      <SEOHead
        title="Ocasiones para Canciones Personalizadas"
        description="Crea canciones personalizadas para cualquier ocasión: cumpleaños, día de las madres, aniversarios, bodas, quinceañeras, graduaciones y más. El regalo más único y emotivo."
        canonical="/ocasiones"
        keywords="regalo cumpleaños, regalo día de las madres, regalo aniversario, regalo boda, regalo quinceañera, canción personalizada, regalo único, regalo original"
        structuredData={structuredData}
      />

      {/* Talavera Pattern Styles */}
      <style>{`
        .talavera-pattern-bg {
          background-color: #ffffff;
          background-image: linear-gradient(30deg, #181114 12%, transparent 12.5%, transparent 87%, #181114 87.5%, #181114), 
                            linear-gradient(150deg, #181114 12%, transparent 12.5%, transparent 87%, #181114 87.5%, #181114), 
                            linear-gradient(30deg, #181114 12%, transparent 12.5%, transparent 87%, #181114 87.5%, #181114), 
                            linear-gradient(150deg, #181114 12%, transparent 12.5%, transparent 87%, #181114 87.5%, #181114), 
                            linear-gradient(60deg, #18111477 25%, transparent 25.5%, transparent 75%, #18111477 75%, #18111477), 
                            linear-gradient(60deg, #18111477 25%, transparent 25.5%, transparent 75%, #18111477 75%, #18111477);
          background-size: 20px 35px;
          background-position: 0 0, 0 0, 10px 18px, 10px 18px, 0 0, 10px 18px;
        }
      `}</style>

      <div className="min-h-screen bg-[#F9F6F2] font-['Inter',sans-serif] text-[#111318]">
        {/* Top Navigation Bar */}
        <header className="flex items-center justify-between whitespace-nowrap border-b border-solid border-[#f0f1f5] px-6 md:px-10 py-4 bg-white/80 backdrop-blur-md sticky top-0 z-50">
          <SEOLink
            to="landing"
            className="flex items-center gap-3 text-[#181114] hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 bg-[#181114] rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">🎵</span>
            </div>
            <h2 className="text-[#111318] text-xl font-bold leading-tight tracking-[-0.015em]">RegalosQueCantan</h2>
          </SEOLink>
          <div className="flex flex-1 justify-end gap-4 md:gap-8 items-center">
            <nav className="hidden md:flex items-center gap-9">
              <SEOLink
                to="generos"
                className="text-[#111318] text-sm font-medium hover:text-[#181114] transition-colors"
              >
                Géneros
              </SEOLink>
              <SEOLink
                to="ocasiones"
                className="text-[#181114] text-sm font-medium hover:text-[#f20d80] transition-colors"
              >
                Ocasiones
              </SEOLink>
            </nav>
            <SEOLink
              to="landing"
              className="flex min-w-[84px] cursor-pointer items-center justify-center rounded-lg h-10 px-5 bg-[#181114]/10 text-[#181114] hover:bg-[#181114] hover:text-white transition-all text-sm font-bold border border-[#181114]/20"
            >
              <span className="truncate">Inicio</span>
            </SEOLink>
          </div>
        </header>

        {/* Seasonal Banner (if applicable) */}
        {seasonalOccasions.length > 0 && (
          <div className="py-4 px-6 bg-gradient-to-r from-[#f20d80] to-[#f74da6]">
            <div className="max-w-[1000px] mx-auto text-center">
              <p className="text-[#181114] font-bold text-lg">
                🎉 ¡{seasonalOccasions[0].name} se acerca! Crea tu canción ahora
              </p>
              <SEOLink
                to={`ocasiones/${seasonalOccasions[0].slug}`}
                className="inline-block mt-3 px-6 py-2 bg-[#181114] text-white rounded-full text-sm font-medium hover:bg-[#2a1f24] transition-colors"
              >
                Ver canciones para {seasonalOccasions[0].name} →
              </SEOLink>
            </div>
          </div>
        )}

        <main className="flex flex-1 justify-center py-10 px-4 md:px-6">
          <div className="flex flex-col max-w-[1000px] flex-1">
            {/* Page Heading */}
            <div className="flex flex-wrap justify-between gap-3 p-4 mb-6">
              <div className="flex min-w-72 flex-col gap-3">
                <h1 className="text-[#181114] text-4xl md:text-5xl font-black leading-tight tracking-[-0.033em]">
                  Una Canción para<br/>Cada Ocasión
                </h1>
                <p className="text-[#606e8a] text-lg font-normal max-w-xl">
                  El regalo más único y emotivo para los momentos más importantes de la vida.
                </p>
              </div>
            </div>

            {/* Featured Occasions Section */}
            <div className="px-4 mb-4">
              <div className="flex items-center gap-2 mb-6">
                <span className="text-[#f20d80] text-xl">⭐</span>
                <h2 className="text-[#181114] text-xs font-bold uppercase tracking-widest">Ocasiones Más Populares</h2>
              </div>
            </div>

            {/* Occasion Grid with Talavera Accents */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 p-4">
              {allOccasions.map((occasion) => (
                <SEOLink
                  key={occasion.slug}
                  to={`ocasiones/${occasion.slug}`}
                  className="group relative flex flex-col p-[2px] rounded-xl overflow-hidden bg-white border border-[#181114]/10 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-left"
                >
                  {/* Talavera Pattern Background */}
                  <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity talavera-pattern-bg"></div>
                  
                  <div className="relative bg-white m-1 rounded-lg flex flex-col h-full overflow-hidden">
                    {/* Occasion Image */}
                    <div
                      className="h-48 bg-cover bg-center relative"
                      role="img"
                      aria-label={`Canción personalizada para ${occasion.name}`}
                      style={{
                        backgroundImage: `linear-gradient(0deg, rgba(26, 67, 56, 0.6) 0%, transparent 100%), url("${getOccasionImage(occasion.slug)}")`
                      }}
                    >
                      {/* Icon overlay */}
                      <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-xl">
                        {occasion.icon}
                      </div>
                    </div>
                    
                    {/* Occasion Info */}
                    <div className="p-5 flex flex-col gap-2">
                      <h3 className="text-[#181114] text-xl font-bold">{occasion.name}</h3>
                      <p className="text-xs text-slate-500 uppercase font-bold tracking-wide line-clamp-1">
                        {occasion.description?.split('.')[0] || 'Ocasión especial'}
                      </p>
                      {occasion.featured && (
                        <span className="inline-flex items-center gap-1 text-[#f20d80] text-xs font-medium mt-1">
                          <span>⭐</span> Popular
                        </span>
                      )}
                    </div>
                  </div>
                </SEOLink>
              ))}
            </div>

            {/* Why a Song Gift Section */}
            <div className="mt-16 p-8 bg-white rounded-2xl border border-[#181114]/10">
              <h2 className="text-2xl font-bold text-[#181114] mb-8 text-center">
                ¿Por Qué Regalar una Canción?
              </h2>
              
              <div className="grid md:grid-cols-3 gap-8">
                <div className="text-center p-6">
                  <div className="text-4xl mb-4">💎</div>
                  <h3 className="font-bold text-[#181114] mb-2">Único e Irrepetible</h3>
                  <p className="text-slate-500 text-sm">
                    No existe otra canción igual en el mundo. Es un regalo 100% exclusivo.
                  </p>
                </div>
                
                <div className="text-center p-6">
                  <div className="text-4xl mb-4">😭</div>
                  <h3 className="font-bold text-[#181114] mb-2">Emotivo</h3>
                  <p className="text-slate-500 text-sm">
                    Escuchar su nombre en una canción provoca emociones que no olvidarán.
                  </p>
                </div>
                
                <div className="text-center p-6">
                  <div className="text-4xl mb-4">♾️</div>
                  <h3 className="font-bold text-[#181114] mb-2">Para Siempre</h3>
                  <p className="text-slate-500 text-sm">
                    A diferencia de flores o chocolates, la canción la pueden escuchar siempre.
                  </p>
                </div>
              </div>
            </div>

            {/* Action Footer */}
            <div className="mt-12 mb-20 p-4 flex flex-col items-center gap-6">
              <p className="text-[#606e8a] text-sm italic text-center">
                La estética Talavera honra nuestra herencia compartida con un toque de lujo moderno.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                <SEOLink
                  to="generos"
                  className="flex min-w-[200px] items-center justify-center gap-2 rounded-xl h-14 px-8 bg-white border-2 border-[#181114] text-[#181114] hover:bg-[#181114]/5 transition-all text-base font-bold"
                >
                  <span>🎵</span>
                  Ver Géneros
                </SEOLink>
                <SEOLink
                  to="genre"
                  className="flex min-w-[240px] items-center justify-center gap-2 rounded-xl h-14 px-8 bg-[#181114] text-white hover:bg-[#181114]/90 transition-all text-base font-bold shadow-lg shadow-[#181114]/30"
                >
                  Crear Mi Canción
                  <span>→</span>
                </SEOLink>
              </div>
            </div>
          </div>
        </main>

        {/* Minimalist Patterned Footer */}
        <footer className="w-full bg-white border-t border-[#181114]/10 py-12 px-6 md:px-10">
          <div className="max-w-[1000px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-[#181114]">
                <span className="text-3xl">🎵</span>
                <span className="font-bold text-lg">RegalosQueCantan</span>
              </div>
              <p className="text-sm text-slate-500">Fusionando la belleza atemporal de la cerámica Talavera con el poder emocional de la canción.</p>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="font-bold text-[#181114] uppercase text-xs tracking-widest">Navegación</h4>
              <div className="flex flex-col gap-2 text-sm text-[#111318]">
                <SEOLink to="landing" className="hover:text-[#181114] transition-colors text-left">Cómo Funciona</SEOLink>
                <SEOLink to="generos" className="hover:text-[#181114] transition-colors text-left">Catálogo de Géneros</SEOLink>
                <SEOLink to="ocasiones" className="hover:text-[#181114] transition-colors text-left">Guía de Regalos</SEOLink>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="font-bold text-[#181114] uppercase text-xs tracking-widest">Soporte</h4>
              <div className="flex flex-col gap-2 text-sm text-[#111318]">
                <a href="mailto:hola@regalosquecantan.com" className="hover:text-[#181114] transition-colors">Contáctanos</a>
              </div>
            </div>
          </div>
          <div className="max-w-[1000px] mx-auto mt-12 pt-8 border-t border-[#181114]/5 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-400">
            <p>© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
            <div className="flex gap-4">
              <span className="cursor-pointer hover:text-[#181114] transition-colors">🌐</span>
              <span className="cursor-pointer hover:text-[#181114] transition-colors">🛡️</span>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
