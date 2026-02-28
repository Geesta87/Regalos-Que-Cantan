import React, { useContext, useState, useEffect } from 'react';
import { AppContext } from '../App';
import genres from '../config/genres';
import { trackStep } from '../services/tracking';

// Convert genres config to array for rendering
const genreList = Object.entries(genres).map(([id, data]) => ({
  id,
  name: data.name,
  description: data.description,
  subGenres: data.subGenres ? Object.entries(data.subGenres).map(([subId, subData]) => ({
    id: subId,
    name: subData.name
  })) : []
}));

// Map genre IDs to Material Symbols icon names
const genreIcons = {
  romantica: 'favorite',
  corrido: 'music_note',
  norteno: 'library_music',
  banda: 'vibration',
  cumbia: 'lyrics',
  ranchera: 'piano',
  balada: 'favorite',
  reggaeton: 'album',
  salsa: 'nightlife',
  bachata: 'waves',
  regional: 'landscape',
  pop_latino: 'star',
  latin_trap: 'electric_bolt',
  sierreno: 'landscape',
  mariachi: 'celebration',
  bolero: 'nights_stay',
  grupera: 'groups',
  tejano: 'music_note',
  vallenato: 'library_music',
  duranguense: 'queue_music',
  merengue: 'sports_handball',
  rock_espanol: 'electric_bolt',
  vals: 'attractions'
};

// Primary genres to show first — balanced for all occasions
const primaryGenreIds = ['corrido', 'banda', 'romantica', 'bachata', 'ranchera', 'reggaeton', 'balada', 'vals'];

// Voice guidance configuration per genre/subgenre
// default: pre-selected voice, femalePopular: show female as recommended
const voiceGuidance = {
  // REGIONAL MEXICANO
  corrido: {
    _default: { default: 'male', femalePopular: false, tip: 'Los corridos tradicionalmente usan voz masculina' },
    tradicional: { default: 'male', femalePopular: false },
    tumbados: { default: 'male', femalePopular: false, tip: 'Estilo Peso Pluma = voz masculina' },
    belico: { default: 'male', femalePopular: false, maleOnly: true, tip: 'Género exclusivamente masculino' },
    alterados: { default: 'male', femalePopular: false }
  },
  norteno: {
    _default: { default: 'male', femalePopular: false },
    tradicional: { default: 'male', femalePopular: false },
    con_sax: { default: 'male', femalePopular: true, tip: 'Ambas voces funcionan muy bien' },
    nortena_banda: { default: 'male', femalePopular: false },
    romantico: { default: 'male', femalePopular: true, tip: 'Baladas norteñas funcionan con ambas voces' }
  },
  banda: {
    _default: { default: 'male', femalePopular: true },
    romantica: { default: 'male', femalePopular: true, tip: 'Banda MS tiene éxitos con ambas voces' },
    quebradita: { default: 'male', femalePopular: true },
    tecnobanda: { default: 'male', femalePopular: true },
    sinaloense_clasica: { default: 'male', femalePopular: false }
  },
  ranchera: {
    _default: { default: 'male', femalePopular: true },
    lenta: { default: 'male', femalePopular: true, tip: 'Vicente Fernández o Lola Beltrán - ambos legendarios' },
    brava: { default: 'male', femalePopular: true },
    moderna: { default: 'male', femalePopular: true, tip: 'Christian Nodal o Ángela Aguilar' }
  },
  sierreno: {
    _default: { default: 'male', femalePopular: false, tip: 'Género predominantemente masculino' },
    tradicional: { default: 'male', femalePopular: false },
    moderno_sad: { default: 'male', femalePopular: false }
  },
  mariachi: {
    _default: { default: 'male', femalePopular: true },
    tradicional: { default: 'male', femalePopular: true, tip: 'Mariachi clásico funciona con ambas voces' },
    ranchero: { default: 'male', femalePopular: true },
    romantico: { default: 'male', femalePopular: true, tip: 'Luis Miguel o voces femeninas emotivas' },
    moderno: { default: 'female', femalePopular: true, tip: '⭐ Ángela Aguilar popularizó la voz femenina moderna' }
  },
  duranguense: {
    _default: { default: 'male', femalePopular: true },
    pasito: { default: 'male', femalePopular: true },
    romantico: { default: 'male', femalePopular: true },
    norteno_duranguense: { default: 'male', femalePopular: false }
  },
  // TROPICAL
  cumbia: {
    _default: { default: 'male', femalePopular: true },
    sonidera: { default: 'male', femalePopular: true, tip: 'Los Ángeles Azules - ambas voces' },
    nortena: { default: 'male', femalePopular: false },
    texana: { default: 'female', femalePopular: true, tip: '⭐ Estilo Selena = voz femenina icónica' },
    grupera: { default: 'male', femalePopular: true },
    romantica: { default: 'male', femalePopular: true },
    colombiana: { default: 'male', femalePopular: true }
  },
  salsa: {
    _default: { default: 'male', femalePopular: true },
    clasica_dura: { default: 'male', femalePopular: true, tip: 'Héctor Lavoe o Celia Cruz' },
    romantica: { default: 'male', femalePopular: true, tip: 'Marc Anthony o La India' },
    urbana: { default: 'male', femalePopular: true }
  },
  bachata: {
    _default: { default: 'male', femalePopular: true },
    tradicional: { default: 'male', femalePopular: true },
    urbana_sensual: { default: 'male', femalePopular: true, tip: 'Romeo Santos o voces femeninas sensuales' },
    romantica: { default: 'male', femalePopular: true }
  },
  merengue: {
    _default: { default: 'male', femalePopular: true },
    clasico: { default: 'male', femalePopular: true, tip: 'Juan Luis Guerra o Milly Quezada' },
    mambo_merengue: { default: 'male', femalePopular: true },
    urbano: { default: 'male', femalePopular: true }
  },
  vallenato: {
    _default: { default: 'male', femalePopular: false },
    tradicional: { default: 'male', femalePopular: false },
    romantico: { default: 'male', femalePopular: true },
    moderno: { default: 'male', femalePopular: true }
  },
  // URBANO
  reggaeton: {
    _default: { default: 'male', femalePopular: true },
    clasico_perreo: { default: 'male', femalePopular: true, tip: 'Daddy Yankee o Ivy Queen' },
    romantico: { default: 'male', femalePopular: true, tip: 'Ozuna o Karol G' },
    comercial_pop: { default: 'male', femalePopular: true, tip: 'J Balvin o Becky G' }
  },
  latin_trap: {
    _default: { default: 'male', femalePopular: false },
    trap_pesado: { default: 'male', femalePopular: false, tip: 'Género predominantemente masculino' },
    trap_melodico: { default: 'male', femalePopular: true, tip: 'Bad Bunny o voces femeninas' },
    trap_latino: { default: 'male', femalePopular: true }
  },
  pop_latino: {
    _default: { default: 'male', femalePopular: true },
    pop_balada: { default: 'male', femalePopular: true, tip: 'Luis Miguel o baladas femeninas' },
    pop_bailable: { default: 'female', femalePopular: true, tip: '⭐ Shakira style muy popular' },
    pop_urbano: { default: 'male', femalePopular: true, tip: 'Sebastián Yatra o voces femeninas' }
  },
  // BALADAS
  balada: {
    _default: { default: 'male', femalePopular: true },
    balada_clasica: { default: 'male', femalePopular: true, tip: 'José José o Rocío Dúrcal' },
    balada_pop: { default: 'male', femalePopular: true },
    balada_romantica: { default: 'male', femalePopular: true }
  },
  bolero: {
    _default: { default: 'male', femalePopular: true },
    bolero_clasico: { default: 'male', femalePopular: true, tip: 'Los Panchos o voces femeninas clásicas' },
    bolero_ranchero: { default: 'male', femalePopular: true },
    bolero_moderno: { default: 'male', femalePopular: true, tip: 'Luis Miguel style' }
  },
  vals: {
    _default: { default: 'female', femalePopular: true, tip: 'Voz suave y elegante para vals' },
    vals_mexicano: { default: 'female', femalePopular: true, tip: 'Voz dulce para quinceañera' },
    vals_romantico: { default: 'female', femalePopular: true, tip: 'Voz emotiva para bodas' },
    vals_moderno: { default: 'female', femalePopular: true, tip: 'Voz contemporánea con arreglos pop' }
  },
  rock_espanol: {
    _default: { default: 'male', femalePopular: true },
    clasico: { default: 'male', femalePopular: true, tip: 'Maná o voces femeninas' },
    balada_rock: { default: 'male', femalePopular: true },
    alternativo: { default: 'male', femalePopular: true, tip: 'Zoé, Café Tacvba - voces diversas' },
    pop_rock: { default: 'male', femalePopular: true, tip: 'Juanes o La Oreja de Van Gogh' },
    romantico: { default: 'male', femalePopular: true }
  },
  grupera: {
    _default: { default: 'male', femalePopular: false },
    grupera_clasica: { default: 'male', femalePopular: false, tip: 'Los Bukis style' },
    grupera_romantica: { default: 'male', femalePopular: true },
    grupera_bailable: { default: 'male', femalePopular: true }
  },
  tejano: {
    _default: { default: 'male', femalePopular: true },
    tejano_clasico: { default: 'male', femalePopular: true },
    tejano_romantico: { default: 'male', femalePopular: true },
    tejano_cumbia: { default: 'female', femalePopular: true, tip: '⭐ Estilo Selena = voz femenina icónica' }
  }
};

// Helper to get voice guidance for current selection
const getVoiceGuidance = (genreId, subGenreId) => {
  const genreGuidance = voiceGuidance[genreId];
  if (!genreGuidance) return { default: 'male', femalePopular: false };
  
  // Check subgenre first, then fall back to genre default
  if (subGenreId && genreGuidance[subGenreId]) {
    return genreGuidance[subGenreId];
  }
  return genreGuidance._default || { default: 'male', femalePopular: false };
};

export default function GenreStep() {
  const { formData, updateFormData, navigateTo } = useContext(AppContext);
  const [selectedGenre, setSelectedGenre] = useState(formData.genre || '');
  const [selectedSubGenre, setSelectedSubGenre] = useState(formData.subGenre || '');
  const [selectedVoice, setSelectedVoice] = useState(formData.voiceType || 'male');
  const [showMoreGenres, setShowMoreGenres] = useState(false);

  // Track page view
  useEffect(() => {
    trackStep('genre');
  }, []);

  // Split genres
  const primaryGenres = primaryGenreIds.map(id => genreList.find(g => g.id === id)).filter(Boolean);
  const secondaryGenres = genreList.filter(g => !primaryGenreIds.includes(g.id));
  const secondaryCount = secondaryGenres.length;
  const displayedGenres = showMoreGenres ? [...primaryGenres, ...secondaryGenres] : primaryGenres;

  // Get current genre for sub-genre display
  const currentGenre = genreList.find(g => g.id === selectedGenre);
  
  // Get voice guidance for current selection
  const currentVoiceGuidance = getVoiceGuidance(selectedGenre, selectedSubGenre);

  // Update voice selection when genre/subgenre changes (set to recommended default)
  useEffect(() => {
    if (selectedGenre) {
      const guidance = getVoiceGuidance(selectedGenre, selectedSubGenre);
      // Only auto-update if user hasn't manually selected yet, or if switching genres
      if (!formData.voiceType || formData.genre !== selectedGenre) {
        setSelectedVoice(guidance.default);
      }
    }
  }, [selectedGenre, selectedSubGenre]);

  const handleGenreSelect = (genreId) => {
    setSelectedGenre(genreId);
    setSelectedSubGenre('');
  };

  const handleSubGenreSelect = (subGenreId) => {
    setSelectedSubGenre(subGenreId);
  };

  const handleVoiceSelect = (voice) => {
    setSelectedVoice(voice);
  };

  const handleContinue = () => {
    if (selectedGenre) {
      // Get the genre config to extract display names
      const genreConfig = genres[selectedGenre];
      
      // Save genre ID and NAME
      updateFormData('genre', selectedGenre);
      updateFormData('genreName', genreConfig?.name || selectedGenre);
      
      // Save subGenre ID and NAME if selected
      if (selectedSubGenre && genreConfig?.subGenres?.[selectedSubGenre]) {
        updateFormData('subGenre', selectedSubGenre);
        updateFormData('subGenreName', genreConfig.subGenres[selectedSubGenre].name || selectedSubGenre);
      } else {
        // Clear subGenre if not selected
        updateFormData('subGenre', '');
        updateFormData('subGenreName', '');
      }
      
      // Save voice type
      updateFormData('voiceType', selectedVoice);
      
      console.log('GenreStep - Saving:', {
        genre: selectedGenre,
        genreName: genreConfig?.name,
        subGenre: selectedSubGenre,
        subGenreName: genreConfig?.subGenres?.[selectedSubGenre]?.name,
        voiceType: selectedVoice
      });
      
      // Navigate to artist inspiration step
      navigateTo('artist');
    }
  };

  return (
    <div className="bg-forest text-white antialiased min-h-screen flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex flex-col pt-8 pb-4">
        <div className="flex items-center justify-between px-8 md:px-24 mb-6">
          <div 
            className="flex items-center gap-2 group cursor-pointer"
            onClick={() => navigateTo('landing')}
          >
            <h2 className="font-display text-white text-2xl font-medium tracking-tight">
              RegalosQueCantan
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-white/40 text-xs uppercase tracking-widest hidden md:block">Paso 1 de 5</span>
            <button 
              onClick={() => navigateTo('landing')}
              className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full transition-all"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-white/10 h-[1px] relative">
          <div className="absolute top-0 left-0 h-full w-[20%] bg-gold shadow-[0_0_10px_rgba(242,13,128,0.8)] transition-all duration-700"></div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative flex-grow flex flex-col items-center justify-center pt-32 pb-24 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 w-full h-full bg-forest">
          <div 
            className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-30"
            style={{
              backgroundImage: 'url("https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200")'
            }}
          ></div>
          <div className="absolute inset-0 bg-gradient-to-b from-forest/98 via-forest/95 to-background-dark/92"></div>
        </div>

        <div className="relative z-20 container mx-auto px-6 max-w-6xl">
          {/* Title */}
          <div className="text-center mb-12">
            <h1 className="font-display text-4xl md:text-6xl font-black mb-4 tracking-tight">
              Elige el <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-gold via-white/90 to-gold">Ritmo</span>
            </h1>
            <p className="text-white/60 text-lg font-light max-w-xl mx-auto">
              ¿Qué ritmo quieres para tu canción? 🎵
            </p>
          </div>

          {/* Occasions hint */}
          <div className="bg-gold/10 border border-gold/30 rounded-xl px-4 py-3 mb-8 max-w-xl mx-auto">
            <p className="text-gold text-sm text-center font-medium">🎵 Cumpleaños · Aniversarios · Bodas · Graduaciones · O simplemente porque sí ✨</p>
          </div>

          {/* Genre Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {displayedGenres.map((genre) => (
              <button
                key={genre.id}
                onClick={() => handleGenreSelect(genre.id)}
                className={`
                  relative overflow-hidden p-8 rounded-2xl flex flex-col items-center justify-center gap-4 
                  group cursor-pointer transition-all duration-300
                  bg-white/[0.03] backdrop-blur-xl border
                  ${(genre.id === 'romantica' || genre.id === 'balada' || genre.id === 'bachata' || genre.id === 'bolero' || genre.id === 'vals')
                    ? selectedGenre === genre.id
                      ? 'border-red-400 border-[3px] shadow-[0_0_25px_rgba(248,113,113,0.4)] -translate-y-1 bg-red-500/10'
                      : 'border-red-400/50 hover:border-red-400 hover:bg-red-500/10'
                    : selectedGenre === genre.id
                      ? 'border-gold border-[3px] shadow-[0_0_25px_rgba(242,13,128,0.3)] -translate-y-1'
                      : 'border-white/10 hover:border-gold/50 hover:bg-white/5'}
                `}
              >
                {(genre.id === 'romantica' || genre.id === 'balada' || genre.id === 'bachata' || genre.id === 'bolero' || genre.id === 'vals') && (
                  <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-full">❤️ Romántico</span>
                )}
                <span className={`material-symbols-outlined text-4xl transition-transform ${
                  (genre.id === 'romantica' || genre.id === 'balada' || genre.id === 'bachata' || genre.id === 'bolero' || genre.id === 'vals') 
                    ? 'text-red-400' 
                    : 'text-gold'
                } ${selectedGenre === genre.id ? 'scale-110' : 'group-hover:scale-110'}`}>
                  {genreIcons[genre.id] || 'music_note'}
                </span>
                <span className="font-display text-xl md:text-2xl font-semibold tracking-wide">{genre.name}</span>
              </button>
            ))}
          </div>

          {/* Show More Button */}
          {!showMoreGenres && secondaryCount > 0 && (
            <div className="text-center mt-8">
              <button
                onClick={() => setShowMoreGenres(true)}
                className="text-gold hover:text-white text-sm uppercase tracking-widest flex items-center gap-2 mx-auto transition-colors"
              >
                <span className="material-symbols-outlined text-sm">expand_more</span>
                Ver más géneros ({secondaryCount} más)
              </button>
            </div>
          )}

          {/* Sub-genre Selection */}
          {currentGenre && currentGenre.subGenres && currentGenre.subGenres.length > 0 && (
            <div className="mt-10 p-6 md:p-8 rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/10">
              <h3 className="text-gold text-xs uppercase tracking-[0.2em] font-bold mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">tune</span>
                Estilo de {currentGenre.name}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                {currentGenre.subGenres.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => handleSubGenreSelect(sub.id)}
                    className={`
                      p-4 rounded-xl text-center transition-all duration-200
                      ${selectedSubGenre === sub.id
                        ? 'bg-gold/20 border-2 border-gold text-gold'
                        : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white'}
                    `}
                  >
                    <span className="text-sm font-medium">{sub.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Voice Selection - Shows after genre is selected */}
          {selectedGenre && (
            <div className="mt-8 p-6 md:p-8 rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/10">
              <h3 className="text-gold text-xs uppercase tracking-[0.2em] font-bold mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">mic</span>
                Tipo de Voz
              </h3>
              
              <div className="flex flex-col md:flex-row gap-4 justify-center">
                {/* Male Voice Option */}
                <button
                  onClick={() => handleVoiceSelect('male')}
                  disabled={currentVoiceGuidance.femaleOnly}
                  className={`
                    flex-1 max-w-[280px] p-5 rounded-xl flex items-center gap-4 transition-all duration-200
                    ${selectedVoice === 'male'
                      ? 'bg-blue-500/20 border-2 border-blue-400 shadow-lg shadow-blue-500/20'
                      : 'bg-white/5 border-2 border-white/10 hover:bg-white/10 hover:border-white/30'}
                    ${currentVoiceGuidance.femaleOnly ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className={`
                    w-14 h-14 rounded-full flex items-center justify-center text-2xl
                    ${selectedVoice === 'male' ? 'bg-blue-500' : 'bg-white/10'}
                  `}>
                    👨‍🎤
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`font-bold text-lg ${selectedVoice === 'male' ? 'text-blue-400' : 'text-white'}`}>
                      Masculina
                    </p>
                    <p className="text-white/50 text-sm">Voz fuerte y profunda</p>
                  </div>
                  {selectedVoice === 'male' && (
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-sm">check</span>
                    </div>
                  )}
                </button>

                {/* Female Voice Option */}
                <button
                  onClick={() => handleVoiceSelect('female')}
                  disabled={currentVoiceGuidance.maleOnly}
                  className={`
                    flex-1 max-w-[280px] p-5 rounded-xl flex items-center gap-4 transition-all duration-200 relative
                    ${selectedVoice === 'female'
                      ? 'bg-pink-500/20 border-2 border-pink-400 shadow-lg shadow-pink-500/20'
                      : 'bg-white/5 border-2 border-white/10 hover:bg-white/10 hover:border-white/30'}
                    ${currentVoiceGuidance.maleOnly ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {/* Popular badge for female when applicable */}
                  {currentVoiceGuidance.femalePopular && !currentVoiceGuidance.maleOnly && (
                    <span className="absolute -top-2 -right-2 bg-gold text-white text-[10px] font-bold px-2 py-1 rounded-full">
                      ⭐ Popular
                    </span>
                  )}
                  <div className={`
                    w-14 h-14 rounded-full flex items-center justify-center text-2xl
                    ${selectedVoice === 'female' ? 'bg-pink-500' : 'bg-white/10'}
                  `}>
                    👩‍🎤
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`font-bold text-lg ${selectedVoice === 'female' ? 'text-pink-400' : 'text-white'}`}>
                      Femenina
                    </p>
                    <p className="text-white/50 text-sm">Voz suave y emotiva</p>
                  </div>
                  {selectedVoice === 'female' && (
                    <div className="w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-sm">check</span>
                    </div>
                  )}
                </button>
              </div>

              {/* Contextual tip */}
              {currentVoiceGuidance.tip && (
                <div className="mt-5 bg-gold/10 border border-gold/20 rounded-lg px-4 py-3 max-w-xl mx-auto">
                  <p className="text-gold/90 text-sm text-center">
                    💡 {currentVoiceGuidance.tip}
                  </p>
                </div>
              )}

              {/* Male only warning */}
              {currentVoiceGuidance.maleOnly && (
                <div className="mt-5 bg-white/5 border border-white/10 rounded-lg px-4 py-3 max-w-xl mx-auto">
                  <p className="text-white/60 text-sm text-center">
                    ℹ️ Este género tradicionalmente usa solo voz masculina
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Continue Button */}
          <div className="mt-16 flex flex-col items-center gap-6">
            <button
              onClick={handleContinue}
              disabled={!selectedGenre}
              className={`
                group relative flex min-w-[280px] md:min-w-[340px] cursor-pointer items-center justify-center 
                overflow-hidden rounded-full h-16 px-10 text-lg font-bold shadow-2xl 
                transition-all hover:scale-105 active:scale-95
                ${selectedGenre
                  ? 'bg-bougainvillea text-white'
                  : 'bg-white/10 text-white/30 cursor-not-allowed hover:scale-100'}
              `}
            >
              <span className="relative z-10 flex items-center gap-2">
                Continuar
                <span className="material-symbols-outlined">arrow_forward</span>
              </span>
              {selectedGenre && (
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
              )}
            </button>
            <p className="text-white/30 text-xs uppercase tracking-widest">Puedes cambiar estas opciones más adelante</p>
          </div>
        </div>
      </main>

      {/* Sticky Info Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-r from-gold/90 via-gold to-gold/90 text-white text-center py-3 z-50 shadow-lg">
        <p className="text-sm font-bold flex items-center justify-center gap-2">
          <span>🎵</span>
          <span>+500 canciones creadas · Tu canción lista en ~3 minutos</span>
          <span>⚡</span>
        </p>
      </div>

      {/* Footer */}
      <footer className="bg-background-dark/50 backdrop-blur-md py-6 px-8 border-t border-white/5 relative z-30">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="font-display text-white/50 text-lg">RegalosQueCantan</div>
          <div className="flex gap-8">
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-widest" href="#">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-widest" href="#">Términos</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-widest" href="#">FAQ</a>
          </div>
          <p className="text-white/20 text-[10px] uppercase tracking-tighter">© 2026 RegalosQueCantan.</p>
        </div>
      </footer>
    </div>
  );
}
