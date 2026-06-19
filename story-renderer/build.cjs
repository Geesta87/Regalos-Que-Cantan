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

    console.log('[build] running engine (storyboard -> scenes -> motion -> morph -> render)...');
    execFileSync('node', [path.join(__dirname, 'engine.cjs'), dir, '--motion'], { stdio: 'inherit', env: process.env });

    const final = path.join(dir, 'FINAL-AUTO.mp4');
    if (!fs.existsSync(final)) throw new Error('engine produced no FINAL-AUTO.mp4');

    console.log('[build] uploading final video...');
    const up = await post('story-build-finalize', { mode: 'upload-url', story_video_order_id: orderId });
    if (!up.success) throw new Error(`upload-url: ${up.error}`);
    // node fetch is unreliable for large PUT bodies; use curl (present in the image)
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
