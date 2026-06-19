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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const { session_id } = await req.json();
    if (!session_id) throw new Error('Missing session_id');

    // 1) verify the Stripe session server-side
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

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const orders: any[] = [];
    for (const songId of animadoSongIds) {
      // create (or fetch existing) the awaiting_photo order
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-story-video-order`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: songId, stripe_session_id: session_id }),
      });
      const oj = await resp.json().catch(() => ({}));
      // attach the recipient name + whether we already have a phone (for the upload screen)
      const { data: song } = await supabase.from('songs').select('recipient_name, whatsapp_phone, phone_number').eq('id', songId).single();
      const hasPhone = !!(song?.whatsapp_phone || song?.phone_number);
      orders.push({
        order_id: oj.order_id || null,
        song_id: songId,
        state: oj.state || null,
        recipient_name: song?.recipient_name || null,
        has_phone: hasPhone,
      });
    }

    return json(200, { success: true, eligible: true, count: animadoCount, orders });
  } catch (e: any) {
    console.error('confirm-animado-order error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
