// supabase/functions/verify-payment/index.ts
// Fallback endpoint: verifies payment directly with Stripe API
// Called from the success page when webhook may have failed
// Deploy with: supabase functions deploy verify-payment

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { sessionId, songId } = await req.json();

    if (!sessionId || !songId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing sessionId or songId' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // First check if song is already marked as paid
    const { data: existingSong } = await supabase
      .from('songs')
      .select('id, paid')
      .eq('id', songId)
      .single();

    if (existingSong?.paid) {
      return new Response(
        JSON.stringify({ success: true, alreadyPaid: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Verify payment directly with Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({ success: false, error: 'Payment not completed', status: session.payment_status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Payment is confirmed by Stripe - update the database
    const updateData: Record<string, any> = {
      paid: true,
      paid_at: new Date().toISOString(),
      stripe_session_id: session.id,
      stripe_payment_id: session.payment_intent as string || null,
      payment_status: 'completed',
      amount_paid: (session.amount_total || 0) / 100
    };
    if (session.metadata?.videoAddon === 'true') {
      updateData.has_video_addon = true;
    }
    const { data: song, error: updateError } = await supabase
      .from('songs')
      .update(updateData)
      .eq('id', songId)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update song:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Database update failed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log('Payment verified and song marked as paid via fallback:', songId);

    return new Response(
      JSON.stringify({ success: true, verified: true, songId: song.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Verify payment error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
