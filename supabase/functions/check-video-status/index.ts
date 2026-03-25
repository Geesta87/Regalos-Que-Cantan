// supabase/functions/check-video-status/index.ts
// Deploy with: supabase functions deploy check-video-status
// Includes Shotstack fallback — if callback missed, we check Shotstack directly
// and use Shotstack URL immediately, then trigger async upload to permanent storage

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHOTSTACK_API_KEY = Deno.env.get('SHOTSTACK_API_KEY')!;
const SHOTSTACK_API_URL = Deno.env.get('SHOTSTACK_API_URL') || 'https://api.shotstack.io/edit/stage';

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
      .select('id, song_id, paid, status, video_url, error_message, aspect_ratio, photo_count, created_at, shotstack_render_id');

    if (videoOrderId) {
      query = query.eq('id', videoOrderId);
    } else {
      query = query.eq('song_id', songId).eq('paid', true).order('created_at', { ascending: false });
    }

    const { data, error } = await query.single();

    if (error) {
      return new Response(
        JSON.stringify({ success: true, videoOrder: null }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // ===== SHOTSTACK FALLBACK: If stuck in "processing", check Shotstack directly =====
    if (data.status === 'processing' && data.shotstack_render_id) {
      console.log(`Video order ${data.id} stuck in processing — checking Shotstack render ${data.shotstack_render_id}`);

      try {
        const shotstackRes = await fetch(
          `${SHOTSTACK_API_URL}/render/${data.shotstack_render_id}`,
          {
            headers: { 'x-api-key': SHOTSTACK_API_KEY },
          }
        );

        if (shotstackRes.ok) {
          const shotstackData = await shotstackRes.json();
          const renderStatus = shotstackData.response?.status;
          const renderUrl = shotstackData.response?.url;

          console.log(`Shotstack render status: ${renderStatus}, url: ${renderUrl}`);

          if (renderStatus === 'done' && renderUrl) {
            // Callback was missed! Use the Shotstack URL directly for now.
            // This URL is temporary (~24h) but gives the user their video immediately.
            // Then fire-and-forget upload to permanent storage.
            console.log('Callback missed — saving Shotstack URL and triggering permanent upload...');

            // Update video order with Shotstack URL immediately
            await supabase
              .from('video_orders')
              .update({
                status: 'completed',
                video_url: renderUrl,
                updated_at: new Date().toISOString(),
              })
              .eq('id', data.id);

            // Update song table too
            await supabase
              .from('songs')
              .update({
                has_video: true,
                video_url: renderUrl,
              })
              .eq('id', data.song_id);

            data.status = 'completed';
            data.video_url = renderUrl;

            console.log('Video recovered with Shotstack URL:', renderUrl);

            // Fire-and-forget: trigger permanent upload in background
            // This calls video-callback with the render data to do the download+reupload
            try {
              fetch(`${SUPABASE_URL}/functions/v1/video-callback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: data.shotstack_render_id,
                  status: 'done',
                  url: renderUrl,
                }),
              }).catch(err => console.error('Background video-callback trigger failed:', err));
            } catch (e) {
              console.error('Failed to trigger background upload:', e);
            }

          } else if (renderStatus === 'failed') {
            const errorMsg = shotstackData.response?.error || 'Shotstack render failed';
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
          // If still "rendering" on Shotstack, leave as processing — next poll will check again
        }
      } catch (shotstackError) {
        // Don't fail the whole request — just log and return DB state
        console.error('Shotstack fallback check error:', shotstackError);
      }
    }

    // Remove internal fields from response
    const { shotstack_render_id, song_id, ...responseData } = data;

    return new Response(
      JSON.stringify({ success: true, videoOrder: responseData }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Check video status error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
