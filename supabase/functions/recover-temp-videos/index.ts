// supabase/functions/recover-temp-videos/index.ts
// Deploy with: supabase functions deploy recover-temp-videos
//
// One-shot recovery for video_orders that ended up with a temporary
// Shotstack URL stored in `video_url` instead of a permanent Supabase
// Storage URL. For each affected order this function:
//   1. If we still have the Shotstack render id, re-fetches the render
//      from Shotstack to get a fresh signed URL (handles cases where the
//      original temp URL has already expired but the render is still
//      cached).
//   2. Streams the video into the `videos` bucket via the same shared
//      helper used by video-callback.
//   3. Updates video_orders.video_url and songs.video_url to the
//      permanent URL.
//
// Invoke with POST. Optional JSON body:
//   { "limit": 10, "videoOrderId": "<uuid>" }
// `videoOrderId` recovers a single order; otherwise we walk every
// completed order whose URL still points at shotstack.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { storeRenderedVideo } from '../_shared/store-video.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHOTSTACK_API_KEY = Deno.env.get('SHOTSTACK_API_KEY')!;
const SHOTSTACK_API_URL =
  Deno.env.get('SHOTSTACK_API_URL') || 'https://api.shotstack.io/edit/stage';

interface RecoveryRecord {
  videoOrderId: string;
  songId: string;
  outcome: 'recovered' | 'source_expired' | 'storage_failed' | 'skipped';
  publicUrl?: string;
  bytes?: number;
  method?: string;
  error?: string;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('POST only', { status: 405 });
  }

  let body: { limit?: number; videoOrderId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 100);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let query = supabase
    .from('video_orders')
    .select('id, song_id, video_url, shotstack_render_id')
    .like('video_url', '%shotstack%')
    .limit(limit);

  if (body.videoOrderId) {
    query = supabase
      .from('video_orders')
      .select('id, song_id, video_url, shotstack_render_id')
      .eq('id', body.videoOrderId);
  }

  const { data: orders, error: fetchErr } = await query;
  if (fetchErr) {
    return new Response(
      JSON.stringify({ error: fetchErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[recover-temp-videos] Found ${orders?.length ?? 0} orders to recover`);

  const records: RecoveryRecord[] = [];

  for (const order of orders ?? []) {
    const rec: RecoveryRecord = {
      videoOrderId: order.id,
      songId: order.song_id,
      outcome: 'skipped',
    };

    // Resolve a fresh source URL: prefer Shotstack render API since the
    // URL on the order may already have expired.
    let sourceUrl: string | null = null;
    if (order.shotstack_render_id) {
      try {
        const res = await fetch(
          `${SHOTSTACK_API_URL}/render/${order.shotstack_render_id}`,
          { headers: { 'x-api-key': SHOTSTACK_API_KEY } },
        );
        if (res.ok) {
          const json = await res.json();
          if (json.response?.status === 'done' && json.response?.url) {
            sourceUrl = json.response.url;
          }
        }
      } catch (err) {
        console.error(`[recover-temp-videos] Shotstack lookup failed for ${order.id}:`, err);
      }
    }
    // Fallback to whatever URL is on the order
    if (!sourceUrl) sourceUrl = order.video_url;

    if (!sourceUrl) {
      rec.outcome = 'source_expired';
      rec.error = 'No source URL available';
      records.push(rec);
      continue;
    }

    // Probe the source URL with a HEAD before attempting the upload so we
    // can distinguish "Shotstack expired" from "storage broken".
    try {
      const head = await fetch(sourceUrl, { method: 'HEAD' });
      if (!head.ok) {
        rec.outcome = 'source_expired';
        rec.error = `HEAD ${head.status}`;
        records.push(rec);
        continue;
      }
    } catch (err) {
      rec.outcome = 'source_expired';
      rec.error = `HEAD failed: ${err.message}`;
      records.push(rec);
      continue;
    }

    try {
      const result = await storeRenderedVideo(
        `${order.song_id}.mp4`,
        sourceUrl,
        supabase,
      );

      await supabase
        .from('video_orders')
        .update({
          video_url: result.publicUrl,
          status: 'completed',
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      await supabase
        .from('songs')
        .update({ has_video: true, video_url: result.publicUrl })
        .eq('id', order.song_id);

      rec.outcome = 'recovered';
      rec.publicUrl = result.publicUrl;
      rec.bytes = result.bytes;
      rec.method = result.method;
      console.log(`[recover-temp-videos] OK ${order.id} → ${result.publicUrl}`);
    } catch (err) {
      rec.outcome = 'storage_failed';
      rec.error = err.message;
      console.error(`[recover-temp-videos] FAILED ${order.id}:`, err);
    }

    records.push(rec);
  }

  const summary = {
    total: records.length,
    recovered: records.filter((r) => r.outcome === 'recovered').length,
    expired: records.filter((r) => r.outcome === 'source_expired').length,
    failed: records.filter((r) => r.outcome === 'storage_failed').length,
  };

  return new Response(
    JSON.stringify({ summary, records }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
