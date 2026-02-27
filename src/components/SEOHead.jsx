import React from 'react';
import { Helmet } from 'react-helmet-async';

/**
 * SEOHead Component
 * Handles dynamic meta tags for each page
 * 
 * Usage:
 * <SEOHead 
 *   title="Corridos Tumbados Personalizados"
 *   description="Crea un corrido tumbado único..."
 *   canonical="/generos/corridos-tumbados"
 *   ogImage="/images/genres/corridos.jpg"
 * />
 */
export default function SEOHead({ 
  title, 
  description, 
  canonical, 
  ogImage = '/images/og-image.jpg',
  ogType = 'website',
  noindex = false,
  structuredData = null,
  keywords = ''
}) {
  const baseUrl = 'https://regalosquecantan.com';
  const fullTitle = title 
    ? `${title} | RegalosQueCantan` 
    : 'RegalosQueCantan - Canciones Personalizadas con IA';
  const fullCanonical = canonical ? `${baseUrl}${canonical}` : baseUrl;
  const fullOgImage = ogImage.startsWith('http') ? ogImage : `${baseUrl}${ogImage}`;
  
  const defaultDescription = 'Crea canciones personalizadas únicas con IA para cumpleaños, día de las madres, aniversarios y más. Corridos, cumbia, banda, norteño, mariachi y 20+ géneros latinos. Desde $29.99.';
  const finalDescription = description || defaultDescription;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={finalDescription} />
      {keywords && <meta name="keywords" content={keywords} />}
      <link rel="canonical" href={fullCanonical} />
      
      {/* Robots */}
      {noindex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta name="robots" content="index, follow" />
      )}
      
      {/* Open Graph / Facebook */}
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={fullCanonical} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={finalDescription} />
      <meta property="og:image" content={fullOgImage} />
      <meta property="og:locale" content="es_MX" />
      <meta property="og:site_name" content="RegalosQueCantan" />
      
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={fullCanonical} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={finalDescription} />
      <meta name="twitter:image" content={fullOgImage} />
      
      {/* Structured Data */}
      {structuredData && (
        Array.isArray(structuredData) ? (
          structuredData.map((data, i) => (
            <script key={i} type="application/ld+json">
              {JSON.stringify(data)}
            </script>
          ))
        ) : (
          <script type="application/ld+json">
            {JSON.stringify(structuredData)}
          </script>
        )
      )}
    </Helmet>
  );
}

/**
 * Generate structured data for a genre page
 */
export function generateGenreStructuredData(genre) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `Canción de ${genre.name} Personalizada`,
    "description": genre.description,
    "brand": {
      "@type": "Brand",
      "name": "RegalosQueCantan"
    },
    "offers": {
      "@type": "Offer",
      "price": "29.99",
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

/**
 * Generate structured data for an occasion page
 */
export function generateOccasionStructuredData(occasion) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `Canción para ${occasion.name}`,
    "description": occasion.description,
    "brand": {
      "@type": "Brand",
      "name": "RegalosQueCantan"
    },
    "offers": {
      "@type": "Offer",
      "price": "29.99",
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

/**
 * Generate BreadcrumbList structured data
 */
export function generateBreadcrumbData(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      "item": `https://regalosquecantan.com${item.path}`
    }))
  };
}
