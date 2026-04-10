// supabase/functions/check-video-status/index.ts
// Deploy with: supabase functions deploy check-video-status
// Returns video order status to the frontend, plus a Shotstack fallback:
// if a render is stuck in `processing` we poll Shotstack directly, persist
// the rendered video to permanent storage, and update the order. The
// persistence logic is shared with video-callback (see _shared/store-video.ts).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { storeRenderedVideo } from '../_shared/store-video.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHOTSTACK_API_KEY = Deno.env.get('SHOTSTACK_API_KEY')!;
const SHOTSTACK_API_URL =
  Deno.env.get('SHOTSTACK_API_URL') || 'https://api.shotstack.io/edit/stage';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const videoOrderId = url.searchParams.get('videoOrderId');
    const songId = url.searchParams.get('songId');

    if (!videoOrderId && !songId) {
      throw new Error('Missing videoOrderId or songId');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query = supabase
      .from('video_orders')
      .select(
        'id, song_id, paid, status, video_url, error_message, aspect_ratio, photo_count, created_at, shotstack_render_id',
      );

    if (videoOrderId) {
      query = query.eq('id', videoOrderId);
    } else {
      query = query
        .eq('song_id', songId)
        .eq('paid', true)
        .order('created_at', { ascending: false });
    }

    const { data, error } = await query.single();

    if (error) {
      return new Response(
        JSON.stringify({ success: true, videoOrder: null }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      );
    }

    // ===== SHOTSTACK FALLBACK =====
    // If the order is stuck in `processing`, poll Shotstack directly. This
    // covers two cases:
    //   1. The webhook never fired.
    //   2. The webhook fired but storage upload failed (we now leave the
    //      order as `processing` with an error_message instead of saving
    //      a temp Shotstack URL).
    if (data.status === 'processing' && data.shotstack_render_id) {
      console.log(
        `Order ${data.id} stuck in processing — polling Shotstack render ${data.shotstack_render_id}`,
      );

      try {
        const shotstackRes = await fetch(
          `${SHOTSTACK_API_URL}/render/${data.shotstack_render_id}`,
          { headers: { 'x-api-key': SHOTSTACK_API_KEY } },
        );

        if (shotstackRes.ok) {
          const shotstackData = await shotstackRes.json();
          const renderStatus = shotstackData.response?.status;
          const renderUrl = shotstackData.response?.url;

          console.log(
            `Shotstack render status: ${renderStatus}, url: ${renderUrl}`,
          );

          if (renderStatus === 'done' && renderUrl) {
            // Persist to permanent storage. If this throws we leave the
            // order as `processing` so the next poll retries — we never
            // save the temp Shotstack URL anymore.
            try {
              const result = await storeRenderedVideo(
                `${data.song_id}.mp4`,
                renderUrl,
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
                .eq('id', data.id);

              await supabase
                .from('songs')
                .update({
                  has_video: true,
                  video_url: result.publicUrl,
                })
                .eq('id', data.song_id);

              data.status = 'completed';
              data.video_url = result.publicUrl;

              console.log(
                `Recovered via ${result.method} (${result.bytes} bytes): ${result.publicUrl}`,
              );
            } catch (storeErr) {
              console.error(
                `Storage upload failed for ${data.id}, will retry on next poll:`,
                storeErr,
              );
              await supabase
                .from('video_orders')
                .update({
                  error_message: `storage_failed: ${storeErr.message}`,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', data.id);
            }
          } else if (renderStatus === 'failed') {
            const errorMsg =
              shotstackData.response?.error || 'Shotstack render failed';
            console.error('Shotstack render failed:', errorMsg);

            await supabase
              .from('video_orders')
              .update({
                status: 'failed',
                error_message: errorMsg,
                updated_at: new Date().toISOString(),
              })
              .eq('id', data.id);

            data.status = 'failed';
            data.error_message = errorMsg;
          }
          // If still rendering on Shotstack, leave as processing — next poll retries.
        }
      } catch (shotstackError) {
        console.error('Shotstack fallback check error:', shotstackError);
      }
    }

    // Strip internal fields before returning to the client
    const { shotstack_render_id, song_id, ...responseData } = data;

    return new Response(
      JSON.stringify({ success: true, videoOrder: responseData }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    );
  } catch (error) {
    console.error('Check video status error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    );
  }
});
