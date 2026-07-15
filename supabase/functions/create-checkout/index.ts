// supabase/functions/create-checkout/index.ts
// Deploy with: supabase functions deploy create-checkout

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';
import { moderateGiftText } from '../_shared/moderate.ts';

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

// Gift-SMS add-on ($5) — bundled into the main checkout so the buyer pays once.
const GIFT_PRICE_CENTS = 500;
function giftToE164(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}
function jsonResp(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // ─── 3-song pack ("Paquete de 3 canciones", $49.99) ──────────────────────
    // A standalone purchase with NO song yet: the buyer pays once and receives a
    // personal NOMBRE-### code worth 3 free single-song redemptions, minted +
    // emailed by stripe-webhook on payment. Returns early — none of the
    // song-checkout logic below applies (there is no songId).
    if (body.pack === 'pack3') {
      const packEmail = String(body.email || '').trim().toLowerCase();
      const packName = String(body.buyerName || '').trim().slice(0, 40);
      if (!packEmail || !packEmail.includes('@')) {
        return jsonResp(400, { error: 'pack_missing_email', message: 'Necesitamos un correo válido para enviarte el código.' });
      }
      const PACK3_PRICE_CENTS = 4999; // $49.99 — 3 songs (~$16.66 each)
      const packSession = await stripe.checkout.sessions.create({
        customer_email: packEmail,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Paquete de 3 Canciones - RegalosQueCantan',
              description: 'Un código personal para crear 3 canciones personalizadas — una para cada persona, cuando tú quieras.',
              images: ['https://regalosquecantan.com/og-image.jpg'],
            },
            unit_amount: PACK3_PRICE_CENTS,
          },
          quantity: 1,
        }],
        mode: 'payment',
        locale: 'es-419',
        submit_type: 'pay',
        custom_text: {
          submit: {
            message: '**3 canciones, un solo pago.** Recibes tu código por correo al instante y lo usas cuando quieras — una canción distinta para cada ser querido. Tu código no caduca pronto (12 meses) y cada canción incluye preview antes de quedar lista.',
          },
        },
        success_url: `${BASE_URL}/pack-listo?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/tienda`,
        metadata: {
          type: 'pack3',
          email: packEmail,
          buyer_name: packName,
        },
      });
      return jsonResp(200, { success: true, url: packSession.url });
    }

    let { email } = body;
    const { couponCode, utm_source, utm_medium, utm_campaign, session_id, from_email_campaign, purchaseBoth, pricingTier, videoAddon, videoAddonCount: rawVideoAddonCount, karaokeAddon, lyricVideoAddon, karaokeVideoAddon, fbc, fbp, ttclid, ttp, clientUserAgent, affiliateCode } = body;
    // Gift-SMS add-on payload (optional): { recipient_name, recipient_phone,
    // buyer_name, personal_message, send_at (ISO UTC), buyer_timezone, attestation }
    const giftRaw = body.giftSms || null;
    const karaokeAddonBool: boolean = karaokeAddon === true || karaokeAddon === 'true';
    const KARAOKE_PRICE_CENTS = 799;        // $7.99 — one instrumental MP3
    const KARAOKE_BUNDLE_PRICE_CENTS = 1499; // $14.99 — both instrumentals (2-song order)
    // Phase 4 music-video upsells — synced lyric video + karaoke video (no voice).
    // $9.99 each, applied to the FIRST song. Distinct from karaokeAddon (the
    // instrumental MP3) and from videoAddon (the photo slideshow).
    const lyricVideoBool: boolean = lyricVideoAddon === true || lyricVideoAddon === 'true';
    const karaokeVideoBool: boolean = karaokeVideoAddon === true || karaokeVideoAddon === 'true';
    const LYRIC_VIDEO_PRICE_CENTS = 999;   // $9.99
    const KARAOKE_VIDEO_PRICE_CENTS = 999; // $9.99
    // Normalize to a count: supports new videoAddonCount (0/1/2) or legacy videoAddon boolean
    const videoAddonCountNum: number = typeof rawVideoAddonCount === 'number' ? rawVideoAddonCount
      : typeof rawVideoAddonCount === 'string' ? parseInt(rawVideoAddonCount) || 0
      : videoAddon ? 1 : 0;
    // Animado (animated story-video upsell). 0 = none, 1 = one video, 2 = both songs.
    // Premium tier, distinct from the photo-slideshow videoAddon. Fulfilled by the
    // story-video pipeline (confirm-animado-order creates the order post-payment).
    const animadoCount: number = typeof body.animadoCount === 'number' ? body.animadoCount
      : typeof body.animadoCount === 'string' ? parseInt(body.animadoCount) || 0 : 0;
    const ANIMADO_ONE_CENTS = 2900;   // $29.00 — one animated video (beta price)
    const ANIMADO_BOTH_CENTS = 4499;  // $44.99 — both songs animated (bundle)
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

    // Per-song instrumental selection. The frontend may pass karaokeSongIds —
    // the subset of songs the customer wants an instrumental for (e.g. one or
    // both songs of a 2-pack). Legacy single-toggle clients send only
    // karaokeAddon=true, so we fall back to the first song.
    const rawKaraokeIds: string[] = Array.isArray(body.karaokeSongIds)
      ? body.karaokeSongIds.filter((id: string) => songIds.includes(id))
      : [];
    const effectiveKaraokeIds: string[] = karaokeAddonBool
      ? (rawKaraokeIds.length ? rawKaraokeIds : [songIds[0]])
      : [];

    // Which song(s) get the Animado video. count 2 = both; count 1 = the chosen
    // one (animadoSongIds from the frontend, fallback to the first song).
    const rawAnimadoIds: string[] = Array.isArray(body.animadoSongIds)
      ? body.animadoSongIds.filter((id: string) => songIds.includes(id))
      : [];
    const effectiveAnimadoIds: string[] = animadoCount >= 2 ? songIds
      : animadoCount === 1 ? (rawAnimadoIds.length ? [rawAnimadoIds[0]] : [songIds[0]])
      : [];
    const animadoCents = animadoCount >= 2 ? ANIMADO_BOTH_CENTS : animadoCount === 1 ? ANIMADO_ONE_CENTS : 0;

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

        // Single-song codes (e.g. the 3-pack redemption code) may only be
        // applied to a 1-song order — otherwise one use of a 100%-off code
        // would free an entire multi-song cart. Hard-block so it can never
        // be exploited; the buyer redeems one song at a time.
        if (coupon.single_song_only && songCount > 1) {
          return jsonResp(400, { error: 'coupon_single_song', message: 'Este código es para una canción a la vez. Crea cada canción por separado y aplica el código en cada una.' });
        }

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
        // Karaoke add-on: flag each song the customer chose an instrumental for.
        if (effectiveKaraokeIds.includes(sid)) {
          updatePayload.karaoke_status = 'pending';
        }
        // Music-video add-ons: flag the FIRST song for render-lyric-video.
        if (lyricVideoBool && idx === 0) {
          updatePayload.lyric_video_status = 'pending';
        }
        if (karaokeVideoBool && idx === 0) {
          updatePayload.karaoke_video_status = 'pending';
        }
        await supabase.from('songs').update(updatePayload).eq('id', sid);
      }
      // For free coupon orders that include karaoke, kick the Vercel worker
      // so the customer's instrumental is ready by the time they hit the
      // success page. Fire-and-forget — failures fall back to status='failed'.
      // Routes to Vercel (not Supabase) because the 195MB ZIP extraction
      // exceeds the Supabase Edge runtime's 256MB memory cap.
      if (effectiveKaraokeIds.length) {
        const karaokeSecret = Deno.env.get('KARAOKE_TRIGGER_SECRET') || '';
        const vercelBase = Deno.env.get('VERCEL_BASE_URL') || 'https://regalosquecantan.com';
        if (karaokeSecret) {
          for (const ksid of effectiveKaraokeIds) {
            fetch(`${vercelBase}/api/karaoke-fetch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ songId: ksid, secret: karaokeSecret }),
            }).catch((err) => console.warn('[karaoke] free-path trigger failed:', err?.message || err));
          }
        }
      }

      // Free-path music-video triggers — fire-and-forget render-lyric-video.
      if ((lyricVideoBool || karaokeVideoBool) && songIds[0]) {
        const karaokeSecret = Deno.env.get('KARAOKE_TRIGGER_SECRET') || '';
        const vercelBase = Deno.env.get('VERCEL_BASE_URL') || 'https://regalosquecantan.com';
        if (karaokeSecret) {
          if (lyricVideoBool) {
            fetch(`${vercelBase}/api/render-lyric-video`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ songId: songIds[0], mode: 'lyric', secret: karaokeSecret }),
            }).catch((err) => console.warn('[lyric-video] free-path trigger failed:', err?.message || err));
          }
          if (karaokeVideoBool) {
            fetch(`${vercelBase}/api/render-lyric-video`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ songId: songIds[0], mode: 'karaoke', secret: karaokeSecret }),
            }).catch((err) => console.warn('[karaoke-video] free-path trigger failed:', err?.message || err));
          }
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

      // Gift-SMS add-on on a FREE (100% coupon) order. This path skips Stripe +
      // the webhook (where the PAID path creates the gift), so we validate +
      // moderate + create the scheduled gift row here. The $5 is comped along
      // with the free order (amount_cents 0). Wrapped so a gift failure never
      // blocks the (already-free) order.
      if (giftRaw && (giftRaw.enabled === true || giftRaw.recipient_phone)) {
        try {
          const gPhone = giftToE164(String(giftRaw.recipient_phone || ''));
          const gBuyer = String(giftRaw.buyer_name || '').trim();
          const gMsg = String(giftRaw.personal_message || '').trim().slice(0, 300);
          const gName = String(giftRaw.recipient_name || '').trim();
          const gSendMs = Date.parse(giftRaw.send_at || '');
          const timeOk = !Number.isNaN(gSendMs) && gSendMs > Date.now() + 2 * 60 * 1000;
          if (gPhone && gBuyer && giftRaw.attestation === true && timeOk) {
            const verdict = await moderateGiftText({ message: gMsg, recipientName: gName, senderName: gBuyer });
            if (verdict.allowed) {
              // Dedupe (no Stripe session id here): skip if the same gift exists.
              const { data: existingGift } = await supabase
                .from('scheduled_gift_messages')
                .select('id')
                .eq('song_id', songIds[0])
                .eq('recipient_phone', gPhone)
                .in('status', ['scheduled', 'processing', 'sent'])
                .maybeSingle();
              if (!existingGift) {
                await supabase.from('scheduled_gift_messages').insert({
                  song_id: songIds[0],
                  buyer_email: email || null,
                  buyer_name: gBuyer,
                  recipient_name: gName || null,
                  recipient_phone: gPhone,
                  personal_message: gMsg || null,
                  send_at: new Date(gSendMs).toISOString(),
                  buyer_timezone: String(giftRaw.buyer_timezone || '').slice(0, 64) || null,
                  status: 'scheduled',
                  moderation_status: 'approved',
                  amount_cents: 0,
                  attestation_accepted: true,
                  marketing_excluded: true,
                });
                console.log('✅ [create-checkout free-path] scheduled gift for song', songIds[0]);
              }
            } else {
              console.warn('[create-checkout free-path gift] message rejected by moderation; skipping gift');
            }
          } else {
            console.warn('[create-checkout free-path gift] incomplete gift fields; skipping');
          }
        } catch (giftErr) {
          console.error('[create-checkout free-path gift] failed:', giftErr instanceof Error ? giftErr.message : giftErr);
        }
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

    // Animado add-on — $29 one video / $44.99 both songs. The story-video
    // pipeline fulfills it post-payment (confirm-animado-order on the success page).
    if (animadoCount > 0 && animadoCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: animadoCount >= 2
              ? 'Película Animada — Ambas Canciones'
              : 'Película Animada (Edición Premium)',
            description: animadoCount >= 2
              ? 'Las 2 canciones convertidas en películas animadas estilo Pixar, con su rostro y su historia, HD descargable'
              : 'Su canción convertida en película animada estilo Pixar — su rostro, su historia, con movimiento, HD descargable',
          },
          unit_amount: animadoCents,
        },
        quantity: 1,
      });
    }

    // Karaoke add-on — $7.99 per instrumental. A 2-song order can buy an
    // instrumental for one or both songs (effectiveKaraokeIds), so quantity
    // scales with how many were chosen. fetch-karaoke runs per song post-payment.
    if (effectiveKaraokeIds.length) {
      const karaokeQty = effectiveKaraokeIds.length;
      // 1 instrumental = $7.99; both = $14.99 bundle. One line item carrying the
      // total (quantity 1) so the bundle discount shows as a single price.
      const karaokeTotalCents = karaokeQty >= 2 ? KARAOKE_BUNDLE_PRICE_CENTS : KARAOKE_PRICE_CENTS;
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: karaokeQty > 1
              ? `${karaokeQty} Pistas Instrumentales (sin voz)`
              : 'Pista Instrumental (sin voz)',
            description: 'La misma canción solo con la música, sin la voz. No incluye letras en pantalla ni video. MP3 calidad estudio, lista en ~1 minuto.',
          },
          unit_amount: karaokeTotalCents,
        },
        quantity: 1,
      });
    }

    // Lyric video add-on ($9.99) — full song video with synced highlighted
    // lyrics. render-lyric-video (Vercel) builds it post-payment.
    if (lyricVideoBool) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Video con Letra',
            description: 'Tu canción completa en video vertical, con la letra apareciendo e iluminándose al ritmo de la música. MP4 HD, listo para compartir.',
          },
          unit_amount: LYRIC_VIDEO_PRICE_CENTS,
        },
        quantity: 1,
      });
    }

    // Karaoke video add-on ($9.99) — same lyric video but with the voice
    // removed (instrumental audio). render-lyric-video mode='karaoke'.
    if (karaokeVideoBool) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Video Karaoke (sin voz)',
            description: 'El mismo video con letra en pantalla pero sin la voz — para que lo canten ustedes. MP4 HD vertical.',
          },
          unit_amount: KARAOKE_VIDEO_PRICE_CENTS,
        },
        quantity: 1,
      });
    }

    // ---- Gift-SMS add-on ($5): validate + MODERATE before creating the session ----
    // The gift rides along with the song payment, so we screen the message here,
    // pre-charge. A rejection blocks only the gift (the buyer can uncheck it and
    // still buy the song); it never silently sends an abusive text.
    let giftMeta: Record<string, string> = { gift_sms: 'false' };
    if (giftRaw && (giftRaw.enabled === true || giftRaw.recipient_phone)) {
      const gPhone = giftToE164(String(giftRaw.recipient_phone || ''));
      const gBuyer = String(giftRaw.buyer_name || '').trim();
      const gMsg = String(giftRaw.personal_message || '').trim().slice(0, 300);
      const gName = String(giftRaw.recipient_name || '').trim();
      const gTz = String(giftRaw.buyer_timezone || '').slice(0, 64);
      const gSendMs = Date.parse(giftRaw.send_at || '');
      if (!gPhone) return jsonResp(400, { error: 'gift_invalid_phone', message: 'El número del destinatario no es válido.' });
      if (!gBuyer) return jsonResp(400, { error: 'gift_missing_buyer', message: 'Falta tu nombre para el regalo.' });
      if (giftRaw.attestation !== true) return jsonResp(400, { error: 'gift_attestation', message: 'Confirma que es un regalo bienvenido.' });
      if (Number.isNaN(gSendMs) || gSendMs < Date.now() + 2 * 60 * 1000) return jsonResp(400, { error: 'gift_bad_time', message: 'Elige una hora futura para el envío del regalo.' });

      const verdict = await moderateGiftText({ message: gMsg, recipientName: gName, senderName: gBuyer });
      if (!verdict.allowed) {
        return jsonResp(422, { error: 'gift_message_rejected', message: 'Tu mensaje de regalo no pasó la revisión. Por favor reescríbelo en un tono amable.' });
      }

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Envío sorpresa por mensaje',
            description: 'Programamos el envío de tu canción por mensaje el día y la hora que elegiste.',
          },
          unit_amount: GIFT_PRICE_CENTS,
        },
        quantity: 1,
      });
      giftMeta = {
        gift_sms: 'true',
        gift_song_id: songIds[0],
        gift_recipient_name: gName.slice(0, 100),
        gift_recipient_phone: gPhone,
        gift_buyer_name: gBuyer.slice(0, 100),
        gift_message: gMsg,
        gift_send_at: new Date(gSendMs).toISOString(),
        gift_tz: gTz,
      };
    }

    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      line_items: lineItems,
      mode: 'payment',
      // Save the card so the post-purchase one-tap upsell (Animado, instrumental,
      // gift) can charge it off-session without a second checkout. Creates a
      // Customer and marks the PaymentMethod reusable. Does NOT change this
      // checkout's price, line items, or customer-facing flow.
      customer_creation: 'always',
      payment_intent_data: { setup_future_usage: 'off_session' },
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
        // Animado upsell — read by confirm-animado-order on the success page.
        animadoCount: String(animadoCount),
        animadoSongIds: effectiveAnimadoIds.join(','),
        karaokeAddon: effectiveKaraokeIds.length ? 'true' : 'false',
        // Which song(s) get an instrumental — read per-song by stripe-webhook.
        karaokeSongIds: effectiveKaraokeIds.join(','),
        lyricVideoAddon: lyricVideoBool ? 'true' : 'false',
        karaokeVideoAddon: karaokeVideoBool ? 'true' : 'false',
        // Gift-SMS add-on — read by stripe-webhook to create the scheduled row
        // after payment. gift_sms='false' (the default) means no gift on this order.
        ...giftMeta,
        affiliateCode: resolvedAffiliate || '',
        // Meta Conversions API identifiers — read by stripe-webhook on
        // checkout.session.completed. Stripe metadata cap is 500 chars/value.
        fbc: (fbc || '').slice(0, 500),
        fbp: (fbp || '').slice(0, 500),
        // TikTok Events API identifiers — read by stripe-webhook to fire the
        // server-side CompletePayment. Same 500-char metadata cap as Meta's.
        ttclid: (ttclid || '').slice(0, 500),
        ttp: (ttp || '').slice(0, 500),
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
