// supabase/functions/story-build-finalize/index.ts
// Deploy with: supabase functions deploy story-build-finalize --project-ref yzbvajungshqcpusfiia
//
// Lets the engine (Cloud Run / local, anon key only) hand the finished video back
// without DB/storage secrets. Two modes:
//  { mode:'upload-url', story_video_order_id } -> { path, token, signed_url } to PUT the mp4
//  { mode:'complete',   story_video_order_id } -> sets video_url + state='final_review' (GATE 2)
//  { mode:'fail', story_video_order_id, error } -> state='failed' + error
// Server-to-server (no Supabase JWT) -> verify_jwt = false (config.toml).

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
    const { mode, story_video_order_id, error: errMsg, cost_credits } = await req.json();
    if (!story_video_order_id) throw new Error('Missing story_video_order_id');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const path = `${story_video_order_id}/final.mp4`;

    if (mode === 'upload-url') {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error) throw new Error(error.message);
      return json(200, { success: true, path, token: data.token, signed_url: data.signedUrl });
    }
    if (mode === 'fail') {
      await supabase.from('story_video_orders').update({ state: 'failed', error: String(errMsg || 'build failed') }).eq('id', story_video_order_id);
      return json(200, { success: true, state: 'failed' });
    }
    // default: complete
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    await supabase.from('story_video_orders').update({
      video_url: pub.publicUrl,
      state: 'final_review',
      cost_credits: cost_credits || 0,
    }).eq('id', story_video_order_id);
    return json(200, { success: true, state: 'final_review', video_url: pub.publicUrl });
  } catch (e: any) {
    console.error('story-build-finalize error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
