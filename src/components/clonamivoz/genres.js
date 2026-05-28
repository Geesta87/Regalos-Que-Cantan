// src/components/clonamivoz/genres.js
//
// Genre palette + recording-zone metadata + the 90-second reading script
// for the Clone Mi Voz tier (/clonamivoz).
//
// Ported verbatim from suno-voice-clone-test/web-app/lib/genres.ts (the
// validated test harness). Style strings and tuning constants are the
// empirically-tuned values from the 6-genre validation pass — do NOT
// loosen them without re-running the harness.
//
// This file is the source of truth for what the /clonamivoz page shows.
// It is NOT used by the regular Mureka funnel; do not import it elsewhere.

export const GENRES = [
  {
    slug: 'romantico',
    labelEs: 'Romántico',
    labelEn: 'Romantic',
    description: 'Suave balada romántica con guitarra acústica',
    emoji: '💖',
  },
  {
    slug: 'balada',
    labelEs: 'Balada',
    labelEn: 'Ballad',
    description: 'Balada clásica con piano y cuerdas',
    emoji: '🎹',
  },
  {
    slug: 'banda',
    labelEs: 'Banda',
    labelEn: 'Banda',
    description: 'Banda sinaloense con tambora y trompetas',
    emoji: '🎺',
  },
  {
    slug: 'corrido',
    labelEs: 'Corrido',
    labelEn: 'Corrido',
    description: 'Corrido tradicional con acordeón y bajo sexto',
    emoji: '🪗',
  },
  {
    slug: 'ranchera',
    labelEs: 'Ranchera',
    labelEn: 'Ranchera',
    description: 'Ranchera mexicana tradicional con mariachi',
    emoji: '🤠',
  },
  {
    slug: 'mariachi',
    labelEs: 'Mariachi',
    labelEn: 'Mariachi',
    description: 'Mariachi clásico con trompetas y violines',
    emoji: '🎻',
  },
];

/**
 * Recording-quality zones used by the live timer + progress bar.
 * 30s = minimum acceptable, 75s = "ideal," 90s = max we ask for.
 */
export const RECORDING_ZONES = [
  { from: 0,  to: 10,  label: 'Apenas empezando…',                                tone: 'neutral' },
  { from: 10, to: 20,  label: 'Sigue grabando, no pares',                         tone: 'neutral' },
  { from: 20, to: 30,  label: 'Vas bien',                                         tone: 'neutral' },
  { from: 30, to: 45,  label: '✓ Mínimo cumplido — sigue para mejor calidad',     tone: 'good' },
  { from: 45, to: 60,  label: '✨ Calidad buena',                                  tone: 'good' },
  { from: 60, to: 75,  label: '🔥 Calidad muy buena',                              tone: 'great' },
  { from: 75, to: 90,  label: '🏆 ¡Calidad ideal!',                                tone: 'ideal' },
  { from: 90, to: 999, label: '💎 Máximo alcanzado — puedes parar',                tone: 'ideal' },
];

export function zoneFor(seconds) {
  return RECORDING_ZONES.find((z) => seconds >= z.from && seconds < z.to) || RECORDING_ZONES[0];
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
export const READING_SCRIPT = `Hola, hoy quiero compartir un momento especial. Cada palabra que digo viene desde el corazón, con calma y con cariño.

Las mañanas tranquilas son las que más disfruto. El sol entra suave por la ventana, los pájaros cantan en el árbol, y se respira aire fresco. Me gusta el aroma del té recién hecho, el sonido suave de la lluvia sobre el techo, y las flores del jardín.

Las personas que quiero son lo más importante para mí. Por ellas vivimos, por ellas soñamos, por ellas seguimos adelante. Alguien me dijo una vez: donde hay amor, hay música. Y tenía toda la razón. La música une corazones, cruza fronteras, y guarda los recuerdos más bellos.

Cuando era pequeño, jugaba al aire libre con mucha alegría. El perro corría por el parque, los niños reían sin parar, y todo era simple. Esa libertad la llevo conmigo siempre. Cada canción que escucho me regresa a esos momentos felices.

Ahora, con mi propia voz, quiero crear algo único. Algo hecho con sentimiento, desde lo más profundo. Gracias por escucharme. Gracias por permitirme compartir contigo este pequeño pedacito de mí.`;

/**
 * After reading the script, the customer should hum or sing wordlessly
 * for ~15 seconds. This is the single biggest accuracy lift for voice
 * cloning: Suno is a SINGING model, so a sung sample teaches it the
 * customer's pitch and timbre far more directly than spoken-only input.
 *
 * Validated in suno-voice-clone-test — humming alone produced as-good
 * or better clones than reading alone. Combining both is best of both
 * worlds (humming captures pitch, reading captures phonemes).
 *
 * Shown in a distinct section after the reading script so customers
 * see it as a clear additional ask. NO famous tunes — Suno's copyright
 * filter rejects them.
 */
export const HUMMING_INSTRUCTION = {
  title: 'Bonus: tararea 15 segundos',
  subtitle: 'Esta es la parte secreta que hace que tu voz suene mucho mejor cantando.',
  body: 'Después del texto, tararea cualquier melodía que se te ocurra por unos 15 segundos. No tiene que ser bonito. Solo "mmmm" o "lalala" con cualquier tonadita.',
  warning: '⚠ NO tararees Cielito Lindo, Las Mañanitas, ni canciones famosas — la IA las detecta como copyright y rechaza la grabación.',
};
