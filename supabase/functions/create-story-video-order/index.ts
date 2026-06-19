// supabase/functions/create-story-video-order/index.ts
// Deploy with: supabase functions deploy create-story-video-order --project-ref yzbvajungshqcpusfiia
//
// Pipeline ENTRY: creates a story_video_order for a song (the "Animado" upsell).
// Idempotent on song_id — calling twice returns the existing order, never a duplicate.
// Two ways in:
//   1) { song_id }                       -> order in state 'awaiting_photo' (we still need a photo)
//   2) { song_id, recipient_photo_url }  -> order created AND generate-likeness kicked off
//                                           (jumps straight to generating the 2 cartoon options)
// Designed to be called server-to-server (Stripe webhook on addon purchase, a cron, or the
// admin dashboard). verify_jwt = false (config.toml).
//
// IMPORTANT: this is intentionally isolated from stripe-webhook. To wire the real purchase
// trigger, stripe-webhook only needs to fire ONE fetch() to this function when the Animado
// line item / metadata is present — a minimal, low-risk addition to that critical function.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const { song_id, recipient_photo_url, stripe_session_id } = await req.json();
    if (!song_id) throw new Error('Missing song_id');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // confirm the song exists (and grab a couple of fields for sanity / logging)
    const { data: song, error: se } = await supabase.from('songs').select('id, recipient_name, email').eq('id', song_id).single();
    if (se || !song) throw new Error('song not found');

    // idempotency: one story_video_order per song
    const { data: existing } = await supabase.from('story_video_orders').select('id, state').eq('song_id', song_id).maybeSingle();
    if (existing) return json(200, { success: true, already_exists: true, order_id: existing.id, state: existing.state });

    const photo = (recipient_photo_url && String(recipient_photo_url).trim()) || null;
    const { data: created, error: ce } = await supabase.from('story_video_orders').insert({
      song_id,
      stripe_session_id: stripe_session_id || null,
      recipient_photo_url: photo,
      state: photo ? 'generating_likeness' : 'awaiting_photo',
    }).select('id').single();
    if (ce) throw ce;

    // if we already have a photo, kick off the 2 likeness options immediately
    let likeness_triggered = false;
    if (photo) {
      // fire-and-forget; generate-likeness will move the order to likeness_review
      fetch(`${SUPABASE_URL}/functions/v1/generate-likeness`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song_id, recipient_photo_url: photo, story_video_order_id: created.id }),
      }).catch((e) => console.error('generate-likeness kick failed:', e.message));
      likeness_triggered = true;
    }

    return json(200, { success: true, order_id: created.id, state: photo ? 'generating_likeness' : 'awaiting_photo', likeness_triggered });
  } catch (e: any) {
    console.error('create-story-video-order error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
