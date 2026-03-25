// supabase/functions/download-video/index.ts
// Proxy endpoint that streams a video with Content-Disposition: attachment
// so the browser auto-saves it instead of opening in a new tab.
// Works for both Supabase storage and Shotstack cross-origin URLs.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const videoUrl = url.searchParams.get('url');
    const filename = url.searchParams.get('filename') || 'video.mp4';

    if (!videoUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate URL is from allowed sources (security check)
    const allowedHosts = [
      'shotstack-api-v1-output.s3-ap-southeast-2.amazonaws.com',
      'yzbvajungshqcpusfiia.supabase.co',
      'cdn.shotstack.io',
    ];
    const parsedUrl = new URL(videoUrl);
    if (!allowedHosts.some(host => parsedUrl.hostname.includes(host))) {
      return new Response(JSON.stringify({ error: 'URL not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the video from the source — stream it, don't buffer
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch video: ${videoResponse.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Stream the video back with download headers
    const headers = new Headers({
      ...corsHeaders,
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    // Pass through content-length if available
    const contentLength = videoResponse.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    return new Response(videoResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Download video error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
