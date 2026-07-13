// supabase/functions/story-build-context/index.ts
// Deploy with: supabase functions deploy story-build-context --project-ref yzbvajungshqcpusfiia
//
// Feeds the auto-build engine everything it needs from a single order id, so the
// engine (Cloud Run, or local test) needs NO direct DB access — it runs on the anon
// key and routes through this + test-kie-video. Given { story_video_order_id }:
//  - ensures the storyboard exists (calls generate-storyboard if missing)
//  - returns { config, storyboard, timing, song_audio_url }
// where config = { name, title, endcard, approved_character_url, recipient_photo_url }.
// Server-to-server (no Supabase JWT) -> verify_jwt = false (config.toml).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const { story_video_order_id } = await req.json();
    if (!story_video_order_id) throw new Error('Missing story_video_order_id');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: order, error } = await supabase.from('story_video_orders')
      .select('id, song_id, state, approved_character_url, recipient_photo_url, storyboard, scene_assets, morph_asset').eq('id', story_video_order_id).single();
    if (error || !order) throw new Error('order not found');
    if (!order.approved_character_url) throw new Error('no approved_character_url (gate 1 not passed)');

    const { data: song, error: se } = await supabase.from('songs')
      .select('recipient_name, genre_name, audio_url, lyrics_timestamps').eq('id', order.song_id).single();
    if (se || !song) throw new Error('song not found');
    if (!song.lyrics_timestamps?.words?.length) throw new Error('song has no lyrics_timestamps (run transcribe-song)');

    // ensure storyboard (call generate-storyboard once, persist on the order)
    let storyboard = order.storyboard;
    if (!storyboard) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-storyboard`, {
        method: 'POST', headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: order.song_id }),
      });
      const sb = await r.json();
      if (!sb.success) throw new Error(`generate-storyboard: ${sb.error}`);
      storyboard = sb.storyboard;
      await supabase.from('story_video_orders').update({ storyboard }).eq('id', story_video_order_id);
    }

    const name = song.recipient_name || 'Tu historia';
    const config = {
      name,
      title: name,
      endcard: storyboard?.endcard || name,
      approved_character_url: order.approved_character_url,
      recipient_photo_url: order.recipient_photo_url,
    };
    return json(200, {
      success: true, config, storyboard, song_audio_url: song.audio_url, timing: song.lyrics_timestamps,
      // persisted per-scene assets (revise flow): the builder seeds its workdir with
      // these so only cleared/new scenes are regenerated on a rebuild.
      scene_assets: order.scene_assets || [], morph_asset: order.morph_asset || null,
    });
  } catch (e: any) {
    console.error('story-build-context error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
