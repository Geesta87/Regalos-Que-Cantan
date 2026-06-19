// supabase/functions/_shared/store-video.ts
// Shared helper to download a Shotstack-rendered video and persist it
// to the Supabase `videos` storage bucket.
//
// Strategy (in order):
//   1. TUS RESUMABLE upload via Supabase Storage's resumable endpoint.
//      Reads the source stream in 6 MB chunks and PATCHes each one.
//      Maximum in-memory usage ≈ 12 MB regardless of file size.
//      Required for files > 50 MB (Supabase's REST POST limit).
//   2. STREAMING REST PUT via Supabase Storage's object endpoint.
//      Pipes the ReadableStream directly — works for files ≤ 50 MB.
//   3. SINGLE-BUFFER Blob upload via the Storage SDK.
//      Last resort — loads full file into memory (fails on large videos).
//
// IMPORTANT: NEVER fall back to keeping the temporary Shotstack URL —
// those URLs expire and customers lose their video. If all paths fail,
// throw so the caller leaves status as "processing" and we retry.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Auth token for the raw storage REST/TUS fetch calls.
// Both SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY in this project's edge
// env are the newer NON-JWS key format (sb_secret_/sb_publishable_), which the
// storage REST/TUS endpoints reject as "Invalid Compact JWS" when sent as a
// Bearer token — that silently broke every streaming upload and left large
// videos stuck in "processing". The endpoints DO accept the legacy JWT anon
// key. It's a public key (already shipped in the web app bundle), so it's safe
// to embed here. Allow an env override if a JWT key is ever provided.
const STORAGE_AUTH_KEY = Deno.env.get('STORAGE_JWT_ANON_KEY')
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

const VIDEOS_BUCKET = 'videos';

// TUS chunk size: 6 MB keeps peak RAM well under Deno's ~150 MB worker limit.
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

export interface StoreVideoResult {
  publicUrl: string;
  method: 'tus-resumable' | 'rest-stream' | 'sdk-buffer';
  bytes: number;
}

/**
 * Download a video from `sourceUrl` and persist it as `${fileKey}` inside
 * the `videos` bucket. Returns the permanent public URL.
 */
export async function storeRenderedVideo(
  fileKey: string,
  sourceUrl: string,
  supabase: any,
): Promise<StoreVideoResult> {
  // Collect each path's failure so the final thrown error (which lands in the
  // video_order's error_message) names exactly WHY streaming failed — otherwise
  // we only see the generic last-resort message and can't diagnose.
  let tusErr = '';
  let restErr = '';

  // ── Path 1: TUS resumable (handles any file size, ≈12 MB peak RAM) ──────────
  try {
    const result = await tusUpload(fileKey, sourceUrl);
    console.log(`[store-video] TUS OK: ${fileKey} (${result.bytes} bytes)`);
    return result;
  } catch (err) {
    tusErr = (err as Error)?.message || String(err);
    console.error(`[store-video] TUS FAILED for ${fileKey}, trying REST stream:`, err);
  }

  // ── Path 2: REST streaming (works for files ≤ ~50 MB) ───────────────────────
  try {
    const result = await restStreamUpload(fileKey, sourceUrl);
    console.log(`[store-video] REST stream OK: ${fileKey} (${result.bytes} bytes)`);
    return result;
  } catch (err) {
    restErr = (err as Error)?.message || String(err);
    console.error(`[store-video] REST stream FAILED for ${fileKey}, trying SDK buffer:`, err);
  }

  // ── Path 3: SDK buffer (last resort — refuses large files to avoid OOM) ──────
  try {
    const result = await sdkBufferUpload(fileKey, sourceUrl, supabase);
    console.log(`[store-video] SDK buffer OK: ${fileKey} (${result.bytes} bytes)`);
    return result;
  } catch (bufErr) {
    const bufMsg = (bufErr as Error)?.message || String(bufErr);
    // Surface all three failures together so error_message is actionable.
    throw new Error(`all upload paths failed — TUS: [${tusErr}] | REST: [${restErr}] | buffer: [${bufMsg}]`);
  }
}

// ---------------------------------------------------------------------------
// Path 1 — TUS resumable upload (Supabase Storage tus protocol).
// Reads the stream in TUS_CHUNK_SIZE chunks and PATCHes each one.
// Peak RAM usage = ~2 × TUS_CHUNK_SIZE = ~12 MB, regardless of file size.
// ---------------------------------------------------------------------------
async function tusUpload(
  fileKey: string,
  sourceUrl: string,
): Promise<StoreVideoResult> {
  const videoResponse = await fetch(sourceUrl);
  if (!videoResponse.ok || !videoResponse.body) {
    throw new Error(`Failed to fetch source video: HTTP ${videoResponse.status}`);
  }

  // TUS needs the total size up front. The streaming GET sometimes omits
  // Content-Length (chunked transfer / proxied S3), which previously made TUS
  // bail straight to the in-memory blob fallback and OOM on large videos. If
  // the GET didn't include it, fetch it with a cheap HEAD request instead.
  let contentLengthStr = videoResponse.headers.get('content-length');
  if (!contentLengthStr) {
    try {
      const headRes = await fetch(sourceUrl, { method: 'HEAD' });
      contentLengthStr = headRes.headers.get('content-length');
    } catch (_) { /* fall through to the error below */ }
  }
  if (!contentLengthStr) {
    throw new Error('Source response missing Content-Length (GET and HEAD) — required for TUS upload');
  }
  const totalBytes = parseInt(contentLengthStr, 10);

  // Build TUS Upload-Metadata (base64-encoded key/value pairs).
  // IMPORTANT: Supabase Storage's resumable (TUS) endpoint keys off `objectName`
  // (the full object path within the bucket) — NOT `filename`. Sending `filename`
  // made every resumable upload fail, so large videos fell through to the REST
  // and in-memory buffer paths and never persisted. `objectName` must be the
  // full fileKey (including any subfolders), not just the basename.
  const metadata = [
    `bucketName ${btoa(VIDEOS_BUCKET)}`,
    `objectName ${btoa(fileKey)}`,
    `contentType ${btoa('video/mp4')}`,
    `cacheControl ${btoa('31536000')}`,
  ].join(',');

  // ── Step 1: Create the TUS upload session ──
  const createRes = await fetch(`${SUPABASE_URL}/storage/v1/upload/resumable`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STORAGE_AUTH_KEY}`,
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Length': contentLengthStr,
      'Upload-Metadata': metadata,
      'Tus-Resumable': '1.0.0',
      'x-upsert': 'true',
    },
  });

  if (!createRes.ok && createRes.status !== 201) {
    const body = await createRes.text().catch(() => '<no body>');
    throw new Error(`TUS create session failed: HTTP ${createRes.status} — ${body}`);
  }

  // The Location header contains the upload URL (may be relative or absolute).
  const location = createRes.headers.get('Location');
  if (!location) {
    throw new Error('TUS create session missing Location header');
  }
  const uploadUrl = location.startsWith('http')
    ? location
    : `${SUPABASE_URL}${location}`;

  // ── Step 2: Upload in chunks ──
  const reader = videoResponse.body.getReader();
  let offset = 0;

  // `pending` holds data read from the stream that hasn't been sent yet.
  // It never exceeds TUS_CHUNK_SIZE bytes.
  let pending = new Uint8Array(0);
  let streamDone = false;

  while (!streamDone || pending.length > 0) {
    // Fill `pending` up to TUS_CHUNK_SIZE.
    while (pending.length < TUS_CHUNK_SIZE && !streamDone) {
      const { value, done } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending, 0);
      merged.set(value, pending.length);
      pending = merged;
    }

    if (pending.length === 0) break;

    // Slice exactly one chunk to PATCH.
    const chunk = pending.slice(0, TUS_CHUNK_SIZE);
    pending = pending.slice(TUS_CHUNK_SIZE);

    const patchRes = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${STORAGE_AUTH_KEY}`,
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
        'Tus-Resumable': '1.0.0',
        'Content-Length': String(chunk.length),
      },
      body: chunk,
    });

    if (!patchRes.ok && patchRes.status !== 204) {
      const body = await patchRes.text().catch(() => '<no body>');
      throw new Error(
        `TUS PATCH failed at offset ${offset}/${totalBytes}: HTTP ${patchRes.status} — ${body}`,
      );
    }

    offset += chunk.length;
    console.log(`[store-video] TUS progress: ${offset}/${totalBytes} bytes (${Math.round(offset / totalBytes * 100)}%)`);
  }

  return {
    publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${VIDEOS_BUCKET}/${fileKey}`,
    method: 'tus-resumable',
    bytes: totalBytes,
  };
}

// ---------------------------------------------------------------------------
// Path 2 — Streaming REST PUT via Supabase Storage object endpoint.
// Pipes the Shotstack ReadableStream directly to Supabase — no buffering.
// Works for files ≤ ~50 MB (Supabase's REST POST limit).
// ---------------------------------------------------------------------------
async function restStreamUpload(
  fileKey: string,
  sourceUrl: string,
): Promise<StoreVideoResult> {
  const videoResponse = await fetch(sourceUrl);
  if (!videoResponse.ok || !videoResponse.body) {
    throw new Error(`Failed to fetch source video: HTTP ${videoResponse.status}`);
  }

  const contentLength = videoResponse.headers.get('content-length');

  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${VIDEOS_BUCKET}/${fileKey}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STORAGE_AUTH_KEY}`,
      'Content-Type': 'video/mp4',
      'Cache-Control': '31536000',
      'x-upsert': 'true',
      ...(contentLength ? { 'Content-Length': contentLength } : {}),
    },
    body: videoResponse.body,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '<no body>');
    throw new Error(`REST upload failed: HTTP ${uploadRes.status} — ${errText}`);
  }

  return {
    publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${VIDEOS_BUCKET}/${fileKey}`,
    method: 'rest-stream',
    bytes: Number(contentLength || 0),
  };
}

// ---------------------------------------------------------------------------
// Path 3 — Single-buffer Blob upload via supabase-js (last resort).
// ---------------------------------------------------------------------------
async function sdkBufferUpload(
  fileKey: string,
  sourceUrl: string,
  supabase: any,
): Promise<StoreVideoResult> {
  // Guard: this path loads the ENTIRE file into memory. On the edge runtime
  // (~150 MB worker limit) buffering a large video crashes the whole function
  // (WORKER_RESOURCE_LIMIT / HTTP 546), which is worse than failing cleanly —
  // a crash takes down the callback/poll mid-flight and leaves the order stuck.
  // Refuse anything that won't comfortably fit so the caller can retry/recover.
  const MAX_BUFFER_BYTES = 45 * 1024 * 1024; // 45 MB
  const headRes = await fetch(sourceUrl, { method: 'HEAD' }).catch(() => null);
  const headLen = headRes ? parseInt(headRes.headers.get('content-length') || '0', 10) : 0;
  if (headLen > MAX_BUFFER_BYTES) {
    throw new Error(
      `Refusing in-memory buffer for ${headLen} bytes (> ${MAX_BUFFER_BYTES}); ` +
      `TUS/REST streaming must handle large files. Leaving for retry to avoid OOM crash.`,
    );
  }

  const videoResponse = await fetch(sourceUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to fetch source video: HTTP ${videoResponse.status}`);
  }

  const blob = await videoResponse.blob();
  const bytes = blob.size;

  const { error: uploadError } = await supabase.storage
    .from(VIDEOS_BUCKET)
    .upload(fileKey, blob, {
      contentType: 'video/mp4',
      cacheControl: '31536000',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(VIDEOS_BUCKET)
    .getPublicUrl(fileKey);

  return {
    publicUrl: urlData.publicUrl,
    method: 'sdk-buffer',
    bytes,
  };
}
