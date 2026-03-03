// supabase/functions/create-checkout/index.ts
// Deploy with: supabase functions deploy create-checkout

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
    const { songId, email, couponCode } = await req.json();

    if (!songId || !email) {
      throw new Error('Missing songId or email');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Base price in cents ($19.99)
    let priceInCents = 1999;
    let appliedCoupon = null;

    // Validate and apply coupon if provided
    if (couponCode) {
      const { data: coupon, error: couponError } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', couponCode.toUpperCase().trim())
        .eq('active', true)
        .single();

      if (!couponError && coupon) {
        // Check if expired
        const isExpired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
        // Check usage limit
        const isMaxedOut = coupon.max_uses && coupon.times_used >= coupon.max_uses;

        if (!isExpired && !isMaxedOut) {
          appliedCoupon = coupon;

          // Apply discount
          if (coupon.type === 'free' || coupon.discount >= 100) {
            priceInCents = 0;
          } else if (coupon.type === 'percentage') {
            priceInCents = Math.round(priceInCents * (1 - coupon.discount / 100));
          } else if (coupon.type === 'fixed') {
            priceInCents = Math.max(0, priceInCents - (coupon.discount * 100));
          }
        }
      }
    }

    // If FREE coupon, skip Stripe and mark as purchased
    if (priceInCents === 0 && appliedCoupon) {
      // Mark song as paid
      await supabase
        .from('songs')
        .update({ 
          paid: true, 
          coupon_code: appliedCoupon.code,
          paid_at: new Date().toISOString()
        })
        .eq('id', songId);

      // Increment coupon usage
      await supabase
        .from('coupons')
        .update({ times_used: appliedCoupon.times_used + 1 })
        .eq('code', appliedCoupon.code);

      // Return success URL - goes to /success page
      return new Response(
        JSON.stringify({ 
          success: true, 
          url: `${BASE_URL}/success?song_id=${songId}&free=true`,
          free: true,
          message: '¡Canción gratis!'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    // Create Stripe Checkout Session for paid orders
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Canción Personalizada - RegalosQueCantan',
              description: 'Canción completa en MP3, descarga ilimitada',
              images: ['https://regalosquecantan.com/og-image.jpg'],
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}&song_id=${songId}`,
      cancel_url: `${BASE_URL}/preview/${songId}`,
      metadata: {
        songId: songId,
        email: email,
        couponCode: appliedCoupon?.code || ''
      },
      payment_intent_data: {
        metadata: {
          songId: songId,
          email: email
        }
      }
    });

    // If coupon was applied, save it to the song
    if (appliedCoupon) {
      await supabase
        .from('songs')
        .update({ coupon_code: appliedCoupon.code })
        .eq('id', songId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        sessionId: session.id,
        url: session.url,
        discounted: !!appliedCoupon,
        finalPrice: priceInCents / 100
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Checkout error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
