// supabase/functions/video-callback/index.ts
// Deploy with: supabase functions deploy video-callback
// Shotstack webhook endpoint — called when a video render completes.
//
// On success we MUST persist the rendered video to the `videos` storage
// bucket (Shotstack temp URLs expire). The persistence logic lives in
// _shared/store-video.ts and tries a streaming S3 PUT first, then a
// single-buffer Blob upload as a fallback. If both fail we leave the
// order in `processing` so check-video-status can retry.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { storeRenderedVideo } from '../_shared/store-video.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.json();
    console.log('Shotstack callback received:', JSON.stringify(payload));

    const renderId = payload.id;
    const status = payload.status; // 'done' | 'failed'
    const videoUrl = payload.url;  // temporary Shotstack URL

    if (!renderId) {
      throw new Error('No render ID in callback');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: videoOrder, error: findError } = await supabase
      .from('video_orders')
      .select('id, song_id')
      .eq('shotstack_render_id', renderId)
      .single();

    if (findError || !videoOrder) {
      console.error('Video order not found for render:', renderId);
      throw new Error('Video order not found');
    }

    if (status === 'done' && videoUrl) {
      console.log('Persisting rendered video to storage...');

      let result;
      try {
        result = await storeRenderedVideo(
          `${videoOrder.song_id}.mp4`,
          videoUrl,
          supabase,
        );
      } catch (storeErr) {
        // Both upload paths failed. Do NOT save the temp Shotstack URL —
        // leave the order in `processing` so check-video-status can retry
        // on the next poll, and surface the error for debugging.
        console.error(
          `Permanent storage failed for video order ${videoOrder.id}:`,
          storeErr,
        );
        await supabase
          .from('video_orders')
          .update({
            error_message: `storage_failed: ${storeErr.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', videoOrder.id);

        return new Response(
          JSON.stringify({ received: true, persisted: false }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        );
      }

      await supabase
        .from('video_orders')
        .update({
          status: 'completed',
          video_url: result.publicUrl,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', videoOrder.id);

      await supabase
        .from('songs')
        .update({
          has_video: true,
          video_url: result.publicUrl,
        })
        .eq('id', videoOrder.song_id);

      console.log(
        `Video persisted via ${result.method} (${result.bytes} bytes): ${result.publicUrl}`,
      );
    } else if (status === 'failed') {
      const errorMessage = payload.error || 'Shotstack render failed';
      await supabase
        .from('video_orders')
        .update({
          status: 'failed',
          error_message: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', videoOrder.id);

      console.error('Video render failed:', errorMessage);
    }

    return new Response(
      JSON.stringify({ received: true, persisted: status === 'done' }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error) {
    console.error('Video callback error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 },
    );
  }
});
