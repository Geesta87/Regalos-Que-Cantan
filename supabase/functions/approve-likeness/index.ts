// supabase/functions/approve-likeness/index.ts
// Deploy with: supabase functions deploy approve-likeness --project-ref yzbvajungshqcpusfiia
//
// ADMIN GATE 1 exit. Admin picks one of the 2 likeness options (or rejects).
// { story_video_order_id, chosen_index (0|1), admin, reject? }
//  - approve: sets approved_character_url + state='building' (ready for the build engine)
//  - reject:  sets state='awaiting_photo' (customer re-uploads / we regenerate)
// Server-to-server / admin call -> verify_jwt = false (config.toml).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const { story_video_order_id, chosen_index, admin, reject } = await req.json();
    if (!story_video_order_id) throw new Error('Missing story_video_order_id');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: order, error } = await supabase.from('story_video_orders')
      .select('id, state, character_options').eq('id', story_video_order_id).single();
    if (error || !order) throw new Error('order not found');
    if (order.state !== 'likeness_review') throw new Error(`order is '${order.state}', not 'likeness_review'`);

    if (reject) {
      await supabase.from('story_video_orders').update({ state: 'awaiting_photo', character_options: null }).eq('id', story_video_order_id);
      return json(200, { success: true, state: 'awaiting_photo' });
    }

    const opts = order.character_options as { url: string }[];
    const idx = Number(chosen_index);
    if (!opts || !opts[idx]) throw new Error('invalid chosen_index');
    await supabase.from('story_video_orders').update({
      approved_character_url: opts[idx].url,
      approved_character_by: admin || 'admin',
      approved_character_at: new Date().toISOString(),
      state: 'building',
    }).eq('id', story_video_order_id);

    return json(200, { success: true, state: 'building', approved_character_url: opts[idx].url });
  } catch (e: any) {
    console.error('approve-likeness error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
