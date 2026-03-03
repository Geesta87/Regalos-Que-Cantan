// Supabase Edge Function: validate-coupon
// Deploy to: supabase/functions/validate-coupon/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code } = await req.json()
    
    if (!code) {
      return new Response(
        JSON.stringify({ valid: false, message: 'Código requerido' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Look up coupon in database
    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .eq('active', true)
      .single()

    if (error || !coupon) {
      return new Response(
        JSON.stringify({ valid: false, message: 'Código inválido o expirado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if expired
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ valid: false, message: 'Este código ha expirado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check usage limit
    if (coupon.max_uses && coupon.times_used >= coupon.max_uses) {
      return new Response(
        JSON.stringify({ valid: false, message: 'Este código ya alcanzó su límite de uso' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Return valid coupon
    return new Response(
      JSON.stringify({
        valid: true,
        coupon: {
          code: coupon.code,
          type: coupon.type, // 'percentage', 'fixed', or 'free'
          discount: coupon.discount, // percentage or fixed amount
          description: coupon.description
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Error:', err)
    return new Response(
      JSON.stringify({ valid: false, message: 'Error validando código' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
