// supabase/functions/clonamivoz-stripe-webhook/index.ts
//
// Stripe webhook for the Clone Mi Voz tier ONLY.
//
// Why a SEPARATE webhook (not the main stripe-webhook)
// ----------------------------------------------------
// CLAUDE.md §2 documents the 2026-04-17 outage where the main
// stripe-webhook was redeployed with wrong config + sync constructEvent,
// silently breaking every payment for hours. The lesson: keep webhook
// surface area small and isolated. This handler:
//   - Lives at a different Stripe webhook endpoint
//   - Has its own signing secret (STRIPE_CLONAMIVOZ_WEBHOOK_SECRET)
//   - Never touches public.songs or the main funnel
//   - If something breaks here, the main $29.99 funnel is unaffected
//
// CRITICAL RULES (CLAUDE.md §3)
// -----------------------------
//   - constructEventAsync, NOT constructEvent (sync crypto throws in Deno)
//   - verify_jwt = false (Stripe doesn't attach Supabase JWTs)
//   - Both pinned in supabase/config.toml in the SAME commit as this file
//
// Flow
// ----
//   1. Customer pays via /create-clonamivoz-checkout's Stripe session.
//   2. Stripe POSTs checkout.session.completed here.
//   3. We verify the signature (constructEventAsync).
//   4. Read metadata.cloned_voice_song_id, look up the row.
//   5. Mark row paid + flip status to 'paid'.
//   6. Trigger generate-cloned-voice-song (server-to-server) which fires
//      the full Suno generation with the customer's actual lyrics.
//   7. The frontend's polling on cloned-voice-status will surface
//      'generating_song' → 'success' after this.
//
// Setup steps (you do these in Stripe Dashboard ONCE)
// ---------------------------------------------------
//   1. Stripe → Developers → Webhooks → Add endpoint
//   2. URL: https://yzbvajungshqcpusfiia.supabase.co/functions/v1/clonamivoz-stripe-webhook
//   3. Listen for: checkout.session.completed
//   4. Copy the "Signing secret" (starts with whsec_)
//   5. Set Supabase secret: STRIPE_CLONAMIVOZ_WEBHOOK_SECRET=whsec_...

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';
import {
  sendClonedVoicePaidEmail,
  sendClonedVoiceDeliveryEmail,
} from '../_shared/cloned-voice-delivery.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_CLONAMIVOZ_WEBHOOK_SECRET')!;

// Where to call generate-cloned-voice-song from (server-to-server).
const GENERATE_SONG_URL = `${SUPABASE_URL}/functions/v1/generate-cloned-voice-song`;

// Meta CAPI (2026-08-27): $69 Clona Mi Voz purchases were invisible to ad
// optimization — the main funnel's CAPI lives in stripe-webhook only.
// Same env conventions as stripe-webhook; missing config = safe no-op.
const META_PIXEL_ID = Deno.env.get('META_PIXEL_ID') || '';
const META_CAPI_ACCESS_TOKEN =
  Deno.env.get('META_CAPI_ACCESS_TOKEN') ||
  Deno.env.get('META_ACCESS_TOKEN') ||
  Deno.env.get('META_CONVERSIONS_API_TOKEN') ||
  '';
const META_TEST_EVENT_CODE = Deno.env.get('META_TEST_EVENT_CODE') || '';

async function metaHash(value: string): Promise<string> {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return '';
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Server-side Purchase event for a Clona Mi Voz sale. NEVER throws — a
// tracking failure must not 4xx the webhook. event_id = Stripe session id
// so a future browser pixel event dedupes cleanly (the /clonamivoz page
// fires no Purchase pixel today, so this is the only source).
async function sendClonamivozCAPIPurchase(args: {
  sessionId: string;
  email: string | null | undefined;
  buyerName?: string | null;
  amountUsd: number;
  clonedVoiceSongId: string;
  recipientName?: string | null;
}): Promise<void> {
  if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
    console.log('[clonamivoz-capi] skipped — META_PIXEL_ID or token not set');
    return;
  }
  try {
    const userData: Record<string, unknown> = {};
    if (args.email) {
      const emHash = await metaHash(args.email);
      userData.em = [emHash];
      userData.external_id = [emHash];
    }
    const nameParts = (args.buyerName || '').trim().split(/\s+/).filter(Boolean);
    if (nameParts.length) {
      userData.fn = [await metaHash(nameParts[0])];
      if (nameParts.length > 1) userData.ln = [await metaHash(nameParts[nameParts.length - 1])];
    }

    const payload: Record<string, unknown> = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: args.sessionId,
        action_source: 'website',
        event_source_url: 'https://regalosquecantan.com/clonamivoz',
        user_data: userData,
        custom_data: {
          currency: 'USD',
          value: args.amountUsd,
          content_type: 'product',
          content_ids: [args.clonedVoiceSongId],
          num_items: 1,
          content_name: args.recipientName
            ? `Clona Mi Voz para ${args.recipientName}`
            : 'Clona Mi Voz',
        },
      }],
    };
    if (META_TEST_EVENT_CODE) (payload as any).test_event_code = META_TEST_EVENT_CODE;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    let resp: Response;
    try {
      resp = await fetch(
        `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_CAPI_ACCESS_TOKEN)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        }
      );
    } finally {
      clearTimeout(t);
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[clonamivoz-capi] non-2xx ${resp.status}: ${errText.slice(0, 300)}`);
      return;
    }
    const json = await resp.json().catch(() => ({}));
    console.log(
      `[clonamivoz-capi] Purchase sent — session=${args.sessionId} value=${args.amountUsd} events_received=${(json as any)?.events_received ?? '?'}`
    );
  } catch (err) {
    console.error('[clonamivoz-capi] threw:', err instanceof Error ? err.message : err);
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[clonamivoz-stripe-webhook] STRIPE_CLONAMIVOZ_WEBHOOK_SECRET not set');
    return new Response('Webhook secret not configured', { status: 500 });
  }

  // ---------------- verify signature (ASYNC variant — CLAUDE.md §3.1) ----------
  let event: Stripe.Event;
  const body = await req.text();
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[clonamivoz-stripe-webhook] Signature verification failed:', msg);
    return new Response(`Webhook signature verification failed: ${msg}`, { status: 400 });
  }

  console.log('[clonamivoz-stripe-webhook] event:', event.type, event.id);

  // We only care about successful checkout completions. Other event
  // types (refunds, disputes) can be added later.
  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const metadata = session.metadata || {};

  // Defensive: only handle our own tier. The Stripe webhook URL is
  // dedicated to us, but belt + suspenders.
  if (metadata.tier !== 'clonamivoz') {
    console.warn('[clonamivoz-stripe-webhook] Wrong tier in metadata, ignoring:', metadata.tier);
    return new Response(JSON.stringify({ received: true, ignored: 'wrong_tier' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const clonedVoiceSongId = metadata.cloned_voice_song_id;
  if (!clonedVoiceSongId) {
    console.error(
      '[clonamivoz-stripe-webhook] No cloned_voice_song_id in metadata:',
      session.id
    );
    return new Response('Missing cloned_voice_song_id in session metadata', {
      status: 400,
    });
  }

  // Stripe's checkout.session.completed fires when payment is collected.
  // payment_status should be 'paid'. (For card payments it always is.
  // For ACH/wire it can be 'unpaid' until cleared — we'd never use those.)
  if (session.payment_status !== 'paid') {
    console.warn(
      '[clonamivoz-stripe-webhook] Session completed but payment_status is',
      session.payment_status,
      'for',
      clonedVoiceSongId
    );
    return new Response(
      JSON.stringify({ received: true, ignored: 'not_paid', payment_status: session.payment_status }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---------------- load the row + idempotency check ----------------
  const { data: row, error: loadError } = await supabase
    .from('cloned_voice_songs')
    .select(
      'id, status, paid, voice_sample_id, recipient_name, occasion, relationship, story, genre_slug, language, title, lyrics, emotional_modifiers, lyrics_model_used, customer_email, vocal_gender, suno_audio_urls, permanent_audio_urls, delivery_email_sent_at'
    )
    .eq('id', clonedVoiceSongId)
    .maybeSingle();

  if (loadError) {
    console.error('[clonamivoz-stripe-webhook] DB lookup failed:', loadError);
    return new Response(`DB error: ${loadError.message}`, { status: 500 });
  }
  if (!row) {
    console.error('[clonamivoz-stripe-webhook] No row found for', clonedVoiceSongId);
    // Return 200 so Stripe doesn't retry forever; the row should always
    // exist by the time payment completes.
    return new Response(
      JSON.stringify({ received: true, error: 'row_not_found' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Idempotency: Stripe can re-deliver webhooks. If we already marked
  // paid, just acknowledge and don't trigger another Suno generation.
  if (row.paid) {
    console.log(
      '[clonamivoz-stripe-webhook] Already paid, skipping re-trigger:',
      clonedVoiceSongId
    );
    return new Response(
      JSON.stringify({ received: true, already_paid: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- mark paid ----------------
  const paidAtIso = new Date().toISOString();
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { error: paidUpdateError } = await supabase
    .from('cloned_voice_songs')
    .update({
      paid: true,
      paid_at: paidAtIso,
      status: 'paid',
      stripe_payment_intent: paymentIntentId,
      // Refresh email in case it changed in checkout vs what we had.
      customer_email: session.customer_email || row.customer_email,
    })
    .eq('id', clonedVoiceSongId);

  if (paidUpdateError) {
    console.error(
      '[clonamivoz-stripe-webhook] Failed to mark paid:',
      paidUpdateError
    );
    return new Response(`DB error marking paid: ${paidUpdateError.message}`, {
      status: 500,
    });
  }

  // ---------------- Meta CAPI Purchase (fire-and-forget) ----------------
  await sendClonamivozCAPIPurchase({
    sessionId: session.id,
    email: session.customer_email || row.customer_email,
    buyerName: session.customer_details?.name || null,
    amountUsd: (session.amount_total ?? 6900) / 100,
    clonedVoiceSongId,
    recipientName: row.recipient_name,
  });

  // ---------------- INSTANT UNLOCK (pre-pay full-render model) ----------
  // Since 2026-08-27 the "preview" render IS the complete song (the
  // customer heard a 40s teaser of exactly this audio before paying).
  // If the row already carries that audio, there is nothing to generate:
  // flip to success and send the delivery email right now. The old
  // post-payment generation below remains as the fallback for legacy
  // rows created before this model.
  const hasPreRenderedAudio =
    (row.permanent_audio_urls && row.permanent_audio_urls.length > 0) ||
    (row.suno_audio_urls && row.suno_audio_urls.length > 0);

  if (hasPreRenderedAudio) {
    const { error: successError } = await supabase
      .from('cloned_voice_songs')
      .update({ status: 'success', completed_at: paidAtIso })
      .eq('id', clonedVoiceSongId);
    if (successError) {
      console.error('[clonamivoz-stripe-webhook] Failed to flip to success:', successError);
    }
    try {
      // Delivery email (includes the owner QA ping + gift-page link).
      // No separate "pago recibido" email — delivery IS the confirmation.
      await sendClonedVoiceDeliveryEmail(supabase, {
        ...row,
        customer_email: session.customer_email || row.customer_email,
      });
    } catch (e) {
      console.error('[clonamivoz-stripe-webhook] Delivery email failed (non-fatal):', e);
    }
    return new Response(
      JSON.stringify({
        received: true,
        cloned_voice_song_id: clonedVoiceSongId,
        paid_at: paidAtIso,
        instant_delivery: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- LEGACY fallback: post-payment generation ------------
  // "pago recibido" confirmation email — fire-and-forget + idempotent
  // (paid_email_sent_at claim). Tells the customer they can close the tab;
  // the delivery email carries the final links. Must never 4xx the webhook.
  try {
    await sendClonedVoicePaidEmail(supabase, {
      ...row,
      customer_email: session.customer_email || row.customer_email,
    });
  } catch (e) {
    console.error('[clonamivoz-stripe-webhook] Paid email failed (non-fatal):', e);
  }

  // ---------------- trigger full song generation ----------------
  // Server-to-server call into generate-cloned-voice-song. Use the
  // service role key so the verify_jwt=true gateway lets us through.
  try {
    const genResp = await fetch(GENERATE_SONG_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // CRITICAL: pass the existing row id so generate-cloned-voice-song
        // UPDATES it (writing kie_task_id back) instead of inserting a
        // duplicate. Without this the customer pays, the song generates
        // on Suno, but the frontend polls a different row that never gets
        // a task id and the customer times out waiting.
        cloned_voice_song_id: clonedVoiceSongId,
        voice_sample_id: row.voice_sample_id,
        recipient_name: row.recipient_name,
        occasion: row.occasion,
        relationship: row.relationship,
        story: row.story,
        genre_slug: row.genre_slug,
        language: row.language || 'es',
        title: row.title,
        lyrics: row.lyrics,
        emotional_modifiers: row.emotional_modifiers,
        lyrics_model_used: row.lyrics_model_used,
        customer_email: row.customer_email,
        vocal_gender: row.vocal_gender || undefined,
      }),
    });

    if (!genResp.ok) {
      const errText = await genResp.text().catch(() => '');
      console.error(
        '[clonamivoz-stripe-webhook] generate-cloned-voice-song failed:',
        genResp.status,
        errText.slice(0, 500)
      );
      // Mark the row failed but DON'T return 500 — Stripe would retry
      // the webhook forever. The customer paid; we have their order;
      // we'll need to retry manually.
      await supabase
        .from('cloned_voice_songs')
        .update({
          status: 'failed',
          error_message: `Pago recibido pero la generación falló (HTTP ${genResp.status}). Contacta a soporte: hola@regalosquecantan.com`,
        })
        .eq('id', clonedVoiceSongId);
    } else {
      const genJson = await genResp.json().catch(() => null);
      console.log(
        '[clonamivoz-stripe-webhook] generate-cloned-voice-song accepted:',
        genJson?.kie_task_id,
        'for',
        clonedVoiceSongId
      );
      // generate-cloned-voice-song handles its own row updates
      // (status → generating_song, persists kie_task_id). We're done.
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      '[clonamivoz-stripe-webhook] Failed to call generate-cloned-voice-song:',
      msg
    );
    await supabase
      .from('cloned_voice_songs')
      .update({
        status: 'failed',
        error_message: `Pago recibido pero no se pudo iniciar la generación: ${msg}. Contacta a soporte.`,
      })
      .eq('id', clonedVoiceSongId);
  }

  // Always acknowledge to Stripe so the webhook doesn't retry. The
  // payment has been recorded; any generation issue is now ours to fix.
  return new Response(
    JSON.stringify({
      received: true,
      cloned_voice_song_id: clonedVoiceSongId,
      paid_at: paidAtIso,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
