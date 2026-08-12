// Canonical option lists for the song brief: occasions, emotional tones and
// recipient relationships.
//
// These used to live as private consts inside OccasionStep.jsx and NamesStep.jsx.
// They were pulled out here when the admin "Make Song for Customer" modal needed
// the same ids — a second hand-copied list is how `occasionPrompts` in
// services/api.js silently drifted out of sync with the picker and started
// sending `undefined` for seven live occasions. One list, imported everywhere.
//
// `id` and `name` are byte-identical to what the funnel shipped before the
// extraction — the customer-facing UI is unchanged. `icon` is the Material
// Symbols name the funnel tiles render. `en` is an ENGLISH label used ONLY by
// the admin dashboard (project rule: admin UI in English, customer copy in
// Spanish) so the assistant can operate the brief without reading Spanish.

export const OCCASIONS = [
  { id: 'cumpleanos', name: 'Cumpleaños', icon: 'cake', en: 'Birthday' },
  { id: 'aniversario', name: 'Aniversario', icon: 'favorite', en: 'Anniversary' },
  { id: 'san_valentin', name: 'San Valentín 💘', icon: 'favorite_border', en: "Valentine's Day" },
  { id: 'boda', name: 'Boda', icon: 'celebration', en: 'Wedding' },
  { id: 'nacimiento', name: 'Nacimiento', icon: 'child_care', en: 'New baby' },
  { id: 'dia_madre', name: 'Día de la Madre', icon: 'home', en: "Mother's Day" },
  { id: 'dia_padre', name: 'Día del Padre', icon: 'potted_plant', en: "Father's Day" },
  { id: 'amor', name: 'Amor / Pareja', icon: 'volunteer_activism', en: 'Love / partner' },
  { id: 'graduacion', name: 'Graduación', icon: 'school', en: 'Graduation' },
  { id: 'quinceanera', name: 'Quinceañera', icon: 'celebration', en: 'Quinceañera (15th birthday)' },
  { id: 'bautizo', name: 'Bautizo', icon: 'church', en: 'Baptism' },
  { id: 'jubilacion', name: 'Jubilación', icon: 'beach_access', en: 'Retirement' },
  { id: 'negocio', name: 'Negocio Nuevo', icon: 'storefront', en: 'New business' },
  { id: 'amistad', name: 'Amistad', icon: 'diversity_3', en: 'Friendship' },
  { id: 'agradecimiento', name: 'Agradecimiento', icon: 'redeem', en: 'Thank you / gratitude' },
  { id: 'mascota', name: 'Mascota', icon: 'pets', en: 'Pet' },
  { id: 'memorial', name: 'En Memoria 🕊️', icon: 'local_florist', en: 'In memory (someone passed away)' },
  { id: 'dia_muertos', name: 'Día de Muertos', icon: 'skull', en: 'Day of the Dead' },
  { id: 'navidad', name: 'Navidad / Reyes', icon: 'auto_awesome', en: 'Christmas / Three Kings' },
  { id: 'para_mi', name: 'Para Mí Mismo', icon: 'person', en: 'For myself' },
  { id: 'otro', name: 'Otra Ocasión', icon: 'more_horiz', en: 'Other occasion (write it in)' },
];

export const EMOTIONAL_TONES = [
  { id: 'celebracion', name: 'Celebración / Alegría', icon: 'celebration', en: 'Celebration / joy' },
  { id: 'amor', name: 'Amor / Romance', icon: 'favorite', en: 'Love / romance' },
  { id: 'agradecimiento', name: 'Agradecimiento', icon: 'volunteer_activism', en: 'Gratitude' },
  { id: 'nostalgia', name: 'Nostalgia / Recuerdos', icon: 'history', en: 'Nostalgia / memories' },
  { id: 'motivacion', name: 'Motivación / Superación', icon: 'trending_up', en: 'Motivation / overcoming' },
  { id: 'despedida', name: 'Despedida / Tributo', icon: 'waving_hand', en: 'Farewell / tribute' },
  { id: 'humor', name: 'Humor / Diversión', icon: 'sentiment_very_satisfied', en: 'Humor / fun' },
];

export const RELATIONSHIPS = [
  { id: 'pareja', name: 'Pareja / Esposo(a)', icon: 'favorite', en: 'Partner / spouse' },
  { id: 'madre', name: 'Madre', icon: 'face_4', en: 'Mother' },
  { id: 'padre', name: 'Padre', icon: 'face', en: 'Father' },
  { id: 'hijo', name: 'Hijo / Hija', icon: 'child_care', en: 'Son / daughter' },
  { id: 'hermano', name: 'Hermano / Hermana', icon: 'group', en: 'Brother / sister' },
  { id: 'abuelo', name: 'Abuelo / Abuela', icon: 'elderly', en: 'Grandfather / grandmother' },
  { id: 'amigo', name: 'Amigo / Amiga', icon: 'diversity_3', en: 'Friend' },
  { id: 'jefe', name: 'Jefe / Colega', icon: 'work', en: 'Boss / coworker' },
  { id: 'yo_mismo', name: 'Para Mí', icon: 'person', en: 'For themselves' },
  { id: 'otro', name: 'Otra relación', icon: 'more_horiz', en: 'Other relationship (write it in)' },
];

export const VOICE_TYPES = [
  { id: 'male', name: 'Voz Masculina', en: 'Male voice' },
  { id: 'female', name: 'Voz Femenina', en: 'Female voice' },
];

export const OCCASION_IDS = OCCASIONS.map((o) => o.id);
export const EMOTIONAL_TONE_IDS = EMOTIONAL_TONES.map((t) => t.id);
export const RELATIONSHIP_IDS = RELATIONSHIPS.map((r) => r.id);
