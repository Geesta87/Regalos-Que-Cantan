import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// =============================================================================
// COMPLETE GENRE DNA DATABASE - From RegalosQueCantan_Genre_DNA_FILLED.xlsx
// All 18 genres with sub-genres, tempos, instruments, vibes, and negative tags
// =============================================================================

interface SubGenreData {
  name: string;
  style: string;
  tempo: string;
  instruments: string;
  vibe: string;
  negative: string;
}

interface GenreData {
  baseStyle: string;
  defaultTempo: string;
  instruments: string;
  negativeTags: string;
  subGenres: Record<string, SubGenreData>;
}

const genreDNA: Record<string, GenreData> = {
  // ===========================================================================
  // 1. CORRIDO
  // ===========================================================================
  corrido: {
    baseStyle: 'Mexican corrido, regional Mexican music, narrative storytelling song',
    defaultTempo: '90-110 BPM',
    instruments: 'accordion, bajo sexto, tololoche upright bass, drums',
    negativeTags: 'EDM, dubstep, techno, K-pop, country western, jazz, classical orchestra, pop punk',
    subGenres: {
      tradicional: {
        name: 'Corrido Tradicional',
        style: 'traditional corrido, classic Mexican corrido, 1980s 1990s Sinaloa sound, raw authentic recording, narrative ballad, old school corrido',
        tempo: '90-110 BPM, moderate tempo',
        instruments: 'accordion, bajo sexto, tololoche upright bass, drums',
        vibe: 'storytelling, narrative, nostalgic, rural authenticity, raw emotion',
        negative: 'trap beats, electronic sounds, auto-tune, polished pop production, modern, tumbado, 808'
      },
      tumbados: {
        name: 'Corridos Tumbados',
        style: 'corridos tumbados, modern Mexican trap corrido, 2020s sound, laid-back flow, melodic trap influence',
        tempo: '65-85 BPM, SLOW laid-back tempo, relaxed pace',
        instruments: 'requinto guitar, tololoche, minimal percussion, clean electric guitar',
        vibe: 'relaxed swagger, melancholic, introspective, modern street vibe, chill',
        negative: 'fast tempos, brass instruments, banda drums, traditional accordion, old school, uptempo'
      },
      belico: {
        name: 'Corrido Bélico',
        style: 'corrido belico, aggressive corrido, intense dark corrido, street corrido, hard corrido',
        tempo: '80-100 BPM, aggressive energy, intense',
        instruments: 'requinto, tuba, heavy bass, snare hits, dark tones',
        vibe: 'intense, confrontational, dark, street credibility, dangerous, aggressive',
        negative: 'happy melodies, romantic vibes, soft acoustic sounds, mariachi, cheerful'
      },
      alterados: {
        name: 'Corridos Alterados',
        style: 'corridos alterados, high energy corrido, party corrido, aggressive Sinaloa style, fast corrido',
        tempo: '100-130 BPM, HIGH ENERGY, FAST tempo, uptempo',
        instruments: 'banda brass, tuba, snare, accordion, driving rhythm',
        vibe: 'party energy, bold, unapologetic, celebratory chaos, high energy',
        negative: 'slow ballads, acoustic intimacy, sad sierreño, romantic softness, slow tempo'
      }
    }
  },

  // ===========================================================================
  // 2. NORTEÑO
  // ===========================================================================
  norteno: {
    baseStyle: 'norteño music, northern Mexican music, Tex-Mex conjunto',
    defaultTempo: '110-130 BPM',
    instruments: 'accordion, bajo sexto, bass, drums',
    negativeTags: 'EDM, dubstep, techno, K-pop, heavy metal, trap, 808',
    subGenres: {
      tradicional: {
        name: 'Norteño Tradicional',
        style: 'traditional norteño, classic conjunto, accordion-driven northern Mexican music, authentic norteño',
        tempo: '110-130 BPM, upbeat, energetic',
        instruments: 'accordion, bajo sexto, bass, drums',
        vibe: 'festive, working-class pride, dance-friendly, cantina energy',
        negative: 'electronic beats, trap production, urban sounds, reggaeton, modern pop'
      },
      con_sax: {
        name: 'Norteño con Sax',
        style: 'norteño with saxophone, norteño-sax fusion, saxophone melody lead, romantic norteño with sax',
        tempo: '100-120 BPM, smooth energy',
        instruments: 'saxophone lead, accordion, bajo sexto, drums',
        vibe: 'romantic yet energetic, classy party vibe, wedding-ready, elegant',
        negative: 'heavy metal guitars, EDM drops, aggressive trap, rock sounds, harsh'
      },
      nortena_banda: {
        name: 'Norteña-Banda',
        style: 'norteña-banda hybrid, brass-enhanced norteño, powerful northern Mexican with brass section',
        tempo: '110-130 BPM, powerful, big sound',
        instruments: 'brass section, tuba, snare, accordion, bajo sexto',
        vibe: 'big sound, stadium-ready, maximum energy, celebration, powerful',
        negative: 'intimate acoustic, solo guitar, quiet ballads, minimalist, soft'
      },
      romantico: {
        name: 'Norteño Romántico',
        style: 'romantic norteño, soft norteño ballad, gentle northern Mexican love song, tender norteño',
        tempo: '85-100 BPM, gentle, tender',
        instruments: 'accordion, bajo sexto, soft drums, occasional strings',
        vibe: 'tender, heartfelt, dedicated love songs, sentimental, romantic',
        negative: 'aggressive corridos, party anthems, brass-heavy banda, trap, fast'
      }
    }
  },

  // ===========================================================================
  // 3. BANDA SINALOENSE
  // ===========================================================================
  banda: {
    baseStyle: 'banda sinaloense, Mexican brass band music, Sinaloa style banda',
    defaultTempo: '90-110 BPM',
    instruments: 'full brass section, trumpets, trombones, clarinets, tuba, tambora drum, tarola snare',
    negativeTags: 'electronic, synthesizer, trap, 808, guitar-only, acoustic only, EDM, rock',
    subGenres: {
      romantica: {
        name: 'Banda Romántica',
        style: 'romantic banda, emotional banda ballad, SLOW banda sinaloense, love song banda, ballad',
        tempo: '70-90 BPM, SLOW emotional tempo, ballad pace',
        instruments: 'full brass (trumpets, trombones, clarinets), tuba, snare/tarola',
        vibe: 'emotional, heartbreak, dedication songs, tearful confessions, romantic',
        negative: 'fast quebradita, electronic music, rock guitars, reggaeton, uptempo, FAST, party, dance'
      },
      quebradita: {
        name: 'Quebradita',
        style: 'quebradita, FAST danceable banda, HIGH ENERGY party banda, 1990s quebradita dance craze, uptempo brass, driving rhythm, dance music',
        tempo: '130-160 BPM, VERY FAST, HIGH ENERGY, UPTEMPO, QUICK TEMPO, dance tempo',
        instruments: 'brass, tuba, FAST driving snare, tambora, driving percussion, energetic brass',
        vibe: 'dance craze energy, athletic, acrobatic, 90s nostalgia, PARTY, HIGH ENERGY, dancing',
        negative: 'slow ballads, trap beats, acoustic intimacy, modern corridos, romantic, SLOW tempo, ballad, gentle, soft, emotional'
      },
      tecnobanda: {
        name: 'Tecnobanda',
        style: 'tecnobanda, electronic-fused banda, 90s synth banda, electronic drums with brass',
        tempo: '120-140 BPM, FAST electronic-fused, dance tempo',
        instruments: 'synthesizers mixed with brass, electronic drums, tuba',
        vibe: 'retro-futuristic, 90s party, high-energy dance, electronic feel',
        negative: 'pure acoustic, traditional corridos, modern trap, sad ballads, slow'
      },
      sinaloense_clasica: {
        name: 'Banda Sinaloense Clásica',
        style: 'classic banda sinaloense, traditional Sinaloa brass band, authentic 15-piece banda',
        tempo: '90-110 BPM, traditional moderate tempo',
        instruments: 'full 15+ piece brass, clarinets, tubas, tarola',
        vibe: 'authentic Sinaloa pride, timeless, festive, classic polish',
        negative: 'lo-fi production, trap beats, electronic sounds, rock, modern'
      }
    }
  },

  // ===========================================================================
  // 4. RANCHERA
  // ===========================================================================
  ranchera: {
    baseStyle: 'Mexican ranchera, mariachi style, traditional Mexican folk',
    defaultTempo: '80-100 BPM',
    instruments: 'mariachi ensemble, violins, trumpets, vihuela, guitarrón',
    negativeTags: 'electronic, trap, 808, synthesizer, modern pop, hip-hop, autotune, EDM, rock',
    subGenres: {
      lenta: {
        name: 'Ranchera Lenta',
        style: 'slow ranchera ballad, dramatic ranchera, emotional Mexican ballad, crying ranchera',
        tempo: '50-70 BPM, VERY SLOW, dramatic pauses, ballad',
        instruments: 'mariachi (violins, trumpets, vihuela, guitarrón)',
        vibe: 'deep sorrow, dramatic heartbreak, crying-in-your-drink emotion, tearful',
        negative: 'upbeat rhythms, electronic beats, happy party vibes, trap, fast, dance'
      },
      brava: {
        name: 'Ranchera Brava',
        style: 'fast ranchera, fiery ranchera, energetic mariachi, celebratory ranchera, uptempo',
        tempo: '120-140 BPM, FAST fiery tempo, energetic',
        instruments: 'mariachi full ensemble, aggressive trumpet lines',
        vibe: 'defiant, proud, celebratory machismo, grito-inducing, powerful',
        negative: 'soft pop, electronic music, slow sad songs, modern urban, gentle'
      },
      moderna: {
        name: 'Ranchera Moderna',
        style: 'modern ranchera, contemporary mariachi, updated ranchera with modern production',
        tempo: '80-100 BPM, contemporary',
        instruments: 'mariachi with modern production, subtle electronic touches',
        vibe: 'updated classic feel, youthful yet respectful of roots',
        negative: 'full trap production, reggaeton beats, EDM, rock guitars, heavy electronic'
      }
    }
  },

  // ===========================================================================
  // 5. SIERREÑO
  // ===========================================================================
  sierreno: {
    baseStyle: 'sierreño music, mountain music of Mexico, acoustic regional Mexican',
    defaultTempo: '80-100 BPM',
    instruments: 'requinto guitar, tololoche, guitarrón, minimal drums',
    negativeTags: 'electronic, brass, full band, overproduced, trap, 808, synthesizer, EDM',
    subGenres: {
      tradicional: {
        name: 'Sierreño Tradicional',
        style: 'traditional sierreño, mountain music, raw acoustic storytelling, rural Mexican guitar music',
        tempo: '90-110 BPM, moderate',
        instruments: 'requinto, tololoche, guitarrón, minimal drums',
        vibe: 'mountain authenticity, raw storytelling, rural simplicity',
        negative: 'brass instruments, electronic beats, polished pop, banda, modern'
      },
      moderno_sad: {
        name: 'Sierreño Sad',
        style: 'sad sierreño, emotional corridos tumbados, melancholic modern regional, sad boy sierreño',
        tempo: '60-80 BPM, SLOW melancholic, sad pace',
        instruments: 'clean requinto, tololoche, soft percussion or none',
        vibe: 'heartbreak, loneliness, 3am sadness, emotional vulnerability, melancholic',
        negative: 'happy dance music, brass, fast tempos, party energy, upbeat'
      }
    }
  },

  // ===========================================================================
  // 6. MARIACHI
  // ===========================================================================
  mariachi: {
    baseStyle: 'mariachi music, Mexican mariachi ensemble, traditional Mexican orchestral',
    defaultTempo: '90-120 BPM',
    instruments: 'violins, trumpets, vihuela, guitarrón, guitar',
    negativeTags: 'electronic, trap, rock guitars, modern urban beats, EDM, synthesizer, 808',
    subGenres: {
      tradicional: {
        name: 'Mariachi Tradicional',
        style: 'traditional mariachi, classic Mexican mariachi, ceremonial mariachi, authentic mariachi ensemble',
        tempo: '90-120 BPM, variable classic tempo',
        instruments: 'violins, trumpets, vihuela, guitarrón, guitar',
        vibe: 'Mexican pride, elegant, timeless, ceremonial',
        negative: 'electronic anything, trap, rock guitars, modern urban beats'
      },
      ranchero: {
        name: 'Mariachi Ranchero',
        style: 'ranchero mariachi, energetic mariachi, fiesta mariachi, bold mariachi',
        tempo: '100-130 BPM, energetic',
        instruments: 'full mariachi with strong trumpet presence',
        vibe: 'bold declarations, machismo, fiesta-ready, gritos',
        negative: 'soft pop, lo-fi, electronic beats, sad trap'
      },
      romantico: {
        name: 'Mariachi Romántico',
        style: 'romantic mariachi, serenata mariachi, soft mariachi ballad, love song mariachi',
        tempo: '60-80 BPM, SLOW tender',
        instruments: 'violins prominent, soft trumpets, delicate guitarrón',
        vibe: 'serenata vibes, courtship, deep romance, tearful dedications',
        negative: 'fast dance rhythms, brass-heavy banda, aggressive sounds, uptempo'
      },
      moderno: {
        name: 'Mariachi Moderno',
        style: 'modern mariachi, contemporary mariachi, updated mariachi with modern production',
        tempo: '85-110 BPM, contemporary',
        instruments: 'classic mariachi with modern mixing/production',
        vibe: 'fresh take on classics, appeals to younger generation',
        negative: 'full electronic production, trap beats, reggaeton rhythm'
      }
    }
  },

  // ===========================================================================
  // 7. CUMBIA
  // ===========================================================================
  cumbia: {
    baseStyle: 'cumbia music, Latin dance music, tropical rhythm',
    defaultTempo: '95-110 BPM',
    instruments: 'güiro, congas, bass, keyboards',
    negativeTags: 'heavy metal, aggressive, dark, heavy rock, death metal, screaming',
    subGenres: {
      sonidera: {
        name: 'Cumbia Sonidera',
        style: 'cumbia sonidera, Mexico City cumbia, barrio cumbia, synth-heavy cumbia, wepa sounds',
        tempo: '95-110 BPM, steady groove, dance tempo',
        instruments: 'synth leads (wepa sounds), güiro, congas, bass',
        vibe: 'barrio party, working-class celebration, nostalgic dance',
        negative: 'rock guitars, trap beats, slow ballads, banda brass, acoustic only'
      },
      nortena: {
        name: 'Cumbia Norteña',
        style: 'cumbia norteña, accordion cumbia, northern Mexican cumbia, Tex-Mex cumbia',
        tempo: '100-120 BPM, bouncy, energetic',
        instruments: 'accordion, bajo sexto, timbales, güiro',
        vibe: 'Tex-Mex fusion, border culture, cantina dance party',
        negative: 'electronic drops, brass banda, reggaeton dembow, rock, EDM'
      },
      texana: {
        name: 'Cumbia Texana',
        style: 'cumbia texana, Texas cumbia, Tejano cumbia, polished cumbia',
        tempo: '100-115 BPM, polished, clean',
        instruments: 'keyboards, accordion, polished drums, bass',
        vibe: 'Texas pride, crossover appeal, radio-friendly, nostalgic',
        negative: 'raw lo-fi, aggressive corridos, trap, heavy brass, dark'
      },
      grupera: {
        name: 'Cumbia Grupera',
        style: 'cumbia grupera, keyboard cumbia, 90s cumbia, grupera style cumbia',
        tempo: '95-115 BPM, dance-ready',
        instruments: 'keyboards, guitars, drums, occasional accordion',
        vibe: '80s/90s nostalgia, quinceañera vibes, romantic dance',
        negative: 'modern trap, aggressive lyrics, electronic EDM, rock, dark'
      },
      romantica: {
        name: 'Cumbia Romántica',
        style: 'romantic cumbia, slow cumbia, love song cumbia, couples cumbia',
        tempo: '90-105 BPM, gentle groove',
        instruments: 'soft synths, güiro, light percussion, strings',
        vibe: 'tender dance, couples slow-dancing, sweet dedications',
        negative: 'fast party cumbia, aggressive sounds, trap, rock, hard'
      },
      colombiana: {
        name: 'Cumbia Colombiana',
        style: 'Colombian cumbia, original cumbia, tropical cumbia, classic cumbia',
        tempo: '85-100 BPM, classic swing',
        instruments: 'accordion, güiro, congas, piano, brass accents',
        vibe: 'original cumbia feel, tropical warmth, elegant dance',
        negative: 'Mexican norteño sound, trap, electronic, fast tempos, modern'
      }
    }
  },

  // ===========================================================================
  // 8. SALSA
  // ===========================================================================
  salsa: {
    baseStyle: 'salsa music, Afro-Cuban dance music, tropical salsa',
    defaultTempo: '160-180 BPM',
    instruments: 'piano, congas, timbales, bongos, bass, trumpets, trombones',
    negativeTags: 'slow ballads, rock guitars, corridos, country, folk, acoustic only',
    subGenres: {
      clasica_dura: {
        name: 'Salsa Clásica',
        style: 'classic salsa, salsa dura, hard salsa, NYC salsa, Fania style salsa',
        tempo: '160-200 BPM, FAST intense, high energy',
        instruments: 'piano, congas, timbales, bongos, trumpets, trombones',
        vibe: 'barrio NYC energy, socially conscious, street celebration',
        negative: 'slow ballads, electronic beats, rock guitars, corridos, gentle'
      },
      romantica: {
        name: 'Salsa Romántica',
        style: 'romantic salsa, salsa romantica, smooth salsa, love song salsa',
        tempo: '140-170 BPM, smooth energy, sensual',
        instruments: 'piano, strings, congas, softer brass, bongos',
        vibe: 'heartfelt love, sensual dance, romantic confessions',
        negative: 'aggressive brass, political lyrics, rock, trap beats, harsh'
      },
      urbana: {
        name: 'Salsa Urbana',
        style: 'urban salsa, modern salsa, salsa fusion, contemporary salsa',
        tempo: '150-180 BPM, modern fusion',
        instruments: 'traditional percussion + modern beats, synth accents',
        vibe: 'contemporary club appeal, fusion-friendly, crossover',
        negative: 'pure traditional only, acoustic only, corrido style, rock'
      }
    }
  },

  // ===========================================================================
  // 9. BACHATA
  // ===========================================================================
  bachata: {
    baseStyle: 'bachata music, Dominican romantic music, guitar-driven Latin',
    defaultTempo: '125-140 BPM',
    instruments: 'requinto guitar, rhythm guitar, bass, bongos, güira',
    negativeTags: 'electronic EDM, trap, brass band, aggressive, rock, heavy metal, harsh',
    subGenres: {
      tradicional: {
        name: 'Bachata Tradicional',
        style: 'traditional bachata, Dominican bachata, classic bachata, guitar bachata',
        tempo: '120-140 BPM, classic rhythm',
        instruments: 'requinto guitar, bongos, bass, güira',
        vibe: 'Dominican roots, barrio romance, raw heartbreak',
        negative: 'electronic production, trap, rock guitars, fast dance, EDM'
      },
      urbana_sensual: {
        name: 'Bachata Sensual',
        style: 'urban bachata, sensual bachata, modern bachata, R&B influenced bachata',
        tempo: '125-145 BPM, smooth modern',
        instruments: 'guitar, R&B production elements, synths, modern drums',
        vibe: 'sensual, nightclub seduction, polished romance',
        negative: 'raw traditional sound, corridos, banda, rock guitars, harsh'
      },
      romantica: {
        name: 'Bachata Romántica',
        style: 'romantic bachata, emotional bachata, heartbreak bachata, crying bachata',
        tempo: '115-135 BPM, tender',
        instruments: 'acoustic guitar prominent, bongos, bass, soft güira',
        vibe: 'deep emotional pain, crying ballads, heartbreak anthems',
        negative: 'fast party music, aggressive sounds, electronic drops, hard'
      }
    }
  },

  // ===========================================================================
  // 10. MERENGUE
  // ===========================================================================
  merengue: {
    baseStyle: 'merengue music, Dominican dance music, fast Caribbean rhythm',
    defaultTempo: '140-160 BPM',
    instruments: 'tambora, güira, accordion or saxophone, bass',
    negativeTags: 'slow songs, rock, corrido storytelling, heavy metal, sad ballads, acoustic only',
    subGenres: {
      clasico: {
        name: 'Merengue Clásico',
        style: 'classic merengue, traditional merengue, Dominican merengue, accordion merengue',
        tempo: '140-160 BPM, FAST traditional, high energy',
        instruments: 'tambora, güira, accordion/sax, bass',
        vibe: 'Dominican pride, festive, wedding party, high-energy dance',
        negative: 'slow songs, electronic beats only, rock, corrido storytelling, gentle'
      },
      mambo_merengue: {
        name: 'Merengue Mambo',
        style: 'mambo merengue, high energy merengue, party merengue, brass merengue',
        tempo: '150-170 BPM, VERY FAST energetic, party tempo',
        instruments: 'heavy tambora, güira, brass, synth accents',
        vibe: 'peak party energy, jumping crowds, summer anthems',
        negative: 'ballads, acoustic intimacy, sad songs, corridos, slow'
      },
      urbano: {
        name: 'Merengue Urbano',
        style: 'urban merengue, modern merengue, merengue fusion, contemporary merengue',
        tempo: '135-155 BPM, modern fusion',
        instruments: 'traditional drums with modern production, electronic elements',
        vibe: 'contemporary club appeal, reggaeton-influenced',
        negative: 'pure acoustic, traditional-only sounds, rock, heavy trap'
      }
    }
  },

  // ===========================================================================
  // 11. VALLENATO
  // ===========================================================================
  vallenato: {
    baseStyle: 'vallenato music, Colombian accordion music, Colombian romantic',
    defaultTempo: '100-120 BPM',
    instruments: 'accordion (caja vallenata), caja drum, guacharaca',
    negativeTags: 'electronic beats, rock guitars, Mexican regional, trap, heavy metal, EDM',
    subGenres: {
      tradicional: {
        name: 'Vallenato Tradicional',
        style: 'traditional vallenato, classic Colombian vallenato, accordion storytelling',
        tempo: '100-120 BPM, classic swing',
        instruments: 'accordion (caja vallenata), caja drum, guacharaca',
        vibe: 'Colombian coast, storytelling, romantic narratives, nostalgia',
        negative: 'electronic beats, rock guitars, Mexican regional, trap, modern'
      },
      romantico: {
        name: 'Vallenato Romántico',
        style: 'romantic vallenato, love song vallenato, emotional vallenato',
        tempo: '90-110 BPM, tender',
        instruments: 'accordion, soft percussion, occasional strings',
        vibe: 'deep love songs, serenata feel, emotional confessions',
        negative: 'fast party rhythms, aggressive sounds, rock, trap, hard'
      },
      moderno: {
        name: 'Vallenato Moderno',
        style: 'modern vallenato, contemporary vallenato, pop vallenato, updated vallenato',
        tempo: '100-130 BPM, contemporary',
        instruments: 'accordion with modern production, pop elements',
        vibe: 'updated sound, crossover appeal, radio-friendly',
        negative: 'pure electronic, rock band sound, Mexican corrido style, harsh'
      }
    }
  },

  // ===========================================================================
  // 12. REGGAETON
  // ===========================================================================
  reggaeton: {
    baseStyle: 'reggaeton, Latin urban music, dembow rhythm, Puerto Rican urban',
    defaultTempo: '88-95 BPM',
    instruments: 'dembow beat, 808 bass, hi-hats, synth leads',
    negativeTags: 'acoustic, traditional folk, mariachi, country, rock band, corridos, brass band',
    subGenres: {
      clasico_perreo: {
        name: 'Reggaeton Clásico',
        style: 'classic reggaeton, perreo reggaeton, underground reggaeton, OG dembow',
        tempo: '85-95 BPM, dembow rhythm, steady bounce',
        instruments: 'dembow beat, heavy bass, synth stabs, TR-808',
        vibe: 'underground Puerto Rico, perreo culture, raw street energy',
        negative: 'live instruments, acoustic sounds, corridos, banda brass, folk'
      },
      romantico: {
        name: 'Reggaeton Romántico',
        style: 'romantic reggaeton, slow reggaeton, sensual reggaeton, R&B reggaeton',
        tempo: '85-95 BPM, smooth dembow, sensual',
        instruments: 'softer synths, dembow, melodic elements, R&B touches',
        vibe: 'sensual, late-night vibes, romantic seduction',
        negative: 'aggressive lyrics, hard trap, acoustic instruments, rock, harsh'
      },
      comercial_pop: {
        name: 'Reggaeton Pop',
        style: 'commercial reggaeton, pop reggaeton, radio reggaeton, mainstream reggaeton',
        tempo: '90-100 BPM, radio-friendly, polished',
        instruments: 'polished production, pop synths, clean dembow',
        vibe: 'mainstream appeal, global crossover, radio/streaming hit',
        negative: 'underground raw sound, explicit content, heavy bass only, dark'
      }
    }
  },

  // ===========================================================================
  // 13. LATIN TRAP
  // ===========================================================================
  latin_trap: {
    baseStyle: 'Latin trap, Spanish trap, urban Latin, 808 heavy',
    defaultTempo: '130-150 BPM half-time',
    instruments: 'heavy 808s, hi-hats, dark synths, auto-tune vocals',
    negativeTags: 'acoustic instruments, traditional Latin, rock band, mariachi, happy pop, folk',
    subGenres: {
      trap_pesado: {
        name: 'Trap Pesado',
        style: 'heavy trap, dark Latin trap, aggressive trap, street trap',
        tempo: '130-160 BPM half-time feel, dark energy',
        instruments: 'heavy 808s, hi-hats, dark synths, distorted bass',
        vibe: 'street credibility, aggressive, dark flexing',
        negative: 'happy melodies, acoustic instruments, clean pop, banda, bright'
      },
      trap_melodico: {
        name: 'Trap Melódico',
        style: 'melodic trap, emotional trap, introspective Latin trap',
        tempo: '130-150 BPM half-time, melodic',
        instruments: 'melodic synths, 808s, atmospheric pads, auto-tune',
        vibe: 'emotional yet hard, introspective pain, late-night mood',
        negative: 'pure happy sounds, acoustic guitar, traditional Latin, rock, bright'
      },
      trap_latino: {
        name: 'Trap Latino',
        style: 'Latin trap fusion, crossover trap, accessible Latin trap',
        tempo: '125-145 BPM, fusion-ready',
        instruments: '808s with Latin percussion hints, modern production',
        vibe: 'crossover appeal, blend of trap and Latin roots',
        negative: 'pure acoustic, traditional Mexican, rock guitars, banda, folk'
      }
    }
  },

  // ===========================================================================
  // 14. POP LATINO
  // ===========================================================================
  pop_latino: {
    baseStyle: 'Latin pop, Spanish pop music, contemporary Latin',
    defaultTempo: '90-120 BPM',
    instruments: 'modern production, synthesizers, guitars, drums, electronic elements',
    negativeTags: 'regional Mexican, folk, traditional acoustic only, lo-fi, heavy metal, screaming',
    subGenres: {
      pop_balada: {
        name: 'Pop Balada',
        style: 'Latin pop ballad, slow pop, emotional pop, radio ballad',
        tempo: '70-90 BPM, SLOW emotional',
        instruments: 'piano, strings, soft drums, acoustic guitar',
        vibe: 'radio ballad, emotional but polished, tearful dedication',
        negative: 'aggressive trap, rock guitars, fast dance music, corridos, hard'
      },
      pop_bailable: {
        name: 'Pop Bailable',
        style: 'dance pop Latino, upbeat Latin pop, party pop, summer pop',
        tempo: '110-130 BPM, dance-friendly, upbeat',
        instruments: 'electronic beats, synths, Latin percussion, polished production',
        vibe: 'dance floor ready, summer hit vibes, global appeal',
        negative: 'raw acoustic, sad ballads, traditional folk, heavy rock, dark'
      },
      pop_urbano: {
        name: 'Pop Urbano',
        style: 'urban pop, modern Latin pop, pop-reggaeton fusion, streaming pop',
        tempo: '90-110 BPM, modern fusion',
        instruments: 'modern production, blend of reggaeton and pop, trap elements',
        vibe: 'contemporary radio, streaming-friendly, youthful energy',
        negative: 'traditional-only sounds, pure acoustic, rock band, ballads only'
      }
    }
  },

  // ===========================================================================
  // 15. BALADA
  // ===========================================================================
  balada: {
    baseStyle: 'Latin ballad, romantic Spanish ballad, emotional love song',
    defaultTempo: '65-80 BPM',
    instruments: 'piano, acoustic guitar, strings, soft percussion',
    negativeTags: 'uptempo dance, party, aggressive, trap, 808, EDM, rock, fast rhythms, hard',
    subGenres: {
      balada_clasica: {
        name: 'Balada Clásica',
        style: 'classic Latin ballad, orchestral ballad, grand romantic ballad, 70s-80s ballad',
        tempo: '60-80 BPM, VERY SLOW, dramatic',
        instruments: 'orchestra, piano, strings, soft drums',
        vibe: 'grand romantic gestures, theatrical emotion, tearjerker',
        negative: 'fast rhythms, electronic beats, rock, trap, party music, uptempo'
      },
      balada_pop: {
        name: 'Balada Pop',
        style: 'pop ballad, contemporary ballad, radio ballad, modern slow song',
        tempo: '70-90 BPM, contemporary slow',
        instruments: 'acoustic guitar, piano, modern soft production',
        vibe: 'modern radio ballad, emotional but accessible',
        negative: 'heavy electronic, trap beats, aggressive sounds, banda, fast'
      },
      balada_romantica: {
        name: 'Balada Romántica',
        style: 'romantic ballad, love ballad, wedding song ballad, dedication ballad',
        tempo: '65-85 BPM, intimate, tender',
        instruments: 'guitar, piano, soft strings, minimal percussion',
        vibe: 'deep romantic confession, wedding song, eternal love',
        negative: 'party music, fast dance, aggressive sounds, electronic, hard'
      }
    }
  },

  // ===========================================================================
  // 16. BOLERO
  // ===========================================================================
  bolero: {
    baseStyle: 'bolero music, classic romantic bolero, Cuban-origin romantic',
    defaultTempo: '55-75 BPM',
    instruments: 'requinto guitar, soft percussion, bass, strings',
    negativeTags: 'modern production, electronic, fast rhythms, rock, trap, EDM, aggressive, loud',
    subGenres: {
      bolero_clasico: {
        name: 'Bolero Clásico',
        style: 'classic bolero, traditional bolero, 1950s bolero, trio bolero',
        tempo: '50-70 BPM, VERY SLOW, intimate',
        instruments: 'requinto guitar, soft percussion, bass, occasional strings',
        vibe: 'old-school romance, elegant seduction, timeless love',
        negative: 'any modern production, electronic, fast rhythms, rock, loud'
      },
      bolero_ranchero: {
        name: 'Bolero Ranchero',
        style: 'ranchero bolero, Mexican bolero, mariachi bolero, cantina bolero',
        tempo: '55-75 BPM, slow dramatic',
        instruments: 'mariachi elements (soft trumpets, violins), guitarrón',
        vibe: 'Mexican romantic drama, cantina nostalgia, serenata',
        negative: 'electronic beats, fast tempos, modern urban, trap, loud'
      },
      bolero_moderno: {
        name: 'Bolero Moderno',
        style: 'modern bolero, contemporary bolero, updated bolero, sophisticated bolero',
        tempo: '60-80 BPM, updated classic',
        instruments: 'modern soft production, strings, piano, subtle updates',
        vibe: 'classic feel with contemporary polish, sophisticated romance',
        negative: 'trap, reggaeton, rock guitars, fast electronic music, hard'
      }
    }
  },

  // ===========================================================================
  // 17. GRUPERA
  // ===========================================================================
  grupera: {
    baseStyle: 'música grupera, Mexican grupera, 80s-90s Mexican pop',
    defaultTempo: '90-110 BPM',
    instruments: 'keyboards, electric guitar, drums, bass, occasional accordion',
    negativeTags: 'modern trap, aggressive corridos, electronic EDM, rock, heavy metal, screaming',
    subGenres: {
      grupera_clasica: {
        name: 'Grupera Clásica',
        style: 'classic grupera, 80s-90s grupera, traditional grupera, keyboard grupera',
        tempo: '90-110 BPM, nostalgic',
        instruments: 'keyboards, electric guitar, drums, bass',
        vibe: '80s/90s nostalgia, quinceañera memories, romantic era',
        negative: 'modern trap, aggressive corridos, electronic EDM, rock, harsh'
      },
      grupera_romantica: {
        name: 'Grupera Romántica',
        style: 'romantic grupera, slow grupera, grupera ballad, dedication grupera',
        tempo: '75-95 BPM, SLOW tender',
        instruments: 'keyboards, soft guitar, strings, gentle drums',
        vibe: 'deep romance, dedication songs, tearful confessions',
        negative: 'fast party music, aggressive sounds, trap, modern urban, hard'
      },
      grupera_bailable: {
        name: 'Grupera Bailable',
        style: 'dance grupera, party grupera, uptempo grupera, wedding grupera',
        tempo: '110-130 BPM, FAST dance party',
        instruments: 'keyboards, drums, bass, accordion occasionally',
        vibe: 'wedding reception energy, party classics, dancing couples',
        negative: 'slow ballads, trap, modern electronic, rock guitars, sad'
      }
    }
  },

  // ===========================================================================
  // 18. TEJANO
  // ===========================================================================
  tejano: {
    baseStyle: 'Tejano music, Texas Mexican music, Tex-Mex',
    defaultTempo: '100-120 BPM',
    instruments: 'accordion, bajo sexto, keyboards, drums, bass',
    negativeTags: 'modern trap, electronic beats, rock guitars, urban, pure electronic, EDM',
    subGenres: {
      tejano_clasico: {
        name: 'Tejano Clásico',
        style: 'classic Tejano, traditional Tex-Mex, conjunto Tejano, Texas accordion',
        tempo: '100-120 BPM, traditional',
        instruments: 'accordion, bajo sexto, drums, bass',
        vibe: 'Texas Mexican pride, conjunto roots, classic border sound',
        negative: 'modern trap, electronic beats, rock guitars, urban, EDM'
      },
      tejano_romantico: {
        name: 'Tejano Romántico',
        style: 'romantic Tejano, Tejano ballad, soft Tejano, love song Tejano',
        tempo: '80-100 BPM, emotional, tender',
        instruments: 'keyboards, soft accordion, polished drums, strings',
        vibe: 'crossover romance, radio ballad, sophisticated Tex-Mex',
        negative: 'aggressive sounds, fast party, trap beats, pure rock, harsh'
      },
      tejano_cumbia: {
        name: 'Tejano Cumbia',
        style: 'Tejano cumbia, Texas cumbia, dance hall Tejano, party Tejano',
        tempo: '100-115 BPM, dance groove',
        instruments: 'keyboards, bass, drums, accordion accents',
        vibe: 'Texas dance hall, cumbia with Tejano polish, party ready',
        negative: 'raw lo-fi, aggressive corridos, trap, pure electronic, dark'
      }
    }
  }
};

// =============================================================================
// ARTIST DNA DATABASE
// =============================================================================
interface ArtistData {
  name: string;
  genre: string;
  signatureSound: string;
  keyElements: string;
  keywords: string[];
}

const artistDNA: Record<string, ArtistData> = {
  chalino: {
    name: 'Chalino Sánchez',
    genre: 'Corrido Tradicional',
    signatureSound: 'raw unpolished vocals, storytelling about real-life struggles, authentic rancho sound, emotional vulnerability, nasal vocal delivery',
    keyElements: 'accordion, bajo sexto, nasal vocal delivery, narrative lyrics, 90-110 BPM, lo-fi recording, 1990s Sinaloa',
    keywords: ['chalino', 'chalino sanchez', 'sanchez', 'pelavacas']
  },
  peso_pluma: {
    name: 'Peso Pluma',
    genre: 'Corridos Tumbados',
    signatureSound: 'modern trap-influenced corrido, clean requinto guitar, laid-back flow, street credibility with melodic hooks',
    keyElements: 'requinto patterns, tololoche bass, 70-85 BPM SLOW, tuba drops, auto-tune, modern clean production',
    keywords: ['peso pluma', 'pesopluma', 'peso', 'doble p', 'hassan']
  },
  banda_ms: {
    name: 'Banda MS',
    genre: 'Banda Romántica',
    signatureSound: 'polished brass production, powerful emotional ballads, radio-ready sound, dramatic arrangements',
    keyElements: 'full brass section, strong tuba, clear vocals, big choruses, professional mix, 70-90 BPM SLOW ballad',
    keywords: ['banda ms', 'bandams', 'ms', 'sergio lizarraga']
  },
  vicente: {
    name: 'Vicente Fernández',
    genre: 'Ranchera/Mariachi',
    signatureSound: 'the king of ranchera, powerful vocal projection, dramatic gritos, macho but emotional, timeless',
    keyElements: 'full mariachi, strong trumpets, violins, guitarrón, dramatic pauses, emotional peaks, vibrato',
    keywords: ['vicente', 'vicente fernandez', 'chente', 'el rey']
  },
  tigres: {
    name: 'Los Tigres del Norte',
    genre: 'Norteño/Corrido',
    signatureSound: 'storytelling masters, social commentary, working-class anthems, accordion-driven, authentic norteño',
    keyElements: 'accordion lead, bajo sexto, narrative corrido structure, moderate-fast tempo, group harmonies',
    keywords: ['tigres', 'tigres del norte', 'los tigres']
  },
  frontera: {
    name: 'Grupo Frontera',
    genre: 'Norteño Moderno',
    signatureSound: 'youthful energy, emotional ballads, blend of norteño and modern, viral appeal, romantic themes',
    keyElements: 'accordion, bajo sexto, clean production, emotional vocals, contemporary arrangements',
    keywords: ['frontera', 'grupo frontera', 'grupofrontera']
  },
  bad_bunny: {
    name: 'Bad Bunny',
    genre: 'Reggaeton/Latin Trap',
    signatureSound: 'genre-bending pioneer, experimental, emotional range from party to introspective, cultural moments',
    keyElements: 'dembow variations, 808s, unexpected genre fusions, auto-tune, bilingual hooks',
    keywords: ['bad bunny', 'badbunny', 'benito', 'conejo malo']
  },
  romeo: {
    name: 'Romeo Santos',
    genre: 'Bachata Urbana',
    signatureSound: 'the king of modern bachata, sensual and romantic, smooth vocals, R&B influenced, crossover appeal',
    keyElements: 'guitar lead, modern production, sensual rhythms, English-Spanish mix, smooth delivery',
    keywords: ['romeo', 'romeo santos', 'aventura', 'el rey de la bachata']
  },
  nodal: {
    name: 'Christian Nodal',
    genre: 'Ranchera Moderna',
    signatureSound: 'young mariachi voice, traditional skill with modern appeal, romantic themes, powerful vocal control',
    keyElements: 'mariachi full ensemble, contemporary production touches, emotional ballads, strong vibrato',
    keywords: ['nodal', 'christian nodal']
  },
  junior_h: {
    name: 'Junior H',
    genre: 'Sierreño Sad',
    signatureSound: 'melancholic corridos, Gen-Z heartbreak, minimalist production, emotional authenticity',
    keyElements: 'requinto, tololoche, SLOW 60-80 BPM, sad lyrics, clean mix, melancholic',
    keywords: ['junior h', 'juniorh', 'junior']
  },
  natanael: {
    name: 'Natanael Cano',
    genre: 'Corridos Tumbados',
    signatureSound: 'pioneer of tumbados movement, trap-influenced corrido, youth swagger, laid-back delivery',
    keyElements: 'requinto patterns, tololoche, chill vibes, 70-85 BPM SLOW, modern street sound',
    keywords: ['natanael', 'natanael cano', 'nata']
  },
  angeles_azules: {
    name: 'Los Ángeles Azules',
    genre: 'Cumbia Sonidera',
    signatureSound: 'cumbia icons, synth-heavy sound, collaborations spanning genres, nostalgic yet fresh',
    keyElements: 'signature synth leads wepa sounds, güiro, cumbia rhythm, guest vocalist adaptability',
    keywords: ['angeles azules', 'los angeles azules']
  },
  carin_leon: {
    name: 'Carin León',
    genre: 'Regional Mexicano Fusion',
    signatureSound: 'genre-fluid artist, norteño to sierreño to mariachi, emotional depth, powerful voice',
    keyElements: 'versatile instrumentation, strong vocals, modern production, emotional range',
    keywords: ['carin', 'carin leon']
  },
  selena: {
    name: 'Selena',
    genre: 'Tejano/Cumbia Texana',
    signatureSound: 'queen of Tejano, powerful voice, crossover appeal, dance-friendly, timeless',
    keyElements: 'keyboards, cumbia rhythms, polished production, powerful vocals, 100-115 BPM',
    keywords: ['selena', 'selena quintanilla']
  },
  bukis: {
    name: 'Los Bukis',
    genre: 'Grupera',
    signatureSound: 'grupera legends, romantic ballads, 80s-90s nostalgia, Marco Antonio Solís voice',
    keyElements: 'keyboards, soft guitars, emotional ballads, 80-100 BPM, romantic lyrics',
    keywords: ['bukis', 'los bukis', 'marco antonio solis', 'marco antonio']
  }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function findArtist(query: string): ArtistData | null {
  if (!query) return null;
  const normalized = query.toLowerCase().trim();
  for (const [key, artist] of Object.entries(artistDNA)) {
    if (artist.keywords.some(kw => normalized.includes(kw))) {
      return artist;
    }
  }
  return null;
}

function buildStylePrompt(
  genre: string,
  subGenre: string | null,
  artistInspiration: string | null,
  voiceType: string
): { stylePrompt: string; negativeTags: string; vocalGender: string } {
  
  const genreData = genreDNA[genre];
  if (!genreData) {
    // Fallback
    return {
      stylePrompt: 'Mexican regional music, authentic Latin sound, traditional instruments',
      negativeTags: 'EDM, dubstep, techno, rock',
      vocalGender: voiceType === 'female' ? 'f' : 'm'
    };
  }

  const subGenreData = subGenre ? genreData.subGenres[subGenre] : null;
  const artistData = artistInspiration ? findArtist(artistInspiration) : null;

  const styleParts: string[] = [];
  const negativeParts: string[] = [genreData.negativeTags];

  // Primary: Sub-genre style (most specific)
  if (subGenreData) {
    styleParts.push(subGenreData.style);
    styleParts.push(subGenreData.tempo); // CRITICAL: tempo enforcement
    styleParts.push(subGenreData.instruments);
    styleParts.push(subGenreData.vibe);
    negativeParts.push(subGenreData.negative);
  } else {
    // Fallback to genre defaults
    styleParts.push(genreData.baseStyle);
    styleParts.push(genreData.defaultTempo);
    styleParts.push(genreData.instruments);
  }

  // Secondary: Artist signature (if specified)
  if (artistData) {
    styleParts.push(`style of ${artistData.name}`);
    styleParts.push(artistData.signatureSound);
    styleParts.push(artistData.keyElements);
  }

  // Voice type
  const vocalGender = voiceType === 'female' ? 'f' : 'm';
  if (voiceType === 'duet') {
    styleParts.push('male and female duet, two voices harmonizing, dueto romántico');
  }

  return {
    stylePrompt: styleParts.join(', ').substring(0, 950),
    negativeTags: [...new Set(negativeParts.join(', ').split(', '))].join(', ').substring(0, 500),
    vocalGender
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    const { 
      genre, genreName, subGenre, subGenreName,
      artistInspiration, occasion, occasionPrompt, customOccasion,
      emotionalTone, recipientName, senderName, relationship,
      relationshipContext, customRelationship, details, 
      email, voiceType, sessionId
    } = body;

    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    if (!KIE_API_KEY) throw new Error('KIE_API_KEY not configured');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const currentSessionId = sessionId || crypto.randomUUID();

    console.log('=== GENERATE SONG (DNA V2) ===');
    console.log('Genre:', genre, subGenre ? `> ${subGenre}` : '');
    console.log('Artist:', artistInspiration || 'None');

    // Build context strings
    const occasionDesc = occasion === 'otro' && customOccasion 
      ? customOccasion : (occasionPrompt || occasion);
    const relationshipDesc = relationship === 'otro' && customRelationship
      ? customRelationship : (relationshipContext || relationship);
    const voiceDesc = voiceType === 'female' ? 'voz femenina' 
      : voiceType === 'duet' ? 'dueto hombre y mujer' : 'voz masculina';

    // ==========================================================================
    // STEP 1: Build DNA-based style prompt
    // ==========================================================================
    const { stylePrompt, negativeTags, vocalGender } = buildStylePrompt(
      genre, subGenre, artistInspiration, voiceType
    );

    console.log('=== STYLE PROMPT ===');
    console.log(stylePrompt.substring(0, 400));
    console.log('=== NEGATIVE TAGS ===');
    console.log(negativeTags.substring(0, 200));

    // ==========================================================================
    // STEP 2: Claude generates LYRICS + emotional modifiers
    // ==========================================================================
    const displayGenre = subGenreName || genreName || genre;
    
    const claudePrompt = `Eres un compositor experto de música ${displayGenre} mexicana/latina.

INFORMACIÓN:
- GÉNERO: ${displayGenre}
${artistInspiration ? `- INSPIRACIÓN: Estilo de ${artistInspiration}` : ''}
- DESTINATARIO: ${recipientName}
- REMITENTE: ${senderName}
- RELACIÓN: ${relationshipDesc}
- OCASIÓN: ${occasionDesc}
- VOZ: ${voiceDesc}

DETALLES PERSONALES:
${details || 'Crear contenido emotivo apropiado para la ocasión.'}

GENERA JSON con:
1. "lyrics": Letra completa en español mexicano. Menciona "${recipientName}" 2-3 veces. Estructura: [Verso 1], [Coro], [Verso 2], [Coro], [Puente], [Coro Final]
2. "emotionalModifiers": Máximo 25 palabras en INGLÉS describiendo la emoción/atmósfera única (NO género/instrumentos/tempo)

Ejemplos de emotionalModifiers:
- "warm nostalgic family celebration, joyful gathering, grateful tribute"
- "passionate romantic confession, heart racing anticipation, intimate devotion"
- "bittersweet farewell, cherished memories, hopeful goodbye"

RESPONDE SOLO JSON:
{"lyrics": "[Verso 1]\\n...", "emotionalModifiers": "..."}`;

    console.log('Calling Claude...');
    
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'x-api-key': ANTHROPIC_API_KEY!, 
        'anthropic-version': '2023-06-01' 
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: claudePrompt }]
      })
    });
    
    const claudeData = await claudeResponse.json();
    
    if (!claudeResponse.ok || !claudeData.content?.[0]?.text) {
      throw new Error('Claude API failed: ' + JSON.stringify(claudeData));
    }

    let lyrics: string;
    let emotionalModifiers: string = '';
    
    try {
      const responseText = claudeData.content[0].text.trim();
      let jsonStr = responseText;
      
      if (responseText.includes('```json')) {
        jsonStr = responseText.split('```json')[1].split('```')[0].trim();
      } else if (responseText.includes('```')) {
        jsonStr = responseText.split('```')[1].split('```')[0].trim();
      }
      
      const parsed = JSON.parse(jsonStr);
      lyrics = parsed.lyrics;
      emotionalModifiers = parsed.emotionalModifiers || '';
      
      console.log('✓ Lyrics parsed');
      console.log('Emotional modifiers:', emotionalModifiers);
      
    } catch (parseError) {
      console.error('JSON parse failed, using raw text');
      lyrics = claudeData.content[0].text;
    }

    // ==========================================================================
    // STEP 3: Combine DNA style + emotional modifiers
    // ==========================================================================
    let finalStyle = stylePrompt;
    if (emotionalModifiers) {
      finalStyle = `${stylePrompt}, ${emotionalModifiers}`;
    }
    finalStyle = finalStyle.substring(0, 980);

    console.log('=== FINAL STYLE (length: ' + finalStyle.length + ') ===');

    // ==========================================================================
    // STEP 4: Generate album art
    // ==========================================================================
    const genreVisuals: Record<string, string> = {
      corrido: 'Mexican desert sunset, acoustic guitar silhouette, Sinaloa vibes',
      norteno: 'Accordion bajo sexto, northern Mexico cantina, amber tones',
      banda: 'Brass instruments, Sinaloa colors, tuba silhouette, fiesta',
      ranchera: 'Mariachi silhouette, hacienda moonlight, agave plants',
      sierreno: 'Mountain landscape, acoustic guitar, Sierra Madre',
      mariachi: 'Mariachi ensemble silhouette, Mexican flag colors',
      cumbia: 'Tropical colors, dancing silhouettes, palm trees',
      salsa: 'Caribbean colors, piano congas, NYC energy',
      bachata: 'Dominican sunset, guitar silhouette, palm trees',
      merengue: 'Dominican colors, tambora drum, festive dance',
      vallenato: 'Colombian coast, accordion, tropical sunset',
      reggaeton: 'Urban neon lights, purple blue city',
      latin_trap: 'Dark urban aesthetic, neon glow',
      pop_latino: 'Colorful abstract, dynamic energy',
      balada: 'Piano candlelight, romantic roses',
      bolero: 'Vintage microphone, 1950s noir',
      grupera: '80s-90s aesthetic, keyboard nostalgic',
      tejano: 'Texas star, accordion, border aesthetic'
    };
    
    const imagePrompt = `album cover art, digital illustration, ${genreVisuals[genre] || 'Latin music aesthetic'}, vibrant colors, no text, no human faces, square format, professional`;
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=512&height=512&seed=${seed}&nologo=true`;

    // ==========================================================================
    // STEP 5: Save to database
    // ==========================================================================
    const { data: songRecord, error: dbError } = await supabase.from('songs').insert({
      session_id: currentSessionId,
      version: 1,
      recipient_name: recipientName,
      sender_name: senderName,
      relationship: relationship,
      relationship_custom: customRelationship || null,
      genre: genre,
      genre_name: genreName || null,
      sub_genre: subGenre || null,
      sub_genre_name: subGenreName || null,
      occasion: occasion,
      occasion_custom: customOccasion || null,
      emotional_tone: emotionalTone || null,
      details: details,
      email: email,
      lyrics: lyrics,
      audio_url: null,
      preview_url: null,
      image_url: imageUrl,
      status: 'processing',
      paid: false,
      selected: false,
      voice_type: voiceType || 'male',
      artist_inspiration: artistInspiration || null,
      style_used: finalStyle
    }).select().single();

    if (dbError) throw new Error('DB error: ' + dbError.message);
    
    const songId = songRecord.id;
    console.log('Song saved:', songId);

    // ==========================================================================
    // STEP 6: Call Kie.ai
    // ==========================================================================
    const callBackUrl = `${SUPABASE_URL}/functions/v1/song-callback`;
    
    const kiePayload = {
      prompt: lyrics,
      customMode: true,
      style: finalStyle,
      title: `Canción para ${recipientName}`,
      instrumental: false,
      model: 'V4_5',
      callBackUrl: callBackUrl,
      negativeTags: negativeTags,
      vocalGender: vocalGender,
      styleWeight: 0.85 // Stricter style enforcement
    };

    console.log('=== CALLING KIE.AI ===');
    console.log('StyleWeight: 0.85');
    
    const musicResponse = await fetch('https://api.kie.ai/api/v1/generate', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${KIE_API_KEY}` 
      },
      body: JSON.stringify(kiePayload)
    });
    
    const musicData = await musicResponse.json();
    const taskId = musicData.data?.taskId;
    
    if (!taskId) {
      await supabase.from('songs').update({ status: 'failed' }).eq('id', songId);
      throw new Error('No taskId from Kie.ai: ' + JSON.stringify(musicData));
    }

    await supabase.from('songs').update({ task_id: taskId }).eq('id', songId);
    console.log('TaskId:', taskId);

    return new Response(JSON.stringify({
      success: true,
      song: { id: songId, status: 'processing', imageUrl },
      sessionId: currentSessionId
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
