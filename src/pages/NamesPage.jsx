import React, { useContext, useState } from 'react';
import { AppContext } from '../App';

const relationships = [
  { value: 'pareja', label: 'Pareja' },
  { value: 'madre', label: 'Madre' },
  { value: 'padre', label: 'Padre' },
  { value: 'hijo', label: 'Hijo / Hija' },
  { value: 'hermano', label: 'Hermano / Hermana' },
  { value: 'abuelo', label: 'Abuelo / Abuela' },
  { value: 'amigo', label: 'Amigo / Amiga' },
  { value: 'jefe', label: 'Jefe / Colega' },
  { value: 'otro', label: 'Otro' }
];

export default function NamesPage() {
  const { navigateTo, formData, setFormData } = useContext(AppContext);
  const [recipientName, setRecipientName] = useState(formData.recipientName || '');
  const [senderName, setSenderName] = useState(formData.senderName || '');
  const [relationship, setRelationship] = useState(formData.relationship || '');

  const canContinue = recipientName.trim() && senderName.trim();

  const handleContinue = (e) => {
    e.preventDefault();
    if (!canContinue) return;
    
    setFormData(prev => ({
      ...prev,
      recipientName: recipientName.trim(),
      senderName: senderName.trim(),
      relationship: relationship
    }));
    navigateTo('details');
  };

  const handleBack = () => {
    navigateTo('occasion');
  };

  return (
    <div className="min-h-screen bg-forest text-white">
      {/* Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-20" 
          style={{backgroundImage: 'url("https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1920")'}}></div>
        <div className="hero-gradient absolute inset-0"></div>
        <div className="papel-picado-overlay absolute inset-0 text-white"></div>
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-24 py-8">
        <h2 className="font-display text-white text-2xl font-medium tracking-tight">
          RegalosQueCantan
        </h2>
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gold/40"></span>
            <span className="w-2 h-2 rounded-full bg-gold/40"></span>
            <span className="w-8 h-2 rounded-full bg-gold"></span>
            <span className="w-2 h-2 rounded-full bg-white/10"></span>
            <span className="w-2 h-2 rounded-full bg-white/10"></span>
          </div>
          <span className="text-gold text-xs font-bold uppercase tracking-widest ml-4">Paso 3 de 5</span>
        </div>
        <button 
          onClick={() => navigateTo('landing')}
          className="text-white/60 hover:text-white transition-colors md:hidden"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      {/* Main Content */}
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center overflow-y-auto py-32">
        <div className="container mx-auto px-6 max-w-xl">
          {/* Title */}
          <div className="text-center mb-12">
            <h1 className="text-white font-display text-4xl md:text-6xl font-black mb-4 leading-tight">
              ¿A quién va <br/><span className="italic text-gold">dedicada?</span>
            </h1>
            <p className="text-gold text-sm font-medium tracking-widest uppercase">Personaliza los nombres del regalo</p>
          </div>

          {/* Form */}
          <form onSubmit={handleContinue} className="space-y-8">
            <div className="space-y-6">
              {/* Recipient Name */}
              <div className="group">
                <label 
                  className="block text-white/50 text-[10px] uppercase tracking-[0.2em] font-bold mb-2 ml-1" 
                  htmlFor="recipient"
                >
                  Nombre del destinatario
                </label>
                <input 
                  id="recipient"
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Ej: María Elena"
                  className="w-full bg-background-dark/40 border-0 border-b-2 border-gold/40 focus:border-gold 
                    text-white text-lg py-4 px-1 transition-all placeholder:text-white/20
                    focus:ring-0 focus:outline-none"
                />
              </div>

              {/* Sender Name */}
              <div className="group">
                <label 
                  className="block text-white/50 text-[10px] uppercase tracking-[0.2em] font-bold mb-2 ml-1" 
                  htmlFor="sender"
                >
                  Tu nombre
                </label>
                <input 
                  id="sender"
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="Ej: Roberto"
                  className="w-full bg-background-dark/40 border-0 border-b-2 border-gold/40 focus:border-gold 
                    text-white text-lg py-4 px-1 transition-all placeholder:text-white/20
                    focus:ring-0 focus:outline-none"
                />
              </div>

              {/* Relationship */}
              <div className="group">
                <label 
                  className="block text-white/50 text-[10px] uppercase tracking-[0.2em] font-bold mb-2 ml-1" 
                  htmlFor="relation"
                >
                  Relación (opcional)
                </label>
                <select 
                  id="relation"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  className="w-full bg-background-dark/40 border-0 border-b-2 border-gold/40 focus:border-gold 
                    text-white text-lg py-4 px-1 transition-all
                    focus:ring-0 focus:outline-none appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23D4AF37' stroke-width='2'%3E%3Cpolyline points='6,9 12,15 18,9'%3E%3C/polyline%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '1.5rem'
                  }}
                >
                  <option value="" className="bg-background-dark">Selecciona el vínculo</option>
                  {relationships.map(rel => (
                    <option key={rel.value} value={rel.value} className="bg-background-dark">
                      {rel.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Buttons */}
            <div className="pt-8 flex flex-col items-center gap-6">
              <button 
                type="submit"
                disabled={!canContinue}
                className={`
                  group relative flex w-full cursor-pointer items-center justify-center 
                  overflow-hidden rounded-full h-16 text-lg font-bold shadow-2xl transition-all
                  ${canContinue 
                    ? 'bg-bougainvillea text-white hover:scale-[1.02] active:scale-95 pink-glow' 
                    : 'bg-white/10 text-white/30 cursor-not-allowed'}
                `}
              >
                <span className="relative z-10">Continuar al Paso 4</span>
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
              </button>

              <button 
                type="button"
                onClick={handleBack}
                className="text-white/40 hover:text-white transition-colors flex items-center gap-2 text-sm uppercase tracking-widest font-medium"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                Atrás
              </button>
            </div>
          </form>
        </div>

        {/* Decorative corners */}
        <div className="fixed top-32 left-8 w-24 h-24 border-l border-t border-gold/20 opacity-30 hidden md:block pointer-events-none"></div>
        <div className="fixed bottom-32 right-8 w-24 h-24 border-r border-b border-gold/20 opacity-30 hidden md:block pointer-events-none"></div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 z-20 bg-background-dark py-8 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="font-display text-white/30 text-lg">RegalosQueCantan</div>
          <p className="text-white/20 text-[10px] uppercase tracking-widest font-bold">© 2025 Inspiración y Tradición.</p>
        </div>
      </footer>
    </div>
  );
}
