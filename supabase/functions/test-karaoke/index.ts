// supabase/functions/test-karaoke/index.ts
//
// One-shot ops trigger to manually invoke the Vercel karaoke worker without
// going through Stripe. Reads KARAOKE_TRIGGER_SECRET from Supabase env so we
// don't have to paste secrets anywhere.
//
//   POST /v1/test-karaoke  body: { songId }
//
// Usage:
//   curl -X POST https://yzbvajungshqcpusfiia.supabase.co/functions/v1/test-karaoke \
//     -H 'Content-Type: application/json' \
//     -d '{"songId":"<uuid>"}'
//
// Safe to keep around as an admin retry tool. Auth is via verify_jwt=false
// + ops convention (it just forwards to the Vercel route which validates
// the shared secret).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const KARAOKE_TRIGGER_SECRET = Deno.env.get('KARAOKE_TRIGGER_SECRET') || '';
const VERCEL_BASE_URL = Deno.env.get('VERCEL_BASE_URL') || 'https://regalosquecantan.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const resHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  if (!KARAOKE_TRIGGER_SECRET) {
    return new Response(
      JSON.stringify({ success: false, error: 'KARAOKE_TRIGGER_SECRET not set in Supabase env' }),
      { status: 500, headers: resHeaders },
    );
  }

  let songId: string;
  let endpoint = 'karaoke-fetch';
  let mode: string | undefined;
  try {
    const body = await req.json();
    songId = body?.songId;
    if (!songId) throw new Error('songId required');
    // Optional passthrough to the lyric/karaoke VIDEO renderer for ops testing.
    if (body?.endpoint === 'render-lyric-video') {
      endpoint = 'render-lyric-video';
      mode = body?.mode || 'lyric';
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: `Bad request: ${(e as Error).message}` }),
      { status: 400, headers: resHeaders },
    );
  }

  console.log(`[test-karaoke] forwarding songId=${songId} to ${VERCEL_BASE_URL}/api/${endpoint}`);

  try {
    const fwdBody: Record<string, unknown> = { songId, secret: KARAOKE_TRIGGER_SECRET };
    if (mode) fwdBody.mode = mode;
    const r = await fetch(`${VERCEL_BASE_URL}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fwdBody),
    });
    const text = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return new Response(
      JSON.stringify({ vercel_status: r.status, vercel_response: parsed }),
      { status: r.ok ? 200 : 500, headers: resHeaders },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: `Trigger to Vercel failed: ${e?.message || e}` }),
      { status: 500, headers: resHeaders },
    );
  }
});
