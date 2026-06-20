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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || 'videos-shadow';
const RENDER_TOKEN = process.env.RENDER_TOKEN;       // shared secret required on /render
const CALLBACK_URL = process.env.CALLBACK_URL || ''; // optional completion hook
const PORT = process.env.PORT || 8080;

async function uploadToSupabase(localPath, objectPath) {
  const body = fs.readFileSync(localPath);
  const url = `${SUPABASE_URL}/storage/v1/object/${OUTPUT_BUCKET}/${objectPath}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'video/mp4',
          'x-upsert': 'true',
        },
        body,
        duplex: 'half',
      });
      if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return `${SUPABASE_URL}/storage/v1/object/public/${OUTPUT_BUCKET}/${objectPath}`;
    } catch (e) {
      lastErr = e;
      console.warn(`upload attempt ${attempt} failed: ${e.message}${e.cause ? ' / ' + (e.cause.code || e.cause.message) : ''}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
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

// Render -> upload -> notify callback. Returns the HTTP result to send back.
// The handler AWAITS this so the request stays open for the whole render: that
// makes Cloud Run see the instance as busy (1 active request at concurrency=1)
// and route the next order to a fresh instance, instead of onto this one whose
// event loop is blocked by the synchronous ffmpeg. The caller (generate-video)
// fires-and-forgets, so it isn't held — and the render continues even if the
// caller disconnects.
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

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) return send(200, { ok: true });
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
  // Hold the request open for the whole render (see runRenderJob). The caller
  // fires-and-forgets and won't wait; the render + callback complete regardless.
  const r = await runRenderJob(order, id);
  send(r.code, r.body);
});

server.listen(PORT, () => console.log(`video-renderer listening on ${PORT} (bucket: ${OUTPUT_BUCKET}, callback: ${CALLBACK_URL ? 'on' : 'off'})`));
