import React, { useContext, useState, useMemo, useEffect, useRef } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';

// Artists organized by genre AND subgenre
// Keys MUST match genres.js exactly for filtering to work
const artistsByGenre = {
  // ==========================================
  // CORRIDO - 4 subgenres
  // ==========================================
  corrido: {
    tradicional: [
      { id: 'los_tigres', name: 'Los Tigres del Norte' },
      { id: 'los_tucanes', name: 'Los Tucanes de Tijuana' },
      { id: 'chalino', name: 'Chalino Sánchez' }
    ],
    tumbados: [
      { id: 'peso_pluma', name: 'Peso Pluma' },
      { id: 'junior_h', name: 'Junior H' },
      { id: 'natanael', name: 'Natanael Cano' },
      { id: 'fuerza_regida', name: 'Fuerza Regida' },
      { id: 'dannylux', name: 'DannyLux' }
    ],
    belico: [
      { id: 'luis_r', name: 'Luis R Conriquez' },
      { id: 'fuerza_regida', name: 'Fuerza Regida' },
      { id: 'peso_pluma', name: 'Peso Pluma' }
    ],
    alterados: [
      { id: 'el_komander', name: 'El Komander' },
      { id: 'gerardo_ortiz', name: 'Gerardo Ortiz' },
      { id: 'roberto_tapia', name: 'Roberto Tapia' }
    ]
  },

  // ==========================================
  // NORTEÑO - 4 subgenres
  // ==========================================
  norteno: {
    tradicional: [
      { id: 'ramon_ayala', name: 'Ramón Ayala' },
      { id: 'cadetes', name: 'Los Cadetes de Linares' },
      { id: 'lalo_mora', name: 'Lalo Mora' }
    ],
    con_sax: [
      { id: 'pesado', name: 'Pesado' },
      { id: 'duelo', name: 'Duelo' },
      { id: 'la_adictiva', name: 'La Adictiva' }
    ],
    nortena_banda: [
      { id: 'calibre_50', name: 'Calibre 50' },
      { id: 'grupo_firme', name: 'Grupo Firme' },
      { id: 'la_adictiva', name: 'La Adictiva' }
    ],
    romantico: [
      { id: 'intocable', name: 'Intocable' },
      { id: 'duelo', name: 'Duelo' },
      { id: 'pesado', name: 'Pesado' }
    ]
  },

  // ==========================================
  // BANDA - 4 subgenres
  // ==========================================
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
    tecnobanda: [
      { id: 'cuisillos', name: 'Banda Cuisillos' },
      { id: 'banda_machos', name: 'Banda Machos' }
    ],
    sinaloense_clasica: [
      { id: 'el_recodo', name: 'Banda El Recodo' },
      { id: 'arrolladora', name: 'La Arrolladora' }
    ]
  },

  // ==========================================
  // RANCHERA - 3 subgenres
  // ==========================================
  ranchera: {
    lenta: [
      { id: 'vicente', name: 'Vicente Fernández' },
      { id: 'pedro_infante', name: 'Pedro Infante' },
      { id: 'javier_solis', name: 'Javier Solís' }
    ],
    brava: [
      { id: 'vicente', name: 'Vicente Fernández' },
      { id: 'antonio_aguilar', name: 'Antonio Aguilar' },
      { id: 'pepe_aguilar', name: 'Pepe Aguilar' }
    ],
    moderna: [
      { id: 'christian_nodal', name: 'Christian Nodal' },
      { id: 'carin_leon', name: 'Carin León' },
      { id: 'angela_aguilar', name: 'Ángela Aguilar' }
    ]
  },

  // ==========================================
  // SIERREÑO - 2 subgenres
  // ==========================================
  sierreno: {
    tradicional: [
      { id: 'el_fantasma', name: 'El Fantasma' },
      { id: 'lenin_ramirez', name: 'Lenin Ramírez' },
      { id: 'alfredo_olivas', name: 'Alfredo Olivas' }
    ],
    moderno_sad: [
      { id: 'carin_leon', name: 'Carin León' },
      { id: 'christian_nodal', name: 'Christian Nodal' },
      { id: 'junior_h', name: 'Junior H' }
    ]
  },

  // ==========================================
  // MARIACHI - 4 subgenres
  // ==========================================
  mariachi: {
    tradicional: [
      { id: 'vargas', name: 'Mariachi Vargas de Tecalitlán' }
    ],
    ranchero: [
      { id: 'vicente', name: 'Vicente Fernández' },
      { id: 'pedro_infante', name: 'Pedro Infante' }
    ],
    romantico: [
      { id: 'luis_miguel', name: 'Luis Miguel' },
      { id: 'alejandro_fernandez', name: 'Alejandro Fernández' }
    ],
    moderno: [
      { id: 'angela_aguilar', name: 'Ángela Aguilar' },
      { id: 'christian_nodal', name: 'Christian Nodal' }
    ]
  },

  // ==========================================
  // DURANGUENSE - 3 subgenres
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
  // CUMBIA - 6 subgenres
  // ==========================================
  cumbia: {
    sonidera: [
      { id: 'angeles_azules', name: 'Los Ángeles Azules' },
      { id: 'sonido_la_changa', name: 'Sonido La Changa' }
    ],
    nortena: [
      { id: 'canaveral', name: 'Grupo Cañaveral' },
      { id: 'intocable', name: 'Intocable' }
    ],
    texana: [
      { id: 'selena', name: 'Selena' },
      { id: 'mazz', name: 'Mazz' },
      { id: 'kumbia_kings', name: 'Kumbia Kings' }
    ],
    grupera: [
      { id: 'los_bukis', name: 'Los Bukis' },
      { id: 'canaveral', name: 'Grupo Cañaveral' }
    ],
    romantica: [
      { id: 'bryndis', name: 'Grupo Bryndis' },
      { id: 'canaveral', name: 'Grupo Cañaveral' }
    ],
    colombiana: [
      { id: 'carlos_vives', name: 'Carlos Vives' },
      { id: 'grupo_niche', name: 'Grupo Niche' }
    ]
  },

  // ==========================================
  // SALSA - 3 subgenres
  // ==========================================
  salsa: {
    clasica_dura: [
      { id: 'hector_lavoe', name: 'Héctor Lavoe' },
      { id: 'ruben_blades', name: 'Rubén Blades' },
      { id: 'willie_colon', name: 'Willie Colón' }
    ],
    romantica: [
      { id: 'marc_anthony', name: 'Marc Anthony' },
      { id: 'gilberto_santa_rosa', name: 'Gilberto Santa Rosa' }
    ],
    urbana: [
      { id: 'marc_anthony', name: 'Marc Anthony' },
      { id: 'victor_manuelle', name: 'Víctor Manuelle' }
    ]
  },

  // ==========================================
  // BACHATA - 3 subgenres
  // ==========================================
  bachata: {
    tradicional: [
      { id: 'aventura', name: 'Aventura' },
      { id: 'frank_reyes', name: 'Frank Reyes' }
    ],
    urbana_sensual: [
      { id: 'romeo_santos', name: 'Romeo Santos' },
      { id: 'prince_royce', name: 'Prince Royce' }
    ],
    romantica: [
      { id: 'frank_reyes', name: 'Frank Reyes' },
      { id: 'aventura', name: 'Aventura' }
    ]
  },

  // ==========================================
  // MERENGUE - 3 subgenres
  // ==========================================
  merengue: {
    clasico: [
      { id: 'juan_luis_guerra', name: 'Juan Luis Guerra' },
      { id: 'wilfrido_vargas', name: 'Wilfrido Vargas' }
    ],
    mambo_merengue: [
      { id: 'hermanos_rosario', name: 'Los Hermanos Rosario' },
      { id: 'sergio_vargas', name: 'Sergio Vargas' }
    ],
    urbano: [
      { id: 'elvis_crespo', name: 'Elvis Crespo' },
      { id: 'olga_tanon', name: 'Olga Tañón' }
    ]
  },

  // ==========================================
  // VALLENATO - 3 subgenres
  // ==========================================
  vallenato: {
    tradicional: [
      { id: 'diomedes', name: 'Diomedes Díaz' },
      { id: 'rafael_orozco', name: 'Rafael Orozco' }
    ],
    romantico: [
      { id: 'jorge_celedon', name: 'Jorge Celedón' },
      { id: 'silvestre', name: 'Silvestre Dangond' }
    ],
    moderno: [
      { id: 'carlos_vives', name: 'Carlos Vives' },
      { id: 'silvestre', name: 'Silvestre Dangond' }
    ]
  },

  // ==========================================
  // REGGAETON - 3 subgenres
  // ==========================================
  reggaeton: {
    clasico_perreo: [
      { id: 'daddy_yankee', name: 'Daddy Yankee' },
      { id: 'don_omar', name: 'Don Omar' },
      { id: 'wisin_yandel', name: 'Wisin & Yandel' }
    ],
    romantico: [
      { id: 'ozuna', name: 'Ozuna' },
      { id: 'romeo_santos', name: 'Romeo Santos' }
    ],
    comercial_pop: [
      { id: 'j_balvin', name: 'J Balvin' },
      { id: 'maluma', name: 'Maluma' },
      { id: 'bad_bunny', name: 'Bad Bunny' }
    ]
  },

  // ==========================================
  // LATIN TRAP - 3 subgenres
  // ==========================================
  latin_trap: {
    trap_pesado: [
      { id: 'anuel_aa', name: 'Anuel AA' },
      { id: 'bad_bunny', name: 'Bad Bunny' }
    ],
    trap_melodico: [
      { id: 'bad_bunny', name: 'Bad Bunny' },
      { id: 'rauw_alejandro', name: 'Rauw Alejandro' }
    ],
    trap_latino: [
      { id: 'bad_bunny', name: 'Bad Bunny' },
      { id: 'ozuna', name: 'Ozuna' }
    ]
  },

  // ==========================================
  // POP LATINO - 3 subgenres
  // ==========================================
  pop_latino: {
    pop_balada: [
      { id: 'luis_miguel', name: 'Luis Miguel' },
      { id: 'luis_fonsi', name: 'Luis Fonsi' }
    ],
    pop_bailable: [
      { id: 'shakira', name: 'Shakira' },
      { id: 'j_balvin', name: 'J Balvin' }
    ],
    pop_urbano: [
      { id: 'sebastian_yatra', name: 'Sebastián Yatra' },
      { id: 'camilo', name: 'Camilo' }
    ]
  },

  // ==========================================
  // ROMÁNTICA - 5 subgenres (Catch-all romantic)
  // ==========================================
  romantica: {
    romantica_suave: [
      { id: 'luis_miguel', name: 'Luis Miguel' },
      { id: 'ricardo_montaner', name: 'Ricardo Montaner' },
      { id: 'alejandro_fernandez', name: 'Alejandro Fernández' },
      { id: 'reik', name: 'Reik' }
    ],
    romantica_apasionada: [
      { id: 'jose_jose', name: 'José José' },
      { id: 'juan_gabriel', name: 'Juan Gabriel' },
      { id: 'marc_anthony', name: 'Marc Anthony' },
      { id: 'sin_bandera', name: 'Sin Bandera' }
    ],
    romantica_alegre: [
      { id: 'carlos_vives', name: 'Carlos Vives' },
      { id: 'shakira', name: 'Shakira' },
      { id: 'camilo', name: 'Camilo' },
      { id: 'sebastian_yatra', name: 'Sebastián Yatra' }
    ],
    romantica_nostalgica: [
      { id: 'jose_jose', name: 'José José' },
      { id: 'rocio_durcal', name: 'Rocío Dúrcal' },
      { id: 'armando_manzanero', name: 'Armando Manzanero' },
      { id: 'los_panchos', name: 'Los Panchos' }
    ],
    romantica_serenata: [
      { id: 'vicente', name: 'Vicente Fernández' },
      { id: 'luis_miguel', name: 'Luis Miguel' },
      { id: 'pedro_infante', name: 'Pedro Infante' },
      { id: 'alejandro_fernandez', name: 'Alejandro Fernández' }
    ]
  },

  // ==========================================
  // BALADA - 3 subgenres
  // ==========================================
  balada: {
    balada_clasica: [
      { id: 'jose_jose', name: 'José José' },
      { id: 'luis_miguel', name: 'Luis Miguel' },
      { id: 'rocio_durcal', name: 'Rocío Dúrcal' }
    ],
    balada_pop: [
      { id: 'luis_fonsi', name: 'Luis Fonsi' },
      { id: 'reik', name: 'Reik' }
    ],
    balada_romantica: [
      { id: 'ricardo_montaner', name: 'Ricardo Montaner' },
      { id: 'juan_gabriel', name: 'Juan Gabriel' }
    ]
  },

  // ==========================================
  // BOLERO - 3 subgenres
  // ==========================================
  bolero: {
    bolero_clasico: [
      { id: 'los_panchos', name: 'Los Panchos' },
      { id: 'armando_manzanero', name: 'Armando Manzanero' }
    ],
    bolero_ranchero: [
      { id: 'vicente', name: 'Vicente Fernández' },
      { id: 'pedro_infante', name: 'Pedro Infante' }
    ],
    bolero_moderno: [
      { id: 'luis_miguel', name: 'Luis Miguel' }
    ]
  },

  // ==========================================
  // ROCK EN ESPAÑOL - 5 subgenres
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
      { id: 'molotov', name: 'Molotov' }
    ],
    pop_rock: [
      { id: 'juanes', name: 'Juanes' },
      { id: 'la_oreja', name: 'La Oreja de Van Gogh' },
      { id: 'jesse_joy', name: 'Jesse & Joy' }
    ],
    romantico: [
      { id: 'mana', name: 'Maná' },
      { id: 'alejandro_sanz', name: 'Alejandro Sanz' },
      { id: 'sin_bandera', name: 'Sin Bandera' },
      { id: 'reik', name: 'Reik' }
    ]
  },

  // ==========================================
  // GRUPERA - 3 subgenres
  // ==========================================
  grupera: {
    grupera_clasica: [
      { id: 'los_bukis', name: 'Los Bukis' },
      { id: 'bronco', name: 'Bronco' }
    ],
    grupera_romantica: [
      { id: 'los_temerarios', name: 'Los Temerarios' },
      { id: 'los_bukis', name: 'Los Bukis' }
    ],
    grupera_bailable: [
      { id: 'bronco', name: 'Bronco' },
      { id: 'limite', name: 'Límite' }
    ]
  },

  // ==========================================
  // TEJANO - 3 subgenres
  // ==========================================
  tejano: {
    tejano_clasico: [
      { id: 'little_joe', name: 'Little Joe' },
      { id: 'emilio_navaira', name: 'Emilio Navaira' }
    ],
    tejano_romantico: [
      { id: 'la_mafia', name: 'La Mafia' },
      { id: 'emilio_navaira', name: 'Emilio Navaira' }
    ],
    tejano_cumbia: [
      { id: 'selena', name: 'Selena' },
      { id: 'kumbia_kings', name: 'Kumbia Kings' }
    ]
  }
};

// Flatten for search (not used in filtering, but useful for search feature)
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
  const [isAutoAdvancing, setIsAutoAdvancing] = useState(false);
  const autoAdvanceTimer = useRef(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    };
  }, []);

  // Track page view
  useEffect(() => {
    trackStep('artist');
  }, []);

  // Get suggested artists based on selected genre and subgenre
  const suggestedArtists = useMemo(() => {
    const genre = formData.genre;
    const subGenre = formData.subGenre;
    
    console.log('ArtistStep - Genre:', genre, 'SubGenre:', subGenre);
    
    if (!genre || !artistsByGenre[genre]) {
      console.log('No genre or genre not found in artistsByGenre');
      return [];
    }
    
    // If subgenre exists and has artists, use ONLY those (strict filtering)
    if (subGenre && artistsByGenre[genre][subGenre]) {
      console.log('Found artists for subgenre:', artistsByGenre[genre][subGenre]);
      return artistsByGenre[genre][subGenre];
    }
    
    // If subgenre not found, log warning and show all for genre
    if (subGenre) {
      console.warn(`SubGenre "${subGenre}" not found in artistsByGenre.${genre}. Available keys:`, Object.keys(artistsByGenre[genre]));
    }
    
    // Fallback: combine all artists from this genre (only if no subgenre selected)
    const genreArtists = artistsByGenre[genre];
    const combined = Object.values(genreArtists).flat();
    
    // Remove duplicates
    return combined.filter((artist, index, self) => 
      index === self.findIndex(a => a.id === artist.id)
    );
  }, [formData.genre, formData.subGenre]);

  const handleArtistSelect = (artistName) => {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    if (selectedArtist === artistName) {
      setSelectedArtist('');
      setIsAutoAdvancing(false);
    } else {
      setSelectedArtist(artistName);
      setShowCustomInput(false);
      setCustomArtist('');
      // Auto-advance after selection
      setIsAutoAdvancing(true);
      updateFormData('artistInspiration', artistName);
      autoAdvanceTimer.current = setTimeout(() => {
        navigateTo('occasion');
      }, 600);
    }
  };

  const handleCustomArtistChange = (value) => {
    setCustomArtist(value);
    setSelectedArtist(value);
  };

  const handleShowCustom = () => {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    setIsAutoAdvancing(false);
    setShowCustomInput(true);
    setSelectedArtist('');
  };

  const handleContinue = () => {
    // Just send the artist name - the backend generates the style dynamically
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
                Artistas sugeridos para {formData.subGenreName || formData.genreName || formData.genre}
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
              if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
              setSelectedArtist('');
              setCustomArtist('');
              setShowCustomInput(false);
              // Auto-advance with no artist preference
              setIsAutoAdvancing(true);
              updateFormData('artistInspiration', '');
              autoAdvanceTimer.current = setTimeout(() => {
                navigateTo('occasion');
              }, 600);
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
