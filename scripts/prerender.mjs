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
  DEFAULT_OCCASION_FAQS
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
      <a href="/create/occasion">Crear Mi ${esc(genre.name)} Ahora — Desde $24.99</a>
      <section>
        <h2>¿Qué es un ${esc(genre.name)} Personalizado?</h2>
        ${(genre.longDescription || genre.description).split('\n\n').map(p => `<p>${esc(p)}</p>`).join('')}
        ${genre.artists ? `<p>Estilo inspirado en: ${genre.artists.join(', ')}</p>` : ''}
      </section>
      <section>
        <h2>¿Qué incluye tu ${esc(genre.name)}?</h2>
        <ul>
          <li>Letra 100% personalizada con el nombre de tu ser querido</li>
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
      <p>Explora más de 20 géneros de música latina para tu canción personalizada.</p>
      <ul>${allGenres.map(g => `<li><a href="/generos/${g.slug}">${esc(g.name)}</a> — ${esc(g.description)}</li>`).join('')}</ul>
      <a href="/create/occasion">Crear Mi Canción — Desde $24.99</a>
    </div>`;
}

function ocasionesHubBodyHtml() {
  return `
    <div id="prerender-content">
      <nav aria-label="Breadcrumb"><a href="/">Inicio</a> / Ocasiones</nav>
      <h1>Ocasiones para Canciones Personalizadas</h1>
      <p>Crea canciones personalizadas para cualquier ocasión especial.</p>
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
      <p>Creamos canciones personalizadas para la comunidad latina. Corridos, cumbia, banda, mariachi y 20+ géneros latinos.</p>
      <p>Nuestra misión es hacer cada celebración inolvidable con el regalo más emotivo: una canción creada solo para ti.</p>
      <p>Con más de 127 reseñas y una calificación de 4.9/5, miles de familias latinas ya han sorprendido a sus seres queridos con canciones personalizadas.</p>
      <a href="/create/occasion">Crear Mi Canción — Desde $24.99</a>
    </div>`;
}

function homepageBodyHtml() {
  return `
    <div id="prerender-content">
      <h1>RegalosQueCantan — Canciones Personalizadas</h1>
      <p>Crea canciones personalizadas únicas para tus seres queridos en corridos, cumbia, banda, norteño, mariachi y más géneros latinos. Listo en minutos desde $24.99.</p>
      <a href="/create/occasion">Crear Mi Canción Ahora</a>
      <section>
        <h2>Géneros Disponibles</h2>
        <ul>${allGenres.map(g => `<li><a href="/generos/${g.slug}">${esc(g.name)}</a></li>`).join('')}</ul>
      </section>
      <section>
        <h2>Ocasiones</h2>
        <ul>${allOccasions.map(o => `<li><a href="/ocasiones/${o.slug}">${esc(o.name)}</a></li>`).join('')}</ul>
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
    structuredData: [],
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

  return routes;
}

// ── Template manipulation ───────────────────────────────────────────

function applyRoute(template, route) {
  let html = template;

  // For homepage, only update the noscript/body content (keep existing meta)
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
}

main();
