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
  otro: "una canción personalizada y emotiva"
};

/**
 * Generate a personalized song
 * @param {Object} formData - The form data with all song details
 * @returns {Promise<Object>} - The generated song data
 */
export async function generateSong(formData) {
  const url = `${SUPABASE_URL}/functions/v1/generate-song`;
  
  console.log('=== generateSong API CALL ===');
  console.log('URL:', url);
  console.log('SUPABASE_URL:', SUPABASE_URL);
  console.log('Has ANON_KEY:', !!SUPABASE_ANON_KEY);
  
  // Use subGenrePrompt if available, otherwise fall back to genreStyle
  const stylePrompt = formData.subGenrePrompt || genreStyles[formData.genre];
  
  const payload = {
    genre: formData.genre,
    genreStyle: stylePrompt,
    subGenre: formData.subGenre || '',
    occasion: formData.occasion,
    occasionPrompt: occasionPrompts[formData.occasion],
    recipientName: formData.recipientName,
    senderName: formData.senderName,
    relationship: formData.relationship,
    details: formData.details,
    email: formData.email,
    voiceType: formData.voiceType || 'male',
    artistInspiration: formData.artistInspiration || ''
  };
  
  console.log('Payload:', payload);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify(payload)
  });

  console.log('Response status:', response.status);
  console.log('Response ok:', response.ok);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error response:', errorText);
    throw new Error(`Failed to generate song: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('Response data:', data);
  return data;
}

/**
 * Create a Stripe checkout session
 * @param {string|string[]} songIds - Single song ID or array of song IDs
 * @param {string} email - Customer email
 * @param {string} couponCode - Optional coupon code
 * @param {boolean} purchaseBoth - Whether to use bundle pricing
 * @returns {Promise<Object>} - Checkout session with URL
 */
export async function createCheckout(songIds, email, couponCode = null, purchaseBoth = false) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      songIds: Array.isArray(songIds) ? songIds : [songIds],
      email,
      couponCode,
      purchaseBoth
    })
  });

  if (!response.ok) {
    throw new Error('Failed to create checkout');
  }

  return response.json();
}

/**
 * Get song status/details
 * @param {string} songId - The song ID
 * @returns {Promise<Object>} - Song details
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
 * @param {string} songId - The song ID
 * @returns {Promise<Object>} - Song status and data
 */
export async function checkSongStatus(songId) {
  const url = `${SUPABASE_URL}/functions/v1/check-song-status?songId=${songId}`;
  
  console.log('Checking song status:', songId);
  
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
 * @param {string} songId - The original song ID to regenerate
 * @returns {Promise<Object>} - The new generated song data
 */
export async function regenerateSong(songId) {
  const url = `${SUPABASE_URL}/functions/v1/regenerate-song`;
  
  console.log('=== regenerateSong API CALL ===');
  console.log('Song ID:', songId);
  
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
    console.error('Regenerate error:', errorText);
    throw new Error(`Failed to regenerate song: ${response.status}`);
  }

  return response.json();
}

/**
 * Validate a coupon code
 * @param {string} code - The coupon code to validate
 * @returns {Promise<Object>} - Coupon details if valid
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
