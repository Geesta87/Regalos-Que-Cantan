import React, { useContext, useState } from 'react';
import { AppContext } from '../App';

const inspirationTags = [
  { id: 'recuerdos', label: 'Recuerdos Especiales', icon: '✦' },
  { id: 'cualidades', label: 'Cualidades Únicas', icon: '✦' },
  { id: 'fechas', label: 'Fechas Clave', icon: '✦' },
  { id: 'lugares', label: 'Lugares Favoritos', icon: '✦' }
];

export default function DetailsPage() {
  const { navigateTo, formData, setFormData } = useContext(AppContext);
  const [details, setDetails] = useState(formData.details || '');
  const [voiceType, setVoiceType] = useState(formData.voiceType || 'male');
  const [artistInspiration, setArtistInspiration] = useState(formData.artistInspiration || '');

  const charCount = details.length;
  const maxChars = 2000;
  const canContinue = details.trim().length >= 20;

  const handleContinue = () => {
    if (!canContinue) return;
    
    setFormData(prev => ({
      ...prev,
      details: details.trim(),
      voiceType,
      artistInspiration: artistInspiration.trim()
    }));
    navigateTo('confirm');
  };

  const handleBack = () => {
    navigateTo('names');
  };

  const addInspiration = (tag) => {
    const prompts = {
      recuerdos: '\n\n📍 Recuerdos especiales: ',
      cualidades: '\n\n💫 Lo que más admiro: ',
      fechas: '\n\n📅 Fechas importantes: ',
      lugares: '\n\n🗺️ Lugares significativos: '
    };
    setDetails(prev => prev + (prompts[tag] || ''));
  };

  return (
    <div className="min-h-screen bg-forest text-white">
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="hero-gradient absolute inset-0"></div>
        <div className="papel-picado-overlay absolute inset-0 text-white"></div>
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-24 py-6">
        <h2 className="font-display text-white text-2xl font-medium tracking-tight">
          RegalosQueCantan
        </h2>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-8 h-2 rounded-full bg-gold"></div>
            <div className="w-2 h-2 rounded-full bg-white/10"></div>
          </div>
          <span className="text-gold/80 text-xs font-bold uppercase tracking-widest">Paso 4 de 5</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 pt-32 pb-20 flex flex-col items-center justify-start min-h-screen overflow-y-auto">
        <div className="container mx-auto px-6 max-w-4xl">
          {/* Title */}
          <div className="text-center mb-12">
            <span className="text-gold uppercase tracking-[0.4em] text-[10px] font-bold mb-4 block">Personaliza tu Mensaje</span>
            <h1 className="font-display text-4xl md:text-6xl font-black mb-6 leading-tight">
              Cuéntanos más <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-gold via-white to-gold">detalles</span>
            </h1>
            <p className="text-white/60 text-lg font-light max-w-xl mx-auto">
              Los mejores temas nacen de las anécdotas más pequeñas. No escatimes en detalles, nosotros les daremos rima.
            </p>
          </div>

          {/* Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Main Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Textarea */}
              <div className="relative">
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, maxChars))}
                  placeholder="Escribe aquí los momentos que nunca olvidarán, sus apodos cariñosos, o ese lugar donde todo comenzó..."
                  className="w-full h-72 bg-white/5 border border-gold/20 rounded-2xl p-6 md:p-8 
                    text-white focus:ring-1 focus:ring-gold focus:border-gold outline-none 
                    transition-all resize-none text-lg leading-relaxed placeholder:italic placeholder:text-gold/40"
                />
                <div className="absolute bottom-4 right-6 flex items-center gap-4">
                  <span className={`text-[10px] font-bold tracking-widest uppercase ${charCount > maxChars * 0.9 ? 'text-bougainvillea' : 'text-gold/60'}`}>
                    {charCount} / {maxChars} caracteres
                  </span>
                </div>
              </div>

              {/* Inspiration Tags */}
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-widest w-full mb-1">Inspiración:</span>
                  {inspirationTags.map(tag => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => addInspiration(tag.id)}
                      className="bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 rounded-full 
                        text-xs font-medium transition-all flex items-center gap-2 group"
                    >
                      <span className="text-gold group-hover:scale-110 transition-transform">{tag.icon}</span> 
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice Type Selection */}
              <div className="space-y-4 pt-4">
                <span className="text-xs font-bold text-white/40 uppercase tracking-widest block">Tipo de voz:</span>
                <div className="flex flex-wrap gap-3">
                  {[
                    { id: 'male', label: 'Masculina', icon: 'man' },
                    { id: 'female', label: 'Femenina', icon: 'woman' },
                    { id: 'duet', label: 'Dueto', icon: 'group' }
                  ].map(voice => (
                    <button
                      key={voice.id}
                      type="button"
                      onClick={() => setVoiceType(voice.id)}
                      className={`
                        px-5 py-3 rounded-xl text-sm font-medium transition-all flex items-center gap-2
                        ${voiceType === voice.id 
                          ? 'bg-gold/20 border-2 border-gold text-white' 
                          : 'bg-white/5 border border-white/10 text-white/70 hover:border-gold/50'}
                      `}
                    >
                      <span className="material-symbols-outlined text-lg">{voice.icon}</span>
                      {voice.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Artist Inspiration */}
              <div className="space-y-3 pt-2">
                <label className="text-xs font-bold text-white/40 uppercase tracking-widest block">
                  Artista de inspiración (opcional):
                </label>
                <input
                  type="text"
                  value={artistInspiration}
                  onChange={(e) => setArtistInspiration(e.target.value)}
                  placeholder="Ej: Vicente Fernández, Peso Pluma, Selena..."
                  className="w-full bg-white/5 border border-gold/20 rounded-xl p-4 
                    text-white focus:ring-1 focus:ring-gold focus:border-gold outline-none 
                    transition-all placeholder:text-white/30"
                />
                <p className="text-white/40 text-xs">
                  Menciona un artista y adaptaremos el estilo musical a su sonido característico.
                </p>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="space-y-6">
              {/* Tip Box */}
              <div className="glass-box p-6 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <span className="material-symbols-outlined text-gold">lightbulb</span>
                  <h3 className="font-bold text-sm tracking-widest uppercase">Consejo de Oro</h3>
                </div>
                <p className="text-white/70 text-sm leading-relaxed mb-4">
                  No te preocupes por la redacción. Cuanto más natural y específico sea lo que escribas, más auténtica sonará la letra.
                </p>
                <div className="pt-4 border-t border-gold/10">
                  <p className="text-[10px] text-gold/50 italic leading-snug">
                    "Por ejemplo: 'Siempre nos reímos de aquella vez que perdimos el tren en Madrid...'"
                  </p>
                </div>
              </div>

              {/* Info Box */}
              <div className="glass-box p-6 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <span className="material-symbols-outlined text-gold">auto_awesome</span>
                  <h3 className="font-bold text-sm tracking-widest uppercase">IA Compositora</h3>
                </div>
                <p className="text-white/50 text-xs leading-relaxed">
                  Nuestra inteligencia artificial seleccionará las partes más emotivas de tu relato para crear una pieza inolvidable.
                </p>
              </div>
            </aside>
          </div>

          {/* Navigation */}
          <div className="mt-12 flex flex-col md:flex-row items-center justify-between gap-8 pt-8 border-t border-white/5">
            <button 
              onClick={handleBack}
              className="text-white/40 hover:text-white transition-colors flex items-center gap-2 group uppercase text-xs font-bold tracking-[0.2em]"
            >
              <span className="material-symbols-outlined text-sm group-hover:-translate-x-1 transition-transform">arrow_back</span>
              Volver al paso anterior
            </button>

            <button
              onClick={handleContinue}
              disabled={!canContinue}
              className={`
                group relative flex min-w-[280px] cursor-pointer items-center justify-center 
                overflow-hidden rounded-full h-16 px-12 text-lg font-bold shadow-2xl transition-all
                ${canContinue 
                  ? 'bg-bougainvillea text-white hover:scale-105 active:scale-95 pink-glow' 
                  : 'bg-white/10 text-white/30 cursor-not-allowed'}
              `}
            >
              <span className="relative z-10">Continuar al último paso</span>
              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
            </button>
          </div>
        </div>

        {/* Decorative corners */}
        <div className="fixed top-32 left-8 w-32 h-32 border-l border-t border-gold/10 opacity-40 hidden xl:block pointer-events-none"></div>
        <div className="fixed bottom-32 right-8 w-32 h-32 border-r border-b border-gold/10 opacity-40 hidden xl:block pointer-events-none"></div>
      </main>

      {/* Footer */}
      <footer className="relative z-20 bg-background-dark py-12 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="font-display text-white/50 text-xl">RegalosQueCantan</div>
          <div className="flex gap-10">
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">Términos</a>
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">FAQ</a>
          </div>
          <p className="text-white/20 text-xs">© 2025 Hecho en México.</p>
        </div>
      </footer>
    </div>
  );
}
