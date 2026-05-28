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
 *   - Be neutral/general (not a specific song melody — passes Suno copyright filter)
 *   - Take ~85-95 seconds at moderate Spanish reading pace (~165 wpm)
 *
 * Customer reads this aloud while recording. If they freestyle / hum
 * instead, that's fine — the script is opt-in scaffolding.
 */
export const READING_SCRIPT = `Hola, hoy quiero compartir un momento especial. Cada palabra que pronuncio viene desde lo más profundo del alma, con cariño y verdad.

Las mañanas en mi tierra siempre han sido cálidas. El sol pinta el cielo de naranja, las aves cantan en los árboles, y se respira aire puro. Recuerdo el aroma del café recién molido, las tortillas calientes, y las flores del jardín de mi abuela.

La familia es lo más importante. Por ellos vivimos, por ellos soñamos, por ellos cantamos. Mi madre siempre decía: donde hay amor, hay música. Y tenía toda la razón. La música une corazones, atraviesa fronteras, y guarda los recuerdos más bellos.

Cuando era niño, jugaba en las calles del barrio. Reíamos sin preocupaciones, sin teléfonos, sin prisa. Esa libertad la llevo conmigo siempre. Cada canción que escucho me transporta a esos momentos felices.

Ahora, con mi propia voz, quiero crear algo único. Una canción hecha desde el corazón, llena de sentimiento. Gracias por escucharme. Gracias por permitirme compartir contigo este pequeño pedacito de mí.`;
