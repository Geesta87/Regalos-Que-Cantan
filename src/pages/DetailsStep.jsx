import React, { useContext, useState } from 'react';
import { AppContext } from '../App';

const inspirationPrompts = [
  { id: 'memories', label: 'Recuerdos Especiales', prompt: '¿Qué momentos han compartido que nunca olvidarán?' },
  { id: 'qualities', label: 'Cualidades Únicas', prompt: '¿Qué hace especial a esta persona?' },
  { id: 'dates', label: 'Fechas Clave', prompt: '¿Hay fechas importantes en su historia?' },
  { id: 'places', label: 'Lugares Favoritos', prompt: '¿Hay lugares que significan algo para ustedes?' },
  { id: 'nicknames', label: 'Apodos Cariñosos', prompt: '¿Tienen apodos o palabras especiales?' },
  { id: 'dreams', label: 'Sueños y Metas', prompt: '¿Qué sueños o logros quieres celebrar?' }
];

export default function DetailsStep() {
  const { formData, updateFormData, navigateTo } = useContext(AppContext);
  const [details, setDetails] = useState(formData.details || '');
  const [activePrompt, setActivePrompt] = useState(null);
  const [showQualityWarning, setShowQualityWarning] = useState(false);

  const handleContinue = () => {
    // If details are short, show quality warning
    if (details.length > 0 && details.length < 50 && !showQualityWarning) {
      setShowQualityWarning(true);
      return;
    }
    
    updateFormData('details', details);
    navigateTo('email');
  };

  const handleContinueAnyway = () => {
    updateFormData('details', details);
    navigateTo('email');
  };

  const handleBack = () => {
    navigateTo('names');
  };

  const handlePromptClick = (prompt) => {
    if (activePrompt === prompt.id) {
      setActivePrompt(null);
    } else {
      setActivePrompt(prompt.id);
    }
  };

  const charCount = details.length;
  const maxChars = 2000;

  // Quality indicator
  const getQualityLevel = () => {
    if (charCount === 0) return { level: 'empty', label: 'Vacío', color: 'white/30' };
    if (charCount < 50) return { level: 'low', label: 'Básico', color: 'yellow-400' };
    if (charCount < 150) return { level: 'medium', label: 'Bueno', color: 'gold' };
    return { level: 'high', label: '¡Excelente!', color: 'green-400' };
  };

  const quality = getQualityLevel();

  return (
    <div className="bg-forest text-white antialiased min-h-screen">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-24 py-6 bg-forest/80 backdrop-blur-md">
        <div 
          className="flex items-center gap-2 group cursor-pointer"
          onClick={() => navigateTo('landing')}
        >
          <h2 className="font-display text-white text-2xl font-medium tracking-tight">
            RegalosQueCantan
          </h2>
        </div>
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
      <main className="relative pt-32 pb-20 flex flex-col items-center justify-start min-h-screen overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 w-full h-full pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-forest via-forest to-background-dark"></div>
        </div>

        <div className="relative z-10 container mx-auto px-6 max-w-4xl">
          {/* Title */}
          <div className="text-center mb-10">
            <span className="text-gold uppercase tracking-[0.4em] text-[10px] font-bold mb-4 block">Personaliza tu Mensaje</span>
            <h1 className="font-display text-4xl md:text-6xl font-black mb-4 leading-tight">
              Cuéntanos la <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-gold via-white to-gold">historia</span>
            </h1>
            <p className="text-white/60 text-base font-light max-w-xl mx-auto">
              Los mejores temas nacen de las anécdotas más pequeñas. Cuéntanos sobre {formData.recipientName || 'esta persona'} y su relación.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Main textarea section */}
            <div className="lg:col-span-2 space-y-4">
              {/* Active prompt hint */}
              {activePrompt && (
                <div className="bg-gold/10 border border-gold/30 rounded-xl p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-gold">lightbulb</span>
                  <div>
                    <p className="text-gold font-medium text-sm">
                      {inspirationPrompts.find(p => p.id === activePrompt)?.prompt}
                    </p>
                  </div>
                  <button 
                    onClick={() => setActivePrompt(null)}
                    className="ml-auto text-white/50 hover:text-white"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              )}

              <div className="relative">
                <textarea
                  value={details}
                  onChange={(e) => {
                    setDetails(e.target.value.slice(0, maxChars));
                    setShowQualityWarning(false);
                  }}
                  placeholder={`Escribe aquí los momentos especiales con ${formData.recipientName || 'esta persona'}, sus apodos cariñosos, o ese lugar donde todo comenzó...`}
                  className="w-full h-72 bg-white/5 border border-gold/20 rounded-2xl p-6 text-white focus:ring-1 focus:ring-gold focus:border-gold outline-none transition-all resize-none text-base leading-relaxed placeholder:italic placeholder:text-gold/40"
                />
                <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
                  {/* Quality indicator */}
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full bg-${quality.color}`}></div>
                    <span className={`text-xs font-medium text-${quality.color}`}>
                      {quality.label}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold tracking-widest text-gold/60 uppercase">
                    {charCount} / {maxChars}
                  </span>
                </div>
              </div>

              {/* Inspiration tags */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Ideas para incluir:</span>
                <div className="flex flex-wrap gap-2">
                  {inspirationPrompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      onClick={() => handlePromptClick(prompt)}
                      className={`
                        px-4 py-2 rounded-full text-xs font-medium transition-all flex items-center gap-2
                        ${activePrompt === prompt.id
                          ? 'bg-gold/20 border border-gold text-gold'
                          : 'bg-white/10 hover:bg-white/20 border border-white/10 text-white/70'}
                      `}
                    >
                      <span className="text-gold">✦</span>
                      {prompt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="space-y-6">
              <div className="bg-white/[0.03] backdrop-blur-sm border border-gold/20 p-6 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <span className="material-symbols-outlined text-gold">tips_and_updates</span>
                  <h3 className="font-bold text-sm tracking-widest uppercase">Consejo</h3>
                </div>
                <p className="text-white/70 text-sm leading-relaxed mb-4">
                  No te preocupes por la redacción. Cuanto más natural y específico sea lo que escribas, más auténtica sonará la letra.
                </p>
                <div className="pt-4 border-t border-gold/10 space-y-2">
                  <p className="text-[10px] text-gold/50 italic leading-snug">
                    "Siempre nos reímos de aquella vez que perdimos el tren en Madrid..."
                  </p>
                  <p className="text-[10px] text-gold/50 italic leading-snug">
                    "Le digo 'gordito' aunque ya no lo es..."
                  </p>
                </div>
              </div>

              <div className="bg-white/[0.03] backdrop-blur-sm border border-gold/20 p-6 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <span className="material-symbols-outlined text-gold">auto_awesome</span>
                  <h3 className="font-bold text-sm tracking-widest uppercase">Tu canción incluirá</h3>
                </div>
                <ul className="text-white/50 text-xs space-y-2">
                  <li className="flex items-center gap-2">
                    <span className="text-gold">✓</span>
                    Nombre: <span className="text-white">{formData.recipientName || '---'}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-gold">✓</span>
                    De: <span className="text-white">{formData.senderName || '---'}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-gold">✓</span>
                    Género: <span className="text-white">{formData.genre || '---'}</span>
                  </li>
                  {formData.artistInspiration && (
                    <li className="flex items-center gap-2">
                      <span className="text-gold">✓</span>
                      Estilo: <span className="text-white">{formData.artistInspiration}</span>
                    </li>
                  )}
                </ul>
              </div>
            </aside>
          </div>

          {/* Navigation */}
          <div className="mt-12 flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-white/5">
            <button
              onClick={handleBack}
              className="text-white/40 hover:text-white transition-colors flex items-center gap-2 group uppercase text-xs font-bold tracking-[0.2em]"
            >
              <span className="material-symbols-outlined text-sm group-hover:-translate-x-1 transition-transform">arrow_back</span>
              Volver
            </button>
            <button
              onClick={handleContinue}
              className="group relative flex min-w-[280px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-12 bg-bougainvillea text-white text-lg font-bold shadow-2xl transition-all hover:scale-105 active:scale-95"
            >
              <span className="relative z-10 flex items-center gap-2">
                Continuar
                <span className="material-symbols-outlined">arrow_forward</span>
              </span>
              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
            </button>
          </div>
        </div>

        {/* Decorative corners */}
        <div className="absolute top-32 left-8 w-32 h-32 border-l border-t border-gold/10 opacity-40 hidden xl:block"></div>
        <div className="absolute bottom-32 right-8 w-32 h-32 border-r border-b border-gold/10 opacity-40 hidden xl:block"></div>
      </main>

      {/* Quality Warning Modal */}
      {showQualityWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowQualityWarning(false)}
          ></div>
          
          <div className="relative bg-forest border border-gold/30 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <div className="text-center mb-6">
              <span className="material-symbols-outlined text-yellow-400 text-5xl mb-4">info</span>
              <h3 className="font-display text-2xl font-bold text-white mb-2">¿Pocos detalles?</h3>
              <p className="text-white/60 text-sm">
                Las canciones con más detalles son mucho más personales y emotivas. 
                ¿Te gustaría agregar más información sobre {formData.recipientName}?
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-4 mb-6">
              <p className="text-gold text-xs uppercase tracking-widest font-bold mb-2">Ideas:</p>
              <ul className="text-white/70 text-sm space-y-1">
                <li>• Un recuerdo especial que compartieron</li>
                <li>• Un apodo cariñoso</li>
                <li>• Algo que hace única a esta persona</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowQualityWarning(false)}
                className="flex-1 py-4 rounded-full font-bold bg-gold/20 text-gold hover:bg-gold/30 transition-all"
              >
                Agregar más
              </button>
              <button
                onClick={handleContinueAnyway}
                className="flex-1 py-4 rounded-full font-bold bg-white/10 text-white/70 hover:bg-white/20 transition-all"
              >
                Continuar así
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-background-dark py-10 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="font-display text-white/50 text-xl">RegalosQueCantan</div>
          <div className="flex gap-10">
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">Términos</a>
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">FAQ</a>
          </div>
          <p className="text-white/20 text-xs">© 2024 Hecho en México.</p>
        </div>
      </footer>
    </div>
  );
}
