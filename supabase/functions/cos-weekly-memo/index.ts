// supabase/functions/cos-weekly-memo/index.ts
// ===========================================================================
// SOFÍA'S WEEKLY CEO MEMO — her unprompted Monday-morning analysis.
// Runs weekly via pg_cron. Gathers the week's REAL numbers (Meta spend joined to
// real Stripe orders by campaign), the pipeline, and her learnings, then writes a
// CEO memo: a one-breath summary + EXACTLY 3 prioritized moves (each with the
// number behind it + which dashboard tab to act in) + one risk to watch.
// Stores in cos_memos. Returns only status (no financials) — the admin reads the
// body through cos-assistant. verify_jwt = false (cron + service-to-service).
// Deploy: supabase functions deploy cos-weekly-memo --project-ref yzbvajungshqcpusfiia
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { agentBrief } from '../_shared/company-brief.ts';
import { MEDIA_BUYER_DOCTRINE } from '../_shared/operator-doctrine.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('COS_MODEL') || 'claude-opus-4-8';
const META_TOKEN = Deno.env.get('META_ACCESS_TOKEN');
const META_AD_ACCOUNT_ID = Deno.env.get('META_AD_ACCOUNT_ID') || 'act_832413711748940';
const AD_TZ = 'Asia/Manila';
const RQC_PLATFORM = 'es';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function num(x: any) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function actionCount(actions: any[], type: string): number { const a = (actions || []).find((x: any) => x.action_type === type); return a ? num(a.value) : 0; }
function purchasesOf(row: any): number { return actionCount(row.actions, 'purchase') || actionCount(row.actions, 'omni_purchase'); }
function tzDay(iso: string, tz: string): string { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso)); }
function shiftDate(ymd: string, days: number): string { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function ymdPT(offset = 0): string { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d); }
async function metaGet(path: string, params: Record<string, string>) {
  const u = new URL(`https://graph.facebook.com/v21.0/${path}`);
  u.searchParams.set('access_token', META_TOKEN!);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString()); return r.json();
}

async function gather(admin: any) {
  const to = ymdPT(-1), from = ymdPT(-7); // last 7 full Pacific days
  // Real paid orders for the window, deduped per session, + per-campaign (utm_campaign = Meta campaign id).
  const lo = new Date(`${shiftDate(from, 1)}T00:00:00+08:00`); lo.setUTCDate(lo.getUTCDate() - 1);
  const hi = new Date(`${shiftDate(to, 1)}T00:00:00+08:00`); hi.setUTCDate(hi.getUTCDate() + 2);
  const { data: paid } = await admin.from('songs')
    .select('stripe_session_id, amount_paid, paid_at, utm_campaign, genre, occasion')
    .eq('paid', true).eq('platform', RQC_PLATFORM)
    .gte('paid_at', lo.toISOString()).lt('paid_at', hi.toISOString())
    .not('stripe_session_id', 'is', null).limit(20000);
  const seen = new Map<string, { amt: number; camp: string | null; genre: string | null; occasion: string | null }>();
  for (const r of (paid || [])) {
    const day = shiftDate(tzDay(r.paid_at, AD_TZ), -1);
    if (day < from || day > to) continue;
    const amt = num(r.amount_paid), sid = r.stripe_session_id as string, cur = seen.get(sid);
    if (!cur || amt > cur.amt) seen.set(sid, { amt, camp: r.utm_campaign || null, genre: r.genre || null, occasion: r.occasion || null });
  }
  let revenue = 0, orders = 0; const byCamp: Record<string, { revenue: number; orders: number }> = {};
  const byGenre: Record<string, number> = {}, byOcc: Record<string, number> = {};
  for (const v of seen.values()) {
    revenue += v.amt; orders += 1;
    if (v.camp) { (byCamp[v.camp] ||= { revenue: 0, orders: 0 }); byCamp[v.camp].revenue += v.amt; byCamp[v.camp].orders += 1; }
    if (v.genre) byGenre[v.genre] = (byGenre[v.genre] || 0) + 1;
    if (v.occasion) byOcc[v.occasion] = (byOcc[v.occasion] || 0) + 1;
  }

  // Meta spend for the window (account total + per campaign with real ROAS).
  let totalSpend = 0; let top_campaigns: any[] = [];
  if (META_TOKEN) {
    try {
      const tr = JSON.stringify({ since: shiftDate(from, 1), until: shiftDate(to, 1) });
      const [acct, camp] = await Promise.all([
        metaGet(`${META_AD_ACCOUNT_ID}/insights`, { level: 'account', time_range: tr, fields: 'spend,actions', limit: '50' }),
        metaGet(`${META_AD_ACCOUNT_ID}/insights`, { level: 'campaign', time_range: tr, fields: 'campaign_id,campaign_name,spend,actions', limit: '200' }),
      ]);
      totalSpend = num((acct.data || [])[0]?.spend);
      top_campaigns = (camp.data || []).map((c: any) => {
        const sp = Math.round(num(c.spend) * 100) / 100, real = byCamp[String(c.campaign_id)] || { orders: 0, revenue: 0 };
        return { name: c.campaign_name, spend: sp, real_orders: real.orders, real_revenue: Math.round(real.revenue * 100) / 100, real_cpa: real.orders > 0 ? Math.round((sp / real.orders) * 100) / 100 : null, real_roas: sp > 0 ? Math.round((real.revenue / sp) * 100) / 100 : null, meta_sales: purchasesOf(c) };
      }).sort((a: any, b: any) => b.real_revenue - a.real_revenue || b.spend - a.spend).slice(0, 10);
    } catch (_) { /* Meta unreachable — memo still ships on sales data */ }
  }

  // Pipeline + learnings (money on the table + the playbook).
  const [{ count: creativesWaiting }, { count: competitorsNew }, { count: prospectsNew }, { data: learnings }] = await Promise.all([
    admin.from('creative_queue').select('id', { count: 'exact', head: true }).eq('status', 'ready').in('intended_use', ['ad', 'social']),
    admin.from('competitor_ads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    admin.from('affiliate_prospects').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    admin.from('cos_memory').select('content').eq('kind', 'learning').order('created_at', { ascending: false }).limit(12),
  ]);

  const sortTop = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}: ${v}`);
  return {
    from, to,
    spend: Math.round(totalSpend * 100) / 100, revenue: Math.round(revenue * 100) / 100, orders,
    blended_roas: totalSpend > 0 ? Math.round((revenue / totalSpend) * 100) / 100 : null,
    blended_cpa: orders > 0 ? Math.round((totalSpend / orders) * 100) / 100 : null,
    aov: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : null,
    top_campaigns, top_genres: sortTop(byGenre), top_occasions: sortTop(byOcc),
    pipeline: { creatives_waiting: creativesWaiting || 0, competitor_angles_new: competitorsNew || 0, affiliate_prospects_new: prospectsNew || 0 },
    learnings: (learnings || []).map((l: any) => l.content),
  };
}

const MEMO_TOOL = {
  name: 'emit_memo', description: 'Emit the weekly CEO memo.',
  input_schema: { type: 'object', properties: {
    headline: { type: 'string', description: 'One punchy line capturing the week (≤90 chars).' },
    summary: { type: 'string', description: '2-3 sentences: the week in one breath — what moved, the real ROAS, the one thing that matters most.' },
    moves: { type: 'array', description: 'EXACTLY 3 prioritized moves, highest-leverage first.', items: { type: 'object', properties: {
      title: { type: 'string', description: 'The move, action-first (e.g. "Scale Campaign X +25%").' },
      why: { type: 'string', description: 'Why now, in plain language.' },
      number: { type: 'string', description: 'The number behind it (e.g. "2.6x real ROAS on $4.2k spend").' },
      tab: { type: 'string', description: 'Which dashboard tab to do it in (Chief of Staff / Creative Studio / Affiliate).' },
    }, required: ['title', 'why', 'number'] } },
    watch: { type: 'string', description: 'One risk to watch (concentration, a losing campaign, a refund spike, a missing-UTM gap).' },
  }, required: ['headline', 'summary', 'moves'] },
};

async function writeMemo(data: any): Promise<any> {
  const sys = `You are Sofía, the Chief of Staff for Regalos Que Cantan, writing your UNPROMPTED weekly CEO memo to the owner (Gerardo).\n\n${agentBrief('Chief of Staff writing the Monday CEO memo.')}\n\n${MEDIA_BUYER_DOCTRINE}\n\nWrite like a sharp operator, not a report generator. Lead with decisions, back each with the real number. Use the REAL per-campaign ROAS (real Stripe sales matched to spend), never vanity metrics. Name winners to scale and losers to cut. Surface money on the table (creatives/angles/prospects waiting). If a campaign shows real_orders:0 with spend, treat it as "verify tagging", not dead. Apply your past learnings. Output via emit_memo: a headline, a 2-3 sentence summary, EXACTLY 3 prioritized moves (each with the number + the tab to act in), and one risk to watch.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: sys, tools: [MEMO_TOOL], tool_choice: { type: 'tool', name: 'emit_memo' }, messages: [{ role: 'user', content: `This week's data (${data.from} → ${data.to}, Pacific):\n${JSON.stringify(data, null, 2)}\n\nWrite the memo.` }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = ((await res.json()).content || []).find((c: any) => c.type === 'tool_use')?.input;
  if (!out) throw new Error('empty memo');
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!ANTHROPIC_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const data = await gather(admin);
    const memo = await writeMemo(data);
    const body = { ...memo, metrics: { spend: data.spend, revenue: data.revenue, orders: data.orders, blended_roas: data.blended_roas, aov: data.aov }, top_campaigns: data.top_campaigns?.slice(0, 5), pipeline: data.pipeline, window: { from: data.from, to: data.to } };
    const { data: row } = await admin.from('cos_memos').insert({ week_of: data.from, headline: memo.headline || null, summary: memo.summary || null, body, status: 'new' }).select('id, week_of').single();

    // Log each move as a tracked CALL for her scoreboard — the owner marks each
    // right/wrong later, building the accuracy that earns her more autonomy.
    const moves = Array.isArray(memo.moves) ? memo.moves : [];
    if (moves.length) {
      const kindOf = (t: string) => /scale|duplicate|raise|increase|aument|escala/i.test(t) ? 'scale' : /cut|pause|kill|stop|pausa|corta|reduce/i.test(t) ? 'cut' : /budget|presupuesto/i.test(t) ? 'budget' : /creative|ad|anuncio|push|lanza/i.test(t) ? 'creative' : 'recommendation';
      await admin.from('cos_calls').insert(moves.slice(0, 3).map((mv: any) => ({
        source: 'weekly_memo', kind: kindOf(String(mv.title || '')),
        call: String(mv.title || '').slice(0, 300), rationale: String(mv.why || '').slice(0, 500),
        metric_at_call: { number: mv.number || null, week_of: data.from }, horizon_days: 7, status: 'open',
      })));
    }
    return json({ success: true, id: row?.id, week_of: row?.week_of, calls_logged: moves.length });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
