// supabase/functions/share-video-callback/index.ts
// Deploy with: supabase functions deploy share-video-callback --project-ref yzbvajungshqcpusfiia
//
// Completion hook for share-video renders on the in-house Cloud Run renderer
// (mirrors clip-studio-callback). Payload:
//   { kind:'share_video', song_id, success, video_url, render_seconds | error }
//
// Auth: Cloud Run cannot attach a Supabase JWT -> verify_jwt = false (see
// supabase/config.toml). Authenticated via the shared x-render-token header.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!RENDER_TOKEN || req.headers.get('x-render-token') !== RENDER_TOKEN) return json({ error: 'unauthorized' }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const songId = String(payload?.song_id || '');
  if (!songId) return json({ error: 'missing song_id' }, 400);

  if (payload.success && payload.video_url) {
    const { error } = await supabase.from('songs')
      .update({ share_video_url: String(payload.video_url), share_video_status: 'completed', share_video_error: null })
      .eq('id', songId);
    if (error) return json({ error: error.message }, 500);
    console.log(`[share-video] ${songId} completed in ${payload.render_seconds ?? '?'}s`);
    return json({ ok: true });
  }

  const message = String(payload?.error || 'render failed').slice(0, 500);
  const { error } = await supabase.from('songs')
    .update({ share_video_status: 'failed', share_video_error: message })
    .eq('id', songId);
  if (error) return json({ error: error.message }, 500);
  console.warn(`[share-video] ${songId} failed: ${message}`);
  return json({ ok: true });
});
