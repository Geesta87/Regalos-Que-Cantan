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
  // Ack now, render in the background (see enqueueRender). The completion callback
  // — not this response — is what persists the video, so the caller never waits.
  send(202, { accepted: true, videoOrderId: id });
  enqueueRender(order, id);
});

server.listen(PORT, () => console.log(`video-renderer listening on ${PORT} (bucket: ${OUTPUT_BUCKET}, callback: ${CALLBACK_URL ? 'on' : 'off'})`));
