// story-renderer/build.cjs — one full automated build for an order.
//   node build.cjs <story_video_order_id>
// Routes everything through edge fns on the ANON key (NO secrets needed):
//   story-build-context -> engine.cjs -> story-build-finalize.
// Env: SUPABASE_URL, ANON_KEY.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.env.SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const ANON = process.env.ANON_KEY;
const orderId = process.argv[2];
if (!orderId) { console.error('usage: node build.cjs <order_id>'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (fn, body) => {
  // Retry transient network blips ("fetch failed") so a flaky moment doesn't throw
  // away a finished build on the final upload step.
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(`${BASE}/functions/v1/${fn}`, { method: 'POST', headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const txt = await r.text();
      try { return JSON.parse(txt); } catch { return { success: false, error: `non-JSON (${r.status})` }; }
    } catch (e) { lastErr = e; await sleep(2000 + attempt * 2000); }
  }
  throw new Error(`${fn}: ${lastErr?.message || 'fetch failed after retries'}`);
};

(async () => {
  try {
    console.log(`[build] ${orderId}: fetching context...`);
    const ctx = await post('story-build-context', { story_video_order_id: orderId });
    if (!ctx.success) throw new Error(`context: ${ctx.error}`);

    const dir = path.join(os.tmpdir(), `story-${orderId}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(ctx.config));
    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(ctx.storyboard));
    fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(ctx.timing));
    console.log('[build] downloading song...');
    execFileSync('curl', ['-s', '-o', path.join(dir, 'song.mp3'), ctx.song_audio_url]);

    // Seed the workdir with the order's persisted scene assets (revise flow /
    // partial rebuild): the engine skips anything already on disk, so only
    // scenes the admin cleared (or brand-new ones) are regenerated.
    const seedUrls = {};
    for (const a of ctx.scene_assets || []) {
      if (a.image_url) {
        execFileSync('curl', ['-s', '-o', path.join(dir, `${a.image_id}.png`), a.image_url]);
        seedUrls[a.image_id] = a.image_url;
      }
      if (a.motion_url) execFileSync('curl', ['-s', '-o', path.join(dir, `motion-${a.image_id}.mp4`), a.motion_url]);
    }
    if (ctx.morph_asset) execFileSync('curl', ['-s', '-o', path.join(dir, 'BOOKEND.mp4'), ctx.morph_asset]);
    fs.writeFileSync(path.join(dir, 'seed-urls.json'), JSON.stringify(seedUrls));
    if (Object.keys(seedUrls).length) console.log(`[build] seeded ${Object.keys(seedUrls).length} existing scene(s)${ctx.morph_asset ? ' + morph' : ''}`);

    console.log('[build] running engine (storyboard -> scenes -> motion -> morph -> render)...');
    execFileSync('node', [path.join(__dirname, 'engine.cjs'), dir, '--motion'], { stdio: 'inherit', env: process.env });

    const final = path.join(dir, 'FINAL-AUTO.mp4');
    if (!fs.existsSync(final)) throw new Error('engine produced no FINAL-AUTO.mp4');

    // curl PUT to a signed storage url (node fetch is unreliable for large bodies)
    const putFile = async (file, contentType) => {
      const u = await post('story-build-finalize', { mode: 'asset-upload-url', story_video_order_id: orderId, file: path.basename(file) });
      if (!u.success) throw new Error(`asset-upload-url ${path.basename(file)}: ${u.error}`);
      const c = execFileSync('curl', ['-s', '-o', path.join(dir, '_assetup.log'), '-w', '%{http_code}', '-X', 'PUT', u.signed_url, '-H', `Content-Type: ${contentType}`, '--data-binary', `@${file}`]).toString().trim();
      if (c !== '200') throw new Error(`asset PUT ${path.basename(file)} http=${c}`);
      return u.public_url;
    };

    // Persist per-scene assets so the admin can review + revise individual scenes.
    // Best-effort: an asset-save hiccup must not fail a finished build.
    try {
      console.log('[build] persisting scene assets...');
      const outUrls = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'out-urls.json'), 'utf8')); } catch { return seedUrls; } })();
      const sb = ctx.storyboard;
      const heroIds = new Set((sb.scenes || []).filter((s) => s.hero).map((s) => s.image_id));
      const sceneAssets = [];
      for (const id of [...new Set((sb.scenes || []).map((s) => s.image_id).filter(Boolean))]) {
        const entry = { image_id: id, image_url: outUrls[id] || null, motion_url: null };
        const rawMotion = path.join(dir, `motion-${id}.mp4`);
        if (heroIds.has(id) && fs.existsSync(rawMotion)) entry.motion_url = await putFile(rawMotion, 'video/mp4');
        sceneAssets.push(entry);
      }
      let morphUrl = ctx.morph_asset || null;
      if (!morphUrl && fs.existsSync(path.join(dir, 'BOOKEND.mp4'))) morphUrl = await putFile(path.join(dir, 'BOOKEND.mp4'), 'video/mp4');
      const saved = await post('story-build-finalize', { mode: 'save-assets', story_video_order_id: orderId, scene_assets: sceneAssets, morph_asset: morphUrl });
      if (!saved.success) console.error('[build] save-assets failed (non-fatal):', saved.error);
    } catch (e) { console.error('[build] asset persistence failed (non-fatal):', e.message); }

    console.log('[build] uploading final video...');
    const up = await post('story-build-finalize', { mode: 'upload-url', story_video_order_id: orderId });
    if (!up.success) throw new Error(`upload-url: ${up.error}`);
    const code = execFileSync('curl', ['-s', '-o', path.join(dir, '_up.log'), '-w', '%{http_code}', '-X', 'PUT', up.signed_url, '-H', 'Content-Type: video/mp4', '--data-binary', `@${final}`]).toString().trim();
    if (code !== '200') throw new Error(`upload PUT http=${code}`);

    const done = await post('story-build-finalize', { mode: 'complete', story_video_order_id: orderId, cost_credits: 380 });
    console.log(`[build] DONE -> state=${done.state}`);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  } catch (e) {
    console.error('[build] FAILED:', e.message);
    await post('story-build-finalize', { mode: 'fail', story_video_order_id: orderId, error: e.message }).catch(() => {});
    process.exit(1);
  }
})();
