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
    occasion: formData.occasion,
    occasionPrompt: occasionPrompts[formData.occasion],
    customOccasion: formData.customOccasion || '',
    emotionalTone: formData.emotionalTone || '',
    recipientName: formData.recipientName,
    senderName: formData.senderName,
    relationship: formData.relationship,
    customRelationship: formData.customRelationship || '',
    details: formData.details,
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
export async function createCheckout(songIds, email, couponCode = null, purchaseBoth = false, pricingTier = '', videoAddon = false, videoAddonCount = 0, karaokeAddon = false, karaokeSongIds = [], animadoCount = 0, animadoSongIds = []) {
  // Normalize to array
  const idsArray = Array.isArray(songIds) ? songIds : [songIds];
  
  // Capture Facebook cookies for Meta Conversions API attribution
  const getCookie = (name) => {
    try {
      const match = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
      return match ? match.split('=').slice(1).join('=').trim() : '';
    } catch { return ''; }
  };
  const fbc = getCookie('_fbc');
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
      // UTM attribution passthrough
      ...(() => {
        try {
          const stored = JSON.parse(sessionStorage.getItem('rqc_utm_params') || '{}');
          return {
            utm_source: stored.utm_source || null,
            utm_medium: stored.utm_medium || null,
            utm_campaign: stored.utm_campaign || null
          };
        } catch { return {}; }
      })(),
      session_id: sessionStorage.getItem('rqc_session_id') || null,
      from_email_campaign: sessionStorage.getItem('rqc_from_email') || null
    })
  });

  if (!response.ok) {
    throw new Error('Failed to create checkout');
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
