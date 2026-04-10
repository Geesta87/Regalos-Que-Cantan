// supabase/functions/_shared/store-video.ts
// Shared helper to download a Shotstack-rendered video and persist it
// to the Supabase `videos` storage bucket.
//
// Strategy (in order):
//   1. STREAMING S3 PUT via Supabase Storage's S3-compatible endpoint.
//      Uses constant memory (no full buffering). Requires the env vars
//      SUPABASE_S3_ACCESS_KEY_ID + SUPABASE_S3_SECRET_ACCESS_KEY which
//      can be created in the Supabase dashboard under Storage → S3 Connection.
//   2. SINGLE-BUFFER Blob upload via the Storage SDK as a fallback.
//      Holds the file in memory once (instead of 3x like the old code did)
//      so videos up to ~150MB fit within the edge-function memory cap.
//
// IMPORTANT: NEVER fall back to keeping the temporary Shotstack URL —
// those URLs expire and customers lose their video. If both upload paths
// fail, throw so the caller leaves status as "processing" and we retry
// on the next poll.

import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const S3_ACCESS_KEY_ID = Deno.env.get('SUPABASE_S3_ACCESS_KEY_ID') || '';
const S3_SECRET_ACCESS_KEY = Deno.env.get('SUPABASE_S3_SECRET_ACCESS_KEY') || '';
// Default region must match the Supabase project region — set
// SUPABASE_S3_REGION if your project lives elsewhere.
const S3_REGION = Deno.env.get('SUPABASE_S3_REGION') || 'us-west-1';

const VIDEOS_BUCKET = 'videos';

export interface StoreVideoResult {
  publicUrl: string;
  method: 's3-stream' | 'sdk-buffer';
  bytes: number;
}

/**
 * Download a video from `sourceUrl` and persist it as `${fileKey}` inside
 * the `videos` bucket. Returns the permanent public URL.
 *
 * @param fileKey   The object key inside the bucket (e.g. `${songId}.mp4`).
 * @param sourceUrl The Shotstack temporary URL to copy from.
 * @param supabase  Supabase service-role client (used by the SDK fallback).
 */
export async function storeRenderedVideo(
  fileKey: string,
  sourceUrl: string,
  supabase: any,
): Promise<StoreVideoResult> {
  // Try the streaming S3 path first when credentials are configured.
  if (S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY) {
    try {
      const result = await streamUploadViaS3(fileKey, sourceUrl);
      console.log(
        `[store-video] S3 stream OK: ${fileKey} (${result.bytes} bytes)`,
      );
      return result;
    } catch (err) {
      console.error(
        `[store-video] S3 stream FAILED for ${fileKey}, falling back to SDK buffer:`,
        err,
      );
    }
  } else {
    console.warn(
      '[store-video] SUPABASE_S3_ACCESS_KEY_ID/SECRET not set — using SDK buffer path. ' +
      'Configure S3 credentials in Supabase secrets to enable streaming for large videos.',
    );
  }

  // Fallback: single-buffer Blob upload via supabase-js.
  const result = await sdkBufferUpload(fileKey, sourceUrl, supabase);
  console.log(
    `[store-video] SDK buffer OK: ${fileKey} (${result.bytes} bytes)`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Path 1 — Streaming S3 PUT via Supabase Storage's S3-compatible endpoint.
// ---------------------------------------------------------------------------
async function streamUploadViaS3(
  fileKey: string,
  sourceUrl: string,
): Promise<StoreVideoResult> {
  const aws = new AwsClient({
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    region: S3_REGION,
    service: 's3',
  });

  const videoResponse = await fetch(sourceUrl);
  if (!videoResponse.ok || !videoResponse.body) {
    throw new Error(
      `Failed to fetch source video: HTTP ${videoResponse.status}`,
    );
  }

  const contentLength = videoResponse.headers.get('content-length');
  if (!contentLength) {
    // S3 PUT requires Content-Length when streaming a body. If Shotstack
    // didn't return one, abort the streaming path so we fall back to SDK.
    throw new Error('Source response missing Content-Length header');
  }

  // Supabase S3 endpoint format:
  //   https://<project-ref>.supabase.co/storage/v1/s3/<bucket>/<key>
  const projectHost = new URL(SUPABASE_URL).host;
  const s3Url =
    `https://${projectHost}/storage/v1/s3/${VIDEOS_BUCKET}/${fileKey}`;

  const uploadRes = await aws.fetch(s3Url, {
    method: 'PUT',
    body: videoResponse.body,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': contentLength,
      // UNSIGNED-PAYLOAD lets us PUT a stream without pre-hashing the body.
      // The transport is HTTPS so the body is still confidential in transit.
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '<no body>');
    throw new Error(`S3 PUT failed: HTTP ${uploadRes.status} — ${errText}`);
  }

  return {
    publicUrl:
      `${SUPABASE_URL}/storage/v1/object/public/${VIDEOS_BUCKET}/${fileKey}`,
    method: 's3-stream',
    bytes: Number(contentLength),
  };
}

// ---------------------------------------------------------------------------
// Path 2 — Single-buffer Blob upload via supabase-js.
// Replaces the old triple-buffer approach (Blob → ArrayBuffer → Uint8Array)
// that was OOM-ing the edge function on videos > ~80MB.
// ---------------------------------------------------------------------------
async function sdkBufferUpload(
  fileKey: string,
  sourceUrl: string,
  supabase: any,
): Promise<StoreVideoResult> {
  const videoResponse = await fetch(sourceUrl);
  if (!videoResponse.ok) {
    throw new Error(
      `Failed to fetch source video: HTTP ${videoResponse.status}`,
    );
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
