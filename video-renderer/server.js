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
const { renderShareVideo } = require('./shareVideo.cjs');

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
    // rehost — just re-host an audio URL permanently in our bucket (no splice).
    // Used to pin a Kie tempfile so a preview link survives past its expiry.
    if (spec.mode === 'rehost') {
      const src = path.join(dir, 'src.mp3');
      await download(spec.pristine_url, src);
      const outMp3 = path.join(dir, 'out.mp3');
      execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-c:a', 'libmp3lame', '-b:a', '192k', outMp3], { stdio: ['ignore', 'ignore', 'inherit'] });
      const url = await uploadAudioToSupabase(outMp3, `songs/rehost-${id}.mp3`);
      return { url };
    }
    const pristine = path.join(dir, 'pristine.mp3');
    const resung = path.join(dir, 'resung.mp3');
    await download(spec.pristine_url, pristine);
    await download(spec.resung_url, resung);
    const outWav = path.join(dir, 'out.wav');
    if (spec.mode === 'section') {
      spliceSection({ pristine, resung, origCut: +spec.origCut, resungCut: +spec.resungCut, out: outWav, tmp: dir });
    } else {
      spliceLine({ pristine, resung, pStart: +spec.pStart, pEnd: +spec.pEnd, rStart: +spec.rStart, rEnd: +spec.rEnd, noStretch: !!spec.noStretch, out: outWav, tmp: dir });
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

// Upload via the pre-signed PUT URL minted by the clip-studio edge function.
// This service holds NO Supabase key (SUPABASE_KEY here is the anon key from
// the shadow era) — signed URLs are the house pattern, like the Animado builder.
async function uploadToSignedUrl(localPath, signedUrl, contentType) {
  const body = fs.readFileSync(localPath);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
        body,
        duplex: 'half',
      });
      if (!res.ok) throw new Error(`signed upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`signed upload attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

// Browsers can't decode many camera codecs (DJI H.265/10-bit plays audio
// over a black frame). If the source isn't plain h264/yuv420p, transcode a
// 720p H.264 preview for the dashboard player. Returns the public URL to
// report, source_url when the original already plays, or null on failure.
async function makeBrowserPreview(job, workDir, log) {
  if (!job.preview_upload_url) return null;
  try {
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,pix_fmt', '-of', 'csv=p=0', 'source.mp4'], { cwd: workDir })
      .toString().trim().toLowerCase();
    // EXACT pix_fmt match — "yuv420p10le" (10-bit, plays black in Chrome)
    // contains the substring "yuv420p", so includes() would wrongly skip.
    const [codec, pix] = probe.split(',').map((s) => s.trim());
    if (codec === 'h264' && pix === 'yuv420p') {
      log('preview: source already browser-safe (h264/yuv420p) — skipping transcode');
      return job.source_url || 'source';
    }
    log(`preview: transcoding browser-safe copy (source is ${probe})`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'source.mp4',
      '-vf', 'scale=-2:720', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'preview.mp4'],
      { cwd: workDir });
    await uploadToSignedUrl(path.join(workDir, 'preview.mp4'), job.preview_upload_url, 'video/mp4');
    log('preview: uploaded');
    return job.preview_public_url;
  } catch (e) {
    log(`preview failed (${e.message}) — dashboard falls back to the original`);
    return null;
  }
}

async function runClipPrepare(job) {
  const id = job.project_id;
  const workDir = path.join(os.tmpdir(), `clip-prep-${id}-${Date.now()}`);
  const log = (m) => console.log(`[clip:${id}] ${m}`);
  try {
    if (job.preview_only) {
      // Watchdog backfill: only produce the browser preview for an already-
      // ingested project (no audio/transcript work). On transcode failure,
      // report the source URL as the preview so the backfill doesn't re-loop.
      await prepareClipSource(job, { dir: workDir, log });
      const previewUrl = await makeBrowserPreview(job, workDir, log);
      await postJobCallback(job, { kind: 'preview', success: true, project_id: id, preview_url: previewUrl || job.source_url });
      return;
    }
    if (!job.audio_upload_url) throw new Error('job missing audio_upload_url');
    const { audioPath, durationSec } = await prepareClipSource(job, { dir: workDir, log });
    await uploadToSignedUrl(audioPath, job.audio_upload_url, 'audio/mpeg');
    const previewUrl = await makeBrowserPreview(job, workDir, log); // best-effort
    await postJobCallback(job, { kind: 'prepare', success: true, project_id: id, duration_sec: durationSec, audio_path: job.audio_path, audio_url: job.audio_public_url, preview_url: previewUrl });
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
    if (!job.output_upload_url) throw new Error('job missing output_upload_url');
    const result = await renderClip(job, { dir: workDir, log: (m) => console.log(`[clip:${id}] ${m}`) });
    await uploadToSignedUrl(result.finalPath, job.output_upload_url, 'video/mp4');
    const renderSeconds = Math.round((Date.now() - started) / 1000);
    console.log(`[clip:${id}] uploaded ${job.output_path} in ${renderSeconds}s`);
    await postJobCallback(job, { kind: 'clip', success: true, clip_id: id, project_id: job.project_id, storage_path: job.output_path, video_url: job.output_public_url, duration_sec: result.durationSec, render_seconds: renderSeconds });
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

// Share video (per-song branded gift video — replaces the audio player on the
// /song/:id share page). Same 202-then-background contract; result is persisted
// by POSTing to job.callback_url (share-video-callback edge fn).
async function runShareVideoJob(job) {
  const id = job.song_id;
  const started = Date.now();
  const workDir = path.join(os.tmpdir(), `share-${id}-${started}`);
  try {
    if (!job.output_upload_url) throw new Error('job missing output_upload_url');
    const result = await renderShareVideo(job, { dir: workDir, log: (m) => console.log(`[share:${id}] ${m}`) });
    await uploadToSignedUrl(result.finalPath, job.output_upload_url, 'video/mp4');
    const renderSeconds = Math.round((Date.now() - started) / 1000);
    console.log(`[share:${id}] uploaded ${job.output_path} in ${renderSeconds}s`);
    await postJobCallback(job, { kind: 'share_video', success: true, song_id: id, storage_path: job.output_path, video_url: job.output_public_url, duration_sec: result.durationSec, render_seconds: renderSeconds });
  } catch (err) {
    console.error(`[share:${id}] render error:`, err.message);
    await postJobCallback(job, { kind: 'share_video', success: false, song_id: id, error: err.message });
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
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
      if (spec.mode === 'rehost') {
        if (!spec.pristine_url) throw new Error('missing pristine_url');
      } else if (!spec.pristine_url || !spec.resung_url) {
        throw new Error('missing pristine_url or resung_url');
      }
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
      // teaser jobs carry audio_src (a song) instead of source_url (a video)
      if ((!job.source_url && !(job.mode === 'teaser' && job.audio_src)) || !job.bucket || !job.callback_url) throw new Error('missing source_url/audio_src, bucket, or callback_url');
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

  // Per-song branded share video for the /song/:id gift page
  if (req.method === 'POST' && req.url === '/share-video') {
    if (RENDER_TOKEN && req.headers['x-render-token'] !== RENDER_TOKEN) return send(401, { error: 'unauthorized' });
    let job;
    try {
      job = JSON.parse(await readBody(req));
      if (!job.song_id || !job.audio_url || !job.output_upload_url || !job.callback_url) {
        throw new Error('missing song_id, audio_url, output_upload_url, or callback_url');
      }
    } catch (err) {
      return send(400, { success: false, error: err.message });
    }
    send(202, { accepted: true, song_id: job.song_id });
    renderChain = renderChain
      .then(() => runShareVideoJob(job))
      .catch((e) => console.error(`[share:${job.song_id}] background job crashed:`, e?.message || e));
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
