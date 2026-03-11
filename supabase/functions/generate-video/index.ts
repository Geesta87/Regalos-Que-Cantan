// supabase/functions/generate-video/index.ts
// Deploy with: supabase functions deploy generate-video

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHOTSTACK_API_KEY = Deno.env.get('SHOTSTACK_API_KEY');
const SHOTSTACK_ENV = Deno.env.get('SHOTSTACK_ENV') || 'stage'; // 'stage' or 'v1'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { videoOrderId } = await req.json();

    if (!videoOrderId) {
      throw new Error('Missing videoOrderId');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get the video order
    const { data: videoOrder, error: orderError } = await supabase
      .from('video_orders')
      .select('*, songs(audio_url, recipient_name, sender_name, occasion)')
      .eq('id', videoOrderId)
      .single();

    if (orderError || !videoOrder) {
      throw new Error('Video order not found');
    }

    if (!videoOrder.photo_urls || videoOrder.photo_urls.length === 0) {
      throw new Error('No photos uploaded yet');
    }

    // Update status to processing
    await supabase
      .from('video_orders')
      .update({ status: 'processing' })
      .eq('id', videoOrderId);

    const photoUrls = videoOrder.photo_urls;
    const audioUrl = videoOrder.songs?.audio_url;

    if (!audioUrl) {
      throw new Error('Song audio URL not found');
    }

    // Calculate duration per photo (aim for ~30 seconds total, or match audio)
    const durationPerPhoto = Math.max(3, Math.min(8, 30 / photoUrls.length));

    // Build Shotstack timeline with Ken Burns effect
    const clips = photoUrls.map((url: string, index: number) => ({
      asset: {
        type: 'image',
        src: url,
      },
      start: index * durationPerPhoto,
      length: durationPerPhoto + 0.5, // slight overlap for transition
      fit: 'cover',
      effect: index % 2 === 0 ? 'zoomIn' : 'zoomOut', // alternating Ken Burns
      transition: {
        in: index === 0 ? 'fade' : 'slideLeft',
        out: 'fade',
      },
    }));

    const totalDuration = photoUrls.length * durationPerPhoto;

    // Build the Shotstack render request
    const renderRequest = {
      timeline: {
        soundtrack: {
          src: audioUrl,
          effect: 'fadeOut',
        },
        tracks: [
          {
            clips: clips,
          },
        ],
      },
      output: {
        format: 'mp4',
        resolution: 'hd', // 1280x720
        aspectRatio: '16:9',
      },
    };

    if (!SHOTSTACK_API_KEY) {
      // No Shotstack key - simulate for testing
      console.warn('SHOTSTACK_API_KEY not set - simulating video generation');

      // Simulate by just updating the status after a delay
      await supabase
        .from('video_orders')
        .update({
          status: 'completed',
          video_url: audioUrl, // placeholder
          shotstack_render_id: 'simulated-' + Date.now()
        })
        .eq('id', videoOrderId);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Video generation simulated (no Shotstack API key)',
          videoOrderId
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      );
    }

    // Submit render to Shotstack
    const shotstackUrl = `https://api.shotstack.io/${SHOTSTACK_ENV}/render`;
    const renderResponse = await fetch(shotstackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': SHOTSTACK_API_KEY,
      },
      body: JSON.stringify(renderRequest),
    });

    if (!renderResponse.ok) {
      const errorText = await renderResponse.text();
      console.error('Shotstack error:', errorText);
      throw new Error(`Shotstack render failed: ${renderResponse.status}`);
    }

    const renderResult = await renderResponse.json();
    const renderId = renderResult.response?.id;

    if (!renderId) {
      throw new Error('No render ID returned from Shotstack');
    }

    // Save render ID for polling
    await supabase
      .from('video_orders')
      .update({
        shotstack_render_id: renderId,
        status: 'processing'
      })
      .eq('id', videoOrderId);

    // Start polling Shotstack for completion (in background)
    // We'll use a simple approach: poll and update
    pollShotstackRender(renderId, videoOrderId, supabase);

    return new Response(
      JSON.stringify({
        success: true,
        renderId,
        videoOrderId,
        message: 'Video generation started'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Generate video error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

// Poll Shotstack render status and update DB when complete
async function pollShotstackRender(
  renderId: string,
  videoOrderId: string,
  supabase: any
) {
  const maxAttempts = 60; // 5 minutes max
  const pollInterval = 5000; // 5 seconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    try {
      const statusUrl = `https://api.shotstack.io/${SHOTSTACK_ENV}/render/${renderId}`;
      const statusResponse = await fetch(statusUrl, {
        headers: {
          'x-api-key': SHOTSTACK_API_KEY!,
        },
      });

      if (!statusResponse.ok) continue;

      const statusResult = await statusResponse.json();
      const renderStatus = statusResult.response?.status;

      if (renderStatus === 'done') {
        const videoUrl = statusResult.response?.url;

        // Download video and upload to Supabase Storage
        const videoResponse = await fetch(videoUrl);
        const videoBlob = await videoResponse.blob();
        const videoBuffer = new Uint8Array(await videoBlob.arrayBuffer());

        const fileName = `${videoOrderId}.mp4`;
        const { error: uploadError } = await supabase.storage
          .from('videos')
          .upload(fileName, videoBuffer, {
            contentType: 'video/mp4',
            upsert: true
          });

        let finalVideoUrl = videoUrl;
        if (!uploadError) {
          const { data: publicUrl } = supabase.storage
            .from('videos')
            .getPublicUrl(fileName);
          finalVideoUrl = publicUrl.publicUrl;
        }

        await supabase
          .from('video_orders')
          .update({
            status: 'completed',
            video_url: finalVideoUrl,
          })
          .eq('id', videoOrderId);

        console.log('Video completed:', videoOrderId);
        return;
      }

      if (renderStatus === 'failed') {
        await supabase
          .from('video_orders')
          .update({
            status: 'failed',
            error_message: 'Video rendering failed',
          })
          .eq('id', videoOrderId);
        return;
      }

      // Still rendering, continue polling
    } catch (pollError) {
      console.error('Poll error:', pollError);
    }
  }

  // Timeout
  await supabase
    .from('video_orders')
    .update({
      status: 'failed',
      error_message: 'Video rendering timed out',
    })
    .eq('id', videoOrderId);
}
