// Supabase Edge Function: create-checkout (UPDATED with coupon support)
// Deploy to: supabase/functions/create-checkout/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@12.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { songId, email, couponCode } = await req.json()

    if (!songId || !email) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseKey)
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    // Get song details
    const { data: song, error: songError } = await supabase
      .from('songs')
      .select('*')
      .eq('id', songId)
      .single()

    if (songError || !song) {
      return new Response(
        JSON.stringify({ success: false, error: 'Song not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // Base price in cents
    let priceInCents = 1999 // $19.99 sale price
    let appliedCoupon = null

    // Validate and apply coupon if provided
    if (couponCode) {
      const { data: coupon, error: couponError } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', couponCode.toUpperCase().trim())
        .eq('active', true)
        .single()

      if (!couponError && coupon) {
        // Check if expired
        if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
          // Coupon expired, continue without discount
        } 
        // Check usage limit
        else if (coupon.max_uses && coupon.times_used >= coupon.max_uses) {
          // Coupon maxed out, continue without discount
        }
        else {
          appliedCoupon = coupon

          // Apply discount
          if (coupon.type === 'free' || coupon.discount === 100) {
            priceInCents = 0
          } else if (coupon.type === 'percentage') {
            priceInCents = Math.round(priceInCents * (1 - coupon.discount / 100))
          } else if (coupon.type === 'fixed') {
            priceInCents = Math.max(0, priceInCents - (coupon.discount * 100))
          }
        }
      }
    }

    // If FREE (coupon made it $0), skip Stripe and mark as purchased
    if (priceInCents === 0 && appliedCoupon) {
      // Mark song as paid
      await supabase
        .from('songs')
        .update({ 
          paid: true, 
          payment_status: 'completed',
          coupon_code: appliedCoupon.code,
          paid_at: new Date().toISOString()
        })
        .eq('id', songId)

      // Increment coupon usage
      await supabase.rpc('increment_coupon_usage', { coupon_code: appliedCoupon.code })

      // Return success with download URL (direct to thank-you page)
      const thankYouUrl = `${req.headers.get('origin') || 'https://regalosquecantan.com'}/thank-you?song_id=${songId}&free=true`
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          url: thankYouUrl,
          free: true,
          message: '¡Canción gratis aplicada!'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Canción personalizada para ${song.recipient_name}`,
              description: `${song.genre} - ${song.occasion}`,
              images: song.album_art ? [song.album_art] : [],
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${req.headers.get('origin') || 'https://regalosquecantan.com'}/thank-you?session_id={CHECKOUT_SESSION_ID}&song_id=${songId}`,
      cancel_url: `${req.headers.get('origin') || 'https://regalosquecantan.com'}/preview/${songId}`,
      metadata: {
        song_id: songId,
        coupon_code: appliedCoupon?.code || '',
      },
    })

    // If coupon was applied, log it
    if (appliedCoupon) {
      await supabase
        .from('songs')
        .update({ coupon_code: appliedCoupon.code })
        .eq('id', songId)
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        url: session.url,
        discounted: !!appliedCoupon,
        finalPrice: priceInCents / 100
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Checkout error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
