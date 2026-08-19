// supabase/functions/cs-training-admin/index.ts
//
// Backs the admin "Bot Training" panel. Lets the owner edit the customer-service
// rep's knowledge (facts, prices, tone, rules) in plain text — saved to
// cs_agent_settings.knowledge_doc, which cs-agent reads on the very next message
// (no redeploy). Also lists/deletes the auto-learned reply examples.
//
// Auth: same as sms-admin — the gateway verifies the Supabase Auth JWT
// (config.toml verify_jwt = true), then we require a row in admin_users. Only
// role='admin' may save (it changes what the bot says to customers).
//
// Contract with the frontend (BotTrainingTab.jsx):
//   GET  → { success, role, enabled, knowledge, is_custom, examples: [...] }
//   POST { action:'save', knowledge }        → { success }
//   POST { action:'reset' }                  → { success }  (revert to default)
//   POST { action:'delete-example', id }     → { success }
//   POST { action:'toggle', enabled }        → { success }  (bot master switch)
//
// Deploy with: supabase functions deploy cs-training-admin --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CS_KNOWLEDGE } from '../_shared/cs-knowledge.ts';
import { classifyCs, CS_CATEGORY_LABELS, type CsCategory } from '../_shared/cs-categories.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const AI_EDIT_MODEL = Deno.env.get('CS_TRAINING_EDIT_MODEL') || 'claude-sonnet-4-6';

// ── Learned-facts section ───────────────────────────────────────────────────
// Approving a distilled fact used to do `doc + "\n\n# " + title + "\n" + body`.
// Blind append, forever, with no dedupe and no structure. Over ~2 weeks that
// bolted ten loose English-titled blocks onto the end of a carefully written
// Spanish document and grew it from 11.6k to 15.1k characters — and the blocks
// started CONTRADICTING the body (the doc said customers abroad need a US payer;
// an appended block said they can just use an international card). The bot was
// handed both, in the same prompt, and had to guess.
//
// Now the learned facts live in ONE delimited, de-duplicated section at the end.
// Re-approving the same title REPLACES that entry instead of stacking a new one,
// so the section converges instead of growing without bound, and the owner can
// see at a glance what the bot taught itself versus what they wrote.
const LEARNED_START = '<!-- APRENDIDO:INICIO — sección administrada automáticamente, editable -->';
const LEARNED_END = '<!-- APRENDIDO:FIN -->';

export function mergeLearnedFact(doc: string, title: string, proposal: string): string {
  const entry = `### ${title}\n${proposal}`;
  const startIdx = doc.indexOf(LEARNED_START);
  const endIdx = doc.indexOf(LEARNED_END);

  // No managed section yet → create one at the end.
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return `${doc.trimEnd()}\n\n---\n\n## APRENDIDO DE CASOS REALES\n${LEARNED_START}\n\n${entry}\n\n${LEARNED_END}\n`;
  }

  const head = doc.slice(0, startIdx + LEARNED_START.length);
  const body = doc.slice(startIdx + LEARNED_START.length, endIdx);
  const tail = doc.slice(endIdx);

  // Split existing entries on the `### ` heading and drop any with this title,
  // so an updated fact supersedes the old one instead of contradicting it.
  const existing = body
    .split(/\n(?=### )/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.replace(/^###\s*/, '').split('\n')[0].trim().toLowerCase() !== title.toLowerCase());

  return `${head}\n\n${[...existing, entry].join('\n\n')}\n\n${tail}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ success: false, error: 'Missing Authorization header' }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow } = await admin
      .from('admin_users').select('role').eq('user_id', userData.user.id).single();
    if (!roleRow) return json({ success: false, error: 'No admin access' }, 403);
    const role = roleRow.role as 'admin' | 'assistant';

    let body: { action?: string; knowledge?: string; id?: string; enabled?: boolean; proposal_id?: string; instruction?: string } = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
    const action = body.action || 'get';

    // ── get: knowledge + recent learned examples ─────────────────────────
    if (action === 'get') {
      const { data: settings } = await admin
        .from('cs_agent_settings').select('enabled, knowledge_doc').eq('id', 1).maybeSingle();
      const { data: examples } = await admin
        .from('cs_examples')
        .select('id, created_at, channel, customer_msg, reply, was_edited, source')
        .order('created_at', { ascending: false })
        .limit(50);
      const custom = (settings?.knowledge_doc || '').trim();
      // Step 4: pending knowledge proposals from cs-distill-knowledge awaiting
      // the owner's approval.
      const { data: proposals } = await admin
        .from('cs_knowledge_proposals')
        .select('id, kind, title, proposal, rationale, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(20);
      return json({
        success: true,
        role,
        enabled: !!settings?.enabled,
        knowledge: custom || CS_KNOWLEDGE,
        is_custom: !!custom,
        examples: examples || [],
        proposals: proposals || [],
      });
    }

    // ── insights: CS scoreboard — edit-rate BY question type + weekly trend ──
    // Read-only (both roles may view). This is the instrument panel: it shows
    // which answer types the bot nails vs. which the owner keeps rewriting, and
    // whether that's improving. It's also the gate for auto-send later: a type
    // is only safe to auto-send once its edit-rate is consistently near zero.
    if (action === 'insights') {
      // Pull the reply log (owner-approved AI drafts + owner-written replies).
      const { data: rows } = await admin
        .from('cs_examples')
        .select('customer_msg, was_edited, source, created_at')
        .order('created_at', { ascending: false })
        .limit(5000);
      const examples = rows || [];

      // Monday-anchored week key, computed without Date.now (stable for a given row).
      const weekKey = (iso: string): string => {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return 'unknown';
        const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
        return monday.toISOString().slice(0, 10);
      };

      type Bucket = { ai_used: number; edited: number; manual: number };
      const fresh = (): Bucket => ({ ai_used: 0, edited: 0, manual: 0 });
      const byCat: Record<string, Bucket> = {};
      const byWeek: Record<string, Bucket> = {};

      for (const e of examples) {
        const cat = classifyCs(e.customer_msg as string);
        const wk = weekKey(String(e.created_at));
        byCat[cat] ||= fresh();
        byWeek[wk] ||= fresh();
        const isApprove = e.source === 'approve';
        const isManual = e.source === 'manual';
        for (const bkt of [byCat[cat], byWeek[wk]]) {
          if (isApprove) { bkt.ai_used++; if (e.was_edited) bkt.edited++; }
          else if (isManual) { bkt.manual++; }
        }
      }

      const pct = (n: number, d: number) => (d > 0 ? Math.round((100 * n) / d) : null);
      const by_category = Object.entries(byCat)
        .map(([category, b]) => ({
          category,
          label: CS_CATEGORY_LABELS[category as CsCategory] || category,
          ai_used: b.ai_used,
          edited: b.edited,
          sent_asis: b.ai_used - b.edited,
          edit_rate: pct(b.edited, b.ai_used),
          manual: b.manual,
          // Adoption = of all replies for this type, how many the bot actually produced.
          adoption_rate: pct(b.ai_used, b.ai_used + b.manual),
          total: b.ai_used + b.manual,
        }))
        .sort((a, b) => b.total - a.total);

      const trend_weekly = Object.entries(byWeek)
        .filter(([wk]) => wk !== 'unknown')
        .map(([week, b]) => ({ week, ai_used: b.ai_used, edited: b.edited, edit_rate: pct(b.edited, b.ai_used) }))
        .sort((a, b) => a.week.localeCompare(b.week))
        .slice(-8);

      const totalApprove = examples.filter((e) => e.source === 'approve').length;
      const totalEdited = examples.filter((e) => e.source === 'approve' && e.was_edited).length;
      const totalManual = examples.filter((e) => e.source === 'manual').length;
      return json({
        success: true,
        insights: {
          by_category,
          trend_weekly,
          totals: {
            ai_used: totalApprove,
            edited: totalEdited,
            edit_rate: pct(totalEdited, totalApprove),
            manual: totalManual,
            adoption_rate: pct(totalApprove, totalApprove + totalManual),
            sample_size: examples.length,
          },
        },
      });
    }

    // ── insights: CS scoreboard — edit-rate BY question type + weekly trend ──
    // Read-only (both roles may view). This is the instrument panel: it shows
    // which answer types the bot nails vs. which the owner keeps rewriting, and
    // whether that's improving. It's also the gate for auto-send later: a type
    // is only safe to auto-send once its edit-rate is consistently near zero.
    if (action === 'insights') {
      // Pull the reply log (owner-approved AI drafts + owner-written replies).
      const { data: rows } = await admin
        .from('cs_examples')
        .select('customer_msg, was_edited, source, created_at')
        .order('created_at', { ascending: false })
        .limit(5000);
      const examples = rows || [];

      // Monday-anchored week key, computed without Date.now (stable for a given row).
      const weekKey = (iso: string): string => {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return 'unknown';
        const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
        return monday.toISOString().slice(0, 10);
      };

      type Bucket = { ai_used: number; edited: number; manual: number };
      const fresh = (): Bucket => ({ ai_used: 0, edited: 0, manual: 0 });
      const byCat: Record<string, Bucket> = {};
      const byWeek: Record<string, Bucket> = {};

      for (const e of examples) {
        const cat = classifyCs(e.customer_msg as string);
        const wk = weekKey(String(e.created_at));
        byCat[cat] ||= fresh();
        byWeek[wk] ||= fresh();
        const isApprove = e.source === 'approve';
        const isManual = e.source === 'manual';
        for (const bkt of [byCat[cat], byWeek[wk]]) {
          if (isApprove) { bkt.ai_used++; if (e.was_edited) bkt.edited++; }
          else if (isManual) { bkt.manual++; }
        }
      }

      const pct = (n: number, d: number) => (d > 0 ? Math.round((100 * n) / d) : null);
      const by_category = Object.entries(byCat)
        .map(([category, b]) => ({
          category,
          label: CS_CATEGORY_LABELS[category as CsCategory] || category,
          ai_used: b.ai_used,
          edited: b.edited,
          sent_asis: b.ai_used - b.edited,
          edit_rate: pct(b.edited, b.ai_used),
          manual: b.manual,
          // Adoption = of all replies for this type, how many the bot actually produced.
          adoption_rate: pct(b.ai_used, b.ai_used + b.manual),
          total: b.ai_used + b.manual,
        }))
        .sort((a, b) => b.total - a.total);

      const trend_weekly = Object.entries(byWeek)
        .filter(([wk]) => wk !== 'unknown')
        .map(([week, b]) => ({ week, ai_used: b.ai_used, edited: b.edited, edit_rate: pct(b.edited, b.ai_used) }))
        .sort((a, b) => a.week.localeCompare(b.week))
        .slice(-8);

      const totalApprove = examples.filter((e) => e.source === 'approve').length;
      const totalEdited = examples.filter((e) => e.source === 'approve' && e.was_edited).length;
      const totalManual = examples.filter((e) => e.source === 'manual').length;
      return json({
        success: true,
        insights: {
          by_category,
          trend_weekly,
          totals: {
            ai_used: totalApprove,
            edited: totalEdited,
            edit_rate: pct(totalEdited, totalApprove),
            manual: totalManual,
            adoption_rate: pct(totalApprove, totalApprove + totalManual),
            sample_size: examples.length,
          },
        },
      });
    }

    // Everything below changes bot behavior → admins only.
    if (role !== 'admin') return json({ success: false, error: 'Only admins can edit training' }, 403);

    // ── ai-edit: natural-language edit of the knowledge doc (PREVIEW ONLY) ──
    // The owner types "make the tone warmer" / "change delivery time to 5 min";
    // Claude locates the relevant text in the doc and returns the full revised
    // document plus a before/after change list. NOTHING is saved here — the
    // frontend shows the diff and the owner applies + saves through the normal
    // 'save' action, so a human always approves before the live bot changes.
    if (action === 'ai-edit') {
      if (!ANTHROPIC_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
      const instruction = (body.instruction || '').trim();
      if (!instruction) return json({ success: false, error: 'instruction required' }, 400);

      // Base = what the owner currently sees in the editor (may include unsaved
      // edits). Falls back to the saved doc, then the built-in default.
      let base = (body.knowledge || '').trim();
      if (!base) {
        const { data: settings } = await admin
          .from('cs_agent_settings').select('knowledge_doc').eq('id', 1).maybeSingle();
        base = (settings?.knowledge_doc || '').trim() || CS_KNOWLEDGE;
      }

      const system = `You edit the knowledge/training document of a customer-service AI for Regalos Que Cantan (personalized-song gifts for the US Latino community). The admin will give you an instruction in English or Spanish; apply it to the document.

Hard rules:
- Change ONLY what the instruction requires. Every other line must remain byte-for-byte identical — do not reformat, reorder, translate, or "improve" untouched text.
- The document's customer-facing content is SPANISH; keep it Spanish. Match the document's existing style.
- If the document contains the markers "${LEARNED_START}" and "${LEARNED_END}", preserve both markers exactly.
- NEVER invent facts, prices, links, times, or policies. If the instruction needs a fact the admin did not provide (e.g. "add the new price" without saying the price), do not guess — ask.
- A tone/approach instruction (e.g. "warmer", "more direct", "less pushy") should be applied by editing the relevant tone rules and any example phrasings that embody the old tone.

Respond with ONLY a JSON object, no markdown fences, in one of these two shapes:
{"clarification": "<one short question in English asking for the missing detail>"}
or
{"summary": "<1-3 sentences in English describing what you changed and where>",
 "changes": [{"section": "<short label of where>", "before": "<the exact text you replaced (excerpt)>", "after": "<the exact new text (excerpt)>"}],
 "document": "<the COMPLETE revised document>"}`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: AI_EDIT_MODEL,
          max_tokens: 16000,
          system,
          messages: [{
            role: 'user',
            content: `CURRENT DOCUMENT:\n<<<DOC\n${base}\nDOC>>>\n\nADMIN INSTRUCTION: ${instruction}`,
          }],
        }),
      });
      if (!res.ok) {
        const errTxt = await res.text();
        console.error('cs-training-admin ai-edit: anthropic error', res.status, errTxt);
        return json({ success: false, error: `AI request failed (${res.status}) — try again` }, 502);
      }
      const ai = await res.json();
      const raw = (ai?.content?.[0]?.text || '').trim();

      let parsed: { clarification?: string; summary?: string; changes?: { section?: string; before?: string; after?: string }[]; document?: string };
      try {
        // Tolerate accidental ```json fences around the object.
        parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      } catch {
        console.error('cs-training-admin ai-edit: unparseable AI output', raw.slice(0, 500));
        return json({ success: false, error: 'AI returned an unreadable result — try rephrasing the request' }, 502);
      }

      if (parsed.clarification) {
        return json({ success: true, clarification: String(parsed.clarification) });
      }

      const doc = (parsed.document || '').trim();
      // Sanity guards: an "edit" that shrinks the doc drastically or drops the
      // managed learned-facts section means the model mangled it — refuse.
      if (!doc || doc.length < base.length * 0.5) {
        return json({ success: false, error: 'The AI edit removed too much of the document — nothing was changed. Try a more specific request.' }, 422);
      }
      if (base.includes(LEARNED_START) && (!doc.includes(LEARNED_START) || !doc.includes(LEARNED_END))) {
        return json({ success: false, error: 'The AI edit broke the auto-learned section — nothing was changed. Try again.' }, 422);
      }
      if (doc === base) {
        return json({ success: true, clarification: 'That did not change anything — the document may already say this. Try describing the change differently.' });
      }

      return json({
        success: true,
        summary: String(parsed.summary || 'Edited the document.'),
        changes: Array.isArray(parsed.changes) ? parsed.changes.slice(0, 20).map((c) => ({
          section: String(c?.section || ''), before: String(c?.before || ''), after: String(c?.after || ''),
        })) : [],
        document: doc,
      });
    }

    // ── save knowledge ───────────────────────────────────────────────────
    if (action === 'save') {
      const knowledge = (body.knowledge || '').trim();
      if (!knowledge) return json({ success: false, error: 'knowledge cannot be empty' }, 400);
      const { error } = await admin
        .from('cs_agent_settings').update({ knowledge_doc: knowledge, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ── reset to the built-in default ────────────────────────────────────
    if (action === 'reset') {
      const { error } = await admin
        .from('cs_agent_settings').update({ knowledge_doc: null, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, knowledge: CS_KNOWLEDGE });
    }

    // ── delete a learned example ─────────────────────────────────────────
    if (action === 'delete-example') {
      if (!body.id) return json({ success: false, error: 'id required' }, 400);
      const { error } = await admin.from('cs_examples').delete().eq('id', body.id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ── flip the bot master switch ───────────────────────────────────────
    if (action === 'toggle') {
      const { error } = await admin
        .from('cs_agent_settings').update({ enabled: !!body.enabled, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, enabled: !!body.enabled });
    }

    // ── approve a distilled knowledge proposal (append it to the doc) ─────
    if (action === 'approve-proposal') {
      if (!body.proposal_id) return json({ success: false, error: 'proposal_id required' }, 400);
      const { data: prop } = await admin
        .from('cs_knowledge_proposals')
        .select('id, title, proposal, status').eq('id', body.proposal_id).maybeSingle();
      if (!prop || prop.status !== 'pending') {
        return json({ success: false, error: 'proposal not found or already reviewed' }, 409);
      }
      const { data: settings } = await admin
        .from('cs_agent_settings').select('knowledge_doc').eq('id', 1).maybeSingle();
      const base = (settings?.knowledge_doc || '').trim() || CS_KNOWLEDGE;
      const appended = mergeLearnedFact(base, String(prop.title || '').trim(), String(prop.proposal || '').trim());
      const { error: upErr } = await admin
        .from('cs_agent_settings').update({ knowledge_doc: appended, updated_at: new Date().toISOString() }).eq('id', 1);
      if (upErr) return json({ success: false, error: upErr.message }, 500);
      await admin.from('cs_knowledge_proposals')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', prop.id);
      return json({ success: true, knowledge: appended });
    }

    // ── reject a proposal ────────────────────────────────────────────────
    if (action === 'reject-proposal') {
      if (!body.proposal_id) return json({ success: false, error: 'proposal_id required' }, 400);
      const { error } = await admin
        .from('cs_knowledge_proposals')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', body.proposal_id).eq('status', 'pending');
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
