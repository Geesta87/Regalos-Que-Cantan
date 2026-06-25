// supabase/functions/competitors-admin/index.ts
// ===========================================================================
// COMPETITORS — admin (list / dismiss / scan-now / make-our-version)
// ===========================================================================
// Powers the Creative Studio "Competitors" section. Lists ranked competitor ads,
// can trigger a fresh scan, and on "Make our version" has Claude turn a winning
// competitor CONCEPT into an ORIGINAL Regalos ad (never copying their assets or
// copy) that lands in the Ads queue (creative_queue).
//
// Admin-only. verify_jwt = true.
// Deploy: supabase functions deploy competitors-admin --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const MODEL = Deno.env.get('CREATIVE_MODEL') || 'claude-opus-4-8';
const IMAGE_MODEL = Deno.env.get('CREATIVE_IMAGE_MODEL') || 'google/nano-banana';
const VIDEO_MODEL = Deno.env.get('CREATIVE_VIDEO_MODEL') || 'bytedance/seedance-2';
const KIE = 'https://api.kie.ai/api/v1/jobs';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

async function kieCreate(kind: string, prompt: string): Promise<string> {
  const model = kind === 'video' ? VIDEO_MODEL : IMAGE_MODEL;
  const input = kind === 'video'
    ? { prompt, resolution: '720p', aspect_ratio: '9:16', duration: 5, generate_audio: false }
    : { prompt, aspect_ratio: '4:5', output_format: 'png' };
  const r = await fetch(`${KIE}/createTask`, { method: 'POST', headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });
  const j = await r.json().catch(() => ({}));
  const id = j?.data?.taskId || j?.taskId;
  if (!id) throw new Error(`Kie createTask failed (${r.status})`);
  return id;
}

const MAKE_TOOL = {
  name: 'emit_rqc_creative',
  description: 'Emit an ORIGINAL Regalos Que Cantan ad inspired by the competitor concept.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['image', 'video'] },
      intended_use: { type: 'string', enum: ['ad', 'social'] },
      occasion: { type: 'string' },
      concept: { type: 'string' },
      gen_prompt: { type: 'string', description: 'Detailed prompt in ONE of the two looks (PHOTOREAL gift-moment OR ANIMATED Pixar) — say which. Wholesome, mature adults, NEVER minors.' },
      headline: { type: 'string' }, primary_text: { type: 'string' }, caption: { type: 'string' },
      hashtags: { type: 'array', items: { type: 'string' } },
    },
    required: ['kind', 'intended_use', 'concept', 'gen_prompt', 'headline', 'primary_text'],
  },
};

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
    const action = body.action || 'list';

    if (action === 'list') {
      const { data, error } = await admin.from('competitor_ads')
        .select('id, ad_archive_id, page_name, lang, media_type, image_url, video_url, body_text, cta_text, active_days, score, analysis, status, cloned_creative_id, scanned_at')
        .neq('status', 'dismissed').order('score', { ascending: false, nullsFirst: false }).order('active_days', { ascending: false, nullsFirst: false }).limit(60);
      if (error) return json({ success: false, error: error.message }, 500);
      const { data: lastRun } = await admin.from('agent_runs').select('status, summary, started_at').eq('agent', 'competitor-scan').order('started_at', { ascending: false }).limit(1).maybeSingle();
      return json({ success: true, role: roleRow.role, ads: data || [], last_scan: lastRun || null });
    }

    if (action === 'scan') {
      // Fire the scan server-to-server (don't block on it).
      fetch(`${SUPABASE_URL}/functions/v1/competitor-scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      return json({ success: true, started: true });
    }

    if (!body.id) return json({ success: false, error: 'Missing id' }, 400);
    const { data: ad } = await admin.from('competitor_ads').select('*').eq('id', body.id).single();
    if (!ad) return json({ success: false, error: 'Competitor ad not found' }, 404);

    if (action === 'dismiss') {
      await admin.from('competitor_ads').update({ status: 'dismissed' }).eq('id', ad.id);
      return json({ success: true, id: ad.id, status: 'dismissed' });
    }

    if (action === 'make_version') {
      if (!ANTHROPIC_API_KEY || !KIE_API_KEY) return json({ success: false, error: 'AI keys not set' }, 500);
      const { data: cfg } = await admin.from('creative_studio_config').select('style_notes').eq('id', 1).single();
      const styleNotes = (cfg?.style_notes || '').trim();
      const system = `You are the Creative Director for "Regalos Que Cantan" (personalized Spanish songs as gifts, ~$30). Turn a competitor's WINNING ad concept into an ORIGINAL Regalos ad. Take ONLY the angle/hook/structure — never copy their text, images, brand, or claims. Make it unmistakably ours: warm Mexican/US-Hispanic Spanish, no recipient names, sell the FEELING that a personalized song is the best gift. Visual look = ONE of two only: PHOTOREAL warm gift-moment OR ANIMATED Disney/Pixar 3D. Wholesome, mature adults, NEVER depict minors (show proud adults for youth occasions). Strong hook + clear CTA to regalosquecantan.com.${styleNotes ? `\n\nOWNER STYLE PREFERENCES (honor):\n${styleNotes}` : ''}`;
      const ctx = `Competitor ad to reinterpret (do NOT copy):\nBrand: ${ad.page_name}\nCopy: ${(ad.body_text || '').slice(0, 500)}\nCTA: ${ad.cta_text || ''}\nWhy it works: ${ad.analysis?.why_working || ''}\nSuggested RQC angle: ${ad.analysis?.suggested_rqc_angle || ''}`;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, tools: [MAKE_TOOL], tool_choice: { type: 'tool', name: 'emit_rqc_creative' }, messages: [{ role: 'user', content: ctx }] }),
      });
      if (!res.ok) return json({ success: false, error: `Anthropic ${res.status}` }, 502);
      const data = await res.json();
      const it = (data.content || []).find((c: any) => c.type === 'tool_use')?.input;
      if (!it) return json({ success: false, error: 'No creative returned' }, 502);

      const kind = it.kind === 'video' ? 'video' : 'image';
      const { data: row, error: insErr } = await admin.from('creative_queue').insert({
        batch_date: new Date().toISOString().slice(0, 10), kind, intended_use: it.intended_use === 'social' ? 'social' : 'ad',
        occasion: it.occasion ?? null, concept: it.concept ?? null, gen_prompt: it.gen_prompt ?? null,
        headline: it.headline ?? null, primary_text: it.primary_text ?? null, caption: it.caption ?? null,
        hashtags: Array.isArray(it.hashtags) ? it.hashtags : null, status: 'generating',
      }).select('id').single();
      if (insErr || !row) return json({ success: false, error: insErr?.message || 'insert failed' }, 500);
      try {
        const taskId = await kieCreate(kind, it.gen_prompt || it.concept || '');
        await admin.from('creative_queue').update({ kie_task_id: taskId }).eq('id', row.id);
      } catch (e: any) {
        await admin.from('creative_queue').update({ status: 'failed', error: String(e?.message || e).slice(0, 300) }).eq('id', row.id);
        return json({ success: false, error: `Generation failed: ${e?.message || e}` }, 502);
      }
      await admin.from('competitor_ads').update({ status: 'cloned', cloned_creative_id: row.id }).eq('id', ad.id);
      return json({ success: true, creative_id: row.id, concept: it.concept });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('competitors-admin error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
