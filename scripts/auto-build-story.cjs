// scripts/auto-build-story.cjs — THE AUTO-BUILDER ENGINE (proves the orchestrator).
// Given a workdir with: storyboard.json (from generate-storyboard), timing.json
// (transcribe-song), song.mp3, and config.json {name,title,endcard,
// approved_character_url, recipient_photo_url}, it:
//   1. generates every unique scene image via Kie nano-banana-edit (character ref)
//   2. computes lyric-synced windows (token-flatten anchors + dense + split long)
//   3. (optional) animates the 3 hero scenes via Kie Kling + makes the real->cartoon
//      morph via Kie Seedance
//   4. FFmpeg-renders the storybook and prepends the morph
// All Kie calls route through the deployed test-kie-video edge fn (holds KIE_API_KEY),
// so this runs with only the anon key — exactly what the Cloud Run host will do with
// its own KIE_API_KEY env. Usage: node scripts/auto-build-story.cjs <workdir> [--motion]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.resolve(process.argv[2] || '.');
const WITH_MOTION = process.argv.includes('--motion');
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const sb = JSON.parse(fs.readFileSync(path.join(DIR, 'storyboard.json'), 'utf8'));
const ts = JSON.parse(fs.readFileSync(path.join(DIR, 'timing.json'), 'utf8'));
fs.copyFileSync(path.join(ROOT, 'video-renderer', 'assets', 'serif.ttf'), path.join(DIR, 'serif.ttf'));
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const ANON = (env.match(/(?:VITE_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY)\s*=\s*"?([^"\r\n]+)/) || [])[1];
const KIE_FN = 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/test-kie-video';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kieFn(body) {
  // Resilient to transient gateway blips / empty bodies — caller treats {_bad:true}
  // as "retry / keep polling" instead of crashing the build.
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
    if (c._bad || c?.raw?.code === 429 || (c?.raw?.code && c.raw.code >= 500)) { await sleep(4000 + attempt * 3000); continue; }
    throw new Error(`${label} create failed: ${JSON.stringify(c).slice(0, 200)}`);
  }
  if (!taskId) throw new Error(`${label} create failed after retries (rate-limited)`);
  let blips = 0;
  for (let i = 0; i < 110; i++) {
    await sleep(4000);
    const s = await kieFn({ mode: 'status', taskId });
    if (s._bad) { if (++blips > 12) throw new Error(`${label} status unreadable`); continue; }
    const st = s?.raw?.data?.state || s?.data?.state;
    if (st === 'success') {
      let rj = {};
      try { rj = JSON.parse((s.raw?.data || s.data).resultJson || '{}'); } catch { continue; }
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
const sceneUrls = {}; // image_id -> Kie public URL (used as Kling motion input)

// one scene image, resilient to content blocks: as-written -> child-safe rephrase -> give up
async function genOneImage(id, prompt) {
  try {
    const url = await kieRun('google/nano-banana-edit', prompt, { image_urls: [CHAR_REF], aspect_ratio: '9:16', output_format: 'png' }, id);
    sceneUrls[id] = url; dl(url, `${id}.png`); console.log(`  ${id} ok`); return true;
  } catch (e) {
    try {
      const safe = `Wholesome family scene. Any children appear ONLY from behind or as small distant figures with NO visible child faces; focus on warmth and togetherness. ${prompt}`;
      const url = await kieRun('google/nano-banana-edit', safe, { image_urls: [CHAR_REF], aspect_ratio: '9:16', output_format: 'png' }, `${id}(safe)`);
      sceneUrls[id] = url; dl(url, `${id}.png`); console.log(`  ${id} ok (child-safe retry)`); return true;
    } catch (e2) { console.log(`  ${id} blocked (${e2.message}) -> will reuse a fallback image`); return false; }
  }
}

// ---- 1. generate every unique scene image (Kie nano-banana-edit, character ref) ----
async function genImages() {
  const firstPromptFor = {};
  for (const s of sb.scenes) if (s.image_id && !firstPromptFor[s.image_id]) firstPromptFor[s.image_id] = s.visual_prompt;
  const ids = Object.keys(firstPromptFor).filter((id) => !fs.existsSync(path.join(DIR, `${id}.png`)));
  const POOL = 4; // Kie rate-limits high call frequency — throttle
  console.log(`generating ${ids.length} unique scene images via Kie (pool=${POOL})...`);
  const failed = [];
  for (let i = 0; i < ids.length; i += POOL) {
    const results = await Promise.all(ids.slice(i, i + POOL).map((id) => genOneImage(id, firstPromptFor[id]).then((ok) => ({ id, ok }))));
    results.forEach((r) => { if (!r.ok) failed.push(r.id); });
  }
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

// ---- 3. hero motion (Kie Kling) + morph (Kie Seedance) ----
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
      let url = sceneUrls[id];
      if (!url) {
        const prompt = sb.scenes.find((s) => s.image_id === id).visual_prompt;
        url = await kieRun('google/nano-banana-edit', prompt, { image_urls: [CHAR_REF], aspect_ratio: '9:16', output_format: 'png' }, `${id}(re)`);
        sceneUrls[id] = url; dl(url, `${id}.png`);
      }
      console.log(`animating hero ${id} (window ${L}s)...`);
      const motionUrl = await kieRun('kling/v2-1-standard', 'Gentle warm cinematic motion that suits the scene, subtle and natural, soft camera, Pixar 3D animation, no distortion.', { image_url: url, duration: '5' }, `${id}-motion`);
      dl(motionUrl, `motion-${id}.mp4`);
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
// Reference image fed into every scene + used as the morph end-frame. For FAMILIES
// it's replaced with a pose-matched faithful cartoon of the exact photo (genFaithfulRef).
let CHAR_REF = cfg.approved_character_url;
let MORPH_END = cfg.approved_character_url;

async function genFaithfulRef() {
  if (fs.existsSync(path.join(DIR, 'morph-target.png'))) return;
  try {
    const url = await kieRun('google/nano-banana-edit',
      'Turn this exact photo into a warm Pixar-style 3D animated version. Keep the IDENTICAL composition, pose, framing and background, and EVERY person in the same position with their face, hair, age and clothing faithful and recognizable. Do not add, remove, or change anyone. Wholesome, soft cinematic light.',
      { image_urls: [cfg.recipient_photo_url], aspect_ratio: '3:4', output_format: 'png' }, 'faithful-ref');
    dl(url, 'morph-target.png'); CHAR_REF = url; MORPH_END = url;
    console.log('  faithful family reference ready (drives scenes + morph)');
  } catch (e) { console.log('  faithful-ref gen failed, using approved likeness:', e.message); }
}

async function genMorph() {
  const out = 'BOOKEND.mp4';
  if (fs.existsSync(path.join(DIR, out))) return;
  console.log('generating morph (Kie Seedance)...');
  const url = await kieRun('bytedance/seedance-2',
    'A real photograph slowly and magically transforms into a warm 3D Pixar-style animated version of the same subjects, keeping every person and the exact pose and framing. Smooth seamless morph, gentle glow. Wholesome.',
    { first_frame_url: cfg.recipient_photo_url, last_frame_url: MORPH_END, resolution: '720p', aspect_ratio: '3:4', duration: 5, generate_audio: false }, 'morph');
  dl(url, out); console.log('  morph ok');
}

// ---- 4. FFmpeg render ----
function render(flat, total) {
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
  const tA = `if(lt(t,0.8),t/0.8,if(lt(t,4.5),1,(5.5-t)/1))`;
  fc.push(`[vx]drawtext=fontfile=serif.ttf:text='${cfg.title.replace(/'/g, '')}':fontcolor=white:fontsize=80:box=1:boxcolor=black@0.4:boxborderw=40:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,5.5)':alpha='${tA}'[vt]`);
  const cs = (total - 13).toFixed(2); const cA = `if(lt(t,${cs}+0.8),(t-${cs})/0.8,1)`;
  fc.push(`[vt]drawtext=fontfile=serif.ttf:text='${(cfg.endcard || '').replace(/'/g, '')}':fontcolor=white:fontsize=56:box=1:boxcolor=black@0.4:boxborderw=32:x=(w-text_w)/2:y=h*0.40:enable='gte(t,${cs})':alpha='${cA}',drawtext=fontfile=serif.ttf:text='regalosquecantan.com':fontcolor=white:fontsize=40:box=1:boxcolor=black@0.4:boxborderw=22:x=(w-text_w)/2:y=h*0.49:enable='gte(t,${cs})':alpha='${cA}'[vout]`);
  fc.push(`[${songIdx}:a]atrim=0:${total},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=2,afade=t=out:st=${(total - 4).toFixed(2)}:d=4[aout]`);
  ff([...inputs, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(total), 'STORYBOOK.mp4']);
}
function prependMorph(total) {
  const W = 1080, H = 1920, FPS = 30, MV = 5.0, XF = 1.0, OFF = +(MV - XF).toFixed(2);
  const storyDur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(DIR, 'STORYBOOK.mp4')]).toString().trim());
  const tot = +(OFF + storyDur).toFixed(2);
  const fc = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,fps=${FPS},trim=duration=${MV},setpts=PTS-STARTPTS,settb=1/${FPS},format=yuv420p[mv]`,
    `[1:v]fps=${FPS},setpts=PTS-STARTPTS,settb=1/${FPS},format=yuv420p[sv]`,
    `[mv][sv]xfade=transition=fade:duration=${XF}:offset=${OFF}[v]`,
    `[2:a]atrim=0:${MV},asetpts=PTS-STARTPTS,volume='if(lt(t,0.6),(t/0.6)*0.55,0.55)',afade=t=out:st=${(MV - 0.6).toFixed(2)}:d=0.6[ma]`,
    `[1:a]adelay=${Math.round(OFF * 1000)}|${Math.round(OFF * 1000)}[sa]`,
    `[ma][sa]amix=inputs=2:duration=longest:normalize=0[a]`,
  ];
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-stats', '-i', 'BOOKEND.mp4', '-i', 'STORYBOOK.mp4', '-i', 'song.mp3', '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(tot), 'FINAL-AUTO.mp4'], { cwd: DIR, stdio: 'inherit' });
  console.log(`\nDONE -> ${path.join(DIR, 'FINAL-AUTO.mp4')} (${tot}s)`);
}

(async () => {
  await genImages();
  const { flat, total } = windows();
  console.log(`${flat.length} render-scenes, ${total}s`);
  if (WITH_MOTION) await genHeroes(flat);
  await genMorph();
  render(flat, total);
  prependMorph(total);
})().catch((e) => { console.error('AUTO-BUILD FAILED:', e.message); process.exit(1); });
