// supabase/functions/inhouse-video-callback/index.ts
// Deploy with: supabase functions deploy inhouse-video-callback --project-ref yzbvajungshqcpusfiia
//
// Completion hook for the in-house FFmpeg renderer (Cloud Run service
// rqc-video-renderer), the replacement for Shotstack's video-callback.
//
// The Cloud Run service renders + uploads to the `videos-shadow` bucket, then
// POSTs here with { videoOrderId, success, error, objectKey }. We then mirror
// exactly what video-callback does for Shotstack: persist the video into the
// live `videos` bucket as <song_id>.mp4, mark the order completed, flip
// songs.has_video. Cross-bucket copy is server-side (no 90MB download).
//
// Auth: called server-to-server by Cloud Run (no Supabase JWT) -> verify_jwt
// MUST be false (see supabase/config.toml). The handler authenticates the
// caller via the shared X-Render-Token header instead.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';
const SHADOW_BUCKET = 'videos-shadow';
const FINAL_BUCKET = 'videos';

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Shared-secret auth — same token the Cloud Run renderer is gated by.
  if (RENDER_TOKEN && req.headers.get('x-render-token') !== RENDER_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  try {
    const { videoOrderId, success, error, objectKey } = await req.json();
    if (!videoOrderId) throw new Error('missing videoOrderId');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: videoOrder, error: findError } = await supabase
      .from('video_orders')
      .select('id, song_id')
      .eq('id', videoOrderId)
      .single();

    if (findError || !videoOrder) {
      console.warn('Video order not found (ignoring):', videoOrderId);
      return new Response(JSON.stringify({ received: true, ignored: true }), { status: 200 });
    }

    if (!success) {
      const errorMessage = error || 'in-house render failed';
      await supabase.from('video_orders').update({
        status: 'failed', error_message: errorMessage, updated_at: new Date().toISOString(),
      }).eq('id', videoOrder.id);
      console.error('In-house render failed:', videoOrderId, errorMessage);
      // Push the owner so a failed video doesn't sit silently (best-effort).
      try {
        const { data: s } = await supabase.from('songs').select('recipient_name').eq('id', videoOrder.song_id).single();
        await fetch(`${SUPABASE_URL}/functions/v1/notify-admin-push`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '⚠️ Video falló',
            body: `El video de ${s?.recipient_name || 'un cliente'} no se generó. Ábrelo en Videos para reintentar.`,
            url: '/admin/dashboard',
            tag: `video-failed-${videoOrder.id}`,
            audience: 'all',
          }),
        });
      } catch (_) { /* push is best-effort — never block the callback */ }
      return new Response(JSON.stringify({ received: true, persisted: false }), { status: 200 });
    }

    // Server-side copy videos-shadow/<objectKey> -> videos/<song_id>.mp4.
    const src = objectKey || `${videoOrderId}.mp4`;
    const destKey = `${videoOrder.song_id}.mp4`;
    const copyRes = await fetch(`${SUPABASE_URL}/storage/v1/object/copy`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: SHADOW_BUCKET,
        sourceKey: src,
        destinationBucket: FINAL_BUCKET,
        destinationKey: destKey,
      }),
    });
    if (!copyRes.ok) {
      const txt = await copyRes.text();
      throw new Error(`storage copy ${copyRes.status}: ${txt.slice(0, 200)}`);
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${FINAL_BUCKET}/${destKey}`;

    await supabase.from('video_orders').update({
      status: 'completed', video_url: publicUrl, error_message: null, render_attempts: 0, updated_at: new Date().toISOString(),
    }).eq('id', videoOrder.id);

    await supabase.from('songs').update({
      has_video: true, video_url: publicUrl,
    }).eq('id', videoOrder.song_id);

    // Tell the customer their video is ready, with ONE link to /success that shows
    // everything they bought. Best-effort + de-duped inside notify-upsell-ready.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-upsell-ready`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: videoOrder.song_id, kind: 'video' }),
      });
    } catch (_) { /* notification is best-effort — never block delivery */ }

    // Best-effort cleanup of the shadow copy (don't fail the request if it errors).
    try {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${SHADOW_BUCKET}/${src}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      });
    } catch (_) { /* ignore */ }

    console.log(`In-house video persisted: ${publicUrl}`);
    return new Response(JSON.stringify({ received: true, persisted: true, video_url: publicUrl }), { status: 200 });
  } catch (err) {
    console.error('inhouse-video-callback error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
