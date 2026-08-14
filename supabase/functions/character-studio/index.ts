// supabase/functions/character-studio/index.ts
// ===========================================================================
// CHARACTER STUDIO — in-house AI influencer / brand-character builder
// ===========================================================================
// The "build it ourselves" replacement for Eromify-style tools (2026-08-13).
// Create a character (photoreal / Pixar 3D / illustrated / anime / custom),
// pick one portrait as the identity anchor, then generate identity-consistent
// images and videos from it — the exact recipe that produced Ace/Cruz/Nova and
// CENZO, productized:
//
//   • From-scratch renders (portrait candidates): google/nano-banana — the
//     style-defining model. nano-banana-edit will NOT change art style
//     (cartoon→real fails, per the CENZO build), so new looks start here.
//   • Identity-consistent images: google/nano-banana-edit with image_urls =
//     [portrait, ...reference stills] (Kie caps at 10) and a prompt that opens
//     "Keep the EXACT same person/character: …".
//   • Video: bytedance/seedance-2 — either from a generated still
//     (first_frame_url; + last_frame_url = same still for perfect loops) or
//     from the reference set (image_urls).
//
// Every finished render is REHOSTED into the public 'character-studio' bucket
// because Kie's result URLs expire (~14 days).
//
// Admin-only (role='admin' — it spends Kie credits): same auth pattern as
// creative-chat. Called from the dashboard with a logged-in Supabase Auth
// user's JWT → verify_jwt = true in config.toml.
// Deploy: supabase functions deploy character-studio --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CAPTION_MODEL = Deno.env.get('CREATIVE_CHAT_MODEL') || 'claude-opus-4-8';
const KIE = 'https://api.kie.ai/api/v1/jobs';
const BUCKET = 'character-studio';

// Verified-in-production Kie slugs (AgentHero + CENZO recipes). A custom slug
// can be passed per call (model / videoModel) to try Kling/Veo/etc without a
// code change — it goes straight into createTask's model field.
const IMAGE_MODEL = 'google/nano-banana';
const IMAGE_EDIT_MODEL = 'google/nano-banana-edit';
// Candid engine (bake-off winner 2026-08-14): FLUX-2 with identity refs gives
// the "shot on a phone" realism nano-banana's polish can't reach, and its
// filter accepts imperfection language Google's refuses. Field is input_urls
// (not image_urls) and it requires resolution.
const IMAGE_CANDID_MODEL = 'flux-2/pro-image-to-image';
const VIDEO_MODEL = 'bytedance/seedance-2';
// Grok Imagine 1.5 (owner-approved 2026-08-14): the studio's DEFAULT video
// engine. Native audio + Spanish lip-sync, and it animates ONE image — so the
// face always comes from her pixels (no reference-drift path exists). Loops
// (first=last frame) are a Seedance-only trick; duration floor is 6s.
const GROK_VIDEO_MODEL = 'grok-imagine/image-to-video';

// The phone-frame doctrine prepended to every Candid render. Camera flaws
// (grain/crush) are added in post — this carries scene + texture realism only.
const CANDID_DOCTRINE =
  'A frame from a casual selfie-style video shot on a phone, imperfect off-center framing, warm ordinary indoor lighting, slightly uneven exposure, real skin texture with natural shine, amateur phone photo realism, ordinary and unpolished.';

const PORTRAIT_CANDIDATES = 3;
const MAX_REFS = 9; // + portrait = Kie's 10-image cap on image_urls
const MAX_BATCH = 3; // takes per generate call (images cost cents; videos capped the same)

// Identity kit — the 6 canonical shots that teach the edit model her from
// every angle/expression. Owner pins the winners as references afterwards
// (deliberately NOT auto-pinned: eyes stay the quality gate).
const KIT_SHOTS = [
  'Three-quarter angle portrait, looking slightly off camera, soft directional light.',
  'Side profile portrait, clean simple background.',
  'Full body shot, standing, natural relaxed pose, simple background.',
  'Close-up with a big warm genuine laugh.',
  'Medium shot from the waist up, arms crossed, confident friendly smile.',
  'Walking outdoors at golden hour, medium-wide shot, warm sunset backlight.',
];

// Style-defining prompt prefixes for from-scratch portraits. The negative
// phrasing ("NOT photorealistic") is load-bearing — it's what forced full
// stylization in the generate-likeness pipeline.
const STYLE_PROMPTS: Record<string, string> = {
  photoreal:
    'Ultra-realistic professional photograph shot on a mirrorless camera with a 50mm lens, natural skin texture, soft natural lighting, shallow depth of field. A real human photo — NOT illustrated, NOT cartoon, NOT 3D render.',
  pixar:
    '3D CARTOON character in the style of a modern Pixar animated film — NOT photorealistic. Soft cinematic lighting, expressive oversized eyes, appealing stylization, high-end 3D render.',
  illustrated:
    'Modern flat digital illustration, clean confident shapes, editorial illustration style, rich color palette. NOT photorealistic, NOT 3D.',
  anime:
    'High-quality anime character art, clean line work, cel shading, detailed eyes, studio-quality key visual. NOT photorealistic.',
  custom: '',
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ---------------------------------------------------------------------------
// Kie helpers
// ---------------------------------------------------------------------------
async function kieCreate(model: string, input: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${KIE}/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  const j = await r.json().catch(() => ({}));
  const id = j?.data?.taskId || j?.taskId;
  if (!id) throw new Error(`Kie createTask failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
  return id;
}

// Poll + finalize every 'generating' row for one character (or a specific id
// list): on success download the media and rehost it into our bucket. Videos
// can take a while on Kie — only time out after 30 minutes.
async function finalize(admin: any, characterId?: string, ids?: string[]) {
  let q = admin.from('studio_generations')
    .select('id, character_id, kind, kie_task_id, created_at, meta')
    .eq('status', 'generating').not('kie_task_id', 'is', null);
  if (ids?.length) q = q.in('id', ids);
  else if (characterId) q = q.eq('character_id', characterId);
  const { data: rows } = await q;
  for (const row of (rows || [])) {
    try {
      const r = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(row.kie_task_id)}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      });
      const info = await r.json().catch(() => ({}));
      const st = info?.data?.state;
      if (st === 'success') {
        const result = JSON.parse(info.data.resultJson || '{}');
        const url = (result.resultUrls || [])[0];
        if (!url) throw new Error('no resultUrls');
        const media = await fetch(url);
        if (!media.ok) throw new Error(`media fetch ${media.status}`);
        const bytes = new Uint8Array(await media.arrayBuffer());
        const ext = row.kind === 'video' ? 'mp4' : 'png';
        const path = `${row.character_id}/${row.id}.${ext}`;
        const up = await admin.storage.from(BUCKET).upload(path, bytes, {
          contentType: row.kind === 'video' ? 'video/mp4' : 'image/png', upsert: true,
        });
        if (up.error) throw up.error;
        const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
        await admin.from('studio_generations').update({
          status: 'ready', media_url: pub.publicUrl,
          meta: { ...(row.meta || {}), creditsConsumed: info?.data?.creditsConsumed ?? null },
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      } else if (st === 'fail' || info?.data?.failCode) {
        await admin.from('studio_generations').update({
          status: 'failed', error: String(info?.data?.failMsg || 'kie fail').slice(0, 400),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      } else if ((Date.now() - new Date(row.created_at).getTime()) / 60000 > 30) {
        await admin.from('studio_generations').update({
          status: 'failed', error: 'stuck > 30m', updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      }
    } catch (e: any) {
      await admin.from('studio_generations').update({
        status: 'failed', error: String(e?.message || e).slice(0, 400), updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    }
  }
}

// Fire one from-scratch portrait candidate. Returns the generation row id.
async function firePortrait(admin: any, ch: any, note?: string): Promise<string> {
  const stylePrefix = STYLE_PROMPTS[ch.style] ?? '';
  const prompt = [
    stylePrefix,
    `Head-and-shoulders portrait of ${ch.description}.`,
    'Single person, facing the camera, warm friendly expression, clean simple background, centered composition.',
    note ? `Additional direction: ${note}` : '',
  ].filter(Boolean).join(' ');
  const model = ch.image_model || IMAGE_MODEL;
  const { data: gen, error } = await admin.from('studio_generations').insert({
    character_id: ch.id, kind: 'portrait', prompt, model, aspect_ratio: '3:4',
  }).select().single();
  if (error) throw error;
  try {
    const taskId = await kieCreate(model, { prompt, aspect_ratio: '3:4', output_format: 'png' });
    await admin.from('studio_generations').update({ kie_task_id: taskId }).eq('id', gen.id);
  } catch (e: any) {
    await admin.from('studio_generations').update({
      status: 'failed', error: String(e?.message || e).slice(0, 400),
    }).eq('id', gen.id);
  }
  return gen.id;
}

// Fire one identity-referenced image render (used by generate + identity-kit).
async function fireRefImage(admin: any, ch: any, prompt: string, opts: {
  model?: string; aspect?: string; refs: string[]; meta?: Record<string, unknown>;
}) {
  const model = opts.model || IMAGE_EDIT_MODEL;
  const aspect_ratio = opts.aspect || '3:4';
  const { data: gen, error } = await admin.from('studio_generations').insert({
    character_id: ch.id, kind: 'image', prompt, model, aspect_ratio, meta: opts.meta || {},
  }).select().single();
  if (error) throw error;
  try {
    const taskId = await kieCreate(model, { prompt, image_urls: opts.refs, aspect_ratio, output_format: 'png' });
    await admin.from('studio_generations').update({ kie_task_id: taskId }).eq('id', gen.id);
  } catch (e: any) {
    await admin.from('studio_generations').update({ status: 'failed', error: String(e?.message || e).slice(0, 400) }).eq('id', gen.id);
  }
  return gen;
}

// Claude writes the Spanish social copy for a render headed to Creative
// Studio. Best-effort: any failure falls back to a serviceable template — the
// owner edits copy in the approval queue anyway.
async function writeCaption(ch: any, gen: any): Promise<{ headline: string; caption: string; hashtags: string[] }> {
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
        model: CAPTION_MODEL,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You write social copy for Regalos Que Cantan (regalosquecantan.com) — personalized custom songs for Spanish-speaking Latino families in the US. "${ch.name}" is our brand host character. The ${gen.kind} being posted shows: ${gen.prompt.slice(0, 400)}\n\nWrite warm, human Spanish copy (never salesy, never mention AI). Reply with STRICT JSON only:\n{"headline": "short hook, max 60 chars", "caption": "1-3 sentence Instagram/Facebook caption with a soft invitation to create a song", "hashtags": ["4-6 Spanish hashtags, no # symbol"]}`,
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

async function getCharacter(admin: any, id: string) {
  const { data, error } = await admin.from('studio_characters').select('*').eq('id', id).single();
  if (error || !data) throw new Error('Character not found');
  return data;
}

// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!KIE_API_KEY) throw new Error('KIE_API_KEY not set');

    // Auth: logged-in dashboard user with admin_users.role = 'admin' — same
    // block as creative-chat (spends Kie credits, so admins only).
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
    if (roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    // -- list: all characters + their generations (finalizing pending first) --
    if (action === 'list') {
      await finalize(admin, body.characterId || undefined);
      const { data: characters } = await admin.from('studio_characters').select('*')
        .neq('status', 'archived').order('created_at', { ascending: false });
      let generations: any[] = [];
      if (body.characterId) {
        const { data: gens } = await admin.from('studio_generations').select('*')
          .eq('character_id', body.characterId).order('created_at', { ascending: false }).limit(200);
        generations = gens || [];
      }
      return json({ success: true, characters: characters || [], generations });
    }

    // -- create-character: insert + fire portrait candidates --------------------
    if (action === 'create-character') {
      const name = String(body.name || '').trim();
      const description = String(body.description || '').trim();
      const style = String(body.style || 'photoreal');
      if (!name || !description) throw new Error('name and description are required');
      if (!(style in STYLE_PROMPTS)) throw new Error(`Unknown style '${style}'`);
      const image_model = body.model ? String(body.model).trim() : null; // optional custom Kie slug
      const { data: ch, error } = await admin.from('studio_characters').insert({
        name, description, style, image_model,
      }).select().single();
      if (error) throw error;
      for (let i = 0; i < PORTRAIT_CANDIDATES; i++) await firePortrait(admin, ch);
      return json({ success: true, character: ch });
    }

    // -- more-portraits: 3 more candidates, optional steering note -------------
    if (action === 'more-portraits') {
      const ch = await getCharacter(admin, body.characterId);
      for (let i = 0; i < PORTRAIT_CANDIDATES; i++) await firePortrait(admin, ch, body.note ? String(body.note) : undefined);
      return json({ success: true });
    }

    // -- choose-portrait: candidate becomes the identity anchor ----------------
    if (action === 'choose-portrait') {
      const ch = await getCharacter(admin, body.characterId);
      const { data: gen } = await admin.from('studio_generations').select('*')
        .eq('id', body.generationId).eq('character_id', ch.id).eq('status', 'ready').single();
      if (!gen?.media_url) throw new Error('That candidate is not ready');
      await admin.from('studio_characters').update({
        portrait_url: gen.media_url, status: 'active', updated_at: new Date().toISOString(),
      }).eq('id', ch.id);
      return json({ success: true });
    }

    // -- generate: identity-consistent image or video --------------------------
    if (action === 'generate') {
      const ch = await getCharacter(admin, body.characterId);
      if (!ch.portrait_url) throw new Error('Pick a portrait first');
      const kind = body.kind === 'video' ? 'video' : 'image';
      const userPrompt = String(body.prompt || '').trim();
      if (!userPrompt) throw new Error('prompt is required');
      const refs = [ch.portrait_url, ...((ch.reference_urls || []) as string[])].slice(0, 10);
      // The CENZO-proven identity clause — same opening for images and videos.
      const identity = `Keep the EXACT same ${ch.style === 'photoreal' ? 'person' : 'character'} as in the reference image${refs.length > 1 ? 's' : ''}: ${ch.description}. Same face, same identity, no drift.`;

      // Batch: fire N independent takes of the same prompt (models are
      // stochastic — 3 takes ≈ 3 different variations, pick the winner).
      const count = Math.min(Math.max(Number(body.count) || 1, 1), MAX_BATCH);

      if (kind === 'image') {
        const look = body.look === 'candid' ? 'candid' : 'polished';
        const prompt = look === 'candid'
          ? `${identity} ${CANDID_DOCTRINE} ${userPrompt}`
          : `${identity} ${userPrompt}`;
        const gens = [];
        for (let i = 0; i < count; i++) {
          if (look === 'candid' && !body.model) {
            // FLUX path — different field names than the nano-banana family.
            const aspect_ratio = String(body.aspectRatio || '9:16');
            const { data: gen, error } = await admin.from('studio_generations').insert({
              character_id: ch.id, kind: 'image', prompt, model: IMAGE_CANDID_MODEL, aspect_ratio, meta: { look },
            }).select().single();
            if (error) throw error;
            try {
              const taskId = await kieCreate(IMAGE_CANDID_MODEL, { prompt, input_urls: refs, aspect_ratio, resolution: '1K' });
              await admin.from('studio_generations').update({ kie_task_id: taskId }).eq('id', gen.id);
            } catch (e: any) {
              await admin.from('studio_generations').update({ status: 'failed', error: String(e?.message || e).slice(0, 400) }).eq('id', gen.id);
            }
            gens.push(gen);
          } else {
            gens.push(await fireRefImage(admin, ch, prompt, {
              model: body.model ? String(body.model) : undefined,
              aspect: String(body.aspectRatio || '3:4'), refs, meta: { look },
            }));
          }
        }
        return json({ success: true, generations: gens });
      }

      // video
      const engine = body.videoEngine === 'seedance' ? 'seedance' : 'grok';
      const aspect_ratio = String(body.aspectRatio || '9:16');
      const fromImageUrl = body.fromImageUrl ? String(body.fromImageUrl) : null;
      const loop = engine === 'seedance' && Boolean(body.loop) && !!fromImageUrl;
      let model: string;
      let duration: number;
      let prompt: string;
      let input: Record<string, unknown>;
      if (engine === 'grok') {
        // Grok animates ONE image — fall back to the portrait so an image
        // source ALWAYS exists (this is what kills the six-different-women
        // drift: there is no references-only video path on Grok).
        const source = fromImageUrl || ch.portrait_url;
        model = String(body.model || GROK_VIDEO_MODEL);
        duration = Math.min(Math.max(Number(body.duration) || 8, 6), 15);
        prompt = userPrompt;
        input = {
          prompt, image_urls: [source], mode: 'normal', duration,
          resolution: String(body.resolution || '720p'), aspect_ratio,
        };
      } else {
        model = String(body.model || VIDEO_MODEL);
        duration = Math.min(Math.max(Number(body.duration) || 5, 3), 12);
        prompt = fromImageUrl ? userPrompt : `${identity} ${userPrompt}`;
        input = {
          prompt, resolution: String(body.resolution || '720p'), aspect_ratio, duration, generate_audio: false,
        };
        if (fromImageUrl) {
          // Animate a chosen still; first=last frame → a perfect loop (Ace/CENZO trick).
          input.first_frame_url = fromImageUrl;
          if (loop) input.last_frame_url = fromImageUrl;
        } else {
          input.image_urls = refs;
        }
      }
      const gens = [];
      for (let i = 0; i < count; i++) {
        const { data: gen, error } = await admin.from('studio_generations').insert({
          character_id: ch.id, kind: 'video', prompt, model, aspect_ratio, duration,
          meta: { engine, fromImageUrl, loop, resolution: input.resolution },
        }).select().single();
        if (error) throw error;
        try {
          const taskId = await kieCreate(model, input);
          await admin.from('studio_generations').update({ kie_task_id: taskId }).eq('id', gen.id);
        } catch (e: any) {
          await admin.from('studio_generations').update({ status: 'failed', error: String(e?.message || e).slice(0, 400) }).eq('id', gen.id);
        }
        gens.push(gen);
      }
      return json({ success: true, generations: gens });
    }

    // -- identity-kit: the 6 canonical reference shots in one click ------------
    if (action === 'identity-kit') {
      const ch = await getCharacter(admin, body.characterId);
      if (!ch.portrait_url) throw new Error('Pick a portrait first');
      const refs = [ch.portrait_url, ...((ch.reference_urls || []) as string[])].slice(0, 10);
      const identity = `Keep the EXACT same ${ch.style === 'photoreal' ? 'person' : 'character'} as in the reference image${refs.length > 1 ? 's' : ''}: ${ch.description}. Same face, same identity, no drift.`;
      for (const shot of KIT_SHOTS) {
        await fireRefImage(admin, ch, `${identity} ${shot}`, { refs, meta: { kit: true } });
      }
      return json({ success: true, fired: KIT_SHOTS.length });
    }

    // -- send-to-creative: push a finished render into the Creative Studio -----
    // approval queue (creative_queue status='ready'), with Claude-drafted
    // Spanish copy the owner can edit there before approving. Never posts
    // anything by itself — the existing approve→GHL pipeline is the only exit.
    if (action === 'send-to-creative') {
      const { data: gen } = await admin.from('studio_generations').select('*')
        .eq('id', String(body.generationId)).eq('status', 'ready').single();
      if (!gen?.media_url) throw new Error('That render is not ready');
      const ch = await getCharacter(admin, gen.character_id);
      // Dedupe: the same render queued twice would post twice once approved.
      const { data: dupe } = await admin.from('creative_queue').select('id').eq('media_url', gen.media_url).limit(1);
      if (dupe?.length) return json({ success: true, already: true });
      const copy = await writeCaption(ch, gen);
      const { error } = await admin.from('creative_queue').insert({
        batch_date: new Date().toISOString().slice(0, 10),
        kind: gen.kind === 'video' ? 'video' : 'image',
        intended_use: 'social',
        concept: `Character Studio — ${ch.name}: ${gen.prompt.slice(0, 140)}`,
        gen_prompt: gen.prompt,
        headline: copy.headline, caption: copy.caption, hashtags: copy.hashtags,
        score: 75, status: 'ready', media_url: gen.media_url,
      });
      if (error) throw error;
      await admin.from('studio_generations').update({
        meta: { ...(gen.meta || {}), sentToCreative: true }, updated_at: new Date().toISOString(),
      }).eq('id', gen.id);
      return json({ success: true });
    }

    // -- upload-image: bring an EXTERNAL photo of the character into the -------
    // gallery (e.g. a Higgsfield Soul render). Stored in our bucket and
    // inserted as a ready generation, so every existing tool works on it:
    // animate (Grok/Seedance), pin as reference, send to Creative Studio.
    if (action === 'upload-image') {
      const ch = await getCharacter(admin, body.characterId);
      const dataUrl = String(body.dataUrl || '');
      const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
      if (!m) throw new Error('Send a PNG, JPEG or WebP image');
      const contentType = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      if (bytes.length > 12 * 1024 * 1024) throw new Error('Image too large (max 12MB)');
      const filename = String(body.filename || 'upload').slice(0, 120);
      const { data: gen, error } = await admin.from('studio_generations').insert({
        character_id: ch.id, kind: 'image', prompt: `Uploaded — ${filename}`, model: 'upload',
        status: 'ready', meta: { uploaded: true, filename },
      }).select().single();
      if (error) throw error;
      // Path keeps the .png suffix regardless of source type (delete-generation
      // derives paths from it); the stored contentType is what browsers obey.
      const path = `${ch.id}/${gen.id}.png`;
      const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (up.error) { await admin.from('studio_generations').delete().eq('id', gen.id); throw up.error; }
      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
      await admin.from('studio_generations').update({ media_url: pub.publicUrl }).eq('id', gen.id);
      return json({ success: true });
    }

    // -- add-reference / remove-reference: extra identity stills ---------------
    if (action === 'add-reference') {
      const ch = await getCharacter(admin, body.characterId);
      const { data: gen } = await admin.from('studio_generations').select('media_url, kind, status')
        .eq('id', body.generationId).eq('character_id', ch.id).single();
      if (!gen?.media_url || gen.status !== 'ready' || gen.kind === 'video') throw new Error('Only finished images can be references');
      const refs: string[] = (ch.reference_urls || []).filter((u: string) => u !== gen.media_url);
      if (refs.length >= MAX_REFS) throw new Error(`Max ${MAX_REFS} references`);
      refs.push(gen.media_url);
      await admin.from('studio_characters').update({ reference_urls: refs, updated_at: new Date().toISOString() }).eq('id', ch.id);
      return json({ success: true, reference_urls: refs });
    }
    if (action === 'remove-reference') {
      const ch = await getCharacter(admin, body.characterId);
      const refs: string[] = (ch.reference_urls || []).filter((u: string) => u !== String(body.url || ''));
      await admin.from('studio_characters').update({ reference_urls: refs, updated_at: new Date().toISOString() }).eq('id', ch.id);
      return json({ success: true, reference_urls: refs });
    }

    // -- update-character / archive-character / delete-generation --------------
    if (action === 'update-character') {
      const ch = await getCharacter(admin, body.characterId);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.name) patch.name = String(body.name).trim();
      if (body.description) patch.description = String(body.description).trim();
      if (body.model !== undefined) patch.image_model = body.model ? String(body.model).trim() : null;
      await admin.from('studio_characters').update(patch).eq('id', ch.id);
      return json({ success: true });
    }
    if (action === 'archive-character') {
      await admin.from('studio_characters').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', String(body.characterId));
      return json({ success: true });
    }
    if (action === 'delete-generation') {
      const { data: gen } = await admin.from('studio_generations').select('id, character_id, kind, media_url').eq('id', String(body.generationId)).single();
      if (gen) {
        // Never delete the current portrait / a reference out from under the character.
        const ch = await getCharacter(admin, gen.character_id);
        if (gen.media_url && (gen.media_url === ch.portrait_url || (ch.reference_urls || []).includes(gen.media_url))) {
          throw new Error('That image is the portrait or a reference — remove it there first');
        }
        if (gen.media_url) {
          const ext = gen.kind === 'video' ? 'mp4' : 'png';
          await admin.storage.from(BUCKET).remove([`${gen.character_id}/${gen.id}.${ext}`]).catch(() => {});
        }
        await admin.from('studio_generations').delete().eq('id', gen.id);
      }
      return json({ success: true });
    }

    throw new Error(`Unknown action '${action}'`);
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
