// src/services/clonamivoz.js
//
// API client for the Clone Mi Voz tier (/clonamivoz). Wraps the four
// dedicated edge functions added in feature/clonamivoz:
//   - upload-customer-voice         (POST multipart)
//   - generate-cloned-voice-lyrics  (POST JSON, Claude)
//   - generate-cloned-voice-song    (POST JSON, Kie/Suno)
//   - cloned-voice-status           (POST JSON, polling)
//
// All four functions have verify_jwt = true (see supabase/config.toml),
// so we authenticate with the public anon key — identical pattern to the
// recover-song endpoint used by /mi-cancion.
//
// Network errors throw; HTTP non-2xx responses return `{ ok: false, error,
// message }` so the caller can render the message without try/catch noise.

import { supabase } from './api';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  // Same fallback as services/api.js. Kept duplicate so this file can be
  // imported in isolation without forcing the bigger api.js to load first.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

const FN_BASE = `${SUPABASE_URL}/functions/v1`;

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    ...extra,
  };
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Upload a recorded voice Blob to Supabase Storage via the
 * upload-customer-voice edge function.
 *
 * @param {Blob} blob              The audio Blob from MediaRecorder
 * @param {object} opts
 * @param {string} [opts.customerEmail]
 * @param {number} [opts.durationSeconds]
 * @returns {Promise<{ok:boolean, voice_sample_id?:string, public_url?:string,
 *                    storage_path?:string, expires_in_seconds?:number,
 *                    error?:string, message?:string}>}
 */
export async function uploadCustomerVoice(blob, opts = {}) {
  const form = new FormData();
  // Filename only matters for browser DevTools UX — server picks its own
  // extension based on MIME type.
  const filename = blob.type?.includes('mp4') || blob.type?.includes('m4a')
    ? 'voice.m4a'
    : blob.type?.includes('mpeg') || blob.type?.includes('mp3')
    ? 'voice.mp3'
    : 'voice.webm';
  form.append('file', blob, filename);
  if (opts.customerEmail) form.append('customer_email', opts.customerEmail);
  if (Number.isFinite(opts.durationSeconds)) {
    form.append('duration_seconds', String(opts.durationSeconds));
  }

  const res = await fetch(`${FN_BASE}/upload-customer-voice`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  const data = (await safeJson(res)) || {};
  if (!res.ok) {
    return { ok: false, error: data.error || `http_${res.status}`, message: data.message };
  }
  return { ok: true, ...data };
}

/**
 * Generate lyrics with Claude (Sonnet 4.6 → Haiku 4.5 fallback).
 *
 * @param {object} args
 * @param {string} args.recipientName
 * @param {string} args.relationship
 * @param {string} args.occasion
 * @param {string} args.story
 * @param {string} args.genreSlug
 * @param {string} [args.language]      'es' | 'en' | 'spanglish' (default 'es')
 * @returns {Promise<{ok:boolean, title?:string, lyrics?:string,
 *                    emotional_modifiers?:string, model_used?:string,
 *                    error?:string, message?:string}>}
 */
export async function generateClonedVoiceLyrics(args) {
  const res = await fetch(`${FN_BASE}/generate-cloned-voice-lyrics`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      recipient_name: args.recipientName,
      relationship: args.relationship,
      occasion: args.occasion,
      story: args.story,
      genre_slug: args.genreSlug,
      language: args.language || 'es',
    }),
  });

  const data = (await safeJson(res)) || {};
  if (!res.ok) {
    return { ok: false, error: data.error || `http_${res.status}`, message: data.message };
  }
  return { ok: true, ...data };
}

/**
 * Submit the Suno generation job (Kie.ai upload-cover endpoint).
 * Returns immediately with a kie_task_id; poll cloned-voice-status for
 * the finished audio URLs.
 *
 * @param {object} args
 * @param {string} args.voiceSampleId           UUID returned by uploadCustomerVoice
 * @param {string} args.lyrics                  Final lyric text
 * @param {string} args.title                   Suno song title
 * @param {string} args.genreSlug               One of GENRES[].slug
 * @param {string} [args.recipientName]
 * @param {string} [args.relationship]
 * @param {string} [args.occasion]
 * @param {string} [args.story]
 * @param {string} [args.customerEmail]
 * @param {'m'|'f'|''} [args.vocalGender]       Optional Suno hint
 * @param {string} [args.emotionalModifiers]    From the lyrics step
 * @param {string} [args.language]              'es' | 'en' | 'spanglish'
 * @returns {Promise<{ok:boolean, cloned_voice_song_id?:string,
 *                    kie_task_id?:string, status?:string,
 *                    error?:string, message?:string}>}
 */
export async function generateClonedVoiceSong(args) {
  const res = await fetch(`${FN_BASE}/generate-cloned-voice-song`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      voice_sample_id: args.voiceSampleId,
      lyrics: args.lyrics,
      title: args.title,
      genre_slug: args.genreSlug,
      recipient_name: args.recipientName,
      relationship: args.relationship,
      occasion: args.occasion,
      story: args.story,
      customer_email: args.customerEmail,
      vocal_gender: args.vocalGender || undefined,
      emotional_modifiers: args.emotionalModifiers,
      language: args.language || 'es',
    }),
  });

  const data = (await safeJson(res)) || {};
  if (!res.ok) {
    return { ok: false, error: data.error || `http_${res.status}`, message: data.message };
  }
  return { ok: true, ...data };
}

/**
 * Poll the cloned_voice_songs row + Kie for current status.
 *
 * @param {string} clonedVoiceSongId
 * @returns {Promise<{ok:boolean, status?:string, audio_urls?:string[],
 *                    title?:string, lyrics?:string, error_message?:string,
 *                    error?:string, message?:string}>}
 */
export async function getClonedVoiceStatus(clonedVoiceSongId) {
  const res = await fetch(`${FN_BASE}/cloned-voice-status`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cloned_voice_song_id: clonedVoiceSongId }),
  });

  const data = (await safeJson(res)) || {};
  if (!res.ok) {
    return { ok: false, error: data.error || `http_${res.status}`, message: data.message };
  }
  return { ok: true, ...data };
}

// Re-export the shared supabase client so consumers can subscribe to
// realtime updates on cloned_voice_songs later if we add them.
export { supabase };
