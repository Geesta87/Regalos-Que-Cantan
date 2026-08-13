// supabase/functions/confirm-animado-order/index.ts
// Deploy with: supabase functions deploy confirm-animado-order --project-ref yzbvajungshqcpusfiia
//
// Called by the SUCCESS page after checkout. Verifies — server-side, against
// Stripe — that the session is PAID and actually included the Animado upsell,
// then creates the story_video_order(s) (state 'awaiting_photo') so they're
// tracked even before the photo is uploaded. Idempotent (create-story-video-order
// dedupes per song).
//
// This is the deliberate alternative to wiring Stripe → order creation inside
// stripe-webhook: it keeps the outage-prone webhook UNTOUCHED while still
// verifying payment server-side (the frontend can't be trusted to assert "paid").
// verify_jwt = false.
//
// NOTE (2026-08-13): this file was rewritten from the DEPLOYED source. The repo
// copy had fallen behind production — it was missing the existing-order shortcut
// and the pi_ one-tap path, and selected a `storyboard` column that does not
// exist on `songs`. Deploying that copy would have broken the live function.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// Recipient name + phone status for the upload screen. NOTE: only columns that
// exist on `songs` — the storyboard (with its is_family / character list) lives
// on story_video_orders and isn't generated until AFTER the photo is uploaded, so
// at this awaiting_photo stage there's nothing to read. We default is_family =
// true (offer the optional family slot) and leave other_people empty.
async function decorate(supabase: any, songId: string, orderId: string | null, state: string | null) {
  const { data: song } = await supabase.from('songs').select('recipient_name, whatsapp_phone, phone_number').eq('id', songId).single();
  const hasPhone = !!(song?.whatsapp_phone || song?.phone_number);
  return {
    order_id: orderId,
    song_id: songId,
    state,
    recipient_name: song?.recipient_name || null,
    has_phone: hasPhone,
    is_family: true,
    other_people: [],
  };
}

// Create (or fetch the existing) awaiting_photo order for a song and assemble the
// response shape the success page needs for the upload screen. create-story-video-order
// is idempotent per song, so this is safe to call repeatedly.
async function buildOrder(supabase: any, songId: string, sessionId: string) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-story-video-order`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ song_id: songId, stripe_session_id: sessionId }),
  });
  const oj = await resp.json().catch(() => ({}));
  return await decorate(supabase, songId, oj.order_id || null, oj.state || null);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const body = await req.json();
    const session_id: string | undefined = body?.session_id;
    const song_ids_raw: string | undefined = body?.song_ids;
    if (!session_id && !song_ids_raw) throw new Error('Missing session_id or song_ids');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ── Song-id path — READ ONLY ─────────────────────────────────────────
    // The links a customer KEEPS (the WhatsApp + email "your song is ready"
    // messages, built by send-song-ready-whatsapp/-sms) carry song ids and NO
    // session_id — deliberately, because session_id is what authorizes
    // charge-upsell against the saved card and so must never travel in a
    // message. Without a way to resolve the film by song, the success page
    // could not see it at all: a Paquete Definitivo buyer's most expensive
    // item was simply absent from the only link they kept (verified live on
    // 2026-08-13 — 7 of 8 items, no animado, not even a "coming soon").
    //
    // This path RESOLVES EXISTING orders only. It never calls
    // create-story-video-order — minting an order from a song id alone would
    // create one for a song that never paid — and it confers no charge
    // authority, since that still requires a session_id the caller doesn't have.
    if (!session_id) {
      const ids = String(song_ids_raw || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return json(200, { eligible: false, reason: 'no_song_ids' });
      const { data: rows } = await supabase
        .from('story_video_orders')
        .select('id, song_id, state')
        .in('song_id', ids)
        .neq('state', 'deleted');
      if (!rows || !rows.length) return json(200, { eligible: false, reason: 'no_animado' });
      const seen = new Set<string>();
      const orders: any[] = [];
      for (const r of rows) {
        if (seen.has(r.song_id)) continue;
        seen.add(r.song_id);
        orders.push(await decorate(supabase, r.song_id, r.id, r.state));
      }
      return json(200, { success: true, eligible: true, count: orders.length, orders });
    }

    // ── Existing-order shortcut ──────────────────────────────────────────
    // If a story_video_order already exists for this session id, surface it
    // directly (no Stripe round-trip). Covers idempotent re-visits AND
    // admin-created comp/test orders (owner dogfooding the real customer flow).
    // SAFE: these rows only exist because a prior PAID confirm created one, or an
    // admin comped one — a random session_id matches nothing and falls through to
    // the normal Stripe payment verification below. No way to skip payment.
    {
      const { data: existing } = await supabase.from('story_video_orders')
        .select('song_id').eq('stripe_session_id', session_id).not('song_id', 'is', null).limit(5);
      if (existing && existing.length) {
        const seen = new Set<string>();
        const orders: any[] = [];
        for (const e of existing) {
          if (seen.has(e.song_id)) continue;
          seen.add(e.song_id);
          orders.push(await buildOrder(supabase, e.song_id, session_id));
        }
        return json(200, { success: true, eligible: true, count: orders.length, orders });
      }
    }

    // ── One-tap upsell path ──────────────────────────────────────────────
    // The post-purchase one-tap Animado upsell (charge-upsell) charges the saved
    // card off-session and stores the resulting PaymentIntent id (pi_...) as the
    // order's stripe_session_id — NOT a Checkout Session. When the customer
    // returns (e.g. via the photo-reminder email, whose link carries that pi_ id),
    // the Checkout Sessions endpoint 404s, so verify the PaymentIntent directly.
    if (session_id.startsWith('pi_')) {
      const pr = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(session_id)}`, {
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      });
      const pi = await pr.json();
      if (!pr.ok) throw new Error(`Stripe PaymentIntent lookup failed: ${pi?.error?.message || pr.status}`);
      if (pi.status !== 'succeeded') return json(200, { eligible: false, reason: 'not_paid' });
      // charge-upsell stamps { type:'upsell', item, song_id } on the PaymentIntent.
      const md = pi.metadata || {};
      if (md.item !== 'animado' || !md.song_id) return json(200, { eligible: false, reason: 'no_animado' });
      const order = await buildOrder(supabase, String(md.song_id), session_id);
      return json(200, { success: true, eligible: true, count: 1, orders: [order] });
    }

    // ── Checkout Session path ────────────────────────────────────────────
    // At-purchase Animado (create-checkout) uses a Checkout Session (cs_...) and
    // records the picks in session metadata.
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const session = await r.json();
    if (!r.ok) throw new Error(`Stripe session lookup failed: ${session?.error?.message || r.status}`);
    if (session.payment_status !== 'paid') return json(200, { eligible: false, reason: 'not_paid' });

    const md = session.metadata || {};
    const animadoCount = parseInt(md.animadoCount || '0') || 0;
    if (animadoCount < 1) return json(200, { eligible: false, reason: 'no_animado' });

    // which song(s) the customer chose for the animated video
    const animadoSongIds: string[] = String(md.animadoSongIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!animadoSongIds.length) return json(200, { eligible: false, reason: 'no_song_ids' });

    const orders: any[] = [];
    for (const songId of animadoSongIds) {
      orders.push(await buildOrder(supabase, songId, session_id));
    }

    return json(200, { success: true, eligible: true, count: animadoCount, orders });
  } catch (e: any) {
    console.error('confirm-animado-order error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
