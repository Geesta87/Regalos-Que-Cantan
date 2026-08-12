// story-builder/server.js — HTTP wrapper around build.cjs for Cloud Run.
//   GET  /        -> health check (200)
//   POST /build   -> { order_id } guarded by x-render-token; streams 200 headers
//                    immediately and HOLDS THE REQUEST OPEN for the whole build
//                    (GPT Image 2 scenes + Seedance hero motion + morph + FFmpeg
//                    render, ~20-60 min), then hands the mp4 back via
//                    story-build-finalize (state='final_review' on success,
//                    'failed' + error on any crash).
//
// The build itself is story-renderer/build.cjs + engine.cjs (the prod engine,
// GPT Image 2 + Seedance 2.0) run as a child process — one build per process,
// so a crashed build can never take the server down.
//
// WHY THE REQUEST IS HELD OPEN (2026-08-12 incident): this used to reply 202 in
// ~0.3s and build detached in the background. Cloud Run then sees an instance
// with NO in-flight request and is free to scale it to zero mid-build — two
// consecutive builds for one order were killed silently at 14m44s and 14m48s
// after container start, losing ~15 min of paid generation each time and leaving
// the order stuck in 'building' until the recover-stuck-story-builds cron.
// --no-cpu-throttling (already set) keeps the CPU running but does NOT stop the
// scale-down. An instance is never shut down while it is serving a request, so
// the fix is to keep the response open (with a periodic heartbeat line, which
// also stops idle-connection reaping) until the child exits. Cloud Run's request
// timeout is 3600s — comfortably above a full build. Callers are all
// fire-and-forget, so nobody waits on the body.
// If the client disconnects we deliberately KEEP BUILDING — the build owns its
// own state reporting via story-build-finalize.
//
// Matches the caller in admin-story-videos (POST ${STORY_RENDERER_URL}/build).
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

// Runs one build to completion. Resolves with the child's exit code (or -1 on a
// spawn error) so the HTTP handler can hold its request open until then.
function runBuild(orderId) {
  active.add(orderId);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => { if (settled) return; settled = true; active.delete(orderId); resolve(code); };
    const child = spawn('node', [path.join(__dirname, 'build.cjs'), orderId], {
      env: { ...process.env, SUPABASE_URL, ANON_KEY: ANON },
      stdio: ['ignore', 'inherit', 'inherit'], // build logs -> Cloud Run logs
    });
    child.on('exit', (code) => {
      console.log(`[${orderId}] build process exited ${code}`);
      finish(code);
    });
    child.on('error', (e) => {
      console.error(`[${orderId}] build spawn error: ${e.message}`);
      finish(-1);
    });
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

      // Headers go out immediately (callers treat this as accept-and-forget), but
      // the response stays OPEN for the whole build so Cloud Run keeps this
      // instance alive — see the incident note at the top of this file.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
      res.write(`${JSON.stringify({ accepted: true, order_id: orderId })}\n`);
      // A client hanging up must never kill a paid build.
      req.on('aborted', () => console.log(`[${orderId}] client disconnected — build continues`));
      const beat = setInterval(() => { try { res.write('\n'); } catch {} }, 20000);
      runBuild(orderId).then((code) => {
        clearInterval(beat);
        try { res.end(`${JSON.stringify({ done: true, order_id: orderId, exit_code: code })}\n`); } catch {}
      });
    });
    return;
  }

  send(404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`story-builder listening on :${PORT}`));
