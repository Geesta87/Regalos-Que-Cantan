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
 * 90-second Spanish reading script for voice sample capture.
 *
 * Designed to:
 *   - Cover all 5 vowels in varied positions
 *   - Include rolled-r (rr), ñ, ll, ch, j, z, ci/ce sounds
 *   - Have natural sentence rhythm (not staccato or sing-song)
 *   - Be neutral and universally relatable (not tied to one culture, no
 *     famous song lyrics — copyright-safe)
 *   - Take ~85-95 seconds at moderate Spanish reading pace (~165 wpm)
 *
 * Customer reads this aloud while recording. If they freestyle / hum
 * instead, that's fine — the script is opt-in scaffolding.
 */
export const READING_SCRIPT_ES = `Hola, hoy quiero compartir un momento especial. Cada palabra que digo viene desde el corazón, con calma y con cariño.

Las mañanas tranquilas son las que más disfruto. El sol entra suave por la ventana, los pájaros cantan en el árbol, y se respira aire fresco. Me gusta el aroma del té recién hecho, el sonido suave de la lluvia sobre el techo, y las flores del jardín.

Las personas que quiero son lo más importante para mí. Por ellas vivimos, por ellas soñamos, por ellas seguimos adelante. Alguien me dijo una vez: donde hay amor, hay música. Y tenía toda la razón. La música une corazones, cruza fronteras, y guarda los recuerdos más bellos.

Cuando era pequeño, jugaba al aire libre con mucha alegría. El perro corría por el parque, los niños reían sin parar, y todo era simple. Esa libertad la llevo conmigo siempre. Cada canción que escucho me regresa a esos momentos felices.

Ahora, con mi propia voz, quiero crear algo único. Algo hecho con sentimiento, desde lo más profundo. Gracias por escucharme. Gracias por permitirme compartir contigo este pequeño pedacito de mí.`;

/**
 * 90-second English reading script. Designed for the same purposes as
 * the Spanish version: vowel coverage, common consonant clusters
 * (th, sh, ch, r-controlled vowels, soft/hard c, plosives), natural
 * sentence rhythm, copyright-safe, ~165 wpm = ~90s reading time.
 */
export const READING_SCRIPT_EN = `Hi there, today I want to share a special moment with you. Every word I say comes from the heart, slowly and with care.

The quiet mornings are the ones I enjoy the most. Soft sunlight comes through the window, birds sing in the trees, and the air feels fresh and clean. I love the smell of fresh coffee, the gentle sound of rain on the roof, and the bright flowers in the garden.

The people I love mean everything to me. For them we live, for them we dream, for them we keep moving forward. Someone once told me: where there is love, there is music. And they were absolutely right. Music brings hearts together, crosses every border, and holds our most beautiful memories.

When I was a child, I played outside with so much joy. The dog ran through the park, the children laughed without stopping, and everything was simple. That freedom I still carry with me. Every song I hear takes me right back to those happy moments.

Now, with my own voice, I want to create something unique. Something made with feeling, from deep inside. Thank you for listening. Thank you for letting me share this small piece of myself with you.`;

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
  body: 'Después del texto, tararea cualquier melodía que se te ocurra por unos 15 segundos. No tiene que ser bonito. Solo "mmmm" o "lalala" con cualquier tonadita.',
  warning: '⚠ NO tararees Cielito Lindo, Las Mañanitas, ni canciones famosas — la IA las detecta como copyright y rechaza la grabación.',
};

export const HUMMING_INSTRUCTION_EN = {
  title: 'Bonus: hum for 15 seconds',
  subtitle: 'This is the secret step that makes your voice sound much better when singing.',
  body: 'After reading the script, hum any little melody for about 15 seconds. It doesn’t have to be pretty. Just "mmmm" or "lalala" on any tune you make up.',
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
