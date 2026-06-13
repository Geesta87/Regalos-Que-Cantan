// Vercel serverless function — karaoke (instrumental) extraction.
//
// WHY THIS LIVES ON VERCEL (not Supabase)
// ----------------------------------------
// Mureka's stem download returns a single ~195MB ZIP containing 7 files
// (4 stems + 2 full-song variants + 1 "other.wav"). We only need
// instrumental.wav (~44MB). The Supabase Edge Function we first built for
// this kept hitting WORKER_RESOURCE_LIMIT — even with streaming extraction,
// the 256MB Edge runtime cap was too tight once you add ZIP parser state +
// the extracted WAV in memory + Supabase Storage upload buffering.
//
// Vercel Serverless Functions have 1024MB default memory (configurable to
// 3GB), so the extraction comfortably fits with the simple JSZip API. This
// function is the production worker; the Supabase-side function still exists
// for local invocation/testing but stripe-webhook now hits THIS one.
//
// CONTRACT
// --------
//   POST /api/karaoke-fetch
//   body: { songId: "<rqc song uuid>", secret: "<KARAOKE_TRIGGER_SECRET>" }
//   response: { success: true, karaoke_url: "https://regalosquecantan.com/karaoke/<songId>.mp3" }
//
// The instrumental is re-encoded WAV→MP3 before upload, and the returned link is
// our own domain (vercel.json rewrites /karaoke/<file> to Supabase Storage).
//
// Idempotent — calling twice for the same songId is a no-op (returns the
// existing karaoke_url). Failures funnel to songs.karaoke_status='failed' so
// ops can retry without breaking the customer's payment flow.

import JSZip from 'jszip';
import { Mp3Encoder } from '@breezystack/lamejs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USEAPI_TOKEN = process.env.USEAPI_TOKEN;
const KIE_API_KEY = process.env.KIE_API_KEY;
const KARAOKE_TRIGGER_SECRET = process.env.KARAOKE_TRIGGER_SECRET;
const STORAGE_BUCKET = 'audio';

// Public site base. The karaoke link we hand customers/admins points at our own
// domain, and vercel.json rewrites /karaoke/<file> to the Supabase Storage object
// (same pattern as the existing /videos/:songId proxy). Keeps the brand domain on
// the link instead of leaking the raw *.supabase.co storage URL.
const PUBLIC_BASE_URL = (process.env.PUBLIC_SITE_URL || 'https://regalosquecantan.com').replace(/\/$/, '');

// MP3 bitrate for the karaoke download. Mureka ships the instrumental as a ~44MB
// 16-bit WAV; re-encoding to 192kbps MP3 drops it to ~5MB with no audible loss for
// a backing track, so the customer download is fast.
const KARAOKE_MP3_KBPS = 192;

// Vercel function config — bump memory and timeout for the extraction work.
export const config = {
  maxDuration: 300, // 5 minutes (Vercel Pro allows up to 900s)
};

async function supa(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.method === 'PATCH' ? 'return=representation' : '',
      ...(init.headers || {}),
    },
  });
  return res;
}

async function markFailed(songId, errorMsg) {
  try {
    await supa(`/songs?id=eq.${songId}`, {
      method: 'PATCH',
      body: JSON.stringify({ karaoke_status: 'failed' }),
    });
    console.error(`[karaoke-fetch] song ${songId} marked failed:`, errorMsg);
  } catch (e) {
    console.error(`[karaoke-fetch] failed to mark song ${songId} as failed:`, e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Suno (Kie) stem separation — for songs generated on the Kie provider.
// Kie has a dedicated vocal-removal endpoint (validated 2026-06-12): submit
// taskId+audioId, poll until SUCCESS, download instrumentalUrl (already MP3 —
// no ZIP, no WAV, no re-encode). ~10 credits and ~90s per song.
// ---------------------------------------------------------------------------

// Kie requires a callBackUrl even when polling; this throwaway target just
// absorbs the POST (same pattern as the generation test harness).
const KIE_DUMMY_CALLBACK = 'https://webhook.site/00000000-0000-0000-0000-000000000000';

async function kieSeparateInstrumental(taskId, audioId) {
  const submitResp = await fetch('https://api.kie.ai/api/v1/vocal-removal/generate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, audioId, type: 'separate_vocal', callBackUrl: KIE_DUMMY_CALLBACK }),
  });
  const submitData = await submitResp.json().catch(() => ({}));
  if (!submitResp.ok || submitData.code !== 200 || !submitData.data?.taskId) {
    throw new Error(`kie.ai vocal-removal submit failed: http=${submitResp.status} code=${submitData.code} ${submitData.msg || ''}`);
  }
  const sepTaskId = submitData.data.taskId;
  console.log(`[karaoke-fetch] kie separation task ${sepTaskId}`);

  // Poll up to ~4 minutes (separation typically completes in 60-120s;
  // Vercel maxDuration is 300s, leave headroom for download + upload).
  const deadline = Date.now() + 240 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    const pollResp = await fetch(
      `https://api.kie.ai/api/v1/vocal-removal/record-info?taskId=${encodeURIComponent(sepTaskId)}`,
      { headers: { Authorization: `Bearer ${KIE_API_KEY}` } },
    );
    const poll = await pollResp.json().catch(() => null);
    const flag = poll?.data?.successFlag;
    if (flag === 'SUCCESS') {
      const url = poll.data.response?.instrumentalUrl;
      if (!url) throw new Error('kie.ai separation SUCCESS but no instrumentalUrl');
      return url;
    }
    if (flag && flag !== 'PENDING') {
      throw new Error(`kie.ai separation failed: ${flag} ${poll?.data?.errorMessage || ''}`);
    }
  }
  throw new Error('kie.ai separation timed out after 240s');
}

// Parse a 16-bit PCM WAV Buffer into { sampleRate, channels, samples }.
// Walks the RIFF chunks rather than assuming a fixed 44-byte header, since
// Mureka's WAVs sometimes carry extra metadata chunks before 'data'.
export function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Karaoke source is not a RIFF/WAVE file');
  }
  let fmt = null;
  let dataStart = -1;
  let dataLen = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(bodyStart),
        channels: buf.readUInt16LE(bodyStart + 2),
        sampleRate: buf.readUInt32LE(bodyStart + 4),
        bitsPerSample: buf.readUInt16LE(bodyStart + 14),
      };
    } else if (chunkId === 'data') {
      dataStart = bodyStart;
      dataLen = chunkSize;
    }
    // RIFF chunks are word-aligned — pad odd sizes by one byte.
    offset = bodyStart + chunkSize + (chunkSize & 1);
  }
  if (!fmt) throw new Error('WAV missing fmt chunk');
  if (dataStart < 0) throw new Error('WAV missing data chunk');
  if (fmt.audioFormat !== 1) throw new Error(`WAV is not PCM (audioFormat=${fmt.audioFormat})`);
  if (fmt.bitsPerSample !== 16) throw new Error(`WAV is not 16-bit (bitsPerSample=${fmt.bitsPerSample})`);

  const end = Math.min(dataStart + dataLen, buf.length);
  const byteLen = (end - dataStart) & ~1; // round down to whole samples
  // Copy into a dedicated, 2-byte-aligned buffer so the Int16Array view is valid
  // regardless of where 'data' landed inside the ZIP-extracted Buffer.
  const copy = Buffer.allocUnsafeSlow(byteLen);
  buf.copy(copy, 0, dataStart, dataStart + byteLen);
  const samples = new Int16Array(copy.buffer, copy.byteOffset, byteLen >> 1);
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples };
}

// Re-encode a 16-bit PCM WAV Buffer to an MP3 Buffer (pure-JS, no native deps).
export function wavToMp3(wavBuf, kbps = KARAOKE_MP3_KBPS) {
  const { sampleRate, channels, samples } = parseWav(wavBuf);
  const encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const BLOCK = 1152; // LAME's natural frame size
  const chunks = [];

  if (channels === 2) {
    const total = samples.length >> 1; // frames per channel
    const left = new Int16Array(BLOCK);
    const right = new Int16Array(BLOCK);
    for (let i = 0; i < total; i += BLOCK) {
      const n = Math.min(BLOCK, total - i);
      for (let j = 0; j < n; j++) {
        left[j] = samples[(i + j) * 2];
        right[j] = samples[(i + j) * 2 + 1];
      }
      const l = n === BLOCK ? left : left.subarray(0, n);
      const r = n === BLOCK ? right : right.subarray(0, n);
      const enc = encoder.encodeBuffer(l, r);
      if (enc.length) chunks.push(Buffer.from(enc));
    }
  } else {
    for (let i = 0; i < samples.length; i += BLOCK) {
      const enc = encoder.encodeBuffer(samples.subarray(i, i + BLOCK));
      if (enc.length) chunks.push(Buffer.from(enc));
    }
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  // ---- Auth check ----
  const { songId, secret } = req.body || {};
  if (!KARAOKE_TRIGGER_SECRET) {
    return res.status(500).json({ success: false, error: 'KARAOKE_TRIGGER_SECRET not configured' });
  }
  if (secret !== KARAOKE_TRIGGER_SECRET) {
    return res.status(401).json({ success: false, error: 'Invalid secret' });
  }
  if (!songId || typeof songId !== 'string') {
    return res.status(400).json({ success: false, error: 'songId (string) required' });
  }
  if (!USEAPI_TOKEN) {
    return res.status(500).json({ success: false, error: 'USEAPI_TOKEN not configured' });
  }

  console.log(`[karaoke-fetch] songId=${songId}`);

  // ---- 1. Look up the song ----
  let song;
  try {
    const r = await supa(
      `/songs?id=eq.${songId}&select=id,status,version,provider,mureka_payload,kie_task_id,kie_payload,karaoke_url,karaoke_status`,
    );
    const rows = await r.json();
    song = rows?.[0];
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });
  } catch (e) {
    return res.status(500).json({ success: false, error: `DB lookup failed: ${e.message}` });
  }

  // ---- 2. Idempotency ----
  if (song.karaoke_status === 'ready' && song.karaoke_url) {
    return res.status(200).json({ success: true, action: 'already_ready', karaoke_url: song.karaoke_url });
  }

  if (song.status !== 'completed') {
    return res.status(409).json({ success: false, error: `Song not completed (status=${song.status})` });
  }

  // ---- Provider routing ----
  // Kie/Suno songs carry kie_task_id + kie_payload (track object incl. its
  // audio id); Mureka songs carry mureka_payload with song_id. A song could
  // theoretically have both (regenerated across providers) — the provider
  // column stamped at completion wins.
  let kieAudioId = null;
  try {
    const kp = typeof song.kie_payload === 'string' ? JSON.parse(song.kie_payload) : song.kie_payload;
    kieAudioId = kp?.id || null;
  } catch { /* ignore */ }
  const isKieSong = song.provider === 'kie' && Boolean(song.kie_task_id);

  let murekaSongId;
  try {
    const payload = typeof song.mureka_payload === 'string'
      ? JSON.parse(song.mureka_payload)
      : song.mureka_payload;
    murekaSongId = payload?.song_id;
  } catch { /* ignore */ }

  if (!isKieSong && !murekaSongId) {
    return res.status(409).json({ success: false, error: 'No Mureka song_id or Kie task id on song' });
  }
  if (isKieSong && !KIE_API_KEY) {
    return res.status(500).json({ success: false, error: 'KIE_API_KEY not configured' });
  }

  // ---- 3. Claim — set status to 'pending' (idempotent) ----
  await supa(`/songs?id=eq.${songId}`, {
    method: 'PATCH',
    body: JSON.stringify({ karaoke_status: 'pending' }),
  });

  try {
    let mp3Buf;

    if (isKieSong) {
      // ==== KIE / SUNO PATH — dedicated separation endpoint, returns MP3 ====
      let audioId = kieAudioId;
      if (!audioId) {
        // Older rows may lack the track id in kie_payload — resolve it from
        // the generation record (track index = version - 1).
        const ri = await fetch(
          `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(song.kie_task_id)}`,
          { headers: { Authorization: `Bearer ${KIE_API_KEY}` } },
        );
        const rj = await ri.json().catch(() => null);
        const trackList = rj?.data?.response?.sunoData || [];
        const idx = (song.version || 1) - 1;
        audioId = trackList[idx]?.id || trackList[0]?.id || null;
      }
      if (!audioId) throw new Error('Could not resolve Kie audioId for song');

      const instrumentalUrl = await kieSeparateInstrumental(song.kie_task_id, audioId);
      console.log(`[karaoke-fetch] downloading Kie instrumental`);
      const dl = await fetch(instrumentalUrl);
      if (!dl.ok) throw new Error(`Kie instrumental download ${dl.status}`);
      mp3Buf = Buffer.from(await dl.arrayBuffer());
      console.log(`[karaoke-fetch] Kie instrumental MP3: ${(mp3Buf.length / 1024 / 1024).toFixed(1)} MB`);
    } else {
      // ==== MUREKA PATH (unchanged) — stems ZIP via useapi.net ====
      // ---- 4. Get stems ZIP URL from useapi.net ----
      console.log(`[karaoke-fetch] requesting stems for Mureka song ${murekaSongId}`);
      const dlResp = await fetch('https://api.useapi.net/v1/mureka/music/download', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${USEAPI_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ song_id: murekaSongId, type: 'stem' }),
      });
      if (!dlResp.ok) {
        const txt = await dlResp.text().catch(() => '<no body>');
        throw new Error(`useapi.net /music/download ${dlResp.status}: ${txt.slice(0, 300)}`);
      }
      const dlData = await dlResp.json();
      const zipUrl = dlData.oss_key;
      if (!zipUrl) throw new Error(`useapi.net returned no oss_key: ${JSON.stringify(dlData)}`);

      // ---- 5. Download ZIP + extract instrumental.wav ----
      console.log(`[karaoke-fetch] downloading ZIP from ${zipUrl}`);
      const zipResp = await fetch(zipUrl);
      if (!zipResp.ok) throw new Error(`Mureka CDN ${zipResp.status}`);
      const zipBuf = Buffer.from(await zipResp.arrayBuffer());
      console.log(`[karaoke-fetch] ZIP downloaded: ${(zipBuf.length / 1024 / 1024).toFixed(1)} MB`);

      const zip = await JSZip.loadAsync(zipBuf);
      const instrumental = zip.file('instrumental.wav');
      if (!instrumental) {
        const present = Object.keys(zip.files);
        throw new Error(`instrumental.wav not in ZIP. Contents: ${present.join(', ')}`);
      }
      const wavBuf = await instrumental.async('nodebuffer');
      console.log(`[karaoke-fetch] instrumental.wav extracted: ${(wavBuf.length / 1024 / 1024).toFixed(1)} MB`);

      // ---- 6. Re-encode WAV → MP3 (smaller, friendlier download) ----
      mp3Buf = wavToMp3(wavBuf);
      console.log(`[karaoke-fetch] encoded MP3: ${(mp3Buf.length / 1024 / 1024).toFixed(1)} MB`);
    }

    // ---- 7. Upload to Supabase Storage ----
    const storagePath = `karaoke/${songId}.mp3`;
    const uploadResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}?upsert=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'audio/mpeg',
          'x-upsert': 'true',
          'cache-control': '31536000',
        },
        body: mp3Buf,
      },
    );
    if (!uploadResp.ok) {
      const txt = await uploadResp.text().catch(() => '<no body>');
      throw new Error(`Supabase Storage upload ${uploadResp.status}: ${txt.slice(0, 300)}`);
    }
    // Hand out our own domain — vercel.json rewrites /karaoke/<file> to the
    // Supabase Storage object, so the customer never sees the raw storage host.
    const karaokeUrl = `${PUBLIC_BASE_URL}/karaoke/${songId}.mp3`;
    console.log(`[karaoke-fetch] uploaded: ${karaokeUrl}`);

    // ---- 7. Mark song row as ready ----
    const updateResp = await supa(`/songs?id=eq.${songId}`, {
      method: 'PATCH',
      body: JSON.stringify({ karaoke_url: karaokeUrl, karaoke_status: 'ready' }),
    });
    if (!updateResp.ok) {
      const txt = await updateResp.text().catch(() => '<no body>');
      throw new Error(`Final DB update failed: ${updateResp.status} ${txt.slice(0, 300)}`);
    }

    console.log(`[karaoke-fetch] ✅ song ${songId} ready`);
    return res.status(200).json({ success: true, action: 'fetched', karaoke_url: karaokeUrl });

  } catch (err) {
    const msg = err?.message || String(err);
    await markFailed(songId, msg);
    return res.status(500).json({ success: false, error: msg });
  }
}
