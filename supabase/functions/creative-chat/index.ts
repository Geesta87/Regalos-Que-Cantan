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
const IMAGE_MODEL = Deno.env.get('CREATIVE_IMAGE_MODEL') || 'google/nano-banana';
const IMAGE_EDIT_MODEL = Deno.env.get('CREATIVE_IMAGE_EDIT_MODEL') || 'google/nano-banana-edit';
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
function imgInput(prompt: string) { return { prompt, aspect_ratio: '4:5', output_format: 'png' }; }
function vidInput(prompt: string) { return { prompt, resolution: '720p', aspect_ratio: '9:16', duration: 5, generate_audio: false }; }

// Finalize any 'generating' creatives in the given id list by polling Kie.
async function finalize(admin: any, ids: string[]) {
  if (!ids.length) return;
  const { data: rows } = await admin.from('creative_queue')
    .select('id, kind, kie_task_id, created_at').in('id', ids).eq('status', 'generating').not('kie_task_id', 'is', null);
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
        if (row.kind !== 'video') bytes = await applyLogo(bytes); // brand the visual
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
        gen_prompt: { type: 'string', description: 'Detailed prompt. MUST be one of the two looks (PHOTOREAL gift-moment OR ANIMATED Pixar) and say which. Wholesome, mature adults, NEVER minors.' },
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
];

async function runTool(admin: any, name: string, input: any, generated: string[]) {
  if (name === 'generate_creative') {
    const kind = input.kind === 'video' ? 'video' : 'image';
    const { data: row, error } = await admin.from('creative_queue').insert({
      batch_date: today(), kind, intended_use: input.intended_use === 'ad' ? 'ad' : 'social',
      occasion: input.occasion ?? null, concept: input.concept ?? null, gen_prompt: input.gen_prompt ?? null,
      headline: input.headline ?? null, primary_text: input.primary_text ?? null, caption: input.caption ?? null,
      hashtags: Array.isArray(input.hashtags) ? input.hashtags : null, status: 'generating',
    }).select('id').single();
    if (error || !row) return `Failed to queue: ${error?.message}`;
    try {
      const taskId = await kieCreate(kind === 'video' ? VIDEO_MODEL : IMAGE_MODEL, kind === 'video' ? vidInput(input.gen_prompt) : imgInput(input.gen_prompt));
      await admin.from('creative_queue').update({ kie_task_id: taskId }).eq('id', row.id);
      generated.push(row.id);
      return `Queued ${kind} "${input.concept}" (id ${row.id}). It will appear shortly.`;
    } catch (e: any) {
      await admin.from('creative_queue').update({ status: 'failed', error: String(e?.message || e).slice(0, 300) }).eq('id', row.id);
      return `Generation failed to start: ${e?.message || e}`;
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
      status: 'generating',
    }).select('id').single();
    if (error || !row) return `Failed to queue tweak: ${error?.message}`;
    try {
      let taskId: string;
      if (kind === 'image' && orig.media_url) {
        taskId = await kieCreate(IMAGE_EDIT_MODEL, { prompt: input.change_instructions, image_urls: [orig.media_url], aspect_ratio: '4:5', output_format: 'png' });
      } else {
        taskId = await kieCreate(kind === 'video' ? VIDEO_MODEL : IMAGE_MODEL, kind === 'video' ? vidInput(editPrompt) : imgInput(editPrompt));
      }
      await admin.from('creative_queue').update({ kie_task_id: taskId }).eq('id', row.id);
      generated.push(row.id);
      return `Queued a tweaked version (id ${row.id}). It'll appear shortly.`;
    } catch (e: any) {
      await admin.from('creative_queue').update({ status: 'failed', error: String(e?.message || e).slice(0, 300) }).eq('id', row.id);
      return `Tweak failed to start: ${e?.message || e}`;
    }
  }

  if (name === 'save_style_preference') {
    const { data: cfg } = await admin.from('creative_studio_config').select('style_notes').eq('id', 1).single();
    const next = `${(cfg?.style_notes || '').trim()}\n- ${input.note}`.trim();
    await admin.from('creative_studio_config').update({ style_notes: next, updated_at: new Date().toISOString() }).eq('id', 1);
    return `Saved. The daily agent will follow: "${input.note}".`;
  }
  return `Unknown tool ${name}`;
}

// ---------------------------------------------------------------------------
function systemPrompt(styleNotes: string) {
  return `You are the Creative Director for "Regalos Que Cantan" (regalosquecantan.com), a US-Hispanic brand selling personalized AI Spanish songs as emotional gifts (~$30). You are chatting with the OWNER inside their dashboard. Be warm, concise, and practical — a real creative partner.

What you can DO (use tools naturally when the owner wants it, don't ask permission for obvious requests):
- Brainstorm style, angles, occasions, hooks.
- generate_creative — when they want to SEE something, generate it. Write a vivid prompt in one of the two approved looks.
- tweak_creative — adjust an existing creative they reference.
- save_style_preference — when they state a lasting preference, save it.

Creative DNA: sell the FEELING not the feature; emotional reveal / nostalgia / romance / family pride; occasions cumpleaños, aniversario, día de las madres/padres, bodas, XV años; genres corrido, banda, bachata, mariachi. Copy in warm Mexican/US-Hispanic Spanish, no recipient names.
VISUAL LOOKS — only two: PHOTOREAL warm gift-moment, or ANIMATED Disney/Pixar 3D. Wholesome, mature adults, wide framing, NEVER depict minors (AI auto-rejects them — for youth occasions show the proud parents/adults instead).

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

    if (action === 'send') {
      const userMsg = (body.message || '').toString().slice(0, 4000);
      if (!userMsg.trim()) return json({ success: false, error: 'Empty message' }, 400);
      if (!ANTHROPIC_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
      if (!KIE_API_KEY) return json({ success: false, error: 'KIE_API_KEY not set' }, 500);

      // history (text only) -> Claude messages
      const { data: hist } = await admin.from('creative_chat_messages')
        .select('role, content').order('created_at', { ascending: true }).limit(40);
      const { data: cfg } = await admin.from('creative_studio_config').select('style_notes').eq('id', 1).single();
      const system = systemPrompt(cfg?.style_notes || '');

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
