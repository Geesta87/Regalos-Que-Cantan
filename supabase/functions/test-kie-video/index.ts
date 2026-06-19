// supabase/functions/test-kie-video/index.ts
// Deploy with: supabase functions deploy test-kie-video --project-ref yzbvajungshqcpusfiia
//
// Throwaway TEST harness to evaluate Kie.ai's unified video API (Seedance 2.0 etc.)
// as a cheaper/faster alternative to Higgsfield for the story-video upsell.
// Uses the existing KIE_API_KEY Supabase secret (the same key we use for music).
// Server-to-server only (we curl it during testing) -> verify_jwt = false in config.toml.
//
// Modes:
//   { mode: 'create', model?, prompt, first_frame_url?, last_frame_url?, reference_image_urls?,
//     resolution?, aspect_ratio?, duration?, generate_audio? }  -> returns { taskId, raw }
//   { mode: 'status', taskId }                                  -> returns Kie recordInfo payload
//
// Kie unified jobs API (mirrors how docs.kie.ai documents it):
//   POST https://api.kie.ai/api/v1/jobs/createTask   { model, input, callBackUrl? }
//   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const BASE = 'https://api.kie.ai/api/v1/jobs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (code: number, obj: unknown) =>
    new Response(JSON.stringify(obj), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: code });

  try {
    if (!KIE_API_KEY) throw new Error('KIE_API_KEY not set');
    const body = await req.json();

    if (body.mode === 'status') {
      if (!body.taskId) throw new Error('Missing taskId');
      const r = await fetch(`${BASE}/recordInfo?taskId=${encodeURIComponent(body.taskId)}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      });
      return json(200, await r.json().catch(() => ({ error: 'non-json response', status: r.status })));
    }

    // default: create
    if (!body.prompt) throw new Error('Missing prompt');
    let input: Record<string, unknown>;
    if (body.input && typeof body.input === 'object') {
      // full control mode: send ONLY prompt + caller's exact input (no auto fields
      // that could pollute a model's operation key, e.g. Kling's resolution_duration)
      input = { prompt: body.prompt, ...body.input };
    } else {
      // convenience mode (Seedance-style): sensible defaults
      input = {
        prompt: body.prompt,
        resolution: body.resolution || '720p',
        aspect_ratio: body.aspect_ratio || '3:4',
        duration: body.duration ?? 5,
        generate_audio: body.generate_audio ?? false,
      };
      if (body.first_frame_url) input.first_frame_url = body.first_frame_url;
      if (body.last_frame_url) input.last_frame_url = body.last_frame_url;
      if (Array.isArray(body.reference_image_urls)) input.reference_image_urls = body.reference_image_urls;
      if (Array.isArray(body.image_urls)) input.image_urls = body.image_urls;
    }

    const r = await fetch(`${BASE}/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: body.model || 'bytedance/seedance-2', input }),
    });
    const raw = await r.json().catch(() => ({ error: 'non-json response', status: r.status }));
    const taskId = raw?.data?.taskId || raw?.taskId || raw?.data?.task_id || null;
    return json(200, { http: r.status, taskId, raw });
  } catch (e: any) {
    return json(500, { error: e.message });
  }
});
