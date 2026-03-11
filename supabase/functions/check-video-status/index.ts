// supabase/functions/check-video-status/index.ts
// Deploy with: supabase functions deploy check-video-status

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const songId = url.searchParams.get('songId');

    if (!songId) {
      throw new Error('Missing songId parameter');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: videoOrder, error } = await supabase
      .from('video_orders')
      .select('id, song_id, status, video_url, photo_urls, photo_count, created_at, error_message')
      .eq('song_id', songId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !videoOrder) {
      return new Response(
        JSON.stringify({ videoOrder: null }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      );
    }

    return new Response(
      JSON.stringify({
        videoOrder: {
          id: videoOrder.id,
          song_id: videoOrder.song_id,
          status: videoOrder.status,
          video_url: videoOrder.video_url,
          photo_urls: videoOrder.photo_urls,
          photo_count: videoOrder.photo_count,
          error_message: videoOrder.error_message,
          created_at: videoOrder.created_at
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Check video status error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
