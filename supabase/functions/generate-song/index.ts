import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const USEAPI_TOKEN = Deno.env.get('USEAPI_TOKEN');
const MUREKA_ACCOUNT = Deno.env.get('MUREKA_ACCOUNT');
const MUREKA_MODEL = Deno.env.get('MUREKA_MODEL') || 'V9';
const MUREKA_FALLBACK_MODEL = 'V8';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Optional admin override PIN. When set as a Supabase secret, the owner can
// type this PIN into the rate-limit error UI to bypass the hard IP block AND
// all 3 unpaid-song rate limits. Used when the owner's own IP/email gets
// caught by the soft caps during testing. Empty/unset = override disabled.
const ADMIN_OVERRIDE_PIN = Deno.env.get('ADMIN_OVERRIDE_PIN') || '';

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
  vocalCharacter?: string; // gender-neutral vocal delivery style for Mureka desc
}

interface GenreData {
  baseStyle: string;
  defaultTempo: string;
  instruments: string;
  negativeTags: string;
  defaultVocalCharacter?: string; // fallback vocal character if sub-genre doesn't specify
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
    negativeTags: 'EDM, dubstep, techno, K-pop, country western, jazz, classical orchestra, pop punk, rock guitar distortion',
    defaultVocalCharacter: 'confident narrative vocal, storytelling delivery, clear diction',
    subGenres: {
      tradicional: {
        name: 'Corrido Tradicional',
        style: '1980s 1990s old-school slow Sinaloan-style corrido tradicional, classic Mexican narrative corrido in the rural Sinaloa cassette-era storytelling tradition, single male storyteller singing a true story over an accordion-led conjunto bed, octosyllabic four-line stanzas, strophic verse-after-verse song form, instrumental accordion ride between sung verses, analog cassette recording aesthetic, dry live-in-room mix, narrow stereo, warm tape saturation',
        tempo: '75-92 BPM steady slow-corrido pulse, deliberate unhurried storytelling pace, the slow narrative end of the corrido tempo spectrum where every word of the lyric has plenty of room to breathe and land, gentle walking 2/4 corrido groove with kick on beat 1 and a soft rim-click or snare on beat 2, NOT a polka party tempo, NOT a fast accordion polka, NOT a dance tempo, NOT uptempo, NOT energetic, NOT supernatural fast, but ALSO not a slow 4/4 pop ballad',
        instruments: 'lead is the diatonic three-row button accordion only, every melodic fill and the short instrumental ride between verses played on accordion with grace notes bellows shakes and scalar runs, bajo sexto twelve-string baritone guitar with a soft 2/4 chord chuck on beat 2, electric bass quarter-note pattern on root and fifth, gentle drum kit with kick on beat 1 and a soft rim-click or brushed snare on beat 2, no busy fills, no charcheta rolls, occasional grito vocal shouts of Ajua or Eha or short whistles between phrases',
        vibe: '1980s 1990s slow Sinaloan-style corridista storyteller delivery from an analog cassette recording, working-class rural Mexican Sinaloa-to-border authenticity, dry warm mix, accordion sitting present in the midrange, bajo sexto rhythmic and forward, drums small dry and tight, no long reverb tails, no modern polish, reportorial narrative production, the unmistakable warmth of cassette-era corridos',
        negative: 'fast tempo, uptempo, dance tempo, party tempo, party polka, fast polka, dancing polka, energetic polka, breakneck polka, supernatural fast pulse, dance corrido, breakneck dance tempo, mid-tempo polka, brisk polka, rushed delivery, charcheta rolls, busy drum fills, slow 4/4 pop ballad, 4/4 pop song, modern radio polish, polished production, 2010s 2020s production, wide stereo, deep sub bass, long vocal reverb, sidechain compression, saxophone, alto saxophone, tenor saxophone, sax solo, sax fills, norteño-sax, brass section, trumpets, trombones, banda brass, sierreño nylon guitar, requinto guitar, classical guitar lead, tololoche upright bass, tuba, mariachi violins, strings, orchestral pads, trap beats, trap hi-hats, 808 bass, sub-bass, auto-tune, corridos tumbados, corridos alterados, modern 2010s 2020s corridos, sad sierreño, romantic softness, synthesizers, electronic drums, programmed drums, female lead vocal, female harmony, duet, two voices, harmony vocal layers',
        vocalCharacter: 'single male storyteller lead vocal, slow Sinaloan-style corridista narrator with strong consonants and clear diction so every word of the story lands, unhurried phrasing, raw rural Mexican unpolished tone, classic 1980s 1990s cassette-era recording'
      },
      tumbados: {
        name: 'Corridos Tumbados',
        style: 'corridos tumbados, Mexican trap corrido fusion, 2020s generation, half-time trap feel with regional Mexican melody, laid-back melodic flow, modern sierreño trap hybrid, light Auto-Tune vocals, acoustic-forward mix with subtle trap support, minor key tonality',
        tempo: '85-105 BPM half-time feel in 4/4, or 140-160 BPM in 3/4 corrido waltz, laid-back groove, relaxed swaying pace',
        instruments: 'requinto sierreño nylon guitar lead, 12-string rhythm guitar, tololoche upright bass or tuba bass, 808 sub-bass layered underneath, sparse trap hi-hats, half-time clap snare, occasional accordion accents, clean guitar arpeggios',
        vibe: 'relaxed swagger, melancholic introspection, modern street credibility, sierreño soul with trap attitude, chill melodic, dark tense undertones, minor key sadness',
        negative: 'dominant accordion lead, polka rhythm, fast tempo, full banda brass, traditional norteño, charcheta snare rolls, uptempo energy, heavy distortion, major key brightness',
        vocalCharacter: 'laid-back melodic vocal, relaxed flow, light auto-tune, cool effortless delivery, modern melodic'
      },
      belico: {
        name: 'Corrido Bélico',
        style: 'corrido belico, dark aggressive corrido, sierreño-based street corrido, minor key brass corrido, propulsive norteño groove, polka-derived 2/4 rhythmic drive',
        tempo: '95-120 BPM, brisk driving pace, propulsive polka-derived groove, fast norteño pulse',
        instruments: 'requinto guitar with rapid ornamental runs, rhythm guitar, tololoche slap bass, tuba bass reinforcement, trombones, trumpets, charcheta alto horn, tarola snare, heavy kick drum, subtle trap hi-hats',
        vibe: 'menacing, confrontational, dark minor key, street danger, propulsive, assertive, epic intensity, raw intimidation, terse and aggressive',
        negative: 'happy melodies, romantic vibes, soft acoustic sounds, mariachi violins, cheerful major key, accordion, laid-back chill, slow tempo, gentle arpeggios',
        vocalCharacter: 'assertive aggressive vocal, raw gritty delivery, street attitude, confrontational intensity, terse and sharp'
      },
      alterados: {
        name: 'Corridos Alterados',
        style: 'corridos alterados, corridos progresivos, movimiento alterado, high speed banda corrido, fast Sinaloa party corrido, rapid-fire 2/4 polka corrido, adrenaline-fueled narco corrido, loud saturated production',
        tempo: '115-145 BPM, HIGH ENERGY, FAST 2/4 polka tempo, driving uptempo rush, breakneck speed',
        instruments: 'brass section trumpets trombones clarinets, tuba bass, tambora, tarola Mexican snare, accordion, bajo sexto, fast polka rhythm section, optional requinto 12-string guitar',
        vibe: 'party adrenaline, bold unapologetic bravado, celebratory chaos, fast driving intensity, Sinaloa fiesta brava, swagger, loud and bombastic',
        negative: 'slow ballads, acoustic intimacy, sad sierreño, romantic softness, trap beats, 808 bass, half-time feel, dark brooding, laid-back tempo, corridos tumbados style',
        vocalCharacter: 'bold loud vocal, rapid-fire delivery, high energy projection, unapologetic bravado, party shouting energy'
      },
      romantico: {
        name: 'Corrido Romántico',
        style: 'corrido romantico, romantic narrative corrido, norteno-banda romantico, sentimental Mexican corrido, 3/4 waltz feel or gentle polka rhythm, narrative storytelling structure',
        tempo: '95-120 BPM, moderate flowing tempo, gentle swaying pace, 3/4 waltz or soft polka feel',
        instruments: 'diatonic accordion, bajo sexto twelve-string guitar, sousaphone or tuba bass, soft trumpets, requinto guitar melodies, tololoche upright bass, light percussion, optional clarinet accents',
        vibe: 'romantic, sentimental, heartfelt storytelling, tender devotion, amor sincero, nostalgic warmth, earnest sincere male vocals',
        negative: 'aggressive lyrics, dark tones, trap beats, 808 bass, charcheta rolls, rushed very fast tempo, confrontational energy, corridos tumbados style',
        vocalCharacter: 'earnest sincere vocal, tender storytelling delivery, warm emotional tone, sentimental and heartfelt'
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
    defaultVocalCharacter: 'bright energetic vocal, festive cantina delivery',
    subGenres: {
      tradicional: {
        name: 'Norteño Tradicional',
        style: 'traditional norteño, classic conjunto norteño, accordion-driven polka rhythm northern Mexican music, authentic Tex-Mex conjunto, oom-pah bass pattern, two-step dance groove, cantina norteño',
        tempo: '110-130 BPM, upbeat polka-derived groove, energetic two-step dance tempo',
        instruments: 'diatonic button accordion with bellows dynamics and melodic runs, bajo sexto twelve-string with percussive downstroke strumming, electric bass walking lines, polka drum pattern with rim shots and backbeat snare, optional alto saxophone fills between verses',
        vibe: 'festive cantina energy, working-class pride, Friday night dance, beer-drinking celebration, authentic border culture, accordion-forward joyful',
        negative: 'electronic beats, trap production, urban sounds, reggaeton, modern pop, synthesizers',
        vocalCharacter: 'bright energetic vocal, festive delivery, sing-along friendly, cantina warmth'
      },
      con_sax: {
        name: 'Norteño con Sax',
        style: 'norteño with saxophone lead melody, norteño-sax fusion, alto saxophone carrying main melody over accordion harmony, romantic norteño with sax, smooth saxophone-forward northern Mexican',
        tempo: '100-120 BPM, smooth swaying energy, romantic dance groove',
        instruments: 'alto saxophone melodic lead with vibrato, diatonic accordion harmony and fills, bajo sexto rhythm guitar, electric bass, drums with norteño polka pattern, occasional trumpet accents',
        vibe: 'romantic yet energetic, classy wedding party, elegant saxophone serenading, sophisticated norteño, couples dancing close',
        negative: 'heavy metal guitars, EDM drops, aggressive trap, rock sounds, harsh distortion, raw lo-fi',
        vocalCharacter: 'smooth romantic vocal, elegant delivery, polished and warm'
      },
      nortena_banda: {
        name: 'Norteña-Banda',
        style: 'norteña-banda hybrid, brass-enhanced norteño, powerful northern Mexican with full brass section layered over accordion, big band norteño, Sinaloa-Monterrey fusion, maximum instrumentation',
        tempo: '110-130 BPM, powerful driving groove, big stadium energy, festa brava tempo',
        instruments: 'brass section trumpets trombones, tuba sousaphone bass, tarola snare with charcheta rolls, tambora bass drum, diatonic accordion, bajo sexto twelve-string, full percussion section',
        vibe: 'massive stadium sound, maximum celebration energy, fiesta peak moment, powerful and overwhelming, crowd-pumping anthem, rodeo arena',
        negative: 'intimate acoustic, solo guitar, quiet ballads, minimalist, soft, gentle, lo-fi',
        vocalCharacter: 'powerful projecting vocal, stadium energy, bold and commanding'
      },
      romantico: {
        name: 'Norteño Romántico',
        style: 'romantic norteño ballad, soft gentle northern Mexican love song, tender accordion-driven romance, slow norteño dedication, emotional conjunto ballad',
        tempo: '85-100 BPM, gentle swaying tempo, tender ballad pace, slow dance groove',
        instruments: 'accordion with sustained emotional notes and soft bellows, bajo sexto gentle arpeggios, soft brushed drums, electric bass, occasional string pad, light saxophone melody',
        vibe: 'tender heartfelt dedication, sentimental love confession, slow dancing together, wedding first dance, moonlit serenade with accordion, vulnerable emotion',
        negative: 'aggressive corridos, party anthems, brass-heavy banda, trap, fast uptempo, dark',
        vocalCharacter: 'tender emotional vocal, gentle vulnerability, heartfelt soft delivery'
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
    defaultVocalCharacter: 'powerful projecting vocal, dramatic emotional delivery',
    subGenres: {
      romantica: {
        name: 'Banda Romántica',
        style: 'romantic banda, emotional banda ballad, SLOW banda sinaloense, love song banda, ballad',
        tempo: '70-90 BPM, SLOW emotional tempo, ballad pace',
        instruments: 'full brass (trumpets, trombones, clarinets), tuba, snare/tarola',
        vibe: 'emotional, heartbreak, dedication songs, tearful confessions, romantic',
        negative: 'fast quebradita, electronic music, rock guitars, reggaeton, uptempo, FAST, party, dance',
        vocalCharacter: 'powerful emotional vocal, dramatic belting, tearful intensity, full vibrato'
      },
      quebradita: {
        name: 'Quebradita',
        style: 'quebradita, FAST danceable banda, HIGH ENERGY party banda, 1990s quebradita dance craze, uptempo brass, driving rhythm, dance music',
        tempo: '130-160 BPM, VERY FAST, HIGH ENERGY, UPTEMPO, QUICK TEMPO, dance tempo',
        instruments: 'brass, tuba, FAST driving snare, tambora, driving percussion, energetic brass',
        vibe: 'dance craze energy, athletic, acrobatic, 90s nostalgia, PARTY, HIGH ENERGY, dancing',
        negative: 'slow ballads, trap beats, acoustic intimacy, modern corridos, romantic, SLOW tempo, ballad, gentle, soft, emotional',
        vocalCharacter: 'high energy party vocal, loud celebratory, dance-calling energy'
      },
      tecnobanda: {
        name: 'Tecnobanda',
        style: 'tecnobanda, electronic-fused banda, 90s synth banda, electronic drums with brass',
        tempo: '120-140 BPM, FAST electronic-fused, dance tempo',
        instruments: 'synthesizers mixed with brass, electronic drums, tuba',
        vibe: 'retro-futuristic, 90s party, high-energy dance, electronic feel',
        negative: 'pure acoustic, traditional corridos, modern trap, sad ballads, slow',
        vocalCharacter: 'bright energetic vocal, retro party delivery, 90s dance energy'
      },
      sinaloense_clasica: {
        name: 'Banda Sinaloense Clásica',
        style: 'classic banda sinaloense, traditional Sinaloa brass band, authentic 15-piece banda',
        tempo: '90-110 BPM, traditional moderate tempo',
        instruments: 'full 15+ piece brass, clarinets, tubas, tarola',
        vibe: 'authentic Sinaloa pride, timeless, festive, classic polish',
        negative: 'lo-fi production, trap beats, electronic sounds, rock, modern',
        vocalCharacter: 'polished classic vocal, strong clear projection, traditional authority'
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
    defaultVocalCharacter: 'powerful dramatic vocal, vibrato, theatrical emotion',
    subGenres: {
      lenta: {
        name: 'Ranchera Lenta',
        style: 'slow dramatic ranchera ballad, emotional Mexican ranchera, crying ranchera with dramatic pauses, golden-age ranchera tradition, grito de dolor, theatrical vocal delivery with vibrato',
        tempo: '50-70 BPM, VERY SLOW, dramatic pauses between phrases, rubato vocal phrasing, ballad with breathing room',
        instruments: 'mariachi violin section with sustained emotional bowing, trumpet fanfare between verses then soft sustained notes, vihuela gentle strumming, guitarrón deep bass notes, harp arpeggios optional',
        vibe: 'deep sorrow, dramatic heartbreak, crying-in-your-drink cantina emotion, tearful confession, tequila and tears, mariachi at 3am, grito from the soul',
        negative: 'upbeat rhythms, electronic beats, happy party vibes, trap, fast tempo, dance energy',
        vocalCharacter: 'powerful dramatic vocal, deep vibrato, tearful belting, theatrical pauses'
      },
      brava: {
        name: 'Ranchera Brava',
        style: 'fast fiery ranchera, energetic celebratory mariachi, uptempo ranchera with grito, powerful defiant ranchera, Mexican pride anthem, modern fiery ranchera style with full mariachi',
        tempo: '120-140 BPM, FAST fiery tempo, energetic 3/4 waltz or 2/4 march, driving celebratory pace',
        instruments: 'mariachi full ensemble, aggressive trumpet fanfares and staccato runs, violin section playing rapid passages in unison, vihuela percussive strumming, guitarrón driving bass line, occasional guitar solo',
        vibe: 'defiant proud energy, celebratory machismo, grito-inducing power, fist-raising anthem, Mexican independence spirit, fiesta patria, charreada arena energy',
        negative: 'soft pop, electronic music, slow sad songs, modern urban, gentle, minimalist',
        vocalCharacter: 'fiery powerful vocal, defiant projection, grito energy, proud and bold'
      },
      moderna: {
        name: 'Ranchera Moderna',
        style: 'modern contemporary ranchera, updated mariachi with clean modern production, modern young romantic ranchera style, young ranchera with subtle pop sensibility, traditional soul with modern polish',
        tempo: '80-100 BPM, contemporary moderate tempo, modern feel with traditional pacing',
        instruments: 'mariachi ensemble with modern recording clarity, clean trumpet lines, violin section, vihuela, guitarrón, subtle reverb and modern EQ, occasional acoustic guitar, light percussion shaker',
        vibe: 'updated classic ranchera feel, youthful energy respectful of roots, modern Mexican pride, Instagram-era mariachi, accessible yet authentic, crossover appeal',
        negative: 'full trap production, reggaeton beats, EDM, rock guitars, heavy electronic, lo-fi raw',
        vocalCharacter: 'clean modern vocal, accessible emotional delivery, youthful polish'
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
    defaultVocalCharacter: 'intimate acoustic vocal, raw honest delivery',
    subGenres: {
      tradicional: {
        name: 'Sierreño Tradicional',
        style: 'traditional sierreño, Sierra Madre mountain music of Mexico, raw acoustic guitar storytelling, rural rancho sound, unplugged regional Mexican, three-guitar ensemble acoustic corrido',
        tempo: '90-110 BPM, moderate flowing tempo, storytelling pace, natural acoustic rhythm',
        instruments: 'requinto sierreño nylon guitar with ornamental bending trills and hammer-ons, twelve-string rhythm guitar strumming, tololoche upright bass with slap technique, minimal kick drum or cajón, no electronic instruments',
        vibe: 'mountain authenticity, raw unpolished storytelling, rural rancho simplicity, acoustic campfire intimacy, Sierra Madre soul, honest and unpretentious',
        negative: 'brass instruments, electronic beats, polished pop production, banda, modern trap, synthesizers',
        vocalCharacter: 'raw honest vocal, unpolished storytelling, acoustic intimacy, mountain soul'
      },
      moderno_sad: {
        name: 'Sierreño Sad',
        style: 'sad sierreño, emotional melancholic sierreño, sad boy regional Mexican, modern sierreño with heartbreak, minor key acoustic requinto ballad, corridos tumbados influence with acoustic soul',
        tempo: '60-80 BPM, SLOW melancholic pace, breathing room between phrases, heartbreak tempo',
        instruments: 'clean requinto sierreño with slow expressive bends and vibrato, tololoche deep sustained bass notes, soft brushed percussion or no drums, reverb on guitar, occasional twelve-string arpeggios, ambient room sound',
        vibe: 'heartbreak at 3am, lonely loneliness, tears falling, emotional vulnerability, sad boy aesthetic, modern sadness with traditional soul, whispered pain, dark room introspection',
        negative: 'happy dance music, brass instruments, fast tempos, party energy, upbeat celebration, loud production',
        vocalCharacter: 'vulnerable breathy vocal, emotional cracking, whispered pain, intimate sadness'
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
    defaultVocalCharacter: 'powerful operatic vocal, vibrato, dramatic projection',
    subGenres: {
      tradicional: {
        name: 'Mariachi Tradicional',
        style: 'traditional classic mariachi, ceremonial Mexican mariachi ensemble, authentic son jalisciense, Jalisco mariachi, formal mariachi with full instrumentation, polished ensemble performance',
        tempo: '90-120 BPM, variable classic tempo, son rhythm, waltz and march alternating',
        instruments: 'violin section playing melodic passages in unison and harmony, trumpet duo with fanfare intros and sustained notes, vihuela percussive strumming providing harmonic rhythm, guitarrón deep bass on beats one and three, classical guitar arpeggios, optional harp',
        vibe: 'Mexican national pride, elegant ceremony, timeless tradition, plaza Garibaldi atmosphere, formal beauty, cultural heritage, wedding ceremony, quinceañera vals',
        negative: 'electronic production, trap, rock guitars, modern urban beats, synthesizers, lo-fi',
        vocalCharacter: 'formal powerful vocal, operatic projection, ceremonial grandeur, vibrato'
      },
      ranchero: {
        name: 'Mariachi Ranchero',
        style: 'energetic ranchero mariachi, fiesta mariachi with gritos, bold celebratory mariachi, powerful mariachi anthem, uptempo fiesta brava, classic golden-age joyful mariachi style',
        tempo: '100-130 BPM, energetic driving tempo, festive and uplifting pace, march-like energy',
        instruments: 'full mariachi ensemble, aggressive trumpet fanfares with staccato runs, violin section rapid bowing passages, vihuela driving percussive strumming, guitarrón strong rhythmic bass, grito vocal exclamations',
        vibe: 'bold masculine declarations, celebratory machismo, fiesta-ready energy, grito-inducing moments, rodeo arena power, charreada pride, Mexican Independence party',
        negative: 'soft gentle pop, lo-fi production, electronic beats, sad trap, slow ballad, minimalist',
        vocalCharacter: 'bold fiery vocal, grito-inducing power, defiant energy, proud belting'
      },
      romantico: {
        name: 'Mariachi Romántico',
        style: 'romantic mariachi ballad, serenata mariachi, soft tender mariachi love song, moonlit serenade, violin-led romantic mariachi, intimate courtship mariachi',
        tempo: '60-80 BPM, SLOW tender pace, breathing room between phrases, serenata tempo',
        instruments: 'violins prominent with sustained legato bowing and emotional vibrato, soft muted trumpets playing gentle sustained notes, delicate guitarrón bass, vihuela soft arpeggios, classical guitar, optional cello',
        vibe: 'serenata under the balcony, moonlit courtship, deep vulnerable romance, tearful love dedications, wedding first dance, proposal moment, roses and candles',
        negative: 'fast dance rhythms, brass-heavy banda, aggressive sounds, uptempo party, electronic',
        vocalCharacter: 'tender lyrical vocal, soft intimate delivery, serenading sweetness, gentle vibrato'
      },
      moderno: {
        name: 'Mariachi Moderno',
        style: 'modern contemporary mariachi, updated mariachi with clean studio production, young generation mariachi, contemporary romantic mariachi style with subtle pop influence, traditional instruments with modern recording clarity',
        tempo: '85-110 BPM, contemporary moderate tempo, accessible modern pacing',
        instruments: 'classic mariachi ensemble with modern pristine recording quality, clean trumpet lines with reverb, violin section with studio clarity, vihuela, guitarrón, subtle acoustic guitar, light modern percussion shaker',
        vibe: 'fresh modern take on mariachi classics, appeals to younger generation, Instagram-era elegance, accessible yet authentic, modern Mexican cultural pride, streaming-friendly',
        negative: 'full electronic production, trap beats, reggaeton dembow rhythm, heavy distortion, lo-fi raw',
        vocalCharacter: 'clean modern vocal, youthful accessible delivery, polished emotion'
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
    defaultVocalCharacter: 'bright festive vocal, dance-friendly delivery',
    subGenres: {
      sonidera: {
        name: 'Cumbia Sonidera',
        style: 'cumbia sonidera, Mexico City cumbia, barrio cumbia, synth-heavy cumbia, wepa sounds',
        tempo: '95-110 BPM, steady groove, dance tempo',
        instruments: 'synth leads (wepa sounds), güiro, congas, bass',
        vibe: 'barrio party, working-class celebration, nostalgic dance',
        negative: 'rock guitars, trap beats, slow ballads, banda brass, acoustic only',
        vocalCharacter: 'bright barrio vocal, party MC energy, call-and-response, festive shouting'
      },
      nortena: {
        name: 'Cumbia Norteña',
        style: 'cumbia norteña, accordion cumbia, northern Mexican cumbia, Tex-Mex cumbia',
        tempo: '100-120 BPM, bouncy, energetic',
        instruments: 'accordion, bajo sexto, timbales, güiro',
        vibe: 'Tex-Mex fusion, border culture, cantina dance party',
        negative: 'electronic drops, brass banda, reggaeton dembow, rock, EDM',
        vocalCharacter: 'accordion-friendly vocal, Tex-Mex warmth, working-class authenticity'
      },
      texana: {
        name: 'Cumbia Texana',
        style: 'cumbia texana, Texas cumbia, Tejano cumbia, polished cumbia',
        tempo: '100-115 BPM, polished, clean',
        instruments: 'keyboards, accordion, polished drums, bass',
        vibe: 'Texas pride, crossover appeal, radio-friendly, nostalgic',
        negative: 'raw lo-fi, aggressive corridos, trap, heavy brass, dark',
        vocalCharacter: 'smooth bilingual vocal, crossover delivery, Tex-Mex charm'
      },
      grupera: {
        name: 'Cumbia Grupera',
        style: 'cumbia grupera, keyboard cumbia, 90s cumbia, grupera style cumbia',
        tempo: '95-115 BPM, dance-ready',
        instruments: 'keyboards, guitars, drums, occasional accordion',
        vibe: '80s/90s nostalgia, quinceañera vibes, romantic dance',
        negative: 'modern trap, aggressive lyrics, electronic EDM, rock, dark',
        vocalCharacter: 'warm nostalgic vocal, romantic 90s delivery, keyboard-era smoothness'
      },
      romantica: {
        name: 'Cumbia Romántica',
        style: 'romantic cumbia, slow cumbia, love song cumbia, couples cumbia',
        tempo: '90-105 BPM, gentle groove',
        instruments: 'soft synths, güiro, light percussion, strings',
        vibe: 'tender dance, couples slow-dancing, sweet dedications',
        negative: 'fast party cumbia, aggressive sounds, trap, rock, hard',
        vocalCharacter: 'sweet tender vocal, gentle romantic delivery, slow-dance intimacy'
      },
      colombiana: {
        name: 'Cumbia Colombiana',
        style: 'Colombian cumbia, original cumbia, tropical cumbia, classic cumbia',
        tempo: '85-100 BPM, classic swing',
        instruments: 'accordion, güiro, congas, piano, brass accents',
        vibe: 'original cumbia feel, tropical warmth, elegant dance',
        negative: 'Mexican norteño sound, trap, electronic, fast tempos, modern',
        vocalCharacter: 'tropical bright vocal, Caribbean warmth, authentic Colombian flavor'
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
    defaultVocalCharacter: 'powerful rhythmic vocal, Caribbean swing, soneo delivery',
    subGenres: {
      clasica_dura: {
        name: 'Salsa Clásica',
        style: 'classic salsa, salsa dura, hard salsa, NYC salsa, Fania style salsa',
        tempo: '160-200 BPM, FAST intense, high energy',
        instruments: 'piano, congas, timbales, bongos, trumpets, trombones',
        vibe: 'barrio NYC energy, socially conscious, street celebration',
        negative: 'slow ballads, electronic beats, rock guitars, corridos, gentle',
        vocalCharacter: 'powerful soneo vocal, improvisational delivery, street barrio energy, rhythmic precision'
      },
      romantica: {
        name: 'Salsa Romántica',
        style: 'romantic salsa, salsa romantica, smooth salsa, love song salsa',
        tempo: '140-170 BPM, smooth energy, sensual',
        instruments: 'piano, strings, congas, softer brass, bongos',
        vibe: 'heartfelt love, sensual dance, romantic confessions',
        negative: 'aggressive brass, political lyrics, rock, trap beats, harsh',
        vocalCharacter: 'smooth sensual vocal, intimate Latin lover delivery, polished romantic'
      },
      urbana: {
        name: 'Salsa Urbana',
        style: 'urban salsa, modern salsa, salsa fusion, contemporary salsa',
        tempo: '150-180 BPM, modern fusion',
        instruments: 'traditional percussion + modern beats, synth accents',
        vibe: 'contemporary club appeal, fusion-friendly, crossover',
        negative: 'pure traditional only, acoustic only, corrido style, rock',
        vocalCharacter: 'modern fresh vocal, contemporary Latin delivery, crossover energy'
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
    defaultVocalCharacter: 'smooth romantic vocal, sensual delivery, emotional bending',
    subGenres: {
      tradicional: {
        name: 'Bachata Tradicional',
        style: 'traditional Dominican bachata, classic guitar bachata, barrio bachata, raw authentic bachata sound, early-2000s authentic Dominican bachata, acoustic Dominican bachata with street soul',
        tempo: '120-140 BPM, classic bachata derecho rhythm, syncopated guitar groove, swaying dance beat',
        instruments: 'requinto lead guitar with bending hammer-on ornaments, rhythm guitar with muted strumming pattern, electric bass guitar syncopated line, bongos with tumbao pattern, güira metal scraper steady rhythm',
        vibe: 'Dominican barrio romance, raw honest heartbreak, street corner serenade, colmado music, authentic working-class love stories',
        negative: 'electronic production, trap, rock guitars, fast dance, EDM, polished pop',
        vocalCharacter: 'raw emotional vocal, barrio authenticity, heartbreak honesty, crying delivery'
      },
      urbana_sensual: {
        name: 'Bachata Sensual',
        style: 'urban sensual bachata, modern bachata with R&B influence, contemporary urban bachata with sensual romantic vibe, polished crossover bachata production, nightclub sensual bachata, smooth contemporary Dominican',
        tempo: '125-145 BPM, smooth modern groove, sensual body movement tempo, hip-swaying rhythm',
        instruments: 'electric guitar with clean reverb and chorus effect, R&B-style keyboard pads, modern programmed drums blended with bongos, bass guitar groove, subtle synth strings, güira, occasional saxophone solo',
        vibe: 'sensual seduction, nightclub intimate, polished sophisticated romance, dim lights and cologne, slow grinding dance, modern Latin lover',
        negative: 'raw traditional lo-fi, corridos, banda brass, rock distortion, aggressive harsh sounds',
        vocalCharacter: 'smooth sensual vocal, R&B influenced delivery, seductive and polished'
      },
      romantica: {
        name: 'Bachata Romántica',
        style: 'romantic emotional bachata, heartbreak bachata ballad, crying bachata, classic painful Dominican bachata style, tearful Dominican love song, gut-wrenching romantic bachata',
        tempo: '115-135 BPM, tender emotional groove, heartbreak swaying, crying-while-dancing tempo',
        instruments: 'acoustic guitar prominent with emotional bending, requinto lead with crying vibrato, bongos soft, bass guitar sustained, soft güira, occasional piano chords, string pad',
        vibe: 'deep emotional pain, crying in the dark, heartbreak anthems, love lost, tearful confession, Dominican torch song, broken heart pouring out',
        negative: 'fast party music, aggressive sounds, electronic drops, happy upbeat, EDM',
        vocalCharacter: 'deeply emotional vocal, crying heartbreak delivery, gut-wrenching vulnerability'
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
    defaultVocalCharacter: 'high energy party vocal, bright Caribbean delivery',
    subGenres: {
      clasico: {
        name: 'Merengue Clásico',
        style: 'classic merengue, traditional merengue, Dominican merengue, accordion merengue',
        tempo: '140-160 BPM, FAST traditional, high energy',
        instruments: 'tambora, güira, accordion/sax, bass',
        vibe: 'Dominican pride, festive, wedding party, high-energy dance',
        negative: 'slow songs, electronic beats only, rock, corrido storytelling, gentle',
        vocalCharacter: 'bright joyful vocal, party energy, Caribbean warmth, sing-along delivery'
      },
      mambo_merengue: {
        name: 'Merengue Mambo',
        style: 'mambo merengue, high energy merengue, party merengue, brass merengue',
        tempo: '150-170 BPM, VERY FAST energetic, party tempo',
        instruments: 'heavy tambora, güira, brass, synth accents',
        vibe: 'peak party energy, jumping crowds, summer anthems',
        negative: 'ballads, acoustic intimacy, sad songs, corridos, slow',
        vocalCharacter: 'powerful brass-matching vocal, big band energy, commanding projection'
      },
      urbano: {
        name: 'Merengue Urbano',
        style: 'urban merengue, modern merengue, merengue fusion, contemporary merengue',
        tempo: '135-155 BPM, modern fusion',
        instruments: 'traditional drums with modern production, electronic elements',
        vibe: 'contemporary club appeal, reggaeton-influenced',
        negative: 'pure acoustic, traditional-only sounds, rock, heavy trap',
        vocalCharacter: 'modern energetic vocal, contemporary party delivery, youthful vibes'
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
    defaultVocalCharacter: 'warm storytelling vocal, Colombian romantic delivery',
    subGenres: {
      tradicional: {
        name: 'Vallenato Tradicional',
        style: 'traditional Colombian vallenato, classic accordion-driven vallenato, classic storytelling vallenato style, Valledupar sound, son vallenato and merengue vallenato rhythms',
        tempo: '100-120 BPM, classic swinging groove, paseo rhythm, conversational storytelling pace',
        instruments: 'diatonic accordion with melodic runs and trills carrying the melody, caja vallenata hand drum with syncopated patterns, guacharaca scraper providing steady rhythm, bass guitar',
        vibe: 'Colombian Caribbean coast, narrative storytelling tradition, romantic nostalgia, Festival de la Leyenda Vallenata spirit, parrandero joy, riverside memories',
        negative: 'electronic beats, rock guitars, Mexican regional, trap, heavy modern production',
        vocalCharacter: 'warm narrative vocal, parrandero storytelling, Caribbean coast soul'
      },
      romantico: {
        name: 'Vallenato Romántico',
        style: 'romantic vallenato ballad, emotional Colombian love vallenato, modern romantic Colombian vallenato style, tender accordion love song, serenata vallenata, paseo lento vallenato',
        tempo: '90-110 BPM, tender swaying paseo rhythm, gentle romantic groove, serenata pace',
        instruments: 'accordion with sustained emotional notes and gentle melodic phrases, caja vallenata soft, guacharaca light, acoustic guitar arpeggios, bass guitar, optional string arrangement',
        vibe: 'deep Colombian love songs, serenata under the stars, emotional confessions to the beloved, Caribbean moonlight romance, tender devoted love',
        negative: 'fast party rhythms, aggressive sounds, rock, trap, harsh production',
        vocalCharacter: 'tender emotional vocal, serenading delivery, devoted romantic'
      },
      moderno: {
        name: 'Vallenato Moderno',
        style: 'modern contemporary vallenato, pop-vallenato crossover, modern radio-friendly vallenato style, Colombian accordion-pop fusion with rock influence, radio-friendly Colombian accordion pop',
        tempo: '100-130 BPM, contemporary energetic groove, modern production feel with traditional rhythm',
        instruments: 'accordion with modern clean recording, pop drum kit or programmed drums, electric bass, acoustic guitar, keyboard pads, occasional electric guitar, modern mixing clarity',
        vibe: 'updated fresh vallenato sound, streaming-friendly crossover appeal, young Colombian energy, modern party with traditional soul, radio hit potential',
        negative: 'pure electronic EDM, rock band only, Mexican corrido style, harsh aggressive, lo-fi raw',
        vocalCharacter: 'modern polished vocal, radio-friendly delivery, crossover appeal'
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
    defaultVocalCharacter: 'rhythmic urban vocal, confident delivery, modern flow',
    subGenres: {
      clasico_perreo: {
        name: 'Reggaeton Clásico',
        style: 'classic reggaeton, perreo reggaeton, underground reggaeton, OG dembow',
        tempo: '85-95 BPM, dembow rhythm, steady bounce',
        instruments: 'dembow beat, heavy bass, synth stabs, TR-808',
        vibe: 'underground Puerto Rico, perreo culture, raw street energy',
        negative: 'live instruments, acoustic sounds, corridos, banda brass, folk',
        vocalCharacter: 'rhythmic perreo vocal, dembow flow, street confidence, party commanding'
      },
      romantico: {
        name: 'Reggaeton Romántico',
        style: 'romantic reggaeton, slow reggaeton, sensual reggaeton, R&B reggaeton',
        tempo: '85-95 BPM, smooth dembow, sensual',
        instruments: 'softer synths, dembow, melodic elements, R&B touches',
        vibe: 'sensual, late-night vibes, romantic seduction',
        negative: 'aggressive lyrics, hard trap, acoustic instruments, rock, harsh',
        vocalCharacter: 'melodic smooth vocal, sensual R&B delivery, romantic urban'
      },
      comercial_pop: {
        name: 'Reggaeton Pop',
        style: 'commercial reggaeton, pop reggaeton, radio reggaeton, mainstream reggaeton',
        tempo: '90-100 BPM, radio-friendly, polished',
        instruments: 'polished production, pop synths, clean dembow',
        vibe: 'mainstream appeal, global crossover, radio/streaming hit',
        negative: 'underground raw sound, explicit content, heavy bass only, dark',
        vocalCharacter: 'versatile modern vocal, melodic trap influence, streaming-era delivery'
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
    defaultVocalCharacter: 'dark atmospheric vocal, auto-tune, brooding delivery',
    subGenres: {
      trap_pesado: {
        name: 'Trap Pesado',
        style: 'heavy trap, dark Latin trap, aggressive trap, street trap',
        tempo: '130-160 BPM half-time feel, dark energy',
        instruments: 'heavy 808s, hi-hats, dark synths, distorted bass',
        vibe: 'street credibility, aggressive, dark flexing',
        negative: 'happy melodies, acoustic instruments, clean pop, banda, bright',
        vocalCharacter: 'dark aggressive vocal, heavy auto-tune, menacing delivery, bass-heavy energy'
      },
      trap_melodico: {
        name: 'Trap Melódico',
        style: 'melodic trap, emotional trap, introspective Latin trap',
        tempo: '130-150 BPM half-time, melodic',
        instruments: 'melodic synths, 808s, atmospheric pads, auto-tune',
        vibe: 'emotional yet hard, introspective pain, late-night mood',
        negative: 'pure happy sounds, acoustic guitar, traditional Latin, rock, bright',
        vocalCharacter: 'melodic emotional vocal, singing-rapping hybrid, auto-tune emotional, vulnerable'
      },
      trap_latino: {
        name: 'Trap Latino',
        style: 'Latin trap fusion, crossover trap, accessible Latin trap',
        tempo: '125-145 BPM, fusion-ready',
        instruments: '808s with Latin percussion hints, modern production',
        vibe: 'crossover appeal, blend of trap and Latin roots',
        negative: 'pure acoustic, traditional Mexican, rock guitars, banda, folk',
        vocalCharacter: 'smooth melodic vocal, romantic auto-tune, intimate urban, tender trap'
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
    defaultVocalCharacter: 'clean polished vocal, radio-friendly delivery',
    subGenres: {
      pop_balada: {
        name: 'Pop Balada',
        style: 'Latin pop ballad, emotional slow pop en español, classic crooner-style Latin pop ballad, soft modern Latin pop, radio-friendly emotional slow song, polished studio ballad with orchestral touches',
        tempo: '70-90 BPM, SLOW emotional, breathing room, dramatic pop ballad pacing',
        instruments: 'grand piano chords and arpeggios, string orchestra arrangement, acoustic guitar fingerpicking, soft brushed drums, bass guitar, subtle synth pad warmth, optional choir on chorus',
        vibe: 'radio ballad elegance, emotional but polished, tearful dedication, wedding reception slow dance, telenovela soundtrack, beautiful sadness',
        negative: 'aggressive trap, rock distortion, fast dance music, corridos, regional Mexican, harsh',
        vocalCharacter: 'emotional polished vocal, tearful elegance, radio ballad delivery'
      },
      pop_bailable: {
        name: 'Pop Bailable',
        style: 'upbeat danceable Latin pop, summer Latin pop hit, late-90s/early-2000s globally-charting Latin party pop style, catchy Latin dance pop, feel-good uptempo pop en español, global Latin pop sound',
        tempo: '110-130 BPM, dance-friendly upbeat, infectious groove, summer anthem tempo',
        instruments: 'electronic programmed beats with Latin percussion, synthesizers, congas and timbales accents, bass synth, electric guitar riffs, handclaps, brass stabs, polished maximalist production',
        vibe: 'dance floor anthem, summer hit energy, global appeal, party starter, positive vibes, viral TikTok energy, feel-good celebration',
        negative: 'raw acoustic only, sad slow ballads, traditional folk, heavy rock, dark moody, lo-fi',
        vocalCharacter: 'bright energetic vocal, party anthem delivery, infectious positivity'
      },
      pop_urbano: {
        name: 'Pop Urbano',
        style: 'urban Latin pop, modern pop-reggaeton fusion, streaming era Latin pop, contemporary melodic urban Latin pop style, radio-friendly pop with subtle dembow or trap influence',
        tempo: '90-110 BPM, modern mid-tempo groove, relaxed but groovy, streaming-friendly pace',
        instruments: 'modern programmed drums with subtle dembow hint, synth pads, electric guitar clean, bass synth, vocal processing with light effects, acoustic guitar layer, finger snaps, minimal percussion',
        vibe: 'contemporary streaming hit, youthful fresh energy, Instagram aesthetic, modern Latin romance, accessible global sound, TikTok viral potential',
        negative: 'pure traditional acoustic, rock band heavy, aggressive trap only, regional Mexican, harsh distorted',
        vocalCharacter: 'modern smooth vocal, streaming-era delivery, youthful fresh'
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
    defaultVocalCharacter: 'emotional powerful vocal, dramatic ballad delivery',
    subGenres: {
      balada_clasica: {
        name: 'Balada Clásica',
        style: 'classic orchestral Latin ballad, grand romantic 1970s 1980s ballad en español, classic dramatic crooner-style Latin ballad, classical orchestral love ballad, theatrical emotional Latin ballad with full orchestra, cinematic love song',
        tempo: '60-80 BPM, VERY SLOW, dramatic pauses, rubato phrasing, grand theatrical pacing',
        instruments: 'full string orchestra with sweeping arrangements, grand piano, soft timpani, harp arpeggios, french horn warmth, flute melody, brushed drums, orchestral crescendo builds, choir on final chorus',
        vibe: 'grand romantic gestures, theatrical tearjerker emotion, telenovela climax moment, standing ovation performance, goosebumps crescendo, classic Latin drama',
        negative: 'fast rhythms, electronic beats, rock, trap, party music, uptempo, modern urban, lo-fi',
        vocalCharacter: 'dramatic theatrical vocal, orchestral-matching power, grand emotional belting'
      },
      balada_pop: {
        name: 'Balada Pop',
        style: 'contemporary Latin pop ballad, modern radio ballad en español, modern duo-style Latin pop ballad with soft male vocal, clean modern emotional slow song, polished studio production ballad',
        tempo: '70-90 BPM, contemporary slow, modern pacing, accessible emotional tempo',
        instruments: 'acoustic guitar fingerpicking, piano chords, modern soft programmed drums, electric bass, subtle synth pad, string section accents on chorus, clean guitar arpeggios',
        vibe: 'modern radio ballad, emotional but accessible and polished, Spotify playlist ballad, contemporary heartfelt, young love dedication, relatable modern emotion',
        negative: 'heavy electronic, trap beats, aggressive sounds, banda brass, fast uptempo, rock distortion',
        vocalCharacter: 'polished emotional vocal, modern radio delivery, accessible heartfelt'
      },
      balada_romantica: {
        name: 'Balada Romántica',
        style: 'romantic love ballad, intimate dedication ballad, wedding song ballad en español, tender love confession, acoustic-forward romantic Latin ballad, timeless love song',
        tempo: '65-85 BPM, intimate tender, breathing room between phrases, heartbeat tempo',
        instruments: 'acoustic guitar primary with fingerpicking, soft piano accompaniment, gentle string quartet, minimal soft percussion or no drums, bass guitar sustained notes, optional flute or oboe melody',
        vibe: 'deep romantic confession, wedding ceremony song, eternal love vow, intimate two-people-in-the-world feeling, candlelight dinner, proposal moment, forever love',
        negative: 'party music, fast dance, aggressive sounds, electronic production, harsh, loud brass',
        vocalCharacter: 'intimate tender vocal, whispered confession, gentle vulnerable delivery'
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
    defaultVocalCharacter: 'smooth crooning vocal, intimate vintage delivery',
    subGenres: {
      bolero_clasico: {
        name: 'Bolero Clásico',
        style: 'classic bolero, traditional bolero, 1950s bolero, trio bolero',
        tempo: '50-70 BPM, VERY SLOW, intimate',
        instruments: 'requinto guitar, soft percussion, bass, occasional strings',
        vibe: 'old-school romance, elegant seduction, timeless love',
        negative: 'any modern production, electronic, fast rhythms, rock, loud',
        vocalCharacter: 'intimate crooning vocal, 1950s suave delivery, warm vintage baritone feel'
      },
      bolero_ranchero: {
        name: 'Bolero Ranchero',
        style: 'ranchero bolero, Mexican bolero, mariachi bolero, cantina bolero',
        tempo: '55-75 BPM, slow dramatic',
        instruments: 'mariachi elements (soft trumpets, violins), guitarrón',
        vibe: 'Mexican romantic drama, cantina nostalgia, serenata',
        negative: 'electronic beats, fast tempos, modern urban, trap, loud',
        vocalCharacter: 'cantina intimate vocal, nostalgic delivery, tequila-warmed emotion'
      },
      bolero_moderno: {
        name: 'Bolero Moderno',
        style: 'modern bolero, contemporary bolero, updated bolero, sophisticated bolero',
        tempo: '60-80 BPM, updated classic',
        instruments: 'modern soft production, strings, piano, subtle updates',
        vibe: 'classic feel with contemporary polish, sophisticated romance',
        negative: 'trap, reggaeton, rock guitars, fast electronic music, hard',
        vocalCharacter: 'smooth contemporary vocal, updated classic delivery, elegant modern'
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
    defaultVocalCharacter: 'warm nostalgic vocal, 80s-90s romantic delivery',
    subGenres: {
      grupera_clasica: {
        name: 'Grupera Clásica',
        style: 'classic grupera, 80s-90s grupera, traditional grupera, keyboard grupera',
        tempo: '90-110 BPM, nostalgic',
        instruments: 'keyboards, electric guitar, drums, bass',
        vibe: '80s/90s nostalgia, quinceañera memories, romantic era',
        negative: 'modern trap, aggressive corridos, electronic EDM, rock, harsh',
        vocalCharacter: 'nostalgic warm vocal, 80s-era sincerity, keyboard-accompanied delivery'
      },
      grupera_romantica: {
        name: 'Grupera Romántica',
        style: 'romantic grupera, slow grupera, grupera ballad, dedication grupera',
        tempo: '75-95 BPM, SLOW tender',
        instruments: 'keyboards, soft guitar, strings, gentle drums',
        vibe: 'deep romance, dedication songs, tearful confessions',
        negative: 'fast party music, aggressive sounds, trap, modern urban, hard',
        vocalCharacter: 'deeply romantic vocal, tearful ballad delivery, sentimental 90s style'
      },
      grupera_bailable: {
        name: 'Grupera Bailable',
        style: 'dance grupera, party grupera, uptempo grupera, wedding grupera',
        tempo: '110-130 BPM, FAST dance party',
        instruments: 'keyboards, drums, bass, accordion occasionally',
        vibe: 'wedding reception energy, party classics, dancing couples',
        negative: 'slow ballads, trap, modern electronic, rock guitars, sad',
        vocalCharacter: 'energetic party vocal, dance-friendly delivery, festive 90s energy'
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
    defaultVocalCharacter: 'warm bilingual vocal, Texas border delivery',
    subGenres: {
      tejano_clasico: {
        name: 'Tejano Clásico',
        style: 'classic Tejano, traditional Tex-Mex, conjunto Tejano, Texas accordion',
        tempo: '100-120 BPM, traditional',
        instruments: 'accordion, bajo sexto, drums, bass',
        vibe: 'Texas Mexican pride, conjunto roots, classic border sound',
        negative: 'modern trap, electronic beats, rock guitars, urban, EDM',
        vocalCharacter: 'warm bilingual vocal, Tex-Mex sincerity, border town authenticity'
      },
      tejano_romantico: {
        name: 'Tejano Romántico',
        style: 'romantic Tejano, Tejano ballad, soft Tejano, love song Tejano',
        tempo: '80-100 BPM, emotional, tender',
        instruments: 'keyboards, soft accordion, polished drums, strings',
        vibe: 'crossover romance, radio ballad, sophisticated Tex-Mex',
        negative: 'aggressive sounds, fast party, trap beats, pure rock, harsh',
        vocalCharacter: 'tender emotional vocal, heartfelt ballad delivery, border romance'
      },
      tejano_cumbia: {
        name: 'Tejano Cumbia',
        style: 'Tejano cumbia, Texas cumbia, dance hall Tejano, party Tejano',
        tempo: '100-115 BPM, dance groove',
        instruments: 'keyboards, bass, drums, accordion accents',
        vibe: 'Texas dance hall, cumbia with Tejano polish, party ready',
        negative: 'raw lo-fi, aggressive corridos, trap, pure electronic, dark',
        vocalCharacter: 'bright dance vocal, Texas dance hall energy, cumbia-polka groove delivery'
      }
    }
  },

  // ===========================================================================
  // DURANGUENSE
  // ===========================================================================
  duranguense: {
    baseStyle: 'duranguense, techno-banda from Durango Mexico, electronic polka fusion',
    defaultTempo: '130-150 BPM',
    instruments: 'synthesizer accordion, electronic drums, keyboard bass, tambora',
    negativeTags: 'acoustic only, slow ballad, trap, 808, hip-hop, rock guitar, jazz',
    defaultVocalCharacter: 'bright energetic vocal, electronic-polka delivery',
    subGenres: {
      pasito: {
        name: 'Pasito Duranguense',
        style: 'pasito duranguense, fast electronic polka, techno-banda dance music, Montéz de Durango style, driving synthesizer accordion, electronic dance polka, high energy party duranguense',
        tempo: '140-160 BPM, VERY FAST, HIGH ENERGY, electronic dance tempo, driving polka beat',
        instruments: 'synthesizer accordion lead melody, electronic drum kit with fast polka pattern, keyboard bass synth, tambora electronic, snare rolls, cymbal crashes, electronic fills',
        vibe: 'infectious dance energy, quinceañera party, wedding reception, feet-moving pulse, celebratory adrenaline, crowd-pumping, pasito dance craze',
        negative: 'slow tempo, acoustic instruments, sad ballad, romantic gentle, corridos, trap beats, lo-fi',
        vocalCharacter: 'high energy party vocal, dance-calling delivery, quinceañera MC energy'
      },
      romantico: {
        name: 'Duranguense Romántico',
        style: 'romantic duranguense ballad, slow techno-banda love song, classic romantic duranguense style with synth-keyboard lead, emotional synthesizer ballad, keyboard-driven Mexican ballad',
        tempo: '85-105 BPM, moderate emotional tempo, swaying ballad pace',
        instruments: 'synthesizer accordion with sustained emotional notes, electronic piano, keyboard strings pad, soft electronic drums, bass synth, occasional trumpet accents',
        vibe: 'emotional dedication, slow dance romance, tearful love confession, sentimental, heartfelt, quinceañera vals, prom night',
        negative: 'fast party tempo, aggressive, dark, trap, rock, pasito dance energy, uptempo',
        vocalCharacter: 'emotional tender vocal, synthesizer-ballad delivery, sentimental'
      },
      norteno_duranguense: {
        name: 'Norteño-Duranguense',
        style: 'norteño-duranguense fusion, accordion-forward duranguense with norteño elements, hybrid norteño-duranguense style with techno-banda elements, hybrid techno-norteño, polka rhythm with electronic production',
        tempo: '115-135 BPM, energetic, driving polka groove with electronic backbone',
        instruments: 'diatonic accordion AND synthesizer accordion layered, bajo sexto rhythm guitar, electronic drums with polka pattern, keyboard bass, tambora, snare hits',
        vibe: 'border fusion energy, modern yet traditional, dance floor ready, norteño soul with duranguense power, crossover appeal',
        negative: 'pure acoustic, slow ballad, trap, 808 bass, sad sierreño, rock guitars',
        vocalCharacter: 'energetic crossover vocal, norteño-electronic fusion delivery'
      }
    }
  },

  // ===========================================================================
  // ROMÁNTICA (Cross-genre romantic)
  // ===========================================================================
  romantica: {
    baseStyle: 'romantic Latin ballad, love song, emotional vocal performance, intimate production',
    defaultTempo: '70-95 BPM',
    instruments: 'piano, acoustic guitar, strings, soft percussion',
    negativeTags: 'aggressive, trap, 808, EDM, rock distortion, fast dance, reggaeton dembow',
    defaultVocalCharacter: 'tender emotional vocal, intimate romantic delivery',
    subGenres: {
      romantica_suave: {
        name: 'Romántica Suave y Tierna',
        style: 'soft tender romantic ballad, intimate love song, gentle Latin pop ballad, whispered vocal intimacy, delicate acoustic production, bedroom acoustic feel',
        tempo: '65-80 BPM, SLOW gentle, intimate whisper pace, breathing tempo',
        instruments: 'fingerpicked acoustic guitar, soft piano chords, light string quartet, brushed drums or no drums, subtle bass, occasional celeste or music box',
        vibe: 'intimate tenderness, pillow talk, soft devotion, vulnerability, gentle caress, first dance, whispered love',
        negative: 'loud brass, aggressive drums, fast tempo, EDM, trap, rock, party energy, power vocals',
        vocalCharacter: 'whispered intimate vocal, gentle breath, delicate tender delivery'
      },
      romantica_apasionada: {
        name: 'Romántica Apasionada',
        style: 'passionate dramatic love ballad, power ballad Latin style, building emotional crescendo, dramatic string arrangement, soaring vocal climax',
        tempo: '75-95 BPM, building from slow to powerful, dramatic crescendo pacing',
        instruments: 'grand piano, full string orchestra, electric guitar clean arpeggios building to sustained chords, powerful drum build, bass guitar, choir backing vocals on climax',
        vibe: 'dramatic passion, emotional explosion, theatrical love declaration, goosebumps, tears of joy, wedding ceremony peak moment, overwhelming devotion',
        negative: 'subtle quiet, minimalist, trap, reggaeton, fast dance, lo-fi, casual feel',
        vocalCharacter: 'passionate soaring vocal, dramatic crescendo delivery, powerful building emotion'
      },
      romantica_alegre: {
        name: 'Romántica Alegre y Bailable',
        style: 'upbeat romantic Latin, happy love celebration, danceable romantic pop, feel-good love anthem, romantic cumbia-pop crossover',
        tempo: '100-120 BPM, upbeat, happy groove, danceable romantic energy',
        instruments: 'acoustic guitar strumming, congas, light brass accents, piano, bass guitar groove, shaker percussion, hand claps, tambourine',
        vibe: 'joyful love celebration, dancing with your partner, infectious smile, sunny romance, anniversary party, happy couple energy',
        negative: 'sad ballad, dark tones, slow tempo, heavy production, aggressive, trap, melancholic',
        vocalCharacter: 'joyful bright vocal, happy celebration delivery, infectious love energy'
      },
      romantica_nostalgica: {
        name: 'Romántica Nostálgica',
        style: 'nostalgic romantic ballad, bittersweet love memory, melancholic Latin ballad, remembering love past, wistful emotional vocal, minor key tenderness',
        tempo: '70-85 BPM, slow reflective, wistful pacing, gentle melancholy',
        instruments: 'piano with reverb, acoustic guitar fingerpicking, cello solo, soft strings, minimal percussion, ambient pad, occasional violin melody',
        vibe: 'bittersweet memories, looking at old photos, love that was, gentle heartache, rainy window nostalgia, beautiful sadness, longing',
        negative: 'happy upbeat, party, fast dance, aggressive, brass, loud drums, EDM, modern trap',
        vocalCharacter: 'wistful melancholic vocal, gentle sadness, bittersweet reflective delivery'
      },
      romantica_serenata: {
        name: 'Serenata Romántica',
        style: 'traditional serenata, Mexican serenade style, balcony love song, trio romántico feel, bolero-influenced serenade, classic Latin courtship song',
        tempo: '75-90 BPM, gentle serenade pace, moonlight tempo, traditional flowing rhythm',
        instruments: 'requinto guitar lead melody, rhythm guitar, bass guitar or guitarrón, soft maracas, optional violin duo, occasional soft trumpet',
        vibe: 'moonlit serenade, under the balcony romance, old-fashioned courtship, timeless devotion, classic gentleman, roses and candles, traditional romance',
        negative: 'electronic production, modern pop, trap, drums heavy, fast tempo, aggressive, urban sound',
        vocalCharacter: 'classic serenading vocal, formal courtship delivery, moonlit tenderness'
      }
    }
  },

  // ===========================================================================
  // ROCK EN ESPAÑOL
  // ===========================================================================
  rock_espanol: {
    baseStyle: 'rock en español, Latin rock, Spanish language rock band sound',
    defaultTempo: '100-130 BPM',
    instruments: 'electric guitar, bass guitar, drum kit, keyboards',
    negativeTags: 'regional Mexican, accordion, tuba, mariachi, cumbia, reggaeton dembow, trap 808',
    defaultVocalCharacter: 'powerful rock vocal, raw authentic delivery',
    subGenres: {
      clasico: {
        name: 'Rock en Español Clásico',
        style: 'classic rock en español, 1980s 1990s Latin rock, classic Latin melodic rock style, dark Latin rock with new-wave influence, arena rock Latino, powerful guitar riffs with melodic hooks',
        tempo: '110-130 BPM, driving rock tempo, energetic band groove',
        instruments: 'electric guitar with overdrive riffs and clean arpeggios, bass guitar driving eighth notes, full drum kit with rock beat, keyboards pad, occasional acoustic guitar bridge',
        vibe: 'stadium energy, fist-pumping anthem, 90s nostalgia, rock revolution, passionate defiance, arena singalong, generational anthem',
        negative: 'acoustic only, gentle ballad, electronic dance, regional Mexican, trap, lo-fi bedroom',
        vocalCharacter: 'powerful arena rock vocal, anthemic delivery, fist-pumping energy, raw passion'
      },
      balada_rock: {
        name: 'Balada de Rock',
        style: 'rock power ballad in Spanish, emotional rock ballad, dramatic Spanish rock ballad style, soft verse building to heavy chorus, lighter-waving slow rock anthem',
        tempo: '70-85 BPM verses building to 90-100 BPM chorus, dynamic tempo, soft-loud contrast',
        instruments: 'clean electric guitar arpeggios verse, distorted power chords chorus, piano ballad foundation, bass guitar, drums building from brushes to full kit, string section optional',
        vibe: 'emotional crescendo, vulnerable confession building to powerful declaration, goosebumps, concert lighter moment, dramatic arc, raw vocal emotion',
        negative: 'fast punk, party dance, electronic beats, happy pop, reggaeton, constant heavy distortion',
        vocalCharacter: 'emotional dynamic vocal, soft verse to powerful chorus, dramatic range'
      },
      alternativo: {
        name: 'Rock Alternativo',
        style: 'alternative rock en español, indie rock Latino, atmospheric Latin alt-rock style, experimental Latin rock fusion, dreamy shoegaze-influenced Latin rock, textural guitar layers, atmospheric production',
        tempo: '95-120 BPM, mid-tempo atmospheric, spacious groove, dreamy floating rhythm',
        instruments: 'electric guitar with delay and reverb effects, jangly clean guitars, synthesizer textures, bass guitar melodic lines, drum kit with ride cymbal feel, ambient layers',
        vibe: 'dreamy introspection, artistic depth, atmospheric beauty, indie cinema soundtrack, poetic melancholy, sophisticated cool, underground credibility',
        negative: 'mainstream pop, happy commercial, heavy metal, regional Mexican, accordion, brass, reggaeton',
        vocalCharacter: 'dreamy atmospheric vocal, indie cool delivery, artistic and introspective'
      },
      pop_rock: {
        name: 'Pop Rock Latino',
        style: 'Latin pop rock, radio-friendly rock en español, upbeat Latin pop-rock style with bright guitars, modern Spanish-language pop-rock, catchy melodic hooks with rock energy, polished rock production',
        tempo: '105-125 BPM, upbeat radio tempo, catchy groove, singalong pace',
        instruments: 'electric guitar catchy riffs, acoustic guitar strumming, bass guitar, full drum kit, keyboards and piano, occasional horn accents, handclaps',
        vibe: 'radio hit energy, singalong chorus, feel-good anthem, summer soundtrack, positive energy, youth spirit, commercial appeal with rock credibility',
        negative: 'dark heavy metal, experimental noise, slow ballad only, trap, regional Mexican, lo-fi production',
        vocalCharacter: 'catchy bright vocal, radio-friendly rock delivery, singalong energy'
      },
      romantico: {
        name: 'Rock Romántico',
        style: 'romantic rock en español, soft rock love song, dedicated rock ballad, acoustic-leaning romantic rock, gentle rock for dedication',
        tempo: '80-100 BPM, gentle rock groove, swaying mid-tempo, dedication pace',
        instruments: 'acoustic guitar primary, clean electric guitar accents, soft bass guitar, brushed drums or light kit, piano chords, optional cello',
        vibe: 'heartfelt rock dedication, mature love, wedding rock song, acoustic intimacy with rock backbone, sincere vulnerability, unplugged feeling',
        negative: 'heavy distortion, aggressive punk, fast tempo, electronic dance, trap, brass instruments',
        vocalCharacter: 'tender acoustic vocal, intimate rock delivery, gentle sincerity'
      }
    }
  },

  // ===========================================================================
  // VALS (Waltz)
  // ===========================================================================
  vals: {
    baseStyle: 'vals, waltz, elegant 3/4 time, Latin waltz, quinceañera vals',
    defaultTempo: '90-110 BPM',
    instruments: 'strings, piano, orchestral arrangement',
    negativeTags: 'trap, 808, reggaeton, EDM, rock distortion, aggressive, fast dance',
    defaultVocalCharacter: 'elegant graceful vocal, formal waltz delivery, ceremonial beauty',
    subGenres: {
      vals_mexicano: {
        name: 'Vals Mexicano',
        style: 'traditional Mexican quinceañera waltz, elegant 3/4 time orchestral vals, classic quinceañera ceremony music, formal Mexican waltz with full orchestra, princess moment vals',
        tempo: '90-110 BPM, elegant flowing 3/4 waltz tempo, graceful swaying, one-two-three count',
        instruments: 'full string orchestra with sweeping waltz arrangement, piano arpeggios in 3/4, soft trumpets, harp glissandos, celeste, light timpani, flute melody, classical guitar',
        vibe: 'quinceañera princess moment, formal elegance, coming-of-age ceremony, ballroom beauty, tiara and gown, family pride, tearful father-daughter dance',
        negative: 'fast dance, trap, electronic, rock, aggressive, casual, modern pop, urban',
        vocalCharacter: 'elegant formal vocal, ceremonial grandeur, princess-crowning beauty, graceful delivery'
      },
      vals_romantico: {
        name: 'Vals Romántico',
        style: 'romantic waltz, wedding first dance vals, intimate 3/4 love waltz, elegant couple waltz, tender orchestral romance waltz',
        tempo: '85-105 BPM, slow romantic 3/4 waltz, intimate swaying tempo, breathing room',
        instruments: 'string quartet with legato bowing, piano soft chords, acoustic guitar arpeggios, soft flute, optional harp, minimal percussion, cello solo passages',
        vibe: 'wedding first dance, intimate couple moment, eternal vows, romantic elegance, candlelit ballroom, timeless love, floating together',
        negative: 'fast tempo, party energy, brass heavy, electronic, trap, aggressive, loud',
        vocalCharacter: 'tender intimate vocal, romantic floating delivery, gentle wedding vow sincerity'
      },
      vals_moderno: {
        name: 'Vals Moderno',
        style: 'modern contemporary waltz, updated vals with pop sensibility, cinematic modern waltz, 3/4 time with modern production, young generation vals',
        tempo: '90-110 BPM, modern waltz groove, accessible 3/4 feel, contemporary elegance',
        instruments: 'strings with modern recording clarity, piano, acoustic guitar, subtle modern percussion, synth pad warmth, bass guitar, light electronic textures blended with orchestral',
        vibe: 'modern fairy tale, updated elegance, Instagram-worthy moment, cinematic beauty, contemporary ceremony, accessible yet formal',
        negative: 'heavy electronic, trap beats, reggaeton dembow, aggressive rock, raw lo-fi, fast party',
        vocalCharacter: 'clean modern vocal, cinematic delivery, youthful elegance, accessible beauty'
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
    signatureSound: 'grupera legends, romantic ballads, 80s-90s nostalgia, smooth emotional tenor voice',
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

// Defense-in-depth: strip real-artist names from style/desc strings before
// they're sent to the music provider. Suno (Kie.ai) rejects any request
// whose tags reference a real artist by name. We had multiple genre-DNA
// leaks that caused customer outages on 2026-05-01; this sanitizer ensures
// future leaks (genre data tweaks, accidental mentions) can't reach the API.
//
// Strips canonical names from artistDNA + an extra list of well-known Latin
// artists not in the DB. Intentionally only matches multi-word or 6+ char
// names to avoid false-strips on short common tokens (e.g. "ms", "junior").
const ADDITIONAL_ARTIST_NAMES = [
  // Latin pop / urbano
  'El Recodo', 'Banda El Recodo', 'Sin Bandera', 'Aventura', 'Reik',
  'Luis Miguel', 'Ángela Aguilar', 'Angela Aguilar', 'Prince Royce',
  'Marc Anthony', 'Maluma', 'J Balvin', 'Karol G', 'Daddy Yankee',
  'Don Omar', 'Anuel', 'Ozuna', 'Ricardo Arjona', 'Juan Gabriel',
  'Sebastián Yatra', 'Sebastian Yatra', 'Camilo',
  // Regional Mexicano (corrido / norteño / sierreño / banda / mariachi)
  'Fuerza Regida', 'Eslabón Armado', 'Eslabon Armado', 'Espinoza Paz',
  'Pepe Aguilar', 'Joan Sebastian', 'Joss Favela', 'Yahritza',
  'Edén Muñoz', 'Eden Munoz', 'Ariel Camacho', 'Lupillo Rivera',
  'Jenni Rivera', 'Pedro Fernández', 'Pedro Fernandez',
  'Alejandro Fernández', 'Alejandro Fernandez', 'Pedro Infante',
  'José Alfredo', 'Jose Alfredo', 'José José', 'Jose Jose',
  'Calibre 50', 'Intocable', 'Conjunto Primavera', 'Banda MS', 'BandaMS',
  // Duranguense / techno-banda (today's leak vector)
  'Alacranes Musical', 'K-Paz de la Sierra', 'K-Paz', 'Patrulla 81',
  'Banda Cuisillos', 'Banda Limón', 'Banda Limon', 'Banda Recoditos',
  'Los Recoditos', 'Montez de Durango', 'Horóscopos de Durango',
  'Horoscopos de Durango', 'La Adictiva', 'Pesado', 'Duelo',
  // Vallenato (today's leak vector)
  'Diomedes Díaz', 'Diomedes Diaz', 'Silvestre Dangond', 'Carlos Vives',
  'Jorge Celedón', 'Jorge Celedon', 'Peter Manjarrés', 'Peter Manjarres',
  // Bachata
  'Frank Reyes', 'Antony Santos', 'Anthony Santos', 'Zacarías Ferreira',
  'Zacarias Ferreira',
  // Rock español / Latin pop-rock
  'Enrique Bunbury', 'Bunbury', 'Maná', 'Mana', 'Soda Stereo',
  'Café Tacvba', 'Cafe Tacvba', 'Caifanes', 'Zoé', 'Zoe',
  'Juanes', 'La Oreja de Van Gogh', 'Shakira', 'Ricky Martin',
  'Rocío Dúrcal', 'Rocio Durcal', 'Yuri', 'Thalía', 'Thalia',
  'Belinda',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeArtistNames(input: string): string {
  if (!input) return input;
  let out = input;
  // Strip canonical names from artistDNA
  for (const artist of Object.values(artistDNA)) {
    if (artist.name && artist.name.length >= 6) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(artist.name)}\\b`, 'gi'), '');
    }
  }
  // Strip the additional well-known names list
  for (const name of ADDITIONAL_ARTIST_NAMES) {
    if (name.length >= 6) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), '');
    }
  }
  // Clean up the artifacts of stripping (double commas, "style" left dangling)
  out = out
    .replace(/\s+style\b/gi, ' style')        // normalize spacing around "style"
    .replace(/,\s*style\b/gi, ' style')       // ", style" → " style" (was "X style")
    .replace(/\s*,\s*,/g, ',')                // double commas
    .replace(/\(\s*,/g, '(').replace(/,\s*\)/g, ')')
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .replace(/^\s*,\s*|\s*,\s*$/g, '')        // trim leading/trailing commas
    .trim();
  return out;
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

  // Secondary: Artist sonic signature (if specified) — NO artist names sent to API
  if (artistData) {
    styleParts.push(artistData.signatureSound);
    styleParts.push(artistData.keyElements);
  }

  // Voice type (male or female only — duet not supported by Mureka API)
  const vocalGender = voiceType === 'female' ? 'f' : 'm';

  // Vocal character: gender-neutral delivery style (gender handled by vocal_gender API param)
  const vocalCharacter = subGenreData?.vocalCharacter || genreData.defaultVocalCharacter || '';

  return {
    vocalCharacter,
    stylePrompt: styleParts.join(', ').substring(0, 980),
    // Note: negativeTags are not sent to Mureka (API has no negative prompt field)
    // Kept for documentation/logging purposes only
    negativeTags: [...new Set(negativeParts.join(', ').split(', '))].join(', ').substring(0, 200),
    vocalGender
  };
}

// =============================================================================
// MUSIC PROVIDER HELPERS — primary + automatic failover
// =============================================================================
// Two providers wrapped behind a uniform interface so STEP 6 can try one,
// classify the failure, and (if appropriate) fall back to the other.
//
// Set on Supabase secrets:
//   MUSIC_PROVIDER          = 'kie' | 'mureka'  (primary; default 'mureka')
//   MUSIC_PROVIDER_FALLBACK = 'kie' | 'mureka'  (optional; if unset, no failover)
// =============================================================================

type ProviderName = 'mureka' | 'kie';
type ProviderCanonical = 'mureka-useapi' | 'kie';

type ProviderErrorClass =
  | 'provider_broken'    // upstream down, weird HTTP, state-4 etc → fallback
  | 'credits_depleted'   // 402, 412 balance not enough → fallback + alert
  | 'auth_broken'        // 401, REFRESH_FAILED, missing key → fallback + alert
  | 'rate_limit'         // 429, exceed limit, 9008 too frequently → SAME provider, queued retry
  | 'content_rejection'  // SENSITIVE_WORD_ERROR, content filter → DO NOT fallback (would fail again)
  | 'unknown';           // default → fallback (safer for the customer)

interface ProviderCtx {
  lyrics: string;
  finalStyle: string;
  /** Genre/sub-genre negative tags computed by buildStylePrompt. Sent to Kie
   *  (which has a negativeTags field). Mureka has no negative-prompt API field,
   *  so this is currently unused on the Mureka path. */
  negativeTags?: string;
  vocalGender: 'm' | 'f';
  vocalCharacter?: string;
  isForSelf: boolean;
  recipientName: string;
  supabaseUrl: string;
  /** Genre id (e.g. "corrido", "norteno"). Used to route specific genres
   *  onto V7.6 — V9 has a polka-bias on accordion conjunto that produces
   *  fast party-polka output regardless of prompt. */
  genreId?: string;
  /** Sub-genre id (e.g. "tradicional"). Used together with genreId to
   *  route specific sub-genres onto V7.6. */
  subGenreId?: string;
}

type ProviderResult =
  | { ok: true; provider: ProviderCanonical; taskId: string; payload: Record<string, unknown> }
  | { ok: false; provider: ProviderCanonical; classification: ProviderErrorClass; errorMessage: string; payload?: Record<string, unknown> };

function providerNameToCanonical(name: ProviderName): ProviderCanonical {
  return name === 'kie' ? 'kie' : 'mureka-useapi';
}

async function callMurekaProvider(ctx: ProviderCtx): Promise<ProviderResult> {
  const USEAPI_TOKEN = Deno.env.get('USEAPI_TOKEN');
  const MUREKA_ACCOUNT = Deno.env.get('MUREKA_ACCOUNT');
  const USEAPI_WEBHOOK_SECRET = Deno.env.get('USEAPI_WEBHOOK_SECRET') || '';

  if (!USEAPI_TOKEN || !MUREKA_ACCOUNT) {
    return { ok: false, provider: 'mureka-useapi', classification: 'auth_broken', errorMessage: 'USEAPI_TOKEN or MUREKA_ACCOUNT env var missing' };
  }

  const genderLabel = ctx.vocalGender === 'f'
    ? 'solo female vocalist, single female singer only, NO male voice, NO duet, NO male harmony, NO male backing vocals'
    : 'solo male vocalist, single male singer only, NO female voice, NO duet, NO female harmony, NO female backing vocals';
  const vocalStyle = ctx.vocalCharacter || 'expressive vocal';
  const voicePrefix = `${genderLabel}, ${vocalStyle}`;
  const noVoiceSuffix = ctx.vocalGender === 'f' ? ', absolutely no male vocals no duet' : ', absolutely no female vocals no duet';

  // V7.6 routing for genres where Mureka V9 has a hard polka-bias that
  // produces fast party-polka output regardless of prompt. Currently:
  // - corrido tradicional: V9 returned BPMs ranging 103-214 for the same
  //   prompt because V9's training data has overwhelming "accordion = fast
  //   party polka" coupling. V7.6 is older / more stable / honors slow
  //   tempo cues. Env-overridable via MUREKA_CORRIDO_MODEL.
  // The structural-override path also strips the long negative voice
  // suffix and the verbose genderLabel — those long "NO X" lists can
  // tokenize as their positive form on V7.6 and trigger the very thing
  // we're banning. We trust the vocal_gender API field instead.
  const isCorridoTradicional = ctx.genreId === 'corrido' && ctx.subGenreId === 'tradicional';
  const useStructuralOverride = isCorridoTradicional;
  const CORRIDO_MODEL = Deno.env.get('MUREKA_CORRIDO_MODEL') || 'V7.6';
  const modelToUse = isCorridoTradicional ? CORRIDO_MODEL : MUREKA_MODEL;

  let descWithVoice: string;
  if (useStructuralOverride) {
    const voiceTag = ctx.vocalGender === 'f' ? 'female lead vocal' : 'male lead vocal';
    const styleSnippet = ctx.finalStyle.substring(0, 250).replace(/,?\s*$/, '');
    descWithVoice = `${voiceTag}, single voice storyteller, ${styleSnippet}`;
  } else {
    const maxStyleChars = 1000 - voicePrefix.length - noVoiceSuffix.length - 4;
    descWithVoice = `${voicePrefix}, ${ctx.finalStyle.substring(0, maxStyleChars)}${noVoiceSuffix}`;
  }

  const songTitle = (ctx.isForSelf ? `Mi canción — ${ctx.recipientName}` : `Canción para ${ctx.recipientName}`).substring(0, 50);

  const callbackBase = `${ctx.supabaseUrl}/functions/v1/mureka-useapi-callback`;
  const replyUrl = USEAPI_WEBHOOK_SECRET ? `${callbackBase}?token=${USEAPI_WEBHOOK_SECRET}` : callbackBase;
  const apiVocalGender = ctx.vocalGender === 'f' ? 'female' : 'male';

  // Defense-in-depth: scrub any leaked artist names from the desc before sending.
  const safeDesc = sanitizeArtistNames(descWithVoice).substring(0, 1000);

  const payload: Record<string, unknown> = {
    account: MUREKA_ACCOUNT,
    lyrics: ctx.lyrics.substring(0, 5000),
    title: songTitle,
    desc: safeDesc,
    model: modelToUse,
    vocal_gender: apiVocalGender,
    replyUrl,
  };

  console.log(`[callMureka] POST useapi.net (model=${modelToUse}, gender=${apiVocalGender}, genre=${ctx.genreId}/${ctx.subGenreId})`);

  let resp: Response;
  try {
    resp = await fetch('https://api.useapi.net/v1/mureka/music/create-advanced', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${USEAPI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e: any) {
    return { ok: false, provider: 'mureka-useapi', classification: 'provider_broken', errorMessage: `useapi.net network: ${e.message}`, payload };
  }

  // Try V8 fallback model on model-specific 400s (existing behavior preserved).
  // Use modelToUse here so corrido-tradicional (routed to V7.6) can still
  // fall back to V8 on a model-specific error.
  let cachedErrData: any = null;
  if (!resp.ok && modelToUse !== MUREKA_FALLBACK_MODEL) {
    cachedErrData = await resp.json().catch(() => ({ error: 'Unknown error' }));
    const errStr = JSON.stringify(cachedErrData);
    const isModelError = errStr.includes('model') || errStr.includes('not supported') || errStr.includes('invalid') || resp.status === 400;
    const hasOtherIssue = cachedErrData.code === 'REFRESH_FAILED'
      || errStr.includes('REFRESH_FAILED')
      || errStr.includes('exceed limit')
      || cachedErrData.code === 9008
      || errStr.includes('Too frequently')
      || errStr.includes('Unexpected state')
      || errStr.includes('balance is not enough');
    if (isModelError && !hasOtherIssue) {
      console.warn(`[callMureka] Model ${modelToUse} failed (${resp.status}), retrying with ${MUREKA_FALLBACK_MODEL}`);
      payload.model = MUREKA_FALLBACK_MODEL;
      cachedErrData = null;
      try {
        resp = await fetch('https://api.useapi.net/v1/mureka/music/create-advanced', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${USEAPI_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e: any) {
        return { ok: false, provider: 'mureka-useapi', classification: 'provider_broken', errorMessage: `useapi.net (${MUREKA_FALLBACK_MODEL}) network: ${e.message}`, payload };
      }
    }
  }

  if (!resp.ok) {
    const errData = cachedErrData || await resp.json().catch(() => ({ error: 'Unknown error' }));
    const errStr = JSON.stringify(errData);
    const errStrLower = errStr.toLowerCase();
    let classification: ProviderErrorClass;
    if (resp.status === 412 || errStrLower.includes('balance is not enough')) classification = 'credits_depleted';
    else if (resp.status === 401 || errStrLower.includes('refresh_failed')) classification = 'auth_broken';
    else if (errStrLower.includes('exceed limit') || errData.code === 9008 || errStrLower.includes('too frequently')) classification = 'rate_limit';
    else if (errStrLower.includes('unexpected state')) classification = 'provider_broken';
    else if (resp.status >= 400) classification = 'provider_broken';
    else classification = 'unknown';
    return { ok: false, provider: 'mureka-useapi', classification, errorMessage: `useapi.net ${resp.status}: ${errStr.substring(0, 200)}`, payload };
  }

  const data = await resp.json();
  if (!data.jobid) {
    return { ok: false, provider: 'mureka-useapi', classification: 'provider_broken', errorMessage: `useapi.net no jobid: ${JSON.stringify(data).substring(0, 200)}`, payload };
  }
  return { ok: true, provider: 'mureka-useapi', taskId: data.jobid, payload };
}

// Suno (Kie) is an English-trained model. It expects English structural
// markers in lyrics ([Verse 1], [Chorus], etc.) — NOT Spanish ([Verso 1],
// [Coro], etc.). When Suno encounters a Spanish marker it doesn't recognize,
// it tends to either sing the word literally or blur the section boundary,
// resulting in less clean verse/chorus structure.
//
// We translate ONLY the structural markers; the actual sung lyrics stay 100%
// Spanish (since the site is Spanish-only). [Intro] and [Outro] are identical
// in both languages so they pass through.
function sunoifyLyricsMarkers(lyrics: string): string {
  if (!lyrics) return lyrics;
  return lyrics
    .replace(/\[Verso Final\]/gi, '[Final Verse]')
    .replace(/\[Verso (\d+)\]/gi, '[Verse $1]')
    .replace(/\[Verso\]/gi, '[Verse]')
    .replace(/\[Coro Final\]/gi, '[Final Chorus]')
    .replace(/\[Coro\]/gi, '[Chorus]')
    .replace(/\[Puente\]/gi, '[Bridge]')
    .replace(/\[Hablado\]/gi, '[Spoken Word]');
}

async function callKieProvider(ctx: ProviderCtx): Promise<ProviderResult> {
  const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
  const KIE_MODEL = Deno.env.get('KIE_MODEL') || 'V4_5';

  if (!KIE_API_KEY) {
    return { ok: false, provider: 'kie', classification: 'auth_broken', errorMessage: 'KIE_API_KEY env var missing' };
  }

  // Suno's vocalGender param "can only increase the probability but cannot
  // guarantee adherence" (per Kie docs). We've seen male-requested orders come
  // back with female vocals in production. Two reinforcement tactics:
  //   1. Put the gender label FIRST in the style string (Suno weighs early tags more)
  //   2. Add the OPPOSITE gender to negativeTags — Suno respects negatives strictly
  const genderLabel = ctx.vocalGender === 'f'
    ? 'solo female vocalist, female voice'
    : 'solo male vocalist, male voice, masculine vocal';
  const oppositeGenderTags = ctx.vocalGender === 'f'
    ? 'male voice, male vocal, baritone, bass voice, deep male voice'
    : 'female voice, female vocal, soprano, female harmony, high female voice';

  const vocalStyle = ctx.vocalCharacter || 'expressive vocal';
  // Gender at the START gives it positional priority in Suno's tag parsing.
  const voicePrefix = `${genderLabel}, ${vocalStyle}`;
  const maxStyleChars = 1000 - voicePrefix.length - 4;
  const styleWithVoice = `${voicePrefix}, ${ctx.finalStyle.substring(0, maxStyleChars)}`;
  const title = (ctx.isForSelf ? `Mi canción — ${ctx.recipientName}` : `Canción para ${ctx.recipientName}`).substring(0, 80);

  // Defense-in-depth: Suno (Kie) rejects any request whose tags reference a
  // real artist by name. Strip artist names from style AND lyrics before sending.
  // Also translate Spanish section markers ([Verso 1] → [Verse 1]) so Suno
  // recognizes the song structure.
  const safeStyle = sanitizeArtistNames(styleWithVoice).substring(0, 1000);
  const safeLyrics = sanitizeArtistNames(sunoifyLyricsMarkers(ctx.lyrics)).substring(0, 5000);

  // Combine genre-level negatives (computed by buildStylePrompt) with the
  // opposite-gender exclusion list. Capped at 200 chars per Kie API limits.
  const combinedNegatives = [ctx.negativeTags, oppositeGenderTags]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(', ')
    .substring(0, 200);

  const payload: Record<string, unknown> = {
    prompt: safeLyrics,
    customMode: true,
    instrumental: false,
    model: KIE_MODEL,
    callBackUrl: `${ctx.supabaseUrl}/functions/v1/song-callback`,
    style: safeStyle,
    title,
    vocalGender: ctx.vocalGender,
    negativeTags: combinedNegatives,
    // Bias Suno strongly toward the style description — important for regional
    // Mexican genres where Suno's training is weaker than its pop training.
    styleWeight: 0.85,
    // Reduce experimental drift — keeps corridos sounding like corridos.
    weirdnessConstraint: 0.3,
    // Slightly favor audio features over creative liberties.
    audioWeight: 0.7,
  };

  console.log(`[callKie] POST api.kie.ai (model=${KIE_MODEL}, gender=${ctx.vocalGender}, styleWeight=0.85)`);

  let resp: Response;
  try {
    resp = await fetch('https://api.kie.ai/api/v1/generate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e: any) {
    return { ok: false, provider: 'kie', classification: 'provider_broken', errorMessage: `kie.ai network: ${e.message}`, payload };
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => 'unknown');
    let classification: ProviderErrorClass;
    if (resp.status === 401) classification = 'auth_broken';
    else if (resp.status === 402) classification = 'credits_depleted';
    else if (resp.status === 429) classification = 'rate_limit';
    else if (resp.status >= 400) classification = 'provider_broken';
    else classification = 'unknown';
    return { ok: false, provider: 'kie', classification, errorMessage: `kie.ai ${resp.status}: ${errText.substring(0, 200)}`, payload };
  }

  const data = await resp.json().catch(() => ({}));
  if (data.code !== 200 || !data.data?.taskId) {
    const msgRaw = (data.msg || `code=${data.code}`).toString();
    const msgLower = msgRaw.toLowerCase();
    let classification: ProviderErrorClass;
    if (msgLower.includes('sensitive') || msgLower.includes('content') || msgLower.includes('filter')) classification = 'content_rejection';
    else if (data.code === 401) classification = 'auth_broken';
    else if (data.code === 402) classification = 'credits_depleted';
    else if (data.code === 429) classification = 'rate_limit';
    else classification = 'provider_broken';
    return { ok: false, provider: 'kie', classification, errorMessage: `kie.ai code=${data.code}: ${msgRaw}`.substring(0, 200), payload };
  }

  return { ok: true, provider: 'kie', taskId: data.data.taskId, payload };
}

async function callMusicProvider(name: ProviderName, ctx: ProviderCtx): Promise<ProviderResult> {
  return name === 'kie' ? await callKieProvider(ctx) : await callMurekaProvider(ctx);
}

// Whether a failure on the primary should trigger a fallback to the other provider.
function shouldFallback(classification: ProviderErrorClass): boolean {
  return classification === 'provider_broken'
    || classification === 'credits_depleted'
    || classification === 'auth_broken'
    || classification === 'unknown';
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
      artistInspiration: _ignoredArtistInspiration, occasion, occasionPrompt, customOccasion,
      emotionalTone, recipientName, senderName, relationship,
      relationshipContext, customRelationship, details,
      email, voiceType, sessionId, overridePin,
    } = body;

    // Artist inspiration UX step was removed on 2026-05-01: customers complained
    // songs didn't actually sound like the picked artist, AND it was the vector
    // for Suno content-policy rejections (today's incident with Christian Nodal).
    // Force null here so legacy frontends that still send the field can't trigger
    // any artist-related code paths. The DB column is still set (= null), the
    // findArtist helper is preserved, and the artistDNA database is intact —
    // this is a soft-disable, fully reversible by removing this line.
    const artistInspiration: string | null = null;
    void _ignoredArtistInspiration;

    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    if (!USEAPI_TOKEN || !MUREKA_ACCOUNT) throw new Error('USEAPI_TOKEN and MUREKA_ACCOUNT must be configured');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const currentSessionId = sessionId || crypto.randomUUID();

    // Anti-abuse caps. Three independent rate limits — caller is rejected if
    // ANY of them trips. We layer them because earlier we had a single per-
    // email cap and a determined abuser bypassed it by rotating emails
    // (88 unpaid songs across 9 fake @myyahoo.com addresses, all from the
    // same recipient/sender combo).
    //
    //   1) per email          — 10 unpaid songs in 24h (legacy)
    //   2) per IP             — 12 unpaid songs in 24h (catches email
    //                            rotation; cap slightly higher than #1
    //                            so a household sharing a router doesn't
    //                            hit it before the per-email rule does)
    //   3) per (sender,recipient) combo — 12 unpaid songs in 24h (catches
    //                            email + IP rotation; the same buyer for
    //                            the same recipient is the strongest signal
    //                            of "this is one person spamming")
    //
    // Failed rows are excluded so provider errors don't penalize legit
    // customers. Caps are deliberately generous — a real customer trying
    // a few takes won't trip them; an abuser cycling through emails will.

    const UNPAID_LIMIT_PER_EMAIL_24H = 10;
    // Tightened from 12 → 8 after the Beto incident: 8 unpaid songs per IP
    // per 24h is plenty for a real customer (it's 4 generation attempts —
    // each generation produces 2 sibling rows). Anyone exceeding it from
    // the same IP within a day is virtually always abusing.
    const UNPAID_LIMIT_PER_IP_24H = 8;
    const UNPAID_LIMIT_PER_PAIR_24H = 12;
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Resolve client IP via the same forwarded-headers chain create-checkout
    // already uses. First hop in x-forwarded-for is the original client.
    const xfwd = req.headers.get('x-forwarded-for') || '';
    const clientIp = (xfwd.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || '').trim();

    // Owner override: when ADMIN_OVERRIDE_PIN is set as a project secret AND
    // the request body contains a matching `overridePin`, ALL anti-abuse
    // checks below (hard IP block + 3 unpaid-song rate limits) are skipped.
    // The frontend exposes a PIN input on the rate-limit error screen so the
    // owner can unblock themselves during testing without a deploy. Logging
    // every use lets us audit if the PIN ever leaks.
    const submittedOverridePin = typeof overridePin === 'string' ? overridePin.trim() : '';
    const overrideActive = !!ADMIN_OVERRIDE_PIN
      && submittedOverridePin.length > 0
      && submittedOverridePin === ADMIN_OVERRIDE_PIN;
    if (overrideActive) {
      console.log(`[ADMIN_OVERRIDE] anti-abuse bypassed ip=${clientIp} email=${email} sender=${senderName} recipient=${recipientName}`);
    }

    // Hard IP blocklist — checked BEFORE any rate-limit math. Used for
    // abusers who've demonstrated intent to evade the soft caps (e.g. by
    // typo'ing the recipient name to bypass the per-pair cap). Once an IP
    // is in `blocked_ips`, every request from it is rejected immediately
    // with a 403 — no song row created, no Mureka credits spent.
    if (clientIp && !overrideActive) {
      const { data: blockedRow, error: blockedErr } = await supabase
        .from('blocked_ips')
        .select('ip, reason')
        .eq('ip', clientIp)
        .maybeSingle();
      if (blockedErr) {
        console.warn(`blocked_ips lookup failed for ${clientIp}: ${blockedErr.message} — allowing through`);
      } else if (blockedRow) {
        console.log(`IP_BLOCKED: ${clientIp} reason=${blockedRow.reason}`);
        return new Response(
          JSON.stringify({
            success: false,
            code: 'IP_BLOCKED',
            // Same generic Spanish message as the rate-limit response so
            // the abuser can't tell whether they hit the soft cap or a
            // hard block — and can't infer a workaround from the error.
            error: 'Has generado demasiadas canciones sin completar una compra. Por favor elige una de tus canciones y completa el pago para generar más, o vuelve a intentarlo en 24 horas.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
    }

    // Helper to short-circuit with a 429. Same Spanish error string for
    // every cap so abusers can't tell which limit they tripped.
    const blockedResponse = (reason: string, count: number, cap: number) => {
      console.log(`RATE_LIMIT_UNPAID (${reason}): count=${count} cap=${cap} email=${email} ip=${clientIp} sender=${senderName} recipient=${recipientName}`);
      return new Response(
        JSON.stringify({
          success: false,
          code: 'RATE_LIMIT_UNPAID',
          error: 'Has generado demasiadas canciones sin completar una compra. Por favor elige una de tus canciones y completa el pago para generar más, o vuelve a intentarlo en 24 horas.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    };

    // (1) Per-email cap (legacy behavior)
    if (!overrideActive && email && typeof email === 'string' && email.trim()) {
      const { count: unpaidCount, error: countError } = await supabase
        .from('songs')
        .select('id', { count: 'exact', head: true })
        .ilike('email', email.trim())
        .eq('paid', false)
        .neq('status', 'failed')
        .gte('created_at', windowStart);

      if (countError) {
        console.warn(`per-email quota check failed for ${email}: ${countError.message} — allowing through`);
      } else if ((unpaidCount ?? 0) >= UNPAID_LIMIT_PER_EMAIL_24H) {
        return blockedResponse('per-email', unpaidCount ?? 0, UNPAID_LIMIT_PER_EMAIL_24H);
      }
    }

    // (2) Per-IP cap — defeats email rotation. Only enforced when we have
    // a non-empty client IP; if forwarding headers are missing we skip
    // rather than block legit traffic.
    if (!overrideActive && clientIp) {
      const { count: ipUnpaidCount, error: ipCountError } = await supabase
        .from('songs')
        .select('id', { count: 'exact', head: true })
        .eq('client_ip', clientIp)
        .eq('paid', false)
        .neq('status', 'failed')
        .gte('created_at', windowStart);

      if (ipCountError) {
        console.warn(`per-ip quota check failed for ${clientIp}: ${ipCountError.message} — allowing through`);
      } else if ((ipUnpaidCount ?? 0) >= UNPAID_LIMIT_PER_IP_24H) {
        return blockedResponse('per-ip', ipUnpaidCount ?? 0, UNPAID_LIMIT_PER_IP_24H);
      }
    }

    // (3) Per (sender, recipient) cap — defeats email + IP rotation. The
    // strongest signal of a single abuser is "the same gift for the same
    // person, over and over." Two real customers might share a name, but
    // they won't both have the same buyer name AND the same recipient
    // dozens of times in 24h.
    if (
      !overrideActive &&
      senderName && typeof senderName === 'string' && senderName.trim() &&
      recipientName && typeof recipientName === 'string' && recipientName.trim()
    ) {
      const { count: pairCount, error: pairCountError } = await supabase
        .from('songs')
        .select('id', { count: 'exact', head: true })
        .ilike('sender_name', senderName.trim())
        .ilike('recipient_name', recipientName.trim())
        .eq('paid', false)
        .neq('status', 'failed')
        .gte('created_at', windowStart);

      if (pairCountError) {
        console.warn(`per-pair quota check failed: ${pairCountError.message} — allowing through`);
      } else if ((pairCount ?? 0) >= UNPAID_LIMIT_PER_PAIR_24H) {
        return blockedResponse('per-pair', pairCount ?? 0, UNPAID_LIMIT_PER_PAIR_24H);
      }
    }

    console.log('=== GENERATE SONG (DNA V2) ===');
    console.log('Genre:', genre, subGenre ? `> ${subGenre}` : '');
    console.log('Artist:', artistInspiration || 'None');

    // Build context strings
    const isForSelf = relationship === 'yo_mismo' || occasion === 'para_mi';
    const occasionDesc = occasion === 'para_mi' ? 'canción personal, himno propio'
      : occasion === 'otro' && customOccasion ? customOccasion
      : (occasionPrompt || occasion);
    const relationshipDesc = relationship === 'yo_mismo' ? 'para mí mismo'
      : relationship === 'otro' && customRelationship ? customRelationship
      : (relationshipContext || relationship);
    const voiceDesc = voiceType === 'female' ? 'voz femenina' : 'voz masculina';

    // Relationship-specific emotional guidance
    const relationshipGuide: Record<string, string> = {
      pareja: 'Tono romántico e íntimo. Complicidad de pareja, momentos a solas, amor profundo. Usa "tú y yo", recuerdos de citas, noches juntos, planes de futuro.',
      madre: 'Tono de gratitud y admiración. Sacrificios, recuerdos de infancia, sus manos, su cocina, sus consejos. El amor más incondicional. Hazla llorar de emoción.',
      padre: 'Tono de respeto y orgullo. Su ejemplo, su fuerza, lo que enseñó sin palabras. Momentos padre-hijo/a. Reconocer lo que no siempre se dice en voz alta.',
      hijo: 'Tono de orgullo y protección. Verlos crecer, sus logros, promesas de siempre estar ahí. El amor que cambia la vida. Desde el día que nacieron.',
      hermano: 'Tono de complicidad y lealtad. Travesuras de niños, peleas y reconciliaciones, crecer juntos. "Mi sangre, mi cómplice." Humor y ternura mezclados.',
      abuelo: 'Tono de ternura y nostalgia. Sabiduría, historias del pasado, su casa, sus costumbres. Gratitud por las raíces. El legado que dejan.',
      amigo: 'Tono de lealtad y aventura. Anécdotas compartidas, "en las buenas y en las malas", humor, noches memorables. Celebrar la hermandad elegida.',
      jefe: 'Tono de reconocimiento profesional con calidez. Liderazgo, mentoría, impacto en la carrera. Respeto genuino sin ser formal ni frío.',
    };
    const relationshipContext2 = relationshipGuide[relationship] || '';

    // Occasion-specific songwriting guidance
    const occasionGuide: Record<string, string> = {
      cumpleanos: 'ENERGÍA: Celebración alegre. Mencionar la edad o etapa si se proporcionó. Celebrar quién es la persona HOY, no solo desear felicidad. Incluir logros del año, crecimiento personal. El coro debe sentirse como un brindis.',
      aniversario: 'ENERGÍA: Romántica y reflexiva. Celebrar el viaje juntos — el primer encuentro, obstáculos superados, cómo el amor creció. Números de años juntos si se mencionaron. El coro debe sentirse como una renovación de votos.',
      declaracion: 'ENERGÍA: Apasionada y vulnerable. El momento de confesar lo que se siente. Nervios, valentía, "ya no puedo callar". El coro es la declaración misma — directa, sin rodeos.',
      disculpa: 'ENERGÍA: Vulnerable y sincera. Reconocer el error específico, no genérico. Mostrar que entiende el daño. NO minimizar. El puente es la promesa de cambio. El coro pide perdón sin exigir que lo den.',
      graduacion: 'ENERGÍA: Orgullo y emoción. Celebrar el esfuerzo, las noches de estudio, los sacrificios. Mirar hacia el futuro con esperanza. Si son padres dedicándola, incluir "siempre supe que lo lograrías".',
      quinceanera: 'ENERGÍA: Emotiva y festiva. La transición de niña a mujer. Recuerdos de infancia, orgullo de los padres, el vestido, el vals. Mezcla de nostalgia y celebración.',
      boda: 'ENERGÍA: Solemne y romántica. La promesa de para siempre. El camino al altar, los nervios, "elegirte cada día". El coro debe funcionar como voto matrimonial cantado.',
      madre: 'ENERGÍA: Emotiva y agradecida. Día de las Madres — sus sacrificios, su fuerza, momentos específicos de cuidado. "Gracias" es el sentimiento central. Hacerla sentir vista y valorada.',
      padre: 'ENERGÍA: Respetuosa y emotiva. Día del Padre — su ejemplo silencioso, su trabajo duro, momentos de conexión. Los padres suelen no escuchar estas palabras — esta canción se las dice.',
      amistad: 'ENERGÍA: Alegre y leal. Celebrar la hermandad. Anécdotas específicas, humor compartido, "contigo hasta el fin". Tono de fiesta pero con profundidad emocional.',
      para_mi: 'ENERGÍA: Empoderamiento personal. Himno propio — celebrar logros, resiliencia, identidad. "Este soy yo" sin disculpas. El coro es un mantra de autoafirmación.',
      motivacion: 'ENERGÍA: Inspiradora y poderosa. Superar obstáculos, no rendirse, levantarse después de caer. Reconocer la lucha pero enfocarse en la fuerza. El coro debe ser un grito de guerra — algo que repites cuando necesitas fuerza.',
      otro: 'ENERGÍA: Adaptar el tono a los detalles proporcionados. Leer los detalles personales con atención para captar la emoción correcta — puede ser celebración, gratitud, amor, humor, o nostalgia. Seguir las pistas del usuario.',
    };
    const occasionContext = occasionGuide[occasion] || '';

    // ==========================================================================
    // STEP 1: Build DNA-based style prompt
    // ==========================================================================
    const { stylePrompt, negativeTags, vocalGender, vocalCharacter } = buildStylePrompt(
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

    // Extract genre vibe so Claude can align emotional modifiers with genre character
    const genreDNAData = genreDNA[genre];
    const subGenreDNAData = subGenre && genreDNAData ? genreDNAData.subGenres[subGenre] : null;
    const genreVibe = subGenreDNAData?.vibe || '';

    const nameInstruction = isForSelf
      ? `Menciona "${recipientName}" como protagonista 1-2 veces de forma natural. Tono principal en primera persona: "yo soy", "mi vida", "este soy yo". NO escribir como regalo para otra persona.`
      : `REGLA CRÍTICA DEL NOMBRE: "${recipientName}" DEBE aparecer en las primeras 4 líneas del [Verso 1] — el comprador necesita escuchar el nombre desde el inicio para sentir la personalización. Luego menciona el nombre 2-3 veces más en el coro y/o versos posteriores (4+ menciones totales). NUNCA forzar el nombre donde no fluye rítmicamente — si el nombre es difícil de rimar, úsalo al INICIO de la línea.`;

    const perspectiveInstruction = isForSelf
      ? `Esta canción es PARA UNO MISMO — un himno personal EN PRIMERA PERSONA. El cantante habla de sí mismo, su vida, sus logros, sus sueños.`
      : '';

    const claudePrompt = `Eres un compositor experto de música ${displayGenre} mexicana/latina. Escribes letras que la gente CANTA, no que solo lee.

INFORMACIÓN:
- GÉNERO: ${displayGenre}
${artistInspiration ? `- INSPIRACIÓN: Estilo de ${artistInspiration}` : ''}
${isForSelf ? `- PROTAGONISTA: ${recipientName} (la canción es para sí mismo)` : `- DESTINATARIO: ${recipientName}\n- REMITENTE: ${senderName}`}
- RELACIÓN: ${relationshipDesc}
${relationshipContext2 ? `- GUÍA EMOCIONAL DE LA RELACIÓN: ${relationshipContext2}` : ''}
- OCASIÓN: ${occasionDesc}
${occasionContext ? `- GUÍA DE LA OCASIÓN: ${occasionContext}` : ''}
- VOZ: ${voiceDesc}
${genreVibe ? `- CARÁCTER SONORO DEL GÉNERO: ${genreVibe}` : ''}

DETALLES PERSONALES:
${details || 'No se proporcionaron detalles específicos. Inventa momentos y recuerdos verosímiles basados en la relación y ocasión — hazlo sentir personal aunque no tengas datos reales.'}

REGLAS DE COMPOSICIÓN (OBLIGATORIAS):

1. CORO = LO MÁS IMPORTANTE. El coro DEBE ser pegajoso, corto (4-6 líneas max), y fácil de cantar. Usa repetición intencional. El oyente debe poder cantar el coro después de escucharlo UNA vez. Si el coro no es memorable, la canción falla.

2. CONTRASTE VERSO vs CORO. Los versos CUENTAN la historia (narrativos, específicos, íntimos). El coro EXPLOTA la emoción (universal, repetible, intenso). Que se sientan como secciones DISTINTAS en energía y tono.

3. DETALLES ESPECÍFICOS > FRASES GENÉRICAS.
   PROHIBIDO: "eres la luz de mi vida", "sin ti no puedo vivir", "eres mi todo", "mi corazón late por ti", "eres mi sol y mi luna", "eres el amor de mi vida", "contigo soy feliz".
   EN VEZ usa los detalles personales del usuario para crear imágenes ÚNICAS y concretas. Un recuerdo específico vale más que 10 frases bonitas genéricas.
   REGLA CRÍTICA: Si el usuario mencionó FECHAS, LUGARES, EVENTOS, APODOS, o ANÉCDOTAS en los detalles, DEBES incluir CADA UNO en la letra. Distribúyelos así: Verso 1 = contexto/origen de la historia, Verso 2 = momentos específicos y recuerdos, Puente = lo más íntimo/vulnerable. NO ignores ningún detalle que el usuario proporcionó — es lo que hace ÚNICA esta canción y por lo que PAGARON.

4. ${nameInstruction}

5. CANTABILIDAD. Cada línea: 8-14 sílabas MÁXIMO. Líneas más largas no se cantan bien. Español mexicano COLOQUIAL, no literario ni poético rebuscado. Escribe como se HABLA en México.

6. RIMA. Usa rima consonante o asonante natural. No fuerces rimas artificiales. Esquema por estrofa: ABAB o AABB.

7. PUENTE = GIRO EMOCIONAL. Cambio de perspectiva, confesión íntima, o el momento más vulnerable. NO repetir la misma idea de los versos.

8. NO empezar múltiples versos con la misma palabra. Varía las aperturas de cada línea.

${perspectiveInstruction}

${(() => {
  // Genre-specific spoken word sections — culturally authentic placements
  const spokenWordConfig: Record<string, { condition: boolean; instruction: string; placement: string; sectionDesc: string }> = {
    ranchera_lenta: {
      condition: genre === 'ranchera' && subGenre === 'lenta',
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. Son 2-3 líneas HABLADAS (no cantadas) — una dedicatoria emocional directa a ${recipientName}. Estilo ranchera dramática clásica: íntimo, con pausa dramática, como si le hablaras al oído. Ejemplo: "Escúchame bien, ${recipientName}... esto que siento no cabe en una canción... pero aquí va, con todo mi corazón."`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado]: Dedicatoria hablada (NO cantada). 2-3 líneas íntimas, dramáticas, directas a ${recipientName}.`
    },
    bolero_clasico: {
      condition: genre === 'bolero' && (subGenre === 'bolero_clasico' || subGenre === 'clasico'),
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. Son 2-3 líneas HABLADAS en voz baja, íntima — una confesión romántica susurrada. Estilo trío romántico de los años 50: como si le hablaras al oído en la oscuridad. Ejemplo: "${recipientName}... si supieras lo que siento cada vez que te veo... estas palabras no alcanzan, pero mi corazón no se calla."`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado]: Confesión susurrada (NO cantada). 2-3 líneas íntimas, románticas, en voz baja.`
    },
    corrido_tradicional: {
      condition: genre === 'corrido' && subGenre === 'tradicional',
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] como PRIMERA sección, ANTES del [Verso 1]. Son 2-3 líneas HABLADAS — el narrador presenta la historia al estilo corrido clásico. Ejemplo: "Señores, les voy a contar la historia de ${recipientName}... pongan atención, que esta es de las buenas."`,
      placement: 'intro',
      sectionDesc: `- [Hablado]: Narrador presenta la historia (NO cantado). 2-3 líneas al estilo "Señores, les voy a contar..."`
    },
    cumbia_sonidera: {
      condition: genre === 'cumbia' && subGenre === 'sonidera',
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] como PRIMERA sección, ANTES del [Verso 1]. Son 2-3 líneas HABLADAS al estilo MC sonidero — saludos y dedicatorias con energía de fiesta. Ejemplo: "¡Wepa! ¡Este saludo va dedicado para ${recipientName}! ¡Que se prenda la fiesta! ¡Desde el barrio con todo el corazón!"`,
      placement: 'intro',
      sectionDesc: `- [Hablado]: Saludo de sonidero MC (NO cantado). 2-3 líneas con energía de fiesta, saludos, "¡Wepa!"`
    },
    balada_clasica: {
      condition: genre === 'balada' && (subGenre === 'balada_clasica' || subGenre === 'clasica'),
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. Son 2-3 líneas HABLADAS en tono vulnerable — un momento íntimo donde el cantante baja la guardia y confiesa algo que no pudo cantar. Ejemplo: "${recipientName}... sé que las palabras nunca son suficientes... pero necesitaba que supieras esto..."`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado]: Confesión vulnerable (NO cantada). 2-3 líneas en tono íntimo, bajando la guardia.`
    },
    banda_romantica: {
      condition: genre === 'banda' && (subGenre === 'romantica' || subGenre === 'romantico'),
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. Son 2-3 líneas HABLADAS — una dedicatoria dramática con la banda de fondo suave. Estilo banda romántica dramática clásica. Ejemplo: "Esto va para ti, ${recipientName}... porque no hay canción que alcance para decirte lo que significas..."`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado]: Dedicatoria dramática (NO cantada). 2-3 líneas emotivas con banda suave de fondo.`
    },
    norteno_romantico: {
      condition: genre === 'norteno' && (subGenre === 'romantico' || subGenre === 'romantica'),
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. Son 2-3 líneas HABLADAS — una dedicatoria sincera y directa, con el acordeón suave de fondo. Estilo norteño de corazón. Ejemplo: "Con el corazón en la mano, ${recipientName}... esta canción la escribí pensando en ti... va con todo lo que soy."`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado]: Dedicatoria sincera (NO cantada). 2-3 líneas directas, de corazón.`
    }
  };

  const active = Object.values(spokenWordConfig).find(c => c.condition);
  if (!active) return '';
  return active.instruction + '\n';
})()}FUNCIÓN DE CADA SECCIÓN:
${(() => {
  const isCorridoTrad = genre === 'corrido' && subGenre === 'tradicional';
  const isCumbiaSonidera = genre === 'cumbia' && subGenre === 'sonidera';
  const isIntroSpoken = isCorridoTrad || isCumbiaSonidera;

  const spokenConfigs: Record<string, { condition: boolean; sectionDesc: string }> = {
    ranchera_lenta: { condition: genre === 'ranchera' && subGenre === 'lenta', sectionDesc: `- [Hablado]: Dedicatoria hablada (NO cantada). 2-3 líneas íntimas, dramáticas, directas a ${recipientName}.` },
    bolero_clasico: { condition: genre === 'bolero' && (subGenre === 'bolero_clasico' || subGenre === 'clasico'), sectionDesc: '- [Hablado]: Confesión susurrada (NO cantada). 2-3 líneas íntimas, románticas.' },
    balada_clasica: { condition: genre === 'balada' && (subGenre === 'balada_clasica' || subGenre === 'clasica'), sectionDesc: '- [Hablado]: Confesión vulnerable (NO cantada). 2-3 líneas íntimas.' },
    banda_romantica: { condition: genre === 'banda' && (subGenre === 'romantica' || subGenre === 'romantico'), sectionDesc: '- [Hablado]: Dedicatoria dramática (NO cantada). 2-3 líneas emotivas.' },
    norteno_romantico: { condition: genre === 'norteno' && (subGenre === 'romantico' || subGenre === 'romantica'), sectionDesc: '- [Hablado]: Dedicatoria sincera (NO cantada). 2-3 líneas directas.' },
    corrido_trad: { condition: isCorridoTrad, sectionDesc: '- [Hablado]: Narrador presenta la historia (NO cantado). 2-3 líneas.' },
    cumbia_sonidera: { condition: isCumbiaSonidera, sectionDesc: '- [Hablado]: Saludo de sonidero MC (NO cantado). 2-3 líneas con energía.' },
  };

  const active = Object.values(spokenConfigs).find(c => c.condition);
  const habladoLine = active?.sectionDesc || '';

  if (isIntroSpoken && habladoLine) {
    // Corrido trad & Cumbia sonidera: [Hablado] IS the intro, just add [Outro]
    return `${habladoLine}
- [Verso 1]: Presenta la historia. Contexto, escena, quién eres y qué sientes.
- [Coro]: GANCHO emocional. Corto, memorable, repetible. Lo que el oyente tararea.
- [Verso 2]: Profundiza con detalles específicos. Momentos concretos, recuerdos.
- [Coro]: Repetición del coro (misma letra).
- [Puente]: Giro emocional. Lo más vulnerable o intenso de toda la canción.
- [Coro Final]: Cierre con impacto. Puede tener una variación sutil.
- [Outro]: Cierre instrumental. NO escribir letra — solo poner "[Outro]" para que Mureka añada un cierre musical.`;
  }

  if (habladoLine) {
    // Genres with spoken dedication before final chorus
    return `- [Intro]: Apertura instrumental. NO escribir letra — solo poner "[Intro]" para que Mureka cree una entrada musical.
- [Verso 1]: Presenta la historia. Contexto, escena, quién eres y qué sientes.
- [Coro]: GANCHO emocional. Corto, memorable, repetible. Lo que el oyente tararea.
- [Verso 2]: Profundiza con detalles específicos. Momentos concretos, recuerdos.
- [Coro]: Repetición del coro (misma letra).
- [Puente]: Giro emocional. Lo más vulnerable o intenso de toda la canción.
${habladoLine}
- [Coro Final]: Cierre con impacto. Puede tener una variación sutil.
- [Outro]: Cierre instrumental. NO escribir letra — solo poner "[Outro]" para que Mureka añada un cierre musical.`;
  }

  // All other genres: standard structure with Intro and Outro
  return `- [Intro]: Apertura instrumental. NO escribir letra — solo poner "[Intro]" para que Mureka cree una entrada musical.
- [Verso 1]: Presenta la historia. Contexto, escena, quién eres y qué sientes.
- [Coro]: GANCHO emocional. Corto, memorable, repetible. Lo que el oyente tararea.
- [Verso 2]: Profundiza con detalles específicos. Momentos concretos, recuerdos.
- [Coro]: Repetición del coro (misma letra).
- [Puente]: Giro emocional. Lo más vulnerable o intenso de toda la canción.
- [Coro Final]: Cierre con impacto. Puede tener una variación sutil.
- [Outro]: Cierre instrumental. NO escribir letra — solo poner "[Outro]" para que Mureka añada un cierre musical.`;
})()}

GENERA JSON con:
1. "lyrics": Letra completa siguiendo las reglas anteriores.
2. "emotionalModifiers": Máximo 25 palabras en INGLÉS describiendo la emoción/atmósfera única (NO género/instrumentos/tempo)

REGLA ABSOLUTA — NOMBRES DE ARTISTAS:
NUNCA escribas el nombre de un artista, banda, cantante o grupo musical real (ni en las letras, ni en emotionalModifiers, ni en ningún otro campo). Esto incluye nombres como "Christian Nodal", "Vicente Fernández", "Alacranes Musical", "Banda MS", "Carin León", "Peso Pluma", "K-Paz", "Diomedes Díaz", etc. — si pensaste mencionar un artista para describir el estilo, REEMPLÁZALO por una descripción del SONIDO ("modern romantic ranchera style", "techno-banda style") sin mencionar al artista. El proveedor de música RECHAZA cualquier referencia a artistas reales y la canción FALLA.

REGLA CRÍTICA para emotionalModifiers:
Los modifiers DEBEN ser compatibles con el carácter sonoro del género. Expresa la emoción A TRAVÉS del lente del género, nunca en contra.
- Género agresivo/oscuro (bélico, trap, alterados): emociones con fuerza — "fierce unbreakable loyalty, defiant pride, raw respect" NO "warm heartfelt tender"
- Género melancólico (sad sierreño, bolero): emociones con peso — "aching longing, bittersweet devotion, haunting memory"
- Género festivo/bailable (cumbia, quebradita): emociones con energía — "euphoric celebration, infectious joy, vibrant tribute"
- Género romántico/suave: calidez — "tender intimacy, warm embrace, gentle devotion"

RESPONDE SOLO JSON:
{"lyrics": "[Verso 1]\\n...", "emotionalModifiers": "..."}`;

    console.log('Calling Claude...');

    // claude-sonnet-4-6 = Sonnet 4.6 (current production Sonnet, replaced
    // claude-sonnet-4-20250514 which is being retired by Anthropic on 2026-06-15;
    // soft throttling begins 2026-05-14). Haiku 4.5 fallback is still current.
    const claudeModels = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
    const claudeHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    };
    const maxRetries = 3;

    let claudeResponse: Response | null = null;
    let claudeData: any = null;
    let modelUsedForLyrics = claudeModels[0];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // After all Sonnet retries fail, fall back to Haiku on last attempt
      const model = attempt === maxRetries ? claudeModels[1] : claudeModels[0];

      claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: claudeHeaders,
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          messages: [{ role: 'user', content: claudePrompt }]
        }),
      });

      claudeData = await claudeResponse.json();

      if (claudeResponse.ok && claudeData.content?.[0]?.text) {
        modelUsedForLyrics = model;
        if (attempt > 1) console.log(`Claude succeeded on attempt ${attempt} with ${model}`);
        break;
      }

      const isOverloaded = claudeData?.error?.type === 'overloaded_error' || claudeResponse.status === 529;
      if (isOverloaded && attempt < maxRetries) {
        const delay = attempt * 5000; // 5s, 10s
        console.warn(`Claude overloaded (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (attempt === maxRetries) {
        throw new Error('Claude API failed after retries: ' + JSON.stringify(claudeData));
      }
    }

    console.log(`Lyrics generated with ${modelUsedForLyrics}`);

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
    // Keep generous limit — final truncation happens in desc construction below
    finalStyle = finalStyle.substring(0, 1000);

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
      tejano: 'Texas star, accordion, border aesthetic',
      duranguense: 'Synthesizer keyboard, Durango desert, electronic polka lights, dance floor',
      romantica: 'Red roses, candlelight, moonlit couple silhouette, romantic sunset',
      rock_espanol: 'Electric guitar silhouette, concert stage lights, Latin rock energy',
      vals: 'Elegant ballroom, chandelier, quinceañera tiara silhouette, golden waltz'
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
      style_used: finalStyle,
      // Anti-abuse: stamp the client IP so the per-IP rate limit on the
      // next request can find this row. NULL is fine when the forwarding
      // headers aren't present (e.g. local dev).
      client_ip: clientIp || null
    }).select().single();

    if (dbError) throw new Error('DB error: ' + dbError.message);
    
    const songId = songRecord.id;
    console.log('Song saved:', songId);

    // ==========================================================================
    // STEP 6: Call music provider with automatic failover
    // Primary set via MUSIC_PROVIDER env. Optional fallback via MUSIC_PROVIDER_FALLBACK.
    // If primary fails with a class that suggests it's broken (provider_broken,
    // credits_depleted, auth_broken, unknown), try the fallback in the same request.
    // Customer never sees the failure — they get 'processing' as if nothing happened.
    // ==========================================================================
    const MUSIC_PROVIDER_PRIMARY = ((Deno.env.get('MUSIC_PROVIDER') || 'mureka').toLowerCase()) as ProviderName;
    const _fallbackRaw = (Deno.env.get('MUSIC_PROVIDER_FALLBACK') || '').toLowerCase();
    const MUSIC_PROVIDER_FALLBACK: ProviderName | null =
      (_fallbackRaw === 'kie' || _fallbackRaw === 'mureka') && _fallbackRaw !== MUSIC_PROVIDER_PRIMARY
        ? (_fallbackRaw as ProviderName)
        : null;

    const providerCtx: ProviderCtx = {
      lyrics,
      finalStyle,
      negativeTags,
      vocalGender: (vocalGender === 'f' ? 'f' : 'm'),
      vocalCharacter,
      isForSelf,
      recipientName,
      supabaseUrl: SUPABASE_URL!,
      genreId: genre,
      subGenreId: subGenre || undefined,
    };

    console.log(`[STEP 6] primary=${MUSIC_PROVIDER_PRIMARY} fallback=${MUSIC_PROVIDER_FALLBACK ?? 'NONE'}`);

    let result = await callMusicProvider(MUSIC_PROVIDER_PRIMARY, providerCtx);
    let usedFallback = false;

    if (!result.ok) {
      console.warn(`[STEP 6] Primary ${MUSIC_PROVIDER_PRIMARY} failed (${result.classification}): ${result.errorMessage}`);

      // Rate limit on primary → queue for in-place retry by the existing retry-queued-songs cron.
      // Don't fall over to the other provider for a transient throttle.
      if (result.classification === 'rate_limit') {
        const v1Update: any = {
          status: 'queued_retry',
          error_message: result.errorMessage.substring(0, 200),
          provider: providerNameToCanonical(MUSIC_PROVIDER_PRIMARY),
        };
        if (result.payload) {
          if (MUSIC_PROVIDER_PRIMARY === 'mureka') v1Update.mureka_payload = JSON.stringify(result.payload);
          else v1Update.kie_payload = JSON.stringify(result.payload);
        }
        await supabase.from('songs').update(v1Update).eq('id', songId);
        console.log(`Song ${songId} queued for retry — ${MUSIC_PROVIDER_PRIMARY} rate limited`);
        return new Response(JSON.stringify({
          success: true,
          song: { id: songId, status: 'queued_retry', imageUrl },
          sessionId: currentSessionId,
          queued: true,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
      }

      // Try fallback if (a) one is configured and (b) the failure class warrants it.
      const primaryError = result.errorMessage;
      const primaryClass = result.classification;
      const primaryPayload = result.payload;

      if (MUSIC_PROVIDER_FALLBACK && shouldFallback(primaryClass)) {
        console.warn(`[STEP 6] Falling back to ${MUSIC_PROVIDER_FALLBACK} (primary ${MUSIC_PROVIDER_PRIMARY} failure class: ${primaryClass})`);
        result = await callMusicProvider(MUSIC_PROVIDER_FALLBACK, providerCtx);
        usedFallback = true;
        if (!result.ok) {
          console.error(`[STEP 6] BOTH providers failed. primary=${MUSIC_PROVIDER_PRIMARY}(${primaryClass}): ${primaryError} | fallback=${MUSIC_PROVIDER_FALLBACK}(${result.classification}): ${result.errorMessage}`);
          const combinedMsg = `Both providers failed. ${MUSIC_PROVIDER_PRIMARY}: ${primaryError} | ${MUSIC_PROVIDER_FALLBACK}: ${result.errorMessage}`;
          const failedUpdate: any = {
            status: 'failed',
            error_message: combinedMsg.substring(0, 500),
            provider: providerNameToCanonical(MUSIC_PROVIDER_FALLBACK),
          };
          if (primaryPayload) {
            if (MUSIC_PROVIDER_PRIMARY === 'mureka') failedUpdate.mureka_payload = JSON.stringify(primaryPayload);
            else failedUpdate.kie_payload = JSON.stringify(primaryPayload);
          }
          if (result.payload) {
            if (MUSIC_PROVIDER_FALLBACK === 'mureka') failedUpdate.mureka_payload = JSON.stringify(result.payload);
            else failedUpdate.kie_payload = JSON.stringify(result.payload);
          }
          await supabase.from('songs').update(failedUpdate).eq('id', songId);
          throw new Error(combinedMsg);
        }
      } else {
        // No fallback configured, OR failure class says don't fall back (e.g. content_rejection)
        const reason = !MUSIC_PROVIDER_FALLBACK ? 'no MUSIC_PROVIDER_FALLBACK configured' : `class=${primaryClass} not eligible for failover`;
        console.error(`[STEP 6] Marking failed — ${reason}`);
        const failedUpdate: any = {
          status: 'failed',
          error_message: primaryError.substring(0, 500),
          provider: providerNameToCanonical(MUSIC_PROVIDER_PRIMARY),
        };
        if (primaryPayload) {
          if (MUSIC_PROVIDER_PRIMARY === 'mureka') failedUpdate.mureka_payload = JSON.stringify(primaryPayload);
          else failedUpdate.kie_payload = JSON.stringify(primaryPayload);
        }
        await supabase.from('songs').update(failedUpdate).eq('id', songId);
        throw new Error(`${MUSIC_PROVIDER_PRIMARY} ${primaryClass}: ${primaryError}`);
      }
    }

    // SUCCESS — `result` is the winning provider (primary or fallback)
    const winningProvider = result.provider; // 'mureka-useapi' | 'kie'
    const taskId = result.taskId;
    const winningPayload = result.payload;
    console.log(`[STEP 6] ✓ ${winningProvider} taskId=${taskId}${usedFallback ? ' (via fallback)' : ''}`);

    // Update v1 row with provider-specific fields
    const v1Update: any = {
      task_id: taskId,
      provider: winningProvider,
      error_message: null,
    };
    if (winningProvider === 'mureka-useapi') {
      v1Update.mureka_job_id = taskId;
      v1Update.mureka_payload = JSON.stringify(winningPayload);
    } else {
      v1Update.kie_task_id = taskId;
      v1Update.kie_payload = JSON.stringify(winningPayload);
    }
    await supabase.from('songs').update(v1Update).eq('id', songId);

    // Insert v2 sibling so the callback can fan out to both rows by task id.
    // Both providers return 2 tracks per job.
    const v2Base: any = {
      session_id: currentSessionId,
      version: 2,
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
      style_used: finalStyle,
      task_id: taskId,
      provider: winningProvider,
      // Same anti-abuse stamp as the v1 insert.
      client_ip: clientIp || null,
    };
    if (winningProvider === 'mureka-useapi') {
      v2Base.mureka_job_id = taskId;
      v2Base.mureka_payload = JSON.stringify(winningPayload);
    } else {
      v2Base.kie_task_id = taskId;
      v2Base.kie_payload = JSON.stringify(winningPayload);
    }

    const { data: song2Record, error: song2Err } = await supabase.from('songs').insert(v2Base).select().single();
    const song2Id = song2Record?.id || null;
    if (song2Err) console.error('Failed to insert Song 2 row:', song2Err.message);
    else console.log(`Song 2 (version 2, ${winningProvider}) saved:`, song2Id);

    return new Response(JSON.stringify({
      success: true,
      song: { id: songId, status: 'processing', imageUrl, song2PendingId: song2Id },
      sessionId: currentSessionId,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
