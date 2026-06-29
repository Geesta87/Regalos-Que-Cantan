// supabase/functions/log-affiliate-visit/index.ts
// Records a low-trust affiliate funnel event from the frontend:
//   - 'visit'        : first page load when ?ref= is present (deduped per session
//                      by the caller).
//   - 'song_created' : a song was successfully generated under this affiliate.
//                      Deduped server-side per (affiliate_code, song_id) so polling
//                      / re-renders / A-B takes can't inflate the count.
//
// SECURITY: this endpoint is public (anon key). It may ONLY ever write the two
// event types below. It must never accept 'purchase' or 'refund' (those carry
// money and are written exclusively by the trusted stripe-webhook), otherwise a
// caller could forge commission. `amount` is always null here.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Strict whitelist — see SECURITY note above. Never add money events here.
const ALLOWED_EVENT_TYPES = new Set(['visit', 'song_created']);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const affiliateCode = String(body?.affiliateCode || '').toLowerCase().trim();
    const eventType = String(body?.eventType || 'visit').toLowerCase().trim();
    const songId = body?.songId ? String(body.songId) : null;

    if (!affiliateCode) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing affiliateCode' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unsupported eventType' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('code')
      .eq('code', affiliateCode)
      .eq('active', true)
      .single();

    if (!affiliate) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid affiliate' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // song_created is deduped per (affiliate_code, song_id) so re-renders, status
    // polling, or the second A/B take don't double-count one creation.
    if (eventType === 'song_created' && songId) {
      const { data: existing } = await supabase
        .from('affiliate_events')
        .select('id')
        .eq('affiliate_code', affiliateCode)
        .eq('event_type', 'song_created')
        .eq('song_id', songId)
        .maybeSingle();
      if (existing) {
        return new Response(
          JSON.stringify({ success: true, deduped: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
    }

    await supabase
      .from('affiliate_events')
      .insert({
        affiliate_code: affiliateCode,
        event_type: eventType,
        song_id: eventType === 'song_created' ? songId : null,
        amount: null,
      });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Log affiliate event error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
