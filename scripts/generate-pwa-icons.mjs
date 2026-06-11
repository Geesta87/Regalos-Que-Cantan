// Generates the PWA icon set in public/icons/ from public/icons/icon.svg.
// Run: node scripts/generate-pwa-icons.mjs
//
// "any" icons keep the rounded-rect transparent look; "maskable" icons are
// rendered full-bleed on the brand green so OS masks (circles, squircles)
// never clip the artwork; apple-touch-icon is opaque because iOS renders
// transparency as black.

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const iconsDir = path.join(root, 'public', 'icons');
const svg = readFileSync(path.join(iconsDir, 'icon.svg'));

const BG = '#1A4338';

async function plain(size, name) {
  await sharp(svg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(path.join(iconsDir, name));
  console.log('wrote', name);
}

// Full-bleed: artwork scaled to ~78% and centered on a solid square so the
// important content stays inside the maskable safe zone.
async function maskable(size, name) {
  const inner = Math.round(size * 0.78);
  const art = await sharp(svg, { density: 300 }).resize(inner, inner).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toFile(path.join(iconsDir, name));
  console.log('wrote', name);
}

// Opaque (iOS home screen): artwork on solid background, no transparency.
async function opaque(size, name) {
  const art = await sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 3, background: BG },
  })
    .composite([{ input: art }])
    .png()
    .toFile(path.join(iconsDir, name));
  console.log('wrote', name);
}

await plain(16, 'icon-16.png');
await plain(32, 'icon-32.png');
await plain(192, 'icon-192.png');
await plain(512, 'icon-512.png');
await maskable(192, 'icon-maskable-192.png');
await maskable(512, 'icon-maskable-512.png');
await opaque(180, 'apple-touch-icon.png');
console.log('done');
