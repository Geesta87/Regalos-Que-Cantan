// supabase/functions/song-callback/index.ts
// Handles callbacks from Kie.ai when song generation completes
// Deploy with: supabase functions deploy song-callback

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Log the callback for debugging
    const body = await req.json();
    console.log('Kie.ai callback received:', JSON.stringify(body));

    // We're using polling in generate-song, so this callback is just for API compliance
    // In the future, we could use this to update song status in real-time

    return new Response(
      JSON.stringify({ success: true, message: 'Callback received' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Callback error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 // Return 200 even on error so Kie.ai doesn't retry
      }
    );
  }
});
