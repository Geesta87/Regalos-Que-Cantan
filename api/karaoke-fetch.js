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
//   response: { success: true, karaoke_url: "<public storage URL>" }
//
// Idempotent — calling twice for the same songId is a no-op (returns the
// existing karaoke_url). Failures funnel to songs.karaoke_status='failed' so
// ops can retry without breaking the customer's payment flow.

import JSZip from 'jszip';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USEAPI_TOKEN = process.env.USEAPI_TOKEN;
const KARAOKE_TRIGGER_SECRET = process.env.KARAOKE_TRIGGER_SECRET;
const STORAGE_BUCKET = 'audio';

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
      `/songs?id=eq.${songId}&select=id,status,mureka_payload,karaoke_url,karaoke_status`,
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

  let murekaSongId;
  try {
    const payload = typeof song.mureka_payload === 'string'
      ? JSON.parse(song.mureka_payload)
      : song.mureka_payload;
    murekaSongId = payload?.song_id;
  } catch { /* ignore */ }
  if (!murekaSongId) {
    return res.status(409).json({ success: false, error: 'No Mureka song_id in payload' });
  }

  // ---- 3. Claim — set status to 'pending' (idempotent) ----
  await supa(`/songs?id=eq.${songId}`, {
    method: 'PATCH',
    body: JSON.stringify({ karaoke_status: 'pending' }),
  });

  try {
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

    // ---- 6. Upload to Supabase Storage ----
    const storagePath = `karaoke/${songId}.wav`;
    const uploadResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}?upsert=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'audio/wav',
          'x-upsert': 'true',
          'cache-control': '31536000',
        },
        body: wavBuf,
      },
    );
    if (!uploadResp.ok) {
      const txt = await uploadResp.text().catch(() => '<no body>');
      throw new Error(`Supabase Storage upload ${uploadResp.status}: ${txt.slice(0, 300)}`);
    }
    const karaokeUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
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
