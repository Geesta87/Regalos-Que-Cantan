// supabase/functions/charge-upsell/index.ts
// Deploy with: supabase functions deploy charge-upsell --project-ref yzbvajungshqcpusfiia
//
// Post-purchase ONE-TAP secondary upsell. After the song is paid, the success
// page offers Animado / instrumental as a single tap. Because create-checkout
// saved the card off-session and stripe-webhook stored the Stripe customer +
// payment method on the song, this charges that saved card directly — no second
// checkout, no card re-entry.
//
// SAFETY (this handles real money, so it's defensive on purpose):
//   • Authorization — the caller must pass the original checkout session_id and
//     it must equal the song's stripe_session_id. Only the buyer has it (it's in
//     their /success URL), so a stranger can't trigger a charge on someone's card.
//   • No double-charge — a 'pending' row is inserted BEFORE Stripe is called;
//     the partial unique index (one non-failed row per song+item) makes a
//     concurrent/duplicate request fail the claim before any PaymentIntent
//     is created.
//   • Never 500 after a successful charge — fulfillment is best-effort and
//     mirrors stripe-webhook's existing isolated patterns (create-story-video-
//     order for Animado, the Vercel karaoke worker for the instrumental).
//   • Fully isolated — it never imports from or modifies stripe-webhook /
//     create-checkout, so it cannot regress the $29.99 funnel.
//
// Returns: { status: 'paid' | 'needs_action' | 'error', ... }
//   'needs_action' → the bank wants verification (rare) OR there's no saved card
//                    on this order; the caller should fall back to a one-time
//                    checkout for that single item.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';
import { moderateGiftText } from '../_shared/moderate.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The one-tap catalog. Gift is intentionally NOT here yet — it needs a small
// form (recipient / message / schedule) and moderation, so it stays on its own
// flow until that's wired. Keep prices in sync with create-checkout.
const ITEMS: Record<string, { cents: number; label: string }> = {
  animado: { cents: 4900, label: 'Película animada' },
  instrumental: { cents: 799, label: 'Pista instrumental' },
  lyric_video: { cents: 999, label: 'Video con letra' },
  gift: { cents: 500, label: 'Envío sorpresa por mensaje' },
};

// Normalize a US/MX phone to E.164 (same rule as create-checkout).
function giftToE164(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) =>
    new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });

  try {
    const { song_id, item, session_id, gift } = await req.json();
    if (!song_id) return json(400, { status: 'error', error: 'missing_song_id' });
    if (!session_id) return json(400, { status: 'error', error: 'missing_session_id' });
    const cfg = ITEMS[item];
    if (!cfg) return json(400, { status: 'error', error: 'unsupported_item' });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load the song + its saved card + the session it was paid under.
    const { data: song, error: se } = await supabase
      .from('songs')
      .select('id, email, recipient_name, paid, stripe_session_id, stripe_customer_id, stripe_payment_method_id')
      .eq('id', song_id)
      .single();
    if (se || !song) return json(404, { status: 'error', error: 'song_not_found' });

    // Authorization: the caller must hold the original checkout session id.
    if (!song.stripe_session_id || song.stripe_session_id !== session_id) {
      return json(403, { status: 'error', error: 'not_authorized' });
    }
    if (!song.paid) return json(400, { status: 'error', error: 'song_not_paid' });

    // SMS gift needs inputs + message moderation BEFORE any charge. A rejection
    // here never charges the card. Reuses the existing moderation module.
    let giftFields: { phone: string; buyer: string; msg: string; rname: string; sendIso: string; tz: string } | null = null;
    if (item === 'gift') {
      const phone = giftToE164(String(gift?.recipient_phone || ''));
      const buyer = String(gift?.buyer_name || '').trim();
      const msg = String(gift?.personal_message || '').trim().slice(0, 300);
      const rname = String(gift?.recipient_name || song.recipient_name || '').trim();
      const sendMs = Date.parse(gift?.send_at || '');
      if (!phone) return json(400, { status: 'error', error: 'gift_invalid_phone' });
      if (!buyer) return json(400, { status: 'error', error: 'gift_missing_buyer' });
      if (gift?.attestation !== true) return json(400, { status: 'error', error: 'gift_attestation' });
      if (Number.isNaN(sendMs) || sendMs < Date.now() + 2 * 60 * 1000) return json(400, { status: 'error', error: 'gift_bad_time' });
      const verdict = await moderateGiftText({ message: msg, recipientName: rname, senderName: buyer });
      if (!verdict.allowed) return json(422, { status: 'error', error: 'gift_message_rejected' });
      giftFields = { phone, buyer, msg, rname, sendIso: new Date(sendMs).toISOString(), tz: String(gift?.buyer_timezone || '').slice(0, 64) };
    }

    // Already charged (or in progress) for this item → idempotent, friendly.
    const { data: existing } = await supabase
      .from('upsell_charges')
      .select('status')
      .eq('song_id', song_id)
      .eq('item', item)
      .neq('status', 'failed')
      .maybeSingle();
    if (existing) {
      return json(200, { status: existing.status === 'paid' ? 'paid' : existing.status, already: true });
    }

    // No saved card on this order (e.g. a purchase from before this feature
    // shipped) → tell the caller to use a one-time checkout instead.
    if (!song.stripe_customer_id || !song.stripe_payment_method_id) {
      return json(200, { status: 'needs_action', reason: 'no_saved_card' });
    }

    // CLAIM before charging. The partial unique index (one non-failed row per
    // song+item) turns a concurrent/duplicate request into a claim failure here,
    // BEFORE any PaymentIntent exists — so the card can never be charged twice.
    const { data: claim, error: claimErr } = await supabase
      .from('upsell_charges')
      .insert({ song_id, item, amount_cents: cfg.cents, status: 'pending', buyer_email: song.email || null })
      .select('id')
      .single();
    if (claimErr || !claim) {
      const { data: cur } = await supabase
        .from('upsell_charges')
        .select('status')
        .eq('song_id', song_id).eq('item', item).neq('status', 'failed')
        .maybeSingle();
      return json(200, { status: cur?.status === 'paid' ? 'paid' : (cur?.status || 'processing'), already: true });
    }

    // Charge the saved card off-session.
    let pi: Stripe.PaymentIntent | null = null;
    try {
      pi = await stripe.paymentIntents.create({
        amount: cfg.cents,
        currency: 'usd',
        customer: song.stripe_customer_id,
        payment_method: song.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: `${cfg.label} — ${song.recipient_name || 'RegalosQueCantan'}`,
        metadata: { type: 'upsell', item, song_id, upsell_charge_id: claim.id },
      });
    } catch (chargeErr: any) {
      // Off-session charges occasionally need bank verification (SCA). Surface
      // needs_action so the caller routes to a one-time checkout for this item.
      const code = chargeErr?.code || chargeErr?.raw?.code || '';
      const needsAuth = code === 'authentication_required';
      await supabase.from('upsell_charges').update({
        status: needsAuth ? 'needs_action' : 'failed',
        stripe_payment_intent_id: chargeErr?.raw?.payment_intent?.id || null,
        error_message: String(chargeErr?.message || code || 'charge_failed').slice(0, 300),
        updated_at: new Date().toISOString(),
      }).eq('id', claim.id);
      console.error(`[charge-upsell] charge ${needsAuth ? 'needs auth' : 'failed'} song=${song_id} item=${item}: ${code}`);
      return json(200, { status: needsAuth ? 'needs_action' : 'error', reason: needsAuth ? 'authentication_required' : (code || 'charge_failed') });
    }

    if (!pi || pi.status !== 'succeeded') {
      const needsAction = pi?.status === 'requires_action';
      await supabase.from('upsell_charges').update({
        status: needsAction ? 'needs_action' : 'failed',
        stripe_payment_intent_id: pi?.id || null,
        error_message: `pi_status_${pi?.status || 'unknown'}`,
        updated_at: new Date().toISOString(),
      }).eq('id', claim.id);
      return json(200, { status: needsAction ? 'needs_action' : 'error', reason: pi?.status || 'unknown' });
    }

    // PAID — record it.
    await supabase.from('upsell_charges').update({
      status: 'paid',
      stripe_payment_intent_id: pi.id,
      updated_at: new Date().toISOString(),
    }).eq('id', claim.id);
    console.log(`✅ [charge-upsell] paid song=${song_id} item=${item} pi=${pi.id}`);

    // Fulfillment — best-effort. The money is collected; a hiccup here must NOT
    // 500 the customer (their order is recoverable by cron/admin). Mirror the
    // exact isolated patterns stripe-webhook already uses.
    let animadoOrderId: string | null = null;
    try {
      if (item === 'animado') {
        // Park an awaiting_photo story_video_order (idempotent per song). The
        // success page then collects the recipient photo (AnimadoPhotoUpload).
        const r = await fetch(`${SUPABASE_URL}/functions/v1/create-story-video-order`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
          body: JSON.stringify({ song_id, stripe_session_id: pi.id }),
        });
        if (r.ok) {
          try { const oj = await r.json(); animadoOrderId = oj?.order_id || null; } catch { /* ignore */ }
        } else {
          console.error('[charge-upsell] create-story-video-order non-2xx:', r.status);
        }
      } else if (item === 'instrumental') {
        // Flag the song + trigger the Vercel karaoke worker — identical to the
        // stripe-webhook karaoke path (Vercel handles the 195MB ZIP extraction).
        await supabase.from('songs').update({ karaoke_status: 'pending' }).eq('id', song_id);
        const karaokeSecret = Deno.env.get('KARAOKE_TRIGGER_SECRET') || '';
        const vercelBase = Deno.env.get('VERCEL_BASE_URL') || 'https://regalosquecantan.com';
        if (karaokeSecret) {
          fetch(`${vercelBase}/api/karaoke-fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId: song_id, secret: karaokeSecret }),
          }).catch((e) => console.warn('[charge-upsell] karaoke trigger failed:', e?.message || e));
        } else {
          console.warn('[charge-upsell] KARAOKE_TRIGGER_SECRET not set — instrumental flagged but worker not triggered');
        }
      } else if (item === 'lyric_video') {
        // Flag the song + trigger the Vercel lyric-video renderer — mirrors the
        // stripe-webhook render-lyric-video (mode='lyric') path.
        await supabase.from('songs').update({ lyric_video_status: 'pending' }).eq('id', song_id);
        const secret = Deno.env.get('KARAOKE_TRIGGER_SECRET') || '';
        const vercelBase = Deno.env.get('VERCEL_BASE_URL') || 'https://regalosquecantan.com';
        if (secret) {
          fetch(`${vercelBase}/api/render-lyric-video`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId: song_id, mode: 'lyric', secret }),
          }).catch((e) => console.warn('[charge-upsell] lyric-video trigger failed:', e?.message || e));
        } else {
          console.warn('[charge-upsell] KARAOKE_TRIGGER_SECRET not set — lyric video flagged but worker not triggered');
        }
      } else if (item === 'gift' && giftFields) {
        // Reuse the existing scheduled-gift table + every-minute cron + Twilio
        // sender. Moderation already passed pre-charge. The unique index keeps it
        // to one gift per song.
        await supabase.from('scheduled_gift_messages').insert({
          song_id,
          buyer_email: song.email || null,
          buyer_name: giftFields.buyer,
          recipient_name: giftFields.rname || null,
          recipient_phone: giftFields.phone,
          personal_message: giftFields.msg || null,
          send_at: giftFields.sendIso,
          buyer_timezone: giftFields.tz || null,
          status: 'scheduled',
          moderation_status: 'approved',
          amount_cents: 500,
          attestation_accepted: true,
          marketing_excluded: true,
          stripe_session_id: pi.id,
        });
      }
    } catch (fulfillErr: any) {
      console.error('[charge-upsell] fulfillment after PAID charge failed (recoverable):', fulfillErr?.message || fulfillErr);
    }

    return json(200, { status: 'paid', item, amount_cents: cfg.cents, payment_intent: pi.id, order_id: animadoOrderId });
  } catch (e: any) {
    console.error('charge-upsell error:', e?.message || e);
    return json(500, { status: 'error', error: e?.message || 'server_error' });
  }
});
