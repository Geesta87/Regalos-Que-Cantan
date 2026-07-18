// Person matting (RobustVideoMatting, ONNX) for the depth-title effect:
// alpha = where the person is, so titles can composite BEHIND them.
// Runs on CPU. Only the intro window is ever matted (~3s at 15fps), so the
// cost per clip is a few seconds, not minutes.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL_PATH = process.env.RVM_MODEL || path.join(__dirname, 'assets', 'rvm.onnx');
// Matting resolution: RVM is trained for this scale of input; the mask is
// upscaled bilinearly at composite time and the soft edge survives fine.
const MW = 432;
const MH = 768;
const FPS = 15;

let ortModule = null; // lazy so the server still boots if the dep is absent
function ort() {
  if (!ortModule) ortModule = require('onnxruntime-node');
  return ortModule;
}

// Matte `seconds` of `srcFile` (a finished, final-geometry video) into
// dir/<out> — a grayscale person mask video. `start` offsets into the source
// (used for mid-clip key-word windows).
async function buildPersonAlpha(dir, srcFile, seconds, log = () => {}, { start = 0, out = 'alpha.mp4' } = {}) {
  const t0 = Date.now();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(seconds), '-i', srcFile,
    '-vf', `fps=${FPS},scale=${MW}:${MH}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'depth-frames.rgb'], { cwd: dir });
  const raw = fs.readFileSync(path.join(dir, 'depth-frames.rgb'));
  const frameBytes = MW * MH * 3;
  const nFrames = Math.floor(raw.length / frameBytes);
  if (!nFrames) throw new Error('no frames extracted for matting');

  const O = ort();
  const session = await O.InferenceSession.create(MODEL_PATH);
  const zero = () => new O.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
  let r1 = zero(), r2 = zero(), r3 = zero(), r4 = zero();
  const dsr = new O.Tensor('float32', new Float32Array([0.6]), [1]);
  const plane = MH * MW;
  const alpha = Buffer.allocUnsafe(nFrames * plane);
  // Track the highest point of the person (usually the head top) across the
  // window — depth text is placed just above it so it stays visible.
  let headTopRow = MH;
  const col0 = Math.round(MW * 0.2), col1 = Math.round(MW * 0.8);
  for (let i = 0; i < nFrames; i++) {
    const off = i * frameBytes;
    const chw = new Float32Array(3 * plane);
    for (let p = 0; p < plane; p++) {
      chw[p] = raw[off + p * 3] / 255;
      chw[plane + p] = raw[off + p * 3 + 1] / 255;
      chw[2 * plane + p] = raw[off + p * 3 + 2] / 255;
    }
    const out = await session.run({
      src: new O.Tensor('float32', chw, [1, 3, MH, MW]),
      r1i: r1, r2i: r2, r3i: r3, r4i: r4, downsample_ratio: dsr,
    });
    r1 = out.r1o; r2 = out.r2o; r3 = out.r3o; r4 = out.r4o;
    const pha = out.pha.data;
    for (let p = 0; p < plane; p++) alpha[i * plane + p] = Math.max(0, Math.min(255, Math.round(pha[p] * 255)));
    // head-top scan: first row (top-down, upper 70%) whose center band is
    // meaningfully covered by the person
    for (let row = 0; row < Math.round(MH * 0.7); row++) {
      let sum = 0, n = 0;
      for (let c = col0; c < col1; c += 4) { sum += pha[row * MW + c]; n++; }
      if (sum / n > 0.3) { if (row < headTopRow) headTopRow = row; break; }
    }
  }
  fs.writeFileSync(path.join(dir, 'depth-alpha.gray'), alpha);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray',
    '-s', `${MW}x${MH}`, '-r', String(FPS), '-i', 'depth-alpha.gray',
    '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', out], { cwd: dir });
  fs.rmSync(path.join(dir, 'depth-frames.rgb'), { force: true });
  fs.rmSync(path.join(dir, 'depth-alpha.gray'), { force: true });
  const headTopFrac = headTopRow >= MH ? null : headTopRow / MH;
  log(`depth matting: ${nFrames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s (${out}, headTop ${headTopFrac === null ? 'n/a' : headTopFrac.toFixed(2)})`);
  return { file: path.join(dir, out), headTopFrac };
}

module.exports = { buildPersonAlpha };
