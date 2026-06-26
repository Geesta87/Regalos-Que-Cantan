// supabase/functions/creative-studio-daily/index.ts
// ===========================================================================
// AGENT 2 — CREATIVE STUDIO (daily generator)
// ===========================================================================
// Runs once each morning via pg_cron. Produces a batch of creatives for the
// owner to APPROVE before anything posts:
//   • 5 social videos + 5 paid-ad visuals (counts configurable)
//   • each with ad copy (headline + primary text) + a platform caption
//
// It only KICKS OFF generation (Kie createTask) and writes the copy — it does
// NOT wait for slow video renders. The companion poller `poll-creative-queue`
// finalizes each row to status='ready' as its media finishes. Nothing posts
// until the owner approves it in the dashboard.
//
// Fully isolated from the payment funnel. Writes only to creative_queue +
// agent_runs. verify_jwt = false (pg_cron, no JWT) — see config.toml.
// Deploy: supabase functions deploy creative-studio-daily --project-ref yzbvajungshqcpusfiia
//
// Secrets: ANTHROPIC_API_KEY, KIE_API_KEY (both already set).
// Optional: CREATIVE_IMAGE_MODEL (default google/nano-banana — set to the
//   "nano banana pro" id if/when desired), CREATIVE_VIDEO_MODEL
//   (default bytedance/seedance-2), CREATIVE_MODEL (Claude, default
//   claude-opus-4-8), CREATIVE_N_IMAGES (5), CREATIVE_N_VIDEOS (5),
//   CREATIVE_STUDIO_ENABLED ('false' to pause).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { brandContext } from '../_shared/brand-brief.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');

const IMAGE_MODEL = Deno.env.get('CREATIVE_IMAGE_MODEL') || 'google/nano-banana';
const VIDEO_MODEL = Deno.env.get('CREATIVE_VIDEO_MODEL') || 'bytedance/seedance-2';
const CLAUDE_MODEL = Deno.env.get('CREATIVE_MODEL') || 'claude-opus-4-8';
const N_IMAGES = Number(Deno.env.get('CREATIVE_N_IMAGES') || '5');
const N_VIDEOS = Number(Deno.env.get('CREATIVE_N_VIDEOS') || '5');

const KIE = 'https://api.kie.ai/api/v1/jobs';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Claude — Creative Director. Emits the full batch (concepts + copy + self-score)
// in one forced tool call. Media isn't generated here — only the plan + copy.
// ---------------------------------------------------------------------------
const BATCH_TOOL = {
  name: 'emit_creative_batch',
  description: 'Emit the daily batch of social + ad creative concepts with copy.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: `Exactly ${N_IMAGES} image items + ${N_VIDEOS} video items.`,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['image', 'video'] },
            intended_use: { type: 'string', enum: ['social', 'ad'] },
            occasion: { type: 'string', description: 'e.g. cumpleaños, aniversario, día de las madres, boda, quinceañera, día del padre' },
            persuasion_angle: { type: 'string', description: 'The emotional/persuasive hook driving this creative.' },
            concept: { type: 'string', description: 'One-line description of the visual idea.' },
            gen_prompt: { type: 'string', description: 'The detailed generation prompt. MUST be in one of the two approved looks and say which: (a) PHOTOREAL warm gift-moment scene, or (b) ANIMATED Disney/Pixar-style 3D characters. For IMAGES: describe the PICTURE ONLY — NO text, words, captions or logos in it, and leave clean negative space in the lower third for typography. For videos: a 5-second motion description in that look. Wholesome, mature adults only, warm and family-friendly, wide framing — NEVER anything that could read as suggestive (avoids false NSFW flags).' },
            kicker: { type: 'string', description: 'IMAGES ONLY: short eyebrow line above the headline, ≤32 chars. Plain text, NO emoji.' },
            headline_lines: { type: 'array', items: { type: 'string' }, description: 'IMAGES ONLY: 1-3 SHORT stacked headline lines (≤16 chars each) for the design layer. Plain text, NO emoji.' },
            accent: { type: 'string', description: 'IMAGES ONLY: one word from headline_lines to highlight in gold italic.' },
            cta: { type: 'string', description: 'IMAGES ONLY: CTA pill text ≤34 chars, e.g. "Créala hoy · regalosquecantan.com". Plain text, NO emoji.' },
            headline: { type: 'string', description: 'Short Spanish headline. NO recipient names (evergreen).' },
            primary_text: { type: 'string', description: 'Spanish ad primary text / post body. Emotional, ends with a clear CTA to regalosquecantan.com for ads.' },
            caption: { type: 'string', description: 'Spanish social caption with 3-5 relevant hashtags woven in or at the end.' },
            hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags WITHOUT the # sign.' },
            score: { type: 'integer', description: 'Your honest 0-100 rating of this creative\'s likely performance, for ordering.' },
          },
          required: ['kind', 'intended_use', 'occasion', 'persuasion_angle', 'concept', 'gen_prompt', 'headline', 'primary_text', 'caption', 'hashtags', 'score'],
        },
      },
    },
    required: ['items'],
  },
};

const SYSTEM = `You are the Creative Director for "Regalos Que Cantan" (regalosquecantan.com), a US-Hispanic brand selling personalized AI-generated Spanish songs as deeply emotional gifts (~$30). You produce a daily batch of direct-response creatives for Meta + social. The non-technical owner reviews and approves each one.

MINDSET — run this brief in your head for EVERY creative:
1. Sell the FEELING, not the feature. Nobody buys "an AI song" — they buy the moment a loved one's eyes well up hearing their own song. Every creative evokes that moment.
2. Earn the first second. The opening line / first frame must stop a Hispanic mom mid-scroll: an emotional truth or a curiosity gap (e.g. "Cuando la canción es sobre TI…").
3. Culturally native, never translated. Real regional-Mexican warmth — the genres (corrido, banda, norteño, bachata, mariachi) and occasions (Día de las Madres, Día del Padre, cumpleaños, aniversario, bodas, XV años) your people actually live.
4. One creative = one emotion = one occasion. Focus within each piece; diversity across the batch.
5. Know the job: intended_use 'ad' = hook + persuasion + a clear CTA to regalosquecantan.com; 'social' = warmth + shareability + community (softer CTA).

EMOTIONAL ANGLES — rotate across the batch; lead with these four:
- The reveal / surprise ("espera… ¿la canción es sobre MÍ?") — the strongest hook.
- Nostalgia & memory — honoring a life, a shared history.
- Romance / aniversario — enduring love, the bachata-that-tells-our-story.
- Family pride & celebration — cumpleaños, XV años, graduaciones: joyful, proud.

VISUAL STYLE — use ONLY these two looks, and MIX them across the batch:
- PHOTOREAL gift-moment: warm, candid, real-feeling scenes of giving/receiving the song — soft golden light, cozy homes, genuine emotion on faces. Cinematic but believable. Best for romance, nostalgia, and the reveal.
- ANIMATED storybook: charming Disney/Pixar-style 3D-animated characters — big expressive eyes, smooth rounded stylized features, the polished animated-movie look, warm palette. Best for family, kids, and celebration; stands out in feed.
Do NOT use other styles (no plain text/lyric cards, no dramatic corrido-cinematic) unless explicitly asked. Every gen_prompt must clearly state WHICH of the two looks it is.

TWO-LAYER IMAGES (mandatory for kind=image): The image is a PICTURE ONLY. NEVER write text, words, headlines, captions or logos into gen_prompt, and leave clean negative space in the lower third. Put the on-image words in the SEPARATE fields kicker / headline_lines / accent / cta — our design layer typesets them over the picture with the brand fonts and logo. Keep headline_lines short and punchy (≤16 chars/line) and use PLAIN TEXT with NO emoji. (VIDEO items ignore these fields — gen_prompt stays the motion description.)

TONE: vary per piece to fit the occasion — tear-jerker for the reveal/nostalgia, warm & festive for celebrations, tender for romance.

GUARDRAILS:
- All copy in natural, warm Mexican/US-Hispanic Spanish. NO recipient names (keep evergreen).
- gen_prompts: wholesome, mature adults, family-friendly, wide framing, warm lighting. NEVER suggestive or anything that could trip a false NSFW flag.
- NEVER depict minors. AI image models auto-REJECT any image showing a child or teen. For youth occasions (quinceañera, kids' cumpleaños, graduación), depict the EMOTION through the ADULTS instead — a proud mother's tearful face, parents embracing, hands holding the phone with the song, a celebration table — never the child/teen themselves. This is mandatory in EVERY gen_prompt, photoreal or animated.
- Score honestly so your strongest ideas sort to the top — be your own toughest critic.`;

async function generateBatch(styleNotes: string, promoNotes: string): Promise<any[]> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  // Layer the system prompt: base art-direction DNA → the Business Brain (real
  // offer + selling points + upsell ladder, with the owner's live promo push) →
  // the owner's saved style preferences. Each overrides/extends the one above.
  const stylePart = styleNotes?.trim()
    ? `\n\nOWNER'S SAVED STYLE PREFERENCES (always honor these):\n${styleNotes.trim()}`
    : '';
  const system = `${SYSTEM}\n\n${brandContext(promoNotes)}${stylePart}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system,
      tools: [BATCH_TOOL],
      tool_choice: { type: 'tool', name: 'emit_creative_batch' },
      messages: [{
        role: 'user',
        content: `Create today's batch: exactly ${N_IMAGES} image creatives and ${N_VIDEOS} video creatives. Diverse occasions and angles. Make them genuinely good.`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const toolUse = (data.content || []).find((c: any) => c.type === 'tool_use');
  if (!toolUse) throw new Error('No batch returned by model');
  return toolUse.input.items || [];
}

// ---------------------------------------------------------------------------
// Kie — fire a generation task, return taskId. (Poller finalizes the result.)
// ---------------------------------------------------------------------------
async function kieCreate(kind: string, prompt: string): Promise<string> {
  const model = kind === 'video' ? VIDEO_MODEL : IMAGE_MODEL;
  const input: Record<string, unknown> = kind === 'video'
    ? { prompt, resolution: '720p', aspect_ratio: '9:16', duration: 5, generate_audio: false }
    : { prompt, aspect_ratio: '4:5', output_format: 'png' };

  const r = await fetch(`${KIE}/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  const j = await r.json().catch(() => ({}));
  const id = j?.data?.taskId || j?.taskId || j?.data?.task_id;
  if (!id) throw new Error(`Kie createTask failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
  return id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (Deno.env.get('CREATIVE_STUDIO_ENABLED') === 'false') {
    return json(200, { success: true, skipped: true, reason: 'agent_disabled' });
  }
  if (!KIE_API_KEY) {
    await supabase.from('agent_runs').insert({
      agent: 'creative-studio', status: 'skipped', ok: false,
      summary: 'KIE_API_KEY not set', finished_at: new Date().toISOString(), execution_ms: Date.now() - startTime,
    });
    return json(200, { success: false, skipped: true, reason: 'KIE_API_KEY missing' });
  }

  const batchDate = new Date().toISOString().slice(0, 10);
  try {
    const { data: cfg } = await supabase.from('creative_studio_config').select('style_notes, promo_notes').eq('id', 1).single();
    const items = await generateBatch(cfg?.style_notes || '', cfg?.promo_notes || '');
    if (!items.length) throw new Error('Model returned an empty batch');

    // Insert each row (so copy survives even if generation fails), then fire the
    // Kie task and stamp the task id. Done per-item so one failure is isolated.
    let fired = 0, failed = 0;
    await Promise.all(items.map(async (it) => {
      const kind = it.kind === 'video' ? 'video' : 'image';
      const { data: row, error: insErr } = await supabase.from('creative_queue').insert({
        batch_date: batchDate,
        kind,
        intended_use: it.intended_use === 'ad' ? 'ad' : 'social',
        occasion: it.occasion ?? null,
        persuasion_angle: it.persuasion_angle ?? null,
        concept: it.concept ?? null,
        gen_prompt: it.gen_prompt ?? null,
        headline: it.headline ?? null,
        primary_text: it.primary_text ?? null,
        caption: it.caption ?? null,
        hashtags: Array.isArray(it.hashtags) ? it.hashtags : null,
        design: kind === 'image' ? {
          kicker: it.kicker ?? null,
          headline_lines: Array.isArray(it.headline_lines) ? it.headline_lines : null,
          accent: it.accent ?? null,
          cta: it.cta ?? null,
        } : null,
        score: Number.isFinite(it.score) ? it.score : null,
        status: 'generating',
      }).select('id').single();
      if (insErr || !row) { failed++; console.error('insert creative_queue:', insErr?.message); return; }

      try {
        const taskId = await kieCreate(kind, it.gen_prompt || it.concept || '');
        await supabase.from('creative_queue').update({ kie_task_id: taskId, updated_at: new Date().toISOString() }).eq('id', row.id);
        fired++;
      } catch (e: any) {
        await supabase.from('creative_queue').update({ status: 'failed', error: String(e?.message || e).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', row.id);
        failed++;
      }
    }));

    await supabase.from('agent_runs').insert({
      agent: 'creative-studio', status: 'ok', ok: true,
      summary: `Batch ${batchDate}: ${fired} generating, ${failed} failed`,
      payload: { batch_date: batchDate, requested: items.length, fired, failed },
      finished_at: new Date().toISOString(), execution_ms: Date.now() - startTime,
    });

    return json(200, { success: true, batch_date: batchDate, fired, failed });
  } catch (e: any) {
    console.error('[creative-studio-daily] error:', e?.message || e);
    await supabase.from('agent_runs').insert({
      agent: 'creative-studio', status: 'error', ok: false,
      error: String(e?.message || e).slice(0, 800),
      finished_at: new Date().toISOString(), execution_ms: Date.now() - startTime,
    }).then(() => {}, () => {});
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
