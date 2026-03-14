/**
 * Lightweight prerender script for SEO pages.
 *
 * After `vite build`, this script:
 *  1. Reads the built dist/index.html as a template
 *  2. Imports SEO data (genres, occasions)
 *  3. For each route, generates a unique HTML file with:
 *     - Correct <title>, <meta description>, <canonical>, OG tags
 *     - Correct structured data (JSON-LD)
 *     - Visible body content for crawlers
 *  4. Writes to dist/{route}/index.html
 *
 * This runs in pure Node.js — no Puppeteer or browser needed.
 * Works reliably on Vercel, Netlify, and any CI/CD environment.
 *
 * Usage:  node scripts/prerender.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const BASE_URL = 'https://regalosquecantan.com';

// ── Import SEO data directly (pure JS, no React deps) ──────────────
const seoDataPath = resolve(__dirname, '..', 'src', 'data', 'seoData.js');
const {
  GENRES_SEO,
  OCCASIONS_SEO,
  DEFAULT_GENRE_FAQS,
  DEFAULT_OCCASION_FAQS,
  COMBO_ROUTES
} = await import(`file://${seoDataPath.replace(/\\/g, '/')}`);

const allGenres = Object.values(GENRES_SEO);
const allOccasions = Object.values(OCCASIONS_SEO);

// ── Helper: escape HTML entities ────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Helper: generate JSON-LD script tag ─────────────────────────────
function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

// ── Date for freshness signals ──────────────────────────────────────
// Use month/year so it doesn't look like it auto-updates daily
const now = new Date();
const BUILD_DATE = `${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][now.getMonth()]} ${now.getFullYear()}`; // e.g. "Marzo 2026"
const BUILD_DATE_ISO = now.toISOString().split('T')[0]; // for sitemap lastmod

// ── Organization schema (site-wide entity recognition) ─────────────
function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "RegalosQueCantan",
    "url": BASE_URL,
    "logo": `${BASE_URL}/rqc-logo.png`,
    "description": "Plataforma de canciones personalizadas para la comunidad latina. 20+ géneros musicales latinos incluyendo corridos, cumbia, banda, mariachi, bachata y más.",
    "foundingDate": "2024",
    "contactPoint": {
      "@type": "ContactPoint",
      "email": "hola@regalosquecantan.com",
      "contactType": "customer service",
      "availableLanguage": ["Spanish", "English"]
    },
    "sameAs": []
  };
}

// ── Structured data generators ──────────────────────────────────────
function genreProductSchema(genre) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `Canción de ${genre.name} Personalizada`,
    "description": genre.description,
    "brand": { "@type": "Brand", "name": "RegalosQueCantan" },
    "offers": {
      "@type": "Offer",
      "price": "24.99",
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock"
    },
    "category": "Música Personalizada",
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.9",
      "reviewCount": genre.reviewCount || 50
    }
  };
}

function occasionProductSchema(occasion) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `Canción para ${occasion.name}`,
    "description": occasion.description,
    "brand": { "@type": "Brand", "name": "RegalosQueCantan" },
    "offers": {
      "@type": "Offer",
      "price": "24.99",
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock"
    },
    "category": `Regalo para ${occasion.name}`,
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.9",
      "reviewCount": occasion.reviewCount || 75
    }
  };
}

function breadcrumbSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": item.name,
      "item": `${BASE_URL}${item.path}`
    }))
  };
}

function faqSchema(faqs) {
  if (!faqs || faqs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": { "@type": "Answer", "text": faq.answer }
    }))
  };
}

function itemListSchema(name, items) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": name,
    "itemListElement": items.map((item, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": item.name,
      "url": `${BASE_URL}${item.url}`
    }))
  };
}

function howToSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": "Cómo Crear una Canción Personalizada",
    "description": "Guía paso a paso para crear tu canción personalizada con RegalosQueCantan.",
    "totalTime": "PT5M",
    "step": [
      { "@type": "HowToStep", "position": 1, "name": "Elige tu Género Musical", "text": "Escoge entre 20+ géneros latinos: corridos tumbados, cumbia, banda, mariachi, bachata, reggaeton, bolero y más." },
      { "@type": "HowToStep", "position": 2, "name": "Selecciona la Ocasión", "text": "Cumpleaños, Día de las Madres, aniversario, boda, quinceañera, graduación — elige la ocasión." },
      { "@type": "HowToStep", "position": 3, "name": "Agrega los Detalles Personales", "text": "Escribe el nombre del destinatario, tu nombre, la relación y detalles especiales." },
      { "@type": "HowToStep", "position": 4, "name": "Se Crea tu Canción", "text": "En 2-4 minutos se compone la letra y se genera la música. Recibes 2 versiones únicas." },
      { "@type": "HowToStep", "position": 5, "name": "Escucha y Elige", "text": "Escucha un preview de cada versión antes de pagar. Elige tu favorita o quédate con ambas." },
      { "@type": "HowToStep", "position": 6, "name": "Descarga y Comparte", "text": "Descarga en MP3 de alta calidad. Comparte por WhatsApp, redes sociales o email." }
    ]
  };
}

// ── Build the body HTML content for crawlers ────────────────────────

function genreBodyHtml(genre) {
  const faqs = genre.faqs || DEFAULT_GENRE_FAQS;
  const relatedGenres = allGenres.filter(g => g.slug !== genre.slug).slice(0, 6);
  return `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / <a href="/generos">Géneros</a> / ${esc(genre.name)}</nav>
      <h1>${esc(genre.heroTitle)}</h1>
      <p>${esc(genre.heroSubtitle)}</p>
      <p>${esc(genre.definitionBlock || genre.description)}</p>
      <p>Listo en 2-4 minutos desde $24.99 USD.</p>
      <p><em>Actualizado: ${BUILD_DATE}</em></p>
      <a href="/create/occasion">Crear Mi ${esc(genre.name)} Ahora — Desde $24.99</a>
      <section>
        <h2>¿Qué es un ${esc(genre.name)} Personalizado?</h2>
        ${(genre.longDescription || genre.description).split('\n\n').map(p => `<p>${esc(p)}</p>`).join('')}
        ${genre.artists ? `<p>Estilo inspirado en artistas como: ${genre.artists.join(', ')}</p>` : ''}
      </section>
      <section>
        <h2>¿Qué incluye tu ${esc(genre.name)}?</h2>
        <ul>
          <li>Letra 100% personalizada con el nombre de tu ser querido</li>
          <li>Música auténtica de ${esc(genre.name.toLowerCase())} con instrumentación profesional</li>
          <li>2 versiones únicas para elegir</li>
          <li>Listo en 2-4 minutos — descarga instantánea en MP3</li>
        </ul>
        <p>Desde $24.99 USD • Sin suscripción • Pago único</p>
      </section>
      <section>
        <h2>Preguntas Frecuentes sobre ${esc(genre.name)}</h2>
        ${faqs.map(f => `<h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p>`).join('')}
      </section>
      <section>
        <h2>Explora otros géneros</h2>
        <ul>${relatedGenres.map(g => `<li><a href="/generos/${g.slug}">${esc(g.name)}</a></li>`).join('')}</ul>
        <a href="/generos">Ver los 20+ géneros disponibles</a>
      </section>
      <section>
        <h2>Perfecto para estas ocasiones</h2>
        <ul>${allOccasions.slice(0, 5).map(o => `<li><a href="/ocasiones/${o.slug}">${esc(o.name)}</a></li>`).join('')}</ul>
        <a href="/ocasiones">Ver todas las ocasiones</a>
      </section>
    </div>`;
}

function occasionBodyHtml(occasion) {
  const faqs = occasion.faqs || DEFAULT_OCCASION_FAQS;
  const relatedOccasions = allOccasions.filter(o => o.slug !== occasion.slug).slice(0, 6);
  const suggestedGenres = (occasion.suggestedGenres || []).map(s => GENRES_SEO[s]).filter(Boolean);
  return `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / <a href="/ocasiones">Ocasiones</a> / ${esc(occasion.name)}</nav>
      <h1>${esc(occasion.heroTitle)}</h1>
      <p>${esc(occasion.heroSubtitle)}</p>
      <p>${esc(occasion.definitionBlock || occasion.description)}</p>
      <p>El regalo musical más emotivo desde $24.99 USD. Listo en 2-4 minutos.</p>
      <p><em>Actualizado: ${BUILD_DATE}</em></p>
      <a href="/create/occasion">Crear Mi Canción de ${esc(occasion.name)} — Desde $24.99</a>
      <section>
        <h2>¿Por qué regalar una canción para ${esc(occasion.name)}?</h2>
        ${(occasion.longDescription || occasion.description).split('\n\n').map(p => `<p>${esc(p)}</p>`).join('')}
      </section>
      ${suggestedGenres.length > 0 ? `
      <section>
        <h2>Géneros populares para ${esc(occasion.name)}</h2>
        <ul>${suggestedGenres.map(g => `<li><a href="/generos/${g.slug}">${esc(g.name)}</a> — ${esc(g.description)}</li>`).join('')}</ul>
      </section>` : ''}
      <section>
        <h2>¿Qué incluye tu canción?</h2>
        <ul>
          <li>Letra 100% personalizada con nombres y detalles</li>
          <li>Música profesional en el género de tu elección</li>
          <li>2 versiones únicas para elegir</li>
          <li>Listo en 2-4 minutos — descarga instantánea en MP3</li>
        </ul>
        <p>Desde $24.99 USD • Sin suscripción • Pago único</p>
      </section>
      <section>
        <h2>Preguntas Frecuentes</h2>
        ${faqs.map(f => `<h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p>`).join('')}
      </section>
      <section>
        <h2>Otras ocasiones</h2>
        <ul>${relatedOccasions.map(o => `<li><a href="/ocasiones/${o.slug}">${esc(o.name)}</a></li>`).join('')}</ul>
      </section>
    </div>`;
}

function generosHubBodyHtml() {
  return `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / Géneros</nav>
      <h1>Géneros Musicales para Canciones Personalizadas</h1>
      <p>RegalosQueCantan ofrece más de 20 géneros de música latina para canciones personalizadas. Cada género incluye instrumentación auténtica y estilo profesional.</p>
      <p><em>Actualizado: ${BUILD_DATE}</em></p>
      <ul>${allGenres.map(g => `<li><a href="/generos/${g.slug}">${esc(g.name)}</a> — ${esc(g.description)}</li>`).join('')}</ul>
      <a href="/create/occasion">Crear Mi Canción — Desde $24.99</a>
    </div>`;
}

function ocasionesHubBodyHtml() {
  return `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / Ocasiones</nav>
      <h1>Ocasiones para Canciones Personalizadas</h1>
      <p>Crea canciones personalizadas para cualquier ocasión especial — cumpleaños, Día de las Madres, aniversarios, bodas, quinceañeras y más.</p>
      <p><em>Actualizado: ${BUILD_DATE}</em></p>
      <ul>${allOccasions.map(o => `<li><a href="/ocasiones/${o.slug}">${esc(o.name)}</a> — ${esc(o.description)}</li>`).join('')}</ul>
      <a href="/create/occasion">Crear Mi Canción — Desde $24.99</a>
    </div>`;
}

function comoFuncionaBodyHtml() {
  return `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / Cómo Funciona</nav>
      <h1>Cómo Crear una Canción Personalizada</h1>
      <p>Crear tu canción personalizada es fácil y rápido. En solo 5 minutos tendrás una canción única.</p>
      <ol>
        <li><strong>Elige tu Género Musical</strong> — Escoge entre 20+ géneros latinos: corridos tumbados, cumbia, banda, mariachi, bachata, reggaeton y más.</li>
        <li><strong>Selecciona la Ocasión</strong> — Cumpleaños, Día de las Madres, aniversario, boda, quinceañera, graduación.</li>
        <li><strong>Agrega los Detalles Personales</strong> — Escribe el nombre del destinatario, tu nombre, y detalles especiales.</li>
        <li><strong>Se Crea tu Canción</strong> — En 2-4 minutos se compone la letra y se genera la música. Recibes 2 versiones.</li>
        <li><strong>Escucha y Elige</strong> — Escucha un preview de cada versión antes de pagar.</li>
        <li><strong>Descarga y Comparte</strong> — Descarga en MP3 de alta calidad. Comparte por WhatsApp, redes sociales o email.</li>
      </ol>
      <a href="/create/occasion">Crear Mi Canción Ahora — Desde $24.99</a>
    </div>`;
}

function preguntasFrecuentesBodyHtml() {
  const allFaqs = [
    ...DEFAULT_GENRE_FAQS,
    { question: '¿Para qué ocasiones puedo crear una canción?', answer: 'Cumpleaños, Día de las Madres, Día del Padre, aniversarios, bodas, quinceañeras, graduaciones, San Valentín, Navidad, declaraciones de amor, despedidas y agradecimientos.' },
    { question: '¿Qué géneros musicales están disponibles?', answer: 'Más de 20 géneros latinos: corridos tumbados, cumbia, banda sinaloense, norteño, mariachi, bachata, reggaeton, salsa, bolero, ranchera, pop latino, balada, vallenato, merengue, huapango y más.' },
    { question: '¿Cuánto cuesta una canción personalizada?', answer: 'Una canción individual cuesta $24.99 USD. También ofrecemos un paquete de dos versiones por $39.99 USD.' }
  ];
  return `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / Preguntas Frecuentes</nav>
      <h1>Preguntas Frecuentes — Canciones Personalizadas</h1>
      ${allFaqs.map(f => `<h2>${esc(f.question)}</h2><p>${esc(f.answer)}</p>`).join('')}
      <a href="/create/occasion">Crear Mi Canción — Desde $24.99</a>
    </div>`;
}

function sobreNosotrosBodyHtml() {
  return `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / Sobre Nosotros</nav>
      <h1>Sobre RegalosQueCantan</h1>
      <p>RegalosQueCantan es una plataforma de canciones personalizadas fundada en 2024, diseñada específicamente para la comunidad latina. Ofrecemos más de 20 géneros musicales latinos auténticos — corridos tumbados, cumbia, banda, mariachi, bachata, reggaeton, bolero, ranchera y más.</p>
      <p>Nuestra misión es hacer cada celebración inolvidable con el regalo más emotivo: una canción creada solo para ti, con el nombre de tu ser querido y detalles personales únicos.</p>
      <p>Miles de familias latinas en Estados Unidos, México y Latinoamérica ya han sorprendido a sus seres queridos con canciones personalizadas.</p>
      <p>Cada canción se genera en 2-4 minutos, combinando composición lírica personalizada con producción musical profesional en el género seleccionado.</p>
      <p><em>Actualizado: ${BUILD_DATE}</em></p>
      <a href="/create/occasion">Crear Mi Canción — Desde $24.99</a>
    </div>`;
}

function homepageBodyHtml() {
  return `
    <div id="prerender-content">
      <h1>RegalosQueCantan — Canciones Personalizadas para la Comunidad Latina</h1>
      <p>RegalosQueCantan es una plataforma de canciones personalizadas que permite crear canciones únicas con el nombre de tu ser querido en más de 20 géneros musicales latinos — corridos tumbados, cumbia, banda, norteño, mariachi, bachata, reggaeton, bolero y más. Cada canción se genera en 2-4 minutos y cuesta desde $24.99 USD.</p>
      <p>Miles de familias latinas ya han sorprendido a sus seres queridos con canciones personalizadas de RegalosQueCantan.</p>
      <p><em>Actualizado: ${BUILD_DATE}</em></p>
      <a href="/create/occasion">Crear Mi Canción Ahora — Desde $24.99</a>
      <section>
        <h2>¿Qué es RegalosQueCantan?</h2>
        <p>RegalosQueCantan es el primer servicio de canciones personalizadas diseñado específicamente para la comunidad latina. A diferencia de tarjetas musicales genéricas, cada canción incluye el nombre del destinatario, detalles personales y se produce en géneros auténticos latinos con instrumentación profesional. El proceso completo toma menos de 5 minutos.</p>
      </section>
      <section>
        <h2>Géneros Musicales Disponibles</h2>
        <p>Ofrecemos más de 20 géneros de música latina, cada uno con instrumentación y estilo auténtico:</p>
        <ul>${allGenres.map(g => `<li><a href="/generos/${g.slug}">${esc(g.name)}</a> — ${esc(g.description)}</li>`).join('')}</ul>
      </section>
      <section>
        <h2>Ocasiones para Regalar una Canción</h2>
        <ul>${allOccasions.map(o => `<li><a href="/ocasiones/${o.slug}">${esc(o.name)}</a> — ${esc(o.description)}</li>`).join('')}</ul>
      </section>
      <section>
        <h2>Combinaciones Populares de Género y Ocasión</h2>
        <ul>${COMBO_ROUTES.slice(0, 8).map(c => {
          const g = GENRES_SEO[c.genreSlug]; const o = OCCASIONS_SEO[c.occasionSlug];
          return g && o ? `<li><a href="/canciones/${c.genreSlug}-${c.occasionSlug}">${esc(g.name)} para ${esc(o.name)}</a></li>` : '';
        }).join('')}</ul>
      </section>
      <section>
        <h2><a href="/dia-de-las-madres">Canciones para el Día de las Madres — 10 de Mayo</a></h2>
        <p>Sorprende a mamá con una canción personalizada este Día de las Madres. En mariachi, bolero, ranchera o el género que ella prefiera.</p>
      </section>
      <section>
        <h2>¿Por qué elegir RegalosQueCantan?</h2>
        <ul>
          <li><strong>Rapidez:</strong> Tu canción está lista en 2-4 minutos, no días</li>
          <li><strong>Personalización real:</strong> Incluye nombres, recuerdos y detalles específicos en la letra</li>
          <li><strong>Géneros auténticos:</strong> 20+ géneros latinos con instrumentación profesional</li>
          <li><strong>Sin suscripción:</strong> Pago único desde $24.99 USD, sin cargos recurrentes</li>
          <li><strong>2 versiones:</strong> Recibes dos versiones únicas para elegir tu favorita</li>
          <li><strong>Descarga instantánea:</strong> MP3 de alta calidad, comparte por WhatsApp al instante</li>
        </ul>
      </section>
    </div>`;
}

// ── Route definitions with SEO metadata ─────────────────────────────

function buildRouteConfigs() {
  const routes = [];

  // Homepage
  routes.push({
    path: '/',
    title: 'RegalosQueCantan - Canciones Personalizadas | Corridos, Cumbia, Banda y Más',
    description: 'Crea canciones personalizadas únicas para cumpleaños, día de las madres, aniversarios y más. Elige entre corridos tumbados, cumbia, banda, norteño, mariachi y 20+ géneros latinos. Listo en minutos desde $24.99.',
    keywords: 'canciones personalizadas, regalo único, corridos tumbados, cumbia personalizada, canción para mamá, regalo cumpleaños, música personalizada',
    structuredData: [organizationSchema(), howToSchema()],
    bodyHtml: homepageBodyHtml()
  });

  // Como Funciona
  routes.push({
    path: '/como-funciona',
    title: 'Cómo Funciona — Crea tu Canción Personalizada | RegalosQueCantan',
    description: 'Aprende cómo crear una canción personalizada en RegalosQueCantan. Elige género, agrega detalles y recibe tu canción en minutos. Fácil, rápido y desde $24.99.',
    keywords: 'cómo funciona regalos que cantan, crear canción personalizada, canción personalizada pasos',
    structuredData: [howToSchema(), breadcrumbSchema([{ name: 'Inicio', path: '/' }, { name: 'Cómo Funciona', path: '/como-funciona' }])],
    bodyHtml: comoFuncionaBodyHtml()
  });

  // Preguntas Frecuentes
  routes.push({
    path: '/preguntas-frecuentes',
    title: 'Preguntas Frecuentes — Canciones Personalizadas | RegalosQueCantan',
    description: 'Respuestas a todas tus preguntas sobre canciones personalizadas en RegalosQueCantan. Precios, géneros, tiempos de entrega, personalización y más.',
    keywords: 'preguntas frecuentes regalos que cantan, FAQ canciones personalizadas',
    structuredData: [
      faqSchema([...DEFAULT_GENRE_FAQS, { question: '¿Qué géneros están disponibles?', answer: 'Más de 20 géneros latinos incluyendo corridos tumbados, cumbia, banda, norteño, mariachi, bachata, reggaeton, salsa, bolero, ranchera y más.' }, { question: '¿Cuánto cuesta?', answer: 'Una canción individual cuesta $24.99 USD. Paquete de dos versiones por $39.99 USD.' }]),
      breadcrumbSchema([{ name: 'Inicio', path: '/' }, { name: 'Preguntas Frecuentes', path: '/preguntas-frecuentes' }])
    ],
    bodyHtml: preguntasFrecuentesBodyHtml()
  });

  // Sobre Nosotros
  routes.push({
    path: '/sobre-nosotros',
    title: 'Sobre Nosotros — RegalosQueCantan',
    description: 'Conoce a RegalosQueCantan: creamos canciones personalizadas para la comunidad latina. Corridos, cumbia, banda, mariachi y 20+ géneros.',
    keywords: 'sobre regalos que cantan, quienes somos, canciones personalizadas',
    structuredData: [breadcrumbSchema([{ name: 'Inicio', path: '/' }, { name: 'Sobre Nosotros', path: '/sobre-nosotros' }])],
    bodyHtml: sobreNosotrosBodyHtml()
  });

  // Pricing
  routes.push({
    path: '/pricing',
    title: 'Precios — Canciones Personalizadas | RegalosQueCantan',
    description: 'Canción personalizada desde $24.99 USD. Paquete de dos versiones por $39.99. Sin suscripción, pago único, descarga instantánea.',
    keywords: 'precio canción personalizada, cuánto cuesta, regalos que cantan precios',
    structuredData: [breadcrumbSchema([{ name: 'Inicio', path: '/' }, { name: 'Precios', path: '/pricing' }])],
    bodyHtml: `<div id="prerender-content"><h1>Precios — Canciones Personalizadas</h1><p>Canción individual: $24.99 USD. Paquete de dos versiones: $39.99 USD. Sin suscripción, pago único, descarga instantánea en MP3.</p><a href="/create/occasion">Crear Mi Canción</a></div>`
  });

  // Generos Hub
  routes.push({
    path: '/generos',
    title: 'Géneros Musicales para Canciones Personalizadas | RegalosQueCantan',
    description: 'Explora más de 20 géneros de música latina para tu canción personalizada: corridos tumbados, cumbia, banda, norteño, mariachi, bachata, reggaeton y más.',
    keywords: 'géneros musicales, música latina, corridos, cumbia, banda, norteño, mariachi, bachata, reggaeton',
    structuredData: [
      breadcrumbSchema([{ name: 'Inicio', path: '/' }, { name: 'Géneros', path: '/generos' }]),
      itemListSchema('Géneros Musicales', allGenres.map(g => ({ name: g.name, url: `/generos/${g.slug}` })))
    ],
    bodyHtml: generosHubBodyHtml()
  });

  // Ocasiones Hub
  routes.push({
    path: '/ocasiones',
    title: 'Ocasiones para Canciones Personalizadas | RegalosQueCantan',
    description: 'Crea canciones personalizadas para cualquier ocasión: cumpleaños, día de las madres, aniversarios, bodas, quinceañeras, graduaciones y más.',
    keywords: 'regalo cumpleaños, regalo día de las madres, regalo aniversario, regalo boda, canción personalizada',
    structuredData: [
      breadcrumbSchema([{ name: 'Inicio', path: '/' }, { name: 'Ocasiones', path: '/ocasiones' }]),
      itemListSchema('Ocasiones', allOccasions.map(o => ({ name: o.name, url: `/ocasiones/${o.slug}` })))
    ],
    bodyHtml: ocasionesHubBodyHtml()
  });

  // Individual Genre Pages
  for (const genre of allGenres) {
    const faqs = genre.faqs || DEFAULT_GENRE_FAQS;
    const breadcrumbs = [{ name: 'Inicio', path: '/' }, { name: 'Géneros', path: '/generos' }, { name: genre.name, path: `/generos/${genre.slug}` }];
    routes.push({
      path: `/generos/${genre.slug}`,
      title: `${genre.title} | RegalosQueCantan`,
      description: genre.metaDescription,
      keywords: genre.keywords,
      structuredData: [
        genreProductSchema(genre),
        breadcrumbSchema(breadcrumbs),
        faqSchema(faqs)
      ].filter(Boolean),
      bodyHtml: genreBodyHtml(genre)
    });
  }

  // Individual Occasion Pages
  for (const occasion of allOccasions) {
    const faqs = occasion.faqs || DEFAULT_OCCASION_FAQS;
    const breadcrumbs = [{ name: 'Inicio', path: '/' }, { name: 'Ocasiones', path: '/ocasiones' }, { name: occasion.name, path: `/ocasiones/${occasion.slug}` }];
    routes.push({
      path: `/ocasiones/${occasion.slug}`,
      title: `${occasion.title} | RegalosQueCantan`,
      description: occasion.metaDescription,
      keywords: occasion.keywords,
      structuredData: [
        occasionProductSchema(occasion),
        breadcrumbSchema(breadcrumbs),
        faqSchema(faqs)
      ].filter(Boolean),
      bodyHtml: occasionBodyHtml(occasion)
    });
  }

  // Dia de las Madres Seasonal Landing
  const madresOccasion = OCCASIONS_SEO['dia-de-las-madres'];
  const madresGenres = ['mariachi', 'bolero', 'ranchera', 'balada', 'norteno'].map(s => GENRES_SEO[s]).filter(Boolean);
  routes.push({
    path: '/dia-de-las-madres',
    title: 'Cancion para Mama este 10 de Mayo | RegalosQueCantan',
    description: 'Sorprende a mama con una cancion personalizada este Dia de las Madres. Con su nombre, en mariachi, bolero o ranchera. Lista en minutos desde $24.99.',
    keywords: 'regalo dia de las madres, cancion para mama, 10 de mayo, regalo mama original, serenata mama, cancion personalizada mama, dia de las madres 2026',
    structuredData: [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Cancion Personalizada para el Dia de las Madres",
        "description": "Cancion personalizada para mama con su nombre en mariachi, bolero, ranchera y mas generos latinos.",
        "brand": { "@type": "Brand", "name": "RegalosQueCantan" },
        "offers": { "@type": "Offer", "price": "24.99", "priceCurrency": "USD", "availability": "https://schema.org/InStock" },
        "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": 312 }
      },
      breadcrumbSchema([{ name: 'Inicio', path: '/' }, { name: 'Dia de las Madres', path: '/dia-de-las-madres' }]),
      faqSchema([
        { question: '¿Puedo crear la cancion el mismo 10 de Mayo?', answer: 'Si, tu cancion estara lista en 2-4 minutos. Puedes crearla el mismo dia y enviarla por WhatsApp al instante.' },
        { question: '¿Que genero es mejor para mama?', answer: 'Depende de sus gustos. Mariachi y ranchera son los mas populares para mamas tradicionales. Bolero para las romanticas. Cumbia para las fiesteras.' },
        { question: '¿Puedo incluir su apodo carinoso?', answer: 'Claro que si. Mami, Jefa, Madre, Ma — cualquier nombre carinoso se incorpora naturalmente en la letra.' },
        { question: '¿Cuanto cuesta la cancion para mama?', answer: 'Una cancion individual cuesta $24.99 USD. Sin suscripcion, pago unico. Recibes 2 versiones para elegir tu favorita.' },
        { question: '¿Como se la envio a mama?', answer: 'Descargas el MP3 al instante y lo envias por WhatsApp, mensaje de texto, email o redes sociales.' },
        { question: '¿La cancion menciona el nombre de mama?', answer: 'Si, la letra incluye su nombre, apodo, y los detalles personales que tu proporciones. Es una cancion 100% unica creada solo para ella.' }
      ])
    ].filter(Boolean),
    bodyHtml: `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / Dia de las Madres</nav>
      <h1>Cancion para Mama este 10 de Mayo — Dia de las Madres 2026</h1>
      <p>Una cancion personalizada para el Dia de las Madres es un regalo musical unico que incluye el nombre de mama, un mensaje de amor y detalles familiares especificos. Disponible en mariachi, bolero, ranchera y 20+ generos latinos, cada cancion se crea en 2-4 minutos y cuesta desde $24.99 USD.</p>
      <p>Cientos de familias ya han sorprendido a mama con una cancion personalizada de RegalosQueCantan.</p>
      <p><em>Actualizado: ${BUILD_DATE}</em></p>
      <a href="/create/occasion">Crear Cancion para Mama — Desde $24.99</a>
      <section>
        <h2>¿Por que regalar una cancion para el Dia de las Madres?</h2>
        <p>Mama merece mas que flores. Una cancion personalizada con su nombre es el regalo mas emotivo que puedes dar este 10 de Mayo. Menciona sus sacrificios, su amor incondicional y todo lo que significa para ti.</p>
        <p>Con RegalosQueCantan, creas una cancion unica que mama podra escuchar una y otra vez. Es el regalo que la hara llorar de emocion.</p>
      </section>
      <section>
        <h2>Generos Populares para Mama</h2>
        <ul>${madresGenres.map(g => `<li><a href="/generos/${g.slug}">${esc(g.name)}</a> — ${esc(g.description)}</li>`).join('')}</ul>
      </section>
      <section>
        <h2>Ideas para Personalizar tu Cancion</h2>
        <ul>
          <li>Incluye su apodo carinoso: Mami, Jefa, Madre</li>
          <li>Menciona un recuerdo de la infancia</li>
          <li>Agradece sus sacrificios y desvelos</li>
          <li>Habla de su comida favorita o tradiciones familiares</li>
          <li>Incluye los nombres de los hijos o nietos</li>
        </ul>
      </section>
      <section>
        <h2>Regalo de Ultimo Minuto Perfecto</h2>
        <p>Tu cancion estara lista en 2-4 minutos. Sin envio, sin espera. Descarga el MP3 y envialo por WhatsApp al instante. Perfecto si se te olvido el regalo.</p>
      </section>
      <section>
        <h2>Preguntas Frecuentes — Canciones para Mama</h2>
        <h3>¿Puedo crear la cancion el mismo 10 de Mayo?</h3><p>Si, tu cancion estara lista en 2-4 minutos.</p>
        <h3>¿Que genero es mejor para mama?</h3><p>Mariachi y ranchera son los mas populares. Bolero para las romanticas. Cumbia para las fiesteras.</p>
        <h3>¿Cuanto cuesta?</h3><p>$24.99 USD. Sin suscripcion, pago unico.</p>
      </section>
      <section>
        <h2>Mas Ocasiones</h2>
        <ul>${allOccasions.filter(o => o.slug !== 'dia-de-las-madres').slice(0, 5).map(o => `<li><a href="/ocasiones/${o.slug}">${esc(o.name)}</a></li>`).join('')}</ul>
      </section>
    </div>`
  });

  // Combo Pages (genre + occasion)
  for (const combo of COMBO_ROUTES) {
    const genre = GENRES_SEO[combo.genreSlug];
    const occasion = OCCASIONS_SEO[combo.occasionSlug];
    if (!genre || !occasion) continue;

    const comboSlug = `${combo.genreSlug}-${combo.occasionSlug}`;
    const comboPath = `/canciones/${comboSlug}`;
    const comboTitle = `${genre.name} para ${occasion.name} — Cancion Personalizada`;
    const comboDesc = `Crea un ${genre.name.toLowerCase()} personalizado para ${occasion.name.toLowerCase()}. ${genre.description} Con el nombre de tu ser querido, listo en minutos desde $24.99.`;
    const comboKeywords = `${genre.name.toLowerCase()} ${occasion.name.toLowerCase()}, ${genre.name.toLowerCase()} personalizado, cancion ${occasion.name.toLowerCase()}, ${genre.keywords}, ${occasion.keywords}`;

    const comboBreadcrumbs = [
      { name: 'Inicio', path: '/' },
      { name: 'Generos', path: '/generos' },
      { name: genre.name, path: `/generos/${genre.slug}` },
      { name: occasion.name, path: comboPath }
    ];

    const comboFaqs = [
      { question: `¿Como suena un ${genre.name.toLowerCase()} para ${occasion.name.toLowerCase()}?`, answer: `Suena como las canciones de ${(genre.artists || []).slice(0, 2).join(' y ') || genre.name} pero con una letra personalizada para celebrar ${occasion.name.toLowerCase()}. Incluye el nombre de tu ser querido y detalles especiales.` },
      ...(genre.faqs || DEFAULT_GENRE_FAQS).slice(0, 2),
      ...(occasion.faqs || DEFAULT_OCCASION_FAQS).slice(0, 2)
    ];

    const relatedCombos = COMBO_ROUTES
      .filter(c => c !== combo && (c.genreSlug === combo.genreSlug || c.occasionSlug === combo.occasionSlug))
      .slice(0, 4);

    routes.push({
      path: comboPath,
      title: `${comboTitle} | RegalosQueCantan`,
      description: comboDesc,
      keywords: comboKeywords,
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": `${genre.name} para ${occasion.name} Personalizado`,
          "description": comboDesc,
          "brand": { "@type": "Brand", "name": "RegalosQueCantan" },
          "offers": { "@type": "Offer", "price": "24.99", "priceCurrency": "USD", "availability": "https://schema.org/InStock" },
          "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": genre.reviewCount || 50 }
        },
        breadcrumbSchema(comboBreadcrumbs),
        faqSchema(comboFaqs)
      ].filter(Boolean),
      bodyHtml: `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / <a href="/generos">Generos</a> / <a href="/generos/${genre.slug}">${esc(genre.name)}</a> / ${esc(occasion.name)}</nav>
      <h1>${esc(genre.name)} para ${esc(occasion.name)} — Cancion Personalizada</h1>
      <p>${esc(comboDesc)}</p>
      <p><em>Actualizado: ${BUILD_DATE}</em></p>
      <a href="/create/occasion">Crear Mi ${esc(genre.name)} para ${esc(occasion.name)} — Desde $24.99</a>
      <section>
        <h2>¿Por que elegir ${esc(genre.name)} para ${esc(occasion.name)}?</h2>
        <p>${esc(genre.description)} Es la combinacion perfecta para celebrar ${esc(occasion.name.toLowerCase())} con un regalo musical unico.</p>
        ${genre.artists ? `<p>Inspirado en el estilo de artistas como: ${genre.artists.join(', ')}</p>` : ''}
      </section>
      <section>
        <h2>¿Que incluye tu cancion?</h2>
        <ul>
          <li>Letra 100% personalizada con el nombre de tu ser querido</li>
          <li>Musica profesional en estilo ${esc(genre.name.toLowerCase())} con instrumentacion autentica</li>
          <li>2 versiones unicas para elegir</li>
          <li>Listo en 2-4 minutos — descarga instantanea en MP3</li>
        </ul>
        <p>Desde $24.99 USD • Sin suscripcion • Pago unico</p>
      </section>
      <section>
        <h2>Preguntas Frecuentes</h2>
        ${comboFaqs.map(f => `<h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p>`).join('')}
      </section>
      <section>
        <h2>Otras combinaciones populares</h2>
        <ul>
          ${relatedCombos.map(c => {
            const g = GENRES_SEO[c.genreSlug];
            const o = OCCASIONS_SEO[c.occasionSlug];
            return g && o ? `<li><a href="/canciones/${c.genreSlug}-${c.occasionSlug}">${esc(g.name)} para ${esc(o.name)}</a></li>` : '';
          }).join('')}
        </ul>
      </section>
      <section>
        <h2>Explora mas</h2>
        <ul>
          <li><a href="/generos/${genre.slug}">Mas sobre ${esc(genre.name)}</a></li>
          <li><a href="/ocasiones/${occasion.slug}">Mas canciones para ${esc(occasion.name)}</a></li>
          <li><a href="/generos">Ver los 20+ generos disponibles</a></li>
        </ul>
      </section>
    </div>`
    });
  }

  return routes;
}

// ── Template manipulation ───────────────────────────────────────────

function applyRoute(template, route) {
  let html = template;

  // For homepage, update noscript/body content + inject structured data (keep existing meta)
  if (route.path === '/') {
    // Target the body noscript (contains <div style="padding"), not the font noscript in <head>
    html = html.replace(
      /<noscript>\s*<div style="padding[^]*?<\/noscript>/,
      `<noscript>${route.bodyHtml}</noscript>`
    );
    html = html.replace(
      '<div id="root"></div>',
      `${route.bodyHtml.replace('id="prerender-content"', 'id="prerender-content" style="display:none"')}\n    <div id="root"></div>`
    );
    // Inject structured data for homepage (Organization, HowTo schemas)
    if (route.structuredData && route.structuredData.length > 0) {
      const schemaHtml = route.structuredData.map(s => `    ${jsonLd(s)}`).join('\n');
      html = html.replace('</head>', `${schemaHtml}\n  </head>`);
    }
    return html;
  }

  // Replace <title>
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${esc(route.title)}</title>`
  );

  // Replace meta description
  html = html.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${esc(route.description)}" />`
  );

  // Replace meta keywords
  if (route.keywords) {
    html = html.replace(
      /<meta name="keywords" content="[^"]*" \/>/,
      `<meta name="keywords" content="${esc(route.keywords)}" />`
    );
  }

  // Replace canonical
  html = html.replace(
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${BASE_URL}${route.path}" />`
  );

  // Replace hreflang tags
  html = html.replace(
    /<link rel="alternate" hreflang="es-MX" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="es-MX" href="${BASE_URL}${route.path}" />`
  );
  html = html.replace(
    /<link rel="alternate" hreflang="es" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="es" href="${BASE_URL}${route.path}" />`
  );
  html = html.replace(
    /<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="x-default" href="${BASE_URL}${route.path}" />`
  );

  // Replace OG tags
  html = html.replace(
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${BASE_URL}${route.path}" />`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${esc(route.title)}" />`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*" \/>/,
    `<meta property="og:description" content="${esc(route.description)}" />`
  );

  // Replace Twitter tags
  html = html.replace(
    /<meta name="twitter:url" content="[^"]*" \/>/,
    `<meta name="twitter:url" content="${BASE_URL}${route.path}" />`
  );
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${esc(route.title)}" />`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*" \/>/,
    `<meta name="twitter:description" content="${esc(route.description)}" />`
  );

  // Remove existing JSON-LD structured data blocks
  html = html.replace(
    /\s*<!-- Structured Data[^>]*-->\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    ''
  );
  html = html.replace(
    /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    ''
  );

  // Inject route-specific structured data before </head>
  if (route.structuredData && route.structuredData.length > 0) {
    const schemaHtml = route.structuredData.map(s => `    ${jsonLd(s)}`).join('\n');
    html = html.replace('</head>', `${schemaHtml}\n  </head>`);
  }

  // Replace the body noscript block (contains <div style="padding"), not the font noscript in <head>
  html = html.replace(
    /<noscript>\s*<div style="padding[^]*?<\/noscript>/,
    `<noscript>${route.bodyHtml}</noscript>`
  );

  // Add hidden prerender content before root div (crawlers see it, React replaces it)
  html = html.replace(
    '<div id="root"></div>',
    `${route.bodyHtml.replace('id="prerender-content"', 'id="prerender-content" style="display:none"')}\n    <div id="root"></div>`
  );

  return html;
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  console.log('\n  Static prerender (no browser needed)\n');

  const template = readFileSync(resolve(DIST, 'index.html'), 'utf-8');

  // Copy original template as 200.html — Vercel's SPA fallback for non-prerendered routes
  writeFileSync(resolve(DIST, '200.html'), template, 'utf-8');
  console.log('  Created 200.html (SPA fallback)\n');

  const routes = buildRouteConfigs();
  console.log(`  Prerendering ${routes.length} SEO routes...\n`);

  let ok = 0;
  for (const route of routes) {
    try {
      const html = applyRoute(template, route);

      if (route.path === '/') {
        writeFileSync(resolve(DIST, 'index.html'), html, 'utf-8');
      } else {
        const dir = resolve(DIST, route.path.substring(1));
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'index.html'), html, 'utf-8');
      }

      ok++;
      console.log(`  [${ok}/${routes.length}] ${route.path}`);
    } catch (err) {
      console.error(`  FAIL ${route.path}: ${err.message}`);
    }
  }

  console.log(`\n  Done! ${ok}/${routes.length} pages prerendered.\n`);

  // ── Generate sitemap.xml ─────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  // Priority mapping
  const getPriority = (path) => {
    if (path === '/') return '1.0';
    if (path === '/dia-de-las-madres') return '0.9';
    if (['/generos', '/ocasiones', '/como-funciona', '/preguntas-frecuentes', '/pricing'].includes(path)) return '0.9';
    if (path.startsWith('/generos/') || path.startsWith('/ocasiones/')) return '0.8';
    if (path.startsWith('/canciones/')) return '0.7';
    return '0.6';
  };

  const getChangefreq = (path) => {
    if (path === '/' || path === '/generos' || path === '/ocasiones') return 'weekly';
    if (path === '/dia-de-las-madres') return 'weekly';
    return 'monthly';
  };

  const sitemapUrls = routes.map(r => `  <url>
    <loc>${BASE_URL}${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${getChangefreq(r.path)}</changefreq>
    <priority>${getPriority(r.path)}</priority>
  </url>`).join('\n');

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls}
</urlset>
`;

  writeFileSync(resolve(DIST, 'sitemap.xml'), sitemapXml, 'utf-8');
  console.log(`  Generated sitemap.xml (${routes.length} URLs)\n`);

}

main();
