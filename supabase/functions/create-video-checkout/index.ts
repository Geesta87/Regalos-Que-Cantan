// supabase/functions/create-video-checkout/index.ts
// Deploy with: supabase functions deploy create-video-checkout

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
const BASE_URL = Deno.env.get('BASE_URL') || 'https://regalosquecantan.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { songId, email } = await req.json();

    if (!songId) {
      throw new Error('Missing songId');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify the song exists and is paid
    const { data: song, error: songError } = await supabase
      .from('songs')
      .select('id, paid, recipient_name')
      .eq('id', songId)
      .single();

    if (songError || !song) {
      throw new Error('Song not found');
    }

    if (!song.paid) {
      throw new Error('Song must be purchased before adding video');
    }

    // Check if there's already a video order for this song
    const { data: existingOrder } = await supabase
      .from('video_orders')
      .select('id, status, stripe_session_id')
      .eq('song_id', songId)
      .single();

    if (existingOrder && existingOrder.status !== 'failed') {
      // Already has a video order
      return new Response(
        JSON.stringify({
          success: true,
          url: `${BASE_URL}/success?song_id=${songId}`,
          existing: true,
          message: 'Ya tienes un pedido de video para esta canción'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      );
    }

    // Create Stripe Checkout Session for video ($9.99)
    const sessionParams: any = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Video Musical Personalizado - RegalosQueCantan',
              description: 'Video con fotos y tu canción personalizada, efecto Ken Burns',
              images: ['https://regalosquecantan.com/og-image.jpg'],
            },
            unit_amount: 999, // $9.99
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}&song_id=${songId}&video=true`,
      cancel_url: `${BASE_URL}/success?song_id=${songId}`,
      metadata: {
        songId: songId,
        email: email || '',
        type: 'video_upsell'
      },
      payment_intent_data: {
        metadata: {
          songId: songId,
          email: email || '',
          type: 'video_upsell'
        }
      }
    };

    // Only add customer_email if provided
    if (email) {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Create video_order record in pending state
    const { error: insertError } = await supabase
      .from('video_orders')
      .insert({
        song_id: songId,
        status: 'pending',
        stripe_session_id: session.id,
        amount_cents: 999,
        paid: false
      });

    if (insertError) {
      console.error('Failed to create video order:', insertError);
      // Don't fail - the Stripe session was created, webhook will handle it
    }

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Video checkout error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
