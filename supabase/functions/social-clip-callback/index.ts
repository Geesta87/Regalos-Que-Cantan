// supabase/functions/social-clip-callback/index.ts
// Shotstack webhook endpoint — called when a social-clip render completes.
// Mirrors video-callback/index.ts but writes to the `social_posts` table
// instead of `video_orders`.
//
// On success we MUST persist the MP4 to the `videos` storage bucket because
// Shotstack temp URLs expire. Storage helper is shared with the video addon
// (see _shared/store-video.ts — streaming S3 with single-buffer fallback).
//
// Shotstack cannot sign its webhook payloads with a Supabase JWT, so this
// function's verify_jwt setting is pinned to `false` in supabase/config.toml.
// Do NOT pass --no-verify-jwt on the CLI anymore — the config file handles it.
//
// Deploy with: supabase functions deploy social-clip-callback --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { storeRenderedVideo } from '../_shared/store-video.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.json();
    console.log('[social-clip-callback] received:', JSON.stringify(payload));

    const renderId = payload.id;
    const status = payload.status;     // 'done' | 'failed'
    const videoUrl = payload.url;      // temporary Shotstack URL

    if (!renderId) {
      throw new Error('No render ID in callback');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: post, error: findError } = await supabase
      .from('social_posts')
      .select('id, song_id, video_status')
      .eq('shotstack_render_id', renderId)
      .single();

    if (findError || !post) {
      console.error('[social-clip-callback] no social_post for render:', renderId);
      // Return 200 so Shotstack doesn't retry forever.
      return new Response(
        JSON.stringify({ received: true, persisted: false, reason: 'no_matching_post' }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    if (status === 'done' && videoUrl) {
      let result;
      try {
        // social/ prefix keeps these separate from the video addon's clips in
        // the same `videos` bucket.
        result = await storeRenderedVideo(
          `social/${post.song_id}.mp4`,
          videoUrl,
          supabase,
        );
      } catch (storeErr: any) {
        console.error(
          `[social-clip-callback] storage failed for social_post ${post.id}:`,
          storeErr,
        );
        await supabase
          .from('social_posts')
          .update({
            last_error: `storage_failed: ${storeErr.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', post.id);

        // Leave video_status as 'rendering' so a future retry job (if added)
        // can attempt persistence again.
        return new Response(
          JSON.stringify({ received: true, persisted: false }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        );
      }

      await supabase
        .from('social_posts')
        .update({
          video_status: 'completed',
          social_video_url: result.publicUrl,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id);

      console.log(
        `[social-clip-callback] rendered via ${result.method} (${result.bytes} bytes): ${result.publicUrl}`,
      );

      // Fire-and-forget: hand off to GHL for social posting. Failures here
      // don't affect the render pipeline — post-to-ghl has its own retry
      // state (retry_count, last_error, next_retry_at). Idempotent via the
      // ghl_post_id check inside post-to-ghl, so duplicate triggers are safe.
      try {
        const ghlResp = await fetch(`${SUPABASE_URL}/functions/v1/post-to-ghl`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ socialPostId: post.id }),
        });
        if (!ghlResp.ok) {
          console.warn(`[post-to-ghl] non-2xx for ${post.id}: ${ghlResp.status}`);
        }
      } catch (ghlErr: any) {
        console.warn(`[post-to-ghl] trigger failed for ${post.id}:`, ghlErr.message);
      }
    } else if (status === 'failed') {
      const errorMessage = payload.error || 'Shotstack render failed';
      await supabase
        .from('social_posts')
        .update({
          video_status: 'failed',
          last_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id);

      console.error('[social-clip-callback] render failed:', errorMessage);
    }

    return new Response(
      JSON.stringify({ received: true, persisted: status === 'done' }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error: any) {
    console.error('[social-clip-callback] error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 },
    );
  }
});
