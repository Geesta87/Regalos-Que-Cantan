import React, { useContext } from 'react';
import { AppContext } from '../App';

const steps = [
  { id: 1, name: 'Género', page: 'genre' },
  { id: 2, name: 'Ocasión', page: 'occasion' },
  { id: 3, name: 'Nombres', page: 'names' },
  { id: 4, name: 'Historia', page: 'details' },
  { id: 5, name: 'Confirmar', page: 'email' },
];

export default function ProgressBar({ step, totalSteps = 5, label = '' }) {
  const { navigateTo } = useContext(AppContext);
  const percentage = Math.round((step / totalSteps) * 100);

  const handleStepClick = (targetStep) => {
    // Only allow navigation to previous or current steps
    if (targetStep <= step) {
      navigateTo(steps[targetStep - 1].page);
    }
  };

  return (
    <div className="w-full max-w-[640px] mb-8">
      <div className="flex justify-between items-end mb-3">
        <div>
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary mb-1 block">
            Creación de Canción
          </span>
          <h3 className="text-sm font-semibold text-white">
            Paso {step} de {totalSteps}
          </h3>
        </div>
        <p className="text-sm font-medium text-ink-2">
          {percentage}% completado
        </p>
      </div>
      
      {/* Progress bar */}
      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden mb-4">
        <div 
          className="h-full bg-primary rounded-full transition-all duration-700 ease-out" 
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Clickable step indicators */}
      <div className="flex justify-between items-center">
        {steps.map((s) => (
          <button
            key={s.id}
            onClick={() => handleStepClick(s.id)}
            disabled={s.id > step}
            className={`flex flex-col items-center gap-1 transition-all ${
              s.id <= step 
                ? 'cursor-pointer hover:opacity-80' 
                : 'cursor-not-allowed opacity-40'
            }`}
            title={s.id <= step ? `Ir a ${s.name}` : 'Completa los pasos anteriores'}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
              s.id < step
                ? 'bg-primary text-white'
                : s.id === step
                  ? 'bg-primary text-white ring-4 ring-primary/20'
                  : 'bg-white/15 text-ink-2'
            }`}>
              {s.id < step ? (
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
              ) : (
                s.id
              )}
            </div>
            <span className={`text-[10px] font-medium hidden sm:block ${
              s.id <= step ? 'text-primary' : 'text-ink-2'
            }`}>
              {s.name}
            </span>
          </button>
        ))}
      </div>

      {label && (
        <p className="mt-4 text-sm text-ink-3 dark:text-ink-2 italic text-center">{label}</p>
      )}
    </div>
  );
}
