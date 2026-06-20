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

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ checked: 0, triggered: 0 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`Found ${pending.length} pending video order(s) needing render trigger`);

    const results: Array<{ id: string; success: boolean; renderId?: string; error?: string }> = [];

    for (const order of pending) {
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

    // --- SELF-HEAL stuck 'processing' orders ---
    // A fire-and-forget generate-video dispatch can fail to reach the renderer,
    // leaving the order in 'processing' with no video — and the query above won't
    // catch it (it only looks at 'photos_uploaded'). Reset + re-dispatch any order
    // stuck in 'processing' > STUCK_MIN with no video_url. Recent only (MAX_AGE_HOURS)
    // so old/abandoned orders aren't resurrected.
    const STUCK_MIN = 20;
    const stuckCutoff = new Date(Date.now() - STUCK_MIN * 60 * 1000).toISOString();
    const { data: stuck } = await supabase
      .from('video_orders')
      .select('id, aspect_ratio, video_filter, message_url')
      .eq('paid', true).eq('status', 'processing').is('video_url', null)
      .lte('updated_at', stuckCutoff).gte('updated_at', maxAgeCutoff)
      .order('updated_at', { ascending: true }).limit(MAX_PER_RUN);

    let recovered = 0;
    for (const order of stuck || []) {
      try {
        await supabase.from('video_orders').update({ status: 'photos_uploaded', shotstack_render_id: null }).eq('id', order.id);
        const body: Record<string, unknown> = { videoOrderId: order.id, aspectRatio: order.aspect_ratio || '9:16', videoFilter: order.video_filter || 'boost' };
        if (order.message_url) body.messageUrl = order.message_url;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-video`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }, body: JSON.stringify(body),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d?.success) { recovered++; console.log(`Re-dispatched stuck order ${order.id} (${d.renderer || '?'})`); }
      } catch (e) { console.error('stuck recover failed', order.id, (e as Error).message); }
    }

    return new Response(
      JSON.stringify({ checked: pending.length, triggered, recovered, results }),
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
