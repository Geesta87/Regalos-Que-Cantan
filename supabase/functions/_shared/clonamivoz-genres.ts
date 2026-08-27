// _shared/clonamivoz-genres.ts
// ---------------------------------------------------------------------------
// THE single source of truth for the Clone Mi Voz genre catalog.
//
// Before 2026-08-27 the catalog lived in THREE hand-synced copies
// (generate-cloned-voice-song, generate-cloned-voice-preview, and a partial
// one in generate-cloned-voice-lyrics) plus the frontend list. That drift is
// exactly how the four English genres shipped with NO lyric hints — the
// lyrics function fell back to using the raw slug as the style description.
// All three edge functions now import from here.
//
// The FRONTEND list (src/components/clonamivoz/genres.js) cannot import this
// Deno module — when you add a genre here, add it there too (same slug), or
// customers will never see it. The reverse is enforced: a frontend slug
// missing here is rejected by the generation functions with invalid_genre.
//
// CLONE-MI-VOZ ONLY — do NOT use this in the main $29.99 funnel; that one
// has its own much deeper Genre DNA in generate-song/index.ts.
//
// Two datasets per genre:
//
//   style / negativeTags  → sent to Suno (Kie) at generation time.
//     Styles are INSTRUMENTATION-ONLY on purpose: vocal-style directives
//     ("voz natural", "vibrato dramático") FIGHT the cloned voice — Suno
//     tries to overlay that vocal style on top of the customer's actual
//     delivery, drowning their character out. The cloned voice itself
//     provides the vocal style. Never add vocal descriptors here.
//
//   lyricHints            → fed to Claude by generate-cloned-voice-lyrics
//     to set the TONE of the lyrics (never the sound — Suno handles sound).
//
// Kie hard limits (validated in production):
//   - style: 1000 chars max. Exceeding returns HTTP 200 with a failure msg
//     and the generation never starts. assertStyleLengths() guards this at
//     module load in every importer.
//   - negativeTags: 200 chars max, capped at request time by the callers
//     (clone-protection tags first, genre tags truncated at a comma).
// ---------------------------------------------------------------------------

export interface GenreStyle {
  style: string;
  negativeTags: string;
}

export interface LyricHints {
  displayName: string;
  baseStyle: string;
  tempo: string;
  instruments: string;
  vibe: string;
  emotionalDirection: string;
}

export interface ClonamivozGenre extends GenreStyle {
  /** 'es' | 'en' — which recording script / UI language the genre implies. */
  language: 'es' | 'en';
  lyricHints: LyricHints;
}

export const CLONAMIVOZ_GENRES: Record<string, ClonamivozGenre> = {
  // ======================= Spanish-language genres =======================

  romantico: {
    language: 'es',
    style:
      'intimate romantic Latin ballad, acoustic-forward dedication song, wedding-ceremony quality, candlelit intimacy, vocal-forward. ' +
      'Instruments: nylon acoustic guitar primary with fingerpicked arpeggios, soft grand piano with sustained voicings, gentle string quartet pads, minimal or no percussion in verses, upright bass sustained whole notes, optional flute or oboe answering melody in breaks. ' +
      'Tempo: 65-85 BPM intimate ballad pace, breathing room between phrases, heartbeat rhythm. ' +
      'Vibe: deep romantic confession, eternal love vow, proposal moment warmth, wedding first dance, forever love. ' +
      'Mix: clean modern production, vocal-forward, warm acoustic presence, subtle tasteful reverb.',
    negativeTags:
      'party music, fast dance, aggressive sounds, electronic production, brass-heavy banda, trap beats, 808 bass, EDM, rock distortion, reggaeton, uptempo',
    lyricHints: {
      displayName: 'Romántica',
      baseStyle: 'balada romántica latina suave con guitarra acústica, mid-tempo emocional',
      tempo: '70-90 BPM, ritmo tierno, espacio para respirar entre frases',
      instruments: 'guitarra acústica fingerpicking, piano suave, cuerdas tenues, percusión mínima',
      vibe: 'declaración tierna, momento íntimo, dos personas en su mundo, vela y café',
      emotionalDirection: 'tender intimacy, warm embrace, gentle devotion',
    },
  },

  balada: {
    language: 'es',
    style:
      'classic orchestral Latin ballad, grand 1970s-80s ballad en español, dramatic crooner-style Latin ballad with cinematic orchestra, telenovela-climax cinematic love song. ' +
      'Instruments: full string orchestra with sweeping legato as central emotional engine, grand piano with sustained voicings and arpeggiated fills, soft timpani at dramatic transitions, harp arpeggios on choruses, french horn warmth, flute or oboe answering melodies, brushed drums on later choruses, full orchestral crescendo into final chorus. ' +
      'Tempo: 60-80 BPM very slow, dramatic pauses, rubato phrasing, grand theatrical pacing. ' +
      'Vibe: grand romantic gestures, theatrical tearjerker, telenovela climax, standing ovation, golden-age Latin drama. ' +
      'Mix: cinematic orchestral production, wide stereo strings, vocal centered, lush concert-hall reverb.',
    negativeTags:
      'fast rhythms, electronic beats, rock guitars, trap, party music, uptempo dance, modern urban, lo-fi, hip-hop, EDM, reggaeton, banda brass, mariachi instrumentation',
    lyricHints: {
      displayName: 'Balada',
      baseStyle: 'balada latina clásica con piano y cuerdas, soft modern Latin ballad, polished studio production',
      tempo: '65-85 BPM, lento emocional, frases con respiro, pacing dramático',
      instruments: 'piano grande, cuerdas orquestales, guitarra acústica fingerpicking, percusión cepillada, bajo sostenido',
      vibe: 'balada elegante, dedicación lacrimógena, telenovela climax, momentos de pareja',
      emotionalDirection: 'aching devotion, polished heartfelt emotion, theatrical tenderness',
    },
  },

  banda: {
    language: 'es',
    style:
      'classic banda sinaloense, traditional Sinaloa brass band, authentic 15-piece banda, ceremonial Mexican banda, golden-age recording quality, banda for romantic dedication. ' +
      'Instruments: full 15+ piece brass — trumpet section playing fanfare lines and harmonized melodies, trombone section providing midrange counter-lines, clarinet section playing high ornamental runs, sousaphone or tuba driving oom-pah quarter-note bass pulse, tarola snare backbeat with rolls into choruses, tambora rhythmic foundation. ' +
      'Tempo: 90-110 BPM moderate, 2/4 polka-derived feel, festive but not breakneck. ' +
      'Vibe: authentic Sinaloa pride, timeless festive elegance, classic polish, Mexican brass band heritage, plaza fiesta. ' +
      'Mix: live-band brass presence, midrange-forward, audible tuba on every quarter, tarola crisp, vocal cleanly above brass.',
    negativeTags:
      'lo-fi production, trap beats, 808 bass, electronic sounds, rock guitars, modern urban beats, slow ballads only, quebradita pace, sad sierreño, corridos tumbados, EDM, synth pads, autotune',
    lyricHints: {
      displayName: 'Banda',
      baseStyle: 'banda sinaloense con sección completa de metales, ritmo festivo, alegre y poderoso',
      tempo: '90-110 BPM, ritmo festivo, energía celebratoria',
      instruments: 'trompetas, trombones, clarinetes, tuba/sousaphone, tambora, tarola, percusión completa',
      vibe: 'fiesta, celebración grande, energía de estadio, orgullo Sinaloense',
      emotionalDirection: 'euphoric celebration, proud devotion, festive tribute',
    },
  },

  corrido: {
    language: 'es',
    style:
      'authentic 1990s Sinaloa corrido, pure rural rancho corrido from Sierra de Sinaloa, narrative balladeer storytelling, accordion-and-bajo-sexto with slapped tololoche oom-pah, cassette direct-to-tape aesthetic. ' +
      'Instruments: diatonic 3-row button accordion as sole melodic lead with TREBLY reedy midrange timbre, accordion fills with grace notes and scalar runs, bajo sexto 12-string percussive downstrokes on roots and fifths, TOLOLOCHE upright bass with prominent SLAP technique driving the oom-pah pattern, optional requinto sierreño for ornaments, sparse or no drums. ' +
      'Tempo: 85-105 BPM deliberate storytelling pace, 2/4 polka pulse with tololoche slap, never rushed. ' +
      'Vibe: rural Sinaloa rancho 1990s, Culiacán cantina midnight, weathered balladeer, bone-dry vintage mix, raw 90s production. ' +
      'Mix: dry mic placement, mono or narrow stereo, present accordion midrange, audible tololoche slap, no doubling, no compression pumping.',
    negativeTags:
      'modern 2010s 2020s corrido production, slick radio polish, full drum kit, snare-heavy modern kit, electric bass guitar, saxophone, brass section, trumpets, full banda brass, mariachi violins, strings, trap beats, 808 bass, autotune, heavy reverb, vocal doubling, corridos tumbados, corridos alterados, sierreño melancholy, synthesizers, cumbia, EDM',
    lyricHints: {
      displayName: 'Corrido',
      baseStyle: 'corrido mexicano tradicional con acordeón y bajo sexto, narrativo, ritmo norteño',
      tempo: '90-110 BPM, paso de balada narrativa, deliberado, espacio para cada palabra',
      instruments: 'acordeón diatónico, bajo sexto doce cuerdas, tololoche, percusión polka',
      vibe: 'narrativa storytelling, autoridad balada, orgullo rural, autenticidad fronteriza',
      emotionalDirection: 'proud narrative weight, fierce devotion, weathered respect',
    },
  },

  ranchera: {
    language: 'es',
    style:
      'slow dramatic ranchera ballad, emotional Mexican ranchera, golden-age ranchera tradition, mariachi-backed serenata ranchera for romantic dedication, theatrical sustained instrumental phrasing. ' +
      'Instruments: mariachi violin section with sustained emotional legato bowing, trumpet fanfare between verses then soft sustained notes during vocal lines, vihuela gentle strumming, guitarrón deep bass on beats 1 and 3, classical guitar arpeggios, optional harp arpeggios on choruses. ' +
      'Tempo: 50-70 BPM very slow, dramatic pauses, rubato phrasing, ballad with generous breathing room. ' +
      'Vibe: deep sorrow or deep love, dramatic heartbreak, crying-in-your-drink cantina emotion, tearful dedication, tequila and tears, mariachi at 3am. ' +
      'Mix: live mariachi room sound, violins front and center, guitarrón warm in low end, vocal up-front and clear.',
    negativeTags:
      'upbeat rhythms, electronic beats, happy party vibes, trap, fast tempo, dance energy, modern urban, rock, EDM, banda brass dominance, autotune, hip-hop, reggaeton, synth pads',
    lyricHints: {
      displayName: 'Ranchera',
      baseStyle: 'ranchera mexicana tradicional con mariachi, drama emocional profundo',
      tempo: '80-110 BPM, ritmo de vals o marcha 3/4 o 2/4, pacing dramático',
      instruments: 'mariachi ensemble, sección de violines, trompetas, vihuela, guitarrón, guitarra clásica',
      vibe: 'drama emocional mexicano, grito desde el alma, orgullo nacional, cantina',
      emotionalDirection: 'fierce pride, theatrical heartbreak, defiant devotion',
    },
  },

  mariachi: {
    language: 'es',
    style:
      'romantic mariachi ballad, serenata mariachi, soft tender mariachi love song, moonlit serenade, violin-led romantic mariachi, intimate courtship mariachi, classic Mexican romantic mariachi. ' +
      'Instruments: violin section prominent with sustained legato bowing and vibrato carrying melodic answers to vocal phrases, soft muted trumpets playing gentle sustained notes (never blaring fanfares), delicate guitarrón bass on roots and fifths, vihuela soft arpeggios, classical guitar fingerpicking, optional cello sustained warmth. ' +
      'Tempo: 60-80 BPM slow tender pace, breathing room between phrases, serenata tempo. ' +
      'Vibe: serenata under the balcony, moonlit courtship, deep vulnerable romance, tearful dedications, wedding first dance, proposal moment, roses and candles. ' +
      'Mix: warm ensemble live-feel room sound, violins front-of-stage, vocal up-front and intimate, gentle small-venue reverb.',
    negativeTags:
      'fast dance, brass-heavy banda, aggressive sounds, uptempo party, electronic production, trap, rock, EDM, quebradita pace, hip-hop, autotune, modern urban beats, K-pop',
    lyricHints: {
      displayName: 'Mariachi',
      baseStyle: 'mariachi tradicional mexicano con trompetas, violines, guitarrón y vihuela, romántico cálido',
      tempo: '85-120 BPM, son rhythm, alternando waltz y march, tempo clásico variable',
      instruments: 'violines en sección, dos trompetas con fanfarrias, vihuela, guitarrón, guitarra clásica, opcional arpa',
      vibe: 'orgullo mexicano, ceremonia elegante, plaza Garibaldi, tradición timeless',
      emotionalDirection: 'ceremonial pride, formal warmth, vibrato-rich tribute',
    },
  },

  // ---- Added 2026-08-27 (audit: catalog was missing the genres customers
  // ---- actually buy in the main funnel — cumbia, norteño, bolero, cristiana)

  cumbia: {
    language: 'es',
    style:
      'festive romantic Mexican cumbia, classic 90s cumbia grupera for a heartfelt dedication, danceable tropical cumbia with warm nostalgic glow, family-party cumbia. ' +
      'Instruments: güiro steady scrape driving the groove, congas and timbales tropical percussion, warm electric bass tumbao, bright keyboard cumbia hooks answering the vocal phrases, rhythm guitar upstrokes on the offbeat, optional accordion melody fills between lines, light brass accents on choruses. ' +
      'Tempo: 95-110 BPM steady cumbia groove, hip-swaying dance pulse, festive but never rushed. ' +
      'Vibe: family party dance floor, birthday and Mother\'s Day celebration, 90s cumbia nostalgia, joyful dedication everyone dances to, colorful fiesta warmth. ' +
      'Mix: clean warm production, percussion crisp, keyboard hooks bright, vocal clearly above the groove.',
    negativeTags:
      'heavy metal, rock distortion, trap beats, 808 bass, EDM drops, reggaeton dembow, banda brass wall, corridos, dark aggressive, slow sad ballad, mariachi violins, dubstep',
    lyricHints: {
      displayName: 'Cumbia',
      baseStyle: 'cumbia mexicana festiva y romántica, cumbia grupera noventera, tropical bailable',
      tempo: '95-110 BPM, groove constante de cumbia, ritmo para bailar',
      instruments: 'güiro, congas, timbales, bajo tumbao, teclados brillantes, guitarra rítmica',
      vibe: 'fiesta familiar, pista de baile, celebración de cumpleaños, nostalgia noventera, alegría que contagia',
      emotionalDirection: 'euphoric celebration, infectious joy, vibrant tribute',
    },
  },

  norteno: {
    language: 'es',
    style:
      'romantic norteño ballad, tender accordion-driven northern Mexican love song, classic conjunto norteño dedication, soft Tex-Mex conjunto romance, slow-dance norteño. ' +
      'Instruments: diatonic three-row button accordion with sustained emotional notes and soft bellows dynamics carrying melodic answers between vocal lines, bajo sexto twelve-string gentle arpeggios and soft downstrokes, warm electric bass on a relaxed two-step pulse, soft brushed drums with rim-shot snare, NO saxophone, NO brass. ' +
      'Tempo: 85-100 BPM gentle two-step sway, tender ballad pace, slow-dance groove with room for every word. ' +
      'Vibe: heartfelt cantina dedication, slow dancing in the kitchen, wedding first dance norteño, moonlit serenade with accordion, working-class northern Mexican warmth and sincerity. ' +
      'Mix: live conjunto room feel, accordion present and warm, vocal up-front, clean and intimate.',
    negativeTags:
      'cumbia, sonidera, güiro, saxophone, banda brass section, trumpets, corridos tumbados, trap beats, 808 bass, EDM, reggaeton, heavy metal, fast quebradita, party anthem, synthesizers',
    lyricHints: {
      displayName: 'Norteño',
      baseStyle: 'norteño romántico con acordeón y bajo sexto, balada de conjunto norteño, tierno y sincero',
      tempo: '85-100 BPM, two-step suave, paso de balada tierna',
      instruments: 'acordeón de botones, bajo sexto, bajo eléctrico, batería cepillada suave',
      vibe: 'dedicación de corazón, baile pegadito, calidez del norte, sinceridad de rancho',
      emotionalDirection: 'tender sincerity, heartfelt warmth, devoted northern pride',
    },
  },

  bolero: {
    language: 'es',
    style:
      'classic romantic bolero, 1950s trio bolero, timeless Latin American bolero serenade, intimate candlelit bolero dedication, golden-age romantic trio. ' +
      'Instruments: requinto guitar lead with ornate melodic runs and arpeggiated introductions, two rhythm guitars with soft syncopated bolero strumming, muted bongos and soft maracas keeping the classic bolero pulse, upright bass warm and round on root notes, optional soft string swells on the final chorus. ' +
      'Tempo: 55-75 BPM very slow and intimate, unhurried romantic phrasing, generous pauses between phrases. ' +
      'Vibe: old-school elegance, love letters and black-and-white photographs, anniversary dance, timeless devotion, moonlit patio serenade, romance of another era. ' +
      'Mix: vintage warm analog character, requinto front and center, close intimate vocal, gentle room reverb, no modern sheen.',
    negativeTags:
      'modern production, electronic, synthesizers, trap, 808 bass, EDM, rock distortion, fast rhythms, reggaeton, banda brass, accordion, aggressive drums, autotune, loud',
    lyricHints: {
      displayName: 'Bolero',
      baseStyle: 'bolero clásico de trío con requinto, romance de época dorada, serenata íntima',
      tempo: '55-75 BPM, MUY lento e íntimo, frases sin prisa con pausas generosas',
      instruments: 'requinto, dos guitarras rítmicas, bongós suaves, maracas, contrabajo',
      vibe: 'elegancia de otra época, cartas de amor, aniversario, devoción eterna, patio a la luz de la luna',
      emotionalDirection: 'timeless devotion, vintage elegance, aching tenderness',
    },
  },

  cristiana: {
    language: 'es',
    style:
      'Spanish-language Christian worship ballad, intimate adoración cristiana, heartfelt praise ballad of gratitude, tender devotional dedication song, contemporary Christian ballad en español. ' +
      'Instruments: soft grand piano leading the harmony with sustained voicings, fingerpicked acoustic guitar, warm string pad and gentle cello swells, subtle brushed drums entering on the second chorus, bass guitar sustained roots, ambient electric-guitar swells with reverb on the climax, optional soft choir harmonies on the final chorus. ' +
      'Tempo: 65-85 BPM slow reverent pace, prayerful breathing room, dynamic build from quiet verse to soaring final chorus. ' +
      'Vibe: gratitude and faith, answered prayers, blessing over a loved one, chapel warmth, hands lifted, tears of thankfulness, family faith heritage. ' +
      'Mix: clean modern worship production, piano and vocal forward, wide warm pads, tasteful reverb.',
    negativeTags:
      'secular party themes, reggaeton dembow, trap, 808 bass, EDM drops, heavy metal, accordion, mariachi trumpets, banda brass, dark aggressive, cumbia',
    lyricHints: {
      displayName: 'Cristiana',
      baseStyle: 'balada cristiana de adoración en español, alabanza íntima de gratitud, worship contemporáneo',
      tempo: '65-85 BPM, lento y reverente, respiro de oración, crescendo al coro final',
      instruments: 'piano de cola suave, guitarra acústica fingerpicking, pads de cuerdas, chelo, batería cepillada sutil',
      vibe: 'gratitud y fe, oración contestada, bendición sobre un ser querido, calidez de capilla, lágrimas de agradecimiento',
      emotionalDirection: 'grateful reverence, faithful devotion, tearful thanksgiving',
    },
  },

  // ======================= English-language genres =======================

  pop_ballad_en: {
    language: 'en',
    style:
      'modern English pop ballad, contemporary radio-ready pop ballad, intimate emotional pop ballad in the style of Ed Sheeran, Sam Smith, Lewis Capaldi, Adele ballads, piano-driven, vocal-forward dedication. ' +
      'Instruments: grand piano as primary harmonic engine with sustained voicings and arpeggiated fills, soft fingerpicked acoustic guitar doubling the piano, lush string pad swells building on each chorus, gentle programmed kick on backbeat or no drums in verses, subtle bass holding root notes, optional cello warmth in low-mid, light reverb-tail effects. ' +
      'Tempo: 70-90 BPM modern emotional ballad pace, breathing room between phrases. ' +
      'Vibe: intimate dedication, wedding first dance, gut-punch emotional climax, candlelit confession, modern Spotify-playlist heartfelt. ' +
      'Mix: clean modern studio production, vocal-forward, wide stereo strings on chorus, tight tasteful reverb.',
    negativeTags:
      'trap beats, 808 bass, autotune-heavy, EDM drops, fast dance, aggressive rock distortion, dubstep, hip-hop production, mariachi, banda brass, country pedal steel, reggaeton',
    lyricHints: {
      displayName: 'Pop Ballad',
      baseStyle: 'modern emotional pop ballad, piano-driven, radio-ready and heartfelt',
      tempo: '70-90 BPM, modern ballad pace, room to breathe between phrases',
      instruments: 'grand piano, fingerpicked acoustic guitar, string swells, soft programmed drums',
      vibe: 'intimate dedication, wedding first dance, candlelit confession, modern heartfelt',
      emotionalDirection: 'tender intimacy, soaring emotional climax, honest devotion',
    },
  },

  country_en: {
    language: 'en',
    style:
      'modern country ballad, contemporary Nashville country dedication in the style of Luke Combs, Chris Stapleton, Tim McGraw, Lady A ballads, heartfelt country love ballad, acoustic-forward with pedal steel, Americana-leaning radio country. ' +
      'Instruments: fingerpicked acoustic guitar primary as rhythmic foundation, pedal steel with sustained crying bends carrying emotional answers, gentle brushed snare on backbeat and warm kick, warm fretless or upright bass walking lines, optional fiddle answering melody in breaks, harmonica on bridges, dobro slide guitar under vocal. ' +
      'Tempo: 75-95 BPM modern country mid-tempo ballad pace. ' +
      'Vibe: heartfelt small-town love story, front porch confession, wedding song, dirt road dedication, country radio heartfelt, faith and family warmth. ' +
      'Mix: clean Nashville studio sheen, warm midrange, vocal up-front, pedal steel just behind vocal, tasteful room reverb.',
    negativeTags:
      'trap beats, 808 bass, EDM, autotune-heavy, mariachi, banda brass, reggaeton, dubstep, hip-hop, electronic dance, K-pop, heavy rock distortion, synthwave',
    lyricHints: {
      displayName: 'Country',
      baseStyle: 'modern Nashville country ballad, heartfelt storytelling, acoustic-forward with pedal steel',
      tempo: '75-95 BPM, mid-tempo country ballad',
      instruments: 'acoustic guitar, pedal steel, brushed drums, upright bass, fiddle, dobro',
      vibe: 'small-town love story, front porch confession, dirt roads and family, faith and gratitude',
      emotionalDirection: 'heartfelt sincerity, rooted devotion, warm nostalgia',
    },
  },

  rnb_soul_en: {
    language: 'en',
    style:
      'smooth modern R&B soul ballad, contemporary slow-jam R&B in the style of John Legend, H.E.R., Daniel Caesar, Anderson .Paak ballads, neo-soul love dedication, warm soulful R&B. ' +
      'Instruments: warm Rhodes electric piano with sustained voicings and subtle tremolo, soft groove drums with brushed-feel kick and snare and tasteful hi-hat shuffle, melodic fingered bass with sliding fills and walking turnarounds, subtle horn pads sustained beneath rhythm section, occasional Rhodes lead fills between vocal phrases, gentle clean electric guitar single-note licks, optional muted trumpet accent. ' +
      'Tempo: 70-90 BPM slow-jam R&B pace, sensual groove. ' +
      'Vibe: candlelit intimate confession, slow-dance soul, neo-soul warmth, late-night dedication, sensual heartfelt R&B groove. ' +
      'Mix: warm analog-leaning production, vocal-forward, lush low-mid presence on Rhodes, tasteful pocket groove.',
    negativeTags:
      'trap beats, mariachi, banda brass, country fiddle, country pedal steel, hardcore hip-hop, autotune-heavy, EDM, dubstep, rock distortion, fast dance, K-pop, reggaeton, heavy 808',
    lyricHints: {
      displayName: 'R&B / Soul',
      baseStyle: 'smooth modern R&B slow jam, neo-soul love dedication, warm and groovy',
      tempo: '70-90 BPM, slow-jam groove, sensual pocket',
      instruments: 'Rhodes electric piano, soft groove drums, melodic bass, horn pads, clean guitar licks',
      vibe: 'candlelit confession, slow dance, late-night warmth, soulful intimacy',
      emotionalDirection: 'sensual warmth, soulful sincerity, intimate devotion',
    },
  },

  acoustic_singer_en: {
    language: 'en',
    style:
      'intimate acoustic singer-songwriter ballad, sparse minimal solo acoustic dedication, raw honest acoustic confession ballad, vocal-forward acoustic ballad in the style of Phoebe Bridgers, Ben Howard, Damien Rice, Bon Iver acoustic moments. ' +
      'Instruments: single fingerpicked acoustic guitar as primary and often only instrument, optional light brushed snare (no full drum kit), no drums in verses, subtle upright bass sustained notes, optional cello sustained warmth or single sustained violin pad, room ambience and natural microphone bleed. ' +
      'Tempo: 65-85 BPM intimate confessional pace, generous breathing room between phrases. ' +
      'Vibe: stripped-down emotional confession, candlelit dedication, intimate room recording, raw honest vulnerability, modern indie folk warmth, wedding ceremony acoustic. ' +
      'Mix: dry acoustic intimacy, vocal up-front and very present, minimal reverb (just natural room), close and intimate.',
    negativeTags:
      'trap, EDM, banda brass, mariachi, full band production, heavy drums, dance beats, autotune, electronic, K-pop, hip-hop, reggaeton, rock distortion, dubstep, heavy 808',
    lyricHints: {
      displayName: 'Acoustic Singer-Songwriter',
      baseStyle: 'sparse intimate acoustic ballad, raw and honest, vocal and guitar forward',
      tempo: '65-85 BPM, confessional pace, generous space between phrases',
      instruments: 'single fingerpicked acoustic guitar, subtle upright bass, optional cello',
      vibe: 'stripped-down confession, candlelit intimacy, raw vulnerability, indie folk warmth',
      emotionalDirection: 'raw honesty, quiet vulnerability, aching tenderness',
    },
  },
};

// Kie enforces a HARD 1000-char cap on the style field. Going over returns
// HTTP 200 with a failure message and the generation never starts. Every
// importer calls this at module load — better to log loudly at deploy than
// ship a busted prompt.
export const KIE_STYLE_MAX = 1000;
export function assertStyleLengths(tag: string): void {
  for (const [slug, g] of Object.entries(CLONAMIVOZ_GENRES)) {
    if (g.style.length > KIE_STYLE_MAX) {
      console.error(
        `[${tag}] FATAL: genre "${slug}" style is ${g.style.length} chars, exceeds Kie cap of ${KIE_STYLE_MAX}`
      );
    }
  }
}

/** Slug list for error messages. */
export function validGenreSlugs(): string[] {
  return Object.keys(CLONAMIVOZ_GENRES);
}

// ---------------------------------------------------------------------------
// Expressiveness + per-song emotion (2026-08-27, owner feedback: cloned
// songs came out MONOTONE).
//
// The instrumentation-only rule above bans TIMBRE directives ("voz cálida",
// "vibrato dramático") because they fight the cloned voice's character. But
// PERFORMANCE-DYNAMICS direction — melody movement, pitch range, phrasing —
// targets what the melody does, not what the voice sounds like, and without
// it Suno leans on the (often flat) delivery of the customer's sample.
//
// Claude already writes per-song emotional modifiers at the lyrics step;
// they were stored but never sent to Suno. This helper appends the
// expressive-delivery cue plus those modifiers, truncating at a comma
// boundary to respect Kie's 1000-char style cap (base style always wins,
// then the expressive cue, then the modifiers).
// ---------------------------------------------------------------------------
const EXPRESSIVE_VOCAL_CUE =
  'expressive melodic vocal delivery, wide pitch range, dynamic emotional phrasing';

export function applyEmotionToStyle(style: string, emotionalModifiers?: string | null): string {
  const parts = [style, EXPRESSIVE_VOCAL_CUE];
  const mods = (emotionalModifiers || '').trim();
  if (mods) parts.push(mods);
  const combined = parts.join(', ');
  if (combined.length <= KIE_STYLE_MAX) return combined;
  const truncated = combined.slice(0, KIE_STYLE_MAX);
  const lastComma = truncated.lastIndexOf(',');
  // Never truncate into the base style itself — it is always < the cap.
  const safe = lastComma > style.length ? truncated.slice(0, lastComma) : style;
  return safe.trim();
}
