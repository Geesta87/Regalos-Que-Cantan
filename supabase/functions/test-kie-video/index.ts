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

    // CALLBACK RECEIPT — must 200 (2026-08-12). Kie posts the finished job to
    // callBackUrl; a callback that does not answer 2xx makes Kie mark the task
    // GENERATE_AUDIO_FAILED / "Internal Error, Please try again later" even
    // though the audio generated fine. This harness used to default callBackUrl
    // to itself, where a mode-less body threw "Missing prompt" and returned 500
    // — so every job submitted through it "failed", and because callBackUrl is
    // NOT echoed in Kie's stored `param`, a field-by-field diff against a
    // successful production task showed no difference. That cost an hour and a
    // wrong "Kie is down" call. Swallow the callback quietly instead.
    if (!body.mode && (body.data || body.code || body.msg)) {
      return json(200, { ok: true, received: true });
    }

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
      } as Record<string, unknown>;
      // Same-voice re-roll: pass the song's minted persona so the new take is
      // sung by the ORIGINAL singer, not a fresh voice. Mirrors
      // fix-song-section's submitFullGenerate exactly (personaModel is required
      // alongside personaId; `duration` is V5_5-only length pinning). Pinning is
      // OPTIONAL on purpose — a pinned take can pad the sheet with repeated
      // sections, so unpinned is the escalation, not the fallback.
      if (body.personaId) { payload.personaId = body.personaId; payload.personaModel = 'voice_persona'; }
      if (body.durationS && body.durationS >= 10 && body.durationS <= 360) payload.duration = Math.round(body.durationS);
      const r = await fetch('https://api.kie.ai/api/v1/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await r.json().catch(() => ({ error: 'non-json response', status: r.status }));
      return json(200, { http: r.status, taskId: raw?.data?.taskId || null, raw });
    }

    // --- Account credit balance ---------------------------------------------
    // Read-only. "Credits insufficient" is normally transient here (the account
    // auto-tops-up), so a low balance is easy to ASSUME rather than check —
    // which is exactly why this exists. Tries the known credit paths and reports
    // whichever answers.
    if (body.mode === 'credits') {
      const paths = [
        'https://api.kie.ai/api/v1/chat/credit',
        'https://api.kie.ai/api/v1/common/credit',
        'https://api.kie.ai/api/v1/generate/credit',
      ];
      const out: unknown[] = [];
      for (const p of paths) {
        try {
          const r = await fetch(p, { headers: { Authorization: `Bearer ${KIE_API_KEY}` } });
          const txt = await r.text();
          out.push({ path: p, http: r.status, body: txt.slice(0, 300) });
        } catch (e) {
          out.push({ path: p, error: String((e as Error).message).slice(0, 120) });
        }
      }
      return json(200, { results: out });
    }

    // --- Mint a voice persona from an existing take (RESCUE tool) ------------
    // Kie clones the singer from a 10-30s vocal window of a finished take; the
    // returned personaId then re-sings a whole song in THAT voice (mode 'music'
    // with personaId). fix-song-section owns the real flow — it persists the id
    // into songs.kie_source.personaId so a song is only ever minted ONCE. If you
    // mint here, write the id back to that column yourself or the next full
    // re-roll pays to mint a second one.
    if (body.mode === 'mint-persona') {
      if (!body.taskId || !body.audioId) throw new Error('Missing taskId or audioId');
      const r = await fetch('https://api.kie.ai/api/v1/generate/generate-persona', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: body.taskId,
          audioId: body.audioId,
          name: String(body.name || 'voz').substring(0, 60),
          description: String(body.description || '').substring(0, 300),
          vocalStart: Number(body.vocalStart) >= 0 ? Number(body.vocalStart) : 12,
          vocalEnd: Number(body.vocalEnd) > 0 ? Number(body.vocalEnd) : 40,
        }),
      });
      const raw = await r.json().catch(() => ({ error: 'non-json response', status: r.status }));
      return json(200, { http: r.status, personaId: raw?.data?.personaId || null, raw });
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
      for (const k of ['prompt', 'fullLyrics']) {
        if (!body[k]) throw new Error(`Missing ${k}`);
      }
      // Kie takes the source as EITHER {taskId + audioId} (a track it already
      // hosts) OR {uploadUrl + model} (audio we hand it). Same infill either
      // way — everything outside the window stays the source audio.
      const byUpload = !!body.uploadUrl;
      if (!byUpload && !(body.taskId && body.audioId)) {
        throw new Error('Need taskId+audioId, or uploadUrl');
      }
      const startS = Number(body.infillStartS);
      const endS = Number(body.infillEndS);
      if (!(endS > startS)) throw new Error('infillEndS must be greater than infillStartS');
      // Kie's hard limits — fail loudly here rather than getting a vague 400.
      const span = endS - startS;
      // 10 is Kie's real floor (422 "Selected section must be between 10-480
      // seconds"); 60 is our own ceiling, same as fix-song-section's.
      if (span < 10 || span > 60) throw new Error(`window must be 10-60s (got ${span.toFixed(1)}s)`);
      const payload: Record<string, unknown> = {
        ...(byUpload ? { uploadUrl: body.uploadUrl } : { taskId: body.taskId, audioId: body.audioId }),
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
