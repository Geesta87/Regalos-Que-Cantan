// supabase/functions/fetch-karaoke/index.ts
//
// ⚠️ LEGACY / NOT THE PRODUCTION WORKER. The live karaoke job is the Vercel
// function at api/karaoke-fetch.js — stripe-webhook calls THAT one. This Deno
// twin remains only for local invocation/testing and is intentionally out of
// sync: the Vercel worker re-encodes the instrumental to MP3 and stores a
// regalosquecantan.com proxy URL, whereas this one still uploads raw .wav and
// returns the raw *.supabase.co storage URL. Do NOT wire this back into the
// payment flow without bringing it to parity first.
//
// Fetches and stores the karaoke (instrumental) version of a completed song.
//
// Why this function exists
// ------------------------
// Customers can buy a $7.99 karaoke add-on. When they pay, stripe-webhook
// fires this function with the song's UUID. We then:
//   1. Look up the Mureka song_id stored on the row
//   2. Call useapi.net POST /v1/mureka/music/download with type=stem
//   3. Download the resulting ZIP (contains 4 stems + full WAV + full MP3)
//   4. Extract ONLY instrumental.wav
//   5. Upload it to Supabase Storage (bucket: audio, path: karaoke/<uuid>.wav)
//   6. Save the public URL on the song row and mark karaoke_status = 'ready'
//
// Idempotency
// -----------
// Stripe webhooks can fire the same event multiple times. The function checks
// karaoke_status before doing anything expensive:
//   - 'ready'   → no-op, return existing URL (already done)
//   - 'pending' → no-op, return progress (another invocation is working on it)
//   - 'failed' or NULL → proceed with fetch
//
// Failure handling
// ----------------
// The customer paid. If we can't fetch the karaoke, we MUST NOT leave the row
// in a bad state. On any error we set karaoke_status = 'failed' so an ops
// retry path (or future re-run) can pick it up. The error is logged, the
// customer's original song flow is untouched, and the function returns 500
// to whatever called it (stripe-webhook ignores the result intentionally —
// this is fire-and-forget by design).
//
// Auth
// ----
// Called server-to-server from stripe-webhook (service-role context) or
// from manual ops invocations (curl). verify_jwt = false in config.toml.
// We do a soft check on the Authorization header to reject obvious abuse,
// but the real gate is "is the song paid for AND was karaoke purchased."
//
// Deploy with: supabase functions deploy fetch-karaoke --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// fflate's streaming Unzip processes the ZIP chunk-by-chunk so we never hold
// the full 195MB ZIP in memory at once. JSZip (used initially) exceeded the
// Supabase Edge Function 256MB memory cap and crashed with WORKER_RESOURCE_LIMIT.
import { Unzip, UnzipInflate } from 'npm:fflate@0.8.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const USEAPI_TOKEN = Deno.env.get('USEAPI_TOKEN');
const STORAGE_BUCKET = 'audio'; // same bucket existing songs use

interface DownloadResponse {
  oss_key: string; // confusingly named — it's actually a full https URL to the stems ZIP
}

interface SongRow {
  id: string;
  status: string;
  mureka_payload: string | null;
  karaoke_url: string | null;
  karaoke_status: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Pull the Mureka song_id out of the stringified mureka_payload column.
// (Stored by mureka-useapi-callback as JSON.stringify(apiSong).)
function extractMurekaSongId(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed?.song_id ?? null;
  } catch {
    return null;
  }
}

// Step: request the stems ZIP URL from useapi.net.
// Endpoint reverse-engineered via probe (see mureka-voice-clone-test/probe-stems.mjs):
//   POST /v1/mureka/music/download  body={ song_id, type: "stem" }
//   200 → { oss_key: "https://static-cos.mureka.ai/.../stems.zip" }
async function requestStemsZipUrl(murekaSongId: string): Promise<string> {
  const resp = await fetch('https://api.useapi.net/v1/mureka/music/download', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${USEAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ song_id: murekaSongId, type: 'stem' }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '<no body>');
    throw new Error(`useapi.net /music/download ${resp.status}: ${errText.substring(0, 300)}`);
  }
  const data = (await resp.json()) as DownloadResponse;
  if (!data?.oss_key) {
    throw new Error(`useapi.net /music/download returned no oss_key: ${JSON.stringify(data)}`);
  }
  return data.oss_key;
}

// Step: stream the ZIP and extract just instrumental.wav.
// The full ZIP is ~195MB. Loading the whole thing into memory (e.g. with
// JSZip) exceeds the Supabase Edge Function 256MB cap and crashes with
// WORKER_RESOURCE_LIMIT — confirmed in production on 2026-05-26.
//
// Streaming approach: pull the ZIP body as a stream, feed each chunk into
// fflate's Unzip parser. For every file announcement, we either capture
// (instrumental.wav) or drop. Peak memory ≈ the size of one stem (~45MB)
// plus small in-flight chunks. Well under the 256MB cap.
async function downloadAndExtractInstrumental(zipUrl: string): Promise<Uint8Array> {
  const resp = await fetch(zipUrl);
  if (!resp.ok) {
    throw new Error(`Mureka CDN returned ${resp.status} fetching stems zip`);
  }
  if (!resp.body) {
    throw new Error('Mureka CDN response had no body');
  }

  const seenFiles: string[] = [];
  // Single growable buffer. Mureka's instrumental.wav is ~44MB; pre-allocate
  // 50MB to avoid any growth, then slice() at the end so we don't ship the
  // overallocation to the uploader. Critical: avoid chunks[]+concat which
  // doubles memory and tipped us over the 256MB Edge Function ceiling.
  let outBuffer = new Uint8Array(50 * 1024 * 1024);
  let outOffset = 0;
  let foundInstrumental = false;

  return new Promise<Uint8Array>((resolve, reject) => {
    const unzip = new Unzip((file) => {
      seenFiles.push(file.name);
      if (file.name === 'instrumental.wav') {
        foundInstrumental = true;
        file.ondata = (err, data, final) => {
          if (err) { reject(new Error(`Unzip stream error: ${err.message}`)); return; }
          // Grow on the rare chance instrumental.wav exceeds 50MB
          if (outOffset + data.byteLength > outBuffer.byteLength) {
            const grown = new Uint8Array(outBuffer.byteLength * 2);
            grown.set(outBuffer);
            outBuffer = grown;
          }
          outBuffer.set(data, outOffset);
          outOffset += data.byteLength;
          if (final) {
            // slice() so the uploader only ships the used portion
            const wav = outBuffer.slice(0, outOffset);
            outBuffer = new Uint8Array(0); // free the working buffer
            console.log(`instrumental.wav extracted (streamed): ${(wav.byteLength / 1024 / 1024).toFixed(1)} MB`);
            resolve(wav);
          }
        };
        // file.start() must come AFTER ondata is set. Pass UnzipInflate
        // explicitly so DEFLATE-compressed entries decode.
        file.start(UnzipInflate);
      }
      // If we don't call file.start(), fflate skips this file's bytes
      // entirely — no buffering, no decoding, no handler required.
    });
    unzip.register(UnzipInflate);

    // Pump the response body into the unzip parser.
    (async () => {
      const reader = resp.body!.getReader();
      let bytesIn = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            unzip.push(new Uint8Array(0), true);
            // If we finished the whole ZIP and never saw instrumental.wav,
            // bail out so the caller can mark karaoke_status='failed'.
            if (!foundInstrumental) {
              reject(new Error(`instrumental.wav not in ZIP. Saw: ${seenFiles.join(', ')}`));
            }
            return;
          }
          bytesIn += value.byteLength;
          unzip.push(value, false);
        }
      } catch (e: any) {
        reject(new Error(`ZIP stream read failed at ${bytesIn} bytes: ${e?.message || e}`));
      } finally {
        console.log(`ZIP stream complete: ${(bytesIn / 1024 / 1024).toFixed(1)} MB read`);
      }
    })();
  });
}

// Step: upload to Supabase Storage and return the public URL.
async function uploadKaraokeToStorage(
  supabase: ReturnType<typeof createClient>,
  songId: string,
  wavBytes: Uint8Array,
): Promise<string> {
  const path = `karaoke/${songId}.wav`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, wavBytes, {
      contentType: 'audio/wav',
      cacheControl: '31536000', // 1 year — content is immutable per song id
      upsert: true,             // allow safe retry over a previous failed upload
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Storage returned no publicUrl');
  return data.publicUrl;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Env sanity
  if (!USEAPI_TOKEN) {
    return json({ success: false, error: 'USEAPI_TOKEN not configured' }, 500);
  }

  // Parse request
  let songId: string;
  try {
    const body = await req.json();
    songId = body?.songId || body?.song_id;
    if (!songId || typeof songId !== 'string') {
      return json({ success: false, error: 'songId (string) is required' }, 400);
    }
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log(`=== FETCH-KARAOKE === songId=${songId}`);

  // 1. Look up the song
  const { data: song, error: lookupErr } = await supabase
    .from('songs')
    .select('id, status, mureka_payload, karaoke_url, karaoke_status')
    .eq('id', songId)
    .single<SongRow>();

  if (lookupErr || !song) {
    return json({ success: false, error: `Song not found: ${lookupErr?.message || 'no row'}` }, 404);
  }

  // 2. Idempotency — already done or in flight?
  if (song.karaoke_status === 'ready' && song.karaoke_url) {
    console.log(`Song ${songId} karaoke already ready — no-op`);
    return json({ success: true, action: 'already_ready', karaoke_url: song.karaoke_url });
  }
  if (song.karaoke_status === 'pending') {
    console.log(`Song ${songId} karaoke already pending — no-op (another worker has it)`);
    return json({ success: true, action: 'already_pending' });
  }

  // 3. Validate the song is in a state we can fetch from
  if (song.status !== 'completed') {
    return json({ success: false, error: `Song not completed yet (status=${song.status})` }, 409);
  }
  const murekaSongId = extractMurekaSongId(song.mureka_payload);
  if (!murekaSongId) {
    return json({ success: false, error: 'Song has no Mureka song_id in payload' }, 409);
  }

  // 4. Claim the work — atomic-ish transition to 'pending'.
  // (Conflict here means another worker beat us to it; we treat that as success.)
  const { error: claimErr } = await supabase
    .from('songs')
    .update({ karaoke_status: 'pending' })
    .eq('id', songId)
    .is('karaoke_url', null)
    .or('karaoke_status.is.null,karaoke_status.eq.failed');
  if (claimErr) {
    console.warn(`Claim race for ${songId}: ${claimErr.message}`);
    // Continue anyway — the worst case is double-work, not data loss
  }

  // 5. Do the work, with all failures funneling to status='failed'
  try {
    console.log(`Requesting stems for Mureka song ${murekaSongId}`);
    const zipUrl = await requestStemsZipUrl(murekaSongId);

    console.log(`Downloading + extracting instrumental from ${zipUrl}`);
    const wav = await downloadAndExtractInstrumental(zipUrl);

    console.log(`Uploading karaoke to Storage`);
    const publicUrl = await uploadKaraokeToStorage(supabase, songId, wav);

    // 6. Mark ready
    const { error: updateErr } = await supabase
      .from('songs')
      .update({ karaoke_url: publicUrl, karaoke_status: 'ready' })
      .eq('id', songId);
    if (updateErr) throw new Error(`Final DB update failed: ${updateErr.message}`);

    console.log(`✅ Karaoke ready for song ${songId}: ${publicUrl}`);
    return json({ success: true, action: 'fetched', karaoke_url: publicUrl });
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.error(`❌ fetch-karaoke failed for ${songId}: ${msg}`);

    // Mark failed so ops can retry; keep karaoke_url NULL
    await supabase
      .from('songs')
      .update({ karaoke_status: 'failed' })
      .eq('id', songId);

    return json({ success: false, error: msg }, 500);
  }
});
