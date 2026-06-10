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
    const body = await req.json();
    let { email } = body;
    const { couponCode, utm_source, utm_medium, utm_campaign, session_id, from_email_campaign, purchaseBoth, pricingTier, videoAddon, videoAddonCount: rawVideoAddonCount, karaokeAddon, fbc, fbp, clientUserAgent, affiliateCode } = body;
    const karaokeAddonBool: boolean = karaokeAddon === true || karaokeAddon === 'true';
    const KARAOKE_PRICE_CENTS = 799; // $7.99 — applied to the FIRST song in the order
    // Normalize to a count: supports new videoAddonCount (0/1/2) or legacy videoAddon boolean
    const videoAddonCountNum: number = typeof rawVideoAddonCount === 'number' ? rawVideoAddonCount
      : typeof rawVideoAddonCount === 'string' ? parseInt(rawVideoAddonCount) || 0
      : videoAddon ? 1 : 0;
    // Client IP for Meta Conversions API. Cloudflare/Vercel/Supabase set
    // x-forwarded-for to "<client>, <proxy>, ..." — first hop is the user.
    const xfwd = req.headers.get('x-forwarded-for') || '';
    const clientIp = xfwd.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || '';
    // Accept both songIds (array from frontend) and songId (legacy)
    const songIds: string[] = body.songIds || (body.songId ? [body.songId] : []);
    const songId = songIds[0];

    if (!songId) {
      throw new Error('Missing songId');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Defense in depth: if the frontend didn't send an email (e.g. the user
    // landed on /comparison via a shared link and React state was empty),
    // fall back to the email stored on the song record in the DB. Without
    // this, customers saw "Error al procesar el pago" and could not pay.
    if (!email) {
      const { data: songRow } = await supabase
        .from('songs')
        .select('email')
        .eq('id', songId)
        .single();
      email = songRow?.email;
      if (!email) {
        throw new Error('Missing email');
      }
      console.log('[create-checkout] Recovered email from song record', { songId });
    }

    // Pricing — framed as a growable bundle, base = 2 songs:
    //   1 song   → $29.99 (single, no bundle)
    //   2 songs  → $39.99 (default bundle — unchanged vs. legacy)
    //   3+ songs → $39.99 + $9.99 per song past the default bundle size
    //              (3=$49.98, 4=$59.97, 16=$179.85)
    // Integer cents throughout — Stripe expects cents, no FP rounding.
    const songCount = Math.max(1, songIds.length);
    let priceInCents;
    if (songCount === 1) {
      priceInCents = 2999;
    } else {
      priceInCents = 3999 + Math.max(0, songCount - 2) * 999;
    }
    const videoAddonCents = videoAddonCountNum === 2 ? 1799 : videoAddonCountNum === 1 ? 999 : 0;
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

    // Resolve affiliate: from explicit ref param OR from coupon code ownership
    let resolvedAffiliate = affiliateCode ? affiliateCode.toLowerCase().trim() : null;
    if (!resolvedAffiliate && appliedCoupon) {
      // Check if this coupon belongs to an affiliate
      const { data: couponAffiliate } = await supabase
        .from('affiliates')
        .select('code')
        .eq('coupon_code', appliedCoupon.code)
        .eq('active', true)
        .single();
      if (couponAffiliate) {
        resolvedAffiliate = couponAffiliate.code;
      }
    }

    // If we have a resolved affiliate, validate it actually exists & is active
    // (so a malicious caller can't poison affiliate_events with random codes)
    if (resolvedAffiliate) {
      const { data: validAffiliate } = await supabase
        .from('affiliates')
        .select('code')
        .eq('code', resolvedAffiliate)
        .eq('active', true)
        .single();
      if (!validAffiliate) {
        resolvedAffiliate = null;
      }
    }

    // Log a `checkout` event for this affiliate (real-time dashboard signal).
    // Idempotent per song so refreshes don't double-count.
    if (resolvedAffiliate) {
      const { data: existingCheckout } = await supabase
        .from('affiliate_events')
        .select('id')
        .eq('affiliate_code', resolvedAffiliate)
        .eq('event_type', 'checkout')
        .eq('song_id', songId)
        .maybeSingle();

      if (!existingCheckout) {
        await supabase.from('affiliate_events').insert({
          affiliate_code: resolvedAffiliate,
          event_type: 'checkout',
          song_id: songId,
          amount: null
        });
      }
    }

    // Purchase event is logged in stripe-webhook when payment completes

    // If FREE coupon, skip Stripe and mark as purchased
    if (priceInCents === 0 && appliedCoupon) {
      // Mark ALL songs as paid; only flag has_video_addon on the FIRST song
      // (one video upsell = one flagged song) to avoid duplicate video orders.
      for (let idx = 0; idx < songIds.length; idx++) {
        const sid = songIds[idx];
        const updatePayload: Record<string, unknown> = {
          paid: true,
          payment_status: 'paid',
          amount_paid: 0,
          coupon_code: appliedCoupon.code,
          paid_at: new Date().toISOString(),
          has_video_addon: videoAddonCountNum > 0,
          video_addon_count: videoAddonCountNum > 0 ? videoAddonCountNum : null,
          utm_source: utm_source || null,
          utm_medium: utm_medium || null,
          utm_campaign: utm_campaign || null,
          from_email_campaign: from_email_campaign || null,
          affiliate_code: resolvedAffiliate || null,
        };
        // Karaoke add-on: flag the FIRST song so fetch-karaoke knows to run.
        if (karaokeAddonBool && idx === 0) {
          updatePayload.karaoke_status = 'pending';
        }
        await supabase.from('songs').update(updatePayload).eq('id', sid);
      }
      // For free coupon orders that include karaoke, kick the Vercel worker
      // so the customer's instrumental is ready by the time they hit the
      // success page. Fire-and-forget — failures fall back to status='failed'.
      // Routes to Vercel (not Supabase) because the 195MB ZIP extraction
      // exceeds the Supabase Edge runtime's 256MB memory cap.
      if (karaokeAddonBool && songIds[0]) {
        const karaokeSecret = Deno.env.get('KARAOKE_TRIGGER_SECRET') || '';
        const vercelBase = Deno.env.get('VERCEL_BASE_URL') || 'https://regalosquecantan.com';
        if (karaokeSecret) {
          fetch(`${vercelBase}/api/karaoke-fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId: songIds[0], secret: karaokeSecret }),
          }).catch((err) => console.warn('[karaoke] free-path trigger failed:', err?.message || err));
        }
      }

      // Increment coupon usage
      await supabase
        .from('coupons')
        .update({ times_used: appliedCoupon.times_used + 1 })
        .eq('code', appliedCoupon.code);

      // Log a `purchase` event for free orders too (commission is $0 but the count matters)
      if (resolvedAffiliate) {
        await supabase.from('affiliate_events').insert({
          affiliate_code: resolvedAffiliate,
          event_type: 'purchase',
          song_id: songId,
          amount: 0
        });
      }

      // Return success URL - goes to /success page
      const allSongIds = songIds.join(',');
      return new Response(
        JSON.stringify({
          success: true,
          url: `${BASE_URL}/success?song_id=${allSongIds}&free=true`,
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
    const allSongIds = songIds.join(',');
    // Dynamic payment methods - uses Stripe Dashboard settings
    // Enables: Apple Pay, Google Pay, Amazon Pay, Cash App Pay, Link, Cards
    // Do NOT hardcode payment_method_types - let Stripe show the best options per device
    // Build line items
    const lineItems: any[] = [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: songCount > 1
              ? `${songCount} Canciones Personalizadas - RegalosQueCantan`
              : 'Canción Personalizada - RegalosQueCantan',
            description: songCount > 1
              ? `${songCount} canciones completas en MP3, descarga ilimitada`
              : 'Canción completa en MP3, descarga ilimitada',
            images: ['https://regalosquecantan.com/og-image.jpg'],
          },
          unit_amount: priceInCents,
        },
        quantity: 1,
      },
    ];

    // Add video addon as separate line item
    if (videoAddonCountNum > 0 && videoAddonCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: videoAddonCountNum >= 2
              ? '2 Videos Cinematográficos con Fotos (Ambas Canciones)'
              : 'Video Cinematográfico con Fotos',
            description: videoAddonCountNum >= 2
              ? '2 videos personalizados con efecto Ken Burns, HD 1080p, MP4 descargable'
              : 'Video personalizado con efecto Ken Burns, HD 1080p, MP4 descargable',
          },
          unit_amount: videoAddonCents,
        },
        quantity: 1,
      });
    }

    // Karaoke add-on — one flat line item per order ($7.99). Applies to the
    // first song. fetch-karaoke handles the actual stem extraction post-payment.
    if (karaokeAddonBool) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Pista Instrumental (sin voz)',
            description: 'La misma canción solo con la música, sin la voz. No incluye letras en pantalla ni video. MP3 calidad estudio, lista en ~1 minuto.',
          },
          unit_amount: KARAOKE_PRICE_CENTS,
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      line_items: lineItems,
      mode: 'payment',
      // 'es-419' = Latin American Spanish. Uses periods for decimals
      // ($29.99 instead of $29,99) which is what the Latino US/Mexico
      // market expects. 'es' defaults to Spain Spanish (comma decimals).
      locale: 'es-419',
      submit_type: 'pay',
      custom_text: {
        // Shown directly above the "Pay" button on Stripe Checkout. This is
        // the very last thing the customer reads before clicking — so it
        // does double duty: emotional reassurance + practical guarantees.
        // Stripe supports basic markdown (bold). Soft line breaks keep it
        // scannable on mobile where Stripe Checkout renders.
        submit: {
          message: '**Imagina su cara cuando la escuche por primera vez.** Esa pausa antes de las lágrimas. Esa sonrisa que no se va a borrar. Esa canción ya está hecha — con su nombre, su historia, su música. Y en 60 segundos, también es tuya.\n\n❤️ **Hecha solo para ellos** — no se vende en ningún otro lado\n✓ **Llega a tu correo al instante** — el enlace nunca expira\n✓ **Garantía total** — si algo no te encanta, lo arreglamos sin costo\n\nMás de 2,341 familias ya lloraron de emoción al escucharla. Hoy te toca a ti darles ese regalo.',
        },
        // Shown briefly after they hit Pay, before the redirect to /success.
        // Final emotional close — they already committed, this seals it.
        after_submit: {
          message: '🎵 Tu canción ya viene. Prepárate para escucharla.',
        },
      },
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}&song_id=${allSongIds}`,
      cancel_url: `${BASE_URL}/preview/${songId}`,
      metadata: {
        songId: allSongIds,
        email: email,
        couponCode: appliedCoupon?.code || '',
        utm_source: utm_source || '',
        utm_medium: utm_medium || '',
        utm_campaign: utm_campaign || '',
        session_id: session_id || '',
        from_email_campaign: from_email_campaign || '',
        purchaseBoth: (purchaseBoth || songCount >= 2) ? 'true' : 'false',
        songCount: String(songCount),
        videoAddon: videoAddonCountNum > 0 ? 'true' : 'false',
        videoAddonCount: String(videoAddonCountNum),
        karaokeAddon: karaokeAddonBool ? 'true' : 'false',
        affiliateCode: resolvedAffiliate || '',
        // Meta Conversions API identifiers — read by stripe-webhook on
        // checkout.session.completed. Stripe metadata cap is 500 chars/value.
        fbc: (fbc || '').slice(0, 500),
        fbp: (fbp || '').slice(0, 500),
        client_ip: (clientIp || '').slice(0, 100),
        client_user_agent: (clientUserAgent || '').slice(0, 500)
      }
    });

    // Save coupon and UTM attribution to all songs
    const songUpdate: Record<string, any> = {};
    if (appliedCoupon) songUpdate.coupon_code = appliedCoupon.code;
    if (utm_source) songUpdate.utm_source = utm_source;
    if (utm_medium) songUpdate.utm_medium = utm_medium;
    if (utm_campaign) songUpdate.utm_campaign = utm_campaign;
    if (from_email_campaign) songUpdate.from_email_campaign = from_email_campaign;
    if (resolvedAffiliate) songUpdate.affiliate_code = resolvedAffiliate;
    if (Object.keys(songUpdate).length > 0) {
      for (const sid of songIds) {
        await supabase.from('songs').update(songUpdate).eq('id', sid);
      }
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
