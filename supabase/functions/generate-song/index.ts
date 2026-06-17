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
        style: 'authentic 1990s Sinaloa corrido, pure Sinaloense rural rancho corrido, pre-2000s era corrido ONLY (strictly before corridos tumbados, before the 2010s narcocorrido evolution), classic Sinaloa-style conjunto corrido of the Chalino era, traditional Mexican corrido from the Sierra de Sinaloa with Culiacán and Mazatlán cantina roots, narrative balladeer storytelling corrido, accordion-and-bajo-sexto with slapped tololoche upright bass driving the oom-pah, cassette-tape direct-to-tape recording aesthetic, raw cantina corrido from rural Sinaloa palenques, four-line stanza cuarteta narrative, traditional Mexican corridista narrating real events with grave authority, deeply rooted Sinaloense rancho music, pure 1990s rural Mexican Sinaloa sound, live-band single-room performance recording feel',
        tempo: '85-105 BPM, deliberate mid-tempo storytelling pace, mostly 2/4 polka corrido pulse with prominent oom-pah feel from the tololoche slap, occasional 3/4 corrido waltz feel, narrator-paced groove that leaves generous room for every lyric word, NEVER rushed NEVER danceable, steady balladeer storytelling tempo above all',
        instruments: 'diatonic three-row button accordion as the SOLE melodic lead with TREBLY MIDRANGE-FORWARD reedy timbre (not bass-heavy modern accordion), every melody fill and short solo break on accordion with grace notes bellows shakes and scalar runs into cadences, bajo sexto twelve-string with percussive downstroke strums outlining roots and fifths, TOLOLOCHE acoustic upright bass with prominent SLAP technique driving the entire oom-pah pattern (this slapped tololoche is the CENTRAL Sinaloa signature), optional requinto sierreño nylon guitar for short ornamental runs between verses in the Sinaloa rancho style, sparse minimal kick drum or no drums at all, NO brass NO saxophone NO trap NO electronic NO modern drum kit',
        vibe: 'rural Sinaloa rancho authenticity of the 1990s, Culiacán-Mazatlán cantina at midnight, Sierra de Sinaloa palenque atmosphere, cassette-tape direct-to-tape lo-fi recording quality, live-band single-room performance feel (the whole band playing together in one room — NOT modern multitrack overdubs), grave declamatory corridista narrator delivery, weathered Sinaloense balladeer, working-class Sinaloense pride, BONE-DRY VINTAGE MIX with no reverb wash, no vocal doubling, no stereo widening, no compression pumping, dry natural microphone placement, mono or narrow stereo image, present accordion midrange and audible slapped tololoche thump, raw unpolished 90s production, every word audible, reportorial storytelling weight, Chalino-era rancho feel WITHOUT naming any artist',
        negative: 'modern 2010s 2020s corrido production, slick radio polish, full drum kit polka beat, snare-heavy modern drum kit, electric bass guitar, saxophone, alto sax, tenor sax, sax solo, sax fills, brass section, trumpets, trombones, full banda brass, mariachi violins, strings, orchestral pads, trap beats, trap hi-hats, 808 bass, sub-bass, auto-tune, heavy reverb wash, lush stereo reverb, vocal doubling, vocal stacking, stereo widening, modern multitrack overdubs, click track production, compression pumping, modern radio EQ, Melodyne, pitch correction, corridos tumbados, corridos alterados, corrido bélico, sad sierreño melancholy, romantic softness, synthesizers, electronic drums, programmed drums, cumbia rhythm, rapid party tempo, breakneck dance speed, EDM, pop production, K-pop, hip-hop, bass-heavy modern accordion mix',
        vocalCharacter: 'declamatory male corridista narrator vocal in the classic 1990s Sinaloa style, grave storytelling authority with strong consonants and clear diction, raw cracked emotional delivery in the rural Sinaloense lloradito tradition (slightly broken voice on emotional peaks), weathered cantina balladeer tone, unpolished cassette-era recording quality, no modern studio gloss, no auto-tune, no vocal correction, no vocal doubling or stacking, single dry vocal track'
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
        style: 'corrido bélico, modern movimiento alterado corrido, sierreño-based street corrido, requinto-driven acoustic regional Mexican, minor-key narrative bélico',
        tempo: '95-120 BPM, 2/4 polka-derived groove, snare pops on backbeat, off-beat guitar chucks',
        instruments: 'requinto 12-string acoustic guitar lead with rapid ornamental runs tremolos and parallel thirds, segunda 6-string rhythm guitar with rasgueado strumming, tololoche upright bass or electric bass, optional tuba for low end, snare-driven percussion with 2/4 rimshot accents',
        vibe: 'dark intense minor-key mood, modern studio polish on acoustic sierreño backbone, taut forward momentum, street-informed bélico bravado',
        negative: 'banda brass section, trumpets, trombones, clarinets, charcheta, tarola tambora banda kit, full mariachi, mariachi violins, accordion, norteño accordion polka, romantic softness, slow ballad, quebradita dance pace, EDM, dubstep',
        vocalCharacter: 'tight speech-like cadences, gritty gravelly mid-range timbre, short declarative narrative lines, crew shouts and ad-libs on hooks, gritos'
      },
      alterados: {
        name: 'Corridos Alterados',
        style: 'corridos alterados, movimiento alterado, norteño-sierreño instrumentation, Sinaloa narcocorrido sound, late 2000s early 2010s era, military jargon aesthetic, El Komander style, Los Buchones de Culiacan style',
        tempo: 'polka-like two-step feel 115-135 BPM, propulsive NOT breakneck tempo',
        instruments: 'diatonic button accordion as melodic lead with rapid polka ornamental runs, 12-string requinto guitar percussive downstroke rhythm, sousaphone tuba driving quarter-note oom-pah bass pulse, tarola snare backbeat, blasting brass section with tight trumpet and trombone unison riffs, breakneck brass fills between verses',
        vibe: 'loud saturated brass and percussion production, bright functional I-IV-V major key harmony with menacing aggressive lyrics, hyper-violent adrenaline-charged storytelling',
        negative: 'sierreño-only acoustic intimacy, trap beats, 808 bass, half-time feel, modern 2020s corridos tumbados, modern corrido bélico minor key, slow ballads, romantic softness, electronic production, minor-key brooding',
        vocalCharacter: 'swaggering confident delivery with gritos and ad-libs, first-person narrative storytelling, aggressive bravado tone'
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
      con_sax_romantico: {
        name: 'Norteño con Sax — Romántico',
        style: 'romantic norteño with saxophone lead, norteño-sax ballad fusion, alto saxophone carrying main melody over accordion harmony, smooth saxophone-forward northern Mexican, polished norteño-sax love song',
        tempo: '100-120 BPM, smooth swaying energy, romantic dance groove',
        instruments: 'alto saxophone melodic lead with vibrato, diatonic accordion harmony and fills, bajo sexto rhythm guitar, electric bass, drums with norteño polka pattern, occasional trumpet accents',
        vibe: 'romantic yet energetic, classy wedding party, elegant saxophone serenading, sophisticated norteño, couples dancing close',
        negative: 'heavy metal guitars, EDM drops, aggressive trap, rock sounds, harsh distortion, raw lo-fi, fast quebradita, rushed cumbia',
        vocalCharacter: 'smooth romantic vocal, elegant delivery, polished and warm'
      },
      con_sax_bailar: {
        name: 'Norteño con Sax — Para Bailar',
        // No "cumbia", "sing-along", "group harmonies", "duo" tokens — they
        // trigger Mureka V9's polka-cumbia / vocal-group bias (see
        // project_mureka_v9_norteno_bias memory). Saturate first ~250 chars
        // with norteño-sax conjunto anchors only.
        style: 'classic Tex-Mex norteño con saxofón, conjunto norteño with prominent alto sax lead, polka norteña with saxophone hooks, El Paso–Juárez border norteño-sax conjunto, traditional sax-driven norteño polka, sax-forward conjunto norteño, regional Mexican conjunto with alto saxophone',
        tempo: '105-125 BPM, two-step polka norteña 2/4 time, traditional conjunto polka feel, classic norteño polka tempo, moderate polka pace',
        instruments: 'punchy alto saxophone playing melodic hooks and fills between accordion lines, diatonic button accordion lead, bajo sexto twelve-string with percussive downstrokes, electric bass walking polka bass lines, polka norteña drum pattern with 2/4 backbeat, traditional conjunto rhythm section',
        vibe: 'cantina norteño polka, traditional border-town conjunto dance, working-class polka norteña party, accordion-and-sax call and response, palenque feria norteño polka, conjunto polka norteña celebration',
        negative: 'cumbia, cumbia norteña, sonidera, güiro, synth cumbia, dance hall electronic, fast quebradita, slow ballad, classy wedding crooner, smooth romantic crooning, jazz fusion, EDM, trap, 808, heavy metal, banda brass section, modern pop production',
        vocalCharacter: 'earnest male norteño tenor lead vocal, slightly nasal cantina warmth, conjunto polka norteña delivery, blue-collar polka norteño charm'
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
        instruments: 'violin section playing melodic passages in unison and harmony, two-trumpet section with fanfare intros and sustained notes, vihuela percussive strumming providing harmonic rhythm, guitarrón deep bass on beats one and three, classical guitar arpeggios, optional harp',
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
        instruments: 'grand piano chords and arpeggios, string orchestra arrangement, acoustic guitar fingerpicking, soft brushed drums, bass guitar, subtle synth pad warmth, lush string swell on chorus',
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
        instruments: 'full string orchestra with sweeping arrangements, grand piano, soft timpani, harp arpeggios, french horn warmth, flute melody, brushed drums, orchestral crescendo builds, lush string swell on final chorus',
        vibe: 'grand romantic gestures, theatrical tearjerker emotion, telenovela climax moment, standing ovation performance, goosebumps crescendo, classic Latin drama',
        negative: 'fast rhythms, electronic beats, rock, trap, party music, uptempo, modern urban, lo-fi',
        vocalCharacter: 'dramatic theatrical vocal, orchestral-matching power, grand emotional belting'
      },
      balada_pop: {
        name: 'Balada Pop',
        style: 'contemporary Latin pop ballad, modern radio ballad en español, clean modern emotional slow song, polished studio production ballad, accessible contemporary love ballad',
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
        instruments: 'grand piano, full string orchestra, electric guitar clean arpeggios building to sustained chords, powerful drum build, bass guitar, orchestral brass and string swell on climax',
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
        instruments: 'requinto guitar lead melody, rhythm guitar, bass guitar or guitarrón, soft maracas, optional second violin, occasional soft trumpet',
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
  },

  // ===========================================================================
  // MÚSICA CRISTIANA (Christian Praise & Worship)
  // ===========================================================================
  cristiana: {
    baseStyle: 'Spanish-language Christian praise and worship music, música cristiana de alabanza y adoración, contemporary worship song',
    defaultTempo: '70-100 BPM',
    instruments: 'acoustic guitar, piano, soft pad, light percussion, bass guitar',
    negativeTags: 'profane lyrics, secular party themes, aggressive trap, 808 bass, reggaeton dembow, EDM drops, heavy metal distortion, regional Mexican accordion, mariachi trumpets',
    defaultVocalCharacter: 'warm devoted worship vocal, sincere passionate delivery, prayerful and reverent tone',
    subGenres: {
      balada_intima: {
        name: 'Balada Íntima de Adoración',
        style: 'slow intimate Christian worship ballad in Spanish, prayerful adoración ballad, contemplative praise ballad, tender devotional song, reflective worship anthem with emotional build, balada cristiana de adoración íntima',
        tempo: '65-80 BPM, slow reverent tempo, prayerful breathing pace, contemplative groove',
        instruments: 'soft grand piano leading the harmony, fingerpicked acoustic guitar, warm string pad, gentle cello swells, subtle brushed drums or no drums, sustained synth pad, occasional crystal bells, soft electric guitar swells on chorus',
        vibe: 'intimate prayer atmosphere, tearful surrender, devotional reverence, chapel quiet beauty, kneeling worship moment, candlelit adoration, faith-filled emotional surrender, hands-lifted in stillness',
        negative: 'party energy, dance tempo, secular romantic, aggressive drums, distorted guitars, trap 808, reggaeton, fast tempo, accordion, mariachi brass',
        vocalCharacter: 'tender devoted worship vocal, intimate prayerful delivery, emotionally surrendered tone, reverent and warm'
      },
      alabanza_celebratoria: {
        name: 'Alabanza Celebratoria',
        style: 'uplifting celebratory Christian praise song in Spanish, joyful congregational praise anthem, vibrant worship celebration, hand-clapping alabanza, high-energy church praise band, festive worship anthem with big chorus',
        tempo: '110-130 BPM, energetic celebratory tempo, joyful clapping groove, uplifting praise pulse',
        instruments: 'driving acoustic guitar strumming, full piano chords, bright electric guitar riffs, energetic drum kit with hand claps, bass guitar, tambourine and shaker, optional bright brass stabs, gospel-style organ swells, congregational backing choir',
        vibe: 'joyful praise celebration, hands raised in worship, congregational singing energy, festival of praise atmosphere, jubilant gratitude, victorious faith celebration, uplifting Sunday morning service energy',
        negative: 'sad melancholy, slow ballad only, secular party themes, aggressive trap, reggaeton, EDM drops, heavy metal',
        vocalCharacter: 'passionate joyful worship leader vocal, bright celebratory delivery, congregational call-and-response energy, uplifted and victorious'
      },
      adoracion_acustica: {
        name: 'Adoración Acústica',
        style: 'acoustic intimate Christian worship in Spanish, unplugged worship song, acoustic adoración with vocal and guitar, organic worship music, coffee-house style Christian praise, singer-songwriter worship feel',
        tempo: '75-95 BPM, gentle flowing tempo, organic acoustic groove, intimate worship pace',
        instruments: 'fingerpicked nylon-string acoustic guitar lead, soft piano accompaniment, warm acoustic bass, subtle brushed cajón or light percussion, occasional violin or cello melody, light vocal harmonies',
        vibe: 'unplugged living-room worship, intimate small-group adoración, sincere acoustic devotion, organic spiritual warmth, coffee-shop praise night, raw heartfelt faith, stripped-down honesty',
        negative: 'electronic production, EDM, heavy drum kit, distorted electric guitar, trap beats, reggaeton, brass section, accordion, mariachi',
        vocalCharacter: 'sincere acoustic worship vocal, warm honest delivery, intimate devoted tone, singer-songwriter style faith expression'
      },
      worship_moderno: {
        name: 'Worship Moderno',
        style: 'contemporary Christian worship band in Spanish, modern Spanish-language worship anthem, atmospheric worship rock, arena-worship sound, polished praise band production, modern adoración with cinematic build',
        tempo: '75-100 BPM, dynamic build from soft verse to soaring chorus, modern worship anthem pacing',
        instruments: 'atmospheric electric guitars with delay and reverb, sustained synth pads, piano foundation, acoustic guitar layer, modern drum kit with floor tom builds, bass guitar, ambient guitar swells, optional string section on climax',
        vibe: 'arena worship anthem, soaring spiritual crescendo, modern church atmosphere, cinematic praise moment, contemporary congregation singing together, faith declaration with goosebumps, modern worship night energy',
        negative: 'old hymnal style, traditional church organ only, regional Mexican, accordion, mariachi, trap, reggaeton, EDM drops, aggressive metal',
        vocalCharacter: 'modern worship leader vocal, dynamic delivery from soft intimacy to soaring praise, anthemic and faith-filled'
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
  },
  rieleros: {
    name: 'Los Rieleros del Norte',
    genre: 'Norteño con Sax',
    // Per project_mureka_v9_norteno_bias memory: no "cumbia", "sing-along",
    // "group harmonies", "duo" tokens — those activate V9's vocal-group and
    // polka-cumbia bias even though we're routed to V7.6.
    signatureSound: 'classic sax-driven norteño conjunto, prominent alto saxophone hooks trading with diatonic accordion, traditional polka norteña 2/4 groove, blue-collar El Paso–Juárez border norteño-sax sound, sax-forward conjunto polka tradition',
    keyElements: 'punchy alto sax riffs between accordion runs, diatonic accordion, bajo sexto, electric bass walking polka lines, polka norteña 2/4 drum pattern, 110-125 BPM traditional norteño polka tempo, single male storyteller lead vocal',
    keywords: ['rieleros', 'los rieleros', 'rieleros del norte']
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
  // El Komander / Los Buchones appear in the alterados genre DNA, Montéz
  // (accented spelling) in duranguense, Fania (label) in salsa — all slip
  // past the scrubber otherwise and Suno rejects artist references.
  'El Komander', 'Los Buchones de Culiacan', 'Los Buchones',
  'Montéz de Durango', 'Fania',
  'Fuerza Regida', 'Eslabón Armado', 'Eslabon Armado', 'Espinoza Paz',
  'Pepe Aguilar', 'Joan Sebastian', 'Joss Favela', 'Yahritza',
  'Edén Muñoz', 'Eden Munoz', 'Ariel Camacho', 'Lupillo Rivera',
  'Jenni Rivera', 'Pedro Fernández', 'Pedro Fernandez',
  'Alejandro Fernández', 'Alejandro Fernandez', 'Pedro Infante',
  'José Alfredo', 'Jose Alfredo', 'José José', 'Jose Jose',
  'Calibre 50', 'Intocable', 'Conjunto Primavera', 'Banda MS', 'BandaMS',
  'Los Rieleros del Norte', 'Rieleros del Norte', 'Los Tigrillos',
  'Los Palominos',
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
    // Collapse spaces/tabs ONLY — never newlines. This sanitizer also runs on
    // LYRICS in the Kie path; the old /\s+/ collapse flattened every song into
    // one line, destroying the phrasing cues Suno needs (2026-06-12 bake-off).
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')        // trim leading/trailing commas
    .trim();
  return out;
}

// Trim a string to at most `max` chars WITHOUT slicing through a word: cut back
// to the last comma or space within range. Keeps the style prompt clean when the
// combined genre description exceeds the music provider's character budget.
function clampAtBoundary(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastComma = slice.lastIndexOf(', ');
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastComma > 0 ? lastComma : lastSpace;
  return (cut > max * 0.5 ? slice.slice(0, cut) : slice).replace(/[,\s]+$/, '');
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

  // "Lead" = everything except vibe; vibe is held back as a reserved tail so it
  // can't be truncated away (see assembly note below).
  const leadParts: string[] = [];
  const negativeParts: string[] = [genreData.negativeTags];
  let vibePart = '';

  // Primary: Sub-genre style (most specific)
  if (subGenreData) {
    leadParts.push(subGenreData.style);
    leadParts.push(subGenreData.tempo); // CRITICAL: tempo enforcement
    leadParts.push(subGenreData.instruments);
    vibePart = subGenreData.vibe;       // reserved tail — see assembly below
    negativeParts.push(subGenreData.negative);
  } else {
    // Fallback to genre defaults
    leadParts.push(genreData.baseStyle);
    leadParts.push(genreData.defaultTempo);
    leadParts.push(genreData.instruments);
  }

  // Secondary: Artist sonic signature (if specified) — NO artist names sent to API
  if (artistData) {
    leadParts.push(artistData.signatureSound);
    leadParts.push(artistData.keyElements);
  }

  // Voice type (male or female only — duet not supported by Mureka API)
  const vocalGender = voiceType === 'female' ? 'f' : 'm';

  // Vocal character: gender-neutral delivery style (gender handled by vocal_gender API param)
  const vocalCharacter = subGenreData?.vocalCharacter || genreData.defaultVocalCharacter || '';

  // Assemble within the provider char budget. Previously we joined
  // [style, tempo, instruments, vibe] and hard-cut at 980 — for the most verbose
  // genres (e.g. corrido tradicional, whose `style` alone is ~590 chars) that cut
  // landed inside `instruments` and dropped `vibe` (the atmosphere/emotion cues)
  // entirely. Now: if everything fits, output is byte-identical to before; only
  // when it would overflow do we reserve a slice for `vibe` so the emotional
  // character always reaches the model.
  const STYLE_BUDGET = 980;
  const VIBE_RESERVE = 170;
  const lead = leadParts.filter(Boolean).join(', ');
  const fullJoin = [lead, vibePart].filter(Boolean).join(', ');
  let stylePrompt: string;
  if (fullJoin.length <= STYLE_BUDGET) {
    stylePrompt = fullJoin; // fits whole — identical to previous behavior
  } else {
    const trimmedLead = clampAtBoundary(lead, STYLE_BUDGET - VIBE_RESERVE - 2);
    const trimmedVibe = clampAtBoundary(vibePart, VIBE_RESERVE);
    stylePrompt = (trimmedVibe ? `${trimmedLead}, ${trimmedVibe}` : trimmedLead).substring(0, STYLE_BUDGET);
  }

  return {
    vocalCharacter,
    stylePrompt,
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
  /** Genre ID (e.g. 'norteno', 'corrido', 'romantica'). Used by callMurekaProvider
   *  to route specific genres to older Mureka models that don't carry V9's
   *  accordion-conjunto polka-cumbia bias. See project_mureka_v9_norteno_bias. */
  genre?: string;
  subGenre?: string;
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

  // Mureka tokenizer treats long "NO duet / NO harmony / NO backing vocals" lists
  // as POSITIVE cues (the negation token doesn't reliably bind to the noun). The
  // canonical fix per project memory (project_mureka_v9_norteno_bias.md): keep
  // the voice tag minimal and POSITIVE-only. The Mureka `vocal_gender` API
  // parameter (passed separately below) does the actual gender pinning.
  const genderLabel = ctx.vocalGender === 'f'
    ? 'solo female lead vocal, single female singer'
    : 'solo male lead vocal, single male singer';
  const vocalStyle = ctx.vocalCharacter || 'expressive vocal';
  const voicePrefix = `${genderLabel}, ${vocalStyle}`;
  // No noVoiceSuffix — the same tokenizer issue applies to the appended
  // "absolutely no [opposite] vocals no duet" string. The minimal positive
  // prefix above + the vocal_gender API param are sufficient.
  const maxStyleChars = 1000 - voicePrefix.length - 4;
  const descWithVoice = `${voicePrefix}, ${ctx.finalStyle.substring(0, maxStyleChars)}`;
  const songTitle = (ctx.isForSelf ? `Mi canción — ${ctx.recipientName}` : `Canción para ${ctx.recipientName}`).substring(0, 50);

  const callbackBase = `${ctx.supabaseUrl}/functions/v1/mureka-useapi-callback`;
  const replyUrl = USEAPI_WEBHOOK_SECRET ? `${callbackBase}?token=${USEAPI_WEBHOOK_SECRET}` : callbackBase;
  const apiVocalGender = ctx.vocalGender === 'f' ? 'female' : 'male';

  // Defense-in-depth: scrub any leaked artist names from the desc before sending.
  const safeDesc = sanitizeArtistNames(descWithVoice).substring(0, 1000);

  // Translate Spanish section markers ([Verso 1] → [Verse 1], [Hablado] → [Spoken Word],
  // etc.) before sending to Mureka. Mureka is English-trained — Spanish tags get
  // ignored as structural cues, which is why [Hablado] was historically getting sung
  // instead of spoken. Lyrics CONTENT stays Spanish; only the bracketed markers flip.
  const safeLyrics = englishifyLyricsMarkers(ctx.lyrics).substring(0, 5000);

  // Per-genre model routing. Mureka V9 has a documented polka-cumbia bias on
  // accordion-conjunto music — same prompt produces wildly variable BPMs and
  // cumbia drift on norteño and corrido tradicional. V7.6 is the older /
  // lower-bias model that honors slow-tempo cues and doesn't auto-drift to
  // cumbia/quebradita on conjunto prompts. Both routes are env-overridable.
  // See project_mureka_v9_norteno_bias memory.
  const requestedModel = (() => {
    if (ctx.genre === 'norteno') {
      return Deno.env.get('MUREKA_NORTENO_MODEL') || 'V7.6';
    }
    if (ctx.genre === 'corrido' && ctx.subGenre === 'tradicional') {
      return Deno.env.get('MUREKA_CORRIDO_MODEL') || 'V7.6';
    }
    return MUREKA_MODEL;
  })();

  const payload: Record<string, unknown> = {
    account: MUREKA_ACCOUNT,
    lyrics: safeLyrics,
    title: songTitle,
    desc: safeDesc,
    model: requestedModel,
    vocal_gender: apiVocalGender,
    replyUrl,
  };

  console.log(`[callMureka] POST useapi.net (model=${requestedModel}, gender=${apiVocalGender}, genre=${ctx.genre ?? 'n/a'}, subGenre=${ctx.subGenre ?? 'n/a'})`);

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

  // Try V8 fallback model on model-specific 400s (existing behavior preserved)
  let cachedErrData: any = null;
  if (!resp.ok && requestedModel !== MUREKA_FALLBACK_MODEL) {
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
      console.warn(`[callMureka] Model ${requestedModel} failed (${resp.status}), retrying with ${MUREKA_FALLBACK_MODEL}`);
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

// Both providers (Mureka and Suno/Kie) are English-trained music models. They
// expect English structural markers in lyrics ([Verse 1], [Chorus], [Spoken Word],
// etc.) — NOT Spanish ([Verso 1], [Coro], [Hablado], etc.). When the model
// encounters a Spanish marker it doesn't recognize, it tends to either sing the
// word literally, blur the section boundary, or — in the case of [Hablado] —
// fail to switch the vocal model into spoken-word mode (so the "spoken"
// dedication ends up sung). [Intro] and [Outro] are identical in both languages
// so they pass through.
//
// We translate ONLY the structural markers; the actual sung lyrics stay 100%
// Spanish (since the site is Spanish-only).
function englishifyLyricsMarkers(lyrics: string): string {
  if (!lyrics) return lyrics;
  return stripSpokenProsodyCue(lyrics)
    .replace(/\[Verso Final\]/gi, '[Final Verse]')
    .replace(/\[Verso (\d+)\]/gi, '[Verse $1]')
    .replace(/\[Verso\]/gi, '[Verse]')
    .replace(/\[Coro Final\]/gi, '[Final Chorus]')
    .replace(/\[Coro\]/gi, '[Chorus]')
    .replace(/\[Puente\]/gi, '[Bridge]')
    .replace(/\[Pre-Coro\]/gi, '[Pre-Chorus]')
    .replace(/\[Hablado\]/gi, '[Spoken Word]');
}

// Mureka and Suno vocalize ANY parenthetical in the lyric body — it's the
// ad-lib / backing-vocal convention, NOT a silent stage direction. The genre
// prompts ask Claude to tag spoken sections with an English prosody cue like
// "(spoken, no melody, narrator voice, storytelling)" on the [Hablado] line,
// and the models were literally singing those English words. It's most audible
// in Corrido Tradicional, where [Hablado] is the FIRST section — customers
// heard unintelligible English before the song even started. The [Spoken Word]
// marker and the desc interlude cue already switch the model into spoken mode,
// so the inline cue is pure downside: strip it before it can be vocalized (or
// shown in the lyrics we display to the customer).
function stripSpokenProsodyCue(lyrics: string): string {
  if (!lyrics) return lyrics;
  return lyrics
    .replace(/[ \t]*\(\s*spoken[^)]*\)/gi, '') // drop "(spoken, no melody, …)" cues
    // Drop any leaked fill-in placeholder like [lugar], [nombre], [año si se
    // conoce] that a prompt example left behind. Real section markers are ALWAYS
    // capitalized ([Verso 1], [Coro], [Verse], [Chorus]); a bracket that starts
    // with a lowercase letter is never a marker, so it can only be an
    // instruction artifact the model would otherwise sing.
    .replace(/[ \t]*\[[a-záéíóúñ][^\]]*\]/g, '')
    .replace(/[ \t]+$/gm, '');                 // tidy trailing space left on the marker line
}

// ============================================================================
// Suno (Kie) genre recipes — validated against real paid orders in the
// 2026-06-12 bake-off (owner-approved A/B listening, see bakeoff/ + memory).
// The genreDNA styles were tuned for Mureka, which treats production words as
// vibe; Suno takes them literally ("cassette lo-fi" → bad audio) and drifts to
// its own priors (bélico → tumbado, sierreño → romantic ballad). These
// override the style/negatives on the KIE PATH ONLY — Mureka is untouched.
// Recipes are gender-neutral: the gender label + Spanish lock are prepended at
// payload build time. All validated on model V5_5 (V4_5 failed corridos).
// ============================================================================
const KIE_SPANISH_LOCK = 'sung entirely in Spanish, letra completamente en español, Mexican Spanish pronunciation';
const KIE_ENGLISH_NEGATIVES = 'English lyrics, English vocals, spoken English';

const KIE_GENRE_OVERRIDES: Record<string, { style: string; negatives: string }> = {
  'corrido/tradicional': {
    style: 'authentic 1990s Sinaloa corrido tradicional, classic conjunto corrido, narrative corrido balladeer storytelling, diatonic button accordion lead with bright reedy treble timbre, bajo sexto twelve-string rhythm, slapped tololoche upright bass driving a 2/4 oom-pah pulse, sparse minimal drums, live cantina band feel, 85-105 BPM deliberate storytelling pace, grave declamatory corridista narrator vocal, clear diction, every word audible, warm vintage 90s analog recording character, classic-era corrido production',
    negatives: 'trap, 808, auto-tune, EDM, synthesizer, brass section, saxophone, modern pop production, reggaeton',
  },
  'ranchera/lenta': {
    style: 'classic Mexican ranchera ballad, golden-age ranchera tradition, full mariachi ensemble, mariachi violin section with sustained emotional bowing, soft trumpet fanfares between verses, vihuela gentle strumming, guitarrón deep bass, 60-75 BPM very slow dramatic ballad, dramatic pauses between phrases, powerful dramatic vocal with deep vibrato, theatrical heartfelt delivery, every word clear and audible, warm vintage analog recording character, classic 1960s-70s ranchera era production',
    negatives: 'trap, 808, auto-tune, EDM, synthesizer, modern pop, rock, accordion, upbeat rhythms, fast tempo, dance energy',
  },
  'corrido/belico': {
    style: 'corrido bélico, movimiento alterado street corrido, requinto twelve-string acoustic guitar lead with rapid ornamental runs tremolos and parallel thirds, segunda rhythm guitar with percussive rasgueado strumming, tololoche upright bass, tuba bass accents on the low end, snare-driven 2/4 polka groove with rimshot backbeat pops, driving uptempo forward momentum 100-120 BPM, dark minor-key narrative intensity, tight speech-like aggressive narrative vocal cadences, gritty gravelly mid-range voice, crew shouts gritos and ad-libs on hooks, modern studio clarity on an acoustic backbone',
    negatives: 'corridos tumbados, trap, 808, trap hi-hats, half-time feel, auto-tune, laid-back melodic flow, slow ballad, banda brass, accordion',
  },
  'sierreno/tradicional': {
    style: 'traditional sierreño trio, three-guitar sierreño ensemble from the Sierra Madre, requinto sierreño nylon guitar lead with ornamental bending trills hammer-ons and rapid melodic runs between verses, twelve-string rhythm guitar strumming, tololoche acoustic upright bass with slap technique driving the rhythm, no drums or minimal cajón, rural rancho storytelling feel, mountain cantina atmosphere, 90-110 BPM moderate storytelling pace, earnest direct vocal with rancho sincerity, clear diction',
    negatives: 'romantic pop ballad, piano, string orchestra, soft pop production, bolero, banda brass, accordion, trap, 808, heavy drums',
  },
};

async function callKieProvider(ctx: ProviderCtx): Promise<ProviderResult> {
  const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
  // V5_5 is the only model validated for regional Mexican genres (2026-06-12
  // bake-off: V4_5 corridos rejected by owner). Keep any env override in sync.
  const KIE_MODEL = Deno.env.get('KIE_MODEL') || 'V5_5';

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
  // Short form on purpose: negatives are capped at 200 chars and the genre
  // blockers (e.g. "corridos tumbados, half-time feel") must always fit.
  const oppositeGenderTags = ctx.vocalGender === 'f'
    ? 'male voice, male vocal, baritone'
    : 'female voice, female vocal, soprano';

  // Suno-specific recipe for this genre/sub-genre, if one was validated.
  const override = ctx.genre && ctx.subGenre
    ? KIE_GENRE_OVERRIDES[`${ctx.genre}/${ctx.subGenre}`]
    : undefined;

  // Gender at the START gives it positional priority in Suno's tag parsing.
  // The Spanish lock right after it pins the vocal language — Suno is
  // English-trained and drifts into English/garbled vocals without it (the
  // regenerate-paid-song-kie tool had this for months; now the main path does).
  const styleBody = override
    ? override.style
    : `${ctx.vocalCharacter || 'expressive vocal'}, ${ctx.finalStyle}`;
  const styleWithVoice = `${genderLabel}, ${KIE_SPANISH_LOCK}, ${styleBody}`;
  const title = (ctx.isForSelf ? `Mi canción — ${ctx.recipientName}` : `Canción para ${ctx.recipientName}`).substring(0, 80);

  // Defense-in-depth: Suno (Kie) rejects any request whose tags reference a
  // real artist by name. Strip artist names from style AND lyrics before sending.
  // Also translate Spanish section markers ([Verso 1] → [Verse 1]) so Suno
  // recognizes the song structure. clampAtBoundary (not substring) so the
  // style never ends in a sliced word fragment — Suno can sing dangling
  // fragments aloud (2026-06-12 corrido incident).
  const safeStyle = clampAtBoundary(sanitizeArtistNames(styleWithVoice), 1000);
  const safeLyrics = sanitizeArtistNames(englishifyLyricsMarkers(ctx.lyrics)).substring(0, 5000);

  // Negatives, priority order under the 200-char Kie cap: language lock first,
  // wrong-gender block second, genre blockers last (truncated if they must be).
  // The old order put genre negatives first — verbose genres (corrido) filled
  // the cap and silently dropped the gender block entirely.
  const combinedNegatives = clampAtBoundary(
    [KIE_ENGLISH_NEGATIVES, oppositeGenderTags, override ? override.negatives : ctx.negativeTags]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(', '),
    200
  );

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
// content_rejection added 2026-06-12 (Suno-primary era): Suno's content filter is
// stricter than Mureka's — a Suno rejection very often succeeds on Mureka, so
// give the customer that chance instead of failing the order.
function shouldFallback(classification: ProviderErrorClass): boolean {
  return classification === 'provider_broken'
    || classification === 'credits_depleted'
    || classification === 'auth_broken'
    || classification === 'content_rejection'
    || classification === 'unknown';
}

// =============================================================================
// CLAUDE LYRICS GENERATION — STRUCTURED OUTPUT VIA TOOL USE
// =============================================================================
//
// 2026-05-21: switched from "ask Claude to emit JSON" → tool use. The previous
// approach asked Claude to return a JSON string we then parsed with JSON.parse.
// An invalid escape sequence in the JSON (e.g. `\y` where Claude meant `\n`)
// could blow up the parser, and the silent fallback shipped raw JSON syntax
// to the customer as the song lyrics. With tool use, the API itself validates
// the response against the schema below and returns `input` as a parsed object.
// No string parsing on our side. No way for an LLM typo to leak through.
//
// Tool input is the contract. If Claude does not call the tool, or returns
// input that fails schema validation, the request fails loudly — never silently.
//
// The static system prompt holds composition rules that don't change per
// request. It's marked with cache_control so subsequent requests within
// the cache TTL read it from cache at ~10% of the input cost.

const LYRICS_TOOL = {
  name: 'submit_song_lyrics',
  description:
    'Submit the final song lyrics and emotional modifiers for the music production pipeline. ' +
    'You MUST call this tool to deliver your output. Do not respond with prose, JSON text, ' +
    'or any other format — only call this tool with both required fields populated.',
  input_schema: {
    type: 'object',
    properties: {
      lyrics: {
        type: 'string',
        description:
          'The complete song lyrics in Spanish. Use real newline characters between lines ' +
          '(the field accepts multi-line strings natively — do NOT write the literal characters ' +
          'backslash-n). Include all required section markers like [Intro], [Verso 1], [Coro], ' +
          '[Verso 2], [Puente], [Coro Final], [Outro] etc. per the structure rules in the user message. ' +
          'Follow ALL composition rules from the system prompt and the per-song specifics from the user message.',
      },
      emotionalModifiers: {
        type: 'string',
        description:
          'Up to 25 words in ENGLISH describing the unique emotion and atmosphere of THIS song. ' +
          'Do NOT mention the genre, instruments, or tempo — those go elsewhere in the pipeline. ' +
          'The modifiers MUST match the sonic character of the genre (e.g. fierce/defiant for ' +
          'aggressive genres, aching/bittersweet for melancholic, euphoric for festive, tender for romantic).',
      },
    },
    required: ['lyrics', 'emotionalModifiers'],
    additionalProperties: false,
  },
} as const;

// Static composition rules — invariant across all requests, eligible for prompt caching.
// Anything per-customer (recipient name, genre, occasion, details, structure) is in the
// dynamic user message below, NOT here. Keep this block byte-stable so the cache holds.
const LYRICS_SYSTEM_PROMPT = `Eres un compositor experto de música mexicana y latina. Te especializas en composición personalizada para regalos musicales. Escribes letras que la gente CANTA, no que solo lee.

Recibirás los detalles de cada canción (género, destinatario, ocasión, detalles personales, estructura de secciones) en el mensaje del usuario. Las REGLAS siguientes aplican a TODAS las canciones que escribes, sin excepción.

REGLAS DE COMPOSICIÓN (OBLIGATORIAS):

1. CORO = LO MÁS IMPORTANTE. El coro DEBE ser pegajoso, corto (4 líneas), y fácil de cantar. El oyente debe poder cantar el coro después de escucharlo UNA vez. Si el coro no es memorable, la canción falla.

   FÓRMULA OBLIGATORIA DEL CORO — patrón A-A'-B-A (la receta del earworm):
   - Línea 1 (A): La frase-GANCHO central. Esta es LA línea que la gente recuerda y tararea. Es el corazón de la canción. 4-7 sílabas. Contiene el sentimiento principal.
   - Línea 2 (A'): Variación de la línea 1. Misma estructura rítmica, cambia 1-2 palabras. Refuerza el gancho sin repetirlo idéntico.
   - Línea 3 (B): Línea de CONTRASTE. Idea diferente que prepara el regreso al gancho.
   - Línea 4 (A): REPITE EXACTAMENTE la línea 1. Cierra el coro con el gancho intacto.

   Esta repetición intencional (3 veces el gancho, 1 vez variación, 1 vez contraste) es lo que crea earworm — la canción que se queda en la cabeza después de UNA escucha. NO inventes "estilos creativos" de coro: usa esta fórmula sin excepciones.

2. CONTRASTE VERSO vs CORO. Los versos CUENTAN la historia (narrativos, específicos, íntimos). El coro EXPLOTA la emoción (universal, repetible, intenso). Que se sientan como secciones DISTINTAS en energía y tono.

3. DETALLES ESPECÍFICOS > FRASES GENÉRICAS.
   PROHIBIDO: "eres la luz de mi vida", "sin ti no puedo vivir", "eres mi todo", "mi corazón late por ti", "eres mi sol y mi luna", "eres el amor de mi vida", "contigo soy feliz".
   EN VEZ usa los detalles personales que el usuario provee para crear imágenes ÚNICAS y concretas. Un recuerdo específico vale más que 10 frases bonitas genéricas.
   REGLA CRÍTICA: Si el usuario mencionó FECHAS, LUGARES, EVENTOS, APODOS, o ANÉCDOTAS en los detalles, DEBES incluir CADA UNO en la letra. Distribúyelos así: Verso 1 = contexto/origen de la historia, Verso 2 = momentos específicos y recuerdos, Puente = lo más íntimo/vulnerable. NO ignores ningún detalle que el usuario proporcionó — es lo que hace ÚNICA esta canción y por lo que PAGARON.

4. USO DEL NOMBRE — instrucción específica viene en el mensaje del usuario (varía si la canción es para otra persona o para uno mismo).

5. CANTABILIDAD — DOS PRESUPUESTOS DE SÍLABAS DISTINTOS (no es un solo límite universal).
   - VERSOS ([Verso 1], [Verso 2], [Puente]): 8-14 sílabas por línea. Los versos cuentan la historia — necesitan espacio para narrar.
   - CORO ([Coro], [Coro Final], [Pre-Coro]): 4-7 sílabas por línea. CORTAS, PUNZANTES. Líneas largas en el coro NO se pueden gritar en grupo. La línea-gancho debe ser tan corta que se grabe en la cabeza después de UNA escucha. Si una línea del coro pasa de 7 sílabas, RECÓRTALA.
   Español mexicano COLOQUIAL, no literario ni poético rebuscado. Escribe como se HABLA en México.

6. RIMA. Usa rima consonante o asonante natural. No fuerces rimas artificiales. Esquema por estrofa: ABAB o AABB.

7. PUENTE = GIRO EMOCIONAL. Cambio de perspectiva, confesión íntima, o el momento más vulnerable. NO repetir la misma idea de los versos.

8. NO empezar múltiples versos con la misma palabra. Varía las aperturas de cada línea.

9. VOCALES ABIERTAS AL FINAL DEL CORO — regla física, no estilística. Cada línea de [Coro], [Coro Final], y [Pre-Coro] (si existe) DEBE terminar en vocal abierta: a, o, e. NUNCA terminar línea del coro en consonante final, ni en "s" plural, ni en sílabas cerradas (-r, -n, -d, -l, -z, etc.).
   Razón: las vocales abiertas se pueden SOSTENER al cantar — son donde vive el "singalong". Las consonantes cortan el sonido y matan la cantabilidad en grupo. Compara: "te quiero a ti" (cantable) vs "te quiero más" (cortante).
   Si una línea del coro termina en consonante, REESCRÍBELA invirtiendo el orden o cambiando la palabra final para que termine en vocal abierta. Esta regla es INNEGOCIABLE para [Coro], [Coro Final], [Pre-Coro]. En versos no aplica (puedes terminar como quieras).

REGLA ABSOLUTA — FIDELIDAD A LOS HECHOS (NO DISTORSIONAR, NO INVENTAR DATOS):
La letra NUNCA debe afirmar un hecho que contradiga o cambie el significado de lo que el usuario escribió. Un solo dato equivocado (fecha, lugar, relación, evento) ARRUINA el regalo y rompe la confianza del cliente. Esta regla pesa MÁS que la rima, la métrica o la belleza de la frase: si para que rime tienes que cambiar un hecho, cambia la frase, NUNCA el hecho.

- PRESERVA EL SIGNIFICADO EXACTO de cada dato. NO cambies el VERBO ni la RELACIÓN entre los datos. El verbo es el hecho — cambiarlo es mentir. Errores PROHIBIDOS (ejemplos reales):
  • "se conocieron en 2019" → PROHIBIDO escribir "llegaron en 2019" (conocerse ≠ llegar)
  • "casados hace 10 años" → PROHIBIDO escribir "se conocieron hace 10 años" (casarse ≠ conocerse)
  • "es de Jalisco" → PROHIBIDO escribir "vive en Jalisco" (origen ≠ residencia actual)
  • "su papá / su hijo" → PROHIBIDO cambiarlo a "su abuelo / su hermano" (cada parentesco es exacto)
  • un nombre, número, fecha o lugar → cópialo TAL CUAL, no lo "mejores" ni lo aproximes.
- NO INVENTES datos concretos nuevos (fechas, lugares, edades, números, nombres, eventos) que el usuario NO dio. Está PROHIBIDO agregar un hecho específico falso solo porque "suena bien" o porque ayuda a la rima.
- SÍ tienes libertad TOTAL para la EMOCIÓN: atmósfera, imágenes sensoriales, sentimiento, metáforas. Tu creatividad es sobre CÓMO se siente la historia, NUNCA sobre QUÉ pasó. Adorna el sentimiento, no los hechos.
- Si un detalle es AMBIGUO o incompleto, déjalo GENERAL en vez de inventar una versión específica que podría ser falsa. Mejor verdadero y vago que específico y equivocado.
- EXCEPCIÓN ÚNICA: si el usuario NO proporcionó NINGÚN detalle personal, entonces SÍ puedes inventar momentos verosímiles (se te indica explícitamente en el mensaje del usuario cuando aplica). La prohibición de inventar/distorsionar aplica SOLO a los datos que el usuario SÍ escribió.

ANTES DE ENTREGAR — AUTO-VERIFICACIÓN OBLIGATORIA: relee cada línea de la letra que mencione un dato (fecha, lugar, nombre, parentesco, edad, evento, apodo) y confírmalo contra los DETALLES PERSONALES del mensaje del usuario, palabra por palabra. Si alguna línea cambia, exagera o inventa un hecho, REESCRÍBELA antes de llamar a la herramienta. La letra que entregas debe poder leerse junto a los detalles del cliente sin una sola contradicción.

REGLA ABSOLUTA — NOMBRES DE ARTISTAS:
NUNCA escribas el nombre de un artista, banda, cantante o grupo musical real (ni en las letras, ni en emotionalModifiers, ni en ningún otro campo). Esto incluye nombres como "Christian Nodal", "Vicente Fernández", "Alacranes Musical", "Banda MS", "Carin León", "Peso Pluma", "K-Paz", "Diomedes Díaz", etc. — si pensaste mencionar un artista para describir el estilo, REEMPLÁZALO por una descripción del SONIDO ("modern romantic ranchera style", "techno-banda style") sin mencionar al artista. El proveedor de música RECHAZA cualquier referencia a artistas reales y la canción FALLA.

REGLA CRÍTICA para emotionalModifiers:
Los modifiers DEBEN ser compatibles con el carácter sonoro del género. Expresa la emoción A TRAVÉS del lente del género, nunca en contra.
- Género agresivo/oscuro (bélico, trap, alterados): emociones con fuerza — "fierce unbreakable loyalty, defiant pride, raw respect" NO "warm heartfelt tender"
- Género melancólico (sad sierreño, bolero): emociones con peso — "aching longing, bittersweet devotion, haunting memory"
- Género festivo/bailable (cumbia, quebradita): emociones con energía — "euphoric celebration, infectious joy, vibrant tribute"
- Género romántico/suave: calidez — "tender intimacy, warm embrace, gentle devotion"

ENTREGA DE LA SALIDA:
SIEMPRE entrega tu resultado llamando a la herramienta submit_song_lyrics con ambos campos (lyrics, emotionalModifiers). NUNCA respondas con prosa, JSON en texto, o cualquier otro formato. La herramienta es el único canal de entrega.`;

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
      customLyrics, useCustomLyrics,
    } = body;

    // "Escribir mi propia letra" path: when the buyer supplies their own lyrics,
    // the song MUST be sung with their exact words — we skip Claude generation
    // entirely (see the lyrics step below). The genre/subGenre still drive the
    // musical style; only the words come from the customer. We require a real
    // (non-blank) string before honoring the flag so a stray `true` with empty
    // text can never produce a wordless song.
    const wantsCustomLyrics =
      useCustomLyrics === true &&
      typeof customLyrics === 'string' &&
      customLyrics.trim().length > 0;

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

    // ---- IMMUTABLE SUBMISSION AUDIT (write FIRST, before any generation) ----
    // Capture exactly what the customer submitted the moment we receive it, so
    // their words survive even if AI/Suno generation later fails or the song row
    // never gets inserted. Append-only; never overwritten. Failure here must not
    // block song generation, so it's best-effort.
    try {
      await supabase.from('lyric_submissions').insert({
        email: email || null,
        recipient_name: recipientName || null,
        sender_name: senderName || null,
        occasion: occasion || null,
        genre: genre || null,
        session_id: currentSessionId,
        used_custom_lyrics: wantsCustomLyrics,
        submitted_lyrics: wantsCustomLyrics ? customLyrics : null,
        submitted_details: details || null,
      });
    } catch (auditErr) {
      console.warn('[generate-song] lyric_submissions audit insert failed (non-blocking):', auditErr);
    }

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

    // Pre-compute whether this genre/subGenre combination triggers a spoken-word
    // [Hablado] section. Two consumers need this flag:
    //   1) The user-message template below (it builds the [Hablado] instruction)
    //   2) The Mureka `desc` field (it gets primed BEFORE seeing the lyrics so
    //      the vocal model expects a spoken interlude — see project memory on
    //      Mureka treating [Hablado] as sung when not pre-cued).
    // Conditions must stay in sync with the spokenWordConfig map below.
    const hasSpokenWord =
      (genre === 'ranchera' && subGenre === 'lenta') ||
      (genre === 'bolero' && (subGenre === 'bolero_clasico' || subGenre === 'clasico')) ||
      (genre === 'corrido' && subGenre === 'tradicional') ||
      (genre === 'cumbia' && subGenre === 'sonidera') ||
      (genre === 'balada' && (subGenre === 'balada_clasica' || subGenre === 'clasica')) ||
      (genre === 'banda' && (subGenre === 'romantica' || subGenre === 'romantico')) ||
      (genre === 'norteno' && (subGenre === 'romantico' || subGenre === 'romantica'));

    // Pre-chorus structure ([Pre-Coro] between verse and chorus). Pop convention
    // that builds tension before the chorus pays off — biggest single lever for
    // catchiness in modern songs. But it doesn't fit every genre: narrative
    // corridos lose their storytelling flow, dramatic ballads (ranchera lenta,
    // bolero) need conversational intimacy without pop-structure scaffolding,
    // ceremonial genres (vals, mariachi tradicional, balada clásica) feel wrong
    // with a pop-style ramp-up. Skip those; everyone else gets it.
    const skipPreChorus =
      (genre === 'corrido' && (subGenre === 'tradicional' || subGenre === 'romantico')) ||
      (genre === 'ranchera' && subGenre === 'lenta') ||
      genre === 'sierreno' ||
      genre === 'bolero' ||
      genre === 'vals' ||
      (genre === 'mariachi' && subGenre === 'tradicional') ||
      (genre === 'balada' && (subGenre === 'balada_clasica' || subGenre === 'clasica'));
    const hasPreChorus = !skipPreChorus;

    // User message — DYNAMIC per request. Static composition rules (1-3, 5-8,
    // artist-name rule, emotionalModifiers compatibility rule, tool-delivery
    // contract) live in LYRICS_SYSTEM_PROMPT at module scope and are cached.
    // Only per-song specifics go here.
    const claudeUserMessage = `Escribe una canción de ${displayGenre} con los siguientes datos.

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

REGLA 4 (USO DEL NOMBRE) PARA ESTA CANCIÓN:
${nameInstruction}

${perspectiveInstruction}

${(() => {
  // Genre-specific spoken word sections — culturally authentic placements
  const spokenWordConfig: Record<string, { condition: boolean; instruction: string; placement: string; sectionDesc: string }> = {
    ranchera_lenta: {
      condition: genre === 'ranchera' && subGenre === 'lenta',
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. INMEDIATAMENTE después del marcador, en la misma línea, agrega la pista de prosodia en inglés entre paréntesis: "(spoken, no melody, dramatic pause, intimate whisper)" — esto le indica al modelo de Mureka que cambie de canto a habla. Luego escribe 2-3 líneas HABLADAS (no cantadas) — una dedicatoria emocional directa a ${recipientName}. Estilo ranchera dramática clásica: íntimo, con pausa dramática, como si le hablaras al oído. Ejemplo formato exacto:
[Hablado] (spoken, no melody, dramatic pause, intimate whisper)
Escúchame bien, ${recipientName}... esto que siento no cabe en una canción... pero aquí va, con todo mi corazón.`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado] (spoken, no melody, dramatic pause, intimate whisper): Dedicatoria hablada (NO cantada). 2-3 líneas íntimas, dramáticas, directas a ${recipientName}.`
    },
    bolero_clasico: {
      condition: genre === 'bolero' && (subGenre === 'bolero_clasico' || subGenre === 'clasico'),
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. INMEDIATAMENTE después del marcador, en la misma línea, agrega la pista de prosodia en inglés entre paréntesis: "(spoken, no melody, whispered, intimate)" — esto le indica al modelo de Mureka que cambie de canto a habla. Luego escribe 2-3 líneas HABLADAS en voz baja, íntima — una confesión romántica susurrada. Estilo trío romántico de los años 50: como si le hablaras al oído en la oscuridad. Ejemplo formato exacto:
[Hablado] (spoken, no melody, whispered, intimate)
${recipientName}... si supieras lo que siento cada vez que te veo... estas palabras no alcanzan, pero mi corazón no se calla.`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado] (spoken, no melody, whispered, intimate): Confesión susurrada (NO cantada). 2-3 líneas íntimas, románticas, en voz baja.`
    },
    corrido_tradicional: {
      condition: genre === 'corrido' && subGenre === 'tradicional',
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] como PRIMERA sección, ANTES del [Verso 1]. INMEDIATAMENTE después del marcador, en la misma línea, agrega la pista de prosodia en inglés entre paréntesis: "(spoken, no melody, narrator voice, storytelling)" — esto le indica al modelo de Mureka que cambie de canto a habla. Luego escribe 2-3 líneas HABLADAS — el narrador presenta la historia al estilo corrido clásico. Ejemplo formato exacto:
[Hablado] (spoken, no melody, narrator voice, storytelling)
Señores, les voy a contar la historia de ${recipientName}... pongan atención, que esta es de las buenas.`,
      placement: 'intro',
      sectionDesc: `- [Hablado] (spoken, no melody, narrator voice, storytelling): Narrador presenta la historia (NO cantado). 2-3 líneas al estilo "Señores, les voy a contar..."`
    },
    cumbia_sonidera: {
      condition: genre === 'cumbia' && subGenre === 'sonidera',
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] como PRIMERA sección, ANTES del [Verso 1]. INMEDIATAMENTE después del marcador, en la misma línea, agrega la pista de prosodia en inglés entre paréntesis: "(spoken, no melody, MC shout, party energy)" — esto le indica al modelo de Mureka que cambie de canto a habla. Luego escribe 2-3 líneas HABLADAS al estilo MC sonidero — saludos y dedicatorias con energía de fiesta. Ejemplo formato exacto:
[Hablado] (spoken, no melody, MC shout, party energy)
¡Wepa! ¡Este saludo va dedicado para ${recipientName}! ¡Que se prenda la fiesta! ¡Desde el barrio con todo el corazón!`,
      placement: 'intro',
      sectionDesc: `- [Hablado] (spoken, no melody, MC shout, party energy): Saludo de sonidero MC (NO cantado). 2-3 líneas con energía de fiesta, saludos, "¡Wepa!"`
    },
    balada_clasica: {
      condition: genre === 'balada' && (subGenre === 'balada_clasica' || subGenre === 'clasica'),
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. INMEDIATAMENTE después del marcador, en la misma línea, agrega la pista de prosodia en inglés entre paréntesis: "(spoken, no melody, vulnerable, soft)" — esto le indica al modelo de Mureka que cambie de canto a habla. Luego escribe 2-3 líneas HABLADAS en tono vulnerable — un momento íntimo donde el cantante baja la guardia y confiesa algo que no pudo cantar. Ejemplo formato exacto:
[Hablado] (spoken, no melody, vulnerable, soft)
${recipientName}... sé que las palabras nunca son suficientes... pero necesitaba que supieras esto...`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado] (spoken, no melody, vulnerable, soft): Confesión vulnerable (NO cantada). 2-3 líneas en tono íntimo, bajando la guardia.`
    },
    banda_romantica: {
      condition: genre === 'banda' && (subGenre === 'romantica' || subGenre === 'romantico'),
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. INMEDIATAMENTE después del marcador, en la misma línea, agrega la pista de prosodia en inglés entre paréntesis: "(spoken, no melody, dramatic dedication)" — esto le indica al modelo de Mureka que cambie de canto a habla. Luego escribe 2-3 líneas HABLADAS — una dedicatoria dramática con la banda de fondo suave. Estilo banda romántica dramática clásica. Ejemplo formato exacto:
[Hablado] (spoken, no melody, dramatic dedication)
Esto va para ti, ${recipientName}... porque no hay canción que alcance para decirte lo que significas...`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado] (spoken, no melody, dramatic dedication): Dedicatoria dramática (NO cantada). 2-3 líneas emotivas con banda suave de fondo.`
    },
    norteno_romantico: {
      condition: genre === 'norteno' && (subGenre === 'romantico' || subGenre === 'romantica'),
      instruction: `SECCIÓN HABLADA (OBLIGATORIA):
Incluye [Hablado] antes del [Coro Final]. INMEDIATAMENTE después del marcador, en la misma línea, agrega la pista de prosodia en inglés entre paréntesis: "(spoken, no melody, sincere, heart-felt)" — esto le indica al modelo de Mureka que cambie de canto a habla. Luego escribe 2-3 líneas HABLADAS — una dedicatoria sincera y directa, con el acordeón suave de fondo. Estilo norteño de corazón. Ejemplo formato exacto:
[Hablado] (spoken, no melody, sincere, heart-felt)
Con el corazón en la mano, ${recipientName}... esta canción la escribí pensando en ti... va con todo lo que soy.`,
      placement: 'before_coro_final',
      sectionDesc: `- [Hablado] (spoken, no melody, sincere, heart-felt): Dedicatoria sincera (NO cantada). 2-3 líneas directas, de corazón.`
    }
  };

  const active = Object.values(spokenWordConfig).find(c => c.condition);
  if (!active) return '';
  return active.instruction + '\n';
})()}${(() => {
  // Corrido Tradicional ONLY: 90s rural Sinaloa lyrical conventions. These
  // OVERRIDE the universal lyric rules where they conflict (especially the
  // syllable budget — 90s corridos use strict octosyllabic meter for ALL
  // lines, not the universal 8-14 verse / 4-7 chorus split). Fires only when
  // genre+subGenre match; otherwise empty string so other genres are unaffected.
  if (genre !== 'corrido' || subGenre !== 'tradicional') return '';
  return `
CONVENCIONES OBLIGATORIAS DEL CORRIDO TRADICIONAL (90s rural Sinaloa) — ESTAS REGLAS OVERRIDE LAS REGLAS UNIVERSALES:

1. MÉTRICA OCTOSILÁBICA (ESTRICTA). TODAS las líneas (versos, pre-coro si existe, coro, coro final) DEBEN tener exactamente 8 sílabas. Esta es la métrica tradicional del corrido mexicano desde el siglo XIX. OVERRIDE la regla universal de 4-7 sílabas en coro — para corrido tradicional el coro también es 8 sílabas. Cuenta las sílabas LITERALMENTE (no las poéticas) — si tienes 7 o 9 sílabas, ajusta.

2. ESTROFAS DE CUARTETA. Cada verso ([Verso 1], [Verso 2], [Puente]) debe ser una cuarteta de 4 líneas con rima ABAB o ABCB. La rima es CONSONANTE preferentemente. No improvises estrofas de 5 o 6 líneas — siempre 4.

3. FÓRMULA TRADICIONAL DE APERTURA. El [Verso 1] (o el [Hablado] inicial si existe) DEBE abrir con una de estas fórmulas clásicas del corrido (escoge la más natural para el caso). IMPORTANTE: rellena los datos con el valor real (año, lugar) ya escrito — NUNCA dejes corchetes ni instrucciones en la letra:
   - "Voy a cantarles señores..."
   - "Año del dos mil veinte..." (usa el año real solo si el usuario lo dio; si no, omite esta fórmula)
   - "En el rancho de San Miguel..." (usa el lugar real del usuario, o un marcador rural genérico como "el rancho")
   - "Pongan mucha atención..."
   - "Señores, voy a contarles..."
   - "Aquí les traigo un corrido..."

4. NARRATIVA CRONOLÓGICA. Cada verso avanza la historia EN TIEMPO. NO uses flashbacks. NO uses metáforas abstractas. SOLO acciones concretas, eventos reales, detalles del mundo físico (lugares, fechas, personas, objetos). El corrido es REPORTAJE cantado, no poesía.

5. NOMBRE DEL PROTAGONISTA EN CADA VERSO. ${recipientName} debe aparecer en CADA cuarteta (Verso 1, Verso 2, Puente) — no solo al inicio. Override la regla universal de "4+ menciones distribuidas" — para corrido tradicional, el nombre se repite en cada estrofa porque el corrido ES la historia de esa persona.

6. NOMBRES DE LUGARES. Si el usuario mencionó un lugar específico en los detalles personales, ÚSALO literalmente (su rancho, ciudad, estado). Si NO mencionó lugar, usa marcadores rurales genéricos: "el rancho", "la sierra", "el pueblo", "el palenque", "la cantina". NUNCA inventes un lugar de Sinaloa específico si el usuario no lo mencionó (puedes ofender o equivocarte).

7. DESPEDIDA FINAL. El [Coro Final] o las últimas líneas del [Puente] deben incluir una fórmula de despedida tradicional:
   - "Ya con esta me despido..."
   - "Aquí termina el corrido de ${recipientName}..."
   - "Y aquí acaba mi corrido..."
   - "Vuela vuela palomita, lleva este corrido a..."
   Es la marca tradicional del cierre del corrido del siglo XX.

8. PROHIBIDO. NO uses jerga moderna (nada de "vibe", "flow", "real", "OG", anglicismos). NO uses suavidad romántica de balada moderna. NO uses metáforas abstractas tipo "eres la luz" — el corrido habla en CONCRETO. NO incluyas referencias a redes sociales, celulares, marcas de lujo modernas, ni nada post-2000s.

Recuerda: el coro sigue la fórmula A-A'-B-A pero con métrica octosilábica — la línea-gancho es 8 sílabas, no 4-7. Las vocales abiertas al final del coro siguen aplicando.
`;
})()}FUNCIÓN DE CADA SECCIÓN:
${(() => {
  const isCorridoTrad = genre === 'corrido' && subGenre === 'tradicional';
  const isCumbiaSonidera = genre === 'cumbia' && subGenre === 'sonidera';
  const isIntroSpoken = isCorridoTrad || isCumbiaSonidera;

  const spokenConfigs: Record<string, { condition: boolean; sectionDesc: string }> = {
    ranchera_lenta: { condition: genre === 'ranchera' && subGenre === 'lenta', sectionDesc: `- [Hablado] (spoken, no melody, dramatic pause, intimate whisper): Dedicatoria hablada (NO cantada). 2-3 líneas íntimas, dramáticas, directas a ${recipientName}. La pista en inglés DEBE ir en la misma línea que [Hablado].` },
    bolero_clasico: { condition: genre === 'bolero' && (subGenre === 'bolero_clasico' || subGenre === 'clasico'), sectionDesc: '- [Hablado] (spoken, no melody, whispered, intimate): Confesión susurrada (NO cantada). 2-3 líneas íntimas, románticas. La pista en inglés DEBE ir en la misma línea que [Hablado].' },
    balada_clasica: { condition: genre === 'balada' && (subGenre === 'balada_clasica' || subGenre === 'clasica'), sectionDesc: '- [Hablado] (spoken, no melody, vulnerable, soft): Confesión vulnerable (NO cantada). 2-3 líneas íntimas. La pista en inglés DEBE ir en la misma línea que [Hablado].' },
    banda_romantica: { condition: genre === 'banda' && (subGenre === 'romantica' || subGenre === 'romantico'), sectionDesc: '- [Hablado] (spoken, no melody, dramatic dedication): Dedicatoria dramática (NO cantada). 2-3 líneas emotivas. La pista en inglés DEBE ir en la misma línea que [Hablado].' },
    norteno_romantico: { condition: genre === 'norteno' && (subGenre === 'romantico' || subGenre === 'romantica'), sectionDesc: '- [Hablado] (spoken, no melody, sincere, heart-felt): Dedicatoria sincera (NO cantada). 2-3 líneas directas. La pista en inglés DEBE ir en la misma línea que [Hablado].' },
    corrido_trad: { condition: isCorridoTrad, sectionDesc: '- [Hablado] (spoken, no melody, narrator voice, storytelling): Narrador presenta la historia (NO cantado). 2-3 líneas. La pista en inglés DEBE ir en la misma línea que [Hablado].' },
    cumbia_sonidera: { condition: isCumbiaSonidera, sectionDesc: '- [Hablado] (spoken, no melody, MC shout, party energy): Saludo de sonidero MC (NO cantado). 2-3 líneas con energía. La pista en inglés DEBE ir en la misma línea que [Hablado].' },
  };

  const active = Object.values(spokenConfigs).find(c => c.condition);
  const habladoLine = active?.sectionDesc || '';

  // Pre-chorus injection. preCoroLine is the section description Claude needs to
  // understand what [Pre-Coro] is for. preCoroBeforeCoro is the structural slot
  // that appears in the section list before each [Coro] (NOT before [Coro Final]
  // — the [Puente] already serves the build/escalation role into the final chorus
  // per modern pop convention). When hasPreChorus is false, both strings collapse
  // to empty and the structure is unchanged.
  const preCoroDesc = hasPreChorus
    ? '- [Pre-Coro]: 2 líneas de PUENTE EMOCIONAL hacia el coro. Energía CRECIENTE — preparas al oyente para la "explosión" del coro. NO es verso (no narra), NO es coro (no es el gancho). Es la "rampa" que sube hacia el gancho. 4-7 sílabas por línea como el coro. Termina cada línea en vocal abierta (a/o/e).\n'
    : '';
  const preCoroSlot = hasPreChorus ? '- [Pre-Coro]: Rampa de tensión hacia el coro (2 líneas cortas, energía creciente).\n' : '';

  if (isIntroSpoken && habladoLine) {
    // Corrido trad & Cumbia sonidera: [Hablado] IS the intro, just add [Outro].
    // Corrido trad is in skipPreChorus list (preCoroSlot will be empty);
    // Cumbia sonidera gets pre-chorus.
    return `${habladoLine}
- [Verso 1]: Presenta la historia. Contexto, escena, quién eres y qué sientes.
${preCoroSlot}- [Coro]: GANCHO emocional. Corto (4 líneas), memorable, repetible. Sigue la fórmula A-A'-B-A (línea 1 = gancho, línea 2 = variación, línea 3 = contraste, línea 4 = repetir gancho idéntico).
- [Verso 2]: Profundiza con detalles específicos. Momentos concretos, recuerdos.
${preCoroSlot}- [Coro]: Repetición del coro (MISMA letra exacta — no improvisar nuevo coro).
- [Puente]: Giro emocional. Lo más vulnerable o intenso de toda la canción.
- [Coro Final]: Cierre con impacto. Misma fórmula A-A'-B-A. Puede tener una variación sutil en la línea 3 (B).
- [Outro]: Cierre instrumental. NO escribir letra — solo poner "[Outro]" para que Mureka añada un cierre musical.
${preCoroDesc}`;
  }

  if (habladoLine) {
    // Genres with spoken dedication before final chorus
    return `- [Intro]: Apertura instrumental. NO escribir letra — solo poner "[Intro]" para que Mureka cree una entrada musical.
- [Verso 1]: Presenta la historia. Contexto, escena, quién eres y qué sientes.
${preCoroSlot}- [Coro]: GANCHO emocional. Corto (4 líneas), memorable, repetible. Sigue la fórmula A-A'-B-A (línea 1 = gancho, línea 2 = variación, línea 3 = contraste, línea 4 = repetir gancho idéntico).
- [Verso 2]: Profundiza con detalles específicos. Momentos concretos, recuerdos.
${preCoroSlot}- [Coro]: Repetición del coro (MISMA letra exacta — no improvisar nuevo coro).
- [Puente]: Giro emocional. Lo más vulnerable o intenso de toda la canción.
${habladoLine}
- [Coro Final]: Cierre con impacto. Misma fórmula A-A'-B-A. Puede tener una variación sutil en la línea 3 (B).
- [Outro]: Cierre instrumental. NO escribir letra — solo poner "[Outro]" para que Mureka añada un cierre musical.
${preCoroDesc}`;
  }

  // All other genres: standard structure with Intro and Outro
  return `- [Intro]: Apertura instrumental. NO escribir letra — solo poner "[Intro]" para que Mureka cree una entrada musical.
- [Verso 1]: Presenta la historia. Contexto, escena, quién eres y qué sientes.
${preCoroSlot}- [Coro]: GANCHO emocional. Corto (4 líneas), memorable, repetible. Sigue la fórmula A-A'-B-A (línea 1 = gancho, línea 2 = variación, línea 3 = contraste, línea 4 = repetir gancho idéntico).
- [Verso 2]: Profundiza con detalles específicos. Momentos concretos, recuerdos.
${preCoroSlot}- [Coro]: Repetición del coro (MISMA letra exacta — no improvisar nuevo coro).
- [Puente]: Giro emocional. Lo más vulnerable o intenso de toda la canción.
- [Coro Final]: Cierre con impacto. Misma fórmula A-A'-B-A. Puede tener una variación sutil en la línea 3 (B).
- [Outro]: Cierre instrumental. NO escribir letra — solo poner "[Outro]" para que Mureka añada un cierre musical.
${preCoroDesc}`;
})()}

Cuando termines, llama a la herramienta submit_song_lyrics con la letra completa y los emotionalModifiers en inglés. Recuerda todas las reglas del sistema (composición, nombres de artistas, compatibilidad de modifiers con el género).`;

    // ==========================================================================
    // STEP 2 (lyrics): either pass the customer's own lyrics through verbatim,
    // or have Claude compose them. Declared as `let` because both branches
    // assign them; everything downstream (DB insert, provider call) is identical.
    // ==========================================================================
    let lyrics: string;
    let emotionalModifiers: string;

    if (wantsCustomLyrics) {
      // CUSTOMER-SUPPLIED LYRICS — sung with their exact words. No Claude call.
      // Light auto-clean only: strip real artist names (Suno/Mureka reject them
      // outright) and enforce the same hard length cap the provider payloads use.
      // We deliberately do NOT run stripSpokenProsodyCue here — that helper also
      // removes lowercase [bracketed] text, which would silently delete a
      // customer's own legitimate bracketed words. Verbatim means verbatim.
      lyrics = sanitizeArtistNames(customLyrics).trim().substring(0, 4000);
      emotionalModifiers = '';
      console.log(`Using customer-supplied lyrics verbatim (${lyrics.length} chars) — Claude skipped`);
    } else {
    console.log('Calling Claude (structured tool output)...');

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
    let toolUseBlock: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // After all Sonnet retries fail, fall back to Haiku on last attempt
      const model = attempt === maxRetries ? claudeModels[1] : claudeModels[0];

      // STRUCTURED OUTPUT via tool use.
      //   - `system` is an array so we can attach cache_control to the static
      //     rules block. Subsequent requests with the same system prompt read
      //     it from cache at ~10% of normal input cost (5-min TTL).
      //   - `tools` declares the single submit_song_lyrics tool, whose schema
      //     defines the required lyrics + emotionalModifiers fields.
      //   - `tool_choice: {type: "tool", name: ...}` FORCES Claude to call the
      //     tool. The API itself validates the input against the schema — we
      //     do not need to parse a JSON string on our side, so the previous
      //     class of failure (malformed \y / illegal JSON escapes) is impossible
      //     by construction.
      claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: claudeHeaders,
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          system: [
            { type: 'text', text: LYRICS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
          ],
          tools: [LYRICS_TOOL],
          tool_choice: { type: 'tool', name: 'submit_song_lyrics' },
          messages: [{ role: 'user', content: claudeUserMessage }]
        }),
      });

      claudeData = await claudeResponse.json();

      if (claudeResponse.ok && Array.isArray(claudeData.content)) {
        // Find the tool_use block. With tool_choice forcing submit_song_lyrics,
        // a successful 200 response is guaranteed to contain one. Defensive
        // check anyway — never trust a single field.
        const found = claudeData.content.find(
          (b: any) => b && b.type === 'tool_use' && b.name === 'submit_song_lyrics'
        );
        if (
          found &&
          typeof found.input?.lyrics === 'string' &&
          found.input.lyrics.trim() &&
          typeof found.input?.emotionalModifiers === 'string'
        ) {
          toolUseBlock = found;
          modelUsedForLyrics = model;
          if (attempt > 1) console.log(`Claude succeeded on attempt ${attempt} with ${model}`);
          // Cache telemetry — confirms the system prompt is being reused.
          // First request will show creation tokens; subsequent within TTL will show reads.
          if (claudeData.usage) {
            console.log(
              `Claude usage: input=${claudeData.usage.input_tokens} ` +
              `cache_write=${claudeData.usage.cache_creation_input_tokens ?? 0} ` +
              `cache_read=${claudeData.usage.cache_read_input_tokens ?? 0} ` +
              `output=${claudeData.usage.output_tokens}`
            );
          }
          break;
        }
        // 200 OK but no usable tool_use block — log and fall through to retry/fail.
        console.warn(
          `Claude returned 200 but no valid tool_use block on attempt ${attempt}. ` +
          `stop_reason=${claudeData.stop_reason} content_types=${claudeData.content.map((b: any) => b?.type).join(',')}`
        );
      }

      const isOverloaded = claudeData?.error?.type === 'overloaded_error' || claudeResponse.status === 529;
      if (isOverloaded && attempt < maxRetries) {
        const delay = attempt * 5000; // 5s, 10s
        console.warn(`Claude overloaded (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (attempt === maxRetries) {
        // No usable tool_use block after all retries (including Haiku fallback).
        // Fail loudly — outer catch returns 500, no DB row is created, customer
        // is not charged.
        throw new Error(
          'LYRICS_TOOL_CALL_FAILED: Claude did not return valid structured lyrics after all retries. ' +
          'Response: ' + JSON.stringify(claudeData).slice(0, 500)
        );
      }
    }

    console.log(`Lyrics generated with ${modelUsedForLyrics}`);

    // Tool input has been schema-validated by the Anthropic API. No parsing
    // on our side, no possibility of malformed JSON leaking through.
    // Strip the inline English prosody cue (e.g. "(spoken, no melody, …)") the
    // genre prompts inject on [Hablado] lines — the music models sing it aloud
    // (most audibly at the start of corridos) and we also display these lyrics
    // to the customer, so clean it before storing or sending to any provider.
    lyrics = stripSpokenProsodyCue(toolUseBlock.input.lyrics);
    emotionalModifiers = toolUseBlock.input.emotionalModifiers || '';
    } // end Claude lyrics branch

    console.log('✓ Lyrics extracted from tool_use block');
    console.log('Emotional modifiers:', emotionalModifiers);

    // ==========================================================================
    // STEP 3: Combine DNA style + emotional modifiers
    // ==========================================================================
    let finalStyle = stylePrompt;
    if (emotionalModifiers) {
      finalStyle = `${stylePrompt}, ${emotionalModifiers}`;
    }
    // Prime Mureka for a spoken-word interlude BEFORE it sees the lyrics. Putting
    // the cue in `desc` (not the lyric body) lets the vocal model expect the
    // sung→spoken→sung transition WITHOUT any English leaking into the vocal.
    // This and the English [Spoken Word] marker are the two signals that switch
    // vocal modes; the old inline "(spoken, no melody, …)" hint was removed
    // because the models sang it aloud (see stripSpokenProsodyCue).
    if (hasSpokenWord) {
      finalStyle = `${finalStyle}, includes brief spoken-word dedication interlude with non-sung intimate vocal delivery`;
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
      // Immutable record of exactly what the customer typed in "write my own
      // lyrics" mode + a flag for which input path they used. Lets us later
      // compare "what they submitted" vs "what was produced" with certainty.
      submitted_lyrics: wantsCustomLyrics ? customLyrics : null,
      used_custom_lyrics: wantsCustomLyrics,
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
      genre,
      subGenre,
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
      // Same immutable submission record as the v1 insert.
      submitted_lyrics: wantsCustomLyrics ? customLyrics : null,
      used_custom_lyrics: wantsCustomLyrics,
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
