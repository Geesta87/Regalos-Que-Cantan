import React, { useContext, useState, useMemo } from 'react';
import { AppContext } from '../App';

// Artists organized by genre
const artistsByGenre = {
  corrido: {
    tradicional: [
      { id: 'los_tigres', name: 'Los Tigres del Norte' },
      { id: 'los_tucanes', name: 'Los Tucanes de Tijuana' },
      { id: 'chalino', name: 'Chalino Sánchez' }
    ],
    tumbado: [
      { id: 'peso_pluma', name: 'Peso Pluma' },
      { id: 'junior_h', name: 'Junior H' },
      { id: 'natanael', name: 'Natanael Cano' },
      { id: 'fuerza_regida', name: 'Fuerza Regida' },
      { id: 'dannylux', name: 'DannyLux' }
    ],
    alterado: [
      { id: 'el_komander', name: 'El Komander' },
      { id: 'gerardo_ortiz', name: 'Gerardo Ortiz' }
    ],
    romantico: [
      { id: 'calibre_50', name: 'Calibre 50' },
      { id: 'los_tucanes', name: 'Los Tucanes de Tijuana' }
    ]
  },
  norteno: {
    tradicional: [
      { id: 'ramon_ayala', name: 'Ramón Ayala' },
      { id: 'cadetes', name: 'Los Cadetes de Linares' },
      { id: 'lalo_mora', name: 'Lalo Mora' }
    ],
    moderno: [
      { id: 'intocable', name: 'Intocable' },
      { id: 'duelo', name: 'Duelo' },
      { id: 'pesado', name: 'Pesado' }
    ],
    sax: [
      { id: 'grupo_firme', name: 'Grupo Firme' },
      { id: 'la_adictiva', name: 'La Adictiva' },
      { id: 'cuisillos', name: 'Banda Cuisillos' }
    ],
    progresivo: [
      { id: 'los_tigres', name: 'Los Tigres del Norte' },
      { id: 'huracanes', name: 'Los Huracanes del Norte' }
    ]
  },
  banda: {
    romantica: [
      { id: 'banda_ms', name: 'Banda MS' },
      { id: 'julion', name: 'Julión Álvarez' },
      { id: 'recoditos', name: 'Banda Los Recoditos' }
    ],
    quebradita: [
      { id: 'el_recodo', name: 'Banda El Recodo' },
      { id: 'banda_machos', name: 'Banda Machos' }
    ],
    ranchera: [
      { id: 'el_recodo', name: 'Banda El Recodo' },
      { id: 'arrolladora', name: 'La Arrolladora' }
    ],
    popular: [
      { id: 'cuisillos', name: 'Banda Cuisillos' },
      { id: 'arrolladora', name: 'La Arrolladora' }
    ]
  },
  ranchera: {
    brava: [
      { id: 'vicente', name: 'Vicente Fernández' },
      { id: 'antonio_aguilar', name: 'Antonio Aguilar' }
    ],
    romantica: [
      { id: 'pedro_infante', name: 'Pedro Infante' },
      { id: 'javier_solis', name: 'Javier Solís' }
    ],
    lenta: [
      { id: 'jose_alfredo', name: 'José Alfredo Jiménez' }
    ]
  },
  sierreno: {
    tradicional: [
      { id: 'el_fantasma', name: 'El Fantasma' },
      { id: 'lenin_ramirez', name: 'Lenin Ramírez' }
    ],
    moderno: [
      { id: 'carin_leon', name: 'Carin León' },
      { id: 'christian_nodal', name: 'Christian Nodal' }
    ],
    romantico: [
      { id: 'christian_nodal', name: 'Christian Nodal' },
      { id: 'carin_leon', name: 'Carin León' }
    ]
  },
  mariachi: {
    tradicional: [
      { id: 'vargas', name: 'Mariachi Vargas de Tecalitlán' }
    ],
    moderno: [
      { id: 'aida', name: 'Aida Cuevas' },
      { id: 'alejandro', name: 'Alejandro Fernández' }
    ]
  },
  cumbia: {
    sonidera: [
      { id: 'angeles_azules', name: 'Los Ángeles Azules' },
      { id: 'sonido_la_changa', name: 'Sonido La Changa' }
    ],
    nortena: [
      { id: 'cañaveral', name: 'Grupo Cañaveral' }
    ],
    romantica: [
      { id: 'cañaveral', name: 'Grupo Cañaveral' },
      { id: 'bryndis', name: 'Grupo Bryndis' }
    ],
    tejana: [
      { id: 'selena', name: 'Selena' },
      { id: 'mazz', name: 'Mazz' }
    ]
  },
  salsa: {
    dura: [
      { id: 'hector_lavoe', name: 'Héctor Lavoe' },
      { id: 'ruben_blades', name: 'Rubén Blades' }
    ],
    romantica: [
      { id: 'marc_anthony', name: 'Marc Anthony' },
      { id: 'gilberto_santa_rosa', name: 'Gilberto Santa Rosa' }
    ]
  },
  bachata: {
    tradicional: [
      { id: 'aventura', name: 'Aventura' }
    ],
    moderna: [
      { id: 'romeo_santos', name: 'Romeo Santos' },
      { id: 'prince_royce', name: 'Prince Royce' }
    ]
  },
  reggaeton: {
    clasico: [
      { id: 'daddy_yankee', name: 'Daddy Yankee' },
      { id: 'don_omar', name: 'Don Omar' }
    ],
    romantico: [
      { id: 'romeo_santos', name: 'Romeo Santos' }
    ],
    perreo: [
      { id: 'daddy_yankee', name: 'Daddy Yankee' },
      { id: 'j_balvin', name: 'J Balvin' }
    ],
    chill: [
      { id: 'bad_bunny', name: 'Bad Bunny' },
      { id: 'rauw_alejandro', name: 'Rauw Alejandro' }
    ]
  },
  latin_trap: {
    duro: [
      { id: 'anuel_aa', name: 'Anuel AA' }
    ],
    melodico: [
      { id: 'rauw_alejandro', name: 'Rauw Alejandro' },
      { id: 'bad_bunny', name: 'Bad Bunny' }
    ]
  },
  pop_latino: {
    bailable: [
      { id: 'shakira', name: 'Shakira' },
      { id: 'j_balvin', name: 'J Balvin' }
    ],
    balada: [
      { id: 'luis_fonsi', name: 'Luis Fonsi' },
      { id: 'juanes', name: 'Juanes' }
    ]
  },
  balada: {
    clasica: [
      { id: 'jose_jose', name: 'José José' },
      { id: 'luis_miguel', name: 'Luis Miguel' }
    ],
    pop: [
      { id: 'luis_fonsi', name: 'Luis Fonsi' },
      { id: 'reik', name: 'Reik' }
    ],
    ranchera: [
      { id: 'juan_gabriel', name: 'Juan Gabriel' },
      { id: 'rocio_durcal', name: 'Rocío Dúrcal' }
    ]
  },
  bolero: {
    tradicional: [
      { id: 'los_panchos', name: 'Los Panchos' },
      { id: 'armando_manzanero', name: 'Armando Manzanero' }
    ],
    moderno: [
      { id: 'luis_miguel', name: 'Luis Miguel' }
    ]
  },
  grupera: {
    romantica: [
      { id: 'los_bukis', name: 'Los Bukis' },
      { id: 'los_temerarios', name: 'Los Temerarios' }
    ],
    bailable: [
      { id: 'bronco', name: 'Bronco' },
      { id: 'limite', name: 'Límite' }
    ]
  },
  tejano: {
    cumbia: [
      { id: 'selena', name: 'Selena' },
      { id: 'kumbia_kings', name: 'Kumbia Kings' }
    ],
    ranchera: [
      { id: 'emilio_navaira', name: 'Emilio Navaira' }
    ]
  },
  // ==========================================
  // NEW: DURANGUENSE
  // ==========================================
  duranguense: {
    pasito: [
      { id: 'montez', name: 'Montéz de Durango' },
      { id: 'patrulla_81', name: 'Patrulla 81' },
      { id: 'horoscopos', name: 'Horóscopos de Durango' }
    ],
    romantico: [
      { id: 'alacranes', name: 'Alacranes Musical' },
      { id: 'kpaz', name: 'K-Paz de la Sierra' },
      { id: 'chicago_five', name: 'Chicago Five' }
    ],
    norteno_duranguense: [
      { id: 'kpaz', name: 'K-Paz de la Sierra' },
      { id: 'montez', name: 'Montéz de Durango' },
      { id: 'alacranes', name: 'Alacranes Musical' }
    ]
  },
  // ==========================================
  // NEW: ROCK EN ESPAÑOL
  // ==========================================
  rock_espanol: {
    clasico: [
      { id: 'mana', name: 'Maná' },
      { id: 'caifanes', name: 'Caifanes' },
      { id: 'soda_stereo', name: 'Soda Stereo' },
      { id: 'heroes', name: 'Héroes del Silencio' }
    ],
    balada_rock: [
      { id: 'mana', name: 'Maná' },
      { id: 'bunbury', name: 'Enrique Bunbury' },
      { id: 'alejandro_sanz', name: 'Alejandro Sanz' }
    ],
    alternativo: [
      { id: 'zoe', name: 'Zoé' },
      { id: 'cafe_tacvba', name: 'Café Tacvba' },
      { id: 'molotov', name: 'Molotov' },
      { id: 'panteon', name: 'Panteón Rococó' }
    ],
    pop_rock: [
      { id: 'juanes', name: 'Juanes' },
      { id: 'la_oreja', name: 'La Oreja de Van Gogh' },
      { id: 'sin_bandera', name: 'Sin Bandera' },
      { id: 'jesse_joy', name: 'Jesse & Joy' }
    ],
    romantico: [
      { id: 'mana', name: 'Maná' },
      { id: 'alejandro_sanz', name: 'Alejandro Sanz' },
      { id: 'sin_bandera', name: 'Sin Bandera' },
      { id: 'reik', name: 'Reik' }
    ]
  }
};

// Flatten for search
const allArtists = Object.values(artistsByGenre)
  .flatMap(subGenres => Object.values(subGenres))
  .flat()
  .filter((artist, index, self) => 
    index === self.findIndex(a => a.id === artist.id)
  );

export default function ArtistStep() {
  const { formData, updateFormData, navigateTo } = useContext(AppContext);
  const [selectedArtist, setSelectedArtist] = useState(formData.artistInspiration || '');
  const [customArtist, setCustomArtist] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Get suggested artists based on selected genre and subgenre
  const suggestedArtists = useMemo(() => {
    const genre = formData.genre;
    const subGenre = formData.subGenre;
    
    if (!genre || !artistsByGenre[genre]) {
      return [];
    }
    
    // If subgenre exists and has artists, use those
    if (subGenre && artistsByGenre[genre][subGenre]) {
      return artistsByGenre[genre][subGenre];
    }
    
    // Otherwise, combine all artists from this genre
    const genreArtists = artistsByGenre[genre];
    const combined = Object.values(genreArtists).flat();
    
    // Remove duplicates
    return combined.filter((artist, index, self) => 
      index === self.findIndex(a => a.id === artist.id)
    );
  }, [formData.genre, formData.subGenre]);

  const handleArtistSelect = (artistName) => {
    if (selectedArtist === artistName) {
      setSelectedArtist('');
    } else {
      setSelectedArtist(artistName);
      setShowCustomInput(false);
      setCustomArtist('');
    }
  };

  const handleCustomArtistChange = (value) => {
    setCustomArtist(value);
    setSelectedArtist(value);
  };

  const handleShowCustom = () => {
    setShowCustomInput(true);
    setSelectedArtist('');
  };

  const handleContinue = () => {
    // Just send the artist name - Claude generates the style dynamically
    if (selectedArtist) {
      updateFormData('artistInspiration', selectedArtist);
    } else {
      updateFormData('artistInspiration', '');
    }
    navigateTo('occasion');
  };

  const handleSkip = () => {
    updateFormData('artistInspiration', '');
    navigateTo('occasion');
  };

  const handleBack = () => {
    navigateTo('genre');
  };

  return (
    <div className="bg-forest text-white antialiased min-h-screen flex flex-col">
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
            <span className="text-[10px] uppercase tracking-widest text-white/40">Paso 1.5 de 5</span>
            <span className="text-xs font-bold text-gold">Inspiración (Opcional)</span>
          </div>
          <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="w-1/4 h-full bg-gold"></div>
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

        <div className="relative z-20 container mx-auto px-6 max-w-4xl">
          {/* Title */}
          <div className="text-center mb-10">
            <span className="text-gold uppercase tracking-[0.3em] text-[10px] font-bold mb-4 block">Opcional</span>
            <h1 className="font-display text-white text-4xl md:text-5xl font-black leading-tight tracking-tight mb-4">
              ¿Hay algún artista que te <span className="italic text-gold">inspire?</span>
            </h1>
            <p className="text-white/60 text-sm md:text-base font-light max-w-lg mx-auto">
              Esto nos ayuda a capturar mejor el estilo que buscas. Puedes saltar este paso si prefieres.
            </p>
          </div>

          {/* Suggested Artists */}
          {suggestedArtists.length > 0 && (
            <div className="mb-8">
              <h3 className="text-gold text-xs uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">auto_awesome</span>
                Artistas sugeridos para {formData.genre}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {suggestedArtists.map((artist) => (
                  <button
                    key={artist.id}
                    onClick={() => handleArtistSelect(artist.name)}
                    className={`
                      p-4 rounded-xl text-center transition-all duration-300
                      ${selectedArtist === artist.name
                        ? 'bg-gold/20 border-2 border-gold text-white ring-1 ring-gold'
                        : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-gold/30'}
                    `}
                  >
                    <span className="material-symbols-outlined text-2xl mb-2 block text-gold">person</span>
                    <span className="font-medium text-sm">{artist.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom Artist Input */}
          <div className="mb-8">
            {!showCustomInput ? (
              <button
                onClick={handleShowCustom}
                className="w-full p-4 rounded-xl bg-white/5 border border-dashed border-white/20 text-white/50 hover:bg-white/10 hover:border-gold/30 transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">edit</span>
                <span>Escribir otro artista</span>
              </button>
            ) : (
              <div className="bg-white/5 border border-gold/30 rounded-xl p-4">
                <label className="block text-gold text-xs uppercase tracking-widest font-bold mb-2">
                  Escribe el nombre del artista
                </label>
                <input
                  type="text"
                  value={customArtist}
                  onChange={(e) => handleCustomArtistChange(e.target.value)}
                  placeholder="Ej: Bad Bunny, Peso Pluma, Selena..."
                  className="w-full bg-transparent border-0 border-b border-gold/30 py-3 text-white text-lg focus:ring-0 focus:border-gold placeholder:text-white/30"
                  autoFocus
                />
                <p className="text-white/40 text-xs mt-2">
                  Nota: Los nombres de artistas no aparecerán en la canción, solo usamos esto para capturar el estilo.
                </p>
              </div>
            )}
          </div>

          {/* Selection indicator */}
          {selectedArtist && (
            <div className="bg-gold/10 border border-gold/30 rounded-xl p-4 mb-8 flex items-center gap-3">
              <span className="material-symbols-outlined text-gold">check_circle</span>
              <span className="text-white">
                Estilo inspirado en: <strong className="text-gold">{selectedArtist}</strong>
              </span>
              <button 
                onClick={() => {
                  setSelectedArtist('');
                  setCustomArtist('');
                }}
                className="ml-auto text-white/50 hover:text-white"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          {/* "No specific style" option */}
          <button
            onClick={() => {
              setSelectedArtist('');
              setCustomArtist('');
              setShowCustomInput(false);
            }}
            className={`
              w-full p-4 rounded-xl text-center transition-all mb-8
              ${!selectedArtist && !showCustomInput
                ? 'bg-white/10 border border-white/30 text-white'
                : 'bg-white/5 border border-white/10 text-white/50 hover:bg-white/10'}
            `}
          >
            <span className="material-symbols-outlined text-2xl mb-2 block">shuffle</span>
            <span className="font-medium">Sin preferencia específica</span>
            <p className="text-xs text-white/40 mt-1">Usaremos el estilo clásico del género</p>
          </button>
        </div>

        {/* Decorative corners */}
        <div className="absolute top-40 left-8 w-24 h-24 border-l border-t border-gold/10 hidden md:block"></div>
        <div className="absolute bottom-40 right-8 w-24 h-24 border-r border-b border-gold/10 hidden md:block"></div>
      </main>

      {/* Fixed Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background-dark/80 backdrop-blur-xl border-t border-white/5 py-6 px-8 md:px-24">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <button 
            onClick={handleBack}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors uppercase tracking-widest text-xs font-bold"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
            Atrás
          </button>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={handleSkip}
              className="px-6 py-3 text-white/50 hover:text-white transition-colors uppercase tracking-widest text-xs font-bold"
            >
              Omitir
            </button>
            <button 
              onClick={handleContinue}
              className="px-12 py-4 rounded-full text-sm font-bold shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 bg-bougainvillea hover:bg-bougainvillea/90 text-white"
            >
              Continuar
              <span className="material-symbols-outlined text-lg">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
