// Genre Configuration for RegalosQueCantan
// Updated to match DNA Library v2.0 - 18 genres, 54 subgenres
// Display info only - Claude generates all prompts dynamically using DNA

const genres = {
  // ==========================================
  // REGIONAL MEXICANO
  // ==========================================
  
  corrido: {
    name: "Corrido",
    emoji: "🎺",
    description: "Historias épicas con acordeón y bajo sexto",
    subGenres: {
      tradicional: { name: "Tradicional", description: "Corrido clásico estilo Los Tigres del Norte" },
      tumbados: { name: "Tumbados", description: "Moderno con 808 y AutoTune estilo Peso Pluma" },
      belico: { name: "Bélico", description: "Agresivo y pesado estilo Luis R Conriquez" },
      alterados: { name: "Alterados", description: "Rápido y intenso estilo El Komander" }
    }
  },

  norteno: {
    name: "Norteño",
    emoji: "🪗",
    description: "Acordeón y bajo sexto tradicional",
    subGenres: {
      tradicional: { name: "Tradicional", description: "Polka norteña clásica estilo Ramón Ayala" },
      con_sax: { name: "Con Saxofón", description: "Norteño romántico con sax estilo Pesado" },
      nortena_banda: { name: "Norteña-Banda", description: "Fusión con metales estilo Calibre 50" },
      romantico: { name: "Romántico", description: "Balada norteña suave estilo Intocable" }
    }
  },

  banda: {
    name: "Banda Sinaloense",
    emoji: "🎺",
    description: "Música de viento poderosa de Sinaloa",
    subGenres: {
      romantica: { name: "Romántica", description: "Balada de banda emotiva estilo Banda MS" },
      quebradita: { name: "Quebradita", description: "Rápida y bailable estilo Banda Machos" },
      tecnobanda: { name: "Tecnobanda", description: "Fusión con electrónico estilo Banda Cuisillos" },
      sinaloense_clasica: { name: "Sinaloense Clásica", description: "Tradicional estilo Banda El Recodo" }
    }
  },

  ranchera: {
    name: "Ranchera",
    emoji: "🎻",
    description: "El alma de México con mariachi",
    subGenres: {
      lenta: { name: "Lenta", description: "Balada ranchera emotiva estilo Vicente Fernández" },
      brava: { name: "Brava", description: "Ranchera alegre y poderosa con gritos" },
      moderna: { name: "Moderna", description: "Contemporánea estilo Christian Nodal" }
    }
  },

  sierreno: {
    name: "Sierreño",
    emoji: "🏔️",
    description: "Sonido acústico de la sierra",
    subGenres: {
      tradicional: { name: "Tradicional", description: "Sierreño crudo y auténtico estilo El Fantasma" },
      moderno_sad: { name: "Moderno Sad", description: "Melancólico y emotivo estilo Grupo Firme triste" }
    }
  },

  mariachi: {
    name: "Mariachi",
    emoji: "🎺",
    description: "Mariachi tradicional mexicano",
    subGenres: {
      tradicional: { name: "Tradicional", description: "Mariachi clásico estilo Mariachi Vargas" },
      ranchero: { name: "Ranchero", description: "Mariachi con estilo ranchero emotivo" },
      romantico: { name: "Romántico", description: "Mariachi suave y romántico estilo Luis Miguel" },
      moderno: { name: "Moderno", description: "Mariachi contemporáneo estilo Ángela Aguilar" }
    }
  },

  // ==========================================
  // TROPICAL / CARIBBEAN
  // ==========================================

  cumbia: {
    name: "Cumbia",
    emoji: "💃",
    description: "Ritmo tropical bailable",
    subGenres: {
      sonidera: { name: "Sonidera", description: "Cumbia mexicana con teclados estilo Los Ángeles Azules" },
      nortena: { name: "Norteña", description: "Cumbia con acordeón estilo Intocable" },
      texana: { name: "Texana", description: "Tex-Mex cumbia estilo Selena" },
      grupera: { name: "Grupera", description: "Cumbia romántica estilo Los Bukis" },
      romantica: { name: "Romántica", description: "Cumbia lenta y emotiva" },
      colombiana: { name: "Colombiana", description: "Cumbia auténtica colombiana estilo Carlos Vives" }
    }
  },

  salsa: {
    name: "Salsa",
    emoji: "🎹",
    description: "Ritmo caribeño con sabor",
    subGenres: {
      clasica_dura: { name: "Clásica Dura", description: "Salsa brava estilo Héctor Lavoe" },
      romantica: { name: "Romántica", description: "Salsa suave estilo Marc Anthony" },
      urbana: { name: "Urbana", description: "Salsa moderna y comercial" }
    }
  },

  bachata: {
    name: "Bachata",
    emoji: "🌴",
    description: "Romántico dominicano",
    subGenres: {
      tradicional: { name: "Tradicional", description: "Bachata auténtica dominicana" },
      urbana_sensual: { name: "Urbana Sensual", description: "Moderna estilo Romeo Santos" },
      romantica: { name: "Romántica", description: "Bachata emotiva estilo Frank Reyes" }
    }
  },

  merengue: {
    name: "Merengue",
    emoji: "🥁",
    description: "Fiesta dominicana",
    subGenres: {
      clasico: { name: "Clásico", description: "Merengue tradicional estilo Juan Luis Guerra" },
      mambo_merengue: { name: "Mambo Merengue", description: "Con metales estilo Los Hermanos Rosario" },
      urbano: { name: "Urbano", description: "Merengue moderno estilo Elvis Crespo" }
    }
  },

  vallenato: {
    name: "Vallenato",
    emoji: "🪗",
    description: "Folclor colombiano",
    subGenres: {
      tradicional: { name: "Tradicional", description: "Vallenato auténtico estilo Diomedes Díaz" },
      romantico: { name: "Romántico", description: "Vallenato emotivo estilo Jorge Celedón" },
      moderno: { name: "Moderno", description: "Vallenato contemporáneo estilo Carlos Vives" }
    }
  },

  // ==========================================
  // URBANO / MODERN
  // ==========================================

  reggaeton: {
    name: "Reggaeton",
    emoji: "🔥",
    description: "Urbano latino con dembow",
    subGenres: {
      clasico_perreo: { name: "Clásico Perreo", description: "Reggaeton de calle estilo Daddy Yankee" },
      romantico: { name: "Romántico", description: "Reggaeton suave estilo Ozuna" },
      comercial_pop: { name: "Comercial Pop", description: "Radio-friendly estilo J Balvin" }
    }
  },

  latin_trap: {
    name: "Latin Trap",
    emoji: "💀",
    description: "Trap en español",
    subGenres: {
      trap_pesado: { name: "Trap Pesado", description: "Trap agresivo estilo Anuel AA" },
      trap_melodico: { name: "Trap Melódico", description: "Trap emotivo estilo Bad Bunny" },
      trap_latino: { name: "Trap Latino", description: "Fusión latina bilingüe" }
    }
  },

  pop_latino: {
    name: "Pop Latino",
    emoji: "⭐",
    description: "Pop moderno en español",
    subGenres: {
      pop_balada: { name: "Pop Balada", description: "Balada pop emotiva estilo Luis Miguel" },
      pop_bailable: { name: "Pop Bailable", description: "Pop dance estilo Shakira" },
      pop_urbano: { name: "Pop Urbano", description: "Pop con influencia urbana estilo Sebastián Yatra" }
    }
  },

  // ==========================================
  // BALADAS / ROMANTIC
  // ==========================================

  balada: {
    name: "Balada",
    emoji: "💐",
    description: "Balada romántica clásica",
    subGenres: {
      balada_clasica: { name: "Clásica", description: "Balada atemporal estilo José José" },
      balada_pop: { name: "Pop", description: "Balada pop moderna estilo Luis Fonsi" },
      balada_romantica: { name: "Romántica", description: "Balada íntima estilo Ricardo Montaner" }
    }
  },

  bolero: {
    name: "Bolero",
    emoji: "🌙",
    description: "Romántico clásico cubano",
    subGenres: {
      bolero_clasico: { name: "Clásico", description: "Bolero tradicional estilo Los Panchos" },
      bolero_ranchero: { name: "Ranchero", description: "Bolero mexicano estilo Vicente Fernández" },
      bolero_moderno: { name: "Moderno", description: "Bolero contemporáneo estilo Luis Miguel" }
    }
  },

  // ==========================================
  // TRADITIONAL / FOLK
  // ==========================================

  grupera: {
    name: "Grupera",
    emoji: "🎤",
    description: "Pop mexicano de los 80s-90s",
    subGenres: {
      grupera_clasica: { name: "Clásica", description: "Grupera nostálgica estilo Los Bukis" },
      grupera_romantica: { name: "Romántica", description: "Balada grupera estilo Los Temerarios" },
      grupera_bailable: { name: "Bailable", description: "Grupera para fiesta estilo Bronco" }
    }
  },

  tejano: {
    name: "Tejano",
    emoji: "⛰️",
    description: "Tex-Mex de Texas",
    subGenres: {
      tejano_clasico: { name: "Clásico", description: "Tejano tradicional estilo Little Joe" },
      tejano_romantico: { name: "Romántico", description: "Balada tejana estilo La Mafia" },
      tejano_cumbia: { name: "Cumbia Tejana", description: "Cumbia Tex-Mex estilo Selena" }
    }
  }
};

export default genres;
