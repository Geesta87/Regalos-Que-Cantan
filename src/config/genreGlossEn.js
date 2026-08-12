// English glosses for the Spanish genre / sub-genre catalog — ADMIN UI ONLY.
//
// Why this exists: Ivan (assistant) operates the inbox and the "Make Song for
// Customer" modal but does not read Spanish. The customer-facing labels in
// `src/config/genres.js` stay exactly as they are — they're the real names of
// real genres and must never be translated in the funnel. This file is a
// reading aid layered on top of them in the admin dashboard so that picking a
// sub-genre is an informed choice and not a coin flip.
//
// The failure this prevents: `belico` (aggressive narco-adjacent corrido) vs
// `romantico` (a love dedication), or `quebradita` (fast party banda) vs
// `banda_90s` (fast rhythm but a LOVE lyric) are one dropdown row apart and
// produce completely different songs. Shipping the wrong one is a re-do.
//
// Keys: `<genreId>` for the genre line, `<genreId>.<subGenreId>` for a
// sub-genre. Anything missing falls back to the Spanish description — a gap is
// cosmetic, never a crash. Keep in sync when genres.js gains entries.

const genreGlossEn = {
  // ── Regional Mexicano ──────────────────────────────────────────────────
  corrido: 'Epic story-song, accordion + bajo sexto. Narrates someone\'s life.',
  'corrido.tradicional': 'Classic storytelling corrido. Safe default.',
  'corrido.tumbados': 'Modern trap-influenced, 808s + AutoTune. Young audience.',
  'corrido.romantico': 'Love dedication in corrido form. Sentimental, not tough.',
  'corrido.belico': 'Aggressive, heavy, tough-guy tone. NOT for a love gift.',
  'corrido.alterados': 'Fast and intense party-corrido. High energy, rowdy.',

  norteno: 'Accordion + bajo sexto, polka feel. Warm and traditional.',
  'norteno.tradicional': 'Classic northern polka. Upbeat, danceable, timeless.',
  'norteno.con_sax_romantico': 'Saxophone ballad. Elegant, slow, very romantic.',
  'norteno.con_sax_bailar': 'Saxophone polka built to dance to. Upbeat.',
  'norteno.nortena_banda': 'Norteño with brass horns added. Bigger, punchier.',
  'norteno.romantico': 'Soft northern ballad. Gentle love song.',

  banda: 'Big Sinaloa brass band — tubas and trumpets. Loud and celebratory.',
  'banda.romantica': 'Emotional brass ballad. The most-requested banda style.',
  'banda.banda_90s': 'Fast and danceable BUT with a love lyric. 90s throwback.',
  'banda.quebradita': 'Fast party dance banda. Fun, not romantic.',
  'banda.tecnobanda': 'Brass mixed with electronic keys. Retro-modern.',
  'banda.sinaloense_clasica': 'Traditional straight-ahead Sinaloa brass.',

  ranchera: 'The soul of Mexico, sung with mariachi. Proud and emotional.',
  'ranchera.lenta': 'Slow, heartfelt ranchera ballad. Tears-in-the-eyes style.',
  'ranchera.brava': 'Bold and joyful with shouts (gritos). Celebratory.',
  'ranchera.moderna': 'Contemporary young ranchera sound.',

  sierreno: 'Sparse acoustic mountain sound — guitar, bass, no drums.',
  'sierreno.tradicional': 'Raw and authentic acoustic. Very intimate.',
  'sierreno.moderno_sad': 'Melancholy modern acoustic. Heartbreak feel.',

  mariachi: 'Full mariachi — violins and trumpets. The classic Mexican gift.',
  'mariachi.tradicional': 'Classic formal mariachi. Weddings, serenades.',
  'mariachi.ranchero': 'Mariachi with a bolder, more emotional ranchera edge.',
  'mariachi.romantico': 'Soft romantic mariachi. Smooth, crooner-style.',
  'mariachi.moderno': 'Contemporary mariachi with a younger production.',

  duranguense: 'Fast keyboard-driven brass from Durango. Very danceable.',
  'duranguense.pasito': 'The fast signature dance style. Party energy.',
  'duranguense.romantico': 'Emotional duranguense ballad.',
  'duranguense.norteno_duranguense': 'Blend with accordion. Mid-tempo.',

  // ── Tropical / Caribbean ───────────────────────────────────────────────
  cumbia: 'Tropical danceable rhythm. Universally liked, works for parties.',
  'cumbia.sonidera': 'Mexican cumbia with dreamy keyboards. Nostalgic.',
  'cumbia.nortena': 'Cumbia played with accordion. Northern flavor.',
  'cumbia.texana': 'Tex-Mex cumbia. Selena-era sound.',
  'cumbia.grupera': 'Romantic cumbia with a soft group vocal.',
  'cumbia.romantica': 'Slow, emotional cumbia. For dedicating.',
  'cumbia.colombiana': 'Authentic Colombian cumbia. More folkloric.',

  salsa: 'Caribbean salsa — piano, congas, horns. Energetic.',
  'salsa.clasica_dura': 'Hard classic salsa. Aggressive horns, old-school.',
  'salsa.romantica': 'Smooth romantic salsa. Easier to listen to.',
  'salsa.urbana': 'Modern commercial salsa with current production.',

  bachata: 'Dominican romantic guitar rhythm. Sensual and very popular.',
  'bachata.tradicional': 'Authentic Dominican bachata. Guitar-forward.',
  'bachata.urbana_sensual': 'Modern sensual bachata. Radio sound.',
  'bachata.romantica': 'Emotional heartfelt bachata ballad.',

  merengue: 'Fast Dominican party rhythm. Pure celebration.',
  'merengue.clasico': 'Traditional merengue. Joyful and classy.',
  'merengue.mambo_merengue': 'Horn-driven, higher energy.',
  'merengue.urbano': 'Modern club merengue.',

  vallenato: 'Colombian folk with accordion. Storytelling and heartfelt.',
  'vallenato.tradicional': 'Authentic classic vallenato.',
  'vallenato.romantico': 'Emotional romantic vallenato.',
  'vallenato.moderno': 'Contemporary pop-leaning vallenato.',

  // ── Urbano / Modern ────────────────────────────────────────────────────
  reggaeton: 'Urban Latin with dembow beat. Young audience.',
  'reggaeton.clasico_perreo': 'Street/club reggaeton. Not for family gifts.',
  'reggaeton.romantico': 'Soft romantic reggaeton. Works as a love gift.',
  'reggaeton.comercial_pop': 'Clean radio-friendly pop reggaeton.',

  latin_trap: 'Spanish-language trap. Dark, modern, young.',
  'latin_trap.trap_pesado': 'Hard aggressive trap. Not for family gifts.',
  'latin_trap.trap_melodico': 'Melodic emotional trap. Sung more than rapped.',
  'latin_trap.trap_latino': 'Latin-flavored, sometimes bilingual trap.',

  pop_latino: 'Modern Spanish-language pop. Broadly safe and current.',
  'pop_latino.pop_balada': 'Emotional pop ballad. Very safe romantic choice.',
  'pop_latino.pop_bailable': 'Upbeat danceable pop.',
  'pop_latino.pop_urbano': 'Pop with a light urban beat.',

  // ── Baladas / Romantic ─────────────────────────────────────────────────
  romantica: 'Straight love songs. The single most-requested category.',
  'romantica.romantica_suave': 'Soft and tender. Intimate, gentle.',
  'romantica.romantica_apasionada': 'Intense, dramatic power ballad.',
  'romantica.romantica_alegre': 'Upbeat and happy love song. Celebratory.',
  'romantica.romantica_nostalgica': 'Melancholy, memories and longing.',
  'romantica.romantica_serenata': 'Serenade style — sung TO the person.',

  balada: 'Classic romantic ballad. Timeless, works for almost any age.',
  'balada.balada_clasica': 'Timeless old-school ballad. Great for parents.',
  'balada.balada_pop': 'Modern pop ballad. Younger feel.',
  'balada.balada_romantica': 'Intimate romantic ballad.',

  bolero: 'Classic Cuban-style romantic. Elegant, old-world, slow.',
  'bolero.bolero_clasico': 'Traditional trio bolero. Very nostalgic.',
  'bolero.bolero_ranchero': 'Mexican bolero with ranchera emotion.',
  'bolero.bolero_moderno': 'Contemporary polished bolero.',

  vals: 'Waltz. Used for quinceañeras and weddings — the father/daughter dance.',
  'vals.vals_mexicano': 'Traditional quinceañera waltz with orchestra.',
  'vals.vals_romantico': 'Soft waltz for weddings and anniversaries.',
  'vals.vals_moderno': 'Contemporary waltz with pop arrangement.',

  cristiana: 'Spanish Christian praise and worship. Faith-centered lyrics.',
  'cristiana.balada_intima': 'Slow intimate worship ballad.',
  'cristiana.alabanza_celebratoria': 'Joyful upbeat praise. Congregational.',
  'cristiana.adoracion_acustica': 'Acoustic guitar worship. Very personal.',
  'cristiana.worship_moderno': 'Modern worship band production.',

  // ── Rock ───────────────────────────────────────────────────────────────
  rock_espanol: 'Spanish-language rock with guitars. Gen-X favorite.',
  'rock_espanol.clasico': '80s-90s Latin rock sound.',
  'rock_espanol.balada_rock': 'Emotional rock power ballad.',
  'rock_espanol.alternativo': 'Indie / alternative Latin rock.',
  'rock_espanol.pop_rock': 'Radio-friendly pop rock.',
  'rock_espanol.romantico': 'Soft romantic rock for dedicating.',

  // ── Traditional / Folk ─────────────────────────────────────────────────
  grupera: 'Mexican 80s-90s group pop. Strong nostalgia for parents.',
  'grupera.grupera_clasica': 'Nostalgic classic grupera. Very sentimental.',
  'grupera.grupera_romantica': 'Romantic grupera ballad.',
  'grupera.grupera_bailable': 'Upbeat party grupera.',

  tejano: 'Tex-Mex from Texas. Strong with US-born Mexican-Americans.',
  'tejano.tejano_clasico': 'Traditional Tejano.',
  'tejano.tejano_romantico': 'Romantic Tejano ballad.',
  'tejano.tejano_cumbia': 'Tex-Mex cumbia. Danceable, Selena-style.',
};

// `genreId` or `genreId.subGenreId` → English gloss, or '' when not covered.
export function glossFor(genreId, subGenreId) {
  if (!genreId) return '';
  const key = subGenreId ? `${genreId}.${subGenreId}` : genreId;
  return genreGlossEn[key] || '';
}

export default genreGlossEn;
