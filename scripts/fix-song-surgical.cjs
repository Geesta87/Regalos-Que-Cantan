#!/usr/bin/env node
// scripts/fix-song-surgical.cjs
//
// Surgical date/name fix for an already-generated Kie/Suno song, using the
// PROVEN recipe (validated 2026-06-23 on the Gerardo corrido — see memory
// project_fix_song_section):
//
//   1. Ask the fix-song-section edge fn to pick the STANZA BLOCK containing the
//      error, rewrite the corrected lyrics, and re-sing that block via Kie
//      replace-section (a generous block clears Suno's copyright filter and
//      avoids the mid-line "gibberish" failure).
//   2. Poll until the re-sing is ready.
//   3. Find the splice point = end of the block's last line, in BOTH the re-sung
//      audio (Whisper) and the original (the block's end time from step 1).
//   4. ffmpeg-stitch: [ re-sung corrected lines ] + [ PRISTINE ORIGINAL from the
//      block's end onward ]. Everything after the fix is the untouched original
//      (perfect timing / breath), so only the corrected lines are AI-re-sung.
//      One short 0.3s crossfade at the seam, inside the instrumental.
//   5. Write a local preview MP3 you can listen to. Re-run any time to get a
//      fresh take (Kie varies each run). Pass --apply to swap it into the song.
//
// WHY a local script (not the edge fn): the stitch needs ffmpeg, which the Deno
// edge runtime can't run. ffmpeg lives here (and on the Cloud Run renderer, for
// the future admin button). This is the "for us" internal tool.
//
// Usage:
//   node scripts/fix-song-surgical.cjs <songId> "<what's wrong / correction>" [options]
//
// Options:
//   --apply                 After preview, upload + swap into the live song row
//                           (requires SUPABASE_SERVICE_ROLE_KEY in env).
//   --resung-cut <seconds>  Override the auto-detected cut in the re-sung audio.
//   --orig-cut   <seconds>  Override the cut point in the original audio.
//   --xfade <seconds>       Crossfade length at the seam (default 0.3).
//   --out <path>            Output file (default: ./fix-<songId>.mp3).
//
// Env:
//   RQC_ANON_KEY (or SUPABASE_ANON_KEY)  Supabase anon key (Bearer; the fn is
//                                        verify_jwt=false). Falls back to the
//                                        project's published legacy anon key.
//   SUPABASE_SERVICE_ROLE_KEY            Only needed for --apply.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const FN_URL = `${SUPABASE_URL}/functions/v1/fix-song-section`;
const ANON = process.env.RQC_ANON_KEY || process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const songId = argv[0];
const note = argv[1];
function flag(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const APPLY = argv.includes('--apply');
const overrideResungCut = flag('--resung-cut', null);
const overrideOrigCut = flag('--orig-cut', null);
const XFADE = parseFloat(flag('--xfade', '0.3'));
const OUT = flag('--out', path.resolve(process.cwd(), `fix-${(songId || 'song').slice(0, 8)}.mp3`));

if (!songId || !note) {
  console.error('Usage: node scripts/fix-song-surgical.cjs <songId> "<correction>" [--apply] [--resung-cut N] [--orig-cut N] [--xfade S] [--out path]');
  process.exit(1);
}

const HEADERS = { 'Authorization': `Bearer ${ANON}`, 'apikey': ANON, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fn(body) {
  const r = await fetch(FN_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`bad response (${r.status})`);
  return j;
}
function normalize(w) {
  return String(w || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
function ffprobeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseFloat((r.stdout || '0').trim()) || 0;
}
async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

// Find the end-time of the last line of `sectionText` inside a Whisper word list.
// Returns the END seconds of the FIRST full contiguous match (the re-sung block,
// before any padding repeats), or null.
function findLastLineEnd(words, sectionText) {
  const lines = String(sectionText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length || !words.length) return null;
  const lastLine = lines[lines.length - 1];
  const tokens = lastLine.split(/\s+/).map(normalize).filter((t) => t.length > 1);
  if (!tokens.length) return null;
  const atoms = words.map((w) => ({ n: normalize(w.word), end: w.end, start: w.start }));
  const eq = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));
  for (let i = 0; i + tokens.length <= atoms.length; i++) {
    let ok = true;
    for (let j = 0; j < tokens.length; j++) { if (!eq(atoms[i + j].n, tokens[j])) { ok = false; break; } }
    if (ok) return atoms[i + tokens.length - 1].end;
  }
  // Looser fallback: last occurrence of the final token.
  const last = tokens[tokens.length - 1];
  for (let i = atoms.length - 1; i >= 0; i--) if (eq(atoms[i].n, last)) return atoms[i].end;
  return null;
}

(async () => {
  console.log(`\n🎵 Surgical fix for song ${songId}`);
  console.log(`   correction: ${note}\n`);

  // 1) Re-sing the stanza block (async submit — avoids the 150s gateway limit).
  console.log('1/5  Re-singing the stanza block (Kie replace-section)…');
  const sub = await fn({ action: 'section-submit', mode: 'section', songId, note });
  if (!sub.ok) {
    console.error(`   ✗ ${sub.error || 'submit failed'}`);
    if (sub.eligible === false) console.error('   → This song can\'t be section-fixed (Mureka/too old). Use a full re-roll.');
    process.exit(2);
  }
  const { fixTaskId, sectionText, originalAudioUrl, fullLyrics } = sub;
  const origCut = overrideOrigCut !== null ? parseFloat(overrideOrigCut) : Number(sub.window?.endS);
  console.log(`   fixTaskId=${fixTaskId}  block ends in original @ ${origCut.toFixed(2)}s`);
  console.log(`   change: ${sub.changeSummary || ''}`);

  // 2) Poll until the re-sing is ready.
  console.log('2/5  Waiting for the re-sing to render…');
  let takeUrls = [];
  for (let i = 1; i <= 40; i++) {
    const d = await fn({ action: 'diag', taskId: fixTaskId });
    const st = d.status;
    process.stdout.write(`   poll ${i}: ${st}\r`);
    if (st === 'SUCCESS') { takeUrls = (d.trackList || []).map((t) => t.audioUrl).filter(Boolean); break; }
    if (['SENSITIVE_WORD_ERROR', 'GENERATE_AUDIO_FAILED', 'CREATE_TASK_FAILED'].includes(st)) {
      console.error(`\n   ✗ Kie failed: ${st} ${d.errorMessage || ''}`);
      if (st === 'SENSITIVE_WORD_ERROR') console.error('   → Copyright filter still tripped. The block may need to be larger, or fall back to a full re-roll.');
      process.exit(3);
    }
    await sleep(9000);
  }
  console.log('');
  if (!takeUrls.length) { console.error('   ✗ timed out waiting for the re-sing'); process.exit(3); }

  // 3) Locate the splice point in each take; pick the LEAST-PADDED take (its
  //    block ends earliest), which keeps the final song closest to the original
  //    length. Suno pads each take differently, so this is best-of-N on length.
  console.log('3/5  Locating the splice point (choosing the tightest of ' + takeUrls.length + ' take(s))…');
  let resungUrl, resungCut;
  if (overrideResungCut !== null) {
    resungUrl = takeUrls[0];
    resungCut = parseFloat(overrideResungCut);
    console.log(`   using --resung-cut ${resungCut}s on take 1`);
  } else {
    const scored = [];
    for (const url of takeUrls) {
      const tr = await fn({ action: 'transcribe', audioUrl: url });
      const words = (tr.timed ? tr.timed.split(' ').map((tok) => {
        const m = tok.match(/^(.*)\[([0-9.]+)-([0-9.]+)\]$/);
        return m ? { word: m[1], start: +m[2], end: +m[3] } : null;
      }).filter(Boolean) : []);
      const end = findLastLineEnd(words, sectionText);
      console.log(`   take ${url.slice(-12)} → block ends @ ${end ? end.toFixed(2) + 's' : 'not found'}`);
      if (end) scored.push({ url, end });
    }
    if (!scored.length) {
      console.error('   ✗ could not auto-detect the splice point in any take. Re-run with --resung-cut <seconds>.');
      console.error('     takes: ' + takeUrls.join(' , '));
      process.exit(4);
    }
    scored.sort((a, b) => a.end - b.end);
    resungUrl = scored[0].url;
    resungCut = +(scored[0].end + 0.3).toFixed(2); // small instrumental tail after the last word
    console.log(`   → chose tightest take, cut @ ${resungCut}s`);
  }

  // 4) Download both + stitch.
  console.log('4/5  Stitching (re-sung lines + pristine original)…');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rqcfix-'));
  const reF = await download(resungUrl, path.join(tmp, 'resung.mp3'));
  const orF = await download(originalAudioUrl, path.join(tmp, 'original.mp3'));
  const filter =
    `[0]atrim=0:${resungCut},asetpts=N/SR/TB[a];` +
    `[1]atrim=${origCut},asetpts=N/SR/TB[b];` +
    `[a][b]acrossfade=d=${XFADE}:c1=tri:c2=tri[out]`;
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', reF, '-i', orF, '-filter_complex', filter, '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', OUT], { encoding: 'utf8' });
  if (ff.status !== 0) { console.error('   ✗ ffmpeg failed:', ff.stderr); process.exit(5); }
  const origDur = ffprobeDuration(orF);
  const outDur = ffprobeDuration(OUT);
  console.log(`   ✓ wrote ${OUT}`);
  console.log(`   length ${outDur.toFixed(1)}s (original ${origDur.toFixed(1)}s)\n`);
  console.log('🎧 Listen to the preview. Not perfect? Just run again for a fresh take,');
  console.log('   or fine-tune with --resung-cut / --orig-cut / --xfade.\n');

  // 5) Optional apply.
  if (!APPLY) {
    console.log('   (preview only — re-run with --apply to swap it into the live song.)');
    return;
  }
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SR) { console.error('   ✗ --apply needs SUPABASE_SERVICE_ROLE_KEY in env. Skipped.'); process.exit(6); }
  console.log('5/5  Applying to the live song…');
  const objectPath = `songs/fixed-${songId}-${Date.now()}.mp3`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/audio/${objectPath}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SR}`, 'apikey': SR, 'Content-Type': 'audio/mpeg', 'x-upsert': 'true' },
    body: fs.readFileSync(OUT),
  });
  if (!up.ok) { console.error('   ✗ upload failed', up.status, await up.text().catch(() => '')); process.exit(6); }
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/audio/${objectPath}`;
  const ap = await fn({ action: 'apply', songId, fixedAudioUrl: publicUrl, fullLyrics, fixTaskId });
  if (!ap.ok) { console.error('   ✗ apply failed:', ap.error); process.exit(6); }
  console.log(`   ✓ applied. ${ap.songLink || ''}`);
  console.log('   (Undo available: the previous version was snapshotted for "Deshacer".)');
})().catch((e) => { console.error('\n✗ error:', e.message); process.exit(1); });
