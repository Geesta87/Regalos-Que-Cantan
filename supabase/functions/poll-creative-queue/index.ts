// supabase/functions/poll-creative-queue/index.ts
// ===========================================================================
// AGENT 2 — CREATIVE STUDIO (poller)
// ===========================================================================
// Runs every ~2 min via pg_cron. Finalizes creative_queue rows left in
// 'generating' by creative-studio-daily: polls Kie recordInfo, and when a job
// succeeds, downloads the media into the 'creative-studio' bucket and flips the
// row to 'ready' (awaiting owner approval). Failed jobs → 'failed'. Mirrors the
// poll-processing-songs safety-net pattern.
//
// Isolated from the payment funnel. verify_jwt = false (pg_cron) — see config.toml.
// Deploy: supabase functions deploy poll-creative-queue --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { applyLogo } from '../_shared/brand.ts';
import { renderAd } from '../_shared/render-ad.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const KIE = 'https://api.kie.ai/api/v1/jobs';
const BUCKET = Deno.env.get('CREATIVE_BUCKET') || 'creative-studio';

// Give a generating row up to this long before declaring it stuck/failed.
const STUCK_MINUTES = Number(Deno.env.get('CREATIVE_STUCK_MINUTES') || '20');
const BATCH = Number(Deno.env.get('CREATIVE_POLL_BATCH') || '20');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function recordInfo(taskId: string): Promise<any> {
  const r = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}` },
  });
  return r.json().catch(() => ({}));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (!KIE_API_KEY) return json(200, { success: false, skipped: true, reason: 'KIE_API_KEY missing' });

  try {
    // Two kinds of 'generating' rows to finalize:
    //  • VIDEO (and any legacy Kie image): has kie_task_id → poll Kie for the media.
    //  • OpenAI IMAGE: no kie_task_id, raw photo already uploaded (media_url set) →
    //    just lay on the typography here (rate-capped).
    const { data: rows, error } = await supabase
      .from('creative_queue')
      .select('id, kind, kie_task_id, created_at, design, media_url')
      .eq('status', 'generating')
      .or('kie_task_id.not.is.null,media_url.not.is.null')
      .order('created_at', { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(`select: ${error.message}`);

    let ready = 0, failed = 0, pending = 0, renders = 0;
    // resvg rendering is memory-heavy; cap heavy renders per invocation so we
    // never trip WORKER_RESOURCE_LIMIT. The 2-min cron drains the rest.
    const RENDER_CAP = Number(Deno.env.get('CREATIVE_RENDER_CAP') || '2');

    for (const row of (rows || [])) {
      try {
        // ── OpenAI image: raw photo is already uploaded; lay on the typography
        // (resvg is memory-heavy, so honor the per-invocation render cap). ──
        if (!row.kie_task_id) {
          if (!row.media_url) { pending++; continue; }
          const d = row.design || {};
          const needsRender = !!(d.headline_lines?.length || d.kicker || d.cta);
          if (needsRender && renders >= RENDER_CAP) { pending++; continue; }
          const media = await fetch(row.media_url);
          let bytes = new Uint8Array(await media.arrayBuffer());
          const png = needsRender
            ? await renderAd({ imageBytes: bytes, kicker: d.kicker, headlineLines: d.headline_lines || [], accent: d.accent, cta: d.cta })
            : null;
          if (needsRender) renders++;
          bytes = png || await applyLogo(bytes);
          const path = `${row.id}.png`;
          const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
          if (up.error) throw new Error(`storage: ${up.error.message}`);
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
          await supabase.from('creative_queue').update({
            status: 'ready', media_url: pub.publicUrl, updated_at: new Date().toISOString(),
          }).eq('id', row.id);
          await supabase.storage.from(BUCKET).remove([`${row.id}-raw.png`]).then(() => {}, () => {});
          ready++;
          continue;
        }

        const info = await recordInfo(row.kie_task_id);
        const state = info?.data?.state;

        if (state === 'success') {
          const rj = JSON.parse(info.data.resultJson || '{}');
          const url = (rj.resultUrls || [])[0];
          if (!url) throw new Error('success but no resultUrls');

          const d = row.design || {};
          const needsRender = row.kind !== 'video' && !!(d.headline_lines?.length || d.kicker || d.cta);
          // Defer heavy renders past the cap to the next tick (leave 'generating').
          if (needsRender && renders >= RENDER_CAP) { pending++; continue; }

          // Persist into our own bucket — Kie temp URLs expire.
          const media = await fetch(url);
          let bytes = new Uint8Array(await media.arrayBuffer());
          const ext = row.kind === 'video' ? 'mp4' : 'png';
          const contentType = row.kind === 'video' ? 'video/mp4' : 'image/png';
          if (row.kind !== 'video') {
            // Two-layer: lay the typeset design over the text-free photo. Falls
            // back to a logo stamp if there's no design copy or the render fails.
            const png = needsRender
              ? await renderAd({ imageBytes: bytes, kicker: d.kicker, headlineLines: d.headline_lines || [], accent: d.accent, cta: d.cta })
              : null;
            if (needsRender) renders++;
            bytes = png || await applyLogo(bytes);
          }
          const path = `${row.id}.${ext}`;
          const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
          if (up.error) throw new Error(`storage: ${up.error.message}`);
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

          await supabase.from('creative_queue').update({
            status: 'ready', media_url: pub.publicUrl, updated_at: new Date().toISOString(),
          }).eq('id', row.id);
          ready++;
        } else if (state === 'fail' || info?.data?.failCode) {
          await supabase.from('creative_queue').update({
            status: 'failed', error: String(info?.data?.failMsg || 'kie fail').slice(0, 500), updated_at: new Date().toISOString(),
          }).eq('id', row.id);
          failed++;
        } else {
          // Still running — unless it's been too long, then mark failed so the
          // queue doesn't fill with zombies.
          const ageMin = (Date.now() - new Date(row.created_at).getTime()) / 60000;
          if (ageMin > STUCK_MINUTES) {
            await supabase.from('creative_queue').update({
              status: 'failed', error: `stuck > ${STUCK_MINUTES}m`, updated_at: new Date().toISOString(),
            }).eq('id', row.id);
            failed++;
          } else {
            pending++;
          }
        }
      } catch (e: any) {
        console.error(`[poll-creative-queue] row ${row.id}:`, e?.message || e);
        await supabase.from('creative_queue').update({
          status: 'failed', error: String(e?.message || e).slice(0, 500), updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        failed++;
      }
    }

    return json(200, { success: true, scanned: (rows || []).length, ready, failed, pending, ms: Date.now() - startTime });
  } catch (e: any) {
    console.error('[poll-creative-queue] error:', e?.message || e);
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
