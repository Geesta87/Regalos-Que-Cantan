// supabase/functions/_shared/cs-categories.ts
// ---------------------------------------------------------------------------
// Deterministic, rule-based classifier that buckets a customer message into one
// of the 12 customer-service intents. Used by the CS Insights scoreboard
// (cs-training-admin → action:'insights') to compute edit-rate BY question type,
// which is the gate for eventually auto-sending proven response types.
//
// It is intentionally a keyword classifier (not an AI call): free, instant,
// deterministic, and good enough for trend tracking. If we later want higher
// accuracy we can stamp the category at draft time from the model instead.
// ---------------------------------------------------------------------------

export const CS_CATEGORIES = [
  'billing_money',
  'change_request',
  'download_help',
  'locate_song',
  'price',
  'upsell',
  'voice_options',
  'song_status',
  'thanks_closing',
  'greeting_or_order',
  'other',
] as const;

export type CsCategory = (typeof CS_CATEGORIES)[number];

// Human-friendly labels for the admin UI.
export const CS_CATEGORY_LABELS: Record<CsCategory, string> = {
  billing_money: 'Billing / money',
  change_request: 'Song correction',
  download_help: 'Download help',
  locate_song: 'Locate / resend song',
  price: 'Price question',
  upsell: 'Add-ons / upsell',
  voice_options: 'Versions / voice',
  song_status: 'Song status',
  thanks_closing: 'Thanks / closing',
  greeting_or_order: 'Greeting / wants a song',
  other: 'Other',
};

// Order matters: the FIRST pattern that matches wins, so the most specific /
// highest-stakes intents (money, corrections) are checked before the generic
// greeting/thanks catch-alls.
export function classifyCs(text: string | null | undefined): CsCategory {
  const b = (text || '').toLowerCase();
  if (!b.trim()) return 'other';
  const has = (re: RegExp) => re.test(b);
  if (has(/reembols|refund|cobr|cargo|doble|disputa|cancel|estafa|fraud/)) return 'billing_money';
  if (has(/cambi|corrig|correg|arregl|no pusieron|no salio|deberia decir|quiero que diga|error en|mal escrit/)) return 'change_request';
  if (has(/descarg|bajar|no puedo baj|no me deja descarg/)) return 'download_help';
  if (has(/donde|no me lleg|no recib|no encuentro|mi enlace|mi link|reenvi|perdi el|no aparece/)) return 'locate_song';
  if (has(/precio|cuanto|costo|vale|cobran|q valor/)) return 'price';
  if (has(/video|karaoke|instrumental|clona|animad|foto|paquete/)) return 'upsell';
  if (has(/version|otra voz|genero|estilo|masculin|femenin|primera|segunda/)) return 'voice_options';
  if (has(/ya esta|esta lista|cuando esta|cuando estara|termin|en proceso|status/)) return 'song_status';
  if (has(/gracias|bendicion|excelente|perfect|hermosa|me encanto|buenisim/)) return 'thanks_closing';
  if (has(/hola|buenas|tengo una pregunta|informacion|quiero una cancion|quiero hacer|quiero crear|me gustaria|me interesa/)) return 'greeting_or_order';
  return 'other';
}
