// supabase/functions/fix-song-auto/index.ts
//
// Fix Song AUTO-WORKER (Phase 1) — turns customer fix requests into STAGED,
// human-approved-only candidates without the owner babysitting generation.
//
// Pipeline per request (state in song_fix_requests.auto_status):
//   linking       → auto-attach the customer's song (phone/recipient match)
//   understanding → Claude builds a FixSpec; ambiguity ⇒ needs_human, NEVER guess
//   planning      → fix-song-section {action:'plan'} → approved lyrics + changes
//   generating    → {action:'section-submit'} (or 'full-submit' if not eligible)
//   polling       → {action:'diag'} until Kie SUCCESS / terminal error
//   validating    → transcribe each take; length in 0.80–1.08× band (or the
//                   end-trim rescue ≤1.15×, duplicated-tail), then the FULL
//                   count-based checklist on the audible part (evalChecklist
//                   port): every `after` sung ≥ its lyric count, every `before`
//                   sung ZERO times, prior fixes intact; pick best; rehost; STAGE
//   staged        → status='awaiting_approval' + WhatsApp ping to owner/Ivan
//   needs_human / failed → card left in the queue with the reason
//
// HARD SAFETY RULES:
//   - fix_auto_state.enabled=false ⇒ exit immediately (kill switch, default OFF)
//   - the worker only ever STAGES; release stays a human action in song-fix-queue
//   - it never touches requests a person claimed (status='in_progress')
//   - max_rounds per request + daily_cap Kie generations per day
//   - every ambiguity ⇒ needs_human with a plain-English reason
//
// Invoked by pg_cron every 2 min ({action:'tick'}); also callable manually with
// {action:'status'} for a health snapshot. verify_jwt=false (pg_cron) — pinned
// in supabase/config.toml in the same commit that adds this function.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWhatsApp } from '../_shared/send-whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ALERT_WHATSAPP_TO = Deno.env.get('ALERT_WHATSAPP_TO') || '';
// Deep-link straight to the Fix Song tab — the queue (staged card on top) is the
// first thing on it. On a phone the owner taps the WhatsApp link and lands ONE
// tap away from Release; bare /admin landed on the Action Inbox instead.
const ADMIN_FIX_URL = 'https://regalosquecantan.com/admin?tab=fixsong';

// Tell the approvers something happened. Used for BOTH outcomes: a staged fix
// ready to review, and a request that gave up. Before 2026-08-12 only success
// pinged, so a handed-off fix that died just sat in the queue — and the whole
// point of handing it off is that nobody is watching the screen. Best-effort,
// but loud in the logs on failure.
async function pingApprovers(state: any, text: string): Promise<void> {
  const numbers = String(state?.notify_numbers || ALERT_WHATSAPP_TO || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  if (!numbers.length) {
    console.error('[fix-song-auto] wanted to ping approvers but NO notify numbers configured (fix_auto_state.notify_numbers / ALERT_WHATSAPP_TO)');
    return;
  }
  for (const n of numbers) {
    try {
      const wa = await sendWhatsApp(n, text);
      if (!wa.ok) console.error(`[fix-song-auto] WhatsApp ping to ${n} failed: ${wa.error || wa.status || 'unknown'}`);
    } catch (e) {
      console.error(`[fix-song-auto] WhatsApp ping to ${n} threw: ${e instanceof Error ? e.message : e}`);
    }
  }
}

// Judgment call (understanding the customer's request) runs on the strongest
// model (owner decision 2026-08-24: "I want Ace to do these edits the way you
// do"); transient-failure fallback is Opus 5 — same price as the old 4.8.
const CLAUDE_MODEL = 'claude-fable-5';
// Kie server errors (errorCode 5xx) get their own budget — they are not attempts
// at the lyric line. Generous on purpose: a failed Kie job costs 0 credits (only
// delivered takes bill, at 5), so out-waiting an outage is FREE. On 2026-08-12
// three paid songs were rescued at 16, ~30 and ~20 submissions each, entirely
// during a spell that would have exhausted any small budget. This ceiling exists
// to stop a runaway loop, not to save money — do not lower it to "cut costs".
const MAX_INFRA_RETRIES = 40;
const CLAUDE_FALLBACK = 'claude-opus-5';

const FN_BASE = `${SUPABASE_URL}/functions/v1`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Call a sibling edge function server-to-server (service key as bearer).
async function callFn(name: string, body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
  return await resp.json().catch(() => ({ ok: false, error: `bad json from ${name}` }));
}

// ---------------------------------------------------------------------------
// Validation helpers — ports of the PROVEN browser logic (src/utils/audioSplice.js).
// Kept behaviorally identical so the auto path accepts exactly what the manual
// path accepts. Word shape: {word,start,end} from fix-song-section 'transcribe'
// (parse of its "word[start-end]" timed string).
// ---------------------------------------------------------------------------
type W = { word: string; start: number; end: number };

function parseTimed(timed: string): W[] {
  if (!timed) return [];
  return timed.split(' ').map((tok) => {
    const m = tok.match(/^(.*)\[([0-9.]+)-([0-9.]+)\]$/);
    return m ? { word: m[1], start: +m[2], end: +m[3] } : null;
  }).filter(Boolean) as W[];
}

function norm(w: string): string {
  return String(w || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
function lev(a: string, b: string): number {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

const UNITS: Record<string, number> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const TEENS: Record<string, number> = { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19 };
const TENS: Record<string, number> = { veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const COMPOUND: Record<string, number> = { veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
const FILLER = new Set(['de', 'del', 'la', 'el', 'y', 'a', 'en', 'que', 'lo', 'los', 'las', 'un', 'una', 'mi', 'me', 'te', 'su', 'con', 'por', 'dos', 'mil', 'has']);
// digit -> single spelled word, so a lyric written with digits still accepts a
// transcript written in words (mirror of audioSplice._SPELLED).
const SPELLED: Record<number, string> = {};
for (const m of [UNITS, TEENS, TENS, COMPOUND]) for (const [w, v] of Object.entries(m)) SPELLED[v] = w;

function parseUnder100(t: string[], i: number): { val: number; next: number } | null {
  const w = t[i];
  if (COMPOUND[w] != null) return { val: COMPOUND[w], next: i + 1 };
  if (TEENS[w] != null) return { val: TEENS[w], next: i + 1 };
  if (TENS[w] != null) {
    const u = UNITS[t[i + 2]] ?? (t[i + 2] === 'un' ? 1 : null); // "treinta y un años"
    if (t[i + 1] === 'y' && u != null) return { val: TENS[w] + u, next: i + 3 };
    return { val: TENS[w], next: i + 1 };
  }
  if (UNITS[w] != null) return { val: UNITS[w], next: i + 1 };
  return null;
}
function parseYear(t: string[], i: number): { year: number; next: number } | null {
  if (t[i] === 'mil' && t[i + 1] === 'novecientos') { const p = parseUnder100(t, i + 2); return { year: 1900 + (p ? p.val : 0), next: p ? p.next : i + 2 }; }
  if (t[i] === 'dos' && t[i + 1] === 'mil') { const p = parseUnder100(t, i + 2); return { year: 2000 + (p ? p.val : 0), next: p ? p.next : i + 2 }; }
  return null;
}
function buildTokenGroups(line: string): string[][] {
  // Raw tokens kept alongside normalized ones — proper-noun detection needs the
  // original capitalization.
  const pairs = String(line || '').split(/\s+/)
    .map((raw) => ({ raw, n: norm(raw) }))
    .filter((p) => p.n);
  const t = pairs.map((p) => p.n);
  // PROPER NAMES ARE NOT REQUIRED TOKENS (2026-08-10) — mirror of the
  // audioSplice.js fix. Whisper writes invented names however it hears them
  // ("Saynee" → "Zaine"), so requiring the name token rejected perfect takes.
  // A mid-line Capitalized token is treated as a name and skipped; the words
  // around it prove the line. Guard: keep names if skipping them would leave
  // fewer than 2 required groups.
  // Line-initial capitals count too (2026-08-11: "Wilmington fue tu destino"
  // false-rejected exactly like Saynee, just at position 0). The ≥2-remaining-
  // groups guard keeps short lines fully matched.
  const isNameAt = (i: number): boolean => {
    const lead = pairs[i].raw.replace(/^[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]+/, '');
    return /^[A-ZÁÉÍÓÚÑÜ]/.test(lead);
  };
  const flagged: Array<{ g: string[]; name: boolean }> = [];
  for (let i = 0; i < t.length;) {
    const y = parseYear(t, i);
    if (y) { flagged.push({ g: [String(y.year)], name: false }); i = y.next; continue; }
    // COMPOUND NUMBERS (2026-08-21, Stephanie d34ff7f8, mirror of audioSplice):
    // "cincuenta y tres" -> ['53'] — one group, matching the transcript side
    // which collapses the same phrase to one atom; Whisper may write "53" outright.
    const q = parseUnder100(t, i);
    if (q && q.next > i + 1) { flagged.push({ g: [String(q.val)], name: false }); i = q.next; continue; }
    const w = t[i]; const idx = i; i++;
    // Lyric written with DIGITS ("Yo 52 años"): accept the digit and the spelled
    // single word when there is one. Before the length floor so "5" survives.
    if (/^\d{1,2}$/.test(w)) { const sp = SPELLED[Number(w)]; flagged.push({ g: sp ? [w, sp] : [w], name: false }); continue; }
    if (w.length < 2 || FILLER.has(w)) continue;
    const numVal = COMPOUND[w] ?? TEENS[w] ?? TENS[w] ?? UNITS[w];
    if (numVal != null) { flagged.push({ g: [w, String(numVal)], name: false }); continue; }
    flagged.push({ g: [w], name: isNameAt(idx) });
  }
  const nonName = flagged.filter((x) => !x.name);
  return (nonName.length >= 2 ? nonName : flagged).map((x) => x.g);
}
type Atom = { n: string; s: number; e: number };
function collapseSpelledYears(atoms: Atom[]): Atom[] {
  const t = atoms.map((a) => a.n);
  const out: Atom[] = [];
  for (let i = 0; i < atoms.length;) {
    const y = parseYear(t, i);
    if (y && y.next > i + 1) { out.push({ n: String(y.year), s: atoms[i].s, e: atoms[Math.min(y.next, atoms.length) - 1].e }); i = y.next; continue; }
    // Compound numbers collapse to digits too (Whisper picks words OR digits per
    // take; digits are canonical on both sides — see buildTokenGroups).
    const q = parseUnder100(t, i);
    if (q && q.next > i + 1) { out.push({ n: String(q.val), s: atoms[i].s, e: atoms[Math.min(q.next, atoms.length) - 1].e }); i = q.next; continue; }
    out.push(atoms[i]); i++;
  }
  return out;
}
function grpEq(n: string, group: string[]): boolean {
  return group.some((g) => n === g
    || (n.length > 3 && g.length > 3 && (n.startsWith(g) || g.startsWith(n)))
    || (Math.max(n.length, g.length) >= 5 && Math.abs(n.length - g.length) <= 1 && lev(n, g) <= 1));
}
// Tight in-order run of the corrected words (gibberish-tolerant). Port of
// audioSplice.findCleanLine.
function findCleanLine(words: W[], tokenGroups: string[][], maxGapS = 3.5): { startS: number; endS: number } | null {
  if (!words?.length || !tokenGroups?.length) return null;
  const atoms = collapseSpelledYears(words.map((w) => ({ n: norm(w.word), s: w.start, e: w.end })));
  for (let start = 0; start < atoms.length; start++) {
    if (!grpEq(atoms[start].n, tokenGroups[0])) continue;
    let gi = 0, ai = start, ok = true, prevE = atoms[start].s;
    const hit: Atom[] = [];
    while (gi < tokenGroups.length && ai < atoms.length) {
      if (grpEq(atoms[ai].n, tokenGroups[gi])) { if (atoms[ai].s - prevE > maxGapS) { ok = false; break; } prevE = atoms[ai].e; hit.push(atoms[ai]); gi++; }
      ai++;
    }
    if (gi === tokenGroups.length && ok) return { startS: hit[0].s, endS: hit[hit.length - 1].e };
  }
  return null;
}
// End of the final lyric line, preferring the occurrence nearest `nearS` — the
// disambiguator for Suno's duplicated-tail over-extension. Port of findLastLineEnd.
// maxS (optional): prefer the LATEST match at or below this ceiling instead of
// the one nearest to nearS. The nearest-pick released a beheaded song
// (2026-08-11, Miguel Ángel 676a1f73): the last lyric line ended EVERY chorus,
// the take was time-stretched, and "nearest to the original length" landed on
// the SECOND chorus — the trim deleted the Puente and final chorus. The real
// ending is always the LAST in-band occurrence.
function findLastLineEnd(words: W[], lyricsText: string, nearS: number, maxS?: number): number | null {
  const lines = String(lyricsText || '').split('\n').map((s) => s.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  if (!lines.length || !words.length) return null;
  const tokens = lines[lines.length - 1].split(/\s+/).map(norm).filter((t) => t.length > 1);
  if (!tokens.length) return null;
  const atoms = words.map((w) => ({ n: norm(w.word), end: w.end }));
  const eq = (a: string, b: string) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));
  const fulls: number[] = [];
  for (let i = 0; i + tokens.length <= atoms.length; i++) {
    let ok = true;
    for (let j = 0; j < tokens.length; j++) { if (!eq(atoms[i + j].n, tokens[j])) { ok = false; break; } }
    if (ok) fulls.push(atoms[i + tokens.length - 1].end);
  }
  const pick = (c: number[]): number | null => {
    if (!c.length) return null;
    if (maxS != null) {
      const inBand = c.filter((e) => e <= maxS);
      if (inBand.length) return Math.max(...inBand);
    }
    return c.reduce((b, e) => (Math.abs(e - nearS) < Math.abs(b - nearS) ? e : b));
  };
  if (fulls.length) return pick(fulls);
  const last = tokens[tokens.length - 1];
  const singles: number[] = [];
  for (const a of atoms) if (eq(a.n, last)) singles.push(a.end);
  return pick(singles);
}

// ALL closing-line occurrence end-times (ascending order of position) — the
// earliest-complete trim anchor iterates these. Same matching as findLastLineEnd.
function findLastLineEnds(words: W[], lyricsText: string): number[] {
  const lines = String(lyricsText || '').split('\n').map((s) => s.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  if (!lines.length || !words.length) return [];
  const tokens = lines[lines.length - 1].split(/\s+/).map(norm).filter((t) => t.length > 1);
  if (!tokens.length) return [];
  const atoms = words.map((w) => ({ n: norm(w.word), end: w.end }));
  const eq = (a: string, b: string) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));
  const fulls: number[] = [];
  for (let i = 0; i + tokens.length <= atoms.length; i++) {
    let ok = true;
    for (let j = 0; j < tokens.length; j++) { if (!eq(atoms[i + j].n, tokens[j])) { ok = false; break; } }
    if (ok) fulls.push(atoms[i + tokens.length - 1].end);
  }
  if (fulls.length) return fulls;
  const last = tokens[tokens.length - 1];
  const singles: number[] = [];
  for (const a of atoms) if (eq(a.n, last)) singles.push(a.end);
  return singles;
}

// FULL-STRUCTURE AUDIT (2026-08-11, Miguel Ángel take b62256fe): counting only
// the closing line is beatable. Suno's replace-section inserted an entire extra
// half-verse + chorus cycle mid-song, which simultaneously (a) satisfied the
// closing-line count on a cut that beheaded the Bridge — the customer's name
// reveal — and (b) pushed the real ending out of the trim band. The only
// audit that catches both failure modes is line-by-line: every distinctive
// lyric line must be sung EXACTLY as many times as the lyrics carry it.
// Returns null when the structure is intact, else a human-readable reason.
// Audit tokenization: like buildTokenGroups but skips ONLY true mid-line proper
// nouns — the line-INITIAL skip (needed for correction matching, Wilmington)
// SPLITS case variants of the same chorus line ("Todavía quiero…" opener vs
// "todavía quiero…" closer) into different signatures whose shorter form then
// cross-matches both, producing phantom "sección duplicada 6/3" rejections
// (take 5 of a84f274f). Structure counting is case-blind.
function buildAuditGroups(line: string): string[][] {
  const pairs = String(line || '').split(/\s+/).map((raw) => ({ raw, n: norm(raw) })).filter((p) => p.n);
  const t = pairs.map((p) => p.n);
  const isMidName = (i: number): boolean => {
    if (i === 0) return false;
    const lead = pairs[i].raw.replace(/^[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]+/, '');
    return /^[A-ZÁÉÍÓÚÑÜ]/.test(lead);
  };
  const flagged: Array<{ g: string[]; name: boolean }> = [];
  for (let i = 0; i < t.length;) {
    const y = parseYear(t, i);
    if (y) { flagged.push({ g: [String(y.year)], name: false }); i = y.next; continue; }
    // Compound numbers -> one digit group, digits accept the spelled word —
    // same canonicalization the checklist tokenizer got (968db94); without it
    // the audit's own counting stayed number-blind.
    const q = parseUnder100(t, i);
    if (q && q.next > i + 1) { flagged.push({ g: [String(q.val)], name: false }); i = q.next; continue; }
    const w = t[i]; const idx = i; i++;
    if (/^\d{1,2}$/.test(w)) { const sp = SPELLED[Number(w)]; flagged.push({ g: sp ? [w, sp] : [w], name: false }); continue; }
    if (w.length < 2 || FILLER.has(w)) continue;
    const numVal = COMPOUND[w] ?? TEENS[w] ?? TENS[w] ?? UNITS[w];
    if (numVal != null) { flagged.push({ g: [w, String(numVal)], name: false }); continue; }
    flagged.push({ g: [w], name: isMidName(idx) });
  }
  const nonName = flagged.filter((x) => !x.name);
  return (nonName.length >= 2 ? nonName : flagged).map((x) => x.g);
}
function countByGroups(words: W[], groups: string[][]): number {
  if (!groups.length) return 0;
  let remaining = words, count = 0;
  for (let guard = 0; guard < 30; guard++) {
    const hit = findCleanLine(remaining, groups);
    if (!hit) break;
    count++;
    remaining = remaining.filter((w) => w.end <= hit.startS || w.start >= hit.endS);
  }
  return count;
}
function auditStructure(audible: W[], lyricsText: string, baseWords: W[] | null = null): string | null {
  const lines = String(lyricsText || '').split('\n').map((s) => s.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  const need = new Map<string, { line: string; n: number; groups: string[][] }>();
  for (const l of lines) {
    const groups = buildAuditGroups(l);
    if (groups.length < 3) continue; // short lines are too ambiguous to count
    const key = JSON.stringify(groups);
    const e = need.get(key);
    if (e) e.n++; else need.set(key, { line: l, n: 1, groups });
  }
  for (const { line, n, groups } of need.values()) {
    // LINE-INITIAL NAME TOLERANCE (2026-08-24, José 82c5af1a drill). The audit
    // never name-skips position 0 (keys must stay case-blind — Eric 3a5650f3),
    // so "Yadriel me miró a los ojos…" REQUIRED the token "yadriel" — and
    // Whisper spells that name differently per take ("Y Adriel" in the
    // original matched fuzzily; "Y a Diel" in the take didn't). Both round-3
    // takes SANG the line and were rejected "falta una sección". Keys stay
    // unchanged; only the COUNTING pattern drops a line-initial Capitalized
    // word (a likely name) when enough anchor words remain to identify the
    // line without it.
    const fw = norm(String(line).trim().split(/\s+/)[0] || '');
    const rawCap = /^[A-ZÁÉÍÓÚÑÜ]/.test(String(line).trim());
    const countGroups = (rawCap && groups.length >= 4 && groups[0] && groups[0].includes(fw)) ? groups.slice(1) : groups;
    let have = countLineForAudit(audible, line, countGroups, n);
    // BASELINE-RELATIVE (2026-08-21, Stephanie 41a61123, mirror of the browser
    // guard). Whisper never hears "Pasé encerrado años que no cuentan" on that
    // singer — the PRISTINE transcript scores it 0 too ("pasa"). Judged against
    // the lyric sheet alone, every rescue of that song fails forever on a line
    // the fix never touched. When the original transcript disagrees with the
    // sheet on a line, the original is the reference: the take passes that line
    // if it scores what the original scores. Reliable lines keep the exact rule.
    if (have !== n && baseWords && baseWords.length) {
      const baseHave = countLineForAudit(baseWords, line, countGroups, n);
      if (baseHave !== n && have === baseHave) continue;
    }
    if (have < n) return `falta una sección: "${line.slice(0, 48)}…" (${have}/${n})`;
    if (have > n) return `sección duplicada: "${line.slice(0, 48)}…" (${have}/${n})`;
  }
  return null;
}
// Count one ledger line in a word list, with the merged-word tolerance.
function countLineForAudit(ws: W[], line: string, groups: string[][], n: number): number {
  {
    let have = countByGroups(ws, groups);
    // MERGED-WORD TOLERANCE (2026-08-14, Eric 3a5650f3): Whisper hears elided
    // Spanish as one word — "grande ero" came back "grandero" — and a per-word
    // matcher counts a correctly-sung line 0 times. Before failing a line, retry
    // with each adjacent token pair glued (plain + shared-vowel collapse). The
    // browser guard carries the same rule; without it, a structurally perfect
    // take is vetoed for a transcription artifact.
    if (have < n) {
      const toks = line.toLowerCase().split(/\s+/).filter(Boolean);
      for (let i = 0; i + 1 < toks.length && have < n; i++) {
        const a = toks[i], b = toks[i + 1];
        const variants = [a + b];
        if (a[a.length - 1] === b[0]) variants.push(a + b.slice(1));
        for (const glued of variants) {
          const merged = [...toks.slice(0, i), glued, ...toks.slice(i + 2)].join(' ');
          // Clamp at n: the glued pattern has one fewer group and can over-match
          // (0 found -> glue finds 2 when n=1), and letting it exceed n flipped
          // the verdict from "missing" to a phantom "sección duplicada". The
          // tolerance exists only to cure undercounts.
          have = Math.max(have, Math.min(n, countByGroups(ws, buildAuditGroups(merged))));
          if (have >= n) break;
        }
      }
    }
    return have;
  }
}

// ── Count-based take checklist — port of AdminDashboard's evalChecklist ──────
// (2026-08-10). The old auto check only required each `after` sung ONCE. That
// is weaker than the manual path on three counts: the OLD wording could still
// be sung somewhere, a chorus-wide fix could land in only one chorus, and a
// take could silently REVERT an earlier fix. A take passes only when every
// change's `after` is sung at least as many times as the stored lyrics carry
// it, every `before` is sung ZERO times, and every still-current prior
// correction is intact.
function countCleanOccurrences(words: W[], phrase: string): number {
  const groups = buildTokenGroups(phrase);
  if (!groups.length) return 0;
  let remaining = words, count = 0;
  for (let guard = 0; guard < 30; guard++) {
    const hit = findCleanLine(remaining, groups);
    if (!hit) break;
    count++;
    remaining = remaining.filter((w) => w.end <= hit.startS || w.start >= hit.endS);
  }
  return count;
}
// Presence counting with elision tolerance — mirror of the browser helper and
// of auditStructure's glue loop: Whisper merges elided pairs into one word and
// the strict counter reads a sung line as absent. Presence only; absence
// checks stay strict.
function countSungOccurrences(words: W[], phrase: string, need = 1): number {
  let c = countCleanOccurrences(words, phrase);
  if (c >= need) return c;
  const toks = String(phrase).split(/s+/).filter(Boolean);
  for (let i = 0; i + 1 < toks.length && c < need; i++) {
    const a = toks[i], b = toks[i + 1];
    const variants = [a + b];
    if (a[a.length - 1] === b[0]) variants.push(a + b.slice(1));
    for (const g of variants) {
      c = Math.max(c, countCleanOccurrences(words, [...toks.slice(0, i), g, ...toks.slice(i + 2)].join(" ")));
      if (c >= need) break;
    }
  }
  return c;
}
function timesInLyrics(lyrics: string, line: string): number {
  const normText = (s: string) => String(s || '').replace(/\r\n/g, '\n').toLowerCase().replace(/\s+/g, ' ').trim();
  const hay = normText(lyrics); const needle = normText(line);
  if (!needle) return 0;
  let count = 0; let i = hay.indexOf(needle);
  while (i !== -1) { count++; i = hay.indexOf(needle, i + needle.length); }
  return count;
}
// End time of the last REAL sung word, ignoring Whisper's trailing
// hallucinations over instrumental outros ("Subtítulos … Amara.org", "gracias
// por ver") — port of audioSplice.lastSungWordEnd. Counting them inflated
// takeEnd past 1.08× on perfectly good takes.
const HALLUC = new Set(['subtitulos', 'subtitulado', 'amara', 'org', 'gracias', 'por', 'ver', 'subscribe', 'suscribete', 'www', 'com']);
function lastSungWordEnd(words: W[]): number | null {
  for (let i = words.length - 1; i >= 0; i--) {
    if (!HALLUC.has(norm(words[i].word))) return words[i].end;
  }
  return words.length ? words[words.length - 1].end : null;
}

function evalChecklist(words: W[], changes: any[], combinedLyrics: string, priorCorrections: any[]): { ok: boolean; fail: string | null } {
  for (const c of changes || []) {
    if (!c?.after) continue;
    const need = Math.max(1, timesInLyrics(combinedLyrics, c.after));
    const have = countSungOccurrences(words, c.after, need);
    if (have < need) return { ok: false, fail: `cantó "${c.after}" ${have}/${need} veces` };
    // Stylization-only change: before/after collapse to the same sung tokens, so
    // demanding the old wording absent would contradict demanding the new one.
    const cosmetic = c.before && JSON.stringify(buildTokenGroups(c.before)) === JSON.stringify(buildTokenGroups(c.after));
    // NAME-REMOVAL case (2026-08-11): after the name-skip rules, the before-line's
    // checkable words can fit entirely INSIDE the after-line ("Miguel Ángel, el
    // mundo…" → "mi amor, el mundo…") — singing the correction then "proves" the
    // old wording still exists. Absence is unverifiable there; ears judge it.
    const fakeAfter: W[] = String(c.after).split(/\s+/).map((w: string, i: number) => ({ word: w, start: i, end: i + 0.4 }));
    const beforeGroups = c.before ? buildTokenGroups(c.before) : [];
    const hidesInAfter = beforeGroups.length > 0 && !!findCleanLine(fakeAfter, beforeGroups, 99);
    if (c.before && !cosmetic && !hidesInAfter && countCleanOccurrences(words, c.before) > 0) {
      return { ok: false, fail: `la letra vieja sigue sonando: "${c.before}"` };
    }
  }
  for (const p of priorCorrections || []) {
    if (!p?.after) continue;
    if ((changes || []).some((c: any) => c?.after === p.after)) continue;
    const need = Math.max(1, timesInLyrics(combinedLyrics, p.after));
    if (countSungOccurrences(words, p.after, need) < need) {
      return { ok: false, fail: `revirtió una corrección anterior: "${p.after}"` };
    }
  }
  return { ok: true, fail: null };
}

// ---------------------------------------------------------------------------
// Understanding agent — the "never guess" gate. Produces a FixSpec or a list of
// open questions. Ambiguity/low confidence ⇒ needs_human (a person decides).
// ---------------------------------------------------------------------------
const SPEC_TOOL = {
  name: 'submit_fix_spec',
  description: 'Return the structured spec of exactly what to change in the song, or the open questions that must be answered first.',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        description: 'Cada cambio puntual. before = la línea EXACTA actual (cópiala de la letra); after = la línea corregida EXACTA. Para type=add, before="" y after = la línea nueva.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['replace', 'remove_word', 'add_line', 'pronunciation'] },
            before: { type: 'string' },
            after: { type: 'string' },
          },
          required: ['type', 'before', 'after'],
          additionalProperties: false,
        },
      },
      verify_phrases: { type: 'array', items: { type: 'string' }, description: '1-3 frases EXACTAS que deben escucharse en la versión corregida.' },
      confidence: { type: 'number', description: '0-1: qué tan seguro estás de que esto es EXACTAMENTE lo que el cliente pidió, sin inventar nada.' },
      open_questions: { type: 'array', items: { type: 'string' }, description: 'Preguntas en ESPAÑOL que habría que hacerle al cliente si algo es ambiguo (cómo se escribe/pronuncia un nombre, qué debe decir en lugar de la palabra quitada, etc). VACÍO solo si todo está claro.' },
      summary: { type: 'string', description: 'One short sentence in ENGLISH describing the fix (lyric quotes stay in Spanish).' },
    },
    required: ['changes', 'verify_phrases', 'confidence', 'open_questions', 'summary'],
    additionalProperties: false,
  },
} as const;

const SPEC_SYSTEM = `Eres el agente de admisión de arreglos de canciones personalizadas en español. Te dan la LETRA actual de la canción del cliente y su PETICIÓN (sus propios mensajes). Tu único trabajo: producir la especificación EXACTA del cambio — nunca adivinar.

Reglas:
- "before" debe ser una línea COPIADA VERBATIM de la letra (la línea completa donde está el error). "after" = esa misma línea ya corregida, cambiando SOLO lo pedido.
- Si el cliente pide QUITAR una palabra, "after" debe ser una redacción natural de la línea sin esa palabra (mantén métrica/rima) — no dejes huecos.
- Si pide AGREGAR una línea nueva, type=add_line, before="", after=la línea exacta.
- Si pide corregir PRONUNCIACIÓN de un nombre, type=pronunciation y "after" = la línea con el nombre reescrito fonéticamente en español.
- verify_phrases: las palabras/frases nuevas que DEBEN oírse (p.ej. el nombre corregido).
- Si CUALQUIER cosa es ambigua (no sabes cómo se escribe el nombre, no sabes qué poner en lugar de lo quitado, la petición menciona una línea que no existe en la letra, hay varias líneas candidatas), NO adivines: pon confidence bajo y llena open_questions.
- Si la petición no es un arreglo de canción, confidence=0 y explica en open_questions.

DECISIONES YA TOMADAS POR EL DUEÑO (playbook 2026-08-24 — aplícalas, NO las preguntes):
- Una "NOTA DEL DUEÑO (reintento)" dentro de la petición son RESPUESTAS del dueño a tus preguntas anteriores. Son vinculantes: intégralas y no vuelvas a preguntar lo mismo.
- Agregar NOMBRES sin lugar indicado: intégralos en líneas EXISTENTES (coro o puente primero), NUNCA como línea nueva al final. El nombre del REMITENTE = dedicatoria ("X te la dedica…") reemplazando la línea más débil o incompleta del puente. Usa type=replace_line cuando el nombre cabe en una línea existente — reserva add_line para cuando de verdad no hay dónde.
- TIEMPO VERBAL: si el cliente dice que unas frases "deben estar en presente" (la persona vive), es un error del compositor — aplica el cambio a TODAS las líneas que liste, confianza alta, cero preguntas.
- Apodos o frases de cariño pedidas ("mi bonita", "mi reina"): colócalas en una línea existente, idealmente una que ya estás corrigiendo por otra razón.
- La PRONUNCIACIÓN de un nombre no se juzga por transcripción: nunca es motivo de duda — el dueño la juzga de oído en el preview.
- Máximo 2 preguntas, y solo cuando equivocarse arruinaría el regalo (ortografía de un nombre, varias líneas candidatas). Preguntas CORTAS y concretas — el dueño responde con una línea desde su teléfono.
Responde SIEMPRE llamando a submit_fix_spec.`;

async function buildFixSpec(lyrics: string, request: string, extraContext: string): Promise<any | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const user = `LETRA ACTUAL:\n${lyrics}\n\nPETICIÓN DEL CLIENTE:\n${request}${extraContext ? `\n\nCONTEXTO ADICIONAL (conversación):\n${extraContext}` : ''}\n\nDevuelve la especificación llamando a submit_fix_spec.`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: attempt === 2 ? CLAUDE_FALLBACK : CLAUDE_MODEL,
          max_tokens: 1500,
          system: SPEC_SYSTEM,
          tools: [SPEC_TOOL],
          tool_choice: { type: 'tool', name: 'submit_fix_spec' },
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const block = (data?.content || []).find((b: any) => b?.type === 'tool_use' && b.name === 'submit_fix_spec');
      if (block?.input && Array.isArray(block.input.changes)) return block.input;
    } catch { /* retry */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Worker steps
// ---------------------------------------------------------------------------
async function setAuto(admin: any, id: string, patch: Record<string, unknown>) {
  await admin.from('song_fix_requests').update({ ...patch, auto_updated_at: new Date().toISOString() }).eq('id', id);
  // FAILURE IS ALSO NEWS (2026-08-12). Every needs_human exit used to be silent
  // — only a staged take pinged. That is survivable while a person is watching
  // the screen, and useless once the fix is handed off precisely so nobody has
  // to. Ping only for handed-off requests (auto_plan.handoff), and only once,
  // recorded as auto_plan.failPinged so a later tick can't re-send.
  if (patch.auto_status !== 'needs_human') return;
  try {
    const { data: row } = await admin.from('song_fix_requests')
      .select('id, auto_plan, auto_error, song_id, context').eq('id', id).single();
    const plan = row?.auto_plan || {};
    if (!plan.handoff || plan.failPinged) return;
    const { data: state } = await admin.from('fix_auto_state').select('notify_numbers').eq('id', 1).single();
    const who = row?.context?.customer_name || row?.context?.phone || 'a customer';
    await pingApprovers(state, `🎧 Ace here — I couldn't land the fix for ${who}. Reason: ${String(row?.auto_error || 'unknown').slice(0, 160)}. It's waiting for you in the Fix Song tab: ${ADMIN_FIX_URL}`);
    await admin.from('song_fix_requests').update({ auto_plan: { ...plan, failPinged: true } }).eq('id', id);
  } catch (e) {
    console.error(`[fix-song-auto] needs_human ping failed for ${id}: ${e instanceof Error ? e.message : e}`);
  }
}

// Auto-link: phone → recent songs → prefer paid + recipient-name mention.
async function stepLink(admin: any, r: any): Promise<void> {
  if (r.song_id) { await setAuto(admin, r.id, { auto_status: 'understanding' }); return; }
  const phoneRaw = r.context?.phone || '';
  const digits = String(phoneRaw).replace(/\D/g, '').slice(-10);
  if (!digits) { await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: 'No phone on the request — link the song manually.' }); return; }
  // There is NO `songs.phone` column — this used to query it and threw
  // "column songs.phone does not exist" on every run (bug found 2026-08-01).
  // The number lives in `whatsapp_phone`; `phone_number` is currently always
  // empty but is matched too so neither can silently miss.
  const { data: cands } = await admin
    .from('songs')
    .select('id, recipient_name, paid, created_at, whatsapp_phone, phone_number')
    .or(`whatsapp_phone.ilike."%${digits}%",phone_number.ilike."%${digits}%"`)
    .gt('created_at', new Date(Date.now() - 60 * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
  const list = (cands || []).filter((s: any) => s.paid);
  if (!list.length) { await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: 'No paid song found for this phone — link the song manually.' }); return; }
  const reqText = norm(String(r.customer_request || ''));
  const byName = list.filter((s: any) => s.recipient_name && reqText.includes(norm(s.recipient_name)));
  const pick = byName.length === 1 ? byName[0] : (list.length === 1 ? list[0] : null);
  if (!pick) { await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: `Multiple candidate songs (${list.length}) — pick the right one manually.` }); return; }
  await admin.from('song_fix_requests').update({ song_id: pick.id }).eq('id', r.id);
  await setAuto(admin, r.id, { auto_status: 'understanding' });
}

async function stepUnderstand(admin: any, r: any): Promise<void> {
  const { data: song } = await admin.from('songs').select('lyrics').eq('id', r.song_id).single();
  if (!song?.lyrics) { await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: 'Linked song has no lyrics stored.' }); return; }
  let convoText = '';
  if (r.conversation_id) {
    const { data: msgs } = await admin.from('sms_messages')
      .select('direction, body').eq('conversation_id', r.conversation_id)
      .order('created_at', { ascending: false }).limit(12);
    convoText = (msgs || []).reverse().map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Equipo'}: ${m.body}`).join('\n');
  }
  const spec = await buildFixSpec(song.lyrics, String(r.customer_request || ''), convoText);
  if (!spec) { await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: 'Understanding agent did not answer — run this one manually.' }); return; }
  if (spec.confidence < 0.75 || (spec.open_questions || []).length || !spec.changes.length) {
    const qs = (spec.open_questions || []).join(' | ') || 'low confidence';
    await setAuto(admin, r.id, { fix_spec: spec, auto_status: 'needs_human', auto_error: `Needs clarification before auto-fixing: ${qs}`.slice(0, 480) });
    return;
  }
  await setAuto(admin, r.id, { fix_spec: spec, auto_status: 'planning' });
}

async function stepPlan(admin: any, r: any): Promise<void> {
  const spec = r.fix_spec;
  // Add-line placement: END OF A RELATED VERSE, never appended after the final
  // chorus — with duration pinned, Suno drops a line appended at the very end
  // (Vicente a4672f19: 4 takes dropped it; mid-verse landed round 1).
  const note = spec.changes.map((c: any) =>
    c.type === 'add_line'
      ? `AGREGA esta línea nueva AL FINAL DE UN VERSO relacionado (a media canción, NUNCA como última línea después del coro final): "${c.after}"`
      : `La línea "${c.before}" debe decir exactamente "${c.after}"`).join('. ');
  const plan = await callFn('fix-song-section', { action: 'plan', songId: r.song_id, note });
  if (!plan?.ok || !plan.approvedLyrics) {
    await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: `Plan step failed: ${plan?.error || 'no lyrics returned'}`.slice(0, 480) });
    return;
  }
  const verify = [...new Set([...(spec.verify_phrases || []), ...(plan.verifyPhrases || [])])].slice(0, 3);
  // ADD-A-LINE ⇒ FULL re-roll (2026-08-10): a new line can't ride a single
  // replace-section window (and splicing is banned), so the whole song is
  // re-sung with the line included — same cloned voice, a few extra seconds of
  // pinned length (durationPadS below). Everything else stays section-first.
  const addLine = plan.addLine || null;
  const hasAdd = !!addLine || (spec.changes || []).some((c: any) => c.type === 'add_line');
  // REPEATED LINE ⇒ FULL re-roll from the start (2026-08-12, Rafael 9dd5efe4).
  // A corrected line that lives in TWO choruses cannot pass the checklist in
  // section mode: one replace-section window reaches ONE chorus, so `have` maxes
  // out at 1 of 2 and every round "fails". Ace burned its section rounds on an
  // impossible target before escalating. A full re-roll re-sings the whole song
  // in the SAME cloned voice, which fixes every occurrence at once.
  const planChanges = plan.changes || spec.changes || [];
  const spread = planChanges.some((c: any) => c?.after && timesInLyrics(plan.approvedLyrics, c.after) > 1);
  // The owner's restrictions survive a send-to-ace reset as a stub auto_plan —
  // merge them into the fresh plan or one "redo it" tap launders them away.
  const kept = {
    ...(r.auto_plan?.noAutoFull ? { noAutoFull: true } : {}),
    ...(r.auto_plan?.handoff ? { handoff: true } : {}),
  };
  // noAutoFull means the owner refused a full re-roll: never auto-pick 'full'.
  const wantsFull = (hasAdd || spread) && !r.auto_plan?.noAutoFull;
  await setAuto(admin, r.id, {
    auto_plan: {
      approvedLyrics: plan.approvedLyrics, changes: planChanges, verifyPhrases: verify,
      mode: wantsFull ? 'full' : 'section', addLine: hasAdd,
      ...(spread && !hasAdd ? { spreadTarget: true } : {}),
      summary: plan.changeSummary || spec.summary,
      ...kept,
    },
    auto_status: 'generating',
  });
}

async function stepGenerate(admin: any, r: any, state: any): Promise<void> {
  const plan = r.auto_plan;
  if ((r.auto_round || 0) >= (state.max_rounds || 3)) {
    await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: `No clean take after ${r.auto_round} rounds — try manually or full re-roll.` });
    return;
  }
  const action = plan.mode === 'full' ? 'full-submit' : 'section-submit';
  const sub = await callFn('fix-song-section', {
    action, mode: plan.mode, songId: r.song_id,
    note: (plan.changes || []).map((c: any) => `"${c.before}" → "${c.after}"`).join('; '),
    approvedLyrics: plan.approvedLyrics, verifyPhrases: plan.verifyPhrases,
    // An added line needs a few extra seconds — a tight length pin would crowd it.
    ...(plan.addLine ? { durationPadS: 8 } : {}),
    // noPersona: fresh-song mode (2026-08-11, Miguel Ángel a84f274f) — the
    // duration pin made Suno pad the lyrics with repeated lines on 4/4 pinned
    // full takes; unpinned generation (how the original was made) follows the
    // lyric sheet. Trade-off: new voice, judged by the owner's ears as always.
    ...(plan.noPersona ? { usePersona: false } : {}),
    // noPin: SAME cloned voice but free length — the owner's preferred repair
    // when the pin fights the lyric sheet (same singer, complete performance).
    ...(plan.noPin ? { pinDuration: false } : {}),
  });
  if (!sub?.ok) {
    // Section not eligible (Mureka / >14 days / can't isolate) → switch to full re-roll once.
    const notEligible = sub?.eligible === false || sub?.canFix === false || sub?.tooOld;
    // OWNER RULE (2026-08-12) — THE SECOND DOOR. The round-exhaustion escalation
    // in stepValidate honors noAutoFull, but this submit-time one did not, so an
    // owner-approved SECTION fix on a song Kie can't infill (Mureka source, or
    // older than ~14 days) was still silently promoted to a whole new
    // performance. Both doors must be locked or the rule is decorative.
    if (plan.mode !== 'full' && notEligible && plan.noAutoFull) {
      await setAuto(admin, r.id, {
        auto_status: 'needs_human',
        auto_error: `This song can't be section-fixed (${sub?.reason || 'source unavailable'}). Only a full re-roll would work — that re-sings the whole song, so it needs your OK.`.slice(0, 480),
      });
      return;
    }
    if (plan.mode !== 'full' && notEligible) {
      await setAuto(admin, r.id, { auto_plan: { ...plan, mode: 'full' }, auto_status: 'generating' });
      return;
    }
    await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: `Generation submit failed: ${sub?.reason || sub?.error || 'unknown'}`.slice(0, 480) });
    return;
  }
  await setAuto(admin, r.id, {
    auto_task_id: sub.fixTaskId,
    auto_round: (r.auto_round || 0) + 1,
    // submittedAt: the stall guard's clock. auto_updated_at can't serve — the
    // per-tick claim bump refreshes it every 2 min, so it never ages past 25.
    auto_plan: { ...plan, window: sub.window || null, sectionText: sub.sectionText || null, originalAudioUrl: sub.originalAudioUrl || null, fullLyrics: sub.fullLyrics || plan.approvedLyrics, submittedAt: new Date().toISOString() },
    auto_status: 'polling',
  });
  // Marker row for the daily cap: counting every section/full-submit also
  // counted the owner's MANUAL browser fixes, so a busy manual day silently
  // starved the worker. The cap now counts only these auto-submit rows.
  try {
    await admin.from('song_fix_attempts').insert({
      song_id: r.song_id, action: 'auto-submit', mode: plan.mode,
      kie_task_id: sub.fixTaskId, outcome: 'submitted', detail: `round ${(r.auto_round || 0) + 1}`,
    });
  } catch { /* best effort */ }
}

async function stepPoll(admin: any, r: any): Promise<void> {
  const d = await callFn('fix-song-section', { action: 'diag', taskId: r.auto_task_id });
  if (d?.status === 'SUCCESS' && (d.trackList || []).some((t: any) => t.audioUrl)) {
    await setAuto(admin, r.id, { auto_status: 'validating' });
    return;
  }
  if (['SENSITIVE_WORD_ERROR', 'GENERATE_AUDIO_FAILED', 'CREATE_TASK_FAILED'].includes(d?.status)) {
    // A KIE SERVER ERROR IS NOT A ROUND (2026-08-12). Kie's codes separate the
    // two cases: 400 = lyrics refused (content — a real strike against this
    // attempt), 5xx/none = their server died mid-job (infrastructure — says
    // nothing about our request). Counting a 500 as a round spent Ace's three
    // rounds without ever hearing a take: song 5f2b30cc gave up "after 3 tries"
    // on three straight errorCode 500s, during a night when the manual ladder
    // needed 16 submissions to get audio at all. Refund the round and resubmit;
    // the daily cap still bounds total spend.
    const code = Number(d?.errorCode);
    const infra = d?.status !== 'SENSITIVE_WORD_ERROR' && (!code || code >= 500);
    const infraTries = Number(r.auto_plan?.infraRetries || 0) + 1;
    // COUNT WHAT KIE BILLS, NOT WHAT WE SUBMIT (2026-08-12, verified on the Kie
    // dashboard: a FAILED task consumes 0 credits; only delivered takes charge,
    // at 5 credits). The daily cap counts action='auto-submit' marker rows, so a
    // job that returned nothing was inflating a budget it never spent. Re-tag
    // EVERY terminal Kie failure — server errors and content blocks alike, since
    // neither delivers audio. Re-tag rather than delete: the attempt stays
    // visible in the audit trail, it just stops counting as spend.
    try {
      await admin.from('song_fix_attempts')
        .update({ action: 'auto-submit-nocharge', outcome: infra ? 'kie-server-error' : 'kie-content-block' })
        .eq('kie_task_id', r.auto_task_id).eq('action', 'auto-submit');
    } catch { /* best effort — accounting only */ }
    if (infra && infraTries <= MAX_INFRA_RETRIES) {
      await setAuto(admin, r.id, {
        auto_status: 'generating',
        auto_round: Math.max(0, (r.auto_round || 1) - 1),
        auto_plan: { ...(r.auto_plan || {}), infraRetries: infraTries },
        auto_error: `Kie server error (${d.errorMessage || d.status}) — retry ${infraTries}/${MAX_INFRA_RETRIES}, round refunded`.slice(0, 480),
      });
      return;
    }
    await setAuto(admin, r.id, { auto_status: 'generating', auto_error: `Kie ${d.status} on round ${r.auto_round}`.slice(0, 480) });
    return;
  }
  // still running — 25-min stall guard, aged from the round's SUBMIT time (the
  // per-tick claim bump keeps auto_updated_at forever fresh, and a null basis
  // used to make the age NaN so the guard never fired).
  const basis = r.auto_plan?.submittedAt || r.auto_updated_at || r.updated_at;
  const age = basis ? Date.now() - new Date(basis).getTime() : 0;
  if (age > 25 * 60000) {
    // A HANG IS INFRASTRUCTURE, SAME AS A 5xx (2026-08-17). A job that delivered
    // nothing billed nothing (Kie charges only for delivered takes), yet the
    // timeout used to spend one of the 3 rounds and one daily-cap unit — three
    // hangs in a bad night reached needs_human without a single take heard,
    // the exact failure the infra-retry budget exists to prevent, arriving
    // through the hang door instead of the error door. Refund both, bounded by
    // the same MAX_INFRA_RETRIES.
    const infraTries = Number(r.auto_plan?.infraRetries || 0) + 1;
    try {
      await admin.from('song_fix_attempts')
        .update({ action: 'auto-submit-nocharge', outcome: 'kie-timeout' })
        .eq('kie_task_id', r.auto_task_id).eq('action', 'auto-submit');
    } catch { /* accounting only */ }
    if (infraTries <= MAX_INFRA_RETRIES) {
      await setAuto(admin, r.id, {
        auto_status: 'generating',
        auto_round: Math.max(0, (r.auto_round || 1) - 1),
        auto_plan: { ...(r.auto_plan || {}), infraRetries: infraTries },
        auto_error: `poll timeout — round refunded, retry ${infraTries}/${MAX_INFRA_RETRIES}`,
      });
    } else {
      await setAuto(admin, r.id, { auto_status: 'generating', auto_error: 'poll timeout — retrying round' });
    }
  }
}

async function stepValidate(admin: any, r: any, state: any): Promise<void> {
  const plan = r.auto_plan;
  const d = await callFn('fix-song-section', { action: 'diag', taskId: r.auto_task_id });
  // Keep each take's Kie audioId alongside its URL — the winner's identity goes
  // into candidate_meta so release CHAINS the next fix off the corrected take.
  const takes: Array<{ url: string; kieId: string | null; dur: number | null }> = (d?.trackList || [])
    .filter((t: any) => t.audioUrl)
    .map((t: any) => ({ url: t.audioUrl, kieId: t.id || null, dur: Number(t.duration) > 0 ? Number(t.duration) : null }));
  if (!takes.length) { await setAuto(admin, r.id, { auto_status: 'generating', auto_error: 'no takes returned' }); return; }

  // Pristine duration (once) — the length yardstick for whole takes. When the
  // plan carries no URL (full-submit didn't return one until 2026-08-10, and
  // older mid-pipeline rows still won't have it), fall back to the customer's
  // LIVE audio — same length, and without a yardstick every take gets rejected
  // with "no pristine duration" and the round budget burns to needs_human.
  let origDur: number | null = plan.origDur || null;
  // origStart: when the ORIGINAL's vocals begin — the intro-length yardstick
  // (see the intro guard below). Recomputed alongside origDur when missing.
  let origStart: number | null = plan.origStart ?? null;
  // Pristine transcript words — the structure audit's baseline (see
  // auditStructure). Persisted in the plan so later rounds reuse them.
  let pristineWords: W[] | null = Array.isArray(plan.pristineWords) && plan.pristineWords.length ? plan.pristineWords : null;
  if (!origDur || origStart == null || !pristineWords) {
    let yardstickUrl: string | null = plan.originalAudioUrl || null;
    if (!yardstickUrl) {
      const { data: songRow } = await admin.from('songs')
        .select('original_audio_url, audio_url').eq('id', r.song_id).single();
      yardstickUrl = songRow?.original_audio_url || songRow?.audio_url || null;
    }
    if (yardstickUrl) {
      const pt = await callFn('fix-song-section', { action: 'transcribe', audioUrl: yardstickUrl });
      const pw = parseTimed(pt?.timed || '');
      origDur = pw.length ? pw[pw.length - 1].end : origDur;
      origStart = pw.length ? pw[0].start : origStart;
      if (pw.length) { pristineWords = pw; plan.pristineWords = pw; }
      if (origDur) await setAuto(admin, r.id, { auto_plan: { ...plan, origDur, origStart } });
      // A failed yardstick transcription is OUR outage, not a bad take — stop
      // the round and say so instead of rejecting every take for "no duration".
      else if (pt?.error) {
        await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: `No se pudo transcribir la canción original: ${String(pt.error).slice(0, 200)}` });
        return;
      }
    }
  }

  const combinedLyrics = plan.fullLyrics || plan.approvedLyrics || '';
  // Prior corrections still present in the lyrics being stored — a take must
  // keep singing these too, or it reverts an earlier fix (same filter
  // fix-song-section applies for the manual ladder).
  const { data: fixRow } = await admin.from('songs').select('fix_corrections').eq('id', r.song_id).single();
  const normLine = (s: string) => String(s || '').replace(/\r\n/g, '\n').trim();
  const priors = (Array.isArray(fixRow?.fix_corrections) ? fixRow.fix_corrections : [])
    .filter((c: any) => c && typeof c.after === 'string' && c.after.trim() && normLine(combinedLyrics).includes(normLine(c.after)));

  const diags: any[] = Array.isArray(r.auto_takes) ? r.auto_takes : [];
  type Cand = { url: string; kieId: string | null; drift: number; trimAtS: number | null };
  const cands: Cand[] = [];

  for (const { url, kieId, dur } of takes) {
    // Absurd-length guard only (>3x). Raw duration CANNOT distinguish a
    // rescuable take from a hopeless one (2026-08-12, Rafael 9dd5efe4): a 1.62x
    // take sang the entire song correctly and then repeated verse+chorus+bridge
    // as a TAIL, which the end-trim removes cleanly. Mid-song loops (Mariela
    // 62fd68ed) look identical by duration and are caught by the structure
    // audit AFTER transcription. Only an unusable 3x+ file dies early, purely
    // to avoid a pointless multi-minute Whisper call.
    if (origDur && dur && dur > origDur * 3) {
      diags.push({ url, verdict: 'reject', reason: `toma irrecuperable (${Math.round(dur)}s ≈ ${(dur / origDur).toFixed(1)}× lo normal)` });
      continue;
    }
    // RENEW THE WORK LEASE before each multi-minute Whisper call (2026-08-17).
    // The overlap claim refuses rows touched <110s ago, but cron fires every
    // 120s and nothing re-stamped auto_updated_at DURING a long validate — so
    // any step past ~2 minutes was double-claimed by the next tick: duplicate
    // Whisper spend, and two ticks racing to stage (one could overwrite the
    // other's candidate while the owner was already listening to it).
    try { await admin.from('song_fix_requests').update({ auto_updated_at: new Date().toISOString() }).eq('id', r.id); } catch { /* lease renewal is best-effort */ }
    const tr = await callFn('fix-song-section', { action: 'transcribe', audioUrl: url });
    const words = parseTimed(tr?.timed || '');
    if (!words.length) {
      // Surface WHY (2026-08-12): a bare "no transcription" hid an OpenAI-side
      // failure — the transcribe action already returns a precise cause
      // (billing, revoked key, rate limit, audio unreachable). Without it the
      // card blamed the song for an outage on our side.
      diags.push({ url, verdict: 'reject', reason: `sin transcripción${tr?.error ? `: ${String(tr.error).slice(0, 90)}` : ''}` });
      continue;
    }
    if (!origDur) { diags.push({ url, verdict: 'reject', reason: 'no pristine duration' }); continue; }
    // INTRO GUARD (2026-08-10, Vicente a4672f19): a full re-roll chose a ~30s
    // instrumental intro on a song whose vocals start almost immediately —
    // every word check passed, but the customer would hear a different song.
    // An end-trim can't remove an intro (that would be a start-cut = surgery),
    // so long-intro takes are rejected outright.
    // SHEET-ANCHORED (2026-08-24, José 82c5af1a drill). The original opened
    // with an unscripted intro vocalization, so first-transcript-word said the
    // vocals start at 1.6s while VERSE 1 actually starts at 28.9s — and every
    // re-roll take (verse at ~18s, EARLIER than the original's verse) was
    // rejected "+16s late". Six takes, ~15 credits, all false vetoes. Compare
    // where the FIRST LYRIC-SHEET LINE starts on both sides instead; ad-libs
    // and hallucinated intro words on either side can no longer skew it.
    const sheetFirstLine = String(plan.fullLyrics || plan.approvedLyrics || '').split('\n').map((x: string) => x.trim()).find((l: string) => l && !/^\[.*\]$/.test(l)) || '';
    const firstLineGroups = sheetFirstLine ? buildTokenGroups(sheetFirstLine) : [];
    const firstLineStart = (ws: W[], fallback: number | null): number | null => {
      if (firstLineGroups.length && ws && ws.length) { const h = findCleanLine(ws, firstLineGroups); if (h) return h.startS; }
      return fallback;
    };
    const takeStart = (firstLineStart(words, words[0].start) as number);
    const effOrigStart = firstLineStart(pristineWords || [], origStart);
    const introDrift = effOrigStart != null ? takeStart - effOrigStart : 0;
    // Fresh performances (new voice OR unpinned same-voice) own their intros.
    if (!plan.noPersona && !plan.noPin && introDrift > 12) {
      diags.push({ url, verdict: 'reject', reason: `intro demasiado largo (empieza +${introDrift.toFixed(0)}s tarde vs original)` });
      continue;
    }
    // LENGTH FIRST (matches the manual path): the checklist must run on the
    // AUDIBLE part only — an over-extension tail often re-sings everything
    // correctly and would satisfy checks for spots still wrong in the real song.
    // Bands and the true-end anchor are SHIFT-AWARE: a take that starts a few
    // seconds late legitimately ends the same few seconds late.
    // As-is ceiling is TIGHT (≤1.08×): the old ≤1.30× let a 3:52 song ship as
    // 4:49 untrimmed (owner complaint 2026-08-09). Over 1.08× → end-trim rescue.
    //
    // TRIM ANCHOR = EARLIEST-COMPLETE (2026-08-11, two live incidents on Miguel
    // Ángel 676a1f73): the closing line ends EVERY chorus, so "nearest to the
    // original length" cut at Coro 2 (beheaded the song) and "latest in band"
    // cut inside the duplicated tail (kept ~45s of junk repetition the owner
    // heard at 3:12). The only correct cut is the EARLIEST closing-line
    // occurrence by which the ENTIRE song has been sung — the closing line must
    // have been heard as many times as the full lyrics sing it (token-count,
    // punctuation-insensitive). Before that point the song is incomplete; after
    // it, everything is duplication.
    const effOrig = origDur + Math.max(0, introDrift);
    const takeEnd = lastSungWordEnd(words) ?? words[words.length - 1].end;
    let trimAtS: number | null = null;
    let structFail: string | null = null;
    let lenOk = takeEnd >= effOrig * 0.80 && takeEnd <= effOrig * 1.08;
    if (lenOk) {
      // In-band whole take: still must contain the whole song, no dup sections.
      structFail = auditStructure(words, combinedLyrics, pristineWords);
      if (structFail) lenOk = false;
    } else if (takeEnd > effOrig * 1.08) {
      // Over-long: try each closing-line occurrence (in band, earliest first)
      // and accept the FIRST cut whose audible part passes the FULL structure
      // audit — the whole song present, nothing duplicated. A take like
      // b62256fe (extra mid-song cycle) has NO such cut and is rejected whole.
      const ends = findLastLineEnds(words, combinedLyrics)
        .filter((e) => e >= effOrig * 0.80 && e <= effOrig * 1.15)
        .sort((a, b) => a - b);
      for (const e of ends) {
        const aud = words.filter((w) => w.end <= e + 0.3);
        structFail = auditStructure(aud, combinedLyrics, pristineWords);
        if (!structFail) {
          trimAtS = Math.min(takeEnd, +(e + 2.5).toFixed(2));
          lenOk = true;
          break;
        }
      }
    }
    if (!lenOk) {
      diags.push({ url, verdict: 'reject', reason: structFail || (takeEnd > effOrig * 1.08 ? 'demasiado larga, sin punto de corte estructuralmente completo' : 'demasiado corta') });
      continue;
    }
    const audible = trimAtS ? words.filter((w) => w.end <= trimAtS) : words;
    const check = evalChecklist(audible, plan.changes || [], combinedLyrics, priors);
    if (!check.ok) {
      diags.push({ url, verdict: 'reject', reason: check.fail, text: audible.map((w) => w.word).join(' ').slice(0, 400) });
      continue;
    }
    cands.push({ url, kieId, drift: Math.abs((trimAtS || takeEnd) - effOrig) + Math.max(0, introDrift), trimAtS, words });
    diags.push({ url, verdict: trimAtS ? 'clean-trimmed' : 'clean', reason: trimAtS ? `over-long, trimmed at ${trimAtS.toFixed(1)}s` : 'in-band whole take' });
  }

  if (!cands.length) {
    // AUTO-ESCALATION (2026-08-11, Miguel Ángel): a PINNED full re-roll whose
    // takes fail STRUCTURALLY (duplicated/missing sections) is the signature of
    // the duration pin forcing Suno to pad the lyric sheet — retrying pinned
    // burns rounds against a wall (0/8 pinned vs 4/4 unpinned that night). The
    // next round automatically drops the pin but KEEPS the cloned voice.
    const structuralFail = diags.slice(-2).some((d: any) => /secci[oó]n|no contiene la canci[oó]n|estructuralmente|duplicada/i.test(String(d?.reason || '')));
    // SECTION → FULL escalation (2026-08-12, Mariela 62fd68ed): when the section
    // ladder can't land after 2 rounds, retrying a 3rd rarely helps — the song
    // itself is resisting replace-section. Move to the full re-roll ladder
    // (same cloned voice), which the pin rule below then escalates to unpinned
    // if needed. Happens once per request; the daily cap still bounds spend.
    // OWNER RULE (2026-08-12): a full re-roll is a NEW PERFORMANCE, not an edit.
    // When the owner approved a SECTION fix and handed it over, escalating to a
    // re-roll behind their back returns something they explicitly refused —
    // "the whole reason for your help is to keep the same song and tone and
    // voice, and make edits". handoff-plan sets noAutoFull unless the owner
    // opted in; park it for a human instead.
    if (plan.mode !== 'full' && plan.noAutoFull && (r.auto_round || 0) >= (state.max_rounds || 3)) {
      await setAuto(admin, r.id, {
        auto_takes: diags.slice(-12),
        auto_status: 'needs_human',
        auto_error: 'Section fix could not land cleanly. A full re-roll would re-sing the whole song (new performance) — needs your OK.',
      });
      return;
    }
    if (plan.mode !== 'full' && !plan.noAutoFull && !plan.escalatedToFull && (r.auto_round || 0) >= 2) {
      await setAuto(admin, r.id, {
        auto_takes: diags.slice(-12),
        auto_plan: { ...plan, mode: 'full', escalatedToFull: true },
        auto_round: 0,
        auto_status: 'generating',
        auto_error: 'section rounds failed — escalating to a full re-roll in the SAME cloned voice',
      });
      return;
    }
    if (plan.mode === 'full' && !plan.noPin && !plan.noPersona && structuralFail) {
      await setAuto(admin, r.id, {
        auto_takes: diags.slice(-12),
        auto_plan: { ...plan, noPin: true },
        auto_status: 'generating',
        auto_error: 'pinned takes failed structurally — retrying SAME VOICE without the length pin',
      });
      return;
    }
    await setAuto(admin, r.id, { auto_takes: diags.slice(-12), auto_status: 'generating', auto_error: 'no clean take this round' });
    return;
  }

  // Winner: in-band beats trimmed; then least drift.
  cands.sort((a, b) => ((a.trimAtS ? 1 : 0) - (b.trimAtS ? 1 : 0)) || (a.drift - b.drift));
  const win = cands[0];

  // Host the winner permanently. Trim via the renderer when needed.
  let hosted: string | null = null;
  if (win.trimAtS) {
    const t = await callFn('fix-song-section', { action: 'splice', mode: 'trim', pristineUrl: win.url, trimAtS: win.trimAtS });
    hosted = t?.ok ? t.url : null;
    if (!hosted) { await setAuto(admin, r.id, { auto_takes: diags.slice(-12), auto_status: 'needs_human', auto_error: 'Winner needs an end-trim but the trim service failed — finish manually.' }); return; }
  } else {
    const t = await callFn('fix-song-section', { action: 'splice', mode: 'rehost', pristineUrl: win.url });
    hosted = t?.ok ? t.url : null;
    // NEVER stage the raw Kie URL as a fallback (2026-08-17). Kie purges take
    // audio ~14 days after generation; releaseCandidate copies the candidate
    // URL verbatim into the customer's live song. A renderer hiccup here used
    // to mean: staged Friday, released Monday, gift link dead two weeks later
    // — on a PAID song. Same posture as the trim branch: park it for a human.
    if (!hosted) { await setAuto(admin, r.id, { auto_takes: diags.slice(-12), auto_status: 'needs_human', auto_error: 'Winner is clean but re-hosting failed — the Kie URL expires in ~14 days, so it must not be staged. Retry or finish manually.' }); return; }
  }

  // EVIDENCE FOR THE APPROVER (2026-08-24 playbook): where each corrected line
  // is heard in the winner, plus an explicit EAR-CHECK for proper names — a
  // transcript cannot judge name pronunciation (Whisper wrote "Obed" as
  // "Poderte"), so a name is never a reason to fail a take; it is a reason to
  // point the human ear at a timestamp before release.
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  const winAudible: W[] = win.trimAtS ? (win.words || []).filter((w: W) => w.end <= win.trimAtS!) : (win.words || []);
  const spotNotes: string[] = [];
  const earChecks: string[] = [];
  for (const c of (plan.changes || [])) {
    if (!c?.after) continue;
    const hit = findCleanLine(winAudible, buildTokenGroups(String(c.after)));
    if (hit) spotNotes.push(`"${String(c.after).slice(0, 34)}" @${mmss(hit.startS)}`);
    const beforeToks = new Set(String(c.before || '').split(/\s+/).map((t: string) => t.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '')));
    for (const tok of String(c.after).trim().split(/\s+/).slice(1)) {
      const clean = tok.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
      if (clean.length >= 3 && /^[A-ZÁÉÍÓÚÑÜ]/.test(clean) && !beforeToks.has(clean)) {
        earChecks.push(`"${clean}"${hit ? ` @${mmss(hit.startS)}` : ''}`);
      }
    }
  }
  const earList = [...new Set(earChecks)];
  const evidence = [
    spotNotes.length ? `Heard: ${spotNotes.join(', ')}` : '',
    earList.length ? `👂 EAR-CHECK the name${earList.length > 1 ? 's' : ''} ${earList.join(', ')} before releasing (transcripts can't judge names)` : '',
  ].filter(Boolean).join(' · ');

  // STAGE — human release gate unchanged.
  const scorecard = {
    corrections_sung: true,
    length_ok: true,
    trimmed: !!win.trimAtS,
    round: r.auto_round,
    takes_seen: diags.length,
    ear_check: earList,
    auto: true,
  };
  await admin.from('song_fix_requests').update({
    candidate_audio_url: hosted,
    candidate_lyrics: plan.fullLyrics || plan.approvedLyrics || null,
    candidate_summary: [plan.summary || 'Automated fix (pending your approval)', evidence].filter(Boolean).join(' · ').slice(0, 900),
    // fixTaskId/fixAudioId/fixTrimAtS: the winner is always a whole Kie take, so
    // release must CHAIN the next fix off it (song-fix-queue nulls kie_task_id
    // when these are absent — which made the next fix re-sing from the pristine
    // original and silently revert this one, the 2026-08-04 regression class).
    candidate_meta: {
      mode: plan.mode,
      corrections: plan.changes || [],
      scorecard,
      fixTaskId: r.auto_task_id || null,
      fixAudioId: win.kieId || null,
      fixTrimAtS: win.trimAtS || null,
    },
    status: 'awaiting_approval',
    worked_by: 'fix-song-auto',
    staged_at: new Date().toISOString(),
    auto_status: 'staged',
    auto_takes: diags.slice(-12),
    auto_error: null,
    auto_updated_at: new Date().toISOString(),
  }).eq('id', r.id);

  // Ping the approvers (owner + Ivan) on WhatsApp. Best-effort but LOUD on
  // failure — a swallowed error meant a staged fix could sit with nobody told
  // and nothing in the logs saying why.
  const who = r.context?.customer_name || r.context?.phone || 'customer';
  await pingApprovers(state, `🎧 Ace here — fix ready for ${who}: ${plan.summary || 'correction staged'}${win.trimAtS ? ' (end-trimmed)' : ''}.${earList.length ? ` 👂 Ear-check ${earList.join(', ')}.` : ''} Listen & release in the Fix Song tab: ${ADMIN_FIX_URL}`);
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = body?.action || 'tick';

    const { data: state } = await admin.from('fix_auto_state').select('*').eq('id', 1).single();

    if (action === 'status') {
      const { data: counts } = await admin.from('song_fix_requests')
        .select('auto_status').not('auto_status', 'is', null);
      const byState: Record<string, number> = {};
      for (const c of counts || []) byState[c.auto_status] = (byState[c.auto_status] || 0) + 1;
      return json({ ok: true, enabled: !!state?.enabled, byState });
    }

    if (!state?.enabled) return json({ ok: true, disabled: true });

    // Daily budget guard: count today's AUTO generations only (the 'auto-submit'
    // marker rows stepGenerate writes). Counting every section/full-submit also
    // counted manual browser work, which silently starved the worker.
    const { count: todayRounds } = await admin.from('song_fix_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'auto-submit')
      .gt('created_at', new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString());
    // The cap gates SUBMITTING, not the whole tick (2026-08-12). Returning here
    // froze every other step too — linking, understanding, planning, validating,
    // staging — so a request that already had a good take sat unstaged and
    // unpinged until UTC midnight. Only stepGenerate spends; everything else is
    // free and must keep running.
    const capReached = (todayRounds || 0) >= (state.daily_cap || 40);

    // Pick up work: pending requests not claimed by a human, or mid-pipeline ones.
    // NOTE: never touch status='in_progress' (a person owns those).
    // FUTURE-ONLY + INTAKE GATE (owner spec 2026-07-27): only requests that went
    // through the guided intake questionnaire (intake_complete=true) AND were
    // created after active_since enter the pipeline. The old backlog stays manual.
    const cutoff = state.active_since || new Date().toISOString();
    const { data: fresh } = await admin.from('song_fix_requests')
      .select('*')
      .eq('status', 'pending')
      .eq('intake_complete', true)
      .gt('created_at', cutoff)
      .is('auto_status', null)
      .order('created_at', { ascending: true })
      .limit(2);
    const { data: mid } = await admin.from('song_fix_requests')
      .select('*')
      .eq('status', 'pending')
      .in('auto_status', ['linking', 'understanding', 'planning', 'generating', 'polling', 'validating'])
      .order('auto_updated_at', { ascending: true })
      .limit(3);

    const work = [...(fresh || []).map((r: any) => ({ ...r, auto_status: r.auto_status || 'linking' })), ...(mid || [])];
    const done: Record<string, string> = {};
    for (const r of work.slice(0, 3)) {
      // Overlap claim — cron fires every 2 min but a validating step (N song
      // downloads + Whisper + a trim) can run longer, and nothing marked a row
      // as in-flight, so an overlapping tick could pick the same row and submit
      // a DUPLICATE Kie generation. Claim = bump auto_updated_at, but only when
      // the last touch is >110s old (a step started within the last 110s is
      // still owned by that tick). NOT timestamp EQUALITY against the value we
      // read — timestamptz microsecond precision never round-trips through
      // JSON exactly, so the eq-claim matched nothing and every row DEADLOCKED
      // after its first step (found live on Vicente's request, 2026-08-10).
      let claim = admin.from('song_fix_requests')
        .update({ auto_updated_at: new Date().toISOString() })
        .eq('id', r.id)
        .eq('status', 'pending');
      claim = r.auto_updated_at
        ? claim.lt('auto_updated_at', new Date(Date.now() - 110_000).toISOString())
        : claim.is('auto_updated_at', null);
      const { data: claimed } = await claim.select('id');
      if (!claimed?.length) { done[r.id] = 'skipped: another tick is working it'; continue; }
      try {
        if (r.auto_status === 'linking') await stepLink(admin, r);
        else if (r.auto_status === 'understanding') await stepUnderstand(admin, r);
        else if (r.auto_status === 'planning') await stepPlan(admin, r);
        else if (r.auto_status === 'generating') {
          if (capReached) { done[r.id] = 'skipped: daily cap reached'; continue; }
          await stepGenerate(admin, r, state);
        }
        else if (r.auto_status === 'polling') await stepPoll(admin, r);
        else if (r.auto_status === 'validating') await stepValidate(admin, r, state);
        done[r.id] = r.auto_status;
      } catch (e) {
        await setAuto(admin, r.id, { auto_status: 'needs_human', auto_error: `worker error: ${e instanceof Error ? e.message : e}`.slice(0, 480) });
        done[r.id] = 'error';
      }
    }
    return json({ ok: true, processed: done });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
