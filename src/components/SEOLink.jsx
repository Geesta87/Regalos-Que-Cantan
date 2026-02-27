import React, { useContext } from 'react';
import { AppContext } from '../App';

/**
 * SEOLink - Crawlable <a href> that uses SPA navigation
 *
 * Renders a real <a> tag so search engines can discover and follow links,
 * but intercepts clicks to use client-side navigation for SPA behavior.
 *
 * Usage:
 * <SEOLink to="generos" className="...">Géneros</SEOLink>
 * <SEOLink to="generos/corridos-tumbados" className="...">Corridos</SEOLink>
 */

// Maps internal page names to URL paths
const staticPageUrls = {
  landing: '/',
  landing_v2: '/v2',
  landing_premium: '/premium',
  genre: '/create/genre',
  artist: '/create/artist',
  subgenre: '/create/subgenre',
  occasion: '/create/occasion',
  names: '/create/names',
  voice: '/create/voice',
  details: '/create/details',
  email: '/create/email',
  generating: '/create/generating',
  preview: '/preview',
  comparison: '/comparison',
  success: '/success',
  listen: '/listen',
  adminLogin: '/admin',
  adminDashboard: '/admin/dashboard',
  generos: '/generos',
  ocasiones: '/ocasiones'
};

export function pageToUrl(page) {
  if (staticPageUrls[page]) return staticPageUrls[page];
  if (page.startsWith('generos/') || page.startsWith('ocasiones/')) return `/${page}`;
  return '/';
}

export default function SEOLink({ to, className, style, children, onClick, ...props }) {
  const { navigateTo } = useContext(AppContext);
  const href = pageToUrl(to);

  const handleClick = (e) => {
    // Allow cmd/ctrl+click to open in new tab
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (onClick) onClick(e);
    navigateTo(to);
  };

  return (
    <a href={href} onClick={handleClick} className={className} style={style} {...props}>
      {children}
    </a>
  );
}
