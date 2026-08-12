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
//   { mode: 'music', prompt (lyrics), style, title, vocalGender?, negativeTags? }
//                                                               -> returns { taskId, raw }
//   { mode: 'music-status', taskId }                            -> returns Kie record-info payload
//   { mode: 'lyrics', taskId, audioId }                         -> Suno's ALIGNED lyric timings
//   { mode: 'replace-section', taskId, audioId, prompt, tags, title,
//     infillStartS, infillEndS, fullLyrics, negativeTags? }     -> returns { taskId, raw }
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

    // --- Suno music (house tracks for ad builds) -----------------------------
    // Kie's music API lives on a DIFFERENT base path than the unified jobs API
    // above (/api/v1/generate, not /api/v1/jobs), so it needs its own branch.
    // No callBackUrl: standalone one-off tracks are polled, not delivered to a
    // song row. Never point this at a customer order — use generate-song.
    if (body.mode === 'music') {
      if (!body.prompt) throw new Error('Missing prompt (lyrics)');
      const payload = {
        prompt: String(body.prompt).substring(0, 5000),
        customMode: true,
        instrumental: false,
        model: body.model || Deno.env.get('KIE_MODEL') || 'V5_5',
        // Kie rejects the request without one, but a standalone house track has
        // no song row to deliver to. Point it back at this same function: the
        // callback arrives with no `mode`, throws "Missing prompt" and 500s.
        // Deliberately NOT song-callback — that would touch real order rows.
        callBackUrl: body.callBackUrl || 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/test-kie-video',
        style: String(body.style || '').substring(0, 1000),
        title: String(body.title || 'untitled').substring(0, 80),
        vocalGender: body.vocalGender || 'f',
        negativeTags: String(body.negativeTags || '').substring(0, 200),
        styleWeight: body.styleWeight ?? 0.85,
        weirdnessConstraint: body.weirdnessConstraint ?? 0.3,
        audioWeight: body.audioWeight ?? 0.7,
      };
      const r = await fetch('https://api.kie.ai/api/v1/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await r.json().catch(() => ({ error: 'non-json response', status: r.status }));
      return json(200, { http: r.status, taskId: raw?.data?.taskId || null, raw });
    }

    // --- Replace-section passthrough (RESCUE tool) ---------------------------
    // The fix-song pipeline owns the real flow (it plans the window with Claude,
    // validates with Whisper, chains fixes and logs attempts) — use it, not this.
    // This is the manual override for rescuing ONE already-generated take when
    // the ladder has stalled and the owner is waiting: the operator supplies the
    // window and the corrected section text directly.
    //
    // Why it earns its keep (2026-08-12, Rafael 9dd5efe4): a chorus line that
    // repeats needs a SECOND window on the FIRST fix's take, and re-running the
    // whole pipeline regenerates from scratch. Nothing here touches a song row —
    // the result is a Kie-hosted take that still has to be previewed and applied
    // through fix-song-section like any other.
    if (body.mode === 'replace-section') {
      for (const k of ['taskId', 'audioId', 'prompt', 'fullLyrics']) {
        if (!body[k]) throw new Error(`Missing ${k}`);
      }
      const startS = Number(body.infillStartS);
      const endS = Number(body.infillEndS);
      if (!(endS > startS)) throw new Error('infillEndS must be greater than infillStartS');
      // Kie's hard limits — fail loudly here rather than getting a vague 400.
      const span = endS - startS;
      if (span < 6 || span > 60) throw new Error(`window must be 6-60s (got ${span.toFixed(1)}s)`);
      const payload = {
        taskId: body.taskId,
        audioId: body.audioId,
        prompt: String(body.prompt).substring(0, 1000),
        tags: String(body.tags || '').substring(0, 1000),
        title: String(body.title || 'untitled').substring(0, 80),
        infillStartS: startS,
        infillEndS: endS,
        fullLyrics: String(body.fullLyrics).substring(0, 5000),
        negativeTags: String(body.negativeTags || '').substring(0, 200),
        model: body.model || Deno.env.get('KIE_MODEL') || 'V5_5',
        callBackUrl: body.callBackUrl || 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/test-kie-video',
      };
      const r = await fetch('https://api.kie.ai/api/v1/generate/replace-section', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await r.json().catch(() => ({ error: 'non-json response', status: r.status }));
      return json(200, { http: r.status, taskId: raw?.data?.taskId || null, raw });
    }

    // Word-level sung timings straight from Suno, for cutting a song to picture.
    // transcribe-song does this too but only for a songId in the DB; ad tracks
    // have no song row, so this takes the raw {taskId, audioId} instead.
    //
    // NOT A TRANSCRIPT (2026-08-12): Suno ALIGNS the lyric sheet it was given to
    // the audio, so these words are what Suno was ASKED to sing. If the take
    // dropped or changed a word, this endpoint still reports the sheet's version.
    // Verifying a correction landed took a Whisper pass (transcribe-song with a
    // raw {audioUrl}); this endpoint reported a fix in a chorus the audio never
    // sang. Use it for TIMING and STRUCTURE, never to prove wording.
    if (body.mode === 'lyrics') {
      if (!body.taskId || !body.audioId) throw new Error('Missing taskId or audioId');
      const r = await fetch('https://api.kie.ai/api/v1/generate/get-timestamped-lyrics', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: body.taskId, audioId: body.audioId }),
      });
      return json(200, await r.json().catch(() => ({ error: 'non-json response', status: r.status })));
    }

    if (body.mode === 'music-status') {
      if (!body.taskId) throw new Error('Missing taskId');
      const r = await fetch(
        `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(body.taskId)}`,
        { headers: { Authorization: `Bearer ${KIE_API_KEY}` } },
      );
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
