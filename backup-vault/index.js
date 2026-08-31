// backup-vault/index.js
//
// Nightly offsite backup of ALL Supabase Storage buckets + key DB tables into
// the private, versioned GCS bucket rqc-backup-vault (Nearline, us-central1).
// Runs as a Cloud Run JOB (rqc-backup-vault), scheduled nightly; the first
// execution performs the full historical copy (~540 GB) and later runs only
// copy what's new.
//
// SAFETY CONTRACT (owner mandate 2026-08-28): COPY-ONLY. This program contains
// no delete or overwrite-in-place logic of any kind — not on Supabase, not on
// GCS. A file that changed size is re-uploaded, and GCS object versioning
// keeps the previous copy. Sync tools with --delete flags are deliberately
// not used.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, GCS_BUCKET (default rqc-backup-vault)
// Reporting: upserts a row into public.backup_runs (read by health-check's
// Backup Freshness alarm) and writes db exports under db/<YYYY-MM-DD>/.

const { Storage } = require('@google-cloud/storage');
const zlib = require('zlib');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GCS_BUCKET = process.env.GCS_BUCKET || 'rqc-backup-vault';
const COPY_CONCURRENCY = Number(process.env.COPY_CONCURRENCY || 12);
const DB_TABLES = (process.env.DB_TABLES || 'songs,video_orders').split(',');

if (!SERVICE_KEY) { console.error('SUPABASE_SERVICE_KEY missing'); process.exit(1); }

const gcs = new Storage();
const vault = gcs.bucket(GCS_BUCKET);
const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const stats = { checked: 0, copied: 0, bytes: 0, errors: 0, dbRows: 0, drillOk: null };
const runStartedAt = new Date().toISOString();

async function fetchJson(url, opts = {}, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...sbHeaders, ...(opts.headers || {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 120)}`);
      return await r.json();
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}

// ---- 1. Inventory what the vault already holds (one listing, not 92k HEADs)
// Each page is retried: the 110k-object listing takes ~110 MB over several
// minutes, and a single dropped socket killed the whole 2026-08-31 run.
async function loadVaultIndex() {
  const index = new Map(); // 'supabase/<bucket>/<path>' -> size
  let pageToken;
  do {
    let page;
    for (let attempt = 1; ; attempt++) {
      try {
        page = await vault.getFiles({ prefix: 'supabase/', maxResults: 5000, pageToken, autoPaginate: false });
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        console.warn(`vault listing page failed (attempt ${attempt}): ${e.message} — retrying`);
        await new Promise((res) => setTimeout(res, 3000 * attempt));
      }
    }
    const [files, , resp] = page;
    for (const f of files) index.set(f.name, Number(f.metadata.size));
    pageToken = resp && resp.nextPageToken;
  } while (pageToken);
  console.log(`vault index: ${index.size} objects already backed up`);
  return index;
}

// ---- 2. Walk every Supabase bucket recursively --------------------------
async function listBucketObjects(bucket) {
  const out = []; // {path, size}
  const walk = async (prefix) => {
    let offset = 0;
    for (;;) {
      const page = await fetchJson(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!Array.isArray(page) || page.length === 0) break;
      for (const entry of page) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null) await walk(full); // folder
        else out.push({ path: full, size: Number(entry.metadata?.size || 0) });
      }
      if (page.length < 1000) break;
      offset += page.length;
    }
  };
  await walk('');
  return out;
}

async function copyObject(bucket, obj) {
  const dest = `supabase/${bucket}/${obj.path}`;
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(obj.path).replace(/%2F/g, '/')}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: sbHeaders });
      if (!r.ok) throw new Error(`download HTTP ${r.status}`);
      await new Promise((resolve, reject) => {
        const ws = vault.file(dest).createWriteStream({ resumable: obj.size > 8 * 1024 * 1024, metadata: { contentType: r.headers.get('content-type') || 'application/octet-stream' } });
        const { Readable } = require('stream');
        Readable.fromWeb(r.body).pipe(ws).on('finish', resolve).on('error', reject);
      });
      stats.copied++;
      stats.bytes += obj.size;
      if (stats.copied % 500 === 0) console.log(`copied ${stats.copied} files, ${(stats.bytes / 1e9).toFixed(1)} GB`);
      return;
    } catch (e) {
      if (attempt === 3) { stats.errors++; console.warn(`FAILED ${bucket}/${obj.path}: ${e.message}`); return; }
      await new Promise((res) => setTimeout(res, 3000 * attempt));
    }
  }
}

async function backupStorage() {
  const vaultIndex = await loadVaultIndex();
  const buckets = await fetchJson(`${SUPABASE_URL}/storage/v1/bucket`);
  const queue = [];
  for (const b of buckets) {
    const objects = await listBucketObjects(b.name);
    console.log(`${b.name}: ${objects.length} objects in source`);
    for (const obj of objects) {
      stats.checked++;
      const have = vaultIndex.get(`supabase/${b.name}/${obj.path}`);
      // Copy when missing or size changed. An overwrite in GCS creates a NEW
      // version; the old one is retained by bucket versioning (no deletes).
      if (have === undefined || (obj.size > 0 && have !== obj.size)) queue.push({ bucket: b.name, obj });
    }
  }
  console.log(`to copy: ${queue.length} of ${stats.checked} objects`);
  let i = 0;
  const workers = Array.from({ length: COPY_CONCURRENCY }, async () => {
    while (i < queue.length) {
      const item = queue[i++];
      await copyObject(item.bucket, item.obj);
    }
  });
  await Promise.all(workers);
}

// ---- 3. Export key DB tables as gzipped JSONL ---------------------------
async function backupTable(table, dateDir) {
  const dest = vault.file(`db/${dateDir}/${table}.jsonl.gz`);
  const gz = zlib.createGzip();
  const ws = dest.createWriteStream({ resumable: true, metadata: { contentType: 'application/gzip' } });
  const done = new Promise((resolve, reject) => { gz.pipe(ws).on('finish', resolve).on('error', reject); });
  let from = 0, rows = 0;
  const PAGE = 1000;
  for (;;) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=created_at.asc`, {
      headers: { ...sbHeaders, Range: `${from}-${from + PAGE - 1}`, Prefer: 'count=none' },
    });
    if (!r.ok) throw new Error(`${table} export HTTP ${r.status}`);
    const page = await r.json();
    for (const row of page) { gz.write(JSON.stringify(row) + '\n'); rows++; }
    if (page.length < PAGE) break;
    from += PAGE;
  }
  gz.end();
  await done;
  console.log(`db export ${table}: ${rows} rows`);
  return rows;
}

// ---- 4. Restore drill: pull one real paid song back OUT of the vault ----
async function restoreDrill() {
  try {
    // Only songs paid ≥1h BEFORE this run started: their audio was hosted (and
    // inventoried) before the storage walk, so "missing from the vault" means a
    // real backup failure — not the timing race that false-failed run #1
    // (2026-08-29: drill picked a song paid at 00:16, mid-copy, whose file
    // postdated the 00:05 inventory).
    const cutoff = new Date(Date.parse(runStartedAt) - 60 * 60 * 1000).toISOString();
    const rows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/songs?select=id,audio_url&paid=eq.true&paid_at=lt.${encodeURIComponent(cutoff)}&audio_url=like.*${SUPABASE_URL.replace('https://', '')}*&order=paid_at.desc.nullslast&limit=25`,
    );
    const pick = rows[Math.floor(Math.random() * rows.length)];
    if (!pick) { stats.drillOk = null; return; }
    const m = pick.audio_url.match(/\/object\/public\/([^?]+)/);
    if (!m) { stats.drillOk = null; return; }
    const dest = `supabase/${decodeURIComponent(m[1])}`;
    const [buf] = await vault.file(dest).download({ start: 0, end: 1024 * 600 });
    stats.drillOk = buf.length > 500 * 1024;
    console.log(`restore drill: ${dest} → ${stats.drillOk ? 'OK' : 'TOO SMALL'} (${buf.length} bytes read from vault)`);
  } catch (e) {
    stats.drillOk = false;
    console.warn(`restore drill FAILED: ${e.message}`);
  }
}

// ---- 5. Report into backup_runs so health-check can watch freshness -----
async function report(startedAt, ok, error) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/backup_runs`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ok,
        files_checked: stats.checked,
        files_copied: stats.copied,
        bytes_copied: stats.bytes,
        copy_errors: stats.errors,
        db_rows: stats.dbRows,
        drill_ok: stats.drillOk,
        error: error ? String(error).slice(0, 500) : null,
      }),
    });
  } catch (e) {
    console.warn(`backup_runs report failed: ${e.message}`);
  }
}

// Any crash that escapes the main try/catch must still leave a failure row —
// the 2026-08-31 socket crash reported NOTHING, so backup_runs looked merely
// "quiet" instead of failed until the 26h freshness alarm.
process.on('unhandledRejection', async (e) => {
  console.error('unhandledRejection:', e);
  try { await report(runStartedAt, false, `unhandledRejection: ${e?.message || e}`); } catch { /* best effort */ }
  process.exit(1);
});

(async () => {
  const startedAt = runStartedAt;
  console.log(`=== RQC BACKUP VAULT run ${startedAt} → gs://${GCS_BUCKET} (copy-only, no deletes) ===`);
  try {
    await backupStorage();
    const dateDir = startedAt.slice(0, 10);
    for (const t of DB_TABLES) stats.dbRows += await backupTable(t.trim(), dateDir);
    await restoreDrill();
    const ok = stats.errors === 0;
    await report(startedAt, ok, ok ? null : `${stats.errors} object copy failures`);
    console.log(`=== DONE: checked ${stats.checked}, copied ${stats.copied} (${(stats.bytes / 1e9).toFixed(2)} GB), errors ${stats.errors}, db rows ${stats.dbRows}, drill ${stats.drillOk} ===`);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('backup run failed:', e);
    await report(startedAt, false, e.message);
    process.exit(1);
  }
})();
