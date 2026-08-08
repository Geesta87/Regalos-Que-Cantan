// supabase/functions/seo-agent-weekly/index.ts
// ===========================================================================
// SEO CAMPAIGN AGENT — weekly heartbeat (pg_cron, Mondays).
// ===========================================================================
// What one run does, in order (every step fail-soft):
//   1. Pull a fresh Search Console snapshot and STORE it (seo_snapshots) —
//      this builds the ranking history the coach can never show today.
//   2. Compare against the previous snapshot → movement report.
//   3. VERIFY work: fetch the live pages behind approved tasks and open
//      recommendations; detect "implemented" mechanically (title/meta match)
//      and mark it, with evidence. Auto-grade recommendations whose target
//      queries actually moved.
//   4. Check the seasonal calendar → make sure build-ahead work is proposed
//      in time (pages need months of indexing — seo-brain §4).
//   5. Ask Claude for the weekly digest + up to 3 new proposed tasks (each
//      with a ready-to-apply draft). Proposals land as status='proposed' —
//      NOTHING is applied without the owner tapping Approve in the tab.
//   6. Post the digest into the SEO Coach chat + email ALERT_EMAIL.
//
// Kill switch: seo_agent_state.enabled (toggle in the SEO Coach tab).
// Manual run: POST {"manual": true} from seo-coach's run_weekly action —
// bypasses the enabled flag so the owner can always trigger a review.
//
// Deploy: supabase functions deploy seo-agent-weekly --project-ref yzbvajungshqcpusfiia
// (config.toml pins verify_jwt=false — pg_cron carries no JWT.)
// ===========================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  gatherSearchContext, positionsForQueries, fetchPageFacts, inspectUrl, hasGscKey,
  upcomingSeasonalWindows, GSC_SITE, TRAFFIC_SOURCE_LIVE_FROM,
} from '../_shared/seo-gsc.ts';
import { seoBrainContext } from '../_shared/seo-brain.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('SEO_AGENT_MODEL') || 'claude-opus-5';
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL');
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') || 'hola@regalosquecantan.com';
const VERCEL_DEPLOY_HOOK_URL = Deno.env.get('VERCEL_DEPLOY_HOOK_URL');

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Raw Anthropic call with retry (same shape as seo-coach / ads-coach).
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

// Digest + proposals come back as validated JSON via structured outputs.
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['digest', 'proposals'],
  properties: {
    digest: { type: 'string', description: 'The weekly review the owner reads. Plain text, no markdown symbols. Lead with what moved, then what got done, then the ONE thing to do this week. Honest about small numbers.' },
    proposals: {
      type: 'array',
      description: 'Up to 3 NEW tasks (skip anything already open). Each must carry a finished draft, not homework.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'task_type', 'target_path', 'target_queries', 'rationale', 'draft', 'due_date'],
        properties: {
          title: { type: 'string' },
          task_type: { type: 'string', enum: ['title_meta', 'new_page', 'content_fix', 'link', 'youtube', 'other'] },
          target_path: { type: 'string', description: 'Site route this targets, e.g. /ocasiones/dia-de-las-madres. Empty string if none.' },
          target_queries: { type: 'array', items: { type: 'string' }, description: 'The exact search queries this should move (from the snapshot).' },
          rationale: { type: 'string', description: '1-2 sentences: the mechanic + the data behind it.' },
          draft: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'meta_description', 'body_markdown', 'instructions', 'clip_id'],
            properties: {
              title: { type: 'string', description: 'For title_meta/new_page: the exact new <title>. Else empty string.' },
              meta_description: { type: 'string', description: 'For title_meta/new_page: the exact new meta description. Else empty string.' },
              body_markdown: { type: 'string', description: 'For new_page/content_fix: full ready page copy in Spanish (headings, FAQ, unique asset ideas). Else empty string.' },
              instructions: { type: 'string', description: 'Plain-English steps for whoever applies it (owner or dev session).' },
              clip_id: { type: 'string', description: 'For youtube tasks ONLY: the id of the ready clip to post (pick from candidate_youtube_clips in the data). Else empty string.' },
            },
          },
          due_date: { type: 'string', description: 'YYYY-MM-DD deadline, or empty string if none.' },
        },
      },
    },
  },
};

async function sendDigestEmail(subject: string, text: string) {
  if (!SENDGRID_API_KEY || !ALERT_EMAIL) return;
  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
        from: { email: SENDER_EMAIL, name: 'RQC SEO Agent' },
        subject,
        content: [{ type: 'text/plain', value: text }],
      }),
    });
  } catch (_e) { /* best-effort */ }
}

serve(async (req: Request) => {
  try {
    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Kill switch (manual runs from the dashboard bypass it).
    const { data: state } = await admin.from('seo_agent_state').select('*').eq('id', 1).single();
    if (!body.manual && state && state.enabled === false) {
      return json({ success: true, skipped: 'agent disabled' });
    }
    if (!hasGscKey()) return json({ success: false, error: 'GSC_SERVICE_ACCOUNT_JSON not set' });

    const notes: string[] = [];

    // ── AI-answer visibility: kicked off FIRST and awaited later ────────────
    // These web-search calls are the slowest single item and need nothing from
    // the other steps, so they run concurrently with everything below — the
    // whole run must fit the edge-function wall clock (~400s).
    const AI_VISIBILITY_PROMPTS = [
      'What is the best service to get a personalized song in Spanish made as a gift for my wife?',
      '¿Dónde puedo mandar a hacer una canción personalizada para regalarle a mi mamá?',
      'I want to gift my girlfriend a custom corrido with her name in it. Where can I get one made?',
      'Best personalized Spanish song gift for an anniversary — what service should I use?',
    ];
    const aiVisibilityPromise: Promise<any[]> = !ANTHROPIC_API_KEY ? Promise.resolve([]) :
      Promise.all(AI_VISIBILITY_PROMPTS.map(async (prompt) => {
        try {
          const ans = await anthropicRaw({
            model: MODEL, max_tokens: 2000,
            output_config: { effort: 'low' },
            tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
            messages: [{ role: 'user', content: prompt }],
          });
          const answerText = (ans?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').slice(0, 3000);
          const ex = await anthropicRaw({
            model: MODEL, max_tokens: 300,
            output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['rqc_mentioned', 'brands'], properties: { rqc_mentioned: { type: 'boolean', description: 'Was Regalos Que Cantan / regalosquecantan.com mentioned or recommended?' }, brands: { type: 'array', items: { type: 'string' }, description: 'Every brand/service named in the answer.' } } } } },
            messages: [{ role: 'user', content: `Which brands does this answer recommend?\n\n${answerText}` }],
          });
          const v = JSON.parse((ex?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
          return { prompt, engine: 'claude+websearch', rqc_mentioned: !!v.rqc_mentioned, brands_mentioned: (v.brands || []).slice(0, 10), answer_excerpt: answerText.slice(0, 500) };
        } catch (_e) { return null; }
      })).then((rows) => rows.filter(Boolean));

    // ── 1. Snapshot ─────────────────────────────────────────────────────────
    let snapshot: any = null;
    try { snapshot = await gatherSearchContext(admin); }
    catch (e: any) { notes.push(`Search Console pull failed: ${String(e?.message || e).slice(0, 150)}`); }

    let prevSnapshot: any = null;
    try {
      const { data } = await admin.from('seo_snapshots').select('*').order('captured_at', { ascending: false }).limit(1);
      prevSnapshot = data?.[0] || null;
    } catch (_e) { /* ok */ }

    if (snapshot) {
      try {
        await admin.from('seo_snapshots').insert({
          totals: snapshot.totals_28d,
          branded_split: snapshot.branded_vs_nonbranded_28d,
          top_queries: snapshot.top_queries_28d,
          top_pages: snapshot.top_pages_28d,
          almost_ranking: snapshot.almost_ranking?.rows || [],
          orders_context: snapshot.real_orders_context?.last_28d || {},
        });
      } catch (e: any) { notes.push(`snapshot store failed: ${String(e?.message || e).slice(0, 120)}`); }
    }

    // ── 2. Movement vs previous snapshot ────────────────────────────────────
    const movement: any[] = [];
    if (snapshot && prevSnapshot) {
      const prevByQuery: Record<string, any> = {};
      for (const r of (prevSnapshot.top_queries || [])) prevByQuery[r.query] = r;
      for (const r of (prevSnapshot.almost_ranking || [])) if (!prevByQuery[r.query]) prevByQuery[r.query] = r;
      const curRows = [...(snapshot.top_queries_28d || []), ...((snapshot.almost_ranking?.rows) || [])];
      const seen = new Set<string>();
      for (const r of curRows) {
        if (!r.query || seen.has(r.query)) continue;
        seen.add(r.query);
        const p = prevByQuery[r.query];
        if (p && typeof p.position === 'number' && Math.abs(p.position - r.position) >= 1) {
          movement.push({ query: r.query, from: p.position, to: r.position, impressions: r.impressions, clicks: r.clicks });
        }
      }
      movement.sort((a, b) => (a.to - a.from) - (b.to - b.from)); // biggest improvements first
    }

    // ── 3. Verify tasks + auto-grade recommendations ────────────────────────
    const { data: planRows } = await admin.from('seo_plan').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1);
    const plan = planRows?.[0] || null;
    let tasks: any[] = [];
    if (plan) {
      const { data } = await admin.from('seo_plan_tasks').select('*').eq('plan_id', plan.id).order('created_at', { ascending: true });
      tasks = data || [];
    }

    const siteBase = GSC_SITE.replace(/\/$/, '');
    const verifyNotes: string[] = [];

    // 3a. Approved tasks with a target page: did the change land on the live site?
    for (const t of tasks.filter((x) => x.status === 'approved' && x.target_path)) {
      const facts = await fetchPageFacts(`${siteBase}${t.target_path}`);
      if (facts.error) { verifyNotes.push(`${t.target_path}: fetch failed (${facts.error})`); continue; }
      const draft = t.draft || {};
      const titleMatch = draft.title && facts.title && facts.title.trim() === String(draft.title).trim();
      const metaMatch = draft.meta_description && facts.meta_description && facts.meta_description.trim() === String(draft.meta_description).trim();
      const pageExists = t.task_type === 'new_page' && facts.http_status === 200 && (facts.text_length_chars || 0) > 500;
      if (titleMatch || metaMatch || pageExists) {
        await admin.from('seo_plan_tasks').update({
          status: 'implemented', implemented_at: new Date().toISOString(),
          evidence: { ...t.evidence, implemented_check: { at: new Date().toISOString(), live_title: facts.title, title_match: !!titleMatch, meta_match: !!metaMatch } },
        }).eq('id', t.id);
        verifyNotes.push(`IMPLEMENTED: "${t.title}" — live page now matches the approved draft.`);
      }
    }

    // 3b. Implemented tasks: are the target queries moving? (verify after real movement)
    const trackedQueries = [...new Set(tasks.filter((x) => ['implemented', 'approved'].includes(x.status)).flatMap((x) => x.target_queries || []))];
    const trackedPositions = await positionsForQueries(trackedQueries);
    for (const t of tasks.filter((x) => x.status === 'implemented')) {
      const qs = (t.target_queries || []).filter((q: string) => trackedPositions[q]);
      if (!qs.length) continue;
      const baseline = (t.evidence || {}).baseline_positions || {};
      const improved = qs.filter((q: string) => typeof baseline[q]?.position === 'number' && trackedPositions[q].position < baseline[q].position - 0.9);
      if (!Object.keys(baseline).length) {
        // First check after implementation: record the baseline to compare against later.
        await admin.from('seo_plan_tasks').update({
          evidence: { ...t.evidence, baseline_positions: Object.fromEntries(qs.map((q: string) => [q, trackedPositions[q]])) },
        }).eq('id', t.id);
      } else if (improved.length) {
        await admin.from('seo_plan_tasks').update({
          status: 'verified', verified_at: new Date().toISOString(),
          evidence: { ...t.evidence, verified: { at: new Date().toISOString(), moved: Object.fromEntries(improved.map((q: string) => [q, { from: baseline[q].position, to: trackedPositions[q].position }])) } },
        }).eq('id', t.id);
        verifyNotes.push(`VERIFIED: "${t.title}" — ${improved.map((q: string) => `"${q}" ${baseline[q].position} → ${trackedPositions[q].position}`).join(', ')}.`);
      }
    }

    // 3c. Auto-check open coach recommendations against their target page.
    try {
      const { data: openCalls } = await admin.from('seo_coach_calls').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(6);
      await Promise.all((openCalls || []).map(async (c: any) => {
        const path = String(c.target_page || '').trim();
        if (!path.startsWith('/')) return;
        const facts = await fetchPageFacts(`${siteBase}${path}`);
        if (facts.error || !ANTHROPIC_API_KEY) return;
        const judge = await anthropicRaw({
          model: MODEL, max_tokens: 300,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['implemented', 'evidence'], properties: { implemented: { type: 'boolean' }, evidence: { type: 'string' } } } } },
          messages: [{ role: 'user', content: `Recommendation given to a site owner: "${c.recommendation}"\n\nThe live page at ${path} now shows:\ntitle: ${facts.title}\nmeta: ${facts.meta_description}\nh1: ${(facts.h1 || []).join(' | ')}\nexcerpt: ${String(facts.visible_text_excerpt || '').slice(0, 800)}\n\nHas the recommendation been implemented on this page? Judge only from what is shown.` }],
        }).catch(() => null);
        const verdictText = (judge?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        let verdict: any = null; try { verdict = JSON.parse(verdictText); } catch { /* skip */ }
        if (verdict) {
          await admin.from('seo_coach_calls').update({
            auto_status: verdict.implemented ? 'implemented' : 'stale',
            auto_evidence: String(verdict.evidence || '').slice(0, 300),
            auto_checked_at: new Date().toISOString(),
          }).eq('id', c.id);
          if (verdict.implemented) verifyNotes.push(`Recommendation implemented (auto-detected): ${c.recommendation}`);
        }
      }));
    } catch (_e) { /* best-effort */ }

    // ── 3d. Index coverage: are our important pages actually IN Google? ─────
    // "Crawled - currently not indexed" is the silent killer for new pages.
    const index_flags: any[] = [];
    try {
      const pathsToCheck = [...new Set([
        '/', '/canciones-para-regalar',
        ...tasks.filter((t) => ['approved', 'implemented', 'verified'].includes(t.status) && t.target_path).map((t) => t.target_path),
      ])].slice(0, 8);
      const inspections = await Promise.all(pathsToCheck.map((p) => inspectUrl(`${siteBase}${p}`).then((r) => ({ p, r }))));
      for (const { p, r } of inspections) {
        if (r.error) continue;
        if (!r.indexed) index_flags.push({ path: p, coverage_state: r.coverage_state, last_crawl: r.last_crawl });
      }
      if (index_flags.length) verifyNotes.push(`NOT IN GOOGLE'S INDEX yet: ${index_flags.map((f) => `${f.path} (${f.coverage_state})`).join(', ')}`);
    } catch (_e) { /* best-effort */ }

    // ── 3e. AI-answer visibility: collect the results kicked off at the top ─
    let ai_visibility: any[] = [];
    try {
      ai_visibility = await aiVisibilityPromise;
      for (const r of ai_visibility) {
        await admin.from('seo_ai_visibility').insert({ engine: r.engine, prompt: r.prompt, rqc_mentioned: r.rqc_mentioned, brands_mentioned: r.brands_mentioned, answer_excerpt: r.answer_excerpt });
      }
    } catch (_e) { /* best-effort */ }
    let ai_visibility_prev: any[] = [];
    try {
      const { data } = await admin.from('seo_ai_visibility').select('run_at, prompt, rqc_mentioned, brands_mentioned')
        .lt('run_at', new Date(Date.now() - 3 * 864e5).toISOString()).order('run_at', { ascending: false }).limit(8);
      ai_visibility_prev = data || [];
    } catch (_e) { /* ok */ }

    // ── 3f. Ready clips the agent may propose posting to YouTube ────────────
    let candidate_youtube_clips: any[] = [];
    try {
      const { data } = await admin.from('clips').select('id, label, status, youtube_post_id, created_at')
        .eq('status', 'ready').is('youtube_post_id', null).order('created_at', { ascending: false }).limit(6);
      candidate_youtube_clips = (data || []).map((c) => ({ clip_id: c.id, label: c.label }));
    } catch (_e) { /* ok */ }

    // ── 4. Seasonal build-ahead check ───────────────────────────────────────
    const seasonal = upcomingSeasonalWindows();
    const seasonalGaps = seasonal.filter((s) => s.in_build_window && !tasks.some((t) =>
      (t.title || '').toLowerCase().includes(s.name.toLowerCase()) || (t.target_path || '').includes(s.key)));

    // ── 5. Claude: digest + proposals ───────────────────────────────────────
    let digest = '';
    let proposalsInserted = 0;
    if (ANTHROPIC_API_KEY) {
      try {
        const context = {
          snapshot_now: snapshot ? { totals_28d: snapshot.totals_28d, totals_prev_28d: snapshot.totals_prev_28d, branded_split: snapshot.branded_vs_nonbranded_28d, top_queries: snapshot.top_queries_28d, almost_ranking: snapshot.almost_ranking, top_pages: snapshot.top_pages_28d, orders: snapshot.real_orders_context } : null,
          movement_vs_last_week: movement.slice(0, 25),
          verification_notes: verifyNotes,
          plan: plan ? { title: plan.title, goal: plan.goal } : null,
          tasks: tasks.map((t) => ({ title: t.title, type: t.task_type, status: t.status, target_path: t.target_path, due_date: t.due_date })),
          seasonal_calendar: seasonal,
          seasonal_gaps_needing_tasks: seasonalGaps,
          pages_not_in_google_index: index_flags,
          ai_answer_visibility_this_week: ai_visibility.map((r) => ({ prompt: r.prompt, rqc_mentioned: r.rqc_mentioned, brands_mentioned: r.brands_mentioned })),
          ai_answer_visibility_previous: ai_visibility_prev,
          candidate_youtube_clips,
          youtube_note: 'You may propose at most ONE youtube task per week: pick a clip from candidate_youtube_clips (set draft.clip_id) and explain in plain words why posting it helps AIs and Google recommend us. When approved it posts to the connected YouTube channel with an auto-written search-friendly caption.',
          run_notes: notes,
          attribution_note: `Organic revenue is a measured FLOOR from ${TRAFFIC_SOURCE_LIVE_FROM} onward only.`,
        };
        const data = await anthropicRaw({
          model: MODEL, max_tokens: 32000,
          // effort medium: the digest must finish inside the edge-function wall
          // clock alongside everything else; medium is plenty for this task.
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
          system: `You are the weekly SEO campaign agent for Regalos Que Cantan (personalized Spanish songs, ~$30 orders, US-Hispanic market, regalosquecantan.com). You write the owner's Monday SEO review and propose the next moves.

THE OWNER KNOWS NOTHING ABOUT SEO — you do ALL the thinking. Write the digest the way you'd explain to a smart friend who has never heard the word "SEO": no jargon (never say SERP, CTR, meta, indexing without a plain-word explanation), short and plain. LANGUAGE RULE: the digest, task titles, and rationales are ALWAYS in ENGLISH (this is the admin dashboard); only the draft page content itself (titles/meta/copy that ships to the site) is in Spanish. Every proposal's rationale must let them decide with zero expertise: what will change, why it should bring more free customers, and that it's safe/reversible. Before proposing to fix something on a page, trust the current live-page evidence over any claim in the brain doc — never propose fixing something already fixed. Be honest about small numbers and slow timelines — never inflate. Proposals must carry FINISHED drafts (exact titles/meta in Spanish, full page copy in Spanish for new pages) so approving is one tap and rejecting loses nothing. Never propose a task that duplicates an existing open task. Prioritize: striking-distance fixes > seasonal build-ahead (cover every seasonal gap listed) > new long-tail pages > YouTube/mentions for AI visibility.

${seoBrainContext('Ground every proposal in these verified mechanics (but keep the OWNER-facing words simple):')}`,
          messages: [{ role: 'user', content: `Weekly data:\n${JSON.stringify(context, null, 2)}\n\nWrite the weekly review digest and propose up to 3 new tasks (cover seasonal gaps first). Keep each body_markdown under ~700 words.` }],
        });
        if (data?.stop_reason === 'max_tokens') throw new Error('digest truncated at max_tokens');
        const text = (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        const parsed = JSON.parse(text);
        digest = String(parsed.digest || '').trim();

        // Insert proposals (needs an active plan — create the default campaign lazily).
        let planId = plan?.id;
        if (!planId && (parsed.proposals || []).length) {
          const { data: newPlan } = await admin.from('seo_plan').insert({ title: 'SEO Campaign — regalosquecantan.com', goal: 'Grow non-branded organic search into a compounding free-customer channel.', status: 'active' }).select().single();
          planId = newPlan?.id;
        }
        const insertedTasks: any[] = [];
        for (const p of (parsed.proposals || []).slice(0, 3)) {
          if (!planId) break;
          const { data: row } = await admin.from('seo_plan_tasks').insert({
            plan_id: planId, title: String(p.title).slice(0, 200), task_type: p.task_type,
            target_path: p.target_path || null, target_queries: p.target_queries || [],
            rationale: String(p.rationale || '').slice(0, 600), draft: p.draft || {},
            due_date: p.due_date || null, proposed_by: 'weekly_agent',
          }).select().single();
          if (row) insertedTasks.push(row);
          proposalsInserted++;
        }

        // AUTOPILOT: with the owner's standing consent (seo_agent_state.autopilot,
        // flipped ON in the dashboard), auto-approve and publish the agent's own
        // title/meta proposals — the reversible, lowest-risk task type. Everything
        // else always waits for a manual tap.
        if (state?.autopilot) {
          const applied: string[] = [];
          for (const t of insertedTasks.filter((x) => x.task_type === 'title_meta' && x.target_path && ((x.draft || {}).title || (x.draft || {}).meta_description))) {
            const d = t.draft || {};
            const { error: ovErr } = await admin.from('seo_content_overrides').upsert({
              path: t.target_path, title: d.title || null, meta_description: d.meta_description || null,
              published: true, task_id: t.id, updated_at: new Date().toISOString(),
            }, { onConflict: 'path' });
            if (!ovErr) {
              await admin.from('seo_plan_tasks').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', t.id);
              applied.push(`${t.title} (${t.target_path})`);
            }
          }
          if (applied.length) {
            if (VERCEL_DEPLOY_HOOK_URL) { try { await fetch(VERCEL_DEPLOY_HOOK_URL, { method: 'POST' }); } catch (_e) { /* best-effort */ } }
            digest += `\n\nAUTOPILOT: I went ahead and applied ${applied.length === 1 ? 'this change' : 'these changes'} myself (you turned autopilot on): ${applied.join('; ')}. ${VERCEL_DEPLOY_HOOK_URL ? 'The site is rebuilding now.' : 'It goes live with the next site deploy.'} You can undo any of it by rejecting the task in the dashboard.`;
          }
        }
      } catch (e: any) {
        notes.push(`digest generation failed: ${String(e?.message || e).slice(0, 150)}`);
      }
    }
    if (!digest) {
      digest = `Weekly SEO review ran with issues: ${notes.join(' | ') || 'no digest generated'}. Verification notes: ${verifyNotes.join(' | ') || 'none'}.`;
    }

    // ── 6. Deliver: coach chat + email + state ──────────────────────────────
    const stamped = `WEEKLY SEO REVIEW — ${new Date().toISOString().slice(0, 10)}\n\n${digest}`;
    try { await admin.from('seo_coach_messages').insert({ role: 'assistant', content: stamped.slice(0, 8000) }); } catch (_e) { /* ok */ }
    try {
      await admin.from('seo_agent_state').upsert({ id: 1, last_run_at: new Date().toISOString(), last_digest: digest.slice(0, 4000), updated_at: new Date().toISOString() });
    } catch (_e) { /* ok */ }
    await sendDigestEmail(`SEO weekly review — ${new Date().toISOString().slice(0, 10)}`, stamped);

    return json({ success: true, movement: movement.length, verified: verifyNotes, proposals: proposalsInserted, notes });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});
