// scripts/auto-build-story.cjs — THE AUTO-BUILDER ENGINE (proves the orchestrator).
// Given a workdir with: storyboard.json (from generate-storyboard), timing.json
// (transcribe-song), song.mp3, and config.json {name,title,endcard,
// approved_character_url, recipient_photo_url}, it:
//   1. generates every unique scene image via GPT Image 2 (reference-conditioned)
//   2. computes lyric-synced windows (token-flatten anchors + dense + split long)
//   3. (optional) animates the 3 hero scenes via Kie Seedance 2.0 + makes the
//      real->cartoon morph via Kie Seedance 2.0
//   4. FFmpeg-renders the storybook and prepends the morph
// Images route through the gpt-image edge fn (holds OPENAI_API_KEY); video/morph
// route through test-kie-video (holds KIE_API_KEY). Both run with only the anon key —
// exactly what the Cloud Run host does with its own secrets. Usage: node <engine> <workdir> [--motion]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.resolve(process.argv[2] || '.');
const WITH_MOTION = process.argv.includes('--motion');
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const sb = JSON.parse(fs.readFileSync(path.join(DIR, 'storyboard.json'), 'utf8'));
const ts = JSON.parse(fs.readFileSync(path.join(DIR, 'timing.json'), 'utf8'));
const FONT = fs.existsSync(path.join(__dirname, 'assets', 'serif.ttf')) ? path.join(__dirname, 'assets', 'serif.ttf') : path.join(ROOT, 'video-renderer', 'assets', 'serif.ttf');
fs.copyFileSync(FONT, path.join(DIR, 'serif.ttf'));
const BASE = process.env.SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const ANON = process.env.ANON_KEY || (() => { try { return (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/(?:VITE_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY)\s*=\s*"?([^"\r\n]+)/) || [])[1]; } catch { return null; } })();
const KIE_FN = `${BASE}/functions/v1/test-kie-video`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kieFn(body) {
  // Never throw on a transient gateway blip / empty body. The caller treats a
  // {_bad:true} result as "retry / keep polling" instead of crashing the build.
  try {
    const r = await fetch(KIE_FN, { method: 'POST', headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { return { _bad: true, _status: r.status, _raw: txt.slice(0, 120) }; }
  } catch (e) { return { _bad: true, _err: e.message }; }
}
async function kieRun(model, prompt, input, label) {
  let taskId;
  for (let attempt = 0; attempt < 10; attempt++) {
    const c = await kieFn({ mode: 'create', model, prompt, input });
    if (c.taskId) { taskId = c.taskId; break; }
    // rate limit (429), 5xx, or an empty/garbled response -> back off and retry
    if (c._bad || c?.raw?.code === 429 || (c?.raw?.code && c.raw.code >= 500)) { await sleep(4000 + attempt * 3000); continue; }
    throw new Error(`${label} create failed: ${JSON.stringify(c).slice(0, 200)}`);
  }
  if (!taskId) throw new Error(`${label} create failed after retries (rate-limited)`);
  let blips = 0;
  for (let i = 0; i < 110; i++) {
    await sleep(4000);
    const s = await kieFn({ mode: 'status', taskId });
    if (s._bad) { if (++blips > 12) throw new Error(`${label} status unreadable`); continue; } // transient — keep polling
    const st = s?.raw?.data?.state || s?.data?.state;
    if (st === 'success') {
      let rj = {};
      try { rj = JSON.parse((s.raw?.data || s.data).resultJson || '{}'); } catch { continue; } // malformed -> poll again
      const url = (rj.resultUrls || [])[0];
      if (!url) throw new Error(`${label} no resultUrls`);
      return url;
    }
    if (st === 'fail') throw new Error(`${label} failed`);
    if (i % 5 === 0) process.stdout.write(`  ${label} ${st || 'waiting'}...\n`);
  }
  throw new Error(`${label} timeout`);
}
const dl = (url, file) => execFileSync('curl', ['-s', '-o', path.join(DIR, file), url]);
// image_id -> public URL (used as Seedance motion input). A rebuild seeds this from
// seed-urls.json (written by build.cjs from the order's persisted scene_assets) so
// already-approved scenes aren't regenerated; the engine writes the final map to
// out-urls.json so build.cjs can persist any newly generated scenes.
const sceneUrls = (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'seed-urls.json'), 'utf8')); } catch { return {}; } })();

// ---- incremental checkpointing ----
// Artifacts used to be persisted only after the FINAL mp4 existed, so any death
// mid-build threw away everything already paid for (2026-08-12: two consecutive
// deaths on order f17d621b lost 20 scene images + a hero motion clip each time;
// the images were only recoverable by hand-matching storage timestamps to logs).
// When build.cjs passes an order id we now upload + record each artifact THE
// MOMENT IT EXISTS, so the next attempt resumes instead of restarting. Every
// checkpoint is best-effort: it must never fail a build that is otherwise fine.
const ORDER_ID = process.env.STORY_ORDER_ID || null;
const FINALIZE = `${BASE}/functions/v1/story-build-finalize`;
const assetMap = {}; // image_id -> { image_url, motion_url }
let morphUrl = null;
(() => {
  // seeded from the order's already-persisted assets so a checkpoint never drops
  // a motion clip / morph this run reused rather than regenerated
  try {
    for (const a of JSON.parse(fs.readFileSync(path.join(DIR, 'seed-assets.json'), 'utf8')))
      if (a && a.image_id) assetMap[a.image_id] = { image_url: a.image_url || null, motion_url: a.motion_url || null };
  } catch {}
  try { morphUrl = (fs.readFileSync(path.join(DIR, 'seed-morph.txt'), 'utf8').trim() || null); } catch {}
})();

async function finalize(body) {
  const r = await fetch(FINALIZE, { method: 'POST', headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
// upload a local artifact to storage, return its public url
async function uploadAsset(localFile, contentType) {
  const u = await finalize({ mode: 'asset-upload-url', story_video_order_id: ORDER_ID, file: localFile });
  if (!u.success) throw new Error(u.error || 'no upload url');
  const code = execFileSync('curl', ['-s', '-o', '_assetup.log', '-w', '%{http_code}', '-X', 'PUT', u.signed_url,
    '-H', `Content-Type: ${contentType}`, '--data-binary', `@${localFile}`], { cwd: DIR }).toString().trim();
  if (code !== '200') throw new Error(`PUT http=${code}`);
  return u.public_url;
}
async function checkpoint(label) {
  if (!ORDER_ID) return;
  try {
    for (const id of Object.keys(sceneUrls)) assetMap[id] = { ...(assetMap[id] || {}), image_url: sceneUrls[id] };
    const scene_assets = Object.entries(assetMap)
      .map(([image_id, a]) => ({ image_id, image_url: a.image_url || null, motion_url: a.motion_url || null }));
    const r = await finalize({ mode: 'save-assets', story_video_order_id: ORDER_ID, scene_assets, morph_asset: morphUrl });
    console.log(`  [checkpoint] ${label}: ${r.success ? `${scene_assets.length} scene(s)${morphUrl ? ' + morph' : ''} saved` : `save failed (${r.error})`}`);
  } catch (e) { console.log(`  [checkpoint] ${label} failed (non-fatal): ${e.message}`); }
}

// GPT Image 2 (reference-conditioned, OpenAI images/edits) via the deployed gpt-image
// edge fn -> uploads the render and returns a hosted public URL. Replaces Kie
// nano-banana-edit for all image generation: fully-Pixar stylization, faithful
// likeness, correct text, and no character duplication. Slower than nano (medium
// quality + retries keep it under the edge fn's wall-clock).
const GPT_FN = `${BASE}/functions/v1/test-gpt-image`;
async function gptImage(prompt, refUrls, label) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(GPT_FN, { method: 'POST', headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, image_urls: refUrls, size: '1024x1536', quality: 'medium' }) });
      const j = await r.json();
      if (j.url) return j.url;
      console.log(`  ${label} gpt try${a}: ${JSON.stringify(j).slice(0, 120)}`);
    } catch (e) { console.log(`  ${label} gpt try${a} ${e.message}`); }
    await sleep(3000);
  }
  throw new Error(`${label} gpt-image failed`);
}

// one scene image, resilient to content blocks: try as-written, then a strictly
// child-safe rephrase, then give up (caller substitutes a fallback image).
const PIXAR = ' Render as warm, fully-stylized Pixar-style 3D animation (not photorealistic), faithful to the character in the reference. Depict exactly the people described — do NOT duplicate anyone or add unrelated people. The reference image defines each character\'s IDENTITY (face, hair, build) only — do NOT copy its pose, framing, or camera angle; follow the shot direction stated at the start of this prompt.';
async function genOneImage(id, prompt) {
  try {
    const url = await gptImage(prompt + PIXAR, [CHAR_REF], id);
    sceneUrls[id] = url; dl(url, `${id}.png`); console.log(`  ${id} ok`); return true;
  } catch (e) {
    // most likely a child-content false block — retry once, strictly child-safe
    try {
      const safe = `Wholesome family scene. Any children appear ONLY from behind or as small distant figures with NO visible child faces; focus on warmth and togetherness. ${prompt}${PIXAR}`;
      const url = await gptImage(safe, [CHAR_REF], `${id}(safe)`);
      sceneUrls[id] = url; dl(url, `${id}.png`); console.log(`  ${id} ok (child-safe retry)`); return true;
    } catch (e2) { console.log(`  ${id} blocked (${e2.message}) -> will reuse a fallback image`); return false; }
  }
}

// ---- 1. generate every unique scene image (GPT Image 2, character ref) ----
async function genImages() {
  const firstPromptFor = {};
  for (const s of sb.scenes) if (s.image_id && !firstPromptFor[s.image_id]) firstPromptFor[s.image_id] = s.visual_prompt;
  const ids = Object.keys(firstPromptFor).filter((id) => !fs.existsSync(path.join(DIR, `${id}.png`)));
  const POOL = 3; // GPT Image 2 is slower; throttle concurrency
  console.log(`generating ${ids.length} unique scene images via GPT Image 2 (pool=${POOL})...`);
  const failed = [];
  for (let i = 0; i < ids.length; i += POOL) {
    const results = await Promise.all(ids.slice(i, i + POOL).map((id) => genOneImage(id, firstPromptFor[id]).then((ok) => ({ id, ok }))));
    results.forEach((r) => { if (!r.ok) failed.push(r.id); });
  }
  // a build must never die because one scene got content-flagged: reuse a safe
  // existing image (prefer the faithful family/character cartoon) for any failure.
  if (failed.length) {
    const have = ids.filter((id) => fs.existsSync(path.join(DIR, `${id}.png`)));
    const fb = fs.existsSync(path.join(DIR, 'morph-target.png')) ? 'morph-target.png' : (have[0] ? `${have[0]}.png` : null);
    if (!fb) throw new Error('all scene images failed to generate');
    for (const id of failed) { fs.copyFileSync(path.join(DIR, fb), path.join(DIR, `${id}.png`)); console.log(`  ${id} <- reused ${fb}`); }
  }
}

// ---- 2. compute lyric-synced windows (token-flatten anchors) ----
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const words = [];
ts.words.forEach((w) => { const n = norm(w.word); if (n) n.split(' ').forEach((tok) => { if (tok) words.push({ t: w.start, n: tok }); }); });
function findAnchor(phrase, from) {
  const toks = norm(phrase).split(' ').filter(Boolean);
  for (let i = from; i < words.length; i++) { let ok = true, j = i, k = 0; while (k < toks.length && j < words.length) { if (words[j].n !== toks[k]) { ok = false; break; } j++; k++; } if (ok && k === toks.length) return { time: words[i].t, idx: j }; }
  return null;
}
function windows() {
  const songDur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(DIR, 'song.mp3')]).toString().trim());
  let cur = 0; const starts = [];
  sb.scenes.forEach((sc, s) => { if (!sc.anchor) { starts.push(0); return; } const h = findAnchor(sc.anchor, cur); if (!h) { console.warn('  ! anchor not found:', sc.anchor); starts.push(starts[s - 1] + 8); return; } starts.push(+h.time.toFixed(2)); cur = h.idx; });
  const flat = [];
  sb.scenes.forEach((sc, i) => {
    const a = starts[i], b = i < sb.scenes.length - 1 ? starts[i + 1] : songDur; const win = +(b - a).toFixed(2);
    const isHero = WITH_MOTION && sc.hero;
    if (isHero) { flat.push({ src: `${sc.image_id}_full.mp4`, absStart: a, dur: win, isVideo: true }); return; }
    if (win >= 14) { const h = +(win / 2).toFixed(2); flat.push({ src: `${sc.image_id}.png`, absStart: a, dur: h }); flat.push({ src: `${sc.image_id}.png`, absStart: +(a + h).toFixed(2), dur: +(win - h).toFixed(2) }); }
    else flat.push({ src: `${sc.image_id}.png`, absStart: a, dur: win });
  });
  return { flat, total: +songDur.toFixed(2) };
}

// ---- 3. hero motion (Kie Seedance 2.0) + morph (Kie Seedance 2.0) ----
async function genHeroes(flat) {
  const heroIds = [...new Set(sb.scenes.filter((s) => s.hero).map((s) => s.image_id))];
  for (const id of heroIds) {
    if (fs.existsSync(path.join(DIR, `${id}_full.mp4`))) continue;
    const fe = flat.find((f) => f.src === `${id}_full.mp4`);
    if (!fe) continue;
    const L = +(fe.dur + 1.0).toFixed(2);
    // a blocked/failed hero must NOT crash the build — downgrade it to a still.
    const downgrade = (why) => { console.log(`  hero ${id} -> still (${why})`); fe.src = `${id}.png`; fe.isVideo = false; };
    try {
      // need a public URL of the scene image to animate; regenerate if missing
      let url = sceneUrls[id];
      if (!url) {
        const prompt = sb.scenes.find((s) => s.image_id === id).visual_prompt;
        url = await gptImage(prompt + PIXAR, [CHAR_REF], `${id}(re)`);
        sceneUrls[id] = url; dl(url, `${id}.png`);
      }
      // a seeded/persisted raw motion clip (revise flow / rebuild) skips the
      // Seedance call entirely — only the freeze-extend wrap is redone.
      let freshMotion = false;
      if (!fs.existsSync(path.join(DIR, `motion-${id}.mp4`))) {
        freshMotion = true;
        console.log(`animating hero ${id} (window ${L}s)...`);
        // per-scene motion direction from the storyboard when present (hero scenes
        // carry a one-line camera/subject move); generic gentle motion otherwise.
        const custom = (sb.scenes.find((s) => s.image_id === id && s.motion_prompt)?.motion_prompt || '').trim();
        const motionPrompt = custom
          ? `${custom.replace(/\.?\s*$/, '.')} Subtle and natural, Pixar 3D animation, keep the character identical, no distortion.`
          : 'Gentle warm cinematic motion that suits the scene, subtle and natural, soft camera, Pixar 3D animation, keep the character identical, no distortion.';
        const motionUrl = await kieRun('bytedance/seedance-2', motionPrompt, { first_frame_url: url, resolution: '720p', aspect_ratio: '9:16', duration: 5, generate_audio: false }, `${id}-motion`);
        dl(motionUrl, `motion-${id}.mp4`);
      } else {
        console.log(`  hero ${id}: reusing existing motion clip`);
      }
      // persist the raw clip immediately — a Seedance take is the most expensive
      // artifact in the build and used to be lost on any later crash
      if (freshMotion && ORDER_ID) {
        try {
          assetMap[id] = { ...(assetMap[id] || {}), motion_url: await uploadAsset(`motion-${id}.mp4`, 'video/mp4') };
          await checkpoint(`motion ${id}`);
        } catch (e) { console.log(`  [checkpoint] motion ${id} upload failed (non-fatal): ${e.message}`); }
      }
      wrapHero(`motion-${id}.mp4`, `${id}_full.mp4`, L);
      console.log(`  hero ${id} done`);
    } catch (e) { downgrade(e.message); }
  }
}
function wrapHero(motionFile, outFile, L) {
  const W = 1080, H = 1920, FPS = 30, SS = 2;
  const ff = (a) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { cwd: DIR, stdio: 'inherit' });
  const md = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(DIR, motionFile)]).toString().trim());
  ff(['-i', motionFile, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},fps=${FPS},setsar=1`, '-an', '_mv.mp4']);
  const fr = +(L - md).toFixed(2);
  if (fr > 0.2) {
    ff(['-sseof', '-0.12', '-i', '_mv.mp4', '-frames:v', '1', '_last.png']);
    ff(['-loop', '1', '-t', String(fr), '-i', '_last.png', '-vf', `scale=${W * SS}:${H * SS}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W * SS}:${H * SS},setsar=1,zoompan=z='min(1.0+0.0009*on,1.10)':d=${Math.round(fr * FPS)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},trim=duration=${fr},setpts=PTS-STARTPTS,format=yuv420p`, '-an', '_freeze.mp4']);
    ff(['-i', '_mv.mp4', '-i', '_freeze.mp4', '-filter_complex', '[0:v]format=yuv420p,setsar=1[a];[1:v]format=yuv420p,setsar=1[b];[a][b]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', outFile]);
  } else {
    ff(['-i', '_mv.mp4', '-t', String(L), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', outFile]);
  }
  ['_mv.mp4', '_last.png', '_freeze.mp4'].forEach((f) => { try { fs.unlinkSync(path.join(DIR, f)); } catch {} });
}
// The reference image fed into every scene + used as the morph end-frame.
// Defaults to the admin-approved likeness; for FAMILIES we replace it with a
// pose-matched faithful cartoon of the exact uploaded photo (see genFaithfulRef)
// so the kids stay recognizable and the morph transforms the whole picture.
let CHAR_REF = cfg.approved_character_url;
let MORPH_END = cfg.approved_character_url;
// The REAL photo the intro opens on and the morph transforms FROM. Prefer the
// photo the approved likeness was actually generated from (a crop of the
// recipient / couple, story-build-context passes it as morph_photo_url).
// recipient_photo_url is the WHOLE family photo whenever one was uploaded, and
// morphing 12 people into a 2-person cartoon is exactly what shipped on Alex el
// Chino's order (2026-09-02).
const MORPH_SRC = cfg.morph_photo_url || cfg.recipient_photo_url;
// intro -> storybook cross-fade length; shared by render() and prependMorph()
const INTRO_XF = 1.0;
const probeDur = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(DIR, f)]).toString().trim());

// For a family/group: cartoonify the EXACT uploaded photo keeping the identical
// composition, pose, background and EVERY person in place. This faithful family
// cartoon becomes BOTH the scene reference (so each kid stays recognizable across
// scenes, not a generic default) AND the morph end-frame (so the intro transforms
// the actual family picture). Best-effort — falls back to the approved likeness.
async function genFaithfulRef() {
  const file = 'morph-target.png';
  if (fs.existsSync(path.join(DIR, file))) { return; }
  try {
    const url = await gptImage(
      'Turn this exact photo into a warm, fully-stylized Pixar-style 3D animated version. Keep the IDENTICAL composition, pose, framing and background, and EVERY person in the same position with their face, hair, age and clothing faithful and recognizable. Do not add, remove, or change anyone. Wholesome, soft cinematic light.',
      [cfg.recipient_photo_url], 'faithful-ref');
    dl(url, file);
    CHAR_REF = url; MORPH_END = url;
    console.log('  faithful family reference ready (drives scenes + morph)');
  } catch (e) { console.log('  faithful-ref gen failed, using approved likeness:', e.message); }
}

async function genMorph() {
  const out = 'BOOKEND.mp4';
  if (fs.existsSync(path.join(DIR, out))) return;
  console.log('generating morph (Kie Seedance)...');
  const url = await kieRun('bytedance/seedance-2',
    'A real photograph slowly and magically transforms into a warm 3D Pixar-style animated version of the same subjects, keeping every person and the exact pose and framing. Smooth seamless morph, gentle glow. Wholesome.',
    { first_frame_url: MORPH_SRC, last_frame_url: MORPH_END, resolution: '720p', aspect_ratio: '3:4', duration: 5, generate_audio: false }, 'morph');
  dl(url, out); console.log('  morph ok');
  if (ORDER_ID) {
    try { morphUrl = await uploadAsset(out, 'video/mp4'); await checkpoint('morph'); }
    catch (e) { console.log(`  [checkpoint] morph upload failed (non-fatal): ${e.message}`); }
  }
}

// ---- guaranteed real-photo opening ----
// The morph is generated with the customer's photo as its FIRST FRAME, but
// Seedance does not always honour that — Ramón's video (2026-08-11) opened
// already-animated and had to be re-rolled by hand. Holding the actual photo on
// screen for ~1.2s and cross-fading into the morph makes the real->animated
// reveal certain instead of luck. The short fade also hides the seam when the
// morph's first frame HAS drifted. Falls back to the raw morph on any failure.
function buildIntro() {
  const W = 1080, H = 1920, FPS = 30, HOLD = 1.2, XFH = 0.35;
  if (!MORPH_SRC) return 'BOOKEND.mp4';
  const ff = (a) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { cwd: DIR, stdio: 'inherit' });
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,fps=${FPS},settb=1/${FPS},format=yuv420p`;
  try {
    if (!fs.existsSync(path.join(DIR, '_photo.png'))) dl(MORPH_SRC, '_photo.png');
    // hold runs HOLD + XFH so the crossfade has material to work with
    ff(['-loop', '1', '-t', String(HOLD + XFH), '-i', '_photo.png', '-vf', fit, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '_hold.mp4']);
    ff(['-i', '_hold.mp4', '-i', 'BOOKEND.mp4', '-filter_complex',
      `[0:v]${fit}[h];[1:v]${fit}[m];[h][m]xfade=transition=fade:duration=${XFH}:offset=${HOLD}[v]`,
      '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '_intro.mp4']);
    console.log(`  intro: real photo held ${HOLD}s before the morph`);
    return '_intro.mp4';
  } catch (e) { console.log(`  photo-hold intro failed, using raw morph: ${e.message}`); return 'BOOKEND.mp4'; }
}

// ---- 4. FFmpeg render ----
function render(flat, total, titleAt = 0) {
  const W = 1080, H = 1920, FPS = 30, SS = 2, XF = 1.0, N = flat.length, BW = W * SS, BH = H * SS;
  const ff = (a) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-stats', ...a], { cwd: DIR, stdio: 'inherit' });
  const inputs = [];
  flat.forEach((f) => { if (f.isVideo) inputs.push('-i', f.src); else inputs.push('-loop', '1', '-t', String(f.dur + XF + 0.4), '-i', f.src); });
  inputs.push('-i', 'song.mp3'); const songIdx = N;
  const fc = [];
  for (let i = 0; i < N; i++) {
    const L = +(flat[i].dur + XF).toFixed(2);
    if (flat[i].isVideo) fc.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,fps=${FPS},trim=duration=${L},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
    else { const z = i % 2 === 0 ? `min(1.0+0.0011*on,1.16)` : `max(1.16-0.0011*on,1.0)`; fc.push(`[${i}:v]scale=${BW}:${BH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${BW}:${BH},setsar=1,zoompan=z='${z}':d=${Math.round(L * FPS)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},trim=duration=${L},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`); }
  }
  let prev = 'v0';
  for (let i = 1; i < N; i++) { const off = +(flat[i].absStart - XF).toFixed(2); const lbl = i === N - 1 ? 'vx' : `x${i}`; fc.push(`[${prev}][v${i}]xfade=transition=fade:duration=${XF}:offset=${off}[${lbl}]`); prev = lbl; }
  // the title shows once the intro has cross-faded into the story (t >= titleAt)
  const T0 = +titleAt.toFixed(2);
  const tA = `if(lt(t,${T0}+0.8),(t-${T0})/0.8,if(lt(t,${T0}+4.5),1,(${T0}+5.5-t)/1))`;
  fc.push(`[vx]drawtext=fontfile=serif.ttf:text='${cfg.title.replace(/'/g, '')}':fontcolor=white:fontsize=80:box=1:boxcolor=black@0.4:boxborderw=40:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${T0},${T0}+5.5)':alpha='${tA}'[vt]`);
  const cs = (total - 13).toFixed(2); const cA = `if(lt(t,${cs}+0.8),(t-${cs})/0.8,1)`;
  fc.push(`[vt]drawtext=fontfile=serif.ttf:text='${(cfg.endcard || '').replace(/'/g, '')}':fontcolor=white:fontsize=56:box=1:boxcolor=black@0.4:boxborderw=32:x=(w-text_w)/2:y=h*0.40:enable='gte(t,${cs})':alpha='${cA}',drawtext=fontfile=serif.ttf:text='regalosquecantan.com':fontcolor=white:fontsize=40:box=1:boxcolor=black@0.4:boxborderw=22:x=(w-text_w)/2:y=h*0.49:enable='gte(t,${cs})':alpha='${cA}'[vout]`);
  fc.push(`[${songIdx}:a]atrim=0:${total},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=2,afade=t=out:st=${(total - 4).toFixed(2)}:d=4[aout]`);
  ff([...inputs, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(total), 'STORYBOOK.mp4']);
}
// ONE timeline: the song starts at t=0 and plays ONCE. The storybook is rendered
// against song time, so its first OFF seconds (which sit under the intro) are
// dropped and the morph cross-fades into it at OFF — the scene that belongs to
// song-second OFF appears exactly when the song reaches it, and the storybook's
// own audio track (the song from 0) is used untouched.
// Until 2026-09-02 the intro played the song's opening at 55% volume and the
// storybook then started the song AGAIN from 0 (Alex el Chino: "it starts,
// resets after a moment and plays over from the beginning").
function prependMorph(total, intro, OFF) {
  const W = 1080, H = 1920, FPS = 30, XF = INTRO_XF;
  const MV = +(OFF + XF).toFixed(2);
  const tot = +probeDur('STORYBOOK.mp4').toFixed(2);
  const fc = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,fps=${FPS},trim=duration=${MV},setpts=PTS-STARTPTS,settb=1/${FPS},format=yuv420p[mv]`,
    `[1:v]trim=start=${OFF},setpts=PTS-STARTPTS,fps=${FPS},settb=1/${FPS},format=yuv420p[sv]`,
    `[mv][sv]xfade=transition=fade:duration=${XF}:offset=${OFF}[v]`,
  ];
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-stats', '-i', intro, '-i', 'STORYBOOK.mp4', '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '1:a', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(tot), 'FINAL-AUTO.mp4'], { cwd: DIR, stdio: 'inherit' });
  console.log(`\nDONE -> ${path.join(DIR, 'FINAL-AUTO.mp4')} (${tot}s)`);
}

(async () => {
  await genImages();
  await checkpoint('images');   // scenes are safe from here on, even if we die below
  const { flat, total } = windows();
  console.log(`${flat.length} render-scenes, ${total}s`);
  if (WITH_MOTION) await genHeroes(flat);  // checkpoints after each hero clip
  await genMorph();                        // checkpoints the morph
  // persist the image-url map so build.cjs can save newly generated scenes
  fs.writeFileSync(path.join(DIR, 'out-urls.json'), JSON.stringify(sceneUrls));
  // the fully-resolved asset map: build.cjs reuses these hosted urls instead of
  // re-uploading the same clips at the end of the build
  for (const id of Object.keys(sceneUrls)) assetMap[id] = { ...(assetMap[id] || {}), image_url: sceneUrls[id] };
  fs.writeFileSync(path.join(DIR, 'out-assets.json'), JSON.stringify({
    scene_assets: Object.entries(assetMap).map(([image_id, a]) => ({ image_id, image_url: a.image_url || null, motion_url: a.motion_url || null })),
    morph_asset: morphUrl,
  }));
  // the intro is the raw morph, or (preferred) the real photo held in front of it;
  // built BEFORE the render so the title card can be placed after it
  const intro = buildIntro();
  const OFF = +(probeDur(intro) - INTRO_XF).toFixed(2);
  render(flat, total, OFF);
  prependMorph(total, intro, OFF);
})().catch((e) => { console.error('AUTO-BUILD FAILED:', e.message); process.exit(1); });
