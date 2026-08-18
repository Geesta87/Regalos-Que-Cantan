// Regenerates the right-sized Cenzo derivatives that src/components/Cenzo.jsx
// actually ships. The 1024px masters (cenzo-mark.png, cenzo-cutout.png) stay in
// the repo as the source of truth but are never served to customers — they are
// ~633KB and ~1.5MB, which would put 2MB back onto the landing page.
//
// Run after replacing either master:  node scripts/build-cenzo-sizes.mjs
//
// It also re-encodes the silent singing loop used on the generating screen.
// The master (cenzo-sing.mp4) is 1280x720 at 2.3MB — far too heavy for a funnel
// screen; at 640px it lands around 144KB with no visible loss at display size.
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand', 'cenzo');

const JOBS = [
  ['cenzo-mark.png', 'cenzo-mark-64.png', 64],
  ['cenzo-mark.png', 'cenzo-mark-128.png', 128],
  ['cenzo-cutout.png', 'cenzo-cutout-256.png', 256],
  ['cenzo-cutout.png', 'cenzo-cutout-512.png', 512],
  ['cenzo-cutout.png', 'cenzo-cutout-768.png', 768],
];

for (const [src, out, width] of JOBS) {
  await sharp(join(DIR, src))
    .resize({ width })
    .png({ compressionLevel: 9, palette: true, quality: 88 })
    .toFile(join(DIR, out));
  console.log(out.padEnd(24) + (statSync(join(DIR, out)).size / 1024).toFixed(0) + ' KB');
}

// The loop is silent by design — see CenzoLive in src/components/Cenzo.jsx.
// `-an` drops any audio track so nothing can surprise a customer on a bus.
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', join(DIR, 'cenzo-sing.mp4'),
  '-an', '-vf', 'scale=640:-2', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(DIR, 'cenzo-sing-640.mp4')]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', join(DIR, 'cenzo-sing.mp4'),
  '-vf', 'scale=640:-2,select=eq(n\\,12)', '-vframes', '1', '-q:v', '6',
  join(DIR, 'cenzo-sing-poster.jpg')]);
for (const f of ['cenzo-sing-640.mp4', 'cenzo-sing-poster.jpg']) {
  console.log(f.padEnd(24) + (statSync(join(DIR, f)).size / 1024).toFixed(0) + ' KB');
}
