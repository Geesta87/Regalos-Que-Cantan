// supabase/functions/clip-studio-watchdog/index.ts
// Deploy with: supabase functions deploy clip-studio-watchdog --project-ref yzbvajungshqcpusfiia
//
// Clip Studio recovery cron (pg_cron every 5 min — verify_jwt = false, see
// supabase/config.toml). Four sweeps, all bounded per run:
//
//   1. Stuck renders: clips 'rendering' with no callback for 8+ minutes get
//      re-dispatched once (attempts++); after 2 attempts they're marked failed
//      so the UI shows a Retry button instead of an eternal spinner.
//      (Root cause of the 2026-07-14 stalls: a renderer redeploy killed the
//      in-flight background jobs — the 202-then-callback contract has no
//      server-side recovery, so this cron is it.)
//   2. Stuck projects: 'preparing'/'transcribing' for 30+ minutes -> error
//      (the UI already has a Retry for that).
//   3. Auto-pilot sweep: backup for the callback kickoff — picks up 'pending'
//      projects, and resets a 'running' state older than 30 min (crashed run).
//   4. Storage purge: uploaded source videos (NOT song teasers) older than 14
//      days with no clip activity for 14 days lose their source + audio files;
//      finished clips and the transcript are kept. Keeps the 1GB-per-upload
//      bucket growth in check.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BUCKET, CALLBACK_URL, autoPilotRun, dispatchClip, dispatchRenderer, nowIso } from '../_shared/clip-studio-lib.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_ATTEMPTS = 2;           // dispatch attempts before a clip is marked failed
// The renderer works its queue ONE job at a time, and dispatched_at is stamped
// at dispatch — so this window must cover queue wait + render for a full
// auto-clip batch (up to 8 clips × ~2-3 min), not just one render.
const STUCK_CLIP_MIN = 20;        // minutes without a callback before a render counts as stuck
const STUCK_PROJECT_MIN = 30;     // minutes before preparing/transcribing counts as stuck
const PURGE_AFTER_DAYS = 14;      // source cleanup age
const PURGE_PER_RUN = 2;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

serve(async (req) => {
  const json = (o: unknown, code = 200) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' }, status: code });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const report: Record<string, unknown> = {};

  try {
    // ---- 0. seed the music library (once) ---------------------------------
    // If the library is EMPTY, install one instrumental per top-selling style
    // (real extracted stems from the karaoke upsell) as the starting template
    // set. Only fires on an empty folder, so owner deletions stick.
    const SEED_TRACKS: Array<{ name: string; url: string }> = [
      { name: 'instrumental-romantica.mp3', url: 'https://www.regalosquecantan.com/karaoke/b9e8b684-891b-4db4-b994-7d8d4a33edeb.mp3' },
      { name: 'instrumental-corrido.mp3',   url: 'https://www.regalosquecantan.com/karaoke/a6248058-b3e3-4238-98b0-f5a807741110.mp3' },
      { name: 'instrumental-banda.mp3',     url: 'https://www.regalosquecantan.com/karaoke/1c7fa8ef-dbae-462c-bed8-8939e456ed0f.mp3' },
      { name: 'instrumental-balada.mp3',    url: 'https://www.regalosquecantan.com/karaoke/55ec114d-ea0f-4c53-9d44-ab66f97a58eb.mp3' },
      { name: 'instrumental-ranchera.mp3',  url: 'https://www.regalosquecantan.com/karaoke/5526d8b2-a9c0-4216-8f1e-15d5863dde24.mp3' },
    ];
    const { data: existingMusic } = await admin.storage.from(BUCKET).list('music');
    const hasTracks = (existingMusic || []).some((f: any) => /\.(mp3|m4a|aac)$/i.test(f.name || ''));
    if (!hasTracks) {
      const seeded: string[] = [];
      for (const t of SEED_TRACKS) {
        try {
          const res = await fetch(t.url);
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          const { error: upErr } = await admin.storage.from(BUCKET)
            .upload(`music/${t.name}`, bytes, { contentType: 'audio/mpeg', upsert: true });
          if (upErr) throw new Error(upErr.message);
          seeded.push(t.name);
        } catch (e) {
          console.warn(`music seed ${t.name} failed:`, (e as Error).message);
        }
      }
      if (seeded.length) report.music_seeded = seeded;
    }

    // ---- 1. stuck clip renders -------------------------------------------
    const { data: stuckClips } = await admin.from('clips')
      .select('*')
      .eq('status', 'rendering')
      .lt('dispatched_at', minutesAgo(STUCK_CLIP_MIN))
      .order('created_at', { ascending: true })
      .limit(5);
    const retried: string[] = [];
    const timedOut: string[] = [];
    for (const clip of stuckClips || []) {
      if ((clip.attempts || 0) >= MAX_ATTEMPTS) {
        await admin.from('clips').update({
          status: 'failed',
          error_message: 'Render timed out — the render server never reported back. Press Retry to try again.',
          updated_at: nowIso(),
        }).eq('id', clip.id);
        timedOut.push(clip.id);
        continue;
      }
      const { data: proj } = await admin.from('clip_projects').select('*').eq('id', clip.project_id).single();
      if (!proj) continue;
      try {
        await admin.from('clips').update({ attempts: (clip.attempts || 0) + 1, updated_at: nowIso() }).eq('id', clip.id);
        await dispatchClip(admin, proj, clip);
        retried.push(clip.id);
      } catch (e) {
        await admin.from('clips').update({
          status: 'failed', error_message: `Retry dispatch failed: ${(e as Error).message}`, updated_at: nowIso(),
        }).eq('id', clip.id);
        timedOut.push(clip.id);
      }
    }
    report.retried = retried;
    report.timed_out = timedOut;

    // ---- 1a2. browser-preview backfill ------------------------------------
    // Projects ingested before the preview transcode existed (or whose
    // transcode failed): produce the 720p H.264 dashboard copy. One per run —
    // a long source can take a few minutes on the render queue.
    const { data: noPreview } = await admin.from('clip_projects')
      .select('id, source_url')
      .eq('status', 'ready').is('preview_url', null).not('source_url', 'is', null)
      .is('source_purged_at', null)
      .order('updated_at', { ascending: false })
      .limit(1);
    const previewed: string[] = [];
    for (const proj of noPreview || []) {
      try {
        const previewPath = `${proj.id}/preview.mp4`;
        const { data: signedPrev, error: pe } = await admin.storage.from(BUCKET).createSignedUploadUrl(previewPath, { upsert: true });
        if (pe) throw new Error(pe.message);
        await dispatchRenderer('/clip-prepare', {
          project_id: proj.id, source_url: proj.source_url, bucket: BUCKET, callback_url: CALLBACK_URL,
          preview_only: true,
          preview_upload_url: signedPrev.signedUrl, preview_path: previewPath,
          preview_public_url: admin.storage.from(BUCKET).getPublicUrl(previewPath).data.publicUrl,
        });
        previewed.push(proj.id);
      } catch (e) {
        console.warn(`preview backfill dispatch failed for ${proj.id}: ${(e as Error).message}`);
      }
    }
    report.preview_backfill = previewed;

    // ---- 1b. finished uploads whose ingest never fired --------------------
    // The browser calls 'ingest' right after the multi-GB PUT completes; if
    // the admin session expired during a long upload (or the tab closed),
    // the file sits in storage with the project stuck at 'uploaded'. If the
    // source file exists, run the ingest step here.
    const { data: orphanUploads } = await admin.from('clip_projects')
      .select('id')
      .eq('status', 'uploaded')
      .lt('created_at', minutesAgo(10))
      .limit(5);
    const ingested: string[] = [];
    for (const proj of orphanUploads || []) {
      const { data: files } = await admin.storage.from(BUCKET).list(proj.id);
      const source = (files || []).find((f: any) => /^source\./.test(f.name || ''));
      if (!source) continue; // upload still in flight (or abandoned) — leave it
      try {
        const sourcePath = `${proj.id}/${source.name}`;
        const source_url = admin.storage.from(BUCKET).getPublicUrl(sourcePath).data.publicUrl;
        const audioPath = `${proj.id}/audio.mp3`;
        const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(audioPath, { upsert: true });
        if (se) throw new Error(`sign audio: ${se.message}`);
        await admin.from('clip_projects')
          .update({ source_path: sourcePath, source_url, status: 'preparing', error_message: null, updated_at: nowIso() })
          .eq('id', proj.id);
        await dispatchRenderer('/clip-prepare', {
          project_id: proj.id, source_url, bucket: BUCKET, callback_url: CALLBACK_URL,
          audio_upload_url: signed.signedUrl, audio_path: audioPath,
          audio_public_url: admin.storage.from(BUCKET).getPublicUrl(audioPath).data.publicUrl,
        });
        ingested.push(proj.id);
      } catch (e) {
        await admin.from('clip_projects').update({
          status: 'error', error_message: `Could not start processing: ${(e as Error).message}`, updated_at: nowIso(),
        }).eq('id', proj.id);
      }
    }
    if (ingested.length) report.ingested = ingested;

    // ---- 2. stuck projects (prepare/transcribe) --------------------------
    const { data: stuckProjects } = await admin.from('clip_projects')
      .select('id')
      .in('status', ['preparing', 'transcribing'])
      .lt('updated_at', minutesAgo(STUCK_PROJECT_MIN))
      .limit(10);
    if (stuckProjects?.length) {
      await admin.from('clip_projects').update({
        status: 'error',
        error_message: 'Processing timed out — press Retry to read the video again.',
        updated_at: nowIso(),
      }).in('id', stuckProjects.map((p: any) => p.id));
      report.projects_errored = stuckProjects.map((p: any) => p.id);
    }

    // ---- 3. auto-pilot sweep ---------------------------------------------
    // Reset a crashed 'running' first, then process ONE pending project per
    // tick (a run = 1 Claude call + up to 8 emphasis calls + 8 dispatches).
    await admin.from('clip_projects')
      .update({ auto_pilot_state: 'pending', updated_at: nowIso() })
      .eq('auto_pilot_state', 'running')
      .lt('updated_at', minutesAgo(30));
    const { data: pendingAuto } = await admin.from('clip_projects')
      .select('id')
      .eq('auto_pilot', true)
      .eq('auto_pilot_state', 'pending')
      .eq('status', 'ready')
      .order('created_at', { ascending: true })
      .limit(1);
    if (pendingAuto?.length) {
      report.auto_pilot = { project_id: pendingAuto[0].id, ...(await autoPilotRun(admin, pendingAuto[0].id)) };
    }

    // ---- 4. source purge (uploads only; teasers have no source_path) ------
    const { data: purgeable } = await admin.from('clip_projects')
      .select('id, source_path, audio_path, created_at')
      .is('source_purged_at', null)
      .not('source_path', 'is', null)
      .lt('created_at', daysAgo(PURGE_AFTER_DAYS))
      .limit(10);
    const purged: string[] = [];
    for (const proj of purgeable || []) {
      if (purged.length >= PURGE_PER_RUN) break;
      // skip if any clip was made (or is still rendering) in the last 14 days
      const { data: recent } = await admin.from('clips')
        .select('id').eq('project_id', proj.id)
        .or(`created_at.gte.${daysAgo(PURGE_AFTER_DAYS)},status.eq.rendering`)
        .limit(1);
      if (recent?.length) continue;
      const paths = [proj.source_path, proj.audio_path].filter(Boolean) as string[];
      if (paths.length) await admin.storage.from(BUCKET).remove(paths);
      await admin.from('clip_projects').update({
        source_purged_at: nowIso(), source_url: null, updated_at: nowIso(),
      }).eq('id', proj.id);
      purged.push(proj.id);
    }
    report.purged = purged;

    return json({ ok: true, ...report });
  } catch (e: any) {
    console.error('clip-studio-watchdog error:', e.message);
    return json({ ok: false, error: e.message, ...report }, 500);
  }
});
