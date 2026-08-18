import React, { useContext, useState } from 'react';
import { AppContext } from '../App';
import Header from '../components/Header';
import ProgressBar from '../components/ProgressBar';
import { CenzoGuide } from '../components/Cenzo';

const voiceOptions = [
  {
    id: 'female',
    name: 'Voz Femenina',
    emoji: '👩‍🎤',
    description: 'Voz suave y emotiva',
    gradient: 'from-magenta to-terra-deep',
    bgGradient: 'from-magenta/20 to-terra-deep/20'
  },
  {
    id: 'male',
    name: 'Voz Masculina',
    emoji: '👨‍🎤',
    description: 'Voz fuerte y profunda',
    gradient: 'from-anil to-anil',
    bgGradient: 'from-anil/20 to-anil/20'
  },
];

export default function VoiceStep() {
  const { navigateTo, formData, setFormData } = useContext(AppContext);
  const [selected, setSelected] = useState(formData.voiceType || '');

  const handleSelect = (voiceId) => {
    setSelected(voiceId);
  };

  const handleContinue = () => {
    if (selected) {
      setFormData({ ...formData, voiceType: selected });
      navigateTo('details');
    }
  };

  return (
    <div className="night-sky min-h-screen transition-colors">
      <Header />
      
      <main className="max-w-2xl mx-auto px-6 py-12">
        {/* Progress */}
        <div className="flex justify-center w-full mb-8">
          <ProgressBar step={4} label="Elige el tipo de voz" />
        </div>

        {/* Title */}
        <div className="text-center mb-10">
          <CenzoGuide size={132} className="mx-auto mb-2 md:mb-3" />
          <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
            ¿Qué tipo de voz prefieres?
          </h1>
          <p className="text-ink-2">
            Elige la voz que mejor represente tu canción
          </p>
        </div>

        {/* Voice Options */}
        <div className="space-y-4 mb-10">
          {voiceOptions.map((voice) => (
            <button
              key={voice.id}
              onClick={() => handleSelect(voice.id)}
              className={`w-full p-6 rounded-2xl border-2 transition-all duration-300 flex items-center gap-5 ${
                selected === voice.id
                  ? `border-primary bg-gradient-to-r ${voice.bgGradient} shadow-lg scale-[1.02]`
                  : 'border-white/15 bg-forest hover:border-primary/50 hover:shadow-md'
              }`}
            >
              {/* Icon */}
              <div className={`w-16 h-16 rounded-xl bg-gradient-to-br ${voice.gradient} flex items-center justify-center text-3xl shadow-lg`}>
                {voice.emoji}
              </div>
              
              {/* Text */}
              <div className="flex-1 text-left">
                <h3 className={`text-xl font-bold ${
                  selected === voice.id ? 'text-primary' : 'text-white'
                }`}>
                  {voice.name}
                </h3>
                <p className="text-ink-2 text-sm">
                  {voice.description}
                </p>
              </div>

              {/* Checkmark */}
              <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                selected === voice.id
                  ? 'border-primary bg-primary text-white'
                  : 'border-white/15'
              }`}>
                {selected === voice.id && (
                  <span className="material-symbols-outlined text-lg">check</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Tip */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-8">
          <p className="text-sm text-ink-2">
            <span className="text-primary font-semibold">💡 Tip:</span> Para canciones románticas, la voz del género opuesto al destinatario suele funcionar mejor. Por ejemplo, voz masculina para una mujer.
          </p>
        </div>

        {/* Navigation */}
        <div className="flex gap-4">
          <button
            onClick={() => navigateTo('names')}
            className="flex-1 py-4 rounded-xl font-semibold border-2 border-white/15 text-ink-2 hover:bg-white/5 transition-colors"
          >
            ← Atrás
          </button>
          <button
            onClick={handleContinue}
            disabled={!selected}
            className={`flex-[2] py-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 ${
              selected
                ? 'bg-primary hover:bg-primary-dark shadow-lg shadow-primary/30 hover:shadow-xl hover:scale-[1.02]'
                : 'bg-white/20 cursor-not-allowed'
            }`}
          >
            Continuar
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      </main>
    </div>
  );
}
