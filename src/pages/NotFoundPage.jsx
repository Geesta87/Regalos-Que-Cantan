import React, { useContext } from 'react';
import { AppContext } from '../App';
import SEOHead from '../components/SEOHead';
import SEOLink from '../components/SEOLink';

export default function NotFoundPage() {
  const { navigateTo } = useContext(AppContext);

  return (
    <>
      <SEOHead
        title="Página No Encontrada"
        description="La página que buscas no existe. Explora nuestros géneros musicales y ocasiones para crear tu canción personalizada."
        noindex={true}
      />

      <div className="min-h-screen bg-[#F9F6F2] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-8xl mb-6">🎵</div>
        <h1 className="text-4xl font-bold text-[#181114] mb-4">
          Página no encontrada
        </h1>
        <p className="text-gray-600 mb-8 max-w-md">
          Lo sentimos, esta página no existe. Pero puedes explorar nuestras canciones personalizadas.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <SEOLink
            to="landing"
            className="px-8 py-3 bg-[#181114] text-white rounded-full font-bold hover:bg-[#2a1f24] transition-colors"
          >
            Ir al Inicio
          </SEOLink>
          <SEOLink
            to="generos"
            className="px-8 py-3 border-2 border-[#181114] text-[#181114] rounded-full font-bold hover:bg-[#181114]/5 transition-colors"
          >
            Ver Géneros
          </SEOLink>
          <SEOLink
            to="ocasiones"
            className="px-8 py-3 border-2 border-[#181114] text-[#181114] rounded-full font-bold hover:bg-[#181114]/5 transition-colors"
          >
            Ver Ocasiones
          </SEOLink>
        </div>
      </div>
    </>
  );
}
