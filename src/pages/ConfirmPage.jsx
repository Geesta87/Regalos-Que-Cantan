import React, { useContext, useState } from 'react';
import { AppContext } from '../App';
import genres from '../config/genres';

// Get display names for occasions
const occasionNames = {
  cumpleanos: 'Cumpleaños',
  aniversario: 'Aniversario',
  boda: 'Boda',
  nacimiento: 'Nacimiento',
  madre: 'Día de la Madre',
  padre: 'Día del Padre',
  amor: 'Amor / Pareja',
  graduacion: 'Graduación',
  amistad: 'Amistad',
  agradecimiento: 'Agradecimiento',
  quinceanera: 'Quinceañera',
  otro: 'Otra Ocasión'
};

export default function ConfirmPage() {
  const { navigateTo, formData, setFormData } = useContext(AppContext);
  const [email, setEmail] = useState(formData.email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Get genre display name
  const genreData = genres[formData.genre];
  const genreName = genreData?.name || formData.genre;
  const subGenreName = formData.subGenre && genreData?.subGenres?.[formData.subGenre]?.name;
  const displayGenre = subGenreName ? `${genreName} - ${subGenreName}` : genreName;

  // Get occasion display name
  const occasionName = occasionNames[formData.occasion] || formData.occasion;

  // Truncate details for display
  const truncatedDetails = formData.details?.length > 100 
    ? formData.details.substring(0, 100) + '...' 
    : formData.details;

  const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const canSubmit = isValidEmail(email) && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    
    setIsSubmitting(true);
    setError('');

    // Save email to form data
    setFormData(prev => ({ ...prev, email }));

    // Navigate to generating page - the actual API call happens there
    navigateTo('generating');
  };

  const handleBack = () => {
    navigateTo('details');
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
        <h2 className="font-display text-white text-xl font-medium tracking-tight">
          RegalosQueCantan
        </h2>
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-8 h-2 rounded-full bg-gold"></div>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-gold font-bold">Paso 5 de 5</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 pt-32 pb-20 flex flex-col items-center justify-center overflow-y-auto">
        <div className="container mx-auto px-6 max-w-2xl">
          {/* Title */}
          <div className="text-center mb-10">
            <span className="text-gold uppercase tracking-[0.3em] text-xs font-bold mb-4 block">Casi Listos</span>
            <h1 className="text-white font-display text-4xl md:text-5xl font-bold mb-4">Confirma tu Creación</h1>
            <p className="text-white/60 text-lg font-light">Revisa los detalles de tu obra maestra antes de comenzar la producción.</p>
          </div>

          {/* Summary Card */}
          <div className="bg-white/5 backdrop-blur-sm border border-gold/30 rounded-2xl p-8 mb-12 relative overflow-hidden">
            {/* Decorative icon */}
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <span className="material-symbols-outlined text-6xl text-gold">auto_awesome</span>
            </div>

            <h3 className="text-gold text-sm uppercase tracking-widest font-bold mb-6 border-b border-gold/10 pb-4">
              Resumen de la Canción
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Género Musical</p>
                <p className="text-white text-xl font-medium">{displayGenre}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Ocasión</p>
                <p className="text-white text-xl font-medium">{occasionName}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Para</p>
                <p className="text-white text-xl font-medium">{formData.recipientName}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">De parte de</p>
                <p className="text-white text-xl font-medium">{formData.senderName}</p>
              </div>
            </div>

            {/* Voice Type */}
            {formData.voiceType && (
              <div className="mt-6 pt-6 border-t border-gold/10">
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Tipo de Voz</p>
                <p className="text-white text-lg font-medium">
                  {formData.voiceType === 'female' ? '🎤 Femenina' : '🎤 Masculina'}
                </p>
              </div>
            )}

            {/* Artist Inspiration */}
            {formData.artistInspiration && (
              <div className="mt-4">
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Inspirado en</p>
                <p className="text-white text-lg font-medium">🎵 {formData.artistInspiration}</p>
              </div>
            )}

            {/* Message Preview */}
            <div className="mt-6 pt-6 border-t border-gold/10">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Mensaje Principal</p>
              <p className="text-white italic text-lg">"{truncatedDetails}"</p>
            </div>
          </div>

          {/* Email Input & CTA */}
          <div className="flex flex-col gap-8 items-center">
            <div className="w-full">
              <label className="block text-center text-gold/80 text-sm uppercase tracking-widest font-bold mb-4" htmlFor="email">
                ¿A dónde enviamos tu canción?
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className="w-full bg-transparent border-0 border-b-2 border-gold/30 py-4 text-2xl md:text-3xl 
                    text-center focus:ring-0 focus:border-gold text-white placeholder:text-white/20 
                    transition-all font-light outline-none"
                />
              </div>
              {error && (
                <p className="text-bougainvillea text-sm text-center mt-2">{error}</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`
                group relative flex w-full cursor-pointer items-center justify-center 
                overflow-hidden rounded-full h-20 px-10 text-xl font-bold transition-all
                ${canSubmit 
                  ? 'bg-bougainvillea text-white hover:scale-[1.02] active:scale-95 pink-glow shadow-2xl' 
                  : 'bg-white/10 text-white/30 cursor-not-allowed'}
              `}
            >
              <span className="relative z-10">
                {isSubmitting ? (
                  <span className="flex items-center gap-3">
                    <span className="animate-spin">⏳</span> Procesando...
                  </span>
                ) : (
                  '🎤 Crear Mi Canción GRATIS'
                )}
              </span>
              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
            </button>

            <p className="text-white/40 text-[10px] uppercase tracking-tighter text-center">
              Al hacer clic, aceptas nuestros <a href="/terminos-de-servicio" className="underline hover:text-white/60">términos de servicio</a> y <a href="/politica-de-privacidad" className="underline hover:text-white/60">política de privacidad</a>.
            </p>
          </div>

          {/* Trust Badges */}
          <div className="mt-16 flex flex-wrap justify-center items-center gap-6 md:gap-12 opacity-60">
            <div className="flex items-center gap-2 border border-gold/20 rounded-lg px-4 py-2">
              <span className="material-symbols-outlined text-gold text-xl">verified_user</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white">Seguridad Total</span>
            </div>
            <div className="flex items-center gap-2 border border-gold/20 rounded-lg px-4 py-2">
              <span className="material-symbols-outlined text-gold text-xl">high_quality</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white">Alta Fidelidad</span>
            </div>
            <div className="flex items-center gap-2 border border-gold/20 rounded-lg px-4 py-2">
              <span className="material-symbols-outlined text-gold text-xl">auto_fix_high</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white">Composición Original</span>
            </div>
          </div>

          {/* Back Button */}
          <div className="mt-10 text-center">
            <button 
              onClick={handleBack}
              className="text-white/40 hover:text-white transition-colors flex items-center gap-2 mx-auto uppercase text-xs font-bold tracking-widest"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Modificar detalles
            </button>
          </div>
        </div>

        {/* Decorative corners */}
        <div className="fixed top-40 left-10 w-24 h-24 border-l border-t border-gold/10 hidden lg:block pointer-events-none"></div>
        <div className="fixed bottom-40 right-10 w-24 h-24 border-r border-b border-gold/10 hidden lg:block pointer-events-none"></div>
      </main>

      {/* Footer */}
      <footer className="relative z-20 bg-background-dark py-10 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="font-display text-white/30 text-lg tracking-wider uppercase">RegalosQueCantan</div>
          <div className="flex gap-8">
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Ayuda</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="/politica-de-privacidad">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="/terminos-de-servicio">Términos</a>
          </div>
          <p className="text-white/20 text-[10px] uppercase tracking-widest">© 2026 RegalosQueCantan</p>
        </div>
      </footer>
    </div>
  );
}
