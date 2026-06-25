// supabase/functions/ad-templates/index.ts
// ===========================================================================
// AD TEMPLATES — pick a proven style, generate 5 ads in it (gpt-image-1)
// ===========================================================================
// Lists the ad-style templates and, on "Generar 5", has Claude write 5 on-brand
// variations in that template's style + copy formula and renders each with
// OpenAI gpt-image-1 (synchronous, high quality, great at text-in-image). The
// finished ads land READY in the Ads queue (creative_queue). Admin-only.
//
// verify_jwt = true. Reads OPENAI_API_KEY + ANTHROPIC_API_KEY.
// Deploy: supabase functions deploy ad-templates --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('TEMPLATE_MODEL') || 'claude-sonnet-4-6';
const IMG_MODEL = Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-2'; // newest OpenAI model
const IMG_QUALITY = Deno.env.get('OPENAI_IMAGE_QUALITY') || 'high';
const IMG_SIZE = Deno.env.get('OPENAI_IMAGE_SIZE') || '1024x1536'; // ~portrait, good for feed ads
const BUCKET = Deno.env.get('CREATIVE_BUCKET') || 'creative-studio';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function b64ToBytes(b64: string) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

// gpt-image-1 — synchronous; returns a stored public URL.
async function gptImage(admin: any, prompt: string): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMG_MODEL, prompt: prompt.slice(0, 3800), n: 1, size: IMG_SIZE, quality: IMG_QUALITY }),
  });
  if (!r.ok) { console.warn('gpt-image-1', r.status, (await r.text()).slice(0, 200)); return null; }
  const j = await r.json().catch(() => ({}));
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) return null;
  const path = `tpl-${crypto.randomUUID()}.png`;
  const up = await admin.storage.from(BUCKET).upload(path, b64ToBytes(b64), { contentType: 'image/png', upsert: true });
  if (up.error) { console.warn('upload', up.error.message); return null; }
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const VARS_TOOL = {
  name: 'emit_template_variations',
  description: 'Emit on-brand ad variations in the given template style.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            occasion: { type: 'string' },
            concept: { type: 'string', description: 'One line describing this variation.' },
            image_prompt: { type: 'string', description: 'The FULL prompt for the image model: the template visual style applied to THIS variation. If the template renders text, include the EXACT Spanish headline to render in the image, in quotes. Wholesome, mature adults, NEVER minors.' },
            headline: { type: 'string' }, primary_text: { type: 'string' }, caption: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
          },
          required: ['occasion', 'concept', 'image_prompt', 'headline', 'primary_text'],
        },
      },
    },
    required: ['items'],
  },
};

async function variations(tpl: any, count: number): Promise<any[]> {
  if (!ANTHROPIC_API_KEY) return [];
  const system = `You are the Creative Director for "Regalos Que Cantan" (personalized Spanish songs as gifts, ~$30, US-Hispanic). Produce ${count} DISTINCT ad variations in this fixed template style. Vary the occasion, person, and angle across them. Warm Mexican/US-Hispanic Spanish copy, no recipient names. Wholesome, mature adults, NEVER depict minors (for youth occasions show proud parents/adults). Strong hook + CTA to regalosquecantan.com.

TEMPLATE: ${tpl.name}
VISUAL STYLE (bake this into every image_prompt): ${tpl.style_prompt}
COPY GUIDANCE: ${tpl.copy_guidance || ''}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, tools: [VARS_TOOL], tool_choice: { type: 'tool', name: 'emit_template_variations' }, messages: [{ role: 'user', content: `Create ${count} ad variations in the "${tpl.name}" template style. Make them genuinely good and diverse.` }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  return (data.content || []).find((c: any) => c.type === 'tool_use')?.input?.items || [];
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
    if (!roleRow || roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {} }
    const action = body.action || 'list_templates';

    if (action === 'list_templates') {
      const { data } = await admin.from('ad_templates').select('id, key, name, emoji, description, thumbnail_url, sort_order').eq('active', true).order('sort_order');
      return json({ success: true, templates: data || [] });
    }

    if (action === 'seed_thumbnails') {
      if (!OPENAI_API_KEY) return json({ success: false, error: 'OPENAI_API_KEY not set' }, 500);
      const { data: tpls } = await admin.from('ad_templates').select('*').eq('active', true);
      const todo = (tpls || []).filter((t: any) => body.force || !t.thumbnail_url);
      const results = await Promise.all(todo.map(async (t: any) => {
        const url = await gptImage(admin, `${t.style_prompt} Example for a personalized Spanish-song gift ad. Warm, on-brand, premium.`);
        if (url) await admin.from('ad_templates').update({ thumbnail_url: url }).eq('id', t.id);
        return { key: t.key, ok: !!url };
      }));
      return json({ success: true, seeded: results });
    }

    if (action === 'generate_from_template') {
      if (!OPENAI_API_KEY || !ANTHROPIC_API_KEY) return json({ success: false, error: 'AI keys not set' }, 500);
      const { data: tpl } = await admin.from('ad_templates').select('*').eq('id', body.template_id).single();
      if (!tpl) return json({ success: false, error: 'Template not found' }, 404);
      const count = Math.min(Math.max(Number(body.count) || 5, 1), 6);
      const items = await variations(tpl, count);
      if (!items.length) return json({ success: false, error: 'No variations produced' }, 502);

      const batch = new Date().toISOString().slice(0, 10);
      const made = await Promise.all(items.map(async (it: any) => {
        const url = await gptImage(admin, it.image_prompt);
        const { data: row } = await admin.from('creative_queue').insert({
          batch_date: batch, kind: 'image', intended_use: 'ad',
          occasion: it.occasion ?? null, concept: `[${tpl.name}] ${it.concept || ''}`.slice(0, 200),
          gen_prompt: it.image_prompt ?? null, headline: it.headline ?? null, primary_text: it.primary_text ?? null,
          caption: it.caption ?? null, hashtags: Array.isArray(it.hashtags) ? it.hashtags : null,
          status: url ? 'ready' : 'failed', media_url: url || null, error: url ? null : 'gpt-image-1 failed',
        }).select('id').single();
        return { id: row?.id, ok: !!url };
      }));
      const ok = made.filter((m) => m.ok).length;
      await admin.from('agent_runs').insert({ agent: 'creative-studio', status: 'ok', ok: true, summary: `Template "${tpl.name}" → ${ok}/${count} ads`, finished_at: new Date().toISOString() }).then(() => {}, () => {});
      return json({ success: true, template: tpl.name, generated: ok, total: count });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('ad-templates error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
