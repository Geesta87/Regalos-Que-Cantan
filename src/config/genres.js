// Genre Configuration for RegalosQueCantan
// Display info only - Claude generates all prompts dynamically

const genres = {
  // ==========================================
  // REGIONAL MEXICANO
  // ==========================================
  
  corrido: {
    name: "Corrido",
    emoji: "🎺",
    description: "Historias épicas con acordeón y bajo sexto",
    subGenres: {
      tradicional: { name: "Tradicional" },
      tumbado: { name: "Tumbado" },
      alterado: { name: "Alterado" },
      romantico: { name: "Romántico" }
    }
  },

  norteno: {
    name: "Norteño",
    emoji: "🪗",
    description: "Acordeón y bajo sexto tradicional",
    subGenres: {
      tradicional: { name: "Tradicional" },
      moderno: { name: "Moderno" },
      sax: { name: "Norteño-Sax" },
      progresivo: { name: "Progresivo" }
    }
  },

  banda: {
    name: "Banda Sinaloense",
    emoji: "🎺",
    description: "Música de viento poderosa",
    subGenres: {
      romantica: { name: "Romántica" },
      quebradita: { name: "Quebradita" },
      ranchera: { name: "Banda Ranchera" },
      popular: { name: "Popular/Fiesta" }
    }
  },

  ranchera: {
    name: "Ranchera",
    emoji: "🎻",
    description: "Mariachi clásico mexicano",
    subGenres: {
      brava: { name: "Brava/Alegre" },
      romantica: { name: "Romántica" },
      huapango: { name: "Huapango" },
      lenta: { name: "Lenta/Triste" }
    }
  },

  sierreno: {
    name: "Sierreño",
    emoji: "🏔️",
    description: "Acústico de la sierra",
    subGenres: {
      tradicional: { name: "Tradicional" },
      moderno: { name: "Moderno" },
      romantico: { name: "Romántico" }
    }
  },

  mariachi: {
    name: "Mariachi",
    emoji: "🎺",
    description: "Mariachi tradicional instrumental",
    subGenres: {
      tradicional: { name: "Tradicional" },
      moderno: { name: "Moderno" },
      son: { name: "Son Jalisciense" }
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
      sonidera: { name: "Sonidera (Mexicana)" },
      nortena: { name: "Norteña" },
      colombiana: { name: "Colombiana" },
      romantica: { name: "Romántica" },
      tejana: { name: "Tejana" }
    }
  },

  salsa: {
    name: "Salsa",
    emoji: "🎹",
    description: "Ritmo caribeño con sabor",
    subGenres: {
      dura: { name: "Salsa Dura" },
      romantica: { name: "Romántica" },
      cubana: { name: "Cubana/Timba" }
    }
  },

  bachata: {
    name: "Bachata",
    emoji: "🌴",
    description: "Romántico dominicano",
    subGenres: {
      tradicional: { name: "Tradicional" },
      moderna: { name: "Moderna" },
      sensual: { name: "Sensual" }
    }
  },

  merengue: {
    name: "Merengue",
    emoji: "🥁",
    description: "Fiesta dominicana",
    subGenres: {
      tipico: { name: "Típico" },
      urbano: { name: "Urbano" },
      romantico: { name: "Romántico" }
    }
  },

  vallenato: {
    name: "Vallenato",
    emoji: "🪗",
    description: "Folclor colombiano",
    subGenres: {
      tradicional: { name: "Tradicional" },
      romantico: { name: "Romántico" },
      nueva_ola: { name: "Nueva Ola" }
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
      clasico: { name: "Clásico" },
      romantico: { name: "Romántico" },
      perreo: { name: "Perreo Intenso" },
      chill: { name: "Chill/Sad" }
    }
  },

  latin_trap: {
    name: "Latin Trap",
    emoji: "💀",
    description: "Trap en español",
    subGenres: {
      duro: { name: "Duro/Calle" },
      melodico: { name: "Melódico" }
    }
  },

  pop_latino: {
    name: "Pop Latino",
    emoji: "⭐",
    description: "Pop moderno en español",
    subGenres: {
      bailable: { name: "Bailable" },
      balada: { name: "Balada Pop" },
      urbano: { name: "Pop Urbano" }
    }
  },

  // ==========================================
  // BALADAS / ROMANTIC
  // ==========================================

  balada: {
    name: "Balada",
    emoji: "💝",
    description: "Balada romántica clásica",
    subGenres: {
      clasica: { name: "Clásica" },
      pop: { name: "Pop Ballad" },
      ranchera: { name: "Balada Ranchera" }
    }
  },

  bolero: {
    name: "Bolero",
    emoji: "🌙",
    description: "Romántico clásico cubano",
    subGenres: {
      tradicional: { name: "Tradicional" },
      moderno: { name: "Moderno" }
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
      romantica: { name: "Romántica" },
      bailable: { name: "Bailable" }
    }
  },

  tejano: {
    name: "Tejano",
    emoji: "⛰️",
    description: "Tex-Mex de Texas",
    subGenres: {
      cumbia: { name: "Cumbia Tejana" },
      country: { name: "Tejano Country" },
      ranchera: { name: "Ranchera Tejana" }
    }
  }
};

export default genres;
