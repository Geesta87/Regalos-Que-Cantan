// video-renderer/server.js
// HTTP wrapper around render.js for Cloud Run.
//   GET  /            -> health check (200)
//   POST /render      -> accepts a job, replies 202 immediately, renders in the
//                        BACKGROUND, uploads the MP4 to OUTPUT_BUCKET, then (if
//                        CALLBACK_URL is set) notifies the completion hook.
//
// Fire-and-forget like Shotstack: the caller (generate-video) isn't held for the
// ~6-min render. Requires Cloud Run --no-cpu-throttling so background work runs
// after the 202 response.
//
// Env: SUPABASE_URL, SUPABASE_KEY (anon for shadow / service-role for prod),
//      OUTPUT_BUCKET (default "videos-shadow"), RENDER_TOKEN (shared secret),
//      CALLBACK_URL (optional completion hook), PORT.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { renderOrder } = require('./render');
const { execFileSync } = require('child_process');
const { spliceLine, spliceSection } = require('./spliceAudio.cjs');
const { prepareClipSource, renderClip } = require('./clip');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || 'videos-shadow';
const RENDER_TOKEN = process.env.RENDER_TOKEN;       // shared secret required on /render
const CALLBACK_URL = process.env.CALLBACK_URL || ''; // optional completion hook
const PORT = process.env.PORT || 8080;

async function uploadToSupabase(localPath, objectPath, { bucket = OUTPUT_BUCKET, contentType = 'video/mp4' } = {}) {
  const body = fs.readFileSync(localPath);
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body,
        duplex: 'half',
      });
      if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
    } catch (e) {
      lastErr = e;
      console.warn(`upload attempt ${attempt} failed: ${e.message}${e.cause ? ' / ' + (e.cause.code || e.cause.message) : ''}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

// Upload an MP3 to the public `audio` bucket and return its public URL. Used by
// /splice-audio (the surgical song-fix seam is an MP3, not a video).
async function uploadAudioToSupabase(localPath, objectPath) {
  const body = fs.readFileSync(localPath);
  const url = `${SUPABASE_URL}/storage/v1/object/audio/${objectPath}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'audio/mpeg', 'x-upsert': 'true' },
        body,
        duplex: 'half',
      });
      if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return `${SUPABASE_URL}/storage/v1/object/public/audio/${objectPath}`;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

// Download a URL to a local file.
async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} for ${url.slice(0, 80)}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Run one surgical splice (line or section) end-to-end: download the two inputs,
// stitch with the seamless recipe, encode MP3, upload, return the public URL.
async function runSplice(spec) {
  const id = `splice-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`;
  const dir = path.join(os.tmpdir(), id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const pristine = path.join(dir, 'pristine.mp3');
    const resung = path.join(dir, 'resung.mp3');
    await download(spec.pristine_url, pristine);
    await download(spec.resung_url, resung);
    const outWav = path.join(dir, 'out.wav');
    if (spec.mode === 'section') {
      spliceSection({ pristine, resung, origCut: +spec.origCut, resungCut: +spec.resungCut, out: outWav, tmp: dir });
    } else {
      spliceLine({ pristine, resung, pStart: +spec.pStart, pEnd: +spec.pEnd, rStart: +spec.rStart, rEnd: +spec.rEnd, out: outWav, tmp: dir });
    }
    const outMp3 = path.join(dir, 'out.mp3');
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', outWav, '-c:a', 'libmp3lame', '-b:a', '192k', outMp3], { stdio: ['ignore', 'ignore', 'inherit'] });
    const url = await uploadAudioToSupabase(outMp3, `songs/fix-${id}.mp3`);
    return { url };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function notifyCallback(payload) {
  if (!CALLBACK_URL) return;
  try {
    const res = await fetch(CALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN || '' },
      body: JSON.stringify(payload),
    });
    console.log(`[${payload.videoOrderId}] callback ${res.status}`);
  } catch (e) {
    console.error(`[${payload.videoOrderId}] callback failed: ${e.message}`);
  }
}

// Render -> upload -> notify callback. Runs in the BACKGROUND (the handler 202s
// before this starts; see enqueueRender). The completion callback to CALLBACK_URL
// is what persists the result — never the HTTP response — so the caller can hang up
// the instant it's dispatched. Returns a {code, body} that's now only used for logs.
async function runRenderJob(order, id) {
  const started = Date.now();
  const workDir = path.join(os.tmpdir(), `render-${id}-${started}`);
  try {
    const result = await renderOrder(order, { dir: workDir, log: (m) => console.log(`[${id}] ${m}`) });
    const objectKey = `${id}.mp4`;
    const video_url = await uploadToSupabase(result.finalPath, objectKey);
    const renderSeconds = Math.round((Date.now() - started) / 1000);
    console.log(`[${id}] uploaded ${video_url} in ${renderSeconds}s`);
    await notifyCallback({ videoOrderId: id, success: true, objectKey, video_url, durationSec: result.durationSec, renderSeconds });
    return { code: 200, body: { success: true, video_url, videoOrderId: id, durationSec: result.durationSec, renderSeconds } };
  } catch (err) {
    const cause = err.cause ? ` (cause: ${err.cause.code || err.cause.errno || err.cause.message || err.cause})` : '';
    console.error(`[${id}] render error:`, err.message + cause, '\n', err.stack);
    await notifyCallback({ videoOrderId: id, success: false, error: err.message + cause });
    return { code: 500, body: { success: false, error: err.message + cause } };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// Per-instance serial render queue. We ACK each /render with 202 IMMEDIATELY, then
// render in the background, ONE AT A TIME on this instance. Why: the dispatcher is
// a Supabase edge function (generate-video) whose worker is recycled in seconds, so
// it cannot hold a connection open for the ~5-min render — the old "hold the request
// open" design made dispatches silently vanish (the request often never even reached
// Cloud Run, leaving orders stuck in 'processing'). A fast 202 makes the dispatch a
// reliable request→response; serializing renders keeps a burst from spawning parallel
// ffmpeg jobs that exhaust memory. Cloud Run autoscaling spreads load across instances,
// and runRenderJob fires the completion callback (success OR failure) when each finishes.
let renderChain = Promise.resolve();
function enqueueRender(order, id) {
  renderChain = renderChain
    .then(() => runRenderJob(order, id))
    .catch((e) => console.error(`[${id}] background render crashed:`, e?.message || e));
}

// --------------------------------------------------------------------------
// Clip Studio jobs (auto-captions). Same 202-then-background contract as
// /render; results are persisted by POSTing to the job's callback_url (the
// clip-studio-callback edge function), authenticated with x-render-token.
// --------------------------------------------------------------------------
async function postJobCallback(job, payload) {
  if (!job.callback_url) return;
  try {
    const res = await fetch(job.callback_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN || '' },
      body: JSON.stringify(payload),
    });
    console.log(`[clip:${payload.project_id || payload.clip_id}] callback ${res.status}`);
  } catch (e) {
    console.error(`[clip] callback failed: ${e.message}`);
  }
}

async function runClipPrepare(job) {
  const id = job.project_id;
  const workDir = path.join(os.tmpdir(), `clip-prep-${id}-${Date.now()}`);
  try {
    const { audioPath, durationSec } = await prepareClipSource(job, { dir: workDir, log: (m) => console.log(`[clip:${id}] ${m}`) });
    const audioKey = `${id}/audio.mp3`;
    const audio_url = await uploadToSupabase(audioPath, audioKey, { bucket: job.bucket, contentType: 'audio/mpeg' });
    await postJobCallback(job, { kind: 'prepare', success: true, project_id: id, duration_sec: durationSec, audio_path: audioKey, audio_url });
  } catch (err) {
    console.error(`[clip:${id}] prepare error:`, err.message);
    await postJobCallback(job, { kind: 'prepare', success: false, project_id: id, error: err.message });
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

async function runClipRender(job) {
  const id = job.clip_id;
  const started = Date.now();
  const workDir = path.join(os.tmpdir(), `clip-${id}-${started}`);
  try {
    const result = await renderClip(job, { dir: workDir, log: (m) => console.log(`[clip:${id}] ${m}`) });
    const objectKey = `${job.project_id}/clips/${id}.mp4`;
    const video_url = await uploadToSupabase(result.finalPath, objectKey, { bucket: job.bucket, contentType: 'video/mp4' });
    const renderSeconds = Math.round((Date.now() - started) / 1000);
    console.log(`[clip:${id}] uploaded ${video_url} in ${renderSeconds}s`);
    await postJobCallback(job, { kind: 'clip', success: true, clip_id: id, project_id: job.project_id, storage_path: objectKey, video_url, duration_sec: result.durationSec, render_seconds: renderSeconds });
  } catch (err) {
    console.error(`[clip:${id}] render error:`, err.message);
    await postJobCallback(job, { kind: 'clip', success: false, clip_id: id, project_id: job.project_id, error: err.message });
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

function enqueueClipJob(fn, job, id) {
  renderChain = renderChain
    .then(() => fn(job))
    .catch((e) => console.error(`[clip:${id}] background job crashed:`, e?.message || e));
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) return send(200, { ok: true });

  // Surgical song-fix splice — SYNCHRONOUS (a splice is seconds, not minutes). The
  // caller (fix-song-section edge fn) waits for the hosted MP3 URL. Guarded by the
  // same shared secret as /render.
  if (req.method === 'POST' && req.url === '/splice-audio') {
    if (RENDER_TOKEN && req.headers['x-render-token'] !== RENDER_TOKEN) return send(401, { error: 'unauthorized' });
    let spec;
    try {
      spec = JSON.parse(await readBody(req));
      if (!spec.pristine_url || !spec.resung_url) throw new Error('missing pristine_url or resung_url');
    } catch (err) {
      return send(400, { success: false, error: err.message });
    }
    try {
      const out = await runSplice(spec);
      return send(200, { success: true, url: out.url });
    } catch (err) {
      console.error('[splice] error:', err.message);
      return send(500, { success: false, error: err.message });
    }
  }

  // Clip Studio: prepare (audio extract for Whisper) + render (captioned clip)
  if (req.method === 'POST' && (req.url === '/clip-prepare' || req.url === '/clip-render')) {
    if (RENDER_TOKEN && req.headers['x-render-token'] !== RENDER_TOKEN) return send(401, { error: 'unauthorized' });
    let job;
    try {
      job = JSON.parse(await readBody(req));
      if (!job.source_url || !job.bucket || !job.callback_url) throw new Error('missing source_url, bucket, or callback_url');
      if (req.url === '/clip-prepare' && !job.project_id) throw new Error('missing project_id');
      if (req.url === '/clip-render' && !job.clip_id) throw new Error('missing clip_id');
    } catch (err) {
      return send(400, { success: false, error: err.message });
    }
    const id = job.clip_id || job.project_id;
    send(202, { accepted: true, id });
    enqueueClipJob(req.url === '/clip-prepare' ? runClipPrepare : runClipRender, job, id);
    return;
  }

  if (req.method !== 'POST' || req.url !== '/render') return send(404, { error: 'not found' });
  if (RENDER_TOKEN && req.headers['x-render-token'] !== RENDER_TOKEN) return send(401, { error: 'unauthorized' });

  let order;
  try {
    order = JSON.parse(await readBody(req));
    if (!order.photo_urls || !order.audio_url) throw new Error('missing photo_urls or audio_url');
  } catch (err) {
    return send(400, { success: false, error: err.message });
  }

  const id = order.videoOrderId || order.orderId || `job-${Date.now()}`;
  // Ack now, render in the background (see enqueueRender). The completion callback
  // — not this response — is what persists the video, so the caller never waits.
  send(202, { accepted: true, videoOrderId: id });
  enqueueRender(order, id);
});

server.listen(PORT, () => console.log(`video-renderer listening on ${PORT} (bucket: ${OUTPUT_BUCKET}, callback: ${CALLBACK_URL ? 'on' : 'off'})`));
