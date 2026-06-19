// supabase/functions/animado-photo/index.ts
// Deploy with: supabase functions deploy animado-photo --project-ref yzbvajungshqcpusfiia
//
// Customer photo upload for the Animado pipeline, used by the success page.
//   { action:'sign',   story_video_order_id, which:'main'|'family' }
//        -> a signed PUT url to upload that photo into story-video-assets/{orderId}/source-<which>.jpg
//   { action:'attach', story_video_order_id, has_family }
//        -> sets the order's recipient_photo_url (the family photo when present, since it
//           captures everyone; otherwise the main photo), moves it to generating_likeness,
//           and kicks off generate-likeness (the 2 cartoon options for the admin gate).
//
// verify_jwt = false (called from the browser with the anon key; the order id is the
// only thing needed and the work it triggers is bounded + admin-reviewed).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'story-video-assets';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const { action, story_video_order_id, which, has_family, phone } = await req.json();
    if (!story_video_order_id) throw new Error('Missing story_video_order_id');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: order } = await supabase.from('story_video_orders')
      .select('id, song_id, state').eq('id', story_video_order_id).single();
    if (!order) throw new Error('order not found');

    if (action === 'sign') {
      const slot = which === 'family' ? 'family' : 'main';
      const path = `${story_video_order_id}/source-${slot}.jpg`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error) throw new Error(`sign: ${error.message}`);
      return json(200, { success: true, signed_url: data.signedUrl, path });
    }

    if (action === 'attach') {
      const pub = (slot: string) => supabase.storage.from(BUCKET).getPublicUrl(`${story_video_order_id}/source-${slot}.jpg`).data.publicUrl;
      const mainUrl = pub('main');
      const primaryUrl = has_family ? pub('family') : mainUrl;

      await supabase.from('story_video_orders').update({
        recipient_photo_url: primaryUrl,
        state: 'generating_likeness',
        ...(phone ? { customer_phone: String(phone).slice(0, 30) } : {}),
      }).eq('id', story_video_order_id);

      // capture the phone on the song too (so reminders/delivery can reach them),
      // without overwriting a number they already gave at checkout.
      if (phone && order.song_id) {
        const clean = String(phone).replace(/[^\d+]/g, '').slice(0, 20);
        if (clean.length >= 7) {
          const { data: s } = await supabase.from('songs').select('whatsapp_phone').eq('id', order.song_id).single();
          if (!s?.whatsapp_phone) await supabase.from('songs').update({ whatsapp_phone: clean }).eq('id', order.song_id);
        }
      }

      // kick the 2 cartoon likeness options (admin gate 1). Fire-and-forget.
      fetch(`${SUPABASE_URL}/functions/v1/generate-likeness`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: order.song_id, recipient_photo_url: primaryUrl, story_video_order_id }),
      }).catch((e) => console.error('generate-likeness kick failed:', e.message));

      // also generate the storyboard early (best-effort) so its 'assumptions' are ready
      // for the admin to review at Gate 1 — BEFORE the expensive build runs.
      if (order.song_id) {
        fetch(`${SUPABASE_URL}/functions/v1/generate-storyboard`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
          body: JSON.stringify({ songId: order.song_id }),
        }).catch((e) => console.error('generate-storyboard kick failed:', e.message));
      }

      return json(200, { success: true, state: 'generating_likeness' });
    }

    return json(400, { success: false, error: 'unknown action' });
  } catch (e: any) {
    console.error('animado-photo error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
