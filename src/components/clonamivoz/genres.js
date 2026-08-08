// src/components/clonamivoz/genres.js
//
// Genre palette + recording-zone metadata + the 90-second reading scripts
// for the Clone Mi Voz tier (/clonamivoz).
//
// Bilingual: each genre has a `language` field ('es' or 'en') that drives
// which reading script + UI labels appear during recording. The lyric
// language is picked separately in StoryForm but defaults to the genre's
// language for sensible UX.
//
// Style strings live server-side in supabase/functions/generate-cloned-voice-song
// (GENRE_STYLES map) and generate-cloned-voice-preview. Any NEW slug added
// below must also be added there or generation will reject the request.

export const GENRES = [
  // ---------------- Spanish-language genres ----------------
  {
    slug: 'romantico',
    labelEs: 'Romántico',
    labelEn: 'Romantic',
    description: 'Suave balada romántica con guitarra acústica',
    emoji: '💖',
    language: 'es',
  },
  {
    slug: 'balada',
    labelEs: 'Balada',
    labelEn: 'Ballad',
    description: 'Balada clásica con piano y cuerdas',
    emoji: '🎹',
    language: 'es',
  },
  {
    slug: 'banda',
    labelEs: 'Banda',
    labelEn: 'Banda',
    description: 'Banda sinaloense con tambora y trompetas',
    emoji: '🎺',
    language: 'es',
  },
  {
    slug: 'corrido',
    labelEs: 'Corrido',
    labelEn: 'Corrido',
    description: 'Corrido tradicional con acordeón y bajo sexto',
    emoji: '🪗',
    language: 'es',
  },
  {
    slug: 'ranchera',
    labelEs: 'Ranchera',
    labelEn: 'Ranchera',
    description: 'Ranchera mexicana tradicional con mariachi',
    emoji: '🤠',
    language: 'es',
  },
  {
    slug: 'mariachi',
    labelEs: 'Mariachi',
    labelEn: 'Mariachi',
    description: 'Mariachi clásico con trompetas y violines',
    emoji: '🎻',
    language: 'es',
  },

  // ---------------- English-language genres ----------------
  {
    slug: 'pop_ballad_en',
    labelEs: 'Balada Pop (English)',
    labelEn: 'Pop Ballad',
    description: 'Acoustic pop ballad with piano and gentle strings',
    emoji: '🎵',
    language: 'en',
  },
  {
    slug: 'country_en',
    labelEs: 'Country (English)',
    labelEn: 'Country',
    description: 'Modern country with acoustic guitar and pedal steel',
    emoji: '🤠',
    language: 'en',
  },
  {
    slug: 'rnb_soul_en',
    labelEs: 'R&B / Soul (English)',
    labelEn: 'R&B / Soul',
    description: 'Smooth R&B with electric piano, warm bass, soul groove',
    emoji: '🎷',
    language: 'en',
  },
  {
    slug: 'acoustic_singer_en',
    labelEs: 'Acoustic (English)',
    labelEn: 'Acoustic Singer-Songwriter',
    description: 'Sparse acoustic guitar, intimate vocal-forward arrangement',
    emoji: '🎸',
    language: 'en',
  },
];

/**
 * Recording-quality zones used by the live timer + progress bar.
 * 30s = minimum acceptable, 75s = "ideal," 90s = max we ask for.
 */
export const RECORDING_ZONES_ES = [
  { from: 0,  to: 10,  label: 'Apenas empezando…',                                tone: 'neutral' },
  { from: 10, to: 20,  label: 'Sigue grabando, no pares',                         tone: 'neutral' },
  { from: 20, to: 30,  label: 'Vas bien',                                         tone: 'neutral' },
  { from: 30, to: 45,  label: '✓ Mínimo cumplido — sigue para mejor calidad',     tone: 'good' },
  { from: 45, to: 60,  label: '✨ Calidad buena',                                  tone: 'good' },
  { from: 60, to: 75,  label: '🔥 Calidad muy buena',                              tone: 'great' },
  { from: 75, to: 90,  label: '🏆 ¡Calidad ideal!',                                tone: 'ideal' },
  { from: 90, to: 999, label: '💎 Máximo alcanzado — puedes parar',                tone: 'ideal' },
];

export const RECORDING_ZONES_EN = [
  { from: 0,  to: 10,  label: 'Just getting started…',                          tone: 'neutral' },
  { from: 10, to: 20,  label: 'Keep going, don’t stop',                         tone: 'neutral' },
  { from: 20, to: 30,  label: 'You’re doing well',                              tone: 'neutral' },
  { from: 30, to: 45,  label: '✓ Minimum reached — keep going for better quality', tone: 'good' },
  { from: 45, to: 60,  label: '✨ Good quality',                                  tone: 'good' },
  { from: 60, to: 75,  label: '🔥 Very good quality',                             tone: 'great' },
  { from: 75, to: 90,  label: '🏆 Ideal quality!',                                tone: 'ideal' },
  { from: 90, to: 999, label: '💎 Maximum reached — you can stop',                tone: 'ideal' },
];

// Back-compat default export (Spanish) for any importer that grabs RECORDING_ZONES directly.
export const RECORDING_ZONES = RECORDING_ZONES_ES;

export function zoneFor(seconds, language = 'es') {
  const zones = language === 'en' ? RECORDING_ZONES_EN : RECORDING_ZONES_ES;
  return zones.find((z) => seconds >= z.from && seconds < z.to) || zones[0];
}

/**
 * Singable Spanish lyric for voice sample capture (~60-90s sung).
 *
 * Replaced the old spoken/letter-style reading script 2026-08-08: a SUNG
 * sample teaches the model the customer's pitch and timbre far better
 * than read-aloud prose, and short rhymed lines with a repeating chorus
 * are much easier to improvise a melody over than paragraphs.
 *
 * Designed to:
 *   - Be singable to ANY simple made-up melody (steady meter, rhymed
 *     couplets, open-vowel line endings)
 *   - Cover all 5 vowels + rr, ñ, ll, ch, j, z/ci sounds
 *     (guitarra, cariño, sueño, lluvia, llega, escuchas, mejor, corazón)
 *   - Be 100% original — copyright-safe
 *   - Run ~60-90 seconds at relaxed singing pace; the chorus repeats,
 *     and singing it through twice is fine if time remains
 *
 * Customer sings this while recording. If they freestyle or hum their
 * own thing instead, that's fine — the lyric is opt-in scaffolding.
 */
export const READING_SCRIPT_ES = `Esta es mi voz, la canto para ti,
con el corazón, así me gusta a mí.
La mañana llega, brilla ya el sol,
y en mi ventana suena esta canción.

Canto, canto, con todo el corazón,
mi cariño te entrego en esta canción.
La la la la, la vida es mejor,
cuando canto contigo, siento tu amor.

Bajo la lluvia o bajo el cielo azul,
mi guitarra suena, la escuchas tú.
Sueño despierto, quiero compartir,
este momento que me hace feliz.

Canto, canto, con todo el corazón,
mi cariño te entrego en esta canción.
La la la la, la vida es mejor,
cuando canto contigo, siento tu amor.`;

/**
 * Singable English lyric — same design goals as the Spanish version:
 * steady meter, rhymed couplets, repeating chorus, easy to improvise a
 * melody over, 100% original / copyright-safe, ~60-90s sung.
 */
export const READING_SCRIPT_EN = `This is my voice, I'm singing it for you,
straight from my heart, so simple and so true.
The morning rises, the sun begins to shine,
and through my window all the world feels fine.

Singing, singing, with all my heart today,
every little feeling, I give it all away.
La la la la, life is better now,
when I sing beside you, love will show me how.

Under the rain or under skies of blue,
my old guitar keeps playing songs for you.
I'm dreaming wide awake, I want to share
this happy moment floating in the air.

Singing, singing, with all my heart today,
every little feeling, I give it all away.
La la la la, life is better now,
when I sing beside you, love will show me how.`;

// Back-compat default for older importers.
export const READING_SCRIPT = READING_SCRIPT_ES;

export function readingScriptFor(language = 'es') {
  return language === 'en' ? READING_SCRIPT_EN : READING_SCRIPT_ES;
}

/**
 * After reading the script, the customer should hum or sing wordlessly
 * for ~15 seconds. This is the single biggest accuracy lift for voice
 * cloning: Suno is a SINGING model, so a sung sample teaches it the
 * customer's pitch and timbre far more directly than spoken-only input.
 */
export const HUMMING_INSTRUCTION_ES = {
  title: 'Bonus: tararea 15 segundos',
  subtitle: 'Esta es la parte secreta que hace que tu voz suene mucho mejor cantando.',
  body: 'Después de cantar la letra, tararea cualquier melodía que se te ocurra por unos 15 segundos. No tiene que ser bonito. Solo "mmmm" o "lalala" con cualquier tonadita.',
  warning: '⚠ NO tararees Cielito Lindo, Las Mañanitas, ni canciones famosas — la IA las detecta como copyright y rechaza la grabación.',
};

export const HUMMING_INSTRUCTION_EN = {
  title: 'Bonus: hum for 15 seconds',
  subtitle: 'This is the secret step that makes your voice sound much better when singing.',
  body: 'After singing the lyric, hum any little melody for about 15 seconds. It doesn’t have to be pretty. Just "mmmm" or "lalala" on any tune you make up.',
  warning: '⚠ Do NOT hum Happy Birthday, Twinkle Twinkle, or any famous song — the AI flags them as copyright and rejects the recording.',
};

// Back-compat default.
export const HUMMING_INSTRUCTION = HUMMING_INSTRUCTION_ES;

export function hummingInstructionFor(language = 'es') {
  return language === 'en' ? HUMMING_INSTRUCTION_EN : HUMMING_INSTRUCTION_ES;
}

/**
 * Look up a genre by slug and return its language. Defaults to 'es' if
 * the slug isn't found (back-compat for any caller passing an unknown
 * slug — they get the original Spanish flow).
 */
export function languageForGenre(slug) {
  const g = GENRES.find((x) => x.slug === slug);
  return g?.language || 'es';
}
