import React, { useContext } from 'react';
import { AppContext } from '../App';
import SEOHead from '../components/SEOHead';
import SEOLink from '../components/SEOLink';
import { CenzoGuide } from '../components/Cenzo';

export default function NotFoundPage() {
  const { navigateTo } = useContext(AppContext);

  return (
    <>
      <SEOHead
        title="Página No Encontrada"
        description="La página que buscas no existe. Explora nuestros géneros musicales y ocasiones para crear tu canción personalizada."
        noindex={true}
      />

      <div className="night-sky min-h-screen flex flex-col items-center justify-center px-6 text-center text-white">
        <CenzoGuide size={210} className="mb-6" alt="Cenzo no encuentra esta página" />
        <h1 className="font-display text-4xl font-bold mb-4">
          Página no encontrada
        </h1>
        <p className="text-ink-2 mb-8 max-w-md">
          Lo sentimos, esta página no existe. Pero puedes explorar nuestras canciones personalizadas.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <SEOLink
            to="landing"
            className="px-8 py-3 bg-primary rounded-full font-bold hover:bg-primary/90 transition-colors"
          >
            Ir al Inicio
          </SEOLink>
          <SEOLink
            to="generos"
            className="px-8 py-3 border-2 border-white/25 text-white rounded-full font-bold hover:bg-white/10 transition-colors"
          >
            Ver Géneros
          </SEOLink>
          <SEOLink
            to="ocasiones"
            className="px-8 py-3 border-2 border-white/25 text-white rounded-full font-bold hover:bg-white/10 transition-colors"
          >
            Ver Ocasiones
          </SEOLink>
        </div>
      </div>
    </>
  );
}
