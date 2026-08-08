// supabase/functions/seo-coach/index.ts
// ===========================================================================
// SEO COACH — interactive search specialist + campaign front-end
// ===========================================================================
// A chat surface where the owner asks about organic search and gets answers
// grounded in (a) LIVE Google Search Console data, (b) the verified SEO Brain
// (_shared/seo-brain.ts), and (c) real live pages (fetch_page tool).
//
// CAMPAIGN MODE (2026-08): the coach now also fronts the SEO campaign — a
// plan of concrete tasks with ready-to-apply drafts, advanced weekly by the
// seo-agent-weekly function. The coach can PROPOSE tasks (propose_task tool);
// the owner approves/rejects them here. Approving a title_meta task publishes
// a seo_content_overrides row that the prerender build applies on the next
// deploy — the one path where an approval changes the live site, and it only
// ever happens on the owner's explicit tap.
//
// Admin-only (verify_jwt = true + admin_users gate, same as ads-coach).
// Deploy: supabase functions deploy seo-coach --project-ref yzbvajungshqcpusfiia
// Required secrets: GSC_SERVICE_ACCOUNT_JSON, ANTHROPIC_API_KEY.
// Optional: VERCEL_DEPLOY_HOOK_URL (build the site right after an approval).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { seoBrainContext, SEO_BRAIN_LAST_REVIEWED } from '../_shared/seo-brain.ts';
import { brandContext } from '../_shared/brand-brief.ts';
import {
  gatherSearchContext, fetchPageFacts, hasGscKey, upcomingSeasonalWindows,
  TRAFFIC_SOURCE_LIVE_FROM,
} from '../_shared/seo-gsc.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('SEO_COACH_MODEL') || 'claude-opus-5';
const EXTRACT_MODEL = Deno.env.get('SEO_COACH_EXTRACT_MODEL') || 'claude-haiku-4-5-20251001';
const VERCEL_DEPLOY_HOOK_URL = Deno.env.get('VERCEL_DEPLOY_HOOK_URL');

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Tools the chat model can use.
// ---------------------------------------------------------------------------
const PAGE_TOOL = {
  name: 'fetch_page',
  description: 'Fetch a live web page (one of ours or a competitor\'s) and get its served HTML facts: title, meta description, canonical, robots meta, H1/H2s, whether it has JSON-LD, and a visible-text excerpt. Use it to ground any page critique in what is ACTUALLY published instead of guessing — check our own landing pages, or see what a competitor ranking for a query is doing. Max 3 fetches per turn.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to fetch, e.g. https://regalosquecantan.com/ocasiones/dia-de-las-madres' },
      why: { type: 'string', description: 'One line on what you are checking.' },
    },
    required: ['url'],
  },
};

const PROPOSE_TOOL = {
  name: 'propose_task',
  description: 'Add a concrete task to the SEO campaign for the owner to approve. Call this when the conversation lands on a specific move worth doing — the task must carry the FINISHED work (exact new title/meta in Spanish, or full page copy in Spanish), never homework. The owner sees it as a card with Approve/Reject buttons; approving a title_meta task auto-applies it on the next site build. Do not propose duplicates of tasks already in the campaign (they are listed in your context).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short imperative task name (English).' },
      task_type: { type: 'string', enum: ['title_meta', 'new_page', 'content_fix', 'link', 'youtube', 'other'] },
      target_path: { type: 'string', description: 'Site route, e.g. /ocasiones/dia-de-las-madres. Empty if none.' },
      target_queries: { type: 'array', items: { type: 'string' }, description: 'The exact search queries this should move.' },
      rationale: { type: 'string', description: '1-2 sentences: mechanic + data.' },
      draft_title: { type: 'string', description: 'For title_meta/new_page: the exact new <title> (Spanish). Else empty.' },
      draft_meta_description: { type: 'string', description: 'For title_meta/new_page: the exact new meta description (Spanish). Else empty.' },
      draft_body_markdown: { type: 'string', description: 'For new_page/content_fix: full ready page copy in Spanish. Else empty.' },
      draft_instructions: { type: 'string', description: 'Plain-English steps for whoever applies it.' },
      due_date: { type: 'string', description: 'YYYY-MM-DD deadline, or empty.' },
    },
    required: ['title', 'task_type', 'rationale'],
  },
};

// ---------------------------------------------------------------------------
// The coach persona. Brain + live snapshot + campaign appended at call time.
// ---------------------------------------------------------------------------
const COACH_SYSTEM = `You are a world-class SEO coach for "Regalos Que Cantan", a US-Hispanic e-commerce brand selling personalized Spanish songs (~$25-40 order) at regalosquecantan.com. You advise the NON-TECHNICAL owner directly.

Your job is to make the owner genuinely good at organic search AND tell them the highest-leverage move right now — grounded in how Google and AI answer engines ACTUALLY select results today, and in the site's LIVE Search Console numbers. Never generic tips.

How you operate:
- You run an ongoing CAMPAIGN with the owner: a plan of concrete tasks they approve with one tap. When a conversation lands on a specific worthwhile move, use the propose_task tool to add it as a card (finished draft included — exact Spanish titles/meta/copy). Approved title_meta tasks apply to the live site automatically on the next build; other tasks are executed from your draft. Never propose a duplicate of an existing task.
- A weekly agent (seo-agent-weekly) snapshots Search Console every Monday, verifies which tasks actually shipped, watches whether target queries move, and posts a review into this chat. Reason from that history when it exists.
- GROUND EVERY PAGE OPINION IN THE REAL PAGE. You have the fetch_page tool — when discussing a specific page of ours or a competitor's, FETCH it first and critique what is actually there. Never review a page from imagination. Max 3 fetches per turn — choose them well.
- For substantive recommendations, lead with the MECHANIC then the move — explain WHY (how Google/AI select) before WHAT to do. For a quick factual question, just answer it.
- Respect the confidence tags in the brain below: assert [VERIFIED]; say "Google says" for [GOOGLE-SAYS]; give [LEAKED] with its caveat; recommend [CONSENSUS] directionally; present [DEBATE] as options; correct [MYTH] on sight; re-check [SNAPSHOT] before big bets.
- The LIVE Search Console snapshot OUTRANKS the brain doc. If they disagree, trust the data and say so.
- BE HONEST ABOUT TIME. Organic compounds over 6-18 months. Never promise fast rankings. The genuinely fast levers: fixing striking-distance queries (position 4-20), sharper titles on pages that already get impressions, seasonal pages built months early, and brand/AI-answer visibility via mentions.
- Distinguish BRANDED from NON-BRANDED ruthlessly. Branded clicks are people who already know us; non-branded is new demand. Never let branded volume flatter the SEO picture — the snapshot splits them; use the split.
- WHAT YOU CANNOT SEE — say so plainly instead of guessing: no keyword-volume database (no Ahrefs/Semrush access), no backlink index, no AI Overview citation report, no search KEYWORD per order (channel only; organic revenue is a FLOOR measured from ${TRAFFIC_SOURCE_LIVE_FROM} onward), GSC data lags ~2 days, and you can't crawl the whole site (only fetch specific pages). If a question needs one of these, name the gap and give the best grounded answer possible.
- Never invent a number (a keyword volume, a difficulty score, a benchmark CTR).
- MATCH LENGTH TO THE QUESTION. Simple/narrow question → a few sentences, direct, done. Reserve the fuller mechanic-and-teaching treatment for strategic or open questions, or when asked. Never pad. Plain language, warm and direct.
- FORMATTING: plain text only. No markdown — no ** or __, no ## headers, no asterisk bullets (they render as literal clutter in the owner's chat). Lists use "- " or "1." only.`;

// Raw Anthropic call with retry (mirrors ads-coach).
async function anthropicRaw(bodyObj: any): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const payload = JSON.stringify(bodyObj);
  const MAX = 4; let lastErr = '';
  for (let attempt = 1; attempt <= MAX; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: payload });
    } catch (netErr: any) {
      lastErr = `fetch failed: ${String(netErr?.message || netErr)}`;
      if (attempt < MAX) { await sleep(Math.min(8000, 2000 * 2 ** (attempt - 1))); continue; }
      throw new Error(`Anthropic ${lastErr}`);
    }
    if (res.ok) return await res.json();
    const body = (await res.text()).slice(0, 300);
    lastErr = `Anthropic ${res.status}: ${body}`;
    if ((res.status === 429 || res.status >= 500) && attempt < MAX) { await sleep(Math.min(8000, 2000 * 2 ** (attempt - 1))); continue; }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || 'Anthropic call failed');
}
const textOf = (data: any) => (data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();

// Ensure there is an active campaign to attach tasks to.
async function ensureActivePlan(admin: any): Promise<string | null> {
  const { data } = await admin.from('seo_plan').select('id').eq('status', 'active').order('created_at', { ascending: false }).limit(1);
  if (data?.[0]?.id) return data[0].id;
  const { data: created } = await admin.from('seo_plan').insert({
    title: 'SEO Campaign — regalosquecantan.com',
    goal: 'Grow non-branded organic search into a compounding free-customer channel.',
    status: 'active',
  }).select().single();
  return created?.id || null;
}

// Chat runner with tools. Caps: 3 fetches/turn, 4 rounds.
async function runChatWithTools(admin: any, system: string, convo: any[]): Promise<{ text: string; fetched: string[]; proposed: string[] }> {
  const fetched: string[] = [];
  const proposed: string[] = [];
  const messages = convo.map((m) => ({ role: m.role, content: m.content }));
  for (let round = 0; round < 4; round++) {
    const data = await anthropicRaw({ model: MODEL, max_tokens: 4000, system, tools: [PAGE_TOOL, PROPOSE_TOOL], messages });
    const content = data?.content || [];
    const toolUses = content.filter((c: any) => c.type === 'tool_use');
    if (!toolUses.length) return { text: textOf(data), fetched, proposed };
    messages.push({ role: 'assistant', content });
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      if (tu.name === 'fetch_page' && fetched.length < 3) {
        const facts = await fetchPageFacts(String(tu.input?.url || ''));
        if (!facts.error) fetched.push(facts.url);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(facts).slice(0, 12_000), is_error: !!facts.error });
      } else if (tu.name === 'propose_task') {
        try {
          const inp = tu.input || {};
          const planId = await ensureActivePlan(admin);
          if (!planId) throw new Error('no active plan');
          const { data: row, error } = await admin.from('seo_plan_tasks').insert({
            plan_id: planId,
            title: String(inp.title || '').slice(0, 200),
            task_type: ['title_meta', 'new_page', 'content_fix', 'link', 'youtube', 'other'].includes(inp.task_type) ? inp.task_type : 'other',
            target_path: String(inp.target_path || '').trim() || null,
            target_queries: Array.isArray(inp.target_queries) ? inp.target_queries.slice(0, 10) : [],
            rationale: String(inp.rationale || '').slice(0, 600),
            draft: {
              title: String(inp.draft_title || ''),
              meta_description: String(inp.draft_meta_description || ''),
              body_markdown: String(inp.draft_body_markdown || ''),
              instructions: String(inp.draft_instructions || ''),
            },
            due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(inp.due_date || '')) ? inp.due_date : null,
            proposed_by: 'coach',
          }).select().single();
          if (error) throw error;
          proposed.push(row.title);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Task proposed (id ${row.id}). The owner will see it as an approval card above this chat — tell them it is there and what approving will do.` });
        } catch (e: any) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Could not save the task: ${String(e?.message || e).slice(0, 150)}`, is_error: true });
        }
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: tu.name === 'fetch_page' ? 'Fetch limit reached this turn (3).' : 'Unknown tool.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return { text: 'I ran out of room mid-research — ask me again and I will answer directly.', fetched, proposed };
}

// Extract the single most concrete recommendation for the track record (Haiku).
async function extractRecommendation(reply: string): Promise<any> {
  if (!ANTHROPIC_API_KEY) return null;
  const sys = `Read this SEO coach message and extract its SINGLE most important concrete recommendation, if any. Return ONLY minified JSON: {"recommendation":"","rationale":"","target_page":""}. "recommendation" = the specific action (e.g. "Rewrite the title on /ocasiones/dia-de-las-madres to lead with 'canción personalizada'"); EMPTY string if no concrete actionable move (pure explanation counts as none). "target_page" = the site path if one page is the target (e.g. "/ocasiones/dia-de-las-madres"), else empty. Keep every field short.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: EXTRACT_MODEL, max_tokens: 300, system: sys, messages: [{ role: 'user', content: reply.slice(0, 4000) }] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return (parsed && parsed.recommendation && String(parsed.recommendation).trim()) ? parsed : null;
  } catch { return null; }
}

// Load everything the campaign panel (and the chat context) needs.
async function loadCampaign(admin: any) {
  const [{ data: planRows }, { data: state }, { data: snaps }] = await Promise.all([
    admin.from('seo_plan').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1),
    admin.from('seo_agent_state').select('*').eq('id', 1).maybeSingle(),
    admin.from('seo_snapshots').select('captured_at, totals').order('captured_at', { ascending: false }).limit(10),
  ]);
  const plan = planRows?.[0] || null;
  let tasks: any[] = [];
  if (plan) {
    const { data } = await admin.from('seo_plan_tasks').select('*').eq('plan_id', plan.id).order('created_at', { ascending: false }).limit(60);
    tasks = data || [];
  }
  return { plan, tasks, state: state || { enabled: true, last_run_at: null }, snapshots: (snaps || []).reverse() };
}

// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // --- Admin gate (same as ads-coach / cos-assistant) ---
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow || roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const action = body.action || 'chat';

    // --- MEMORY: past conversation + track record (cross-session) ---
    if (action === 'history') {
      const [{ data: msgs }, { data: calls }, campaign] = await Promise.all([
        admin.from('seo_coach_messages').select('role, content, created_at').order('created_at', { ascending: true }).limit(60),
        admin.from('seo_coach_calls').select('*').order('created_at', { ascending: false }).limit(30),
        loadCampaign(admin),
      ]);
      return json({ success: true, messages: msgs || [], calls: calls || [], campaign });
    }

    // --- CAMPAIGN panel data ---
    if (action === 'get_plan') {
      return json({ success: true, campaign: await loadCampaign(admin) });
    }

    // --- CAMPAIGN: approve / reject a task ---
    if (action === 'approve_task' || action === 'reject_task') {
      const id = body.id;
      if (!id) return json({ success: false, error: 'missing task id' }, 400);
      const { data: task } = await admin.from('seo_plan_tasks').select('*').eq('id', id).single();
      if (!task) return json({ success: false, error: 'task not found' }, 404);
      if (action === 'reject_task') {
        await admin.from('seo_plan_tasks').update({ status: 'rejected' }).eq('id', id);
        return json({ success: true, campaign: await loadCampaign(admin) });
      }
      // Approve. For title_meta tasks with a draft, publish the build-time
      // override — the acting layer. This is the owner's explicit tap.
      let applied = false, buildTriggered = false;
      await admin.from('seo_plan_tasks').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', id);
      const draft = task.draft || {};
      if (task.task_type === 'title_meta' && task.target_path && (draft.title || draft.meta_description)) {
        const { error: ovErr } = await admin.from('seo_content_overrides').upsert({
          path: task.target_path,
          title: draft.title || null,
          meta_description: draft.meta_description || null,
          published: true,
          task_id: task.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'path' });
        applied = !ovErr;
        if (applied && VERCEL_DEPLOY_HOOK_URL) {
          try { const r = await fetch(VERCEL_DEPLOY_HOOK_URL, { method: 'POST' }); buildTriggered = r.ok; } catch (_e) { /* best-effort */ }
        }
      }
      return json({ success: true, applied, build_triggered: buildTriggered, campaign: await loadCampaign(admin) });
    }

    // --- CAMPAIGN: weekly agent kill switch ---
    if (action === 'set_agent_enabled') {
      await admin.from('seo_agent_state').upsert({ id: 1, enabled: !!body.enabled, updated_at: new Date().toISOString() });
      return json({ success: true, campaign: await loadCampaign(admin) });
    }

    // --- CAMPAIGN: run the weekly review now (manual trigger) ---
    if (action === 'run_weekly') {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/seo-agent-weekly`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({ manual: true }),
        });
        const out = await r.json().catch(() => ({}));
        return json({ success: true, run: out, campaign: await loadCampaign(admin) });
      } catch (e: any) {
        return json({ success: false, error: String(e?.message || e).slice(0, 300) });
      }
    }

    // --- TRACK RECORD: owner grades a past recommendation ---
    if (action === 'resolve_call') {
      const id = body.id; const verdict = body.verdict;
      if (!id || !['correct', 'wrong', 'dismissed'].includes(verdict)) return json({ success: false, error: 'bad resolve' }, 400);
      await admin.from('seo_coach_calls').update({ status: verdict, resolved_at: new Date().toISOString() }).eq('id', id);
      const { data: calls } = await admin.from('seo_coach_calls').select('*').order('created_at', { ascending: false }).limit(30);
      return json({ success: true, calls: calls || [] });
    }

    // --- CHAT (default) ---
    if (!hasGscKey()) return json({ success: false, error: 'GSC_SERVICE_ACCOUNT_JSON not set — the coach needs the Search Console key to read your search data.' }, 200);
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const convo = incoming
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!convo.length || convo[convo.length - 1].role !== 'user') {
      return json({ success: false, error: 'Ask the coach a question.' }, 400);
    }
    const userQuestion = String(convo[convo.length - 1].content);

    // Live snapshot — best-effort; a GSC hiccup means answering on principle, flagged.
    let context: any = null, contextErr = '';
    try { context = await gatherSearchContext(admin); }
    catch (e: any) { contextErr = String(e?.message || e).slice(0, 200); }

    const contextBlock = context
      ? `LIVE SEARCH CONSOLE SNAPSHOT (pulled just now — reason from THIS, it outranks the doc):\n${JSON.stringify(context, null, 2)}`
      : `LIVE SEARCH CONSOLE SNAPSHOT: unavailable this turn (${contextErr || 'no data'}). Tell the owner you couldn't pull fresh search data and answer on principle, clearly flagged.`;

    // Campaign context: plan, tasks, ranking history, seasonal windows.
    const campaign = await loadCampaign(admin);
    const campaignBlock = `CAMPAIGN STATE (the ongoing plan you and the weekly agent run with the owner):\n${JSON.stringify({
      plan: campaign.plan ? { title: campaign.plan.title, goal: campaign.plan.goal } : 'none yet — created automatically on your first propose_task',
      weekly_agent: { enabled: campaign.state?.enabled !== false, last_run_at: campaign.state?.last_run_at || 'never' },
      tasks: campaign.tasks.map((t: any) => ({ title: t.title, type: t.task_type, status: t.status, target_path: t.target_path, target_queries: t.target_queries, due: t.due_date })),
      ranking_history_weekly_totals: campaign.snapshots.map((s: any) => ({ at: String(s.captured_at).slice(0, 10), ...s.totals })),
      seasonal_windows: upcomingSeasonalWindows(),
    }, null, 2)}`;

    // Seasonal push context (same source the creative generators use).
    let promoNotes = '';
    try {
      const { data: cfg } = await admin.from('creative_studio_config').select('promo_notes').eq('id', 1).single();
      promoNotes = cfg?.promo_notes || '';
    } catch (_e) { /* optional */ }

    const system = `${COACH_SYSTEM}

WHAT THIS BUSINESS SELLS (so your advice fits the real product, not generic e-commerce):
${brandContext(promoNotes)}

${contextBlock}

${campaignBlock}

${seoBrainContext('HOW GOOGLE + AI SEARCH SELECT RESULTS — reason with these mechanics (respect the confidence tags):')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL OUTPUT RULES — these override the formatting of everything above. Obey them every single time:
1. PLAIN TEXT ONLY. Absolutely no markdown. Never ** or __ or ## (they show as literal symbols in the owner's chat). Lists use "- " or "1." only. The doc above uses CAPS/symbols for YOUR reading — do not copy that style.
2. MATCH LENGTH TO THE QUESTION. Narrow question → a few sentences. Strategic/open question → fuller treatment. Never pad or repeat.
3. When you discuss a specific page (ours or a competitor's), use fetch_page FIRST and critique the real page. Never review a page from imagination.
4. When the owner agrees a specific move is worth doing (or asks you to plan), save it with propose_task — a card they can approve beats advice that evaporates.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    const { text: reply, fetched, proposed } = await runChatWithTools(admin, system, convo);

    // MEMORY: persist just this turn (frontend re-sends history each call).
    try {
      await admin.from('seo_coach_messages').insert([
        { role: 'user', content: userQuestion.slice(0, 8000) },
        { role: 'assistant', content: reply.slice(0, 8000) },
      ]);
    } catch (_e) { /* best-effort */ }

    // TRACK RECORD: log the top concrete recommendation for grading — but only
    // when the coach did NOT already turn it into a campaign task (tasks are
    // the stronger, verifiable form; double-logging would clutter the record).
    let calls: any[] = [];
    try {
      if (!proposed.length) {
        const rec = await extractRecommendation(reply);
        if (rec?.recommendation) {
          await admin.from('seo_coach_calls').insert({
            recommendation: String(rec.recommendation).slice(0, 300),
            rationale: String(rec.rationale || '').slice(0, 400),
            target_page: String(rec.target_page || '').slice(0, 200),
          });
        }
      }
      const { data } = await admin.from('seo_coach_calls').select('*').order('created_at', { ascending: false }).limit(30);
      calls = data || [];
    } catch (_e) { /* best-effort */ }

    return json({
      success: true, reply, brain_reviewed: SEO_BRAIN_LAST_REVIEWED, had_live_data: !!context,
      pages_read: fetched, tasks_proposed: proposed, calls,
      campaign: proposed.length ? await loadCampaign(admin) : undefined,
    });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});
