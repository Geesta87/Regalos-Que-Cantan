// supabase/functions/ad-studio/index.ts
// ===========================================================================
// AD STUDIO — owner-driven ad-video generator on Atlas Cloud (Seedance 2.5)
// ===========================================================================
// Productizes the 2026-08-19 "Podcast & Street" batch (RQC Seedances/05):
// spoken-dialogue ad clips with Seedance 2.5's native audio + Spanish
// lip-sync, generated on Atlas Cloud at $0.134/sec flat (~$4 per 30s clip,
// ~57% cheaper than the same model on Kie — verified 2026-08-14).
//
// Recipe rules baked into the script-writer (learned on that batch):
//   • Dialogue format that lip-syncs: CAPS speaker + stage direction + colon
//     + the Spanish line inline (WOMAN, counting on her fingers: Flores se
//     mueren.), wrapped in "Conversational Mexican Spanish with natural lip
//     sync". No quotation marks needed.
//   • NEVER ask the model to render on-screen text (URLs, prices as
//     graphics) — it comes out garbled every time. Every prompt ends
//     "No text or captions anywhere in the frame." URLs get burned on in
//     post with real ffmpeg text, not here.
//   • The first 3 seconds must work MUTED: a slow silent push-in before the
//     first line, prompted explicitly as a CAMERA: block.
//   • Scenes that imply a known song (birthday cake → "Las Mañanitas") get
//     the WHOLE generation blocked for audio copyright — avoid them, or
//     generate with audio off.
//   • Atlas image-to-video silently IGNORES image_url (bills, generates from
//     text only — verified 2026-08-21), so this studio is text-to-video only;
//     image-conditioned video lives in Character Studio (Kie).
//   • Finished renders get the Cloud Run finish pass (grain/crush de-slop)
//     by default — same believability step as Character Studio videos.
//
// Every finished render is REHOSTED into the public 'ad-studio' bucket
// because Atlas result URLs are provider-hosted and not permanent.
//
// Admin-only (role='admin' — it spends Atlas credits). Auth is enforced
// IN-HANDLER (service-role key for server-to-server, or a logged-in
// admin_users session; the anon key is rejected) because the gateway 401s a
// service-role Bearer when verify_jwt is on → verify_jwt = false in
// config.toml, same pattern as fix-song-section.
// Deploy: supabase functions deploy ad-studio --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ATLAS_API_KEY = Deno.env.get('ATLAS_API_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SCRIPT_MODEL = Deno.env.get('CREATIVE_CHAT_MODEL') || 'claude-opus-4-8';
const ATLAS = 'https://api.atlascloud.ai/api/v1/model';
const BUCKET = 'ad-studio';
const RENDERER_URL = Deno.env.get('INHOUSE_RENDERER_URL');
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN');

const VIDEO_MODEL_T2V = 'bytedance/seedance-2.5/text-to-video';
const COST_PER_SEC = 0.134; // Atlas flat rate, all variants
const MAX_BATCH = 3;

// Format briefs the script-writer works from. These describe the proven
// SHAPE of each ad; the owner's brief supplies the angle/content.
const FORMATS: Record<string, string> = {
  podcast:
    'A podcast-studio two-shot: a charismatic Mexican woman guest and a male host at a podcast table with microphones, warm studio light. She carries the message; he reacts naturally. Open with a slow silent push-in on the table (about 3 seconds, no dialogue) before the first line lands.',
  street:
    'A street-interview two-shot held on a busy Mexican-American market street, vendors working in the background, handheld documentary feel. An interviewer with a microphone and an expressive passerby. Open on the interviewer stopping them — the hook line is the first thing spoken.',
  reaction:
    'A candid emotional reaction filmed like a family phone video: someone plays a personalized song for a loved one (mom, wife, dad) and the camera holds on the listener\'s face as the song lands — surprise, hand to heart, tears. Minimal dialogue; the reaction is the ad.',
  custom: '',
};

// The script-writer's standing brief: product truth + the proven prompt
// mechanics from the 2026-08-19 batch + ad-craft direction (hooks, camera,
// structure). Shared by the initial write and every conversational refine.
const AD_SYSTEM = `You are the ad director for Regalos Que Cantan (regalosquecantan.com) — personalized custom songs, from $29.99, you hear the full song BEFORE paying, ready in minutes, for Spanish-speaking Latino families in the US. You write video-generation prompts for Seedance 2.5 (it generates the full clip INCLUDING spoken audio with lip-sync). People shown must be authentic Mexican/Latino, described concretely (age, hair, clothes).

WHAT MAKES A GREAT AD (apply to every script):
- THE FIRST 3 SECONDS DECIDE EVERYTHING, and they must work with the sound OFF: open on a committed camera move (a slow push-in, or a faster zoom toward a face or action when the brief wants energy) plus a small magnetic human moment — a knowing half-smile, a double-take, someone mid-laugh, a hand pausing over a gift. Nobody speaks during the opening move.
- The first SPOKEN line is a hook: a bold claim, a question the viewer would answer, or a pattern interrupt ("Los hombres siempre se equivocan con los regalos."). Never open with a greeting or an introduction.
- Structure a 25-30s ad as: visual hook (0-3s) → relatable tension or problem → the turn (the idea of a song with her name and her story — never framed as an ad) → an emotional or proof beat (a reaction, a testimonial detail) → a closer line, plus the spoken price/site when the brief asks for them.
- CAMERA CRAFT: direct the camera explicitly in a CAMERA: block — name the shots and moves (wide → slow push-in → settles into a medium two-shot; a slow punch-in on the key emotional line; gentle handheld sway for street realism). One or two deliberate moves per clip — more reads as chaos.
- ENGAGEMENT: specificity beats generality ("Perfume... ya tiene tres." not "many gifts"); natural humor and real reactions (a laugh, an eyebrow raise, a hand to the chest); small conversational overlaps. Warm and human, never salesy, never mention AI. The proven closer "Y esta no se muere." (flowers die, this gift doesn't) — use it when it fits.

HARD PROMPT RULES (all proven, never break them):
- ONE prompt in English describing scene, people, camera, and lighting. Spoken lines go inline in Spanish with NO quotation marks, each attributed as CAPS SPEAKER + a short stage direction + colon (e.g. WOMAN, counting on her fingers: Flores se mueren. Chocolates se acaban.). Include the phrase "Conversational Mexican Spanish with natural lip sync and small natural overlaps."
- Spanish speech fits ~2.2 words/sec — the dialogue must comfortably fit the clip length with room for the opening and reactions.
- NEVER ask for on-screen text, captions, logos, URLs, or price graphics — the model garbles rendered text. End every prompt with the exact sentence: No text or captions anywhere in the frame. Prices/URLs may only be SPOKEN (veintinueve noventa y nueve; the site as: Regalos Que Cantan punto com, pronounced as separate Spanish words).
- Close the scene description with a realism suffix (e.g. Genuine relaxed energy, realistic skin texture, podcast microphone audio texture, not polished. — street scenes: Real street ambience with market noise and voices, phone-microphone audio texture, casual and unpolished.).
- AVOID scenes that imply a well-known copyrighted song (birthday parties → Las Mañanitas) — the provider blocks the whole generation on audio copyright.

Always reply with STRICT JSON only:
{"label": "short internal name for this ad, max 50 chars", "prompt": "the full Seedance prompt", "reply": "1-2 friendly sentences to the owner about your creative choices or what you changed"}`;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ---------------------------------------------------------------------------
// Atlas helpers
// ---------------------------------------------------------------------------
async function atlasCreate(payload: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${ATLAS}/generateVideo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ATLAS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const raw = await r.json().catch(() => ({}));
  const id = raw?.data?.id || raw?.id;
  if (!id) throw new Error(`Atlas generateVideo failed (${r.status}): ${JSON.stringify(raw).slice(0, 300)}`);
  return String(id);
}

// Poll + finalize every 'generating' row: on completed download the video and
// rehost it into our bucket, then run the finish pass. 30s Seedance renders
// can take a while — only time out after 45 minutes.
async function finalize(admin: any) {
  const { data: rows } = await admin.from('ad_studio_generations')
    .select('id, prediction_id, created_at, meta')
    .eq('status', 'generating').not('prediction_id', 'is', null);
  for (const row of (rows || [])) {
    try {
      const r = await fetch(`${ATLAS}/prediction/${encodeURIComponent(row.prediction_id)}`, {
        headers: { Authorization: `Bearer ${ATLAS_API_KEY}` },
      });
      const raw = await r.json().catch(() => ({}));
      const d = raw?.data || raw;
      const st = d?.status;
      if (st === 'completed') {
        const url = Array.isArray(d?.outputs) ? d.outputs[0] : null;
        if (!url) throw new Error('completed but no outputs');
        const media = await fetch(url);
        if (!media.ok) throw new Error(`media fetch ${media.status}`);
        const bytes = new Uint8Array(await media.arrayBuffer());
        const path = `${row.id}.mp4`;
        const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true });
        if (up.error) throw up.error;
        const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
        // Keep BOTH versions: media_url is always the untouched ORIGINAL; the
        // grainy finish-pass version (when it succeeds) lands in
        // meta.finishedUrl so the gallery can offer an Original / Grainy
        // choice per render (owner request 2026-08-27).
        const finishMeta: Record<string, unknown> = {};
        if ((row.meta?.finish ?? 'standard') !== 'off') {
          const finished = await finishVideo(pub.publicUrl, String(row.meta?.finish || 'standard'), row.id);
          if (finished) { finishMeta.finishedUrl = finished; finishMeta.finished = true; }
          else finishMeta.finished = false;
        }
        await admin.from('ad_studio_generations').update({
          status: 'ready', media_url: pub.publicUrl,
          meta: { ...(row.meta || {}), ...finishMeta },
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      } else if (st === 'failed') {
        await admin.from('ad_studio_generations').update({
          status: 'failed', error: String(d?.error || 'atlas fail').slice(0, 400),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      } else if ((Date.now() - new Date(row.created_at).getTime()) / 60000 > 45) {
        await admin.from('ad_studio_generations').update({
          status: 'failed', error: 'stuck > 45m', updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      }
    } catch (e: any) {
      await admin.from('ad_studio_generations').update({
        status: 'failed', error: String(e?.message || e).slice(0, 400), updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    }
  }
}

// Finish pass ("de-slop") on the Cloud Run renderer — pre-ages the clip so it
// reads like real footage. Best-effort: a finish failure must never lose the
// render, so the caller keeps the original URL when this returns null.
async function finishVideo(rawUrl: string, strength: string, genId: string): Promise<string | null> {
  if (!RENDERER_URL || !RENDER_TOKEN) return null;
  try {
    const r = await fetch(`${RENDERER_URL.replace(/\/$/, '')}/finish-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN },
      body: JSON.stringify({
        video_url: rawUrl, strength, bucket: BUCKET,
        object_path: `${genId}-finished.mp4`,
      }),
    });
    const j = await r.json().catch(() => ({}));
    return j?.success && j?.url ? String(j.url) : null;
  } catch (_) {
    return null;
  }
}

// Claude writes the Spanish social copy for a render headed to Creative
// Studio. Best-effort: any failure falls back to a serviceable template — the
// owner edits copy in the approval queue anyway.
async function writeCaption(gen: any): Promise<{ headline: string; caption: string; hashtags: string[] }> {
  const fallback = {
    headline: 'Una canción hecha solo para alguien especial',
    caption: 'En Regalos Que Cantan creamos canciones personalizadas para quien más quieres. Cuéntanos su historia y nosotros la convertimos en música. 🎶',
    hashtags: ['RegalosQueCantan', 'CancionPersonalizada', 'RegaloOriginal', 'Musica'],
  };
  if (!ANTHROPIC_API_KEY) return fallback;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SCRIPT_MODEL,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You write ad copy for Regalos Que Cantan (regalosquecantan.com) — personalized custom songs for Spanish-speaking Latino families in the US. The video ad being posted shows: ${String(gen.prompt).slice(0, 400)}\n\nWrite warm, human Spanish copy (never salesy, never mention AI). Reply with STRICT JSON only:\n{"headline": "short hook, max 60 chars", "caption": "1-3 sentence Instagram/Facebook caption with a soft invitation to create a song", "hashtags": ["4-6 Spanish hashtags, no # symbol"]}`,
        }],
      }),
    });
    const j = await r.json();
    const text = j?.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]);
    return {
      headline: String(parsed.headline || fallback.headline).slice(0, 120),
      caption: String(parsed.caption || fallback.caption).slice(0, 1000),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map((h: unknown) => String(h).replace(/^#/, '')).slice(0, 6) : fallback.hashtags,
    };
  } catch (_) {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!ATLAS_API_KEY) throw new Error('ATLAS_API_KEY not set');

    // Auth: the service-role key (server-to-server / ops probes) OR a
    // logged-in dashboard user with admin_users.role = 'admin' — same
    // pattern as fix-song-section. The public anon key is rejected (spends
    // Atlas credits, so admins only).
    //
    // Service-role check: fast-path exact match against our own env, then a
    // GoTrue-verified fallback (auth.admin.listUsers succeeds ONLY for a
    // signature-valid service-role JWT). The fallback exists because the
    // project's JWT signing-key migration left TWO valid key generations —
    // the runtime env holds a newer service key than `supabase projects
    // api-keys` reveals, so external ops probes fail the string compare
    // (verified live 2026-08-26; fix-song-section has the same blind spot).
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const bearer = authHeader.slice(7).trim();
    let isService = bearer === SERVICE_ROLE;
    if (!isService && bearer !== SUPABASE_ANON_KEY) {
      try {
        const probe = createClient(SUPABASE_URL, bearer);
        const { error: pe } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
        isService = !pe;
      } catch (_) { isService = false; }
    }
    if (!isService) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: ud, error: ue } = await userClient.auth.getUser();
      if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
      const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
      if (!roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
      if (roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    // -- list: recent generations (finalizing pending ones first) --------------
    if (action === 'list') {
      await finalize(admin);
      const { data: generations } = await admin.from('ad_studio_generations').select('*')
        .order('created_at', { ascending: false }).limit(100);
      return json({ success: true, generations: generations || [] });
    }

    // -- write-script: Claude writes / conversationally refines the prompt -----
    // Initial write: { format, brief, duration }. Refine: also pass `history`
    // (the prior {role, content} exchange), a `note` (what to change), and
    // `currentPrompt` (the prompt box contents — carries manual edits back in).
    if (action === 'write-script') {
      if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
      const format = String(body.format || 'custom');
      const brief = String(body.brief || '').trim();
      const note = String(body.note || '').trim();
      if (!brief && !note) throw new Error('Tell me what the ad should say first');
      const duration = Math.min(Math.max(Number(body.duration) || 30, 4), 30);
      const formatLine = FORMATS[format] ?? '';
      const currentPrompt = String(body.currentPrompt || '').trim();
      const history = Array.isArray(body.history)
        ? body.history.slice(-12).map((m: any) => ({
            role: m?.role === 'assistant' ? 'assistant' : 'user',
            content: String(m?.content || '').slice(0, 8000),
          })).filter((m: any) => m.content)
        : [];

      const task = `FORMAT: ${format}${formatLine ? ` — ${formatLine}` : ' — the owner\'s brief defines the scene.'}
OWNER'S BRIEF: ${brief || '(see conversation)'}
CLIP LENGTH: ${duration} seconds.

Write the Seedance prompt for this ad.`;
      const messages: { role: string; content: string }[] = [{ role: 'user', content: task }, ...history];
      if (note) {
        messages.push({
          role: 'user',
          content: `${currentPrompt ? `CURRENT PROMPT (this is the live version — it may include my manual edits, refine THIS):\n${currentPrompt}\n\n` : ''}CHANGE REQUEST: ${note}\n\nApply the change and return the FULL updated prompt (not a diff). STRICT JSON only, same shape.`,
        });
      }

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: SCRIPT_MODEL, max_tokens: 1600, system: AD_SYSTEM, messages }),
      });
      const j = await r.json();
      const text = j?.content?.[0]?.text || '';
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Script writer returned no JSON — try again');
      const parsed = JSON.parse(m[0]);
      return json({
        success: true,
        label: String(parsed.label || '').slice(0, 80),
        prompt: String(parsed.prompt || '').trim(),
        reply: String(parsed.reply || '').slice(0, 500),
      });
    }

    // -- generate: fire 1-3 takes of the prompt on Atlas -----------------------
    if (action === 'generate') {
      const prompt = String(body.prompt || '').trim();
      if (!prompt) throw new Error('prompt is required');
      const format = String(body.format || 'custom');
      const duration = Math.min(Math.max(Number(body.duration) || 30, 4), 30);
      // 720p ONLY. Atlas outputs H.264 at 720p but 10-bit HEVC at 1080p
      // (verified by ffprobe 2026-08-26) — HEVC renders as BLACK VIDEO with
      // audio in Chrome and Windows players. The two 1080p clips from launch
      // day had to be hand-transcoded. Do not re-add 1080p unless the output
      // is transcoded to H.264 first (e.g. via the renderer finish pass).
      const resolution = '720p';
      const ratio = String(body.aspectRatio || '9:16');
      const generate_audio = body.generateAudio !== false;
      const model = body.model ? String(body.model) : VIDEO_MODEL_T2V;
      const count = Math.min(Math.max(Number(body.count) || 1, 1), MAX_BATCH);
      const finish = String(body.finish || 'standard');
      const estCostUsd = Math.round(duration * COST_PER_SEC * 100) / 100;

      const payload: Record<string, unknown> = {
        model, prompt, duration, resolution, ratio,
        output_format: 'mp4', generate_audio,
      };

      const gens = [];
      for (let i = 0; i < count; i++) {
        const { data: gen, error } = await admin.from('ad_studio_generations').insert({
          format, brief: body.brief ? String(body.brief).slice(0, 2000) : null,
          prompt, model, aspect_ratio: ratio, duration, resolution,
          meta: { generate_audio, finish, estCostUsd, label: body.label ? String(body.label).slice(0, 80) : null, take: count > 1 ? i + 1 : null },
        }).select().single();
        if (error) throw error;
        try {
          const predictionId = await atlasCreate(payload);
          await admin.from('ad_studio_generations').update({ prediction_id: predictionId }).eq('id', gen.id);
        } catch (e: any) {
          await admin.from('ad_studio_generations').update({
            status: 'failed', error: String(e?.message || e).slice(0, 400),
          }).eq('id', gen.id);
        }
        gens.push(gen);
      }
      return json({ success: true, generations: gens });
    }

    // -- send-to-creative: push a finished ad into the Creative Studio ---------
    // approval queue (creative_queue status='ready', intended_use='ad') so the
    // existing approve→post pipeline is the only exit. Captions are drafted
    // there by the owner; the prompt rides along as the concept.
    if (action === 'send-to-creative') {
      const { data: gen } = await admin.from('ad_studio_generations').select('*')
        .eq('id', String(body.generationId)).eq('status', 'ready').single();
      if (!gen?.media_url) throw new Error('That render is not ready');
      // The owner picks WHICH version ships: 'finished' (grainy) or 'original'.
      const wantFinished = body.variant === 'finished';
      const mediaUrl = wantFinished && gen.meta?.finishedUrl ? String(gen.meta.finishedUrl) : String(gen.media_url);
      const { data: dupe } = await admin.from('creative_queue').select('id').eq('media_url', mediaUrl).limit(1);
      if (dupe?.length) return json({ success: true, already: true });
      const label = gen.meta?.label || gen.brief || gen.prompt.slice(0, 100);
      const copy = await writeCaption(gen);
      const { error } = await admin.from('creative_queue').insert({
        batch_date: new Date().toISOString().slice(0, 10),
        kind: 'video',
        intended_use: 'ad',
        concept: `Ad Studio — ${String(label).slice(0, 140)}`,
        gen_prompt: gen.prompt,
        headline: copy.headline, caption: copy.caption, hashtags: copy.hashtags,
        score: 75, status: 'ready', media_url: mediaUrl,
      });
      if (error) throw error;
      await admin.from('ad_studio_generations').update({
        meta: { ...(gen.meta || {}), sentToCreative: true }, updated_at: new Date().toISOString(),
      }).eq('id', gen.id);
      return json({ success: true });
    }

    // -- delete-generation -----------------------------------------------------
    if (action === 'delete-generation') {
      const { data: gen } = await admin.from('ad_studio_generations').select('id, media_url')
        .eq('id', String(body.generationId)).single();
      if (gen) {
        await admin.storage.from(BUCKET).remove([`${gen.id}.mp4`, `${gen.id}-finished.mp4`]).catch(() => {});
        await admin.from('ad_studio_generations').delete().eq('id', gen.id);
      }
      return json({ success: true });
    }

    throw new Error(`Unknown action '${action}'`);
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
