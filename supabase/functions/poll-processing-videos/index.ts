// supabase/functions/poll-processing-videos/index.ts
// Safety net: polls Shotstack directly for video_orders stuck in 'processing'
// longer than MIN_STUCK_MINUTES. Handles the case where Shotstack's webhook
// callback is delayed or never fires.
//
// Runs via pg_cron every 5 minutes (or call manually to unstick a render).
// Deploy with: supabase functions deploy poll-processing-videos --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { storeRenderedVideo } from '../_shared/store-video.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHOTSTACK_API_KEY = Deno.env.get('SHOTSTACK_API_KEY')!;
const SHOTSTACK_API_URL = Deno.env.get('SHOTSTACK_API_URL') || 'https://api.shotstack.io/edit/stage';

// Only check orders stuck longer than this
const MIN_STUCK_MINUTES = 10;
// Don't bother with very old orders (probably abandoned)
const MAX_STUCK_HOURS = 24;
// Max orders to check per run. Each completed render is downloaded + re-uploaded
// in storeRenderedVideo, which buffers the whole MP4 in memory — processing several
// at once exceeds the edge function's memory limit (WORKER_RESOURCE_LIMIT). Handle
// one per invocation; the 5-min cron chews through a backlog one at a time.
const MAX_PER_RUN = 1;

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const minCutoff = new Date(Date.now() - MIN_STUCK_MINUTES * 60 * 1000).toISOString();
    const maxCutoff = new Date(Date.now() - MAX_STUCK_HOURS * 3600 * 1000).toISOString();

    const { data: stuck, error: queryErr } = await supabase
      .from('video_orders')
      .select('id, song_id, shotstack_render_id')
      .eq('status', 'processing')
      .not('shotstack_render_id', 'is', null)
      .lte('updated_at', minCutoff)
      .gte('updated_at', maxCutoff)
      .order('updated_at', { ascending: true })
      .limit(MAX_PER_RUN);

    if (queryErr) {
      console.error('Query error:', queryErr);
      return new Response(JSON.stringify({ error: queryErr.message }), { status: 500 });
    }

    if (!stuck || stuck.length === 0) {
      console.log('No stuck processing video orders found.');
      return new Response(JSON.stringify({ checked: 0, resolved: 0 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`Found ${stuck.length} stuck video order(s) — polling Shotstack directly.`);

    const results: Array<{ id: string; renderId: string; shotstack: string; action: string }> = [];

    for (const order of stuck) {
      const renderId = order.shotstack_render_id;
      try {
        const res = await fetch(`${SHOTSTACK_API_URL}/render/${renderId}`, {
          headers: { 'x-api-key': SHOTSTACK_API_KEY },
        });

        if (!res.ok) {
          console.warn(`Shotstack poll failed for ${renderId}: HTTP ${res.status}`);
          results.push({ id: order.id, renderId, shotstack: `http_${res.status}`, action: 'skipped' });
          continue;
        }

        const data = await res.json();
        const renderStatus: string = data?.response?.status ?? 'unknown';
        const videoUrl: string | null = data?.response?.url ?? null;

        console.log(`Render ${renderId} → shotstack status: ${renderStatus}`);

        if (renderStatus === 'done' && videoUrl) {
          // Store video and update DB — mirrors what video-callback does
          try {
            const result = await storeRenderedVideo(
              `${order.song_id}.mp4`,
              videoUrl,
              supabase,
            );

            await supabase
              .from('video_orders')
              .update({
                status: 'completed',
                video_url: result.publicUrl,
                error_message: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.id);

            await supabase
              .from('songs')
              .update({ has_video: true, video_url: result.publicUrl })
              .eq('id', order.song_id);

            console.log(`✅ Recovered video order ${order.id} via poll (${result.method}, ${result.bytes} bytes)`);
            results.push({ id: order.id, renderId, shotstack: renderStatus, action: 'completed' });
          } catch (storeErr) {
            console.error(`Storage failed for ${order.id}:`, storeErr);
            await supabase
              .from('video_orders')
              .update({
                error_message: `poll_storage_failed: ${(storeErr as Error).message}`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.id);
            results.push({ id: order.id, renderId, shotstack: renderStatus, action: 'storage_failed' });
          }
        } else if (renderStatus === 'failed') {
          const errorMsg = data?.response?.error || 'Shotstack render failed';
          await supabase
            .from('video_orders')
            .update({
              status: 'failed',
              error_message: errorMsg,
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.id);
          console.warn(`❌ Render ${renderId} failed: ${errorMsg}`);
          results.push({ id: order.id, renderId, shotstack: renderStatus, action: 'marked_failed' });
        } else {
          // still rendering or unknown — leave it, try again next run
          results.push({ id: order.id, renderId, shotstack: renderStatus, action: 'still_processing' });
        }
      } catch (err) {
        console.error(`Exception polling render ${renderId}:`, err);
        results.push({ id: order.id, renderId, shotstack: 'error', action: 'exception' });
      }
    }

    const resolved = results.filter(r => r.action === 'completed' || r.action === 'marked_failed').length;

    return new Response(
      JSON.stringify({ checked: stuck.length, resolved, results }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error) {
    console.error('poll-processing-videos error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500 },
    );
  }
});
