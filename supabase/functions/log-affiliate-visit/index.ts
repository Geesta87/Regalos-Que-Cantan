// supabase/functions/log-affiliate-visit/index.ts
// Records a visit event for an affiliate code. Called from the frontend on first
// page load when ?ref= is present (deduped per session by the caller).

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
    const { affiliateCode } = await req.json();

    if (!affiliateCode) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing affiliateCode' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('code')
      .eq('code', affiliateCode.toLowerCase().trim())
      .eq('active', true)
      .single();

    if (!affiliate) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid affiliate' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    await supabase
      .from('affiliate_events')
      .insert({
        affiliate_code: affiliateCode.toLowerCase().trim(),
        event_type: 'visit'
      });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Log affiliate visit error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
