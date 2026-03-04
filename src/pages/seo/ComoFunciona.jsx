import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateHowToStructuredData, generateBreadcrumbData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';

const STEPS = [
  {
    num: '1',
    name: 'Elige tu Género Musical',
    text: 'Escoge entre 20+ géneros latinos: corridos tumbados, cumbia, banda, mariachi, bachata, reggaeton, bolero y más. Cada género tiene su sonido auténtico.',
    icon: '🎵'
  },
  {
    num: '2',
    name: 'Selecciona la Ocasión',
    text: 'Cumpleaños, Día de las Madres, aniversario, boda, quinceañera, graduación — elige la ocasión o escribe una personalizada.',
    icon: '🎉'
  },
  {
    num: '3',
    name: 'Agrega los Detalles Personales',
    text: 'Escribe el nombre del destinatario, tu nombre, la relación entre ustedes y detalles especiales como memorias, logros o mensajes que quieres incluir.',
    icon: '✍️'
  },
  {
    num: '4',
    name: 'Nuestra IA Crea tu Canción',
    text: 'En 2-4 minutos, nuestra inteligencia artificial compone la letra y genera la música. Recibes 2 versiones únicas con voces profesionales.',
    icon: '🤖'
  },
  {
    num: '5',
    name: 'Escucha el Preview y Elige',
    text: 'Escucha un preview de 20 segundos de cada versión antes de pagar. Compara ambas y elige tu favorita o quédate con las dos.',
    icon: '🎧'
  },
  {
    num: '6',
    name: 'Descarga y Comparte',
    text: 'Descarga tu canción en MP3 de alta calidad al instante. Compártela por WhatsApp, redes sociales, email o reprodúcela en cualquier dispositivo.',
    icon: '📱'
  }
];

export default function ComoFunciona() {
  const { navigateTo } = useContext(AppContext);

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Cómo Funciona', path: '/como-funciona' }
  ];

  const howToSchema = generateHowToStructuredData({
    name: 'Cómo Crear una Canción Personalizada con IA en RegalosQueCantan',
    description: 'Guía paso a paso para crear una canción personalizada con inteligencia artificial. Elige género, agrega detalles y recibe tu canción en minutos.',
    steps: STEPS.map(s => ({ name: s.name, text: s.text })),
    totalTime: 'PT5M'
  });

  const structuredData = [
    howToSchema,
    generateBreadcrumbData(breadcrumbs)
  ];

  return (
    <>
      <SEOHead
        title="Cómo Funciona — Crea tu Canción Personalizada con IA"
        description="Aprende cómo crear una canción personalizada con IA en RegalosQueCantan. Elige género, agrega detalles y recibe tu canción en minutos. Fácil, rápido y desde $24.99."
        canonical="/como-funciona"
        keywords="cómo funciona regalos que cantan, crear canción con IA, canción personalizada pasos, tutorial canción IA"
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {/* Hero */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at center top, #c9184a40 0%, transparent 70%)' }} />

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
              ¿Cómo Funciona?
            </h1>
            <p className="text-xl text-white/60 mb-6 max-w-2xl mx-auto leading-relaxed">
              Crea una canción personalizada con inteligencia artificial en 6 pasos simples. Sin conocimientos musicales necesarios.
            </p>
            <p className="text-white/40">Listo en menos de 5 minutos • Desde $24.99</p>
          </div>
        </section>

        {/* Definition Block */}
        <section className="px-6 -mt-8 mb-8 relative z-10">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-6 md:p-8 border border-white/10" style={{ borderLeftWidth: '4px', borderLeftColor: '#c9184a' }}>
              <p className="text-white/80 leading-relaxed text-lg">
                RegalosQueCantan es un servicio que utiliza inteligencia artificial para crear canciones personalizadas en más de 20 géneros latinos. Tú proporcionas los detalles — nombre, ocasión, mensaje — y nuestra IA compone la letra y genera la música en minutos. El resultado es una canción única que nadie más tendrá, lista para descargar y compartir desde $24.99.
              </p>
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="space-y-8">
              {STEPS.map((step, i) => (
                <div key={step.num} className="flex gap-6 items-start">
                  <div className="flex-shrink-0">
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl glass-morphism"
                      style={{ boxShadow: '0 0 30px rgba(201, 24, 74, 0.15)' }}
                    >
                      {step.icon}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-bold px-3 py-1 rounded-full" style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white' }}>
                        Paso {step.num}
                      </span>
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold mb-2 font-display">{step.name}</h2>
                    <p className="text-white/60 leading-relaxed">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Overview */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center font-display">
              ¿Cuánto Cuesta?
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="glass-morphism rounded-2xl p-8 text-center genre-card">
                <div className="text-4xl mb-4">🎵</div>
                <h3 className="font-bold text-2xl mb-2">$24.99</h3>
                <p className="text-white/50 text-sm mb-4">1 Canción</p>
                <p className="text-white/40 text-xs">Una versión de tu canción personalizada</p>
              </div>
              <div className="glass-morphism rounded-2xl p-8 text-center genre-card border border-landing-primary/30">
                <div className="text-xs font-bold px-3 py-1 rounded-full mb-4 inline-block" style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white' }}>Más Popular</div>
                <div className="text-4xl mb-4">🎵🎵</div>
                <h3 className="font-bold text-2xl mb-2">$39.99</h3>
                <p className="text-white/50 text-sm mb-4">2 Canciones</p>
                <p className="text-white/40 text-xs">Ambas versiones para comparar y elegir</p>
              </div>
              <div className="glass-morphism rounded-2xl p-8 text-center genre-card">
                <div className="text-4xl mb-4">💎</div>
                <h3 className="font-bold text-2xl mb-2">$49.99</h3>
                <p className="text-white/50 text-sm mb-4">Premium</p>
                <p className="text-white/40 text-xs">2 canciones + letra imprimible + entrega express</p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(ellipse at center, #c9184a30 0%, transparent 70%)' }} />
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-5 font-display">
              ¿Listo para crear tu canción?
            </h2>
            <p className="text-white/60 mb-10 text-lg">
              En solo 5 minutos tendrás una canción única que tu ser querido nunca olvidará.
            </p>
            <button
              onClick={() => navigateTo('genre')}
              className="px-12 py-5 rounded-full text-xl font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white', boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)' }}
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

        {/* Footer */}
        <footer className="py-10 px-6 border-t border-white/5 text-center">
          <p className="text-white/30 text-sm">© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          <p className="mt-2 text-white/20 text-sm">Canciones personalizadas con inteligencia artificial.</p>
        </footer>
      </div>
    </>
  );
}
