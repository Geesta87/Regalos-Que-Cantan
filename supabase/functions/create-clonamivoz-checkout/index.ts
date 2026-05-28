// supabase/functions/create-clonamivoz-checkout/index.ts
//
// Creates a Stripe checkout session for the Clone Mi Voz tier ($69).
//
// Why a SEPARATE checkout function (not the main create-checkout)
// ---------------------------------------------------------------
// The main funnel's create-checkout has 700+ lines handling: coupons,
// affiliate attribution, video add-ons, karaoke add-ons, multi-song
// bundles, Meta CAPI fbc/fbp params, abandoned-cart UTMs, etc. None of
// that applies to /clonamivoz today.
//
// Keeping the Clone Mi Voz checkout isolated means:
//   - Zero risk of breaking the existing $29.99 funnel
//   - Clear, small surface area — easy to iterate on the new tier's
//     pricing, copy, upsells without spelunking through the main flow
//   - Different Stripe webhook → different price line, different metadata,
//     different post-payment behavior (we trigger Suno; main funnel
//     unlocks Mureka output that's already generated)
//
// Flow
// ----
//   1. Frontend has a cloned_voice_song_id in 'preview_ready' state
//      (preview generated, customer has heard themselves singing).
//   2. Frontend POSTs here with { cloned_voice_song_id, email }.
//   3. We look up the row, confirm state, create Stripe checkout session
//      with $69 inline price_data + metadata.
//   4. Update row to 'awaiting_payment', persist stripe_session_id.
//   5. Return { checkout_url } — frontend redirects.
//   6. After payment, clonamivoz-stripe-webhook fires
//      generate-cloned-voice-song with the customer's actual lyrics.
//
// Pricing model
// -------------
// $69 USD one-time. Set inline via price_data so we don't need a
// pre-created Stripe Product. To change the price, just edit
// PRICE_CENTS — no Stripe dashboard work needed.
//
// Auth
// ----
// verify_jwt = true. Frontend posts with the Supabase anon JWT, same
// pattern as the other clonamivoz functions.

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

// Launch price. Edit here to change the price — no Stripe dashboard work
// required. Always in USD cents.
const PRICE_CENTS = 6900; // $69.00 USD

interface RequestBody {
  cloned_voice_song_id?: string;
  email?: string;
  customer_email?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed', message: 'Use POST.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_body', message: 'Expected JSON body.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!body.cloned_voice_song_id) {
    return new Response(
      JSON.stringify({
        error: 'missing_cloned_voice_song_id',
        message: 'cloned_voice_song_id is required.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---------------- look up the row + sanity-check state ----------------
  const { data: row, error: loadError } = await supabase
    .from('cloned_voice_songs')
    .select(
      'id, status, paid, customer_email, recipient_name, occasion, genre_slug, title'
    )
    .eq('id', body.cloned_voice_song_id)
    .maybeSingle();

  if (loadError) {
    console.error('[create-clonamivoz-checkout] DB lookup failed:', loadError);
    return new Response(
      JSON.stringify({ error: 'db_error', message: loadError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!row) {
    return new Response(
      JSON.stringify({
        error: 'not_found',
        message: `No cloned_voice_songs row with id ${body.cloned_voice_song_id}.`,
      }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Already paid? Don't let them double-charge.
  if (row.paid) {
    return new Response(
      JSON.stringify({
        error: 'already_paid',
        message: 'Esta canción ya fue pagada.',
      }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Only let them check out from sensible states. They can retry from
  // preview_ready, awaiting_payment (abandoned earlier), or failed
  // (preview failed but they want to try again).
  const allowedStates = new Set(['preview_ready', 'awaiting_payment', 'failed']);
  if (!allowedStates.has(row.status)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_state',
        message: `Cannot start checkout from status='${row.status}'. Wait for the preview to finish.`,
      }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Customer email priority: explicit body field → row's stored email.
  // Stripe requires SOME email for the checkout session.
  const customerEmail =
    (body.email || body.customer_email || row.customer_email || '').trim().toLowerCase();
  if (!customerEmail || !customerEmail.includes('@')) {
    return new Response(
      JSON.stringify({
        error: 'email_required',
        message: 'Email del cliente es requerido para procesar el pago.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- create Stripe checkout session ----------------
  // Inline price_data so we don't depend on a pre-created Stripe Product.
  // Metadata carries the cloned_voice_song_id back to the webhook.
  const productName =
    `Canción con tu voz` +
    (row.recipient_name ? ` — para ${row.recipient_name}` : '');
  const productDescription = `Canción personalizada cantada en tu propia voz (${row.genre_slug || 'género personalizado'}).`;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: PRICE_CENTS,
            product_data: {
              name: productName,
              description: productDescription,
            },
          },
        },
      ],
      metadata: {
        tier: 'clonamivoz',
        cloned_voice_song_id: row.id,
      },
      payment_intent_data: {
        // Mirror metadata onto the PaymentIntent so refunds in Stripe
        // dashboard show what was bought without clicking through.
        metadata: {
          tier: 'clonamivoz',
          cloned_voice_song_id: row.id,
        },
      },
      success_url: `${BASE_URL}/clonamivoz?paid=1&song_id=${row.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/clonamivoz?cancelled=1&song_id=${row.id}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[create-clonamivoz-checkout] Stripe session create failed:', msg);
    return new Response(
      JSON.stringify({ error: 'stripe_error', message: msg }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- persist session + flip status ----------------
  const { error: updateError } = await supabase
    .from('cloned_voice_songs')
    .update({
      status: 'awaiting_payment',
      stripe_session_id: session.id,
      amount_cents: PRICE_CENTS,
      customer_email: customerEmail,
    })
    .eq('id', row.id);

  if (updateError) {
    console.warn(
      '[create-clonamivoz-checkout] Could not persist stripe_session_id (non-fatal):',
      updateError
    );
    // Still return the checkout URL — the webhook can recover via session
    // metadata even if our DB write fails.
  }

  return new Response(
    JSON.stringify({
      cloned_voice_song_id: row.id,
      stripe_session_id: session.id,
      checkout_url: session.url,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
