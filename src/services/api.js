import { createClient } from '@supabase/supabase-js';

// API Configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

// Create Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Genre style mappings for Suno/Kie.ai
export const genreStyles = {
  corrido: "Mexican corrido, accordion, bajo sexto, brass, epic storytelling, norteño",
  norteno: "Norteño music, accordion, polka rhythm, traditional Mexican, bajo sexto",
  banda: "Mexican brass band, tubas, trumpets, tambora, powerful vocals, sinaloense",
  cumbia: "tropical cumbia, accordion, congas, danceable Latin beat, Colombian rhythm",
  ranchera: "mariachi, violins, trumpets, passionate vocals, traditional Mexican ranchera",
  balada: "romantic Spanish ballad, piano, strings, emotional vocals, Latin pop",
  reggaeton: "urban Latin, dembow beat, modern production, reggaetón perreo",
  salsa: "Caribbean salsa, piano montuno, congas, timbales, Cuban rhythm"
};

// Occasion prompts for Claude lyrics generation
export const occasionPrompts = {
  cumpleanos: "una canción de cumpleaños alegre y emotiva",
  aniversario: "una canción romántica celebrando el amor y los años juntos",
  declaracion: "una declaración de amor apasionada y sincera",
  disculpa: "una canción pidiendo perdón con el corazón",
  graduacion: "una canción celebrando logros y nuevos comienzos",
  quinceanera: "una canción especial para quinceañera, celebrando la transición a la juventud",
  boda: "una canción de amor para una boda, celebrando la unión",
  madre: "una canción emotiva de agradecimiento para una madre",
  padre: "una canción de admiración y cariño para un padre",
  amistad: "una canción celebrando una amistad verdadera",
  motivacion: "una canción motivacional e inspiradora",
  para_mi: "una canción personal para uno mismo, un himno propio de empoderamiento, celebración o reflexión",
  // Occasions added 2026-06-25 alongside the memorial + custom-style work. Keys
  // here MUST match the occasion `id` values in OccasionStep.jsx so the backend
  // resolves a Spanish occasion phrase instead of falling back to the raw slug.
  bautizo: "una canción tierna para un bautizo, celebrando la bendición de un nuevo miembro de la familia y la fe",
  jubilacion: "una canción celebrando una jubilación bien merecida, honrando años de esfuerzo y el nuevo capítulo que comienza",
  negocio: "una canción celebrando un negocio propio, el esfuerzo, los sacrificios y el orgullo de salir adelante",
  mascota: "una canción tierna y alegre dedicada a una mascota muy querida, un miembro más de la familia",
  memorial: "una canción en memoria de un ser querido que falleció, un homenaje que celebra su vida y su legado con amor y dignidad",
  dia_muertos: "una canción para el Día de los Muertos honrando y recordando con cariño a quienes ya partieron",
  otro: "una canción personalizada y emotiva"
};

/**
 * Generate a personalized song
 */
export async function generateSong(formData, overridePin = null) {
  const url = `${SUPABASE_URL}/functions/v1/generate-song`;

  const stylePrompt = formData.subGenrePrompt || genreStyles[formData.genre];

  const payload = {
    genre: formData.genre,
    genreStyle: stylePrompt,
    // Display names + custom write-ins the edge function reads. Previously these
    // were collected by the funnel but never forwarded here, so the backend fell
    // back to the raw slug ("norteno") for the genre label and — worse — silently
    // dropped the customer's own text when they picked "Otro" relationship/occasion
    // (e.g. "mi madrina que me crió" / "celebrar que venció el cáncer"). Forwarding
    // them restores that personalization. Unknown/empty fields are harmless: the
    // backend already guards each with `=== 'otro' && <field>` or `|| fallback`.
    genreName: formData.genreName || '',
    subGenre: formData.subGenre || '',
    subGenreName: formData.subGenreName || '',
    // "Escribe tu propio estilo": optional free-text genre/style the buyer typed.
    // The backend scrubs artist names + caps length before it reaches Suno/Kie,
    // then leads the music-style prompt with it. Empty string = use the picked
    // genre's DNA as before.
    customStyle: formData.customStyle || '',
    occasion: formData.occasion,
    occasionPrompt: occasionPrompts[formData.occasion],
    customOccasion: formData.customOccasion || '',
    emotionalTone: formData.emotionalTone || '',
    recipientName: formData.recipientName,
    senderName: formData.senderName,
    relationship: formData.relationship,
    customRelationship: formData.customRelationship || '',
    details: formData.details,
    // Optional free-text notes the AI composer takes into account (story mode).
    songwriterNotes: formData.songwriterNotes || '',
    // "Escribir mi propia letra": when the buyer wrote their own lyrics, the
    // backend skips AI generation and sings these EXACT words. `details` is
    // empty in that case (the UI hides the story box), which is fine — the
    // backend keys off useCustomLyrics, not details.
    useCustomLyrics: !!formData.useCustomLyrics,
    customLyrics: formData.customLyrics || '',
    email: formData.email,
    voiceType: formData.voiceType || 'male',
    artistInspiration: formData.artistInspiration || '',
    // Links Song 2 to Song 1's session on the direct-Mureka path (GeneratingPage
    // passes sessionId through formData for the v2 call). Omitted on v1 → backend
    // generates a fresh session id, unchanged from before.
    ...(formData.sessionId ? { sessionId: formData.sessionId } : {})
  };

  // Optional admin override PIN — bypasses anti-abuse rate limits when the
  // owner needs to test from a flagged IP/email. Server-side check is the
  // real gate; we only forward whatever the user typed.
  if (overridePin) payload.overridePin = overridePin;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errorBody = null;
    try { errorBody = await response.json(); } catch { /* non-JSON body */ }
    // Tag the error with status + backend code so the UI can show the
    // "enter PIN" override flow only on rate-limit / blocklist failures.
    if (response.status === 429 || response.status === 403) {
      const err = new Error(errorBody?.error || `HTTP ${response.status}`);
      err.status = response.status;
      err.code = errorBody?.code || (response.status === 429 ? 'RATE_LIMIT_UNPAID' : 'IP_BLOCKED');
      throw err;
    }
    throw new Error(`Failed to generate song: ${response.status} - ${errorBody?.error || 'Unknown error'}`);
  }

  return response.json();
}

/**
 * Create a Stripe checkout session
 * @param {string|string[]} songIds - Single song ID or array of song IDs
 * @param {string} email - Customer email
 * @param {string} couponCode - Optional coupon code
 * @param {boolean} purchaseBoth - Whether user is buying the bundle
 */
export async function createCheckout(songIds, email, couponCode = null, purchaseBoth = false, pricingTier = '', videoAddon = false, videoAddonCount = 0, karaokeAddon = false, karaokeSongIds = [], animadoCount = 0, animadoSongIds = [], giftSms = null, lyricVideoAddon = false) {
  // Normalize to array
  const idsArray = Array.isArray(songIds) ? songIds : [songIds];
  
  // Capture Facebook cookies for Meta Conversions API attribution
  const getCookie = (name) => {
    try {
      const match = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
      return match ? match.split('=').slice(1).join('=').trim() : '';
    } catch { return ''; }
  };
  // Prefer the live _fbc cookie; fall back to the fbclid we captured + persisted
  // on landing (tracking.js), so the server-side CAPI Purchase is never sent with
  // an empty click-ID even when the cookie is missing at checkout time.
  const getStoredFbc = () => {
    try {
      const raw = JSON.parse(localStorage.getItem('rqc_fbc') || 'null');
      if (raw && raw.fbc && raw.expiresAt > Date.now()) return raw.fbc;
    } catch { /* ignore */ }
    return '';
  };
  const fbc = getCookie('_fbc') || getStoredFbc();
  const fbp = getCookie('_fbp');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      songIds: idsArray,
      email,
      couponCode,
      purchaseBoth,
      pricingTier,
      videoAddon,
      videoAddonCount,
      karaokeAddon,
      karaokeSongIds,
      animadoCount,
      animadoSongIds,
      giftSms,
      lyricVideoAddon,
      fbc,
      fbp,
      clientUserAgent: navigator.userAgent,
      // 30-day localStorage attribution (see tracking.js). Falls back to the
      // legacy sessionStorage location during the rollout window so anyone
      // mid-funnel during deploy keeps their attribution intact.
      affiliateCode: (() => {
        try {
          const raw = localStorage.getItem('rqc_affiliate');
          if (raw && raw.startsWith('{')) {
            const obj = JSON.parse(raw);
            if (obj && obj.code && obj.expiresAt && Date.now() < obj.expiresAt) {
              return String(obj.code).toLowerCase();
            }
          } else if (raw) {
            return String(raw).toLowerCase();
          }
        } catch { /* ignore */ }
        return sessionStorage.getItem('rqc_affiliate') || null;
      })(),
      // UTM attribution passthrough — read the persisted value (localStorage,
      // 30-day TTL) so it survives tab closes / new tabs / email-link returns;
      // fall back to legacy sessionStorage, then the current URL. This is what
      // makes the campaign tag actually land on the order (was sessionStorage-only).
      ...(() => {
        const readUtm = () => {
          try {
            const raw = localStorage.getItem('rqc_utm');
            if (raw) { const o = JSON.parse(raw); if (o && typeof o.expiresAt === 'number' && Date.now() < o.expiresAt) return o; }
          } catch { /* ignore */ }
          try { const s = sessionStorage.getItem('rqc_utm_params'); if (s) { const o = JSON.parse(s); o.from_email = sessionStorage.getItem('rqc_from_email') || null; return o; } } catch { /* ignore */ }
          try { const p = new URLSearchParams(window.location.search); const src = p.get('utm_source'); return { utm_source: src, utm_medium: p.get('utm_medium'), utm_campaign: p.get('utm_campaign'), from_email: src === 'email' ? p.get('utm_campaign') : null }; } catch { return {}; }
        };
        const u = readUtm() || {};
        return { utm_source: u.utm_source || null, utm_medium: u.utm_medium || null, utm_campaign: u.utm_campaign || null };
      })(),
      session_id: sessionStorage.getItem('rqc_session_id') || null,
      from_email_campaign: (() => {
        try { const raw = localStorage.getItem('rqc_utm'); if (raw) { const o = JSON.parse(raw); if (o && typeof o.expiresAt === 'number' && Date.now() < o.expiresAt && o.from_email) return o.from_email; } } catch { /* ignore */ }
        return sessionStorage.getItem('rqc_from_email') || null;
      })()
    })
  });

  if (!response.ok) {
    // Surface the server's message when present (e.g. a gift-message moderation
    // rejection) so the caller can show it; fall back to a generic error.
    let msg = 'Failed to create checkout';
    try { const e = await response.json(); if (e?.message) msg = e.message; } catch { /* ignore */ }
    throw new Error(msg);
  }

  return response.json();
}

// 3-song pack ("Paquete de 3 canciones", $49.99). A standalone purchase with no
// song — create-checkout (pack mode) returns a Stripe URL; on payment the
// webhook mints + emails a personal NOMBRE-### code worth 3 free single songs.
export async function createPackCheckout(buyerName, email) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ pack: 'pack3', buyerName, email }),
  });
  if (!response.ok) {
    let msg = 'No se pudo iniciar el pago.';
    try { const e = await response.json(); if (e?.message) msg = e.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return response.json();
}

/**
 * Get song status/details
 */
export async function getSong(songId) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/get-song?id=${songId}`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get song');
  }

  return response.json();
}

/**
 * Check song status - polls database for song completion
 */
export async function checkSongStatus(songId) {
  const url = `${SUPABASE_URL}/functions/v1/check-song-status?songId=${songId}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to check status: ${errorText}`);
  }

  return response.json();
}

/**
 * One-tap post-purchase upsell charge (Animado / instrumental). Charges the
 * card saved at the original song purchase — no second checkout. The sessionId
 * (from the /success URL) proves ownership server-side.
 * Returns { status: 'paid' | 'needs_action' | 'error', ... }.
 */
export async function chargeUpsell({ songId, item, sessionId, gift = null }) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/charge-upsell`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ song_id: songId, item, session_id: sessionId, gift })
  });
  // The function returns 200 with a { status } field for paid/needs_action/error;
  // a non-2xx is a hard failure — normalize it to the same shape so callers
  // never have to special-case it.
  if (!response.ok) {
    let err = 'charge_failed';
    try { const j = await response.json(); err = j?.error || err; } catch { /* ignore */ }
    return { status: 'error', error: err };
  }
  return response.json();
}

/**
 * Regenerate a song with the same details but new music
 */
export async function regenerateSong(songId) {
  const url = `${SUPABASE_URL}/functions/v1/regenerate-song`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ songId })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to regenerate song: ${response.status}`);
  }

  return response.json();
}

/**
 * Validate a coupon code
 */
export async function validateCoupon(code) {
  const url = `${SUPABASE_URL}/functions/v1/validate-coupon`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ code: code.toUpperCase().trim() })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Código inválido');
  }

  return response.json();
}
