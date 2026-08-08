// src/pages/seo/PreciosLanding.jsx
// /canciones-personalizadas-precios — "how much does a personalized song cost"
// comparison page. Built from the SEO campaign agent's approved draft
// (2026-08-08): targets queries where we already almost rank (canciones
// personalizadas, canción para regalar, competitor names). Prices verified
// against the live checkout ($29.99 single / $39.99 two-pack); competitor
// figures hedged with "alrededor de" and dated. Prose FAQ only — no FAQ
// schema (dead since May 2026).
import React from 'react';
import SEOHead, { generateOrganizationData, generateBreadcrumbData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';

const COMPARISON = [
  { name: 'Regalos Que Cantan (español, EE. UU.)', price: 'Desde $29.99 USD', note: 'Corrido, cumbia norteña, bachata, banda, balada y 20+ géneros. Letra hecha con tu historia, lista en minutos, con audio para compartir por WhatsApp.', highlight: true },
  { name: 'Servicios en inglés tipo Songfinch', price: 'Alrededor de $200 USD', note: 'Solo en inglés, sin géneros regionales mexicanos.' },
  { name: 'Servicios en inglés tipo Songlorious', price: 'Alrededor de $150 USD', note: 'Solo en inglés.' },
  { name: 'Corridos por WhatsApp (operadores pequeños)', price: 'Alrededor de $49 USD', note: 'Sin catálogo público de ejemplos ni pago protegido.' },
  { name: 'Vendedores de Etsy o Fiverr', price: '$15 a $300 USD', note: 'Calidad y tiempos muy variables.' },
  { name: 'Páginas de España', price: 'Cotizan en euros', note: 'El precio sube con el cambio de moneda y no están pensadas para familias en Estados Unidos.' },
];

const FAQS = [
  { q: '¿Por qué son más baratas que las de los servicios en inglés?', a: 'Porque producimos a volumen y nos especializamos en un solo público: familias latinas en Estados Unidos. No hay estudio de grabación de lujo; hay muchísimas canciones bien hechas.' },
  { q: '¿Puedo pedir corrido, cumbia norteña o bachata?', a: 'Sí. Eliges el género antes de pagar y la canción se hace en ese estilo.' },
  { q: '¿Los precios están en dólares?', a: 'Sí, todo en dólares estadounidenses, sin sorpresas de conversión.' },
  { q: '¿Cuánto tarda?', a: 'La canción se genera en minutos y la escuchas antes de pagar. Te avisamos cuando esté lista.' },
  { q: '¿Sirve para Día de las Madres, cumpleaños o aniversario?', a: 'Sí; esas son las ocasiones que más nos piden.' },
  { q: '¿Y si no me gusta la letra?', a: 'Escríbenos por WhatsApp y lo revisamos contigo.' },
];

export default function PreciosLanding() {
  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Precios de Canciones Personalizadas', path: '/canciones-personalizadas-precios' },
  ];

  const structuredData = [
    generateOrganizationData(),
    generateBreadcrumbData(breadcrumbs),
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Canción Personalizada en Español',
      description: 'Canción original con la letra hecha a partir de tu historia, en el género latino que elijas.',
      brand: { '@type': 'Brand', name: 'RegalosQueCantan' },
      offers: { '@type': 'Offer', price: '29.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: 'https://regalosquecantan.com/canciones-personalizadas-precios' },
    },
  ];

  return (
    <>
      <SEOHead
        title="¿Cuánto cuesta una canción personalizada? Precios 2026 en EE. UU."
        description="Precios reales de canciones personalizadas en Estados Unidos: desde $29.99 USD con Regalos Que Cantan frente a $150-$200 de los servicios en inglés. Escucha ejemplos."
        canonical="/canciones-personalizadas-precios"
        keywords="cuanto cuesta una cancion personalizada, precio cancion personalizada, canciones personalizadas precios, cancion personalizada barata"
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {/* Hero */}
        <section className="relative py-20 px-6 overflow-hidden">
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

            <h1 className="text-4xl md:text-5xl font-bold mb-5 font-display">
              ¿Cuánto cuesta una canción personalizada?
            </h1>
            <p className="text-xl text-white/60 max-w-2xl mx-auto leading-relaxed">
              Precios reales en Estados Unidos, actualizados en agosto de 2026 — y por qué varían tanto.
            </p>
          </div>
        </section>

        {/* Short answer */}
        <section className="px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-8 md:p-10">
              <p className="text-white/70 leading-relaxed text-lg">
                <strong className="text-white">Respuesta corta:</strong> en Regalos Que Cantan una canción personalizada cuesta{' '}
                <strong className="text-white">desde $29.99 USD</strong>, con la letra escrita a partir de la historia que tú nos cuentas,
                cantada en el género que elijas y lista para compartir por WhatsApp. Los servicios equivalentes en inglés cobran entre
                $150 y $200, y las páginas de España cobran en euros y piensan en envíos dentro de Europa.
              </p>
            </div>
          </div>
        </section>

        {/* Comparison */}
        <section className="py-16 px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-8 font-display text-center">Comparación de precios (agosto 2026)</h2>
            <div className="space-y-4">
              {COMPARISON.map((c) => (
                <div key={c.name} className={`rounded-2xl p-6 ${c.highlight ? 'bg-white/10 border border-cyan-400/40' : 'glass-morphism'}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                    <h3 className="font-bold text-white">{c.name}</h3>
                    <span className={`font-bold ${c.highlight ? 'text-cyan-300' : 'text-white/80'}`}>{c.price}</span>
                  </div>
                  <p className="text-white/60 text-sm leading-relaxed">{c.note}</p>
                </div>
              ))}
            </div>
            <p className="text-white/40 text-xs mt-4 text-center">Precios de otros servicios observados públicamente en agosto de 2026; pueden cambiar.</p>
          </div>
        </section>

        {/* What's included */}
        <section className="pb-16 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="glass-morphism rounded-2xl p-8 md:p-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-6 font-display">Qué incluye nuestro precio</h2>
              <ul className="text-white/60 leading-relaxed space-y-3 list-disc pl-5">
                <li>Letra original escrita con los nombres, apodos y detalles que tú nos escribes.</li>
                <li>Voz y música en el género que tú elijas.</li>
                <li>La escuchas <strong className="text-white">antes de pagar</strong>.</li>
                <li>Archivo de audio para descargar y un link para compartir por WhatsApp.</li>
                <li>Atención en español, de personas, por WhatsApp.</li>
              </ul>
              <p className="text-white/60 leading-relaxed mt-6">
                En los últimos 30 días entregamos más de 1,300 canciones. Esa es la razón por la que podemos cobrar $29.99 y no $200:
                hacemos muchas, y le hablamos directo a las familias latinas en Estados Unidos.
              </p>
            </div>
          </div>
        </section>

        {/* Why prices vary */}
        <section className="pb-16 px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6 font-display">Por qué los precios varían tanto</h2>
            <div className="text-white/60 leading-relaxed space-y-4">
              <p><strong className="text-white">El idioma y el género.</strong> Casi nadie hace corridos o cumbia norteña personalizados; los servicios grandes solo trabajan en inglés.</p>
              <p><strong className="text-white">Quién escribe la letra.</strong> Una letra hecha con tus detalles reales no es lo mismo que rellenar una plantilla con un nombre.</p>
              <p><strong className="text-white">Poder escuchar antes de pagar.</strong> Si un servicio no te deja escuchar nada antes de pagar, es la primera señal de alarma.</p>
              <p><strong className="text-white">La moneda.</strong> Un precio en euros no es un precio en dólares.</p>
              <p><strong className="text-white">Las revisiones.</strong> Pregunta siempre si puedes pedir un cambio si algo no quedó bien.</p>
            </div>
          </div>
        </section>

        {/* FAQ (prose, no schema — FAQ rich results are dead) */}
        <section className="pb-16 px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-8 font-display">Preguntas frecuentes</h2>
            <div className="space-y-6">
              {FAQS.map((f) => (
                <div key={f.q} className="glass-morphism rounded-2xl p-6">
                  <h3 className="font-bold text-white mb-2">{f.q}</h3>
                  <p className="text-white/60 leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="pb-24 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-4 font-display">Pide la tuya</h2>
            <p className="text-white/60 mb-8">Cuéntanos la historia y nosotros la convertimos en canción, desde $29.99 USD.</p>
            <a href="/create/occasion" className="inline-block px-10 py-4 rounded-full font-bold text-white" style={{ background: 'linear-gradient(90deg, #e11d74, #c026d3)', boxShadow: '0 4px 24px rgba(225,29,116,0.35)' }}>
              Crear mi canción — desde $29.99
            </a>
            <p className="mt-6 text-sm text-white/40">
              ¿Buscas ideas de regalo? Mira <a href="/canciones-para-regalar" className="underline text-white/60">canciones para regalar</a>.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
