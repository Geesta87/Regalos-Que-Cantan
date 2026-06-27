// supabase/functions/cos-assistant/index.ts
// ===========================================================================
// CHIEF OF STAFF — interactive personified assistant
// ===========================================================================
// Powers the upgraded Chief of Staff tab: a named, faced assistant you chat with
// that reads your whole business AND takes actions across your other agents, and
// speaks in a voice you pick. Admin-only. verify_jwt = true.
//
// Actions: get | list_voices | preview_voice | gen_avatars | set_persona | chat | speak
// Reads ELEVENLABS_API_KEY, ANTHROPIC_API_KEY, KIE_API_KEY.
// Deploy: supabase functions deploy cos-assistant --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { agentBrief } from '../_shared/company-brief.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const MODEL = Deno.env.get('COS_CHAT_MODEL') || 'claude-opus-4-8';
const TTS_MODEL = Deno.env.get('ELEVENLABS_MODEL') || 'eleven_multilingual_v2';
const IMAGE_MODEL = Deno.env.get('CREATIVE_IMAGE_MODEL') || 'google/nano-banana';
const KIE = 'https://api.kie.ai/api/v1/jobs';
const BUCKET = 'cos-audio';
const IMG_BUCKET = Deno.env.get('CREATIVE_BUCKET') || 'creative-studio';
// Meta Ads — same account/token the Media Buyer uses, so the assistant can read
// ad performance for ANY date range live (Meta keeps the history), not just the
// days the media-buyer agent happened to snapshot.
const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN');
const META_AD_ACCOUNT_ID = Deno.env.get('META_AD_ACCOUNT_ID') || 'act_832413711748940';
const META_API_VERSION = Deno.env.get('META_API_VERSION') || 'v21.0';
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const REVENUE_TZ = Deno.env.get('MEDIA_BUYER_TZ') || 'America/Chicago';
// The Meta ad account bills its "day" in Asia/Manila (midnight Manila = ~9am US
// Pacific). To make daily spend vs revenue apples-to-apples, the ad report
// buckets BOTH Meta spend and Stripe/paid-order revenue to this same ad-day.
const AD_TZ = Deno.env.get('META_AD_TZ') || 'Asia/Manila';
const RQC_PLATFORM = Deno.env.get('MEDIA_BUYER_PLATFORM') || 'es';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

// ---------------------------------------------------------------------------
// Meta Ads helpers (mirror media-buyer-daily)
// ---------------------------------------------------------------------------
async function metaGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ ...params, access_token: META_ACCESS_TOKEN! });
  const res = await fetch(`${META_BASE}/${path}?${qs.toString()}`);
  if (!res.ok) throw new Error(`Meta ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
function actionCount(actions: any[] | undefined, type: string): number {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find((a) => a.action_type === type);
  return hit ? num(hit.value || hit.count) : 0;
}
function purchasesOf(row: any): number { return actionCount(row.actions, 'purchase') || actionCount(row.actions, 'omni_purchase'); }
function tzDay(iso: string, tz: string = AD_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
// Shift a YYYY-MM-DD date string by whole days (UTC-safe).
function shiftDate(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// --- Meta WRITE helpers (need an ads_management token; reads work on ads_read) ---
async function metaPost(path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: META_ACCESS_TOKEN! });
  const res = await fetch(`${META_BASE}/${path}`, { method: 'POST', body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || JSON.stringify(j).slice(0, 200);
    if (j?.error?.code === 200 || /permission|ads_management/i.test(msg)) {
      throw new Error(`Meta needs the ads_management permission to make this change. Current token is read-only. (${msg})`);
    }
    throw new Error(`Meta ${path} ${res.status}: ${msg}`);
  }
  return j;
}
const moneyFmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
async function listAdObjects(kind: 'campaigns' | 'adsets'): Promise<any[]> {
  const fields = kind === 'campaigns' ? 'id,name,effective_status,daily_budget' : 'id,name,effective_status,daily_budget,campaign_id';
  const j = await metaGet(`${META_AD_ACCOUNT_ID}/${kind}`, { fields, limit: '300' });
  return j.data || [];
}
// Fuzzy-match an ad object by name (exact, then contains, case-insensitive).
function matchByName(rows: any[], name: string): any | null {
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  return rows.find((r) => (r.name || '').toLowerCase() === n)
    || rows.find((r) => (r.name || '').toLowerCase().includes(n))
    || null;
}

// Build an ad-performance report for a date range. Prefers LIVE Meta (full
// history) cross-checked against real paid orders in `songs`; falls back to the
// saved daily media-buyer reports if Meta is unreachable / not configured.
async function buildAdReport(admin: any, from: string, to: string): Promise<string> {
  // A "reporting day" is the owner's PACIFIC day labeled by its 9am START:
  // label "2026-06-25" = Jun 25 09:00 → Jun 26 09:00 Pacific. That window is
  // exactly one Meta/Manila ad-day whose Manila date = label + 1 — so spend and
  // revenue already match; we just relabel the Manila date back to its Pacific start.
  const metaFrom = shiftDate(from, 1); // Pacific start label -> Manila ad-day date
  const metaTo = shiftDate(to, 1);

  // Real revenue: deduped paid orders, bucketed by the Manila ad-day they fall in,
  // relabeled to that ad-day's Pacific START date so it lines up with spend.
  async function realRevenue() {
    const lo = new Date(`${metaFrom}T00:00:00+08:00`); lo.setUTCDate(lo.getUTCDate() - 1);
    const hi = new Date(`${metaTo}T00:00:00+08:00`); hi.setUTCDate(hi.getUTCDate() + 2);
    const { data: paid } = await admin.from('songs')
      .select('stripe_session_id, amount_paid, paid_at')
      .eq('paid', true).eq('platform', RQC_PLATFORM)
      .gte('paid_at', lo.toISOString()).lt('paid_at', hi.toISOString())
      .not('stripe_session_id', 'is', null).limit(20000);
    const perSession = new Map<string, { day: string; amt: number }>();
    for (const r of (paid || [])) {
      const day = shiftDate(tzDay(r.paid_at, AD_TZ), -1); // Manila ad-day -> Pacific start label
      if (day < from || day > to) continue; // outside the requested window
      const amt = num(r.amount_paid), sid = r.stripe_session_id as string;
      const cur = perSession.get(sid);
      if (!cur || amt > cur.amt) perSession.set(sid, { day, amt });
    }
    const byDay: Record<string, { revenue: number; orders: number }> = {};
    let total = 0, orders = 0;
    for (const { day, amt } of perSession.values()) {
      (byDay[day] ||= { revenue: 0, orders: 0 });
      byDay[day].revenue += amt; byDay[day].orders += 1; total += amt; orders += 1;
    }
    return { byDay, total: Math.round(total * 100) / 100, orders };
  }

  if (META_ACCESS_TOKEN) {
    try {
      const tr = JSON.stringify({ since: metaFrom, until: metaTo });
      const [daily, byCampaign, rev] = await Promise.all([
        metaGet(`${META_AD_ACCOUNT_ID}/insights`, { level: 'account', time_range: tr, time_increment: '1', fields: 'spend,actions', limit: '500' }),
        metaGet(`${META_AD_ACCOUNT_ID}/insights`, { level: 'campaign', time_range: tr, fields: 'campaign_name,spend,actions', limit: '200' }),
        realRevenue(),
      ]);
      let totalSpend = 0, totalMetaSales = 0;
      const days = (daily.data || []).map((r: any) => {
        const label = shiftDate(r.date_start, -1); // Manila ad-day date -> Pacific start label
        const s = num(r.spend), meta = purchasesOf(r);
        totalSpend += s; totalMetaSales += meta;
        const rd = rev.byDay[label] || { revenue: 0, orders: 0 };
        return { date: label, spend: Math.round(s * 100) / 100, real_orders: rd.orders, real_cpa: rd.orders > 0 ? Math.round((s / rd.orders) * 100) / 100 : null, real_revenue: Math.round(rd.revenue * 100) / 100, roas: s > 0 ? Math.round((rd.revenue / s) * 100) / 100 : null, meta_sales: meta };
      }).sort((a: any, b: any) => (a.date < b.date ? -1 : 1));
      const top_campaigns = (byCampaign.data || [])
        .map((c: any) => { const sp = Math.round(num(c.spend) * 100) / 100, ms = purchasesOf(c); return { name: c.campaign_name, spend: sp, meta_sales: ms, cpa: ms > 0 ? Math.round((sp / ms) * 100) / 100 : null }; })
        .sort((a: any, b: any) => b.meta_sales - a.meta_sales || b.spend - a.spend).slice(0, 8);
      const summary = {
        from, to, source: 'meta_live', timezone: "Pacific day, 9am→9am, labeled by start date", days_covered: days.length,
        total_spend: Math.round(totalSpend * 100) / 100,
        total_real_orders: rev.orders, total_real_revenue: rev.total,
        blended_cpa: rev.orders > 0 ? Math.round((totalSpend / rev.orders) * 100) / 100 : null,
        blended_roas: totalSpend > 0 ? Math.round((rev.total / totalSpend) * 100) / 100 : null,
        meta_reported_sales: totalMetaSales, per_day: days, top_campaigns,
        note: `Dates are the owner's PACIFIC days labeled by their 9am start — e.g. "2026-06-25" = Jun 25 9:00am → Jun 26 9:00am Pacific (one Meta/Manila ad-day relabeled to its Pacific start date). Spend and real_orders/real_revenue both cover that exact window, so the date matches the owner's LA calendar + Stripe and daily ROAS is exact. real_cpa & blended_cpa = ad spend ÷ real PAID orders (true cost per sale); top_campaigns.cpa = spend ÷ Meta-reported sales.`,
      };
      return `AD REPORT ${from} → ${to} (Pacific days, 9am→9am, labeled by start date; LIVE from Meta + real paid orders):\n${JSON.stringify(summary, null, 2)}`;
    } catch (_e) {
      // fall through to saved reports on any Meta error
    }
  }

  // Fallback: saved daily media-buyer reports.
  const { data: reports } = await admin.from('media_buyer_reports')
    .select('report_for, metrics, analysis').gte('report_for', from).lte('report_for', to)
    .order('report_for', { ascending: true });
  if (!reports || !reports.length) return `No ad data available between ${from} and ${to} (Meta was unreachable and no saved reports exist for that range).`;
  let spend = 0, revenue = 0, orders = 0, metaSales = 0;
  const perDay = reports.map((r: any) => {
    const m = r.metrics || {}, a = r.analysis || {};
    const s = num(m.account_yesterday?.spend), rc = m.revenue_crosscheck || {};
    const rev2 = num(rc.real_revenue), ord = num(rc.real_orders);
    spend += s; revenue += rev2; orders += ord; metaSales += num(rc.meta_reported_purchases);
    return { date: r.report_for, spend: Math.round(s * 100) / 100, real_orders: ord, real_cpa: ord > 0 ? Math.round((s / ord) * 100) / 100 : null, real_revenue: Math.round(rev2 * 100) / 100, roas: s > 0 ? Math.round((rev2 / s) * 100) / 100 : null, headline: a.headline };
  });
  const summary = { from, to, source: 'saved_reports', days_covered: perDay.length, total_spend: Math.round(spend * 100) / 100, total_real_orders: orders, total_real_revenue: Math.round(revenue * 100) / 100, blended_cpa: orders > 0 ? Math.round((spend / orders) * 100) / 100 : null, blended_roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null, meta_reported_sales: metaSales, per_day: perDay };
  return `AD REPORT ${from} → ${to} (from saved daily reports):\n${JSON.stringify(summary, null, 2)}`;
}

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------
async function listVoices() {
  if (!ELEVENLABS_API_KEY) return [];
  const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
  if (!r.ok) { console.warn('11labs voices', r.status); return []; }
  const j = await r.json().catch(() => ({}));
  return (j.voices || []).map((v: any) => ({
    voice_id: v.voice_id, name: v.name, preview_url: v.preview_url,
    labels: v.labels || {}, category: v.category,
  }));
}

async function tts(admin: any, voiceId: string, text: string): Promise<string | null> {
  if (!ELEVENLABS_API_KEY || !voiceId) return null;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: text.slice(0, 2500), model_id: TTS_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!r.ok) { console.warn('11labs tts', r.status, (await r.text()).slice(0, 150)); return null; }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const path = `${crypto.randomUUID()}.mp3`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'audio/mpeg', upsert: true });
  if (up.error) { console.warn('audio upload', up.error.message); return null; }
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------------
// Kie avatar generation (3 options, parallel)
// ---------------------------------------------------------------------------
async function genAvatar(admin: any, prompt: string): Promise<string | null> {
  try {
    const cr = await fetch(`${KIE}/createTask`, { method: 'POST', headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: IMAGE_MODEL, input: { prompt, aspect_ratio: '1:1', output_format: 'png' } }) });
    const cj = await cr.json().catch(() => ({}));
    const taskId = cj?.data?.taskId || cj?.taskId;
    if (!taskId) return null;
    const start = Date.now();
    while (Date.now() - start < 80000) {
      await sleep(3000);
      const ir = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${KIE_API_KEY}` } });
      const info = await ir.json().catch(() => ({}));
      if (info?.data?.state === 'success') {
        const url = (JSON.parse(info.data.resultJson || '{}').resultUrls || [])[0];
        if (!url) return null;
        const img = await fetch(url); const bytes = new Uint8Array(await img.arrayBuffer());
        const path = `cos-avatar-${crypto.randomUUID()}.png`;
        await admin.storage.from(IMG_BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
        return admin.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl;
      }
      if (info?.data?.state === 'fail') return null;
    }
    return null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Business snapshot (so the assistant always knows the state)
// ---------------------------------------------------------------------------
async function snapshot(admin: any) {
  const count = async (t: string, b: (q: any) => any) => { const { count } = await b(admin.from(t).select('id', { count: 'exact', head: true })); return count || 0; };
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: mb } = await admin.from('media_buyer_reports').select('report_for, metrics, analysis').order('report_for', { ascending: false }).limit(1).maybeSingle();
  const [creativesReady, emailsPending, competitorsNew, prospectsNew, staleCreatives, pendingActions] = await Promise.all([
    count('creative_queue', (q) => q.eq('status', 'ready')),
    count('email_queue', (q) => q.eq('status', 'pending_approval')),
    count('competitor_ads', (q) => q.eq('status', 'new')),
    count('affiliate_prospects', (q) => q.eq('status', 'new')),
    count('creative_queue', (q) => q.eq('status', 'ready').lt('created_at', dayAgo)),
    count('cos_pending_actions', (q) => q.eq('status', 'pending')),
  ]);
  const { data: topCreative } = await admin.from('creative_queue').select('id, concept, score').eq('status', 'ready').order('score', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  // Long-term memory — what Gerardo has told her to remember (applied every turn).
  const { data: mem } = await admin.from('cos_memory').select('kind, content').order('created_at', { ascending: false }).limit(60);
  // PROACTIVE: things she should raise on her own, without being asked.
  const proactive: string[] = [];
  if (pendingActions > 0) proactive.push(`${pendingActions} action(s) are staged and awaiting your Confirm.`);
  if (staleCreatives > 0) proactive.push(`${staleCreatives} creative(s) have been waiting over 24h for approval in Creative Studio.`);
  if (mb?.analysis?.account_health === 'at_risk') proactive.push(`Ads flagged AT-RISK in the last report: ${mb.analysis?.headline || ''}`);
  else if (mb?.analysis?.account_health === 'watch') proactive.push(`Ads on WATCH in the last report: ${mb.analysis?.headline || ''}`);
  if (competitorsNew > 0) proactive.push(`${competitorsNew} new competitor angle(s) to review.`);
  if (prospectsNew > 0) proactive.push(`${prospectsNew} new affiliate prospect(s) to review.`);
  return {
    latest_saved_report: mb ? { headline: mb.analysis?.headline, account_health: mb.analysis?.account_health, top_recommendation: mb.analysis?.recommendations?.[0], NUMBERS_NOTE: 'NEVER quote spend/sales/revenue/ROAS/CPA from here — call get_ad_report for any figure, even "yesterday".' } : null,
    creatives_ready: creativesReady, top_ready_creative: topCreative || null,
    emails_pending: emailsPending, competitor_opportunities: competitorsNew, partner_prospects: prospectsNew,
    memory: (mem || []).map((m: any) => `[${m.kind}] ${m.content}`),
    proactive,
  };
}

// ---------------------------------------------------------------------------
// Chat tools (the assistant can DO things by forwarding the admin session)
// ---------------------------------------------------------------------------
function tools() {
  return [
    { name: 'remember', description: 'Save a durable fact to long-term memory so you apply it in EVERY future chat — the owner\'s preferences, standing rules, or decisions (e.g. "always faith/Spanish angle for that line", "never raise a budget over 2x without flagging me", "Corrido is the winner"). Use whenever he states a lasting preference/rule/decision, or says "remember…".', input_schema: { type: 'object', properties: { content: { type: 'string', description: 'The fact to remember, in one clear sentence.' }, kind: { type: 'string', enum: ['preference', 'rule', 'decision', 'fact'] } }, required: ['content'] } },
    { name: 'get_sales', description: 'Pull REAL business/sales data from the orders database (deduped paid orders): total orders, revenue, AOV, and breakdown by genre or occasion. Use for ANY question about SALES / revenue / the business (not ad spend) — "how are sales today", "best-selling genre this week", "how many orders this month". Dates are the owner\'s Pacific days. Always answer sales questions from this, never guess.', input_schema: { type: 'object', properties: { from: { type: 'string', description: 'Start date YYYY-MM-DD (Pacific). Defaults to today.' }, to: { type: 'string', description: 'End date YYYY-MM-DD (Pacific). Defaults to today.' }, group_by: { type: 'string', enum: ['genre', 'occasion'], description: 'Optional breakdown.' } } } },
    { name: 'propose_duplicate_scale', description: 'PROPOSE duplicating a winning Meta campaign into a new copy at a chosen daily budget (to scale a winner). Does NOT execute — creates a confirmation card. On confirm it creates the copy PAUSED at that budget for the owner to review + activate in Meta. Use when the owner wants to "duplicate / clone / scale" a winning campaign.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Campaign name to duplicate.' }, daily_budget_usd: { type: 'number', description: 'Daily budget for the new copy, in US dollars.' } }, required: ['name'] } },
    { name: 'draft_email', description: 'Write a marketing email and drop it into the Emails approval queue for the owner to review + send (he approves/sends in the Emails tab — that IS the approval gate). Use when he wants to "draft / write / send an email" or a promo. Spanish, warm, on-brand; one clear offer + CTA. Tell him it\'s drafted and waiting in the Emails tab.', input_schema: { type: 'object', properties: { brief: { type: 'string', description: 'What the email is about — occasion, offer to push, angle (e.g. "Día del Padre last-chance, push the $9.99 video add-on").' } }, required: ['brief'] } },
    { name: 'propose_lookalike', description: 'PROPOSE building a Meta Lookalike Audience from recent buyers (so ads target people similar to your actual customers). Does NOT execute — creates a confirmation card. On confirm it uploads recent buyers (emails, hashed) as a Custom Audience and creates a 1% US Lookalike from it. Use when the owner wants a "lookalike" or to "target people like my buyers".', input_schema: { type: 'object', properties: { days: { type: 'number', description: 'How many days of recent buyers to seed from (default 60).' } } } },
    { name: 'approve_creative', description: 'Approve a creative so it auto-posts. Omit id to approve the top-scored one waiting.', input_schema: { type: 'object', properties: { creative_id: { type: 'string' } } } },
    { name: 'run_competitor_scan', description: 'Trigger a fresh scan of competitor ads.', input_schema: { type: 'object', properties: {} } },
    { name: 'run_affiliate_scan', description: 'Trigger a fresh scan for affiliate/partner prospects.', input_schema: { type: 'object', properties: {} } },
    { name: 'refresh_briefing', description: 'Regenerate the morning Chief-of-Staff briefing.', input_schema: { type: 'object', properties: {} } },
    { name: 'generate_creatives', description: 'Ask the Creative Studio art director to generate creatives from a brief.', input_schema: { type: 'object', properties: { brief: { type: 'string', description: 'What to make, e.g. "5 Mother\'s Day photoreal ads".' } }, required: ['brief'] } },
    { name: 'get_ad_report', description: 'Pull the real ad-performance report for a DATE RANGE — LIVE from Meta (full history), with per-day spend, real paid sales, ROAS, and top campaigns. Use this for ANY question about ad results over a period — "this week", "Monday to now", "last 7 days", "last month", or specific dates. Dates are the owner\'s PACIFIC days labeled by their 9am start (e.g. "2026-06-25" = Jun 25 9am → Jun 26 9am Pacific) — just pass his Pacific dates; the tool converts to the Meta/Manila ad-day internally. Do NOT answer ad-results questions from the yesterday snapshot.', input_schema: { type: 'object', properties: { from: { type: 'string', description: "Start date YYYY-MM-DD in the owner's Pacific frame (inclusive)." }, to: { type: 'string', description: "End date YYYY-MM-DD Pacific (inclusive). Defaults to today." } }, required: ['from'] } },
    { name: 'propose_ad_change', description: 'PROPOSE pausing, resuming, or changing the daily budget of a Meta campaign or ad set. This does NOT execute — it creates a confirmation card the owner must tap to approve. Use whenever the owner wants to turn off / pause / resume an ad, or raise/lower a budget. Match the campaign/ad-set by the name the owner uses.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'set_budget'] }, level: { type: 'string', enum: ['campaign', 'adset'], description: 'Whether the name refers to a campaign or an ad set. Default campaign.' }, name: { type: 'string', description: 'The campaign or ad-set name (or part of it).' }, daily_budget_usd: { type: 'number', description: 'For set_budget: the new daily budget in US dollars (e.g. 75).' } }, required: ['action', 'name'] } },
    { name: 'propose_extract_ad', description: 'PROPOSE taking a currently-running ad\'s visual + copy and handing it to the Art Director (Creative Studio) to generate more in that style. Does NOT execute — creates a confirmation card. Use when the owner wants "more like the ad that\'s running". If he wants a different angle/theme for the new ones, capture it in `instruction`.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Campaign or ad name to pull the running creative from. If omitted, uses the top active ad.' }, instruction: { type: 'string', description: 'Any angle/twist the owner wants for the NEW ads, e.g. "Christian / faith angle, not Father\'s Day". Pass his exact extra direction.' } } } },
    { name: 'check_creatives', description: 'Check how many ad/social creatives were created recently and their status (ready / still generating / failed). Use whenever the owner asks if ads or creatives are done, landed, or how many are waiting — answer from this, never guess.', input_schema: { type: 'object', properties: {} } },
  ];
}

// Resolve + stage a proposed ad change as a pending_action row (no execution).
async function proposeAdChange(admin: any, input: any, pending: any[]): Promise<string> {
  if (!META_ACCESS_TOKEN) return 'Meta is not connected (META_ACCESS_TOKEN missing).';
  const level = input.level === 'adset' ? 'adset' : 'campaign';
  const rows = await listAdObjects(level === 'adset' ? 'adsets' : 'campaigns');
  const t = matchByName(rows, input.name);
  if (!t) return `Couldn't find a ${level} matching "${input.name}". Active ${level}s: ${rows.slice(0, 8).map((r) => r.name).join(', ') || '(none)'}.`;
  const curBudget = t.daily_budget ? `, currently ${moneyFmt(Number(t.daily_budget))}/day` : '';
  let summary = '', params: any = {};
  if (input.action === 'pause') summary = `⏸ Pause ${level} "${t.name}"${curBudget}`;
  else if (input.action === 'resume') summary = `▶️ Resume ${level} "${t.name}"${curBudget}`;
  else {
    const usd = Number(input.daily_budget_usd);
    if (!Number.isFinite(usd) || usd <= 0) return 'Tell me the new daily budget in dollars (e.g. $75).';
    params = { daily_budget_usd: Math.round(usd * 100) / 100 };
    summary = `💰 Set ${level} "${t.name}" budget to $${usd.toFixed(2)}/day${t.daily_budget ? ` (from ${moneyFmt(Number(t.daily_budget))})` : ''}`;
  }
  const { data: row } = await admin.from('cos_pending_actions').insert({
    action_type: input.action, target_type: level, target_id: t.id, target_name: t.name, params, summary, status: 'pending',
  }).select('id, summary, action_type, target_name, status').single();
  if (row) pending.push(row);
  return `Proposed: ${summary}. It's waiting for your tap on the Confirm card — nothing changed yet.`;
}

// Resolve a creative's FULL-resolution image URL (not Meta's 64x64 thumbnail).
// Prefers link_data.picture, then resolves image_hash via /adimages, then falls
// back to image_url. Returns null if no usable image (so we can be honest).
async function fullAdImage(creative: any): Promise<string | null> {
  const oss = creative?.object_story_spec || {};
  const ld = oss.link_data || oss.video_data || {};
  if (ld.picture && /^https?:/.test(ld.picture)) return ld.picture;
  const hash = ld.image_hash;
  if (hash) {
    try {
      const j = await metaGet(`${META_AD_ACCOUNT_ID}/adimages`, { hashes: JSON.stringify([hash]), fields: 'url,permalink_url' });
      const img = (j?.data && j.data[0]) || (j?.images && Object.values(j.images)[0]);
      // Prefer the direct fbcdn `url` (downloadable); permalink_url is a viewer
      // page that returns 0 bytes when fetched server-side.
      const url = (img as any)?.url || (img as any)?.permalink_url;
      if (url) return url;
    } catch (_) { /* fall through */ }
  }
  // Last resort: image_url — but skip it if it's clearly a tiny thumbnail.
  const iu = creative?.image_url || '';
  if (iu && !/p64x64|p32x32|s64x64/.test(iu)) return iu;
  return null;
}

// Stage an "extract running ad → make more" proposal (no execution).
async function proposeExtractAd(admin: any, input: any, pending: any[]): Promise<string> {
  if (!META_ACCESS_TOKEN) return 'Meta is not connected (META_ACCESS_TOKEN missing).';
  // Pull ALL ads (incl. paused) WITH their campaign name + creative.
  const j = await metaGet(`${META_AD_ACCOUNT_ID}/ads`, { fields: 'id,name,effective_status,campaign{name},creative{id,title,body,image_url,thumbnail_url,object_story_spec}', limit: '300' });
  const all = (j.data || []);
  if (!all.length) return 'No ads found in the account to copy from.';
  let ad: any = null;
  const want = (input.name || '').trim().toLowerCase();
  if (want) {
    // Match the owner's term against the AD name OR its CAMPAIGN name (his
    // Father's Day creatives are named at the campaign level + are paused).
    const toks = want.split(/\s+/).filter((t: string) => t.length > 2);
    ad = all.find((a: any) => { const hay = `${a.name || ''} ${a.campaign?.name || ''}`.toLowerCase(); return hay.includes(want); })
      || all.find((a: any) => { const hay = `${a.name || ''} ${a.campaign?.name || ''}`.toLowerCase(); return toks.every((t: string) => hay.includes(t)); })
      || all.find((a: any) => { const hay = `${a.name || ''} ${a.campaign?.name || ''}`.toLowerCase(); return toks.some((t: string) => hay.includes(t)); });
    if (!ad) {
      // Do NOT silently grab a random active ad — tell him what exists.
      const names = [...new Set(all.map((a: any) => a.campaign?.name || a.name).filter(Boolean))].slice(0, 14);
      return `I couldn't find an ad or campaign matching "${input.name}". Here's what's in the account — tell me which one to copy: ${names.join(' · ')}.`;
    }
  } else {
    ad = all.find((a: any) => a.effective_status === 'ACTIVE') || all[0];
  }
  const cr = ad.creative || {};
  const image = await fullAdImage(cr);
  const copy = cr.title || cr.body || ad.name || '';
  const instruction = (input.instruction || '').toString().trim();
  const label = ad.campaign?.name || ad.name;
  const params = { ad_id: ad.id, ad_name: ad.name, campaign_name: ad.campaign?.name || null, copy, image_url: image || '', instruction };
  const summary = `🎨 Make more ads like "${label}"${instruction ? ` — ${instruction}` : ''} → Art Director`;
  const { data: row } = await admin.from('cos_pending_actions').insert({
    action_type: 'extract_creative', target_type: 'ad', target_id: ad.id, target_name: label, params, summary, status: 'pending',
  }).select('id, summary, action_type, target_name, status').single();
  if (row) pending.push(row);
  return image
    ? `Proposed: ${summary}. I've got that ad's real image — the new ones generate image-to-image from it. Tap Confirm.`
    : `Proposed: ${summary}. ⚠️ Heads up: I could not get that specific ad's full image from Meta, so these would be STYLE-based (a close match, not an exact copy). Tap Confirm to proceed, or tell me a different ad to pull from.`;
}

// Execute a confirmed pending action (called only on the owner's Confirm tap).
async function executePendingAction(admin: any, authHeader: string, id: string): Promise<{ ok: boolean; result: string }> {
  const { data: a } = await admin.from('cos_pending_actions').select('*').eq('id', id).single();
  if (!a) return { ok: false, result: 'Action not found.' };
  if (a.status !== 'pending') return { ok: false, result: `Already ${a.status}.` };
  try {
    let result = '';
    if (a.action_type === 'pause' || a.action_type === 'resume') {
      await metaPost(`${a.target_id}`, { status: a.action_type === 'pause' ? 'PAUSED' : 'ACTIVE' });
      result = `${a.action_type === 'pause' ? 'Paused' : 'Resumed'} ${a.target_type} "${a.target_name}".`;
    } else if (a.action_type === 'set_budget') {
      const cents = Math.round(Number(a.params?.daily_budget_usd || 0) * 100);
      await metaPost(`${a.target_id}`, { daily_budget: String(cents) });
      result = `Set ${a.target_type} "${a.target_name}" budget to $${(cents / 100).toFixed(2)}/day.`;
    } else if (a.action_type === 'extract_creative') {
      const p = a.params || {};
      const twist = (p.instruction || '').toString().trim();
      // DETERMINISTIC path: creative-chat's generate_batch FORCES specs + generates
      // each image itself — no relying on a chat model to choose to call a tool.
      const brief = `Make ads that match the look of our running ad "${p.ad_name}" (its copy was: "${(p.copy || '').slice(0, 200)}").${twist ? ` Angle/twist Gerardo wants: ${twist}.` : ''} Keep the same emotional photoreal style; one clear offer + CTA; Spanish copy; make ORIGINALS (don't copy the exact wording).`;
      const n = dispatchGeneration(authHeader, brief, 2, p.image_url || undefined);
      result = `Kicked off ${n} new ad${n > 1 ? 's' : ''} in the background${p.image_url ? ' from your real ad as the visual reference' : ''} — they'll land in Creative Studio → Ads in about 2–3 minutes (refresh that tab).`;
    } else if (a.action_type === 'duplicate_scale') {
      // Copy the campaign (+ its ad sets/ads), set the new budget, leave PAUSED.
      const copy = await metaPost(`${a.target_id}/copies`, { deep_copy: 'true', status_option: 'PAUSED' });
      const newId = copy?.copied_campaign_id || copy?.id;
      if (!newId) throw new Error('Meta did not return a copied campaign id.');
      const cents = Math.round(Number(a.params?.daily_budget_usd || 0) * 100);
      if (cents > 0) { try { await metaPost(`${newId}`, { daily_budget: String(cents) }); } catch (_) { /* budget may be at ad-set level */ } }
      result = `Duplicated "${a.target_name}" → new campaign ${newId}${cents > 0 ? ` at $${(cents / 100).toFixed(2)}/day` : ''}, left PAUSED. Review + turn it on in Meta Ads when ready.`;
    } else if (a.action_type === 'create_lookalike') {
      const days = Math.min(Math.max(Number(a.params?.days) || 60, 7), 365);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data: buyers } = await admin.from('songs').select('email').eq('paid', true).eq('platform', RQC_PLATFORM).gte('paid_at', since).not('email', 'is', null).limit(50000);
      const emails = [...new Set((buyers || []).map((b: any) => String(b.email || '').trim().toLowerCase()).filter((e: string) => e.includes('@')))];
      if (emails.length < 100) throw new Error(`Only ${emails.length} buyer emails in the last ${days} days — Meta needs at least 100 to seed a Custom Audience. Try a wider range.`);
      const hashed = await Promise.all(emails.map(sha256));
      const ts = new Date().toISOString().slice(0, 10);
      const ca = await metaPost(`${META_AD_ACCOUNT_ID}/customaudiences`, { name: `RQC Buyers ${ts} (${days}d)`, subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY', description: `Lookalike seed — built by Sofía ${ts}` });
      const caId = ca?.id; if (!caId) throw new Error('Could not create the Custom Audience.');
      let added = 0;
      for (let i = 0; i < hashed.length; i += 5000) { const chunk = hashed.slice(i, i + 5000); try { await metaPost(`${caId}/users`, { payload: JSON.stringify({ schema: ['EMAIL'], data: chunk.map((h: string) => [h]) }) }); added += chunk.length; } catch (_) { /* skip a bad chunk */ } }
      const la = await metaPost(`${META_AD_ACCOUNT_ID}/customaudiences`, { name: `RQC Lookalike 1% US ${ts}`, subtype: 'LOOKALIKE', origin_audience_id: String(caId), lookalike_spec: JSON.stringify({ type: 'similarity', country: 'US', ratio: 0.01 }) });
      result = `Uploaded ${added} buyers → Custom Audience ${caId}, created Lookalike ${la?.id || '(building)'} (1% US). Meta takes a few hours to populate it — then target it in a new ad set.`;
    } else {
      return { ok: false, result: `Unknown action type ${a.action_type}.` };
    }
    await admin.from('cos_pending_actions').update({ status: 'done', result, confirmed_at: new Date().toISOString() }).eq('id', id);
    return { ok: true, result };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 400);
    await admin.from('cos_pending_actions').update({ status: 'failed', result: msg, confirmed_at: new Date().toISOString() }).eq('id', id);
    return { ok: false, result: msg };
  }
}

// Real sales/business data from the orders (songs) table — deduped per
// stripe_session_id (2-pack safe), in the owner's Pacific day window.
async function getSales(admin: any, from: string, to: string, groupBy?: string): Promise<string> {
  const d = new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  const lo = `${from}T07:00:00Z`, hi = `${d.toISOString().slice(0, 10)}T07:00:00Z`; // Pacific midnight = 07:00 UTC (PDT)
  const { data: rows } = await admin.from('songs')
    .select('stripe_session_id, amount_paid, genre, occasion')
    .eq('paid', true).eq('platform', RQC_PLATFORM)
    .gte('paid_at', lo).lt('paid_at', hi)
    .not('stripe_session_id', 'is', null).limit(20000);
  const perSession = new Map<string, number>();
  for (const r of (rows || [])) { const sid = r.stripe_session_id as string; const amt = num(r.amount_paid); if (!perSession.has(sid) || amt > (perSession.get(sid) as number)) perSession.set(sid, amt); }
  const orders = perSession.size;
  const revenue = Math.round([...perSession.values()].reduce((a, b) => a + b, 0) * 100) / 100;
  const summary: any = { from, to, total_orders: orders, total_revenue: revenue, aov: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : null };
  if (groupBy === 'genre' || groupBy === 'occasion') {
    const counts: Record<string, number> = {};
    for (const r of (rows || [])) { const k = ((r as any)[groupBy] || '(none)') as string; counts[k] = (counts[k] || 0) + 1; }
    summary.by = groupBy;
    summary.breakdown = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ [groupBy]: k, paid_songs: v }));
  }
  return `SALES ${from} → ${to} (real deduped paid orders, Pacific days):\n${JSON.stringify(summary, null, 2)}`;
}

// Fire image generation in the BACKGROUND so the chat replies instantly.
// Generating inline blocks the request past the edge-function time limit, so the
// chat hangs on "pensando…" forever even though the images actually land. We split
// into batches of 2 (each a separate creative-chat invocation that finishes fast)
// and keep them alive past our response with EdgeRuntime.waitUntil.
function dispatchGeneration(authHeader: string, brief: string, count: number, refUrl?: string): number {
  const total = Math.min(Math.max(count, 1), 8);
  const jobs: Promise<any>[] = [];
  for (let i = 0; i < total; i += 2) {
    const batch = Math.min(2, total - i);
    jobs.push(fetch(`${SUPABASE_URL}/functions/v1/creative-chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authHeader }, body: JSON.stringify({ action: 'generate_batch', brief, count: batch, intended_use: 'ad', reference_image_url: refUrl || undefined }) }).catch(() => {}));
  }
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(Promise.allSettled(jobs)); } catch (_) { /* not on edge runtime */ }
  return total;
}
function parseAdCount(brief: string, fallback = 3): number {
  const m = String(brief).match(/(\d{1,2})\s*(?:ads?|creatives?|anuncios?|imag)/i);
  const n = m ? parseInt(m[1], 10) : fallback;
  return Math.min(Math.max(n || fallback, 1), 8);
}
function escapeHtml(s: string): string { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Draft a marketing email from a brief and drop it in the Emails approval queue
// (the Emails tab is the owner's review+send gate — same as the weekly drafter).
async function draftEmail(admin: any, brief: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) return 'Email AI not configured.';
  const TOOL = { name: 'email', description: 'Emit a marketing email.', input_schema: { type: 'object', properties: { subject: { type: 'string', description: 'Spanish subject ≤55 chars, high open-rate.' }, preview_text: { type: 'string', description: 'Spanish preheader ≤100 chars.' }, headline: { type: 'string', description: 'Big Spanish headline.' }, body_paragraphs: { type: 'array', items: { type: 'string' }, description: '2-4 warm Spanish paragraphs; lead with emotion; ONE clear offer; no recipient names.' }, cta_text: { type: 'string', description: 'Short Spanish CTA button text.' } }, required: ['subject', 'headline', 'body_paragraphs', 'cta_text'] } };
  const sys = `${agentBrief('Email copywriter for Regalos Que Cantan')}\n\nWrite ONE on-brand marketing email in warm US-Hispanic Spanish from the brief. Lead with emotion, make the case a personalized song is the best gift, land ONE clear offer + CTA. No recipient names.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: sys, tools: [TOOL], tool_choice: { type: 'tool', name: 'email' }, messages: [{ role: 'user', content: `Write the email. Brief: ${brief}` }] }) });
  if (!res.ok) return `Couldn't draft the email (${res.status}).`;
  const e = ((await res.json()).content || []).find((c: any) => c.type === 'tool_use')?.input;
  if (!e) return 'The email draft came back empty.';
  const SITE = 'https://regalosquecantan.com';
  const paras = (Array.isArray(e.body_paragraphs) ? e.body_paragraphs : []).map((p: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#333;">${escapeHtml(p)}</p>`).join('');
  const body_html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h1 style="font-size:24px;color:#111;margin:0 0 16px;">${escapeHtml(e.headline || '')}</h1>${paras}<a href="${SITE}" style="display:inline-block;background:#E11D2A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;font-size:16px;margin-top:8px;">${escapeHtml(e.cta_text || 'Créala hoy')}</a></div>`;
  const { error } = await admin.from('email_queue').insert({ week_of: new Date().toISOString().slice(0, 10), reason: brief.slice(0, 200), subject: e.subject || '(no subject)', preview_text: e.preview_text ?? null, body_html, cta_text: e.cta_text ?? null, cta_url: SITE, status: 'pending_approval' });
  if (error) return `Drafted it, but couldn't queue it: ${error.message}`;
  return `Drafted an email: "${e.subject}". It's waiting in Creative Studio → Emails for your review + send.`;
}

async function runTool(admin: any, authHeader: string, snap: any, name: string, input: any, pending: any[]): Promise<string> {
  const fwd = (fn: string, body: any) => fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authHeader }, body: JSON.stringify(body) });
  try {
    if (name === 'propose_ad_change') return await proposeAdChange(admin, input, pending);
    if (name === 'propose_extract_ad') return await proposeExtractAd(admin, input, pending);
    if (name === 'remember') {
      const content = String(input.content || '').trim().slice(0, 500);
      if (!content) return 'Nothing to remember.';
      const kind = ['preference', 'rule', 'decision', 'fact'].includes(input.kind) ? input.kind : 'fact';
      await admin.from('cos_memory').insert({ content, kind });
      return `Got it — I'll remember that (${kind}): "${content}". I'll apply it going forward.`;
    }
    if (name === 'get_sales') {
      const todayPT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      const to = String(input.to || todayPT).slice(0, 10);
      const from = String(input.from || to).slice(0, 10);
      return await getSales(admin, from, to, input.group_by);
    }
    if (name === 'propose_duplicate_scale') {
      if (!META_ACCESS_TOKEN) return 'Meta is not connected (META_ACCESS_TOKEN missing).';
      const rows = await listAdObjects('campaigns');
      const t = matchByName(rows, input.name);
      if (!t) return `Couldn't find a campaign matching "${input.name}". Campaigns: ${rows.slice(0, 8).map((r: any) => r.name).join(', ') || '(none)'}.`;
      const usd = Number(input.daily_budget_usd);
      const params: any = Number.isFinite(usd) && usd > 0 ? { daily_budget_usd: Math.round(usd * 100) / 100 } : {};
      const summary = `📋 Duplicate campaign "${t.name}"${params.daily_budget_usd ? ` at $${usd.toFixed(2)}/day` : ''} (new copy, PAUSED for your review)`;
      const { data: row } = await admin.from('cos_pending_actions').insert({ action_type: 'duplicate_scale', target_type: 'campaign', target_id: t.id, target_name: t.name, params, summary, status: 'pending' }).select('id, summary, action_type, target_name, status').single();
      if (row) pending.push(row);
      return `Proposed: ${summary}. Tap Confirm and I'll create the copy — nothing happens until you do.`;
    }
    if (name === 'draft_email') {
      const out = await draftEmail(admin, String(input.brief || '').slice(0, 800));
      return out;
    }
    if (name === 'propose_lookalike') {
      const days = Math.min(Math.max(Number(input.days) || 60, 7), 365);
      const summary = `📋 Build a 1% US Lookalike from your last ${days} days of buyers (uploads hashed buyer emails as a Custom Audience first)`;
      const { data: row } = await admin.from('cos_pending_actions').insert({ action_type: 'create_lookalike', target_type: 'campaign', target_id: 'lookalike', target_name: `last ${days}d buyers`, params: { days }, summary, status: 'pending' }).select('id, summary, action_type, target_name, status').single();
      if (row) pending.push(row);
      return `Proposed: ${summary}. Tap Confirm and I'll build it in Meta — nothing happens until you do.`;
    }
    if (name === 'check_creatives') {
      const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const { data } = await admin.from('creative_queue').select('status, intended_use, concept, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(60);
      const rows = data || [];
      const ready = rows.filter((c: any) => c.status === 'ready');
      const generating = rows.filter((c: any) => c.status === 'generating').length;
      const failed = rows.filter((c: any) => c.status === 'failed').length;
      return `Creatives created in the last 6h: ${ready.length} READY, ${generating} still generating, ${failed} failed. ${ready.length ? `Ready concepts: ${ready.slice(0, 6).map((c: any) => c.concept || '(untitled)').join('; ')}. They're in Creative Studio → ${ready[0].intended_use === 'social' ? 'Social' : 'Ads'}.` : 'Nothing ready yet.'}`;
    }
    if (name === 'approve_creative') {
      const id = input.creative_id || snap?.top_ready_creative?.id;
      if (!id) return 'No creative is waiting for approval.';
      const r = await (await fwd('creative-studio-admin', { action: 'approve', id })).json();
      return r.success ? `Approved — ${r.posted ? 'posting to your socials now.' : 'approved (posting paused).'}` : `Could not approve: ${r.error}`;
    }
    if (name === 'run_competitor_scan') { await fwd('competitors-admin', { action: 'scan' }); return 'Competitor scan started — fresh ads in ~1 min.'; }
    if (name === 'run_affiliate_scan') { await fwd('affiliate-recruiter-admin', { action: 'scan' }); return 'Partner scan started — new prospects in ~1 min.'; }
    if (name === 'refresh_briefing') { fwd('chief-of-staff-daily', {}).catch(() => {}); return 'Refreshing the briefing now.'; }
    if (name === 'generate_creatives') {
      const brief = String(input.brief || '').slice(0, 600);
      const n = dispatchGeneration(authHeader, brief, parseAdCount(brief), undefined);
      return `On it — I kicked off ${n} ad${n > 1 ? 's' : ''} in the background: "${brief}". They'll appear in Creative Studio → Ads in about 2–3 minutes (refresh that tab). You don't need to wait here — ask me anything else in the meantime.`;
    }
    if (name === 'get_ad_report') {
      const todayPT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      const to = String(input.to || todayPT).slice(0, 10);
      const from = String(input.from || to).slice(0, 10);
      return await buildAdReport(admin, from, to);
    }
    return `Unknown action ${name}`;
  } catch (e: any) { return `Action failed: ${e?.message || e}`; }
}

async function callClaude(messages: any[], system: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, tools: tools(), messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function systemPrompt(persona: any, snap: any) {
  const name = persona?.name || 'Sofía';
  const todayPT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  return `You are ${name}, the Chief of Staff for the owner (Gerardo). You are his trusted right hand — ${persona?.vibe === 'witty' ? 'cool, clever, a little witty' : persona?.vibe === 'premium' ? 'elegant, calm, precise' : 'warm, sharp, encouraging'}. You speak naturally, bilingual (Spanish/English, matching how he writes), concise and decisive — never a wall of text.

${agentBrief('Chief of Staff — the owner\'s manager and command center. You know the whole business (above). You delegate creative work to the Art Director, pull live ad reports, approve creatives, and take ad actions ONLY with the owner\'s confirmation. Know your own tools and the rest of the team; never claim you can\'t see or do something that the handbook says is your job.')}

You can SEE the whole business and you can ACT: approve a creative, trigger a competitor or partner scan, refresh the briefing, have the Creative Studio generate creatives, or pull the ad report for any date range. When the owner asks you to do one of these, use the tool — don't just talk about it. Confirm crisply what you did.

META ADS CHANGES (approval-gated): to PAUSE / turn off / resume an ad, or change a daily BUDGET, call propose_ad_change. To make more ads like one that's running, call propose_extract_ad IMMEDIATELY — do NOT interrogate him first. If he names an ad/campaign, match it; if not, grab the top active one. Pass any angle/twist (e.g. "faith angle, not Father's Day", "in Spanish") in the instruction field. The new ads are generated IMAGE-TO-IMAGE from that real ad, so they actually inherit its look — that's the whole point. When the order is confirmed it RELIABLY generates the ads and the confirmation tells you how many landed.

CRITICAL — affirmations: when you have just proposed an action and he replies "yes" / "do it" / "go ahead" / "sure" / "yep", that ALWAYS means EXECUTE YOUR LAST PROPOSAL. Re-issue that exact tool call (e.g. propose_extract_ad with the same args). NEVER respond to an affirmation by switching tasks or pulling an ad report — that is the #1 mistake to avoid.

If he asks whether ads/creatives are done, landed, or how many are waiting, call check_creatives and answer from it — NEVER say you can't check or guess. These do NOT execute — they create a Confirm/Cancel card the owner must tap. After calling them, tell him it's staged and waiting for his tap; NEVER say a pause/budget change or generation already happened — it only runs after he confirms. Match campaigns/ad sets by the name he uses; if unsure which, ask or pull get_ad_report first. For ANY question that asks for ad spend, sales, revenue, ROAS or CPA — for ANY day or range, INCLUDING a single "yesterday", "today", or "${todayPT}" — you MUST call get_ad_report and report ONLY the numbers it returns. ALWAYS include CPA (cost per sale — real_cpa/blended_cpa from the tool) alongside spend, sales, revenue and ROAS in every ad-numbers answer. BUT — only when he's actually asking for PERFORMANCE NUMBERS. If the topic is ad CREATIVE / visuals / designs / "make more ads" / "which ad to copy" / "where did you pull that from" (meaning which creative), DO NOT call get_ad_report and do NOT recite spend/ROAS — stay on the creative track (propose_extract_ad / check_creatives). Answering a creative request with a numbers report is a major error. NEVER state these figures from the snapshot or memory: the snapshot's latest_saved_report is a stale, wrong-timezone heads-up with NO numbers. DATES: every report date is the owner's PACIFIC day labeled by its 9am start — e.g. "June 25" means Jun 25 9:00am → Jun 26 9:00am Pacific. Pass dates in his Pacific frame; the tool converts to the Meta/Manila ad-day internally. So "yesterday" = ${todayPT} minus one day — call get_ad_report with from=to=that date.

SALES / BUSINESS DATA: for ANY question about sales, revenue, orders, AOV, or best-selling genre/occasion (NOT ad spend), call get_sales and answer from it — never guess. (get_ad_report = ad SPEND from Meta; get_sales = your real paid ORDERS from the database.)

SCALE A WINNER: to duplicate / clone / scale a winning campaign, call propose_duplicate_scale (approval-gated — the copy lands PAUSED for his review).

EMAILS: to draft / write / send a marketing email or promo, call draft_email with a brief — it lands in Creative Studio → Emails for his review + send (that IS the approval gate; you don't send it yourself).

LOOKALIKE AUDIENCE: to build a lookalike / "target people like my buyers", call propose_lookalike (approval-gated; on Confirm it uploads recent buyers hashed + builds a 1% US lookalike in Meta).

MEMORY: the CURRENT STATE below has a "memory" list — durable preferences/rules/decisions Gerardo told you. ALWAYS honor them automatically. When he states a lasting preference, rule, or decision (or says "remember…"), call remember to save it.

PROACTIVE: the CURRENT STATE has a "proactive" list — things worth raising on your own. At the start of a conversation, or when relevant, surface the most important one or two briefly (don't dump the whole list).

GUARDRAILS: NEVER fabricate numbers, names, or facts — always get them from a tool (get_ad_report, get_sales, check_creatives) or say "let me check" and actually check; if you truly don't know, say so. Anything that spends money or goes external (budgets, pausing, duplicating, generating, posting) MUST go through a Confirm card — never claim it's done before he confirms. You CANNOT issue refunds or send payouts/money — for those, tell Gerardo to do it himself.

TODAY is ${todayPT} (the owner's Pacific date). Resolve "today" / "yesterday" / "this week" against this.

CURRENT STATE (live):
${JSON.stringify(snap, null, 2)}`;
}

// ---------------------------------------------------------------------------
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
    const action = body.action || 'get';
    const getPersona = async () => (await admin.from('cos_persona').select('*').eq('id', 1).single()).data;

    if (action === 'get') {
      const persona = await getPersona();
      const { data: msgs } = await admin.from('cos_chat_messages').select('id, role, content, audio_url, created_at').order('created_at', { ascending: true }).limit(100);
      const { data: pend } = await admin.from('cos_pending_actions').select('id, summary, action_type, target_name, status').eq('status', 'pending').order('created_at', { ascending: false }).limit(20);
      return json({ success: true, persona, messages: msgs || [], pending_actions: pend || [] });
    }

    // Owner taps Confirm on a proposed Meta action → execute it now.
    if (action === 'confirm_action') {
      if (!body.id) return json({ success: false, error: 'Missing id' }, 400);
      const { ok, result } = await executePendingAction(admin, authHeader, String(body.id));
      return json({ success: ok, id: body.id, result, status: ok ? 'done' : 'failed' });
    }
    // Owner taps Cancel → discard the proposal without executing.
    if (action === 'cancel_action') {
      if (!body.id) return json({ success: false, error: 'Missing id' }, 400);
      await admin.from('cos_pending_actions').update({ status: 'cancelled' }).eq('id', body.id).eq('status', 'pending');
      return json({ success: true, id: body.id, status: 'cancelled' });
    }

    if (action === 'list_voices') return json({ success: true, voices: await listVoices() });

    if (action === 'preview_voice') {
      const text = body.text || 'Buenos días, Gerardo. Ayer fue un buen día, pero dejamos dinero en la mesa. Aquí está lo que yo haría hoy.';
      const url = await tts(admin, body.voice_id, text);
      return url ? json({ success: true, audio_url: url }) : json({ success: false, error: 'TTS failed' }, 502);
    }

    if (action === 'gen_avatars') {
      if (!KIE_API_KEY) return json({ success: false, error: 'KIE_API_KEY not set' }, 500);
      const desc = body.description || 'a warm, friendly Latina chief of staff in her 30s, professional, approachable smile';
      const base = `Clean professional avatar headshot portrait of ${desc}. Modern, polished, soft warm lighting, simple neutral background, looking at camera, high quality, photoreal. Square framing, shoulders up.`;
      const prompts = [base, `${base} Slightly different styling and angle.`, `${base} Different outfit, equally professional and warm.`];
      const urls = (await Promise.all(prompts.map((p) => genAvatar(admin, p)))).filter(Boolean);
      return json({ success: true, avatars: urls });
    }

    if (action === 'set_persona') {
      const patch: any = { updated_at: new Date().toISOString() };
      for (const k of ['name', 'vibe', 'avatar_url', 'voice_id', 'voice_name']) if (body[k] !== undefined) patch[k] = body[k];
      await admin.from('cos_persona').update(patch).eq('id', 1);
      return json({ success: true, persona: await getPersona() });
    }

    if (action === 'speak') {
      const persona = await getPersona();
      const url = await tts(admin, persona?.voice_id, body.text || '');
      if (url && body.message_id) await admin.from('cos_chat_messages').update({ audio_url: url }).eq('id', body.message_id);
      return url ? json({ success: true, audio_url: url }) : json({ success: false, error: 'No voice set or TTS failed' }, 502);
    }

    if (action === 'chat') {
      if (!ANTHROPIC_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
      const userMsg = (body.message || '').toString().slice(0, 3000);
      if (!userMsg.trim()) return json({ success: false, error: 'Empty message' }, 400);
      const persona = await getPersona();
      const snap = await snapshot(admin);
      const { data: hist } = await admin.from('cos_chat_messages').select('role, content').order('created_at', { ascending: true }).limit(30);
      const messages: any[] = (hist || []).map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
      messages.push({ role: 'user', content: userMsg });
      const system = systemPrompt(persona, snap);

      let finalText = '';
      const pending: any[] = []; // proposed Meta actions awaiting the owner's Confirm tap
      for (let i = 0; i < 3; i++) {
        const resp = await callClaude(messages, system);
        const content = resp.content || [];
        messages.push({ role: 'assistant', content });
        const toolUses = content.filter((c: any) => c.type === 'tool_use');
        const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
        if (text) finalText = text;
        if (resp.stop_reason !== 'tool_use' || !toolUses.length) break;
        const results = [];
        for (const tu of toolUses) results.push({ type: 'tool_result', tool_use_id: tu.id, content: await runTool(admin, authHeader, snap, tu.name, tu.input || {}, pending) });
        messages.push({ role: 'user', content: results });
      }

      await admin.from('cos_chat_messages').insert({ role: 'user', content: userMsg });
      const { data: saved } = await admin.from('cos_chat_messages').insert({ role: 'assistant', content: finalText || '(listo)' }).select('id').single();
      return json({ success: true, reply: finalText, message_id: saved?.id || null, pending_actions: pending });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('cos-assistant error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
