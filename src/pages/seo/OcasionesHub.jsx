import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead from '../../components/SEOHead';
import { getAllOccasions, getFeaturedOccasions, getCurrentSeasonalOccasions } from '../../data/seoData';

/**
 * OcasionesHub - SEO Hub page for all occasions
 * 
 * This page ranks for searches like:
 * - "regalo original para cumpleaños"
 * - "regalo día de las madres único"
 * - "ideas regalo aniversario"
 */
export default function OcasionesHub() {
  const { navigateTo } = useContext(AppContext);
  const allOccasions = getAllOccasions();
  const featuredOccasions = getFeaturedOccasions();
  const seasonalOccasions = getCurrentSeasonalOccasions();
  
  // Group occasions
  const celebrationOccasions = allOccasions.filter(o => 
    ['cumpleanos', 'quinceanera', 'graduacion', 'boda'].includes(o.slug)
  );
  
  const familyOccasions = allOccasions.filter(o => 
    ['dia-de-las-madres', 'dia-del-padre', 'agradecimiento'].includes(o.slug)
  );
  
  const romanticOccasions = allOccasions.filter(o => 
    ['aniversario', 'san-valentin', 'declaracion-amor'].includes(o.slug)
  );
  
  const otherOccasions = allOccasions.filter(o => 
    ['navidad', 'despedida'].includes(o.slug)
  );

  const structuredData = {
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

  return (
    <>
      <SEOHead
        title="Ocasiones para Canciones Personalizadas"
        description="Crea canciones personalizadas para cualquier ocasión: cumpleaños, día de las madres, aniversarios, bodas, quinceañeras, graduaciones y más. El regalo más único y emotivo."
        canonical="/ocasiones"
        keywords="regalo cumpleaños, regalo día de las madres, regalo aniversario, regalo boda, regalo quinceañera, canción personalizada, regalo único, regalo original"
        structuredData={structuredData}
      />
      
      <div className="min-h-screen bg-[#F9F6F2]">
        {/* Hero Section */}
        <section className="py-20 px-6 bg-gradient-to-b from-[#1A4338] to-[#2D5A4A] text-white">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Una Canción para Cada Ocasión
            </h1>
            <p className="text-xl text-white/80 max-w-2xl mx-auto">
              El regalo más único y emotivo para los momentos más importantes
            </p>
          </div>
        </section>
        
        {/* Seasonal Banner (if applicable) */}
        {seasonalOccasions.length > 0 && (
          <section className="py-8 px-6 bg-gradient-to-r from-[#D4AF37] to-[#E5C349]">
            <div className="max-w-4xl mx-auto text-center">
              <p className="text-[#1A4338] font-bold text-lg">
                🎉 ¡{seasonalOccasions[0].name} se acerca! Crea tu canción ahora
              </p>
              <button
                onClick={() => navigateTo(`ocasiones/${seasonalOccasions[0].slug}`)}
                className="mt-3 px-6 py-2 bg-[#1A4338] text-white rounded-full text-sm font-medium hover:bg-[#2D5A4A] transition-colors"
              >
                Ver canciones para {seasonalOccasions[0].name} →
              </button>
            </div>
          </section>
        )}
        
        {/* Featured Occasions */}
        <section className="py-16 px-6">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              ⭐ Ocasiones Más Populares
            </h2>
            
            <div className="grid md:grid-cols-3 gap-6">
              {featuredOccasions.slice(0, 6).map(occasion => (
                <button
                  key={occasion.slug}
                  onClick={() => navigateTo(`ocasiones/${occasion.slug}`)}
                  className="group bg-white rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all text-left"
                >
                  <div className="flex items-start gap-4">
                    <div 
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ backgroundColor: `${occasion.color}20` }}
                    >
                      {occasion.icon}
                    </div>
                    <div>
                      <h3 className="font-bold text-[#1A4338] text-lg group-hover:text-opacity-80">
                        {occasion.name}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                        {occasion.description}
                      </p>
                      <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                        <span>⭐ 4.9</span>
                        <span>•</span>
                        <span>{occasion.reviewCount}+ canciones</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
        
        {/* Celebration Occasions */}
        <section className="py-12 px-6 bg-white">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-xl font-bold text-[#1A4338] mb-6">
              🎉 Celebraciones
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {celebrationOccasions.map(occasion => (
                <button
                  key={occasion.slug}
                  onClick={() => navigateTo(`ocasiones/${occasion.slug}`)}
                  className="group p-4 rounded-xl border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all text-center"
                >
                  <div className="text-2xl mb-2">{occasion.icon}</div>
                  <div className="font-medium text-[#1A4338] text-sm group-hover:text-opacity-80">
                    {occasion.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
        
        {/* Family Occasions */}
        <section className="py-12 px-6">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-xl font-bold text-[#1A4338] mb-6">
              👨‍👩‍👧 Para la Familia
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {familyOccasions.map(occasion => (
                <button
                  key={occasion.slug}
                  onClick={() => navigateTo(`ocasiones/${occasion.slug}`)}
                  className="group p-4 rounded-xl border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all text-center"
                >
                  <div className="text-2xl mb-2">{occasion.icon}</div>
                  <div className="font-medium text-[#1A4338] text-sm group-hover:text-opacity-80">
                    {occasion.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
        
        {/* Romantic Occasions */}
        <section className="py-12 px-6 bg-white">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-xl font-bold text-[#1A4338] mb-6">
              ❤️ Románticas
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {romanticOccasions.map(occasion => (
                <button
                  key={occasion.slug}
                  onClick={() => navigateTo(`ocasiones/${occasion.slug}`)}
                  className="group p-4 rounded-xl border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all text-center"
                >
                  <div className="text-2xl mb-2">{occasion.icon}</div>
                  <div className="font-medium text-[#1A4338] text-sm group-hover:text-opacity-80">
                    {occasion.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
        
        {/* Other Occasions */}
        <section className="py-12 px-6">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-xl font-bold text-[#1A4338] mb-6">
              ✨ Otras Ocasiones
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {otherOccasions.map(occasion => (
                <button
                  key={occasion.slug}
                  onClick={() => navigateTo(`ocasiones/${occasion.slug}`)}
                  className="group p-4 rounded-xl border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all text-center"
                >
                  <div className="text-2xl mb-2">{occasion.icon}</div>
                  <div className="font-medium text-[#1A4338] text-sm group-hover:text-opacity-80">
                    {occasion.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
        
        {/* Why a Song Gift */}
        <section className="py-16 px-6 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-[#1A4338] mb-8 text-center">
              ¿Por Qué Regalar una Canción?
            </h2>
            
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center p-6">
                <div className="text-4xl mb-4">💎</div>
                <h3 className="font-bold text-[#1A4338] mb-2">Único e Irrepetible</h3>
                <p className="text-gray-600 text-sm">
                  No existe otra canción igual en el mundo. Es un regalo 100% exclusivo.
                </p>
              </div>
              
              <div className="text-center p-6">
                <div className="text-4xl mb-4">😭</div>
                <h3 className="font-bold text-[#1A4338] mb-2">Emotivo</h3>
                <p className="text-gray-600 text-sm">
                  Escuchar su nombre en una canción provoca emociones que no olvidarán.
                </p>
              </div>
              
              <div className="text-center p-6">
                <div className="text-4xl mb-4">♾️</div>
                <h3 className="font-bold text-[#1A4338] mb-2">Para Siempre</h3>
                <p className="text-gray-600 text-sm">
                  A diferencia de flores o chocolates, la canción la pueden escuchar siempre.
                </p>
              </div>
            </div>
          </div>
        </section>
        
        {/* CTA Section */}
        <section className="py-20 px-6 bg-[#1A4338] text-white">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">
              ¿Listo para sorprender?
            </h2>
            <p className="text-white/70 mb-8">
              Crea una canción personalizada en solo 5 minutos
            </p>
            <button
              onClick={() => navigateTo('genre')}
              className="px-8 py-4 bg-[#D4AF37] text-[#1A4338] rounded-full text-lg font-bold hover:bg-[#E5C349] transition-colors"
            >
              🎵 Crear Mi Canción
            </button>
            <p className="mt-4 text-white/50 text-sm">
              Desde $19.99 • Listo en minutos
            </p>
          </div>
        </section>
        
        {/* Footer */}
        <footer className="py-8 px-6 bg-[#0F2922] text-white/50 text-center text-sm">
          <p>© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
        </footer>
      </div>
    </>
  );
}
