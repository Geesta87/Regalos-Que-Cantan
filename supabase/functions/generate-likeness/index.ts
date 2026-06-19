// supabase/functions/generate-likeness/index.ts
// Deploy with: supabase functions deploy generate-likeness --project-ref yzbvajungshqcpusfiia
//
// STAGE 1 of the story-video pipeline + entry to ADMIN GATE 1.
// Given { songId, recipient_photo_url }, creates a story_video_orders row, generates
// 2 Pixar-cartoon likeness options of the recipient via Kie (google/nano-banana-edit),
// persists them to the story-video-assets bucket, and sets state = 'likeness_review'
// so they appear in the admin "Needs Approval" tab. Admin then calls approve-likeness.
//
// Server-to-server (no Supabase JWT) -> verify_jwt = false (config.toml).
// Reads KIE_API_KEY + service-role key from its own env.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const KIE = 'https://api.kie.ai/api/v1/jobs';
const BUCKET = 'story-video-assets';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fire a Kie nano-banana-edit cartoonify job, return taskId
async function kieCartoon(photoUrl: string, prompt: string): Promise<string> {
  const r = await fetch(`${KIE}/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'google/nano-banana-edit', input: { prompt, image_urls: [photoUrl], aspect_ratio: '3:4', output_format: 'png' } }),
  });
  const j = await r.json();
  const id = j?.data?.taskId;
  if (!id) throw new Error(`Kie createTask failed: ${JSON.stringify(j).slice(0, 200)}`);
  return id;
}

// poll a Kie task until success/fail, return the first result image URL
async function kiePoll(taskId: string, timeoutMs = 110000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${KIE_API_KEY}` } });
    const j = await r.json();
    const st = j?.data?.state;
    if (st === 'success') {
      const rj = JSON.parse(j.data.resultJson || '{}');
      const url = (rj.resultUrls || [])[0];
      if (!url) throw new Error('Kie success but no resultUrls');
      return url;
    }
    if (st === 'fail' || j?.data?.failCode) throw new Error(`Kie task failed: ${j?.data?.failMsg || 'unknown'}`);
    await sleep(3000);
  }
  throw new Error('Kie task timed out');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (code: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: code });

  try {
    if (!KIE_API_KEY) throw new Error('KIE_API_KEY not set');
    const { songId, recipient_photo_url, story_video_order_id } = await req.json();
    if (!recipient_photo_url) throw new Error('Missing recipient_photo_url');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // create or reuse the order row
    let orderId = story_video_order_id as string | undefined;
    if (!orderId) {
      const { data, error } = await supabase.from('story_video_orders')
        .insert({ song_id: songId || null, recipient_photo_url, state: 'generating_likeness' })
        .select('id').single();
      if (error) throw new Error(`insert order: ${error.message}`);
      orderId = data.id;
    } else {
      await supabase.from('story_video_orders').update({ state: 'generating_likeness', recipient_photo_url }).eq('id', orderId);
    }

    // 2 likeness variations for the admin to choose from
    const prompts = [
      'Turn the person or family in this photo into warm Pixar-style 3D animated characters: keep each face faithful and recognizable, same hair, features and clothing. Soft cinematic warm lighting, neutral cozy background, heartfelt, high quality 3D animation.',
      'Turn the person or family in this photo into a warm Pixar-style 3D animated portrait: faithful, recognizable likeness for everyone, gentle happy expressions, soft golden light, simple warm background, high quality 3D animation.',
    ];
    const taskIds = await Promise.all(prompts.map((p) => kieCartoon(recipient_photo_url, p)));
    const kieUrls = await Promise.all(taskIds.map((t) => kiePoll(t)));

    // persist both into our own storage (Kie temp URLs may expire)
    const options: { url: string }[] = [];
    for (let i = 0; i < kieUrls.length; i++) {
      const img = await fetch(kieUrls[i]);
      const bytes = new Uint8Array(await img.arrayBuffer());
      const path = `${orderId}/likeness_${i}.png`;
      const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
      if (up.error) throw new Error(`storage upload: ${up.error.message}`);
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      options.push({ url: pub.publicUrl });
    }

    await supabase.from('story_video_orders').update({ character_options: options, state: 'likeness_review' }).eq('id', orderId);

    return json(200, { success: true, story_video_order_id: orderId, state: 'likeness_review', options });
  } catch (e: any) {
    console.error('generate-likeness error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
