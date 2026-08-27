#!/usr/bin/env node
// Golden regression exam for the Fix-Song validators (2026-08-26).
//
// Runs two layers:
//   1. SYNTHETIC cases — built in-memory, always run on every machine. They
//      pin the core contracts of src/utils/audioSplice.js: number
//      canonicalization (968db94), and the timeline gate's four verdicts
//      (clean, duplicated section, missing section, declared-window exempt).
//   2. FIXTURE cases — real customer-take transcripts from live incidents
//      (manifest.json). Fixtures live in tests/golden/fixtures/ which is
//      GITIGNORED: this repo is PUBLIC and transcripts are customer data.
//      A machine without the fixtures skips those cases with a warning —
//      the synthetic layer still guards the logic. Copies of the fixtures
//      live on the owner's machine; the take audio itself expires on Kie's
//      side (~14 days), so treat existing fixture files as irreplaceable.
//
// Wired into .githooks/pre-commit: any commit touching audioSplice.js or
// fix-song-auto/index.ts must pass this exam. Run manually with:
//   node tests/golden/run-golden.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures');

// --- load audioSplice.js in a bare context (it's an ES module) --------------
let src = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'audioSplice.js'), 'utf8').replace(/\r\n/g, '\n');
src = src.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const ctx = { console };
vm.createContext(ctx);
vm.runInNewContext(src + '\nthis.__api = { timelineDamage, findCleanLine, buildTokenGroups, parseTimed, validateTake, findLastLineEnd };', ctx);
const { timelineDamage, findCleanLine, buildTokenGroups, findLastLineEnd } = ctx.__api;

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

// ---------------------------------------------------------------------------
// Layer 1 — synthetic
// ---------------------------------------------------------------------------
console.log('golden exam · synthetic cases');

// Numbers: lyric side digits, sung side spelled (and the reverse) must match.
{
  const sung = 'el trece de agosto llegaste a mi vida corazon'.split(' ');
  const words = sung.map((w, i) => ({ word: w, start: 10 + i * 0.5, end: 10.4 + i * 0.5 }));
  check('number canonicalization: lyric "13" finds sung "trece"',
    !!findCleanLine(words, buildTokenGroups('el 13 de agosto llegaste')));
  const sung2 = 'el 13 de agosto llegaste a mi vida corazon'.split(' ');
  const words2 = sung2.map((w, i) => ({ word: w, start: 10 + i * 0.5, end: 10.4 + i * 0.5 }));
  check('number canonicalization: lyric "trece" finds sung "13"',
    !!findCleanLine(words2, buildTokenGroups('el trece de agosto llegaste')));
}

// Closing-line trim anchor must tolerate Whisper respelling a name by one
// edit (2026-08-26, Victoria 94fdd93e: sheet "Tory", Whisper "Tori" — every
// over-long take died with no trim point).
{
  const sung = 'guardando cada uno de tus sueños siempre mi luna mi Tori'.split(' ');
  const words = sung.map((w, i) => ({ word: w, start: 190 + i * 1.5, end: 190.8 + i * 1.5 }));
  const e = findLastLineEnd(words, 'Siempre mi luna, mi Tory', 210);
  check('findLastLineEnd: respelled name in closing line still anchors', e != null && e > 200);
}

// Timeline gate on synthetic songs. Vocabulary must be 3+ chars (gate drops
// short function words) and time-spread like real singing.
{
  const POOL = ['corazon', 'quiero', 'siempre', 'vida', 'canta', 'pueblo', 'noche', 'luna', 'camino', 'tierra',
    'flores', 'manos', 'sueno', 'fuerza', 'brilla', 'cielo', 'madre', 'padre', 'fiesta', 'amigo'];
  const mkWords = (n, t0) => Array.from({ length: n }, (_, i) => ({
    word: POOL[i % POOL.length] + '_' + Math.floor(i / POOL.length), // unique-ish tokens
    start: t0 + i * 1.2, end: t0 + i * 1.2 + 0.6,
  }));
  const REF = mkWords(120, 5); // ~150s song

  // 1. identical take → clean
  check('timeline gate: identical take is clean', timelineDamage(REF, REF, []) === null);

  // 2. duplicated section (the San Lucas failure class): the take re-sings
  //    words 10..20 again mid-song, displacing everything after it — the way a
  //    real re-rendered take repeats a section (it can't overlay, only insert).
  {
    const dupSrc = REF.slice(10, 21);
    const dupDur = dupSrc[dupSrc.length - 1].end - dupSrc[0].start + 1.2;
    const insertAt = REF[60].end + 0.6;
    const dup = dupSrc.map((w) => ({ ...w, start: w.start - dupSrc[0].start + insertAt, end: w.end - dupSrc[0].start + insertAt }));
    const tail = REF.slice(61).map((w) => ({ ...w, start: w.start + dupDur, end: w.end + dupDur }));
    const take = [...REF.slice(0, 61), ...dup, ...tail];
    const out = timelineDamage(REF, take, []);
    check('timeline gate: duplicated section is caught', !!out, out || 'clean');
  }

  // 3. missing section: the take skips words 40..52 → MISSING run.
  {
    const take = REF.filter((_, i) => i < 40 || i > 52);
    const out = timelineDamage(REF, take, []);
    check('timeline gate: missing section is caught', !!out && /ya no canta/.test(out), out || 'clean');
  }

  // 4. the same change INSIDE a declared window is exempt (that's the fix).
  {
    const winStart = REF[40].start - 1, winEnd = REF[52].end + 1;
    const take = REF.map((w, i) => (i >= 40 && i <= 52 ? { ...w, word: 'cambiado' + i } : w));
    const out = timelineDamage(REF, take, [{ startS: winStart, endS: winEnd }]);
    check('timeline gate: changes inside the declared window are exempt', out === null, out || undefined);
  }

  // 5. a uniform start-shift (start-trim) must not read as damage.
  {
    const take = REF.map((w) => ({ ...w, start: w.start - 4, end: w.end - 4 })).filter((w) => w.start > 0);
    const out = timelineDamage(REF, take, [{ startS: 0, endS: 12 }]);
    check('timeline gate: uniform start-shift with declared cut is clean', out === null, out || undefined);
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — real-incident fixtures (gitignored; skip when absent)
// ---------------------------------------------------------------------------
console.log('golden exam · fixture cases');
let manifest = [];
try { manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')).cases; } catch (e) {
  console.log('  (no manifest.json — skipping fixture layer)');
}
const loadFix = (f) => {
  const j = JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
  if (Array.isArray(j.words)) return j.words;
  if (typeof j.timed === 'string') return ctx.__api.parseTimed(j.timed);
  throw new Error('unknown transcript shape: ' + f);
};
for (const c of manifest) {
  if (!fs.existsSync(path.join(FIXTURES, c.ref)) || !fs.existsSync(path.join(FIXTURES, c.take))) {
    skip++;
    console.log('  SKIP ' + c.name + ' (fixture missing — see header note)');
    continue;
  }
  let out;
  try { out = timelineDamage(loadFix(c.ref), loadFix(c.take), c.windows || []); }
  catch (e) { check(c.name, false, e.message); continue; }
  check(c.name, !!out === !!c.expectDamage, out ? out.slice(0, 100) : 'clean');
}

console.log(`golden exam: ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
