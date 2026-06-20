// video-renderer/render.js
// In-house video renderer (the Shotstack replacement), as a reusable module.
// renderOrder(order, opts) -> { finalPath, durationSec, width, height }
//
// Mirrors supabase/functions/generate-video/index.ts: Ken Burns (supersampled,
// smooth), blurred-bg fit, "boost" color, word-wrapped "Para:", closing brand
// card, song fade-out, and all 3 message types (video | audio-only | none).
// HEIC/HEIF photos are converted via the Supabase render endpoint, like prod.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FONT = process.env.FONT_PATH || path.join(__dirname, 'assets', 'font.ttf');   // clean sans (URL/secondary)
const SERIF = process.env.SERIF_PATH || path.join(__dirname, 'assets', 'serif.ttf'); // Cinzel — engraved-luxury display caps
const PLATE = 'box=1:boxcolor=black@0.4:boxborderw=40'; // subtle dark plate behind text for premium legibility
// fade a caption in over 0.5s, hold, fade out over the last 1s of its 0..4s window
const CAP_ALPHA = `if(lt(t,0.5),t/0.5,if(lt(t,3),1,(4-t)/1))`;
const DIMS = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };
const FPS = 30, SS = 2, XFADE = 1.0;
const BOOST = 'eq=saturation=1.40:contrast=1.07:brightness=0.02';
const BED = 0.14; // song "background bed" volume under a spoken message (owner-approved level B)
const VOICE_LOUDNORM = 'loudnorm=I=-14:TP=-1.5:LRA=11'; // level the message voice to a clear, consistent loudness

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%');
function wrap(text, maxChars) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    if ((line + ' ' + w).trim().length > maxChars && line) { out.push(line); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}

async function dl(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function renderOrder(order, opts = {}) {
  const dir = opts.dir || fs.mkdtempSync(path.join(require('os').tmpdir(), 'render-'));
  fs.mkdirSync(dir, { recursive: true });
  const log = opts.log || (() => {});
  // Copy the font into the work dir and reference it by bare name in drawtext.
  // ff() runs with cwd=dir, so "font.ttf" resolves cleanly — no path escaping
  // needed (avoids Windows drive-colon / space pitfalls; identical on Linux).
  fs.copyFileSync(FONT, path.join(dir, 'font.ttf'));
  fs.copyFileSync(SERIF, path.join(dir, 'serif.ttf'));
  const [W, H] = DIMS[order.aspect_ratio] || DIMS['9:16'];
  const BW = W * SS, BH = H * SS;

  const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd: dir });
  const probe = (f) => JSON.parse(execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', f], { cwd: dir }).toString());
  // Probe a media's pixel dimensions (first video/image stream).
  const probeWH = (f) => {
    try {
      const o = JSON.parse(execFileSync('ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', f], { cwd: dir }).toString());
      const s = (o.streams || [])[0] || {};
      return { w: s.width || W, h: s.height || H };
    } catch { return { w: W, h: H }; }
  };
  // Smart-hybrid framing: crop-to-fill when a cover-crop keeps >=60% of the
  // photo (portrait-ish — looks full-bleed, no bands). Use blurred-bg fit only
  // when cropping would lose >40% (true landscape) so those aren't butchered.
  const shouldBlur = (pw, ph) => {
    const rp = pw / ph, rf = W / H;
    const kept = rp > rf ? rf / rp : rp / rf;
    return kept < 0.6;
  };

  // ---- download photos (HEIC -> WebP via Supabase render endpoint) ----
  const photos = [];
  for (let i = 0; i < order.photo_urls.length; i++) {
    const url = order.photo_urls[i];
    const base = path.join(dir, `photo_${String(i).padStart(2, '0')}`);
    if (/\.(heic|heif)$/i.test(url.split('?')[0])) {
      const renderUrl = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?format=webp&quality=85';
      const dest = base + '.webp';
      try { await dl(renderUrl, dest); photos.push(dest); log(`HEIC->WebP ${i}`); continue; }
      catch (e) { log(`HEIC convert failed ${i}: ${e.message}; raw`); }
    }
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    const dest = `${base}.${ext}`;
    await dl(url, dest); photos.push(dest);
  }

  const song = path.join(dir, 'song.mp3'); await dl(order.audio_url, song);
  const songDur = +probe(song).format.duration;

  // ---- message kind ----
  let msgKind = 'none', msgFile = null, msgDur = 0, msgHasAudio = false;
  if (order.message_url) {
    const ext = order.message_url.split('?')[0].split('.').pop().toLowerCase();
    msgFile = path.join(dir, `message.${ext}`);
    await dl(order.message_url, msgFile);
    const mp = probe(msgFile);
    msgDur = +mp.format.duration;
    const hasV = (mp.streams || []).some((s) => s.codec_type === 'video');
    msgHasAudio = (mp.streams || []).some((s) => s.codec_type === 'audio');
    msgKind = hasV ? 'video' : 'audio';
  }
  log(`song ${songDur.toFixed(1)}s, message=${msgKind}`);

  // ---- timing (mirrors buildShotstackTimeline) ----
  const N = photos.length;
  const hasMsg = msgKind !== 'none' && msgDur > 0;
  // When there's a message, end the slideshow a bit early and let the song's own
  // tail keep playing softly UNDER the message (seamless continuation, not a
  // restart). RESERVE = how much of the song we hold back for that bed.
  const RESERVE = hasMsg ? Math.min(msgDur, 30) : 0;
  const target = Math.max(30, Math.max(30, songDur) - RESERVE);
  const photoDur = Math.min(60, Math.max(8, (target + (N - 1) * XFADE) / N));
  const slideDur = +(N * photoDur - (N - 1) * XFADE).toFixed(3);

  // ---- per-photo Ken Burns clip (blurred-bg fit + boost) ----
  const photoClip = (img, dur, zoomIn, out, overlay) => {
    const z = zoomIn ? `min(1.0+0.0016*on,1.22)` : `max(1.22-0.0016*on,1.0)`;
    const { w: pw, h: ph } = probeWH(img);
    const base = shouldBlur(pw, ph)
      ? `[0:v]split=2[bg][fg];` +
        `[bg]scale=${BW}:${BH}:force_original_aspect_ratio=increase,crop=${BW}:${BH},boxblur=${20 * SS}:1,eq=brightness=-0.12[bgb];` +
        `[fg]scale=${BW}:${BH}:force_original_aspect_ratio=decrease:flags=lanczos[fgs];` +
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,${BOOST}[base]`
      // crop-to-fill (full-bleed, no bands)
      : `[0:v]scale=${BW}:${BH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${BW}:${BH},setsar=1,${BOOST}[base]`;
    let chain = base + `;` +
      `[base]zoompan=z='${z}':d=${Math.round(dur * FPS)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},` +
      `trim=duration=${dur},setpts=PTS-STARTPTS,format=yuv420p[v]`;
    if (overlay) {
      chain = chain.replace('[v]', '[vpre]') +
        `;[vpre]drawtext=fontfile=serif.ttf:text='${esc(overlay)}':fontcolor=white:fontsize=80:` +
        `${PLATE}:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,4)':alpha='${CAP_ALPHA}'[v]`;
    }
    ff(['-loop', '1', '-t', String(dur + 0.3), '-i', img, '-filter_complex', chain,
      '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', out]);
  };

  const clips = [];
  for (let i = 0; i < N; i++) {
    const out = path.join(dir, `clip_${String(i).padStart(2, '0')}.mp4`);
    photoClip(photos[i], photoDur, i % 2 === 0, out);
    clips.push(out);
  }
  log(`${N} clips done`);

  // ---- slideshow: crossfade + overlays + song ----
  const inputs = [];
  clips.forEach((c) => inputs.push('-i', c));
  inputs.push('-i', song);
  const songIdx = clips.length;
  const fc = [];
  let prev = '0:v';
  for (let i = 1; i < N; i++) {
    const offset = +((photoDur - XFADE) * i).toFixed(3);
    const lbl = i === N - 1 ? 'vx' : `x${i}`;
    fc.push(`[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset}[${lbl}]`);
    prev = lbl;
  }
  // Opening title — elegant serif, single cohesive plate around the whole
  // (possibly multi-line) name, center-aligned. Written to a textfile so accents
  // and line breaks are exact.
  const nameLines = wrap(`Para ${order.recipient_name}`, 16); // caps run wider, wrap sooner
  fs.writeFileSync(path.join(dir, 'title.txt'), nameLines.join('\n'));
  const openFont = nameLines.length > 3 ? 54 : nameLines.length > 2 ? 66 : 84;
  const openAlpha = `if(lt(t,0.6),t/0.6,if(lt(t,3.2),1,(4-t)/0.8))`;
  fc.push(`[vx]drawtext=fontfile=serif.ttf:textfile=title.txt:fontcolor=white:fontsize=${openFont}:` +
    `line_spacing=18:text_align=C:box=1:boxcolor=black@0.4:boxborderw=46:x=(w-text_w)/2:y=h*0.10:` +
    `enable='between(t,0,4)':alpha='${openAlpha}'[vtitle]`);
  // Closing brand card — "Hecho con amor". With a message it belongs at the END
  // of the message (the video should finish ON the brand card, not show it before
  // the personal message); without a message it's the last 3.5s of the slideshow.
  const closingFrag = (inLabel, outLabel, clipDur) => {
    const cs = Math.max(0, clipDur - 3.5).toFixed(2);
    const ca = `if(lt(t,${cs}+0.6),(t-${cs})/0.6,1)`;
    return `[${inLabel}]drawtext=fontfile=serif.ttf:text='Hecho con amor':fontcolor=white:fontsize=64:` +
      `box=1:boxcolor=black@0.4:boxborderw=36:x=(w-text_w)/2:y=h*0.42:enable='gte(t,${cs})':alpha='${ca}',` +
      `drawtext=fontfile=font.ttf:text='regalosquecantan.com':fontcolor=white:fontsize=34:` +
      `shadowcolor=black@0.7:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.53:enable='gte(t,${cs})':alpha='${ca}'[${outLabel}]`;
  };
  fc.push(hasMsg ? `[vtitle]null[vout]` : closingFrag('vtitle', 'vout', slideDur));
  // No message: fade the song out at the end. With a message: let it ride at full
  // into the message section, where it steps back to the bed under the voice.
  fc.push(hasMsg
    ? `[${songIdx}:a]atrim=0:${slideDur},asetpts=PTS-STARTPTS[aout]`
    : `[${songIdx}:a]atrim=0:${slideDur},asetpts=PTS-STARTPTS,afade=t=out:st=${(slideDur - 3).toFixed(3)}:d=3[aout]`);
  const slideshow = path.join(dir, 'slideshow.mp4');
  ff([...inputs, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-t', String(slideDur), slideshow]);
  log('slideshow done');

  const finalPath = path.join(dir, 'final.mp4');

  if (msgKind === 'none') {
    fs.copyFileSync(slideshow, finalPath);
  } else {
    const msgNorm = path.join(dir, 'message_norm.mp4');
    const msgEnd = (slideDur + msgDur).toFixed(3);
    // Song "bed": the reserved song tail (continuing from where the slideshow left
    // off at slideDur) held softly under the voice — full for 0.5s then down to BED.
    const bedSrc = (idx) =>
      `[${idx}:a]atrim=${slideDur}:${msgEnd},asetpts=PTS-STARTPTS,` +
      `volume='if(lt(t,0.5),1-(t/0.5)*${(1 - BED).toFixed(2)},${BED})':eval=frame,` +
      `afade=t=out:st=${Math.max(0, msgDur - 2).toFixed(2)}:d=2[bed]`;

    if (msgKind === 'video') {
      const { w: mw, h: mh } = probeWH(msgFile);
      const mbase = shouldBlur(mw, mh)
        ? `[0:v]split=2[mbg][mfg];` +
          `[mbg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:1,eq=brightness=-0.12[mbgb];` +
          `[mfg]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[mfgs];` +
          `[mbgb][mfgs]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${FPS}[mb]`
        : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,fps=${FPS}[mb]`;
      const vcap = `[mb]drawtext=fontfile=serif.ttf:text='Un mensaje de ${esc(order.sender_name)}':fontcolor=white:fontsize=80:` +
        `${PLATE}:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,4)':alpha='${CAP_ALPHA}'[vc]`;
      const vlabel = `${vcap};${closingFrag('vc', 'v', msgDur)}`;
      // inputs: 0 = message video, 1 = song (for the bed)
      const afilter = msgHasAudio
        // voice present: leveled voice in front + song bed underneath
        ? `${bedSrc(1)};[0:a]${VOICE_LOUDNORM}[voice];[bed][voice]amix=inputs=2:normalize=0:duration=longest[a]`
        // no voice in the recording: just let the song continue at full
        : `[1:a]atrim=${slideDur}:${msgEnd},asetpts=PTS-STARTPTS,afade=t=out:st=${Math.max(0, msgDur - 2).toFixed(2)}:d=2[a]`;
      ff(['-i', msgFile, '-i', song, '-filter_complex', `${mbase};${vlabel};${afilter}`,
        '-map', '[v]', '-map', '[a]', '-t', String(msgDur), '-r', String(FPS),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', msgNorm]);
    } else {
      // audio-only message: leveled voice over the last photo + song bed underneath.
      const lastClip = path.join(dir, 'msg_visual.mp4');
      photoClip(photos[N - 1], msgDur + 1, true, lastClip, `Un mensaje de ${order.sender_name}`);
      // inputs: 0 = last-photo clip, 1 = song (bed), 2 = voice
      const afilter = `${closingFrag('0:v', 'vfin', msgDur)};${bedSrc(1)};[2:a]${VOICE_LOUDNORM}[voice];[bed][voice]amix=inputs=2:normalize=0:duration=longest[a]`;
      ff(['-i', lastClip, '-i', song, '-i', msgFile, '-filter_complex', afilter,
        '-map', '[vfin]', '-map', '[a]', '-t', String(msgDur), '-r', String(FPS),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', msgNorm]);
    }
    ff(['-i', slideshow, '-i', msgNorm,
      '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]', '-map', '[v]', '-map', '[a]',
      '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', finalPath]);
  }

  const durationSec = +probe(finalPath).format.duration;
  log(`done ${durationSec.toFixed(1)}s ${W}x${H}`);
  return { finalPath, durationSec, width: W, height: H, photoDur, slideDur, msgKind, dir };
}

module.exports = { renderOrder };
