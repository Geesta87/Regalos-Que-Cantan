// supabase/functions/creative-chat/index.ts
// ===========================================================================
// CREATIVE STUDIO — art-director CHAT
// ===========================================================================
// In-dashboard chat with Claude (the art director). The owner can:
//   • brainstorm style/angles
//   • generate visuals on demand → they render via Kie and appear inline
//   • save lasting style preferences (the daily generator then follows them)
//   • tweak a specific creative
//
// Claude runs a tool-use loop with three tools: generate_creative,
// tweak_creative, save_style_preference. Generated media lands in creative_queue
// (same pipeline as the daily agent); this function ALSO finalizes 'generating'
// chat creatives on each 'sync' so they appear in the chat within seconds
// (instead of waiting for the 2-min poller).
//
// Admin-only (generates → spends Kie credits). verify_jwt = true.
// Deploy: supabase functions deploy creative-chat --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { applyLogo } from '../_shared/brand.ts';
import { renderAd } from '../_shared/render-ad.ts';
import { brandContext } from '../_shared/brand-brief.ts';
import { gptPhotoBytes, gptEditBytes, fetchImageBytes } from '../_shared/openai-image.ts';
import { kiePhotoBytes } from '../_shared/kie-image.ts';
import { agentBrief } from '../_shared/company-brief.ts';

// Image engine: 'kie' = GPT Image 2 via Kie (~75% cheaper) with OpenAI fallback;
// anything else = OpenAI direct. Flip with the IMAGE_ENGINE secret (reversible).
const IMAGE_ENGINE = Deno.env.get('IMAGE_ENGINE') || 'openai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const MODEL = Deno.env.get('CREATIVE_CHAT_MODEL') || 'claude-opus-4-8';
// Images use gpt-image-2 (synchronous, _shared/openai-image.ts); Kie is video-only now.
const VIDEO_MODEL = Deno.env.get('CREATIVE_VIDEO_MODEL') || 'bytedance/seedance-2';
const BUCKET = Deno.env.get('CREATIVE_BUCKET') || 'creative-studio';
const KIE = 'https://api.kie.ai/api/v1/jobs';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function num(x: any) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
const today = () => new Date().toISOString().slice(0, 10);

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
  if (!id) throw new Error(`Kie createTask failed (${r.status}): ${JSON.stringify(j).slice(0, 160)}`);
  return id;
}
function vidInput(prompt: string) { return { prompt, resolution: '720p', aspect_ratio: '9:16', duration: 5, generate_audio: false }; }

// Images are generated SYNCHRONOUSLY on gpt-image-2 (the premium engine): make a
// text-free photo, typeset the design layer, upload, and return the public URL.
// (Video still goes through Kie async + the poller.) Throws on failure.
async function genImageNow(admin: any, rowId: string, prompt: string, design: any, ref?: { bytes: Uint8Array; mime: string } | null): Promise<string> {
  // Reference image → image-to-image (OpenAI edits). Otherwise text-to-image:
  // Kie's GPT Image 2 when enabled (~75% cheaper), falling back to OpenAI on any
  // miss so generation never fails just because Kie hiccuped.
  let photo: Uint8Array | null;
  if (ref) {
    photo = await gptEditBytes(prompt, ref.bytes, ref.mime);
  } else if (IMAGE_ENGINE === 'kie') {
    photo = (await kiePhotoBytes(prompt)) || (await gptPhotoBytes(prompt));
  } else {
    photo = await gptPhotoBytes(prompt);
  }
  if (!photo) throw new Error('image generation returned empty (check OPENAI_API_KEY / KIE_API_KEY)');
  const isPoster = design?.template === 'poster';
  const hasDesign = isPoster || (Array.isArray(design?.headline_lines) && design.headline_lines.length) || design?.kicker || design?.cta;
  const out = hasDesign
    ? (await renderAd({
        imageBytes: photo,
        kicker: design.kicker, headlineLines: Array.isArray(design.headline_lines) ? design.headline_lines : [],
        accent: design.accent, cta: design.cta || (isPoster ? 'Escúchala gratis' : 'Créala hoy · regalosquecantan.com'),
        template: isPoster ? 'poster' : undefined, price: design.price,
      }) || await applyLogo(photo))
    : await applyLogo(photo);
  const path = `${rowId}.png`;
  const up = await admin.storage.from(BUCKET).upload(path, out, { contentType: 'image/png', upsert: true });
  if (up.error) throw up.error;
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Finalize any 'generating' creatives in the given id list by polling Kie.
async function finalize(admin: any, ids: string[]) {
  if (!ids.length) return;
  const { data: rows } = await admin.from('creative_queue')
    .select('id, kind, kie_task_id, created_at, design').in('id', ids).eq('status', 'generating').not('kie_task_id', 'is', null);
  for (const row of (rows || [])) {
    try {
      const r = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(row.kie_task_id)}`, { headers: { Authorization: `Bearer ${KIE_API_KEY}` } });
      const info = await r.json().catch(() => ({}));
      const st = info?.data?.state;
      if (st === 'success') {
        const url = (JSON.parse(info.data.resultJson || '{}').resultUrls || [])[0];
        if (!url) throw new Error('no resultUrls');
        const media = await fetch(url);
        let bytes = new Uint8Array(await media.arrayBuffer());
        const ext = row.kind === 'video' ? 'mp4' : 'png';
        if (row.kind !== 'video') {
          // Two-layer: typeset design over the text-free photo; else logo stamp.
          const d = row.design || {};
          const png = (d.headline_lines?.length || d.kicker || d.cta)
            ? await renderAd({ imageBytes: bytes, kicker: d.kicker, headlineLines: d.headline_lines || [], accent: d.accent, cta: d.cta })
            : null;
          bytes = png || await applyLogo(bytes);
        }
        await admin.storage.from(BUCKET).upload(`${row.id}.${ext}`, bytes, { contentType: row.kind === 'video' ? 'video/mp4' : 'image/png', upsert: true });
        const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(`${row.id}.${ext}`);
        await admin.from('creative_queue').update({ status: 'ready', media_url: pub.publicUrl, updated_at: new Date().toISOString() }).eq('id', row.id);
      } else if (st === 'fail' || info?.data?.failCode) {
        await admin.from('creative_queue').update({ status: 'failed', error: String(info?.data?.failMsg || 'kie fail').slice(0, 400), updated_at: new Date().toISOString() }).eq('id', row.id);
      } else if ((Date.now() - new Date(row.created_at).getTime()) / 60000 > 20) {
        await admin.from('creative_queue').update({ status: 'failed', error: 'stuck > 20m', updated_at: new Date().toISOString() }).eq('id', row.id);
      }
    } catch (e: any) {
      await admin.from('creative_queue').update({ status: 'failed', error: String(e?.message || e).slice(0, 400), updated_at: new Date().toISOString() }).eq('id', row.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'generate_creative',
    description: 'Generate a NEW visual (image or video) on demand and queue it. It renders in the background and appears in the chat shortly.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['image', 'video'] },
        intended_use: { type: 'string', enum: ['social', 'ad'] },
        occasion: { type: 'string' },
        concept: { type: 'string', description: 'One-line description of the idea.' },
        gen_prompt: { type: 'string', description: 'Detailed prompt. MUST be one of the two looks (PHOTOREAL gift-moment OR ANIMATED Pixar) and say which. For IMAGES: describe the PICTURE ONLY — NO text/words/logos in it, leave clean negative space in the lower third. Wholesome, mature adults, NEVER minors.' },
        kicker: { type: 'string', description: 'IMAGES: short eyebrow line ≤32 chars. Plain text, no emoji.' },
        headline_lines: { type: 'array', items: { type: 'string' }, description: 'IMAGES: 1-3 SHORT headline lines (≤16 chars each) the design layer typesets. Plain text, no emoji.' },
        accent: { type: 'string', description: 'IMAGES: one word from headline_lines to highlight in gold italic.' },
        cta: { type: 'string', description: 'IMAGES: CTA pill text ≤34 chars, e.g. "Créala hoy · regalosquecantan.com".' },
        headline: { type: 'string' }, primary_text: { type: 'string' }, caption: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind', 'gen_prompt', 'concept'],
    },
  },
  {
    name: 'tweak_creative',
    description: 'Make an adjusted version of an EXISTING creative (e.g. "make it sunnier", "add grandkids"). For images this edits the original; for video it re-renders with the change.',
    input_schema: {
      type: 'object',
      properties: {
        creative_id: { type: 'string', description: 'The id of the creative to tweak.' },
        change_instructions: { type: 'string', description: 'What to change, plainly.' },
      },
      required: ['creative_id', 'change_instructions'],
    },
  },
  {
    name: 'save_style_preference',
    description: 'Save a DURABLE style preference the owner expressed (e.g. "always warmer light", "lean animated for kids"). The daily generator will follow it going forward.',
    input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
  },
  {
    name: 'save_promo_focus',
    description: 'Set what to PUSH this week/season (an offer, occasion, or promo the owner wants the batch to lead with, e.g. "promote Día del Padre + the $9.99 video add-on"). REPLACES the current push. Pass an empty string to clear it and return to the default offer rotation.',
    input_schema: { type: 'object', properties: { focus: { type: 'string' } }, required: ['focus'] },
  },
];

async function runTool(admin: any, name: string, input: any, generated: string[]) {
  if (name === 'generate_creative') {
    const kind = input.kind === 'video' ? 'video' : 'image';
    const { data: row, error } = await admin.from('creative_queue').insert({
      batch_date: today(), kind, intended_use: input.intended_use === 'ad' ? 'ad' : 'social',
      occasion: input.occasion ?? null, concept: input.concept ?? null, gen_prompt: input.gen_prompt ?? null,
      headline: input.headline ?? null, primary_text: input.primary_text ?? null, caption: input.caption ?? null,
      hashtags: Array.isArray(input.hashtags) ? input.hashtags : null,
      design: kind === 'image' ? { kicker: input.kicker ?? null, headline_lines: Array.isArray(input.headline_lines) ? input.headline_lines : null, accent: input.accent ?? null, cta: input.cta ?? null } : null,
      status: 'generating',
    }).select('id').single();
    if (error || !row) return `Failed to queue: ${error?.message}`;
    generated.push(row.id);
    try {
      if (kind === 'image') {
        // gpt-image-2 is synchronous — generate, typeset, upload, mark ready now.
        const design = { kicker: input.kicker, headline_lines: input.headline_lines, accent: input.accent, cta: input.cta };
        const url = await genImageNow(admin, row.id, input.gen_prompt, design);
        await admin.from('creative_queue').update({ status: 'ready', media_url: url }).eq('id', row.id);
        return `Created image "${input.concept}" (id ${row.id}).`;
      }
      const taskId = await kieCreate(VIDEO_MODEL, vidInput(input.gen_prompt));
      await admin.from('creative_queue').update({ kie_task_id: taskId }).eq('id', row.id);
      return `Queued video "${input.concept}" (id ${row.id}). It will appear shortly.`;
    } catch (e: any) {
      await admin.from('creative_queue').update({ status: 'failed', error: String(e?.message || e).slice(0, 300) }).eq('id', row.id);
      return `Generation failed: ${e?.message || e}`;
    }
  }

  if (name === 'tweak_creative') {
    const { data: orig } = await admin.from('creative_queue').select('*').eq('id', input.creative_id).single();
    if (!orig) return `Creative ${input.creative_id} not found.`;
    const kind = orig.kind;
    const editPrompt = `${orig.gen_prompt || orig.concept || ''}\n\nADJUSTMENT: ${input.change_instructions}`;
    const { data: row, error } = await admin.from('creative_queue').insert({
      batch_date: today(), kind, intended_use: orig.intended_use, occasion: orig.occasion,
      concept: `${orig.concept || 'tweak'} — ${input.change_instructions}`.slice(0, 200), gen_prompt: editPrompt,
      headline: orig.headline, primary_text: orig.primary_text, caption: orig.caption, hashtags: orig.hashtags,
      design: orig.design ?? null, // keep the same typographic layer
      status: 'generating',
    }).select('id').single();
    if (error || !row) return `Failed to queue tweak: ${error?.message}`;
    generated.push(row.id);
    try {
      // Regenerate the text-free photo with the adjustment (the stored image has
      // typeset text baked in, so we can't image-edit it without corrupting type).
      if (kind === 'image') {
        const url = await genImageNow(admin, row.id, editPrompt, orig.design);
        await admin.from('creative_queue').update({ status: 'ready', media_url: url }).eq('id', row.id);
        return `Created a tweaked version (id ${row.id}).`;
      }
      const taskId = await kieCreate(VIDEO_MODEL, vidInput(editPrompt));
      await admin.from('creative_queue').update({ kie_task_id: taskId }).eq('id', row.id);
      return `Queued a tweaked video (id ${row.id}). It'll appear shortly.`;
    } catch (e: any) {
      await admin.from('creative_queue').update({ status: 'failed', error: String(e?.message || e).slice(0, 300) }).eq('id', row.id);
      return `Tweak failed: ${e?.message || e}`;
    }
  }

  if (name === 'save_style_preference') {
    const { data: cfg } = await admin.from('creative_studio_config').select('style_notes').eq('id', 1).single();
    const next = `${(cfg?.style_notes || '').trim()}\n- ${input.note}`.trim();
    await admin.from('creative_studio_config').update({ style_notes: next, updated_at: new Date().toISOString() }).eq('id', 1);
    return `Saved. The daily agent will follow: "${input.note}".`;
  }

  if (name === 'save_promo_focus') {
    const focus = String(input.focus || '').trim();
    await admin.from('creative_studio_config').update({ promo_notes: focus, updated_at: new Date().toISOString() }).eq('id', 1);
    return focus
      ? `Got it — the batch will now push: "${focus}".`
      : `Cleared the current push — back to the default offer rotation.`;
  }
  return `Unknown tool ${name}`;
}

// ---------------------------------------------------------------------------
function systemPrompt(styleNotes: string, promoNotes: string) {
  return `You are the Art Director / Creative Director for "Regalos Que Cantan". You are chatting with the OWNER inside their dashboard. Be warm, concise, and practical — a real creative partner who knows the business cold.

${agentBrief('Art Director — you GENERATE the actual ad/social visuals (gpt-image-2). When the Chief of Staff sends you a WORK ORDER, fulfil it by generating, not just talking. You own the look. You know the whole business + the rest of the team from the handbook above.')}

What you can DO (use tools naturally when the owner wants it, don't ask permission for obvious requests):
- Brainstorm style, angles, occasions, hooks.
- generate_creative — when they want to SEE something, generate it. Write a vivid prompt in one of the two approved looks.
- tweak_creative — adjust an existing creative they reference.
- save_style_preference — when they state a lasting VISUAL/style preference, save it.
- save_promo_focus — when they tell you what to PUSH this week/season (an offer, occasion, or promo), save it so the daily batch leads with it.

Creative DNA: lead with the FEELING (emotional reveal / nostalgia / romance / family pride) but always land a real selling point and ONE offer from the Business Brain below — that's what closes. Occasions cumpleaños, aniversario, día de las madres/padres, bodas, XV años; genres corrido, banda, bachata, mariachi. Copy in warm Mexican/US-Hispanic Spanish, no recipient names.
VISUAL LOOKS — only two: PHOTOREAL warm gift-moment, or ANIMATED Disney/Pixar 3D. Wholesome, mature adults, wide framing, NEVER depict minors (AI auto-rejects them — for youth occasions show the proud parents/adults instead).

${brandContext(promoNotes)}

After you generate something, tell the owner what you queued in one short line. Keep replies tight.

CURRENT SAVED STYLE PREFERENCES (always honor these):
${styleNotes?.trim() ? styleNotes : '(none yet)'}`;
}

async function callClaude(messages: any[], system: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, tools: TOOLS, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function bytesToB64(bytes: Uint8Array): string {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

// VISION: actually LOOK at a reference ad and classify its design style so we can
// reproduce it with the matching template. "poster" = bold/graphic/high-contrast
// promo (big text, badges, red/black); "elegant" = soft photoreal + refined type.
async function classifyAdStyle(ref: { bytes: Uint8Array; mime: string }): Promise<{ style: 'poster' | 'elegant'; price: string }> {
  try {
    const media = /png/.test(ref.mime) ? 'image/png' : /webp/.test(ref.mime) ? 'image/webp' : 'image/jpeg';
    const TOOL = { name: 'classify', description: 'Classify the ad design.', input_schema: { type: 'object', properties: { style: { type: 'string', enum: ['poster', 'elegant'] }, price: { type: 'string', description: 'Any price shown e.g. "$29", else ""' } }, required: ['style'] } };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, tools: [TOOL], tool_choice: { type: 'tool', name: 'classify' }, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: media, data: bytesToB64(ref.bytes) } }, { type: 'text', text: 'Classify this ad. "poster" = bold/graphic/high-contrast promo: large heavy text, hearts/badges, price callout, red+black palette, often a B&W photo. "elegant" = soft photoreal photo with minimal refined typography. Also read any price shown.' }] }] }),
    });
    if (!r.ok) return { style: 'elegant', price: '' };
    const j = await r.json();
    const tu = (j.content || []).find((c: any) => c.type === 'tool_use');
    return { style: tu?.input?.style === 'poster' ? 'poster' : 'elegant', price: tu?.input?.price || '' };
  } catch { return { style: 'elegant', price: '' }; }
}

// Deterministic generation engine: FORCES Claude to emit N ad specs (tool_choice),
// then generates each image itself. Shared by the generate_batch action, Sofía's
// hand-off, and the Art Director chat's safety net — so generation NEVER depends on
// a chat model deciding to call a tool. Returns the created creative ids.
async function generateBatch(admin: any, brief: string, count: number, intended: 'ad' | 'social', referenceImageUrl?: string): Promise<{ success: boolean; generated: string[]; error?: string }> {
  if (!ANTHROPIC_API_KEY) return { success: false, generated: [], error: 'ANTHROPIC_API_KEY not set' };
  const n = Math.min(Math.max(Number(count) || 2, 1), 4);
  // When a reference ad is given, LOOK at it (vision) to detect which design style
  // to reproduce — bold POSTER vs elegant — and match it with the right template.
  const refData = referenceImageUrl ? await fetchImageBytes(referenceImageUrl) : null;
  let style: 'poster' | 'elegant' = 'elegant'; let detectedPrice = '';
  if (refData) { const c = await classifyAdStyle(refData); style = c.style; detectedPrice = c.price; }
  const { data: cfg } = await admin.from('creative_studio_config').select('style_notes, promo_notes').eq('id', 1).single();
  const SPEC_TOOL = {
    name: 'emit_ads',
    description: 'Emit the exact ad creatives to generate.',
    input_schema: {
      type: 'object',
      properties: {
        ads: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              concept: { type: 'string', description: 'One-line idea.' },
              occasion: { type: 'string' },
              gen_prompt: { type: 'string', description: 'Detailed PHOTOREAL gift-moment OR ANIMATED Pixar prompt. Describe the PICTURE ONLY — NO text/words/logos in it, clean negative space in the lower third. Wholesome, mature adults, NEVER minors.' },
              kicker: { type: 'string', description: 'Short eyebrow ≤32 chars, plain text.' },
              headline_lines: { type: 'array', items: { type: 'string' }, description: '1-3 SHORT headline lines (≤16 chars each), plain text.' },
              accent: { type: 'string', description: 'One word from headline_lines to highlight gold italic.' },
              cta: { type: 'string', description: 'CTA pill ≤34 chars.' },
              caption: { type: 'string', description: 'Platform caption (Spanish).' },
              hashtags: { type: 'array', items: { type: 'string' } },
            },
            required: ['concept', 'gen_prompt', 'headline_lines', 'cta'],
          },
        },
      },
      required: ['ads'],
    },
  };
  const styleNote = style === 'poster'
    ? `\n\nSTYLE = BOLD POSTER (match the owner's proven promo ad). For each ad: gen_prompt = ONE emotional, high-contrast PHOTO that reads great in BLACK & WHITE (a moving family / gift reaction, dramatic light), NO text in the image. headline_lines = 2-3 SHORT punchy lines (rendered big, uppercase, white). accent = ONE short phrase for a RED highlight bar (e.g. the occasion). cta = a short call to action. The system lays the bold red/white/black poster design (price badge + hearts + CTA bar) on top — you only supply the photo + words.`
    : '';
  const sys = `${systemPrompt(cfg?.style_notes || '', cfg?.promo_notes || '')}${styleNote}\n\nProduce EXACTLY ${n} ${intended} creatives now. ${brief}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: sys, tools: [SPEC_TOOL], tool_choice: { type: 'tool', name: 'emit_ads' }, messages: [{ role: 'user', content: `Generate ${n} ads. ${brief}` }] }),
  });
  if (!res.ok) return { success: false, generated: [], error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const data = await res.json();
  const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
  const specs = (tu?.input?.ads || []).slice(0, n);
  if (!specs.length) return { success: false, generated: [], error: 'Model returned no ad specs' };
  const generated: string[] = [];
  for (const s of specs) {
    const design = { kicker: s.kicker ?? null, headline_lines: Array.isArray(s.headline_lines) ? s.headline_lines : null, accent: s.accent ?? null, cta: s.cta ?? null, template: style === 'poster' ? 'poster' : undefined, price: detectedPrice || '$29' };
    const { data: row } = await admin.from('creative_queue').insert({
      batch_date: today(), kind: 'image', intended_use: intended,
      occasion: s.occasion ?? null, concept: s.concept ?? null, gen_prompt: s.gen_prompt ?? null,
      headline: Array.isArray(s.headline_lines) ? s.headline_lines.join(' ') : null,
      caption: s.caption ?? null, hashtags: Array.isArray(s.hashtags) ? s.hashtags : null,
      design, status: 'generating',
    }).select('id').single();
    if (!row) continue;
    try {
      const url = await genImageNow(admin, row.id, s.gen_prompt, design);
      await admin.from('creative_queue').update({ status: 'ready', media_url: url }).eq('id', row.id);
      generated.push(row.id);
    } catch (e: any) {
      await admin.from('creative_queue').update({ status: 'failed', error: String(e?.message || e).slice(0, 300) }).eq('id', row.id);
    }
  }
  return { success: generated.length > 0, generated };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
    if (roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {} }
    const action = body.action || 'sync';

    // Pull all chat messages + finalize any generating creatives they reference.
    const loadChat = async () => {
      const { data: msgs } = await admin.from('creative_chat_messages')
        .select('id, role, content, creative_ids, created_at').order('created_at', { ascending: true }).limit(200);
      const ids = [...new Set((msgs || []).flatMap((m: any) => m.creative_ids || []))];
      await finalize(admin, ids);
      const { data: creatives } = ids.length
        ? await admin.from('creative_queue').select('id, kind, status, media_url, concept, headline, error').in('id', ids)
        : { data: [] };
      return { messages: msgs || [], creatives: creatives || [] };
    };

    if (action === 'sync') return json({ success: true, ...(await loadChat()) });

    // Direct (deterministic) tweak — used by the Creative Studio "Pedir cambios"
    // button on a card. Reuses the same tweak_creative engine the chat uses, but
    // without a Claude round-trip: it regenerates the creative with the owner's
    // change instructions and queues the new version.
    if (action === 'tweak') {
      const creativeId = String(body.creative_id || '').trim();
      const instr = String(body.change_instructions || '').trim();
      if (!creativeId || !instr) return json({ success: false, error: 'creative_id and change_instructions are required' }, 400);
      if (!KIE_API_KEY) return json({ success: false, error: 'KIE_API_KEY not set' }, 500);
      const generated: string[] = [];
      const note = await runTool(admin, 'tweak_creative', { creative_id: creativeId, change_instructions: instr }, generated);
      const ok = generated.length > 0;
      return json({ success: ok, message: note, generated, ...(ok ? {} : { error: note }) });
    }

    // Deterministic batch generation — used by Sofía's hand-off ("make more like X").
    // Does NOT depend on the chat model CHOOSING to call a tool (which stalls): it
    // FORCES Claude to emit N ad specs, then the system generates each image itself.
    // Guaranteed to create creatives (or report a real error) — no "I'll do it" loops.
    if (action === 'generate_batch') {
      const count = Math.min(Math.max(Number(body.count) || 2, 1), 4);
      const intended = body.intended_use === 'social' ? 'social' : 'ad';
      const r = await generateBatch(admin, String(body.brief || '').slice(0, 2000), count, intended, body.reference_image_url ? String(body.reference_image_url) : undefined);
      return json({ ...r, count: r.generated.length }, r.success ? 200 : 502);
    }

    if (action === 'send') {
      const userMsg = (body.message || '').toString().slice(0, 4000);
      if (!userMsg.trim()) return json({ success: false, error: 'Empty message' }, 400);
      if (!ANTHROPIC_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
      if (!KIE_API_KEY) return json({ success: false, error: 'KIE_API_KEY not set' }, 500);

      // history (text only) -> Claude messages
      const { data: hist } = await admin.from('creative_chat_messages')
        .select('role, content').order('created_at', { ascending: true }).limit(40);
      const { data: cfg } = await admin.from('creative_studio_config').select('style_notes, promo_notes').eq('id', 1).single();
      const system = systemPrompt(cfg?.style_notes || '', cfg?.promo_notes || '');

      const messages: any[] = (hist || []).map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
      messages.push({ role: 'user', content: userMsg });

      const generated: string[] = [];
      let finalText = '';
      for (let i = 0; i < 4; i++) {
        const resp = await callClaude(messages, system);
        const content = resp.content || [];
        messages.push({ role: 'assistant', content });
        const toolUses = content.filter((c: any) => c.type === 'tool_use');
        const textParts = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
        if (textParts) finalText = textParts;
        if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) break;
        const results = [];
        for (const tu of toolUses) {
          const out = await runTool(admin, tu.name, tu.input || {}, generated);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
        }
        messages.push({ role: 'user', content: results });
      }

      // Safety net: if the owner clearly asked to MAKE/CREATE ads/visuals but the
      // chat model stalled without generating anything, force a deterministic batch
      // so the Art Director actually delivers instead of just talking about it.
      const wantsGen = /\b(make|create|generate|design|build|crea|haz|dise|gener)/i.test(userMsg)
        && /\b(ad|ads|anuncio|visual|imagen|image|post|reel|creativ)/i.test(userMsg);
      if (generated.length === 0 && wantsGen) {
        const fb = await generateBatch(admin, userMsg, 2, /\b(social|post|reel|ig|instagram|tiktok)\b/i.test(userMsg) ? 'social' : 'ad');
        if (fb.generated.length) {
          generated.push(...fb.generated);
          finalText = `${finalText ? finalText + '\n\n' : ''}Done — I generated ${fb.generated.length} now; they're in Creative Studio.`;
        }
      }

      // Persist the turn (text only).
      await admin.from('creative_chat_messages').insert({ role: 'user', content: userMsg });
      await admin.from('creative_chat_messages').insert({ role: 'assistant', content: finalText || '(done)', creative_ids: generated.length ? generated : null });

      return json({ success: true, reply: finalText, generated, ...(await loadChat()) });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (e: any) {
    console.error('creative-chat error:', e?.message || e);
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
