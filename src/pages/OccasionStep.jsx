import React, { useContext, useState } from 'react';
import { AppContext } from '../App';

const occasions = [
  { id: 'cumpleanos', name: 'Cumpleaños', icon: 'cake' },
  { id: 'aniversario', name: 'Aniversario', icon: 'favorite' },
  { id: 'boda', name: 'Boda', icon: 'celebration' },
  { id: 'nacimiento', name: 'Nacimiento', icon: 'child_care' },
  { id: 'dia_madre', name: 'Día de la Madre', icon: 'home' },
  { id: 'dia_padre', name: 'Día del Padre', icon: 'potted_plant' },
  { id: 'amor', name: 'Amor / Pareja', icon: 'volunteer_activism' },
  { id: 'graduacion', name: 'Graduación', icon: 'school' },
  { id: 'amistad', name: 'Amistad', icon: 'diversity_3' },
  { id: 'agradecimiento', name: 'Agradecimiento', icon: 'redeem' },
  { id: 'navidad', name: 'Navidad / Reyes', icon: 'auto_awesome' },
  { id: 'otro', name: 'Otra Ocasión', icon: 'more_horiz' }
];

const emotionalTones = [
  { id: 'celebracion', name: 'Celebración / Alegría', icon: 'celebration' },
  { id: 'amor', name: 'Amor / Romance', icon: 'favorite' },
  { id: 'agradecimiento', name: 'Agradecimiento', icon: 'volunteer_activism' },
  { id: 'nostalgia', name: 'Nostalgia / Recuerdos', icon: 'history' },
  { id: 'motivacion', name: 'Motivación / Superación', icon: 'trending_up' },
  { id: 'despedida', name: 'Despedida / Tributo', icon: 'waving_hand' },
  { id: 'humor', name: 'Humor / Diversión', icon: 'sentiment_very_satisfied' }
];

export default function OccasionStep() {
  const { formData, updateFormData, navigateTo } = useContext(AppContext);
  const [selectedOccasion, setSelectedOccasion] = useState(formData.occasion || '');
  const [showOtroModal, setShowOtroModal] = useState(false);
  const [customOccasion, setCustomOccasion] = useState(formData.customOccasion || '');
  const [emotionalTone, setEmotionalTone] = useState(formData.emotionalTone || '');

  const handleOccasionSelect = (occasionId) => {
    setSelectedOccasion(occasionId);
    if (occasionId === 'otro') {
      setShowOtroModal(true);
    }
  };

  const handleOtroModalClose = () => {
    if (!customOccasion || customOccasion.length < 20 || !emotionalTone) {
      setSelectedOccasion('');
    }
    setShowOtroModal(false);
  };

  const handleOtroModalConfirm = () => {
    if (customOccasion.length >= 20 && emotionalTone) {
      setShowOtroModal(false);
    }
  };

  const handleContinue = () => {
    if (selectedOccasion) {
      updateFormData('occasion', selectedOccasion);
      if (selectedOccasion === 'otro') {
        updateFormData('customOccasion', customOccasion);
        updateFormData('emotionalTone', emotionalTone);
      }
      navigateTo('names');
    }
  };

  const handleBack = () => {
    navigateTo('artist');
  };

  const isOtroValid = selectedOccasion !== 'otro' || (customOccasion.length >= 20 && emotionalTone);
  const canProceed = selectedOccasion && isOtroValid;

  return (
    <div className="bg-forest text-white antialiased min-h-screen">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-24 py-6 bg-forest/80 backdrop-blur-md border-b border-white/5">
        <div 
          className="flex items-center gap-2 group cursor-pointer"
          onClick={() => navigateTo('landing')}
        >
          <h2 className="font-display text-white text-xl font-medium tracking-tight">
            RegalosQueCantan
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end mr-4">
            <span className="text-[10px] uppercase tracking-widest text-white/40">Paso 2 de 5</span>
            <span className="text-xs font-bold text-gold">Selecciona la Ocasión</span>
          </div>
          <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="w-2/5 h-full bg-gold"></div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative min-h-screen pt-32 pb-40 flex flex-col items-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 z-0">
          <div 
            className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-20"
            style={{
              backgroundImage: 'url("https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200")'
            }}
          ></div>
          <div className="absolute inset-0 bg-gradient-to-b from-forest/98 via-forest/95 to-background-dark/95"></div>
        </div>

        <div className="relative z-20 container mx-auto px-6 max-w-5xl">
          {/* Title */}
          <div className="text-center mb-12">
            <span className="text-gold uppercase tracking-[0.3em] text-[10px] font-bold mb-4 block">Personalización</span>
            <h1 className="font-display text-white text-4xl md:text-6xl font-black leading-tight tracking-tight mb-2">
              ¿Cuál es la <span className="italic font-normal">ocasión?</span>
            </h1>
            <p className="text-white/60 text-sm md:text-base font-light max-w-lg mx-auto">
              Elige el motivo de tu regalo para que podamos adaptar el ritmo y la letra a tu historia.
            </p>
          </div>

          {/* Occasions Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {occasions.map((occasion) => (
              <button
                key={occasion.id}
                onClick={() => handleOccasionSelect(occasion.id)}
                className={`
                  relative overflow-hidden transition-all duration-300 
                  flex flex-col items-center justify-center p-6 rounded-2xl 
                  backdrop-blur-sm cursor-pointer
                  ${selectedOccasion === occasion.id
                    ? 'border-gold bg-white/20 ring-1 ring-gold border'
                    : 'border border-white/10 hover:border-gold/50 hover:bg-white/10 bg-white/5'}
                `}
              >
                <span className={`material-symbols-outlined text-gold text-4xl mb-3 transition-transform ${selectedOccasion === occasion.id ? 'scale-110' : 'group-hover:scale-110'}`}>
                  {occasion.icon}
                </span>
                <span className="text-sm font-medium tracking-wide">{occasion.name}</span>
                {occasion.id === 'otro' && selectedOccasion === 'otro' && customOccasion.length >= 20 && emotionalTone && (
                  <span className="absolute top-2 right-2 material-symbols-outlined text-gold text-sm">check_circle</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Decorative corners */}
        <div className="absolute top-40 left-8 w-24 h-24 border-l border-t border-gold/10 hidden md:block"></div>
        <div className="absolute bottom-40 right-8 w-24 h-24 border-r border-b border-gold/10 hidden md:block"></div>
      </main>

      {/* Fixed Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background-dark/80 backdrop-blur-xl border-t border-white/5 py-8 px-8 md:px-24">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <button 
            onClick={handleBack}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors uppercase tracking-widest text-xs font-bold"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
            Atrás
          </button>
          <button 
            onClick={handleContinue}
            disabled={!canProceed}
            className={`
              px-12 py-4 rounded-full text-sm font-bold shadow-xl 
              transition-all hover:scale-105 active:scale-95 flex items-center gap-2
              ${canProceed
                ? 'bg-bougainvillea hover:bg-bougainvillea/90 text-white'
                : 'bg-white/10 text-white/30 cursor-not-allowed hover:scale-100'}
            `}
          >
            Continuar
            <span className="material-symbols-outlined text-lg">arrow_forward</span>
          </button>
        </div>
      </div>

      {/* "Otro" Modal */}
      {showOtroModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={handleOtroModalClose}
          ></div>
          
          <div className="relative bg-forest border border-gold/30 rounded-3xl p-8 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <button 
              onClick={handleOtroModalClose}
              className="absolute top-4 right-4 text-white/50 hover:text-white"
            >
              <span className="material-symbols-outlined">close</span>
            </button>

            <div className="text-center mb-6">
              <span className="material-symbols-outlined text-gold text-5xl mb-4">edit_note</span>
              <h3 className="font-display text-2xl font-bold text-white mb-2">Cuéntanos más</h3>
              <p className="text-white/60 text-sm">Para crear la canción perfecta, necesitamos saber más sobre esta ocasión especial.</p>
            </div>

            <div className="mb-6">
              <label className="block text-gold text-xs uppercase tracking-widest font-bold mb-2">
                Describe la ocasión *
              </label>
              <textarea
                value={customOccasion}
                onChange={(e) => setCustomOccasion(e.target.value.slice(0, 500))}
                placeholder="Ej: Es para celebrar que mi hermano abrió su propio negocio después de años de esfuerzo..."
                className="w-full h-32 bg-white/5 border border-gold/20 rounded-xl p-4 text-white focus:ring-1 focus:ring-gold focus:border-gold outline-none transition-all resize-none text-sm placeholder:text-white/30"
              />
              <div className="flex justify-between mt-2">
                <span className={`text-xs ${customOccasion.length < 20 ? 'text-red-400' : 'text-gold/60'}`}>
                  Mínimo 20 caracteres
                </span>
                <span className="text-xs text-white/40">{customOccasion.length} / 500</span>
              </div>
            </div>

            <div className="mb-8">
              <label className="block text-gold text-xs uppercase tracking-widest font-bold mb-3">
                Tono emocional *
              </label>
              <div className="grid grid-cols-1 gap-2">
                {emotionalTones.map((tone) => (
                  <button
                    key={tone.id}
                    onClick={() => setEmotionalTone(tone.id)}
                    className={`
                      flex items-center gap-3 p-3 rounded-xl text-left transition-all text-sm
                      ${emotionalTone === tone.id
                        ? 'bg-gold/20 border border-gold text-gold'
                        : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'}
                    `}
                  >
                    <span className="material-symbols-outlined text-lg">{tone.icon}</span>
                    <span className="font-medium">{tone.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleOtroModalConfirm}
              disabled={customOccasion.length < 20 || !emotionalTone}
              className={`
                w-full py-4 rounded-full font-bold transition-all flex items-center justify-center gap-2
                ${customOccasion.length >= 20 && emotionalTone
                  ? 'bg-bougainvillea text-white hover:scale-[1.02]'
                  : 'bg-white/10 text-white/30 cursor-not-allowed'}
              `}
            >
              Confirmar Ocasión
              <span className="material-symbols-outlined">check</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
