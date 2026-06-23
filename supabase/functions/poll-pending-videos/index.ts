// supabase/functions/poll-pending-videos/index.ts
// Safety net: triggers generate-video for video_orders where the customer
// uploaded photos but the browser never fired the render call (closed tab,
// network drop, JS error, etc).
//
// Conditions for picking up an order:
//   - paid = true
//   - status = 'photos_uploaded'
//   - shotstack_render_id IS NULL  (render never started)
//   - photo_count >= 1
//   - updated_at older than 90 seconds (give the browser a fair chance first)
//   - updated_at within last 24 hours (don't resurrect ancient orders)
//
// Runs via pg_cron every 2 minutes.
// Deploy with: supabase functions deploy poll-pending-videos --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Cap how many we trigger per run so we don't overload Shotstack
const MAX_PER_RUN = 5;

// Skip orders updated more recently than this (give browser a chance)
const MIN_AGE_SECONDS = 90;

// Skip orders older than this (probably abandoned / manually handled)
const MAX_AGE_HOURS = 24;

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const minAgeCutoff = new Date(Date.now() - MIN_AGE_SECONDS * 1000).toISOString();
    const maxAgeCutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();

    const { data: pending, error: queryErr } = await supabase
      .from('video_orders')
      .select('id, song_id, photo_count, aspect_ratio, video_filter, message_url, updated_at')
      .eq('paid', true)
      .eq('status', 'photos_uploaded')
      .is('shotstack_render_id', null)
      .gte('photo_count', 1)
      .lte('updated_at', minAgeCutoff)
      .gte('updated_at', maxAgeCutoff)
      .order('updated_at', { ascending: true })
      .limit(MAX_PER_RUN);

    if (queryErr) {
      console.error('Query error:', queryErr);
      return new Response(JSON.stringify({ error: queryErr.message }), { status: 500 });
    }

    // Do NOT early-return when there are no 'photos_uploaded' orders. The
    // SELF-HEAL block further down (stuck 'processing' recovery) must run on
    // EVERY invocation. The old early-return here is exactly what let in-house
    // renders sit dead forever: when nobody was mid-upload (the common case),
    // the function returned before ever reaching the self-heal, so a stalled
    // paid render was only retried by luck — when someone else happened to be
    // uploading in the same 2-min window. (Tere / jcnmtsierra72 2026-06-23:
    // render_attempts stayed 0 for 2.5h while the order sat in 'processing'.)
    const pendingOrders = pending || [];
    if (pendingOrders.length) {
      console.log(`Found ${pendingOrders.length} pending video order(s) needing render trigger`);
    }

    const results: Array<{ id: string; success: boolean; renderId?: string; error?: string }> = [];

    for (const order of pendingOrders) {
      try {
        const body: Record<string, unknown> = {
          videoOrderId: order.id,
          aspectRatio: order.aspect_ratio || '9:16',
          videoFilter: order.video_filter || 'boost',
        };
        if (order.message_url) body.messageUrl = order.message_url;

        const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-video`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify(body),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data?.success) {
          console.log(`Triggered render for order ${order.id}: render=${data.renderId}`);
          results.push({ id: order.id, success: true, renderId: data.renderId });
        } else {
          const errMsg = data?.error || `HTTP ${res.status}`;
          console.error(`Failed to trigger render for ${order.id}: ${errMsg}`);
          results.push({ id: order.id, success: false, error: errMsg });
        }
      } catch (err) {
        console.error(`Exception triggering render for ${order.id}:`, err);
        results.push({ id: order.id, success: false, error: (err as Error).message });
      }
    }

    const triggered = results.filter(r => r.success).length;

    // --- SELF-HEAL stuck 'processing' orders (BOUNDED) ---
    // A fire-and-forget generate-video dispatch can fail to reach the renderer, OR
    // the Cloud Run render can die mid-way (OOM / instance kill / timeout) WITHOUT
    // firing its failure callback — either way the order sits in 'processing' with
    // no video. The query above won't catch it (it only looks at 'photos_uploaded').
    //
    // We re-dispatch up to MAX_ATTEMPTS times (STUCK_MIN apart). If it's STILL stuck
    // after that, we STOP retrying, mark it 'failed', and push-alert the owner — so a
    // paid order can never churn silently forever (it used to: Tere Espinoza 2026-06-20).
    // STUCK_MIN must exceed the ~6-min render time so we never kill a live render.
    const STUCK_MIN = 12;
    const MAX_ATTEMPTS = 2;
    const stuckCutoff = new Date(Date.now() - STUCK_MIN * 60 * 1000).toISOString();
    const { data: stuck } = await supabase
      .from('video_orders')
      .select('id, song_id, aspect_ratio, video_filter, message_url, render_attempts')
      .eq('paid', true).eq('status', 'processing').is('video_url', null)
      .lte('updated_at', stuckCutoff).gte('updated_at', maxAgeCutoff)
      .order('updated_at', { ascending: true }).limit(MAX_PER_RUN);

    let recovered = 0;
    let failedOut = 0;
    for (const order of stuck || []) {
      const attempts = order.render_attempts || 0;
      try {
        if (attempts >= MAX_ATTEMPTS) {
          // Give up — surface it instead of looping. Mark failed (shows in the admin
          // Videos "Problemas" tab) + push the owner so it never sits invisibly.
          await supabase.from('video_orders').update({
            status: 'failed',
            error_message: `Render stalled — ${attempts} auto-retries, renderer never called back`,
            updated_at: new Date().toISOString(),
          }).eq('id', order.id);
          failedOut++;
          try {
            const { data: s } = await supabase.from('songs').select('recipient_name').eq('id', order.song_id).single();
            await fetch(`${SUPABASE_URL}/functions/v1/notify-admin-push`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: '⚠️ Video atascado',
                body: `El video de ${s?.recipient_name || 'un cliente'} no se generó tras varios intentos. Ábrelo en Videos para reintentar.`,
                url: '/admin/dashboard',
                tag: `video-stuck-${order.id}`,
                audience: 'all',
              }),
            });
          } catch (_) { /* push is best-effort */ }
          console.error(`Gave up on stuck order ${order.id} after ${attempts} attempts → failed + alerted`);
          continue;
        }

        // Re-dispatch, counting the attempt so we eventually give up.
        await supabase.from('video_orders').update({
          status: 'photos_uploaded', shotstack_render_id: null, render_attempts: attempts + 1,
        }).eq('id', order.id);
        const body: Record<string, unknown> = { videoOrderId: order.id, aspectRatio: order.aspect_ratio || '9:16', videoFilter: order.video_filter || 'boost' };
        if (order.message_url) body.messageUrl = order.message_url;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-video`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }, body: JSON.stringify(body),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d?.success) { recovered++; console.log(`Re-dispatched stuck order ${order.id} (attempt ${attempts + 1}/${MAX_ATTEMPTS}, ${d.renderer || '?'})`); }
      } catch (e) { console.error('stuck recover failed', order.id, (e as Error).message); }
    }

    return new Response(
      JSON.stringify({ checked: pendingOrders.length, triggered, recovered, failedOut, results }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error) {
    console.error('poll-pending-videos error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500 },
    );
  }
});
