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
const SHOTSTACK_API_KEY = Deno.env.get('SHOTSTACK_API_KEY')!;
const SHOTSTACK_API_URL = Deno.env.get('SHOTSTACK_API_URL') || 'https://api.shotstack.io/edit/stage';

const MONTSERRAT_FONT_URL = 'https://fonts.gstatic.com/s/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Hw5aXo.woff2';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { videoOrderId, aspectRatio = '9:16', songDuration = null, videoFilter = null, messageUrl = null, messageDuration = null } = await req.json();

    if (!videoOrderId) {
      throw new Error('Missing videoOrderId');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get video order with photo URLs
    const { data: videoOrder, error: orderError } = await supabase
      .from('video_orders')
      .select('*')
      .eq('id', videoOrderId)
      .single();

    if (orderError || !videoOrder) {
      throw new Error('Video order not found');
    }

    if (!videoOrder.paid) {
      throw new Error('Video order not paid');
    }

    if (videoOrder.status !== 'photos_uploaded') {
      throw new Error(`Invalid status: ${videoOrder.status}. Expected photos_uploaded`);
    }

    const photoUrls: string[] = videoOrder.photo_urls || [];
    if (photoUrls.length < 3) {
      throw new Error('Need at least 3 photos');
    }

    // Get song details for text overlays and audio
    const { data: song, error: songError } = await supabase
      .from('songs')
      .select('audio_url, recipient_name, sender_name, occasion, genre')
      .eq('id', videoOrder.song_id)
      .single();

    if (songError || !song || !song.audio_url) {
      throw new Error('Song not found or missing audio');
    }

    // Use filter from request body, fallback to DB value, then default
    const filter = videoFilter || videoOrder.video_filter || 'boost';

    // Get message URL from request or DB
    const personalMessageUrl = messageUrl || videoOrder.message_url || null;

    // Build Shotstack timeline with filter + text overlays + optional message
    const timeline = buildShotstackTimeline(
      photoUrls,
      song,
      aspectRatio,
      songDuration,
      filter,
      personalMessageUrl,
      messageDuration
    );

    console.log('Shotstack timeline:', JSON.stringify(timeline, null, 2));

    // Submit render to Shotstack
    const renderResponse = await fetch(`${SHOTSTACK_API_URL}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': SHOTSTACK_API_KEY,
      },
      body: JSON.stringify(timeline),
    });

    if (!renderResponse.ok) {
      const errorText = await renderResponse.text();
      console.error('Shotstack error:', errorText);
      throw new Error(`Shotstack render failed: ${renderResponse.status}`);
    }

    const renderData = await renderResponse.json();
    const renderId = renderData.response?.id;

    if (!renderId) {
      throw new Error('No render ID returned from Shotstack');
    }

    // Update video order with render ID and status
    await supabase
      .from('video_orders')
      .update({
        status: 'processing',
        shotstack_render_id: renderId,
        aspect_ratio: aspectRatio,
        video_filter: filter,
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoOrderId);

    return new Response(
      JSON.stringify({
        success: true,
        videoOrderId,
        renderId,
        status: 'processing',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Generate video error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

// Build Shotstack JSON timeline with filter + text overlays + optional personal message
function buildShotstackTimeline(
  photoUrls: string[],
  song: { audio_url: string; recipient_name: string; sender_name: string; occasion: string; genre: string },
  aspectRatio: string,
  songDuration: number | null,
  videoFilter: string,
  personalMessageUrl: string | null = null,
  msgDuration: number | null = null
) {
  const photoCount = photoUrls.length;
  const transitionDuration = 0.5;
  const overlayDuration = 3; // text overlay duration in seconds

  // Photos fill the entire video — no separate title card gaps
  const targetDuration = songDuration
    ? Math.max(30, songDuration)
    : 210; // fallback ~3.5 min

  console.log(`Song duration: ${songDuration}s, target: ${targetDuration}s, photos: ${photoCount}, filter: ${videoFilter}`);

  // Calculate per-photo time to fill the song
  const rawPhotoTime = (targetDuration + (photoCount - 1) * transitionDuration) / photoCount;
  const photoDisplayTime = Math.min(60, Math.max(8, rawPhotoTime));

  // Actual total duration based on photo timing
  const totalDuration = photoCount * photoDisplayTime - (photoCount - 1) * transitionDuration;

  // Resolution based on aspect ratio
  const isPortrait = aspectRatio === '9:16';
  const resolution = isPortrait ? 'sd' : 'hd';
  const width = isPortrait ? 576 : 1280;
  const height = isPortrait ? 1024 : 720;

  // Ken Burns effects to cycle through
  const effects = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight', 'slideUp', 'slideDown'];

  // ---- TRACK 2 (bottom): Photo clips with filter ----
  const photoClips = photoUrls.map((url, index) => {
    const start = index * (photoDisplayTime - transitionDuration);
    return {
      asset: {
        type: 'image',
        src: url,
      },
      start,
      length: photoDisplayTime,
      effect: effects[index % effects.length],
      filter: videoFilter,
      transition: {
        in: 'fade',
        out: 'fade',
      },
      fit: 'crop',
    };
  });

  // ---- TRACK 1 (top): Text overlays ----
  const fontFace = `@font-face { font-family: 'Montserrat'; src: url('${MONTSERRAT_FONT_URL}') format('woff2'); }`;

  const openingOverlay = {
    asset: {
      type: 'html',
      html: `<p>Para: ${song.recipient_name}</p>`,
      css: `${fontFace} p { font-family: 'Montserrat', sans-serif; color: #ffffff; font-size: ${isPortrait ? 42 : 48}px; font-weight: 700; text-align: center; text-shadow: 0 2px 12px rgba(0,0,0,0.6); padding: 20px; }`,
      width,
      height,
    },
    start: 0,
    length: overlayDuration,
    transition: {
      in: 'fade',
      out: 'fade',
    },
  };

  const closingOverlay = {
    asset: {
      type: 'html',
      html: `<p>Hecho con amor &#x1F495;<br><span class="brand">regalosquecantan.com</span></p>`,
      css: `${fontFace} p { font-family: 'Montserrat', sans-serif; color: #ffffff; font-size: ${isPortrait ? 28 : 32}px; font-weight: 600; text-align: center; text-shadow: 0 2px 12px rgba(0,0,0,0.6); padding: 20px; } .brand { font-size: ${isPortrait ? 18 : 22}px; font-weight: 400; opacity: 0.8; }`,
      width,
      height,
    },
    start: Math.max(0, totalDuration - overlayDuration),
    length: overlayDuration,
    transition: {
      in: 'fade',
      out: 'fade',
    },
  };

  // ---- PERSONAL MESSAGE CLIP (optional) ----
  // Appended after the photo slideshow. Song fades out, message plays with its own audio.
  const messageDuration = msgDuration && msgDuration > 0 ? msgDuration + 2 : 15; // actual duration + 2s buffer
  const tracks = [];
  const messageClips = [];

  if (personalMessageUrl) {
    console.log('Adding personal message to timeline:', personalMessageUrl, 'duration:', messageDuration);

    // Personal video message — full video clip with boosted audio
    messageClips.push({
      asset: {
        type: 'video',
        src: personalMessageUrl,
        volume: 1,
        trim: 0,
        transcode: true,
      },
      start: totalDuration,
      length: messageDuration,
      fit: 'cover',
      transition: {
        in: 'fade',
      },
    });

    // "Un mensaje de [sender]" text at the bottom (brief)
    messageClips.push({
      asset: {
        type: 'html',
        html: `<p>Un mensaje de ${song.sender_name || 'alguien especial'} &#x1F495;</p>`,
        css: `${fontFace} p { font-family: 'Montserrat', sans-serif; color: #ffffff; font-size: ${isPortrait ? 22 : 26}px; font-weight: 600; text-align: center; text-shadow: 0 2px 12px rgba(0,0,0,0.8); padding: 20px; background: linear-gradient(0deg, rgba(0,0,0,0.6), transparent); }`,
        width,
        height: Math.round(height * 0.2),
      },
      start: totalDuration,
      length: 4,
      transition: { in: 'fade', out: 'fade' },
      position: 'bottom',
    });

    // Move closing overlay to after the message
    closingOverlay.start = totalDuration + messageDuration - overlayDuration;
  }

  // Build tracks
  tracks.push(
    // Track 1 (top): text overlays
    { clips: [openingOverlay, closingOverlay] },
    // Track 2: photo slideshow
    { clips: photoClips },
  );

  // Track 3: personal message (if exists)
  if (messageClips.length > 0) {
    tracks.splice(1, 0, { clips: messageClips });
  }

  // If personal message exists, use audio track instead of soundtrack
  // so the song fades out before the message plays
  if (personalMessageUrl) {
    // Add song as an audio clip that ends when photos end (with fade out)
    tracks.push({
      clips: [{
        asset: {
          type: 'audio',
          src: song.audio_url,
          volume: 1,
          effect: 'fadeOut',
        },
        start: 0,
        length: totalDuration,
      }],
    });
  }

  const timelineObj: any = { tracks };

  // Only use soundtrack when there's no personal message
  if (!personalMessageUrl) {
    timelineObj.soundtrack = {
      src: song.audio_url,
      effect: 'fadeOut',
    };
  }

  return {
    timeline: timelineObj,
    output: {
      format: 'mp4',
      resolution,
      aspectRatio,
      fps: 30,
    },
    callback: `${SUPABASE_URL}/functions/v1/video-callback`,
  };
}
