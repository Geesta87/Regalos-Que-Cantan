// scripts/upload-lab-references.cjs
// Bulk-upload reference ad images from a local folder into the Creative Studio
// Lab gallery (creative_queue, intended_use='raw'), so each becomes a reusable
// template with the "Use as template + context" flow.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-lab-references.cjs "<folder>"
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.CREATIVE_BUCKET || 'creative-studio';
const folder = process.argv[2];

if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!folder || !fs.existsSync(folder)) { console.error('Folder not found:', folder); process.exit(1); }

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const admin = createClient(URL, KEY);
const today = () => new Date().toISOString().slice(0, 10);

(async () => {
  const files = fs.readdirSync(folder).filter((f) => MIME[path.extname(f).toLowerCase()]);
  console.log(`Found ${files.length} image(s) in ${folder}`);
  let ok = 0;
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const label = path.basename(f, path.extname(f)).slice(0, 100);
    try {
      const bytes = fs.readFileSync(path.join(folder, f));
      const { data: row, error: insErr } = await admin.from('creative_queue')
        .insert({ batch_date: today(), kind: 'image', intended_use: 'raw', concept: label, gen_prompt: label, status: 'generating' })
        .select('id').single();
      if (insErr || !row) throw new Error(insErr?.message || 'insert failed');
      const objPath = `raw/${row.id}${ext}`;
      const up = await admin.storage.from(BUCKET).upload(objPath, bytes, { contentType: MIME[ext], upsert: true });
      if (up.error) throw up.error;
      const url = admin.storage.from(BUCKET).getPublicUrl(objPath).data.publicUrl;
      await admin.from('creative_queue').update({ status: 'ready', media_url: url }).eq('id', row.id);
      ok++;
      console.log(`  ✓ ${f}`);
    } catch (e) {
      console.error(`  ✗ ${f}: ${e.message || e}`);
    }
  }
  console.log(`Done — uploaded ${ok}/${files.length} into the Lab gallery.`);
})();
