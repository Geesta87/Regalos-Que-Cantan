import React, { useContext, useState, useEffect } from 'react';
import { AppContext } from '../App';
import genres from '../config/genres';
import { trackStep } from '../services/tracking';

const occasionNames = {
  cumpleanos: 'Cumpleaños',
  aniversario: 'Aniversario',
  boda: 'Boda',
  nacimiento: 'Nacimiento',
  dia_madre: 'Día de la Madre',
  dia_padre: 'Día del Padre',
  amor: 'Amor / Pareja',
  graduacion: 'Graduación',
  amistad: 'Amistad',
  agradecimiento: 'Agradecimiento',
  navidad: 'Navidad / Reyes',
  otro: 'Ocasión Personalizada'
};

const relationshipNames = {
  pareja: 'Pareja',
  madre: 'Madre',
  padre: 'Padre',
  hijo: 'Hijo/a',
  hermano: 'Hermano/a',
  abuelo: 'Abuelo/a',
  amigo: 'Amigo/a',
  jefe: 'Jefe/Colega',
  otro: 'Otra relación'
};

export default function EmailStep() {
  const { formData, updateFormData, navigateTo } = useContext(AppContext);
  const [email, setEmail] = useState(formData.email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState('');

  // Track page view
  useEffect(() => {
    trackStep('email');
  }, []);

  // Get display names
  const genreConfig = genres[formData.genre];
  const genreName = genreConfig?.name || formData.genre;
  const subGenreName = formData.subGenre && genreConfig?.subGenres?.[formData.subGenre]?.name;
  const occasionName = formData.occasion === 'otro' 
    ? formData.customOccasion?.slice(0, 50) + '...'
    : occasionNames[formData.occasion] || formData.occasion;
  const relationshipName = formData.relationship === 'otro'
    ? formData.customRelationship
    : relationshipNames[formData.relationship] || formData.relationship;

  const validateEmail = (emailValue) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailValue);
  };

  const handleEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    setEmailError('');
  };

  const handleSubmit = async () => {
    if (!validateEmail(email)) {
      setEmailError('Por favor ingresa un email válido');
      return;
    }
    
    setIsSubmitting(true);
    updateFormData('email', email);
    
    // Navigate to generating page
    navigateTo('generating');
  };

  const handleBack = () => {
    navigateTo('details');
  };

  const handleEditSection = (section) => {
    switch(section) {
      case 'genre':
        navigateTo('genre');
        break;
      case 'occasion':
        navigateTo('occasion');
        break;
      case 'names':
        navigateTo('names');
        break;
      case 'details':
        navigateTo('details');
        break;
      default:
        break;
    }
  };

  const isValidEmail = validateEmail(email);

  return (
    <div className="bg-forest text-white antialiased min-h-screen">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-24 py-6 bg-forest/80 backdrop-blur-md">
        <div 
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigateTo('landing')}
        >
          <h2 className="font-display text-white text-xl font-medium tracking-tight">
            RegalosQueCantan
          </h2>
        </div>
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
      <main className="relative pt-28 pb-20 flex flex-col items-center justify-center overflow-hidden min-h-screen">
        {/* Background */}
        <div className="absolute inset-0 w-full h-full -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-forest via-forest to-background-dark"></div>
        </div>

        <div className="relative z-20 container mx-auto px-6 max-w-2xl">
          {/* Title */}
          <div className="text-center mb-8">
            <span className="text-gold uppercase tracking-[0.3em] text-xs font-bold mb-4 block">Casi Listos</span>
            <h1 className="font-display text-white text-4xl md:text-5xl font-bold mb-3">Confirma tu Creación</h1>
            <p className="text-white/60 text-base font-light">Revisa los detalles antes de generar tu canción.</p>
          </div>

          {/* Summary Card */}
          <div className="bg-white/5 backdrop-blur-sm border border-gold/30 rounded-2xl p-6 md:p-8 mb-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <span className="material-symbols-outlined text-6xl text-gold">auto_awesome</span>
            </div>
            <h3 className="text-gold text-sm uppercase tracking-widest font-bold mb-6 border-b border-gold/10 pb-4">
              Resumen de tu Canción
            </h3>
            
            {/* Genre & Style */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="group">
                <div className="flex items-center justify-between">
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Género Musical</p>
                  <button 
                    onClick={() => handleEditSection('genre')}
                    className="text-gold/50 hover:text-gold text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Editar
                  </button>
                </div>
                <p className="text-white text-lg font-medium">
                  {genreName}
                  {subGenreName && <span className="text-gold/70 text-sm ml-2">• {subGenreName}</span>}
                </p>
                {formData.artistInspiration && (
                  <p className="text-gold/60 text-xs mt-1">Estilo: {formData.artistInspiration}</p>
                )}
              </div>
              
              <div className="group">
                <div className="flex items-center justify-between">
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Ocasión</p>
                  <button 
                    onClick={() => handleEditSection('occasion')}
                    className="text-gold/50 hover:text-gold text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Editar
                  </button>
                </div>
                <p className="text-white text-lg font-medium">{occasionName}</p>
                {formData.emotionalTone && formData.occasion === 'otro' && (
                  <p className="text-gold/60 text-xs mt-1">Tono: {formData.emotionalTone}</p>
                )}
              </div>
            </div>

            {/* Names */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="group">
                <div className="flex items-center justify-between">
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Para</p>
                  <button 
                    onClick={() => handleEditSection('names')}
                    className="text-gold/50 hover:text-gold text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Editar
                  </button>
                </div>
                <p className="text-white text-lg font-medium">{formData.recipientName || 'No especificado'}</p>
                {relationshipName && (
                  <p className="text-gold/60 text-xs mt-1">{relationshipName}</p>
                )}
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">De parte de</p>
                <p className="text-white text-lg font-medium">{formData.senderName || 'No especificado'}</p>
              </div>
            </div>

            {/* Details Preview */}
            {formData.details && (
              <div className="pt-6 border-t border-gold/10 group">
                <div className="flex items-center justify-between">
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Tu Historia</p>
                  <button 
                    onClick={() => handleEditSection('details')}
                    className="text-gold/50 hover:text-gold text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Editar
                  </button>
                </div>
                <p className="text-white/80 italic text-sm leading-relaxed">
                  "{formData.details.slice(0, 150)}{formData.details.length > 150 ? '...' : ''}"
                </p>
                <p className="text-gold/40 text-xs mt-2">{formData.details.length} caracteres</p>
              </div>
            )}
          </div>

          {/* Email Input & Submit */}
          <div className="flex flex-col gap-6 items-center">
            <div className="w-full">
              <label className="block text-center text-gold/80 text-sm uppercase tracking-widest font-bold mb-4" htmlFor="email">
                ¿A dónde enviamos tu canción?
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  placeholder="tu@email.com"
                  className={`
                    w-full bg-transparent border-0 border-b-2 py-4 text-xl md:text-2xl text-center 
                    focus:ring-0 text-white placeholder:text-white/20 transition-all font-light
                    ${emailError ? 'border-red-400' : 'border-gold/30 focus:border-gold'}
                  `}
                />
                {emailError && (
                  <p className="text-red-400 text-xs text-center mt-2">{emailError}</p>
                )}
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!isValidEmail || isSubmitting}
              className={`
                group relative flex w-full cursor-pointer items-center justify-center overflow-hidden 
                rounded-full h-20 px-10 text-xl font-bold transition-all hover:scale-[1.02] active:scale-95
                ${isValidEmail && !isSubmitting
                  ? 'bg-bougainvillea text-white shadow-[0_0_20px_rgba(225,29,116,0.4)]'
                  : 'bg-white/10 text-white/30 cursor-not-allowed hover:scale-100'}
              `}
            >
              <span className="relative z-10">
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin material-symbols-outlined">progress_activity</span>
                    Procesando...
                  </span>
                ) : (
                  '🎤 Crear Mi Canción GRATIS'
                )}
              </span>
              {isValidEmail && !isSubmitting && (
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
              )}
            </button>

            <p className="text-white/40 text-[10px] uppercase tracking-tighter text-center">
              Al hacer clic, aceptas nuestros términos de servicio y política de privacidad.
            </p>

            <button
              onClick={handleBack}
              className="text-white/40 hover:text-white transition-colors flex items-center gap-2 text-sm uppercase tracking-widest font-medium mt-2"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Volver atrás
            </button>
          </div>

          {/* Trust badges */}
          <div className="mt-12 flex flex-wrap justify-center items-center gap-6 md:gap-12 opacity-60">
            <div className="flex items-center gap-2 border border-gold/20 rounded-lg px-4 py-2">
              <span className="material-symbols-outlined text-gold text-xl">verified_user</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white">Seguro</span>
            </div>
            <div className="flex items-center gap-2 border border-gold/20 rounded-lg px-4 py-2">
              <span className="material-symbols-outlined text-gold text-xl">high_quality</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white">Alta Calidad</span>
            </div>
            <div className="flex items-center gap-2 border border-gold/20 rounded-lg px-4 py-2">
              <span className="material-symbols-outlined text-gold text-xl">schedule</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white">~3 min</span>
            </div>
          </div>
        </div>

        {/* Decorative corners */}
        <div className="absolute top-40 left-10 w-24 h-24 border-l border-t border-gold/10 hidden lg:block"></div>
        <div className="absolute bottom-40 right-10 w-24 h-24 border-r border-b border-gold/10 hidden lg:block"></div>
      </main>

      {/* Footer */}
      <footer className="bg-background-dark py-10 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="font-display text-white/30 text-lg tracking-wider uppercase">RegalosQueCantan</div>
          <div className="flex gap-8">
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Ayuda</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Términos</a>
          </div>
          <p className="text-white/20 text-[10px] uppercase tracking-widest">© 2024 • Hecho con alma en México.</p>
        </div>
      </footer>
    </div>
  );
}
