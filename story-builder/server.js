// story-builder/server.js — HTTP wrapper around build.cjs for Cloud Run.
//   GET  /        -> health check (200)
//   POST /build   -> { order_id } guarded by x-render-token; replies 202
//                    immediately and builds in the BACKGROUND (GPT Image 2
//                    scenes + Seedance hero motion + morph + FFmpeg render,
//                    ~20-60 min), then hands the mp4 back via
//                    story-build-finalize (state='final_review' on success,
//                    'failed' + error on any crash).
//
// The build itself is story-renderer/build.cjs + engine.cjs (the prod engine,
// GPT Image 2 + Seedance 2.0) run as a child process — one build per process,
// so a crashed build can never take the server down.
//
// Matches the caller in admin-story-videos (POST ${STORY_RENDERER_URL}/build).
// Requires Cloud Run --no-cpu-throttling so background work continues after
// the 202 response (same as video-renderer).
//
// Env: SUPABASE_ANON_KEY (builds run on the anon key only), RENDER_TOKEN
//      (shared secret required on /build), SUPABASE_URL (optional), PORT.

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const RENDER_TOKEN = process.env.RENDER_TOKEN;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const PORT = process.env.PORT || 8080;

const active = new Set(); // order ids building in this instance (double-trigger guard)

function runBuild(orderId) {
  active.add(orderId);
  const child = spawn('node', [path.join(__dirname, 'build.cjs'), orderId], {
    env: { ...process.env, SUPABASE_URL, ANON_KEY: ANON },
    stdio: ['ignore', 'inherit', 'inherit'], // build logs -> Cloud Run logs
  });
  child.on('exit', (code) => {
    active.delete(orderId);
    console.log(`[${orderId}] build process exited ${code}`);
  });
  child.on('error', (e) => {
    active.delete(orderId);
    console.error(`[${orderId}] build spawn error: ${e.message}`);
  });
}

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (req.method === 'GET' && req.url === '/') return send(200, { ok: true, service: 'story-builder', active: active.size });

  if (req.method === 'POST' && req.url === '/build') {
    if (RENDER_TOKEN && req.headers['x-render-token'] !== RENDER_TOKEN) return send(401, { error: 'bad token' });
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let orderId;
      try { orderId = JSON.parse(body || '{}').order_id; } catch {}
      if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return send(400, { error: 'missing or invalid order_id' });
      if (active.has(orderId)) return send(202, { accepted: true, order_id: orderId, note: 'already building' });
      send(202, { accepted: true, order_id: orderId });
      runBuild(orderId);
    });
    return;
  }

  send(404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`story-builder listening on :${PORT}`));
