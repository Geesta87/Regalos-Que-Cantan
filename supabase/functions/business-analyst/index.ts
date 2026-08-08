// supabase/functions/business-analyst/index.ts
// ===========================================================================
// BUSINESS ANALYST — "ask the business anything" agent for the Action Inbox
// ===========================================================================
// A chat surface where the owner asks plain-English questions ("why was
// Tuesday soft?", "how many corridos sold this month?") and a Claude agent
// answers by running READ-ONLY SQL against the live database.
//
// Why an agent instead of more dashboard charts: the hard part of answering
// a business question here isn't the query — it's the landmines (bundle rows
// that double-count, the 3-clause paid rule, dead phone columns, weekday
// seasonality). Those rules are baked into the system prompt below, so every
// answer applies them consistently — which ad-hoc queries historically did not.
//
// Safety: SQL executes through public.analyst_run_sql() (see migration
// 20260808120000), which runs under a SELECT-only role with a statement
// timeout and a 200-row cap. The agent physically cannot write.
//
// Admin-only (verify_jwt = true + admin_users gate, same as seo-coach).
// Deploy: supabase functions deploy business-analyst --project-ref yzbvajungshqcpusfiia
// Required secrets: ANTHROPIC_API_KEY. Optional: BUSINESS_ANALYST_MODEL.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('BUSINESS_ANALYST_MODEL') || 'claude-opus-5';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The one tool: read-only SQL.
// ---------------------------------------------------------------------------
const SQL_TOOL = {
  name: 'run_sql',
  description: 'Run one read-only SQL query (SELECT/WITH only, single statement) against the live Postgres database. Hard limits: 8s timeout, 200 rows returned. ALWAYS aggregate in SQL (COUNT/SUM/GROUP BY) — never pull raw rows to count client-side. Max 8 queries per question.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The SQL. Single SELECT or WITH statement, no semicolons.' },
      why: { type: 'string', description: 'One line: what this query establishes.' },
    },
    required: ['query'],
  },
};

// ---------------------------------------------------------------------------
// System prompt: persona + curated schema + the landmine rules that make
// answers trustworthy. Keep in sync with reality — every rule here was
// learned the hard way in production.
// ---------------------------------------------------------------------------
const ANALYST_SYSTEM = `You are the business analyst for "Regalos Que Cantan", a US-Hispanic e-commerce brand selling personalized Spanish songs (regalosquecantan.com). You answer the NON-TECHNICAL owner's questions by querying the live database with the run_sql tool, then explaining what you found in plain English. The owner is not a programmer and never wants to see SQL — just clear answers with real numbers.

DATABASE MAP (main tables; there are others — you may discover them with information_schema queries if needed):
- songs (~82k rows, +600/day): one row per generated song. Key columns: id, created_at, paid, paid_at, payment_status, amount_paid (numeric, dollars), stripe_session_id, stripe_payment_id, marked_paid_at (manual Zelle/cash mark), recipient_name, sender_name, relationship, genre, sub_genre, occasion, details (the customer's story text), email, whatsapp_phone, whatsapp_sent_at, status, error_message, provider, platform, utm_source/utm_medium/utm_campaign, referrer_source, landing_path, affiliate_code, coupon_code, has_video_addon, admin_dismissed_at.
- video_orders (~700): $9.99 slideshow addon. paid, paid_at, amount_cents, photo_count, status, video_url, song_id.
- story_video_orders: Animado animated-video addon. state, amount_cents, created_at.
- upsell_charges: post-purchase one-tap charges.
- sms_conversations / sms_messages: the SMS+WhatsApp inbox (messages have direction, status — 'draft' = unapproved AI draft, channel).
- email_leads (~20k): captured emails incl. non-buyers. email_logs / email_events / email_campaign_daily: SendGrid sends + engagement.
- funnel_events (~640k): step-by-step funnel tracking. lyric_submissions: immutable record of what the customer submitted.
- affiliates / affiliate_events / affiliate_prospects. reviews / song_reviews. coupons.
- media_buyer_reports: daily ad-performance briefs (metrics jsonb).

NON-NEGOTIABLE ANALYSIS RULES — apply silently to every answer:
1. PAID = all three: paid_at IS NOT NULL, AND (paid = true OR payment_status = 'paid'), AND (amount_paid > 0 OR stripe_payment_id IS NOT NULL OR marked_paid_at IS NOT NULL). Never use paid = true alone. Manual Zelle/cash payments have amount_paid NULL on purpose — count them as orders but they carry no amount.
2. REVENUE: two-pack bundles stamp the FULL bundle total on BOTH song rows sharing a stripe_session_id. Revenue = sum over DISTINCT stripe_session_id taking MAX(amount_paid) per session (rows with NULL stripe_session_id count individually). Counting rows directly DOUBLE-COUNTS bundles. Never add video_orders/story_video_orders/upsell amounts into "revenue" unless explicitly asked for total including addons — and then label the split.
3. The live customer funnel is platform = 'es'. Other platform values are tests/other markets — exclude unless asked.
4. Phone numbers live in whatsapp_phone. The phone_number column is always empty — never use it.
5. Day-vs-day comparisons are meaningless across weekdays (Saturdays ~46 orders, Mondays ~33). Always compare a day to the SAME weekday in prior weeks.
6. Stripe's own dashboard runs ~2% ahead of the DB (timing + edge cases). If the owner says Stripe shows more, that gap is expected — say so.
7. Attribution is a floor: ~61% of orders have no utm_source. Never present per-channel revenue as complete; call out the unattributed share.
8. Contribution margin ≈ 40% of revenue after ad spend (CPA), not the ~90% gross margin. When judging "is X worth it", reason in contribution margin.
9. Aggregate in SQL (COUNT, SUM, GROUP BY, date_trunc). The 200-row cap means raw-row pulls silently truncate — never count rows client-side. All timestamps are UTC.
10. An empty 'details' field (15-20% of orders) predicts generic lyrics and complaints — relevant when analyzing refunds/complaints.

HOW TO ANSWER:
- Lead with the answer in one or two sentences, numbers included. Then the supporting detail. Keep it short for narrow questions.
- Say what you did in plain words ("I compared the last 4 Tuesdays"), never show SQL unless asked.
- If the data can't answer something (e.g. ad spend lives in Meta, not here), say so plainly and answer what you can. media_buyer_reports has stored ad metrics — check it before declaring ad data unavailable.
- Never invent a number. If a query fails twice, say what you couldn't determine.
- Money formatting: whole dollars ("$1,234"), cents only when under $100.
- FORMATTING: plain text only. No markdown (no **, no ##, no bullet asterisks). Lists use "- " or "1." only.`;

// Raw Anthropic call with retry (mirrors seo-coach / ads-coach).
async function anthropicRaw(bodyObj: unknown): Promise<any> {
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // --- Admin gate (same as seo-coach / ads-coach / cos-assistant) ---
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow || roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const question = String(body.question || '').trim();
    if (!question) return json({ success: false, error: 'Ask a question.' }, 400);
    if (question.length > 2000) return json({ success: false, error: 'Question too long.' }, 400);

    // Short rolling history from the client (stateless server). Cap hard so a
    // long chat can't blow the context or the bill.
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const messages: any[] = [
      ...history
        .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
      { role: 'user', content: question },
    ];

    const today = new Date().toISOString().slice(0, 10);
    const system = `${ANALYST_SYSTEM}\n\nToday's date (UTC): ${today}.`;

    // Tool loop: up to 8 SQL queries across up to 10 rounds.
    let sqlCalls = 0;
    const queriesRun: { query: string; why: string; ok: boolean }[] = [];
    for (let round = 0; round < 10; round++) {
      const data = await anthropicRaw({
        model: MODEL, max_tokens: 2000, system,
        messages, tools: [SQL_TOOL],
      });
      const toolUses = (data?.content || []).filter((c: any) => c.type === 'tool_use');
      if (!toolUses.length || data?.stop_reason !== 'tool_use') {
        return json({ success: true, answer: textOf(data) || 'I could not produce an answer.', queries: queriesRun });
      }
      messages.push({ role: 'assistant', content: data.content });
      const results: any[] = [];
      for (const tu of toolUses) {
        let resultStr: string;
        if (sqlCalls >= 8) {
          resultStr = 'Query budget exhausted (8 max). Answer with what you have.';
        } else {
          sqlCalls++;
          const q = String(tu.input?.query || '');
          const { data: rows, error } = await admin.rpc('analyst_run_sql', { q });
          queriesRun.push({ query: q, why: String(tu.input?.why || ''), ok: !error });
          resultStr = error
            ? `SQL error: ${String((error as any).message || error).slice(0, 400)}`
            : JSON.stringify(rows).slice(0, 20000);
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: resultStr });
      }
      messages.push({ role: 'user', content: results });
    }
    return json({ success: true, answer: 'That took too many steps — try asking a narrower question.', queries: queriesRun });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
