// supabase/functions/upload-customer-voice/index.ts
//
// Receives a customer voice recording (multipart form upload), stores it in
// the private 'customer-voices' Storage bucket, inserts a row into
// public.voice_samples, and returns a short-lived signed URL the frontend
// can hand to the Suno generation step.
//
// Why this function exists
// ------------------------
// The /clonamivoz route lets a customer record 45-90s of their voice. That
// audio has to land somewhere Suno (via Kie.ai) can fetch it from. We use
// Supabase Storage with a private bucket and signed URLs (vs a public host
// like tmpfiles.org used in the standalone test app) for:
//   - Privacy: voice biometric data should not be on a free anonymous host
//   - Reliability: Suno's audio fetcher works reliably with Supabase URLs
//   - Auto-expiry: signed URLs expire after 1h, voice files auto-purge after
//     30 days via the pg_cron job from migration 20260527_clonamivoz_voice_samples.sql
//
// Request
// -------
// POST /functions/v1/upload-customer-voice
//   Headers: Authorization: Bearer <supabase anon key>
//            Content-Type: multipart/form-data
//   Body (form):
//     file:           the audio file (required, audio/mpeg|webm|mp4, < 10MB)
//     customer_email: customer email (optional, free-form)
//     duration_seconds: estimated duration from frontend (optional)
//
// Response (200)
// --------------
//   { voice_sample_id, public_url, storage_path, expires_in_seconds }
//
// Response (4xx/5xx)
// ------------------
//   { error: '<code>', message: '<human>' }
//
// Auth
// ----
// verify_jwt = true (see supabase/config.toml). Frontend sends the anon JWT;
// the platform gateway validates it. This is identical to recover-song's
// auth pattern — public-facing self-service endpoint, no logged-in user.
//
// Deploy with: supabase functions deploy upload-customer-voice --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const STORAGE_BUCKET = 'customer-voices';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB hard cap (matches bucket config)
const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour — long enough for Suno to fetch

// Accepted MIME types match what the bucket allows. Browser MediaRecorder
// produces audio/webm on Chrome/Firefox and audio/mp4 on Safari. We also
// accept audio/mpeg in case anyone uploads a pre-encoded MP3.
const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',           // common alias some browsers use
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/x-m4a',         // Safari sometimes
]);

// Map MIME → file extension for the Storage path.
function extFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  return 'bin';
}

// Lightweight email shape check. We don't reject — just normalize/trim.
// Stricter validation happens at the order step.
function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  if (!e || !e.includes('@')) return null;
  return e.slice(0, 200);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed', message: 'Use POST.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- parse multipart body ----------------
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: 'invalid_body',
        message: 'Expected multipart/form-data with a "file" field.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return new Response(
      JSON.stringify({ error: 'file_required', message: 'Missing "file" field.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- validate ----------------
  if (file.size === 0) {
    return new Response(
      JSON.stringify({ error: 'empty_file', message: 'Uploaded file is empty.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (file.size > MAX_BYTES) {
    return new Response(
      JSON.stringify({
        error: 'file_too_large',
        message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum allowed is 10 MB.`,
      }),
      { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // MIME validation. Some browsers send the type with a codec suffix
  // (audio/webm;codecs=opus); we normalize before checking.
  const rawMime = (file.type || '').toLowerCase();
  const baseMime = rawMime.split(';')[0].trim();
  if (!ALLOWED_MIME_TYPES.has(rawMime) && !ALLOWED_MIME_TYPES.has(baseMime)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_mime_type',
        message: `Uploaded MIME type "${rawMime}" is not accepted. Allowed: ${Array.from(ALLOWED_MIME_TYPES).join(', ')}`,
      }),
      { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const customerEmail = normalizeEmail(form.get('customer_email')?.toString());
  const durationRaw = form.get('duration_seconds')?.toString();
  const durationSeconds = durationRaw ? Number.parseFloat(durationRaw) : null;

  // ---------------- upload to Storage ----------------
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const uuid = crypto.randomUUID();
  const ext = extFor(baseMime);
  const storagePath = `${uuid}.${ext}`;

  const fileBytes = new Uint8Array(await file.arrayBuffer());

  const uploadRes = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBytes, {
      contentType: baseMime,
      upsert: false,
    });

  if (uploadRes.error) {
    console.error('[upload-customer-voice] Storage upload failed:', uploadRes.error);
    return new Response(
      JSON.stringify({
        error: 'storage_upload_failed',
        message: uploadRes.error.message || 'Failed to store the audio file.',
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- signed URL for Suno fetch ----------------
  const signedRes = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (signedRes.error || !signedRes.data?.signedUrl) {
    console.error('[upload-customer-voice] createSignedUrl failed:', signedRes.error);
    // Best-effort: try to delete the just-uploaded file so we don't leak it.
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    return new Response(
      JSON.stringify({
        error: 'signed_url_failed',
        message: signedRes.error?.message || 'Could not produce a fetchable URL.',
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const publicUrl = signedRes.data.signedUrl;

  // ---------------- insert voice_samples row ----------------
  const { data: row, error: insertError } = await supabase
    .from('voice_samples')
    .insert({
      storage_path: storagePath,
      public_url: publicUrl,
      duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      source_mime: baseMime,
      source_size_bytes: file.size,
      customer_email: customerEmail,
    })
    .select('id, delete_at')
    .single();

  if (insertError || !row) {
    console.error('[upload-customer-voice] DB insert failed:', insertError);
    // Best-effort cleanup: drop the Storage file so the DB row + file don't drift.
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    return new Response(
      JSON.stringify({
        error: 'db_insert_failed',
        message: insertError?.message || 'Could not record the voice sample.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- success ----------------
  return new Response(
    JSON.stringify({
      voice_sample_id: row.id,
      storage_path: storagePath,
      public_url: publicUrl,
      expires_in_seconds: SIGNED_URL_TTL_SECONDS,
      delete_at: row.delete_at,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
