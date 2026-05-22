import React, { useContext, useState } from 'react';
import { AppContext } from '../App';
import genres from '../config/genres';

// Convert genres config to array for rendering
const genreList = Object.entries(genres).map(([id, data]) => ({
  id,
  name: data.name,
  description: data.description,
  basePrompt: data.basePrompt,
  subGenres: data.subGenres ? Object.entries(data.subGenres).map(([subId, subData]) => ({
    id: subId,
    name: subData.name,
    prompt: subData.prompt
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
  vals: 'attractions'
};

// Primary genres to show first — balanced for all occasions
const primaryGenreIds = ['corrido', 'banda', 'romantica', 'bachata', 'ranchera', 'reggaeton', 'balada', 'vals'];

export default function GenrePage() {
  const { state, dispatch, navigateTo } = useContext(AppContext);
  const [selectedGenre, setSelectedGenre] = useState(state.genre || '');
  const [selectedSubGenre, setSelectedSubGenre] = useState(state.subGenre || '');
  const [showMoreGenres, setShowMoreGenres] = useState(false);

  // Split genres into primary and secondary
  const primaryGenres = primaryGenreIds.map(id => genreList.find(g => g.id === id)).filter(Boolean);
  const secondaryGenres = genreList.filter(g => !primaryGenreIds.includes(g.id));
  const secondaryCount = secondaryGenres.length;

  // What to display based on showMore state
  const displayedGenres = showMoreGenres ? [...primaryGenres, ...secondaryGenres] : primaryGenres;

  // Get current genre object for sub-genre display
  const currentGenre = genreList.find(g => g.id === selectedGenre);

  const handleGenreSelect = (genreId) => {
    setSelectedGenre(genreId);
    setSelectedSubGenre('');
  };

  const handleSubGenreSelect = (subGenreId) => {
    setSelectedSubGenre(subGenreId);
  };

  const handleContinue = () => {
    if (selectedGenre) {
      dispatch({ type: 'SET_GENRE', payload: selectedGenre });
      if (selectedSubGenre) {
        dispatch({ type: 'SET_SUB_GENRE', payload: selectedSubGenre });
      }
      navigateTo('occasion');
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
            <span className="text-white/40 text-xs uppercase tracking-widest hidden md:block">Paso 1 de 4</span>
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
          <div className="absolute top-0 left-0 h-full w-1/4 bg-gold shadow-[0_0_10px_rgba(242,13,128,0.8)] transition-all duration-700"></div>
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
            <p className="text-white/30 text-xs uppercase tracking-widest">Puedes cambiar de género más adelante</p>
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
