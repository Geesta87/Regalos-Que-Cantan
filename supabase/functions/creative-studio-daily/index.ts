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
            gen_prompt: { type: 'string', description: 'The detailed generation prompt. For images: a rich visual description for a text-to-image model. For videos: a 5-second motion description. Wholesome, mature adults only, warm and family-friendly, wide framing — NEVER anything that could read as suggestive (avoids false NSFW flags).' },
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

const SYSTEM = `You are the Creative Director for "Regalos Que Cantan", a US-Hispanic brand that sells personalized AI-generated Spanish songs as emotional gifts (~$30). Site: regalosquecantan.com. Best-performing creative is warm, emotional, gift-reveal / reaction energy. Genres include corrido, banda, norteño, bachata, mariachi, cumbia. Occasions: cumpleaños, aniversario, día de las madres, día del padre, bodas, quinceañera.

Produce a DIVERSE daily batch — vary the occasion, genre, and emotional angle across items so the owner has real options, not 10 versions of one idea. Mark intended_use 'ad' for the most persuasive, hook-forward, CTA-driven ones and 'social' for evergreen brand-building posts.

Rules:
- All copy in natural, warm Mexican/US-Hispanic Spanish. NO recipient names (keep evergreen).
- Generation prompts: wholesome, mature adults, family-friendly, warm lighting, wide framing. NEVER suggestive or anything that could trip a false NSFW flag.
- Ads: strong emotional hook in the first line + a clear CTA to regalosquecantan.com.
- Score honestly so the best ideas sort to the top. Be your own toughest critic — only your strongest concepts should score high.`;

async function generateBatch(): Promise<any[]> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
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
    const items = await generateBatch();
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
