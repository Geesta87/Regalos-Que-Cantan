// Vercel serverless function — lyric / karaoke video renderer.
//
// Produces the word-synced "gold fill" video the owner approved (the local
// ffmpeg demo), now in production. Triggered post-payment from stripe-webhook
// (and re-runnable from ops) for songs whose buyer purchased:
//   • lyric video  ($9.99) — full song audio + highlighted lyrics
//   • karaoke video ($9.99) — instrumental audio + highlighted lyrics
//
// WHY VERCEL (not a Supabase edge function): rendering 1080x1920 H.264 with
// libass karaoke subtitles needs an ffmpeg binary + ~minutes of CPU + /tmp
// scratch space — none of which fit the Supabase Edge runtime. Same reason
// karaoke-fetch (the instrumental extractor) lives here. ffmpeg comes from the
// bundled ffmpeg-static binary (John Van Sickle build — includes libass +
// fontconfig); the font is the OFL Montserrat Bold bundled in api/assets.
//
// CONTRACT
//   POST /api/render-lyric-video
//   body: { songId, mode: "lyric" | "karaoke", secret }
//   → { success, action, video_url }
//
// Timing source: Kie/Suno word-level timestamps (exact — sung == shown).
// Fallback: songs.lyrics_timestamps (Whisper, cached by render-social-clip).
//
// Idempotent on songs.{mode}_video_status; failures funnel to '..._failed' so
// ops can retry without touching the customer's payment.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// ffmpeg-static is CommonJS (`module.exports = "<path>"`). An ESM default
// import of it can yield a namespace object instead of the string in some
// bundler/runtime combos — and fs.existsSync(<object>) throws synchronously.
// Require it explicitly and coerce to a string so it's always safe to use.
const require = createRequire(import.meta.url);
let ffmpegPath = null;
let ffmpegImportError = null;
try {
  const mod = require('ffmpeg-static');
  ffmpegPath = typeof mod === 'string' ? mod : (mod && typeof mod.default === 'string' ? mod.default : null);
  if (!ffmpegPath) ffmpegImportError = `ffmpeg-static resolved to ${typeof mod} (not a path string)`;
} catch (e) {
  ffmpegImportError = e?.message || String(e);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KIE_API_KEY = process.env.KIE_API_KEY;
const KARAOKE_TRIGGER_SECRET = process.env.KARAOKE_TRIGGER_SECRET; // shared with karaoke-fetch
const STORAGE_BUCKET = 'videos';
const PUBLIC_BASE_URL = (process.env.PUBLIC_SITE_URL || 'https://regalosquecantan.com').replace(/\/$/, '');
const KIE_DUMMY_CALLBACK = 'https://webhook.site/00000000-0000-0000-0000-000000000000';

export const config = { maxDuration: 300 };

// ---- column routing per mode ----
const MODE_COLS = {
  lyric:   { url: 'lyric_video_url',   status: 'lyric_video_status',   filePrefix: 'lyric',   label: 'Video con Letra' },
  karaoke: { url: 'karaoke_video_url', status: 'karaoke_video_status', filePrefix: 'karaoke', label: 'Video Karaoke' },
};

async function supa(pathname, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function setStatus(songId, statusCol, value, urlCol, urlVal) {
  const patch = { [statusCol]: value };
  if (urlCol && urlVal) patch[urlCol] = urlVal;
  await supa(`/songs?id=eq.${songId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

// ---- font dir resolution (included via vercel.json includeFiles) ----
function resolveFontDir() {
  const candidates = [
    path.join(process.cwd(), 'api', 'assets'),
    path.join(__dirname, 'assets'),
    '/var/task/api/assets',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'Montserrat-Bold.ttf'))) return c; } catch { /* ignore */ }
  }
  return candidates[0];
}

// ===========================================================================
// Timing — Kie word timestamps (preferred), else cached Whisper words.
// Returns [{ word, startS, endS }] in seconds, section markers excluded.
// ===========================================================================
async function getKieAudioId(song) {
  try {
    const kp = typeof song.kie_payload === 'string' ? JSON.parse(song.kie_payload) : song.kie_payload;
    if (kp && kp.id) return kp.id;
  } catch { /* ignore */ }
  // resolve from the generation record by version
  const ri = await fetch(
    `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(song.kie_task_id)}`,
    { headers: { Authorization: `Bearer ${KIE_API_KEY}` } },
  );
  const rj = await ri.json().catch(() => null);
  const tracks = rj?.data?.response?.sunoData || [];
  const idx = (song.version || 1) - 1;
  return tracks[idx]?.id || tracks[0]?.id || null;
}

async function getKieTimedWords(song) {
  const audioId = await getKieAudioId(song);
  if (!audioId) throw new Error('Could not resolve Kie audioId');
  const resp = await fetch('https://api.kie.ai/api/v1/generate/get-timestamped-lyrics', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: song.kie_task_id, audioId }),
  });
  const json = await resp.json().catch(() => null);
  const aligned = json?.data?.alignedWords;
  if (!Array.isArray(aligned) || aligned.length === 0) throw new Error('No alignedWords from Kie');
  return aligned
    .map((w) => ({ word: String(w.word || ''), startS: Number(w.startS), endS: Number(w.endS) }))
    .filter((w) => w.word && !Number.isNaN(w.startS) && !Number.isNaN(w.endS));
}

function getWhisperTimedWords(song) {
  const ts = song.lyrics_timestamps;
  const words = ts && Array.isArray(ts.words) ? ts.words : [];
  return words
    .map((w) => ({ word: String(w.word || ''), startS: Number(w.start), endS: Number(w.end) }))
    .filter((w) => w.word && !Number.isNaN(w.startS) && !Number.isNaN(w.endS));
}

// ===========================================================================
// .ass karaoke subtitle (ported from the approved bakeoff/build-karaoke-video)
// ===========================================================================
const isMarker = (t) => /^\s*\[.*\]\s*$/.test(String(t).trim());
const norm = (t) => String(t).normalize('NFC').replace(/\s+/g, ' ').trim();

function toAssTime(s) {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function buildAss(alignedWords, lyrics) {
  // sung words only, strip any leading [marker] glued to a word
  const words = alignedWords
    .map((w) => ({ ...w, text: norm(w.word).replace(/^\s*\[[^\]]*\]\s*/, '') }))
    .filter((w) => w.text && !isMarker(w.text));

  // group into the original lyric lines by word count (keeps natural phrasing)
  const lyricLines = String(lyrics || '')
    .split('\n').map((l) => l.trim())
    .filter((l) => l && !isMarker(l));

  const lines = [];
  let wi = 0;
  for (const line of lyricLines) {
    const n = line.split(/\s+/).length;
    const chunk = words.slice(wi, wi + n);
    if (!chunk.length) break;
    lines.push(chunk);
    wi += n;
  }
  while (wi < words.length) { lines.push(words.slice(wi, wi + 7)); wi += 7; }

  let events = '';
  for (const chunk of lines) {
    if (!chunk.length) continue;
    const start = Math.max(0, chunk[0].startS - 0.25);
    const end = chunk[chunk.length - 1].endS + 0.35;
    let text = `{\\kf${Math.round((chunk[0].startS - start) * 100)}}`;
    for (let i = 0; i < chunk.length; i++) {
      const w = chunk[i];
      const until = i < chunk.length - 1 ? chunk[i + 1].startS : w.endS;
      const durCs = Math.max(1, Math.round((until - w.startS) * 100));
      text += `{\\kf${durCs}}${w.text}${i < chunk.length - 1 ? ' ' : ''}`;
    }
    events += `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Karaoke,,0,0,0,,${text}\n`;
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Montserrat,78,&H002B8AC9,&H00FFFFFF,&H00141414,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`;
}

// ===========================================================================
// Kie vocal separation — instrumental URL for karaoke mode
// ===========================================================================
async function kieInstrumentalUrl(song) {
  // Reuse an already-made instrumental MP3 if the buyer also bought that addon.
  if (song.karaoke_url) return song.karaoke_url;

  const audioId = await getKieAudioId(song);
  if (!audioId) throw new Error('Could not resolve Kie audioId for separation');
  const submit = await fetch('https://api.kie.ai/api/v1/vocal-removal/generate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: song.kie_task_id, audioId, type: 'separate_vocal', callBackUrl: KIE_DUMMY_CALLBACK }),
  });
  const sd = await submit.json().catch(() => ({}));
  if (sd.code !== 200 || !sd.data?.taskId) throw new Error(`vocal-removal submit failed: ${sd.code} ${sd.msg || ''}`);
  const sepTaskId = sd.data.taskId;

  const deadline = Date.now() + 200 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    const poll = await fetch(`https://api.kie.ai/api/v1/vocal-removal/record-info?taskId=${encodeURIComponent(sepTaskId)}`,
      { headers: { Authorization: `Bearer ${KIE_API_KEY}` } });
    const pj = await poll.json().catch(() => null);
    const flag = pj?.data?.successFlag;
    if (flag === 'SUCCESS') {
      const url = pj.data.response?.instrumentalUrl;
      if (!url) throw new Error('separation SUCCESS but no instrumentalUrl');
      return url;
    }
    if (flag && flag !== 'PENDING') throw new Error(`separation failed: ${flag}`);
  }
  throw new Error('separation timed out');
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} for ${url.slice(0, 80)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

// ffmpeg drawtext escaping (text + path)
function dtText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "’");
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });

  const { songId, mode, secret } = req.body || {};
  if (!KARAOKE_TRIGGER_SECRET) return res.status(500).json({ success: false, error: 'KARAOKE_TRIGGER_SECRET not configured' });
  if (secret !== KARAOKE_TRIGGER_SECRET) return res.status(401).json({ success: false, error: 'Invalid secret' });
  if (!songId || typeof songId !== 'string') return res.status(400).json({ success: false, error: 'songId required' });
  const cols = MODE_COLS[mode];
  if (!cols) return res.status(400).json({ success: false, error: 'mode must be "lyric" or "karaoke"' });
  if (!KIE_API_KEY) return res.status(500).json({ success: false, error: 'KIE_API_KEY not configured' });

  // ---- Environment diagnostic (no render) — POST { diag:true, secret } ----
  // Confirms the ffmpeg binary + font shipped in the lambda and ffmpeg runs.
  // Fully guarded so it can never crash (FUNCTION_INVOCATION_FAILED).
  if (req.body?.diag) {
    const out = { ffmpegPath, ffmpegImportError, ffmpegPathType: typeof ffmpegPath };
    try {
      out.ffmpegExists = (typeof ffmpegPath === 'string') ? fs.existsSync(ffmpegPath) : false;
      const fontDir = resolveFontDir();
      out.fontDir = fontDir;
      out.fontExists = fs.existsSync(path.join(fontDir, 'Montserrat-Bold.ttf'));
      out.cwd = process.cwd();
      out.tmp = os.tmpdir();
      try { out.nodeModulesFfmpeg = fs.existsSync('/var/task/node_modules/ffmpeg-static'); } catch { out.nodeModulesFfmpeg = 'err'; }
    } catch (e) {
      out.diagSetupError = e?.message || String(e);
    }
    if (typeof ffmpegPath === 'string' && out.ffmpegExists) {
      try {
        const { stdout } = await execFileAsync(ffmpegPath, ['-version'], { timeout: 15000 });
        out.ffmpegVersion = String(stdout).split('\n')[0];
        out.ffmpegRuns = true;
      } catch (e) {
        out.ffmpegRuns = false;
        out.ffmpegError = e?.message || String(e);
      }
    }
    return res.status(200).json({ diag: true, ...out });
  }

  if (!ffmpegPath) return res.status(500).json({ success: false, error: 'ffmpeg binary unavailable' });

  console.log(`[render-lyric-video] songId=${songId} mode=${mode}`);

  // ---- look up song ----
  let song;
  try {
    const r = await supa(`/songs?id=eq.${songId}&select=id,version,provider,status,recipient_name,lyrics,kie_task_id,kie_payload,karaoke_url,lyrics_timestamps,${cols.url},${cols.status}`);
    const rows = await r.json();
    song = rows?.[0];
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });
  } catch (e) {
    return res.status(500).json({ success: false, error: `DB lookup failed: ${e.message}` });
  }

  // ---- idempotency ----
  if (song[cols.status] === 'ready' && song[cols.url]) {
    return res.status(200).json({ success: true, action: 'already_ready', video_url: song[cols.url] });
  }
  if (song.status !== 'completed') {
    return res.status(409).json({ success: false, error: `Song not completed (status=${song.status})` });
  }
  if (song.provider !== 'kie' && getWhisperTimedWords(song).length === 0) {
    // Non-Kie song with no cached timing — can't sync. Caller leaves it; ops can retry.
    await setStatus(songId, cols.status, 'failed');
    return res.status(409).json({ success: false, error: 'No timing source (not a Kie song and no cached Whisper words)' });
  }

  // Everything below is guarded so NO failure can produce a bare
  // FUNCTION_INVOCATION_FAILED — the catch always returns a readable error and
  // flips status to 'failed'. (Earlier crashes happened in the unguarded setup
  // lines, which left status stuck on 'pending'.)
  let tmp = null;
  try {
    await setStatus(songId, cols.status, 'pending');

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rlv-'));
    const audioFile = path.join(tmp, 'audio.mp3');
    const assFile = path.join(tmp, 'sub.ass');
    const outFile = path.join(tmp, 'out.mp4');
    const fontDir = resolveFontDir();

    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      throw new Error(`ffmpeg binary missing in lambda (path=${ffmpegPath}, exists=${ffmpegPath ? fs.existsSync(ffmpegPath) : false})`);
    }

    // ---- timing ----
    let timed;
    if (song.provider === 'kie' && song.kie_task_id) {
      timed = await getKieTimedWords(song);
    } else {
      timed = getWhisperTimedWords(song);
    }
    if (!timed.length) throw new Error('no timed words');

    // ---- audio source ----
    const audioUrl = mode === 'karaoke'
      ? await kieInstrumentalUrl(song)
      : await (async () => {
          // full song from our storage (audio_url) — fetch fresh to be safe
          const r = await supa(`/songs?id=eq.${songId}&select=audio_url`);
          const rows = await r.json();
          const u = rows?.[0]?.audio_url;
          if (!u) throw new Error('no audio_url');
          return u;
        })();
    await download(audioUrl, audioFile);

    // ---- subtitle ----
    fs.writeFileSync(assFile, buildAss(timed, song.lyrics), 'utf8');

    // ---- ffmpeg render ----
    const title = `Canción para ${song.recipient_name || 'ti'}`;
    const brand = 'regalosquecantan.com';
    const fontFile = path.join(fontDir, 'Montserrat-Bold.ttf').replace(/\\/g, '/');
    const titleDraw = `drawtext=fontfile='${fontFile}':text='${dtText(title)}':fontcolor=0xf2e8d8:fontsize=58:x=(w-text_w)/2:y=150`;
    const brandDraw = `drawtext=fontfile='${fontFile}':text='${dtText(brand)}':fontcolor=0x8a8273:fontsize=38:x=(w-text_w)/2:y=1770`;
    const subDraw = `subtitles='${assFile.replace(/\\/g, '/')}':fontsdir='${fontDir.replace(/\\/g, '/')}'`;
    const filter = `[0:v]${titleDraw},${brandDraw},${subDraw}[v]`;

    const args = [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0x14110d:s=1080x1920:r=30',
      '-i', audioFile,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '1:a',
      '-shortest',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      outFile,
    ];
    console.log(`[render-lyric-video] ffmpeg start (${mode})`);
    await execFileAsync(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 32, timeout: 270000 });
    const outBytes = fs.statSync(outFile).size;
    console.log(`[render-lyric-video] ffmpeg done: ${(outBytes / 1e6).toFixed(1)} MB`);

    // ---- upload to videos bucket ----
    const storagePath = `${cols.filePrefix}/${songId}.mp4`;
    const upBuf = fs.readFileSync(outFile);
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}?upsert=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'video/mp4',
        'x-upsert': 'true',
        'cache-control': '31536000',
      },
      body: upBuf,
    });
    if (!up.ok) {
      const t = await up.text().catch(() => '<no body>');
      throw new Error(`storage upload ${up.status}: ${t.slice(0, 200)}`);
    }

    const videoUrl = `${PUBLIC_BASE_URL}/${cols.filePrefix}-video/${songId}.mp4`;
    await setStatus(songId, cols.status, 'ready', cols.url, videoUrl);
    console.log(`[render-lyric-video] ✅ ${mode} ready: ${videoUrl}`);
    return res.status(200).json({ success: true, action: 'rendered', video_url: videoUrl });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`[render-lyric-video] failed (${mode}) for ${songId}: ${msg}`);
    try { await setStatus(songId, cols.status, 'failed'); } catch { /* never let this crash */ }
    return res.status(500).json({ success: false, error: msg });
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }
  }
}
