// video-renderer/shareVideo.cjs
// Branded "share video" for every paid song: the song's genre artwork over a
// blurred cinematic backdrop with a slow Ken-Burns zoom, "Para <recipient> /
// con amor de <sender>" lettering, a persistent RegalosQueCantan.com watermark,
// and a branded end card over the song's final seconds. The result replaces the
// audio player on the /song/:id gift page, so sharing the link feels like
// sending a video.
//
// Job contract (dispatched by the render-share-videos edge fn):
//   { song_id, audio_url, art_url?, recipient_name?, sender_name? }
// Output: 1280x720 H.264 MP4 (~8-10MB for a 3.5-min song, ~1-3 min render).
// If the artwork can't be downloaded the video falls back to a plain dark
// backdrop — never fail the whole render over a missing image.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const FONT = path.join(__dirname, 'assets', 'fonts', 'Montserrat-Black.ttf');

const END_CARD_SECONDS = 5.5;
const WATERMARK = 'REGALOSQUECANTAN.COM';
const BRAND_LINE = 'RegalosQueCantan.com';
const BRAND_TAGLINE = 'Regala una canción única';
const BRAND_SUB = 'Hecha especialmente para esa persona especial';

function ff(args, cwd) {
  // stderr streams to the instance log instead of a pipe: some source files
  // (junk frames in the mp3, odd jpegs) make ffmpeg emit warnings PER FRAME
  // even at -loglevel error — enough to overflow execFileSync's 1MB pipe
  // buffer and kill the render with ENOBUFS (seen live 2026-07-20).
  // Hard 15-min ceiling: a poisoned input (e.g. HTML masquerading as a jpeg)
  // once made ffmpeg error per frame indefinitely, pinning the instance.
  return execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    { cwd, stdio: ['ignore', 'ignore', 'inherit'], timeout: 15 * 60 * 1000, killSignal: 'SIGKILL' });
}

// The site answers MISSING album art with the SPA's index.html and HTTP 200
// (Vercel rewrite) — a status check can't catch it. Sniff magic bytes so we
// only ever hand ffmpeg a real JPEG/PNG/WebP.
function looksLikeImage(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    if (buf[0] === 0xff && buf[1] === 0xd8) return true;                          // JPEG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) return true;       // PNG
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
    return false;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} for ${url.slice(0, 80)}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

function probeDuration(file, cwd) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { cwd, maxBuffer: 16 * 1024 * 1024 });
  const d = parseFloat(out.toString().trim());
  if (!d || !isFinite(d)) throw new Error('could not probe audio duration');
  return d;
}

// Long names must not run off the frame; shrink with length. drawtext has no
// auto-fit, so this is a coarse but reliable ladder tuned for 1280px wide.
function fitSize(text, base) {
  const n = (text || '').length;
  if (n <= 18) return base;
  if (n <= 26) return Math.round(base * 0.8);
  if (n <= 36) return Math.round(base * 0.64);
  return Math.round(base * 0.52);
}

// Names/text go through textfile= (not text=) so we never fight drawtext's
// escaping rules with customer-provided strings.
function textFile(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

async function renderShareVideo(job, { dir, log }) {
  fs.mkdirSync(dir, { recursive: true });

  const audioPath = path.join(dir, 'song.mp3');
  await download(job.audio_url, audioPath);
  const durationSec = probeDuration('song.mp3', dir);
  log(`audio ${durationSec.toFixed(1)}s`);

  // Artwork candidates in preference order (own genre art first, then the
  // provider cover); first successful download wins, none -> plain backdrop.
  let hasArt = false;
  const artPath = path.join(dir, 'art.jpg');
  const artUrls = Array.isArray(job.art_urls) ? job.art_urls : (job.art_url ? [job.art_url] : []);
  for (const artUrl of artUrls) {
    try {
      await download(artUrl, artPath);
      if (fs.statSync(artPath).size > 1000 && looksLikeImage(artPath)) { hasArt = true; break; }
      log(`art from ${artUrl.slice(0, 60)} is not a real image — trying next source`);
    } catch (e) {
      log(`art download failed (${e.message}) — trying next source`);
    }
  }
  if (!hasArt && artUrls.length) log('no artwork usable — plain backdrop fallback');

  const recipient = (job.recipient_name || '').trim();
  const sender = (job.sender_name || '').trim();
  const endStart = Math.max(4, durationSec - END_CARD_SECONDS).toFixed(2);

  const paraText = recipient ? `Para ${recipient}` : 'Una canción para ti';
  const senderText = sender ? `con amor de ${sender}` : '';
  const paraSize = fitSize(paraText, 54);
  const senderSize = fitSize(senderText, 30);

  const fPara = textFile(dir, 'para.txt', paraText);
  const fSender = senderText ? textFile(dir, 'sender.txt', senderText) : null;
  const fWm = textFile(dir, 'wm.txt', WATERMARK);
  const fBrand = textFile(dir, 'brand.txt', BRAND_LINE);
  const fTag = textFile(dir, 'tag.txt', BRAND_TAGLINE);
  const fSub = textFile(dir, 'sub.txt', BRAND_SUB);

  const draw = [
    `drawtext=fontfile=${FONT}:textfile=${fPara}:fontcolor=white:fontsize=${paraSize}:x=60:y=h-160:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='lt(t,${endStart})'`,
    fSender
      ? `drawtext=fontfile=${FONT}:textfile=${fSender}:fontcolor=white@0.85:fontsize=${senderSize}:x=62:y=h-90:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='lt(t,${endStart})'`
      : null,
    `drawtext=fontfile=${FONT}:textfile=${fWm}:fontcolor=white@0.45:fontsize=20:x=w-tw-24:y=24:shadowcolor=black@0.4:shadowx=1:shadowy=1`,
    `drawbox=color=black@0.65:t=fill:enable='gte(t,${endStart})'`,
    `drawtext=fontfile=${FONT}:textfile=${fBrand}:fontcolor=white:fontsize=58:x=(w-tw)/2:y=(h/2)-70:enable='gte(t,${endStart})'`,
    `drawtext=fontfile=${FONT}:textfile=${fTag}:fontcolor=0xf74da6:fontsize=34:x=(w-tw)/2:y=(h/2)+10:enable='gte(t,${endStart})'`,
    `drawtext=fontfile=${FONT}:textfile=${fSub}:fontcolor=white@0.7:fontsize=22:x=(w-tw)/2:y=(h/2)+70:enable='gte(t,${endStart})'`,
  ].filter(Boolean).join(',');

  const outPath = path.join(dir, 'share.mp4');
  const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '160k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest'];

  if (hasArt) {
    // Artwork: blurred fill backdrop + sharp centered art + slow Ken-Burns zoom.
    const graph =
      `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,gblur=sigma=30,eq=brightness=-0.2[bg];` +
      `[0:v]scale=-2:620[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[comp];` +
      `[comp]scale=2560:1440,zoompan=z='min(1+0.00008*on,1.35)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=25,${draw}[v]`;
    ff(['-loop', '1', '-i', 'art.jpg', '-i', 'song.mp3',
      '-filter_complex', graph, '-map', '[v]', '-map', '1:a', ...encode, 'share.mp4'], dir);
  } else {
    // No artwork: plain dark brand backdrop, same lettering.
    ff(['-f', 'lavfi', '-i', 'color=c=0x190d13:s=1280x720:r=25', '-i', 'song.mp3',
      '-filter_complex', `[0:v]${draw}[v]`, '-map', '[v]', '-map', '1:a', ...encode, 'share.mp4'], dir);
  }

  return { finalPath: outPath, durationSec };
}

module.exports = { renderShareVideo };
