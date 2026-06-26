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
        return { date: label, spend: Math.round(s * 100) / 100, real_orders: rd.orders, real_revenue: Math.round(rd.revenue * 100) / 100, roas: s > 0 ? Math.round((rd.revenue / s) * 100) / 100 : null, meta_sales: meta };
      }).sort((a: any, b: any) => (a.date < b.date ? -1 : 1));
      const top_campaigns = (byCampaign.data || [])
        .map((c: any) => ({ name: c.campaign_name, spend: Math.round(num(c.spend) * 100) / 100, meta_sales: purchasesOf(c) }))
        .sort((a: any, b: any) => b.meta_sales - a.meta_sales || b.spend - a.spend).slice(0, 8);
      const summary = {
        from, to, source: 'meta_live', timezone: "Pacific day, 9am→9am, labeled by start date", days_covered: days.length,
        total_spend: Math.round(totalSpend * 100) / 100,
        total_real_orders: rev.orders, total_real_revenue: rev.total,
        blended_roas: totalSpend > 0 ? Math.round((rev.total / totalSpend) * 100) / 100 : null,
        meta_reported_sales: totalMetaSales, per_day: days, top_campaigns,
        note: `Dates are the owner's PACIFIC days labeled by their 9am start — e.g. "2026-06-25" = Jun 25 9:00am → Jun 26 9:00am Pacific (one Meta/Manila ad-day relabeled to its Pacific start date). Spend and real_orders/real_revenue both cover that exact window, so the date matches the owner's LA calendar + Stripe and daily ROAS is exact.`,
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
    return { date: r.report_for, spend: Math.round(s * 100) / 100, real_orders: ord, real_revenue: Math.round(rev2 * 100) / 100, roas: s > 0 ? Math.round((rev2 / s) * 100) / 100 : null, headline: a.headline };
  });
  const summary = { from, to, source: 'saved_reports', days_covered: perDay.length, total_spend: Math.round(spend * 100) / 100, total_real_orders: orders, total_real_revenue: Math.round(revenue * 100) / 100, blended_roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null, meta_reported_sales: metaSales, per_day: perDay };
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
  const { data: mb } = await admin.from('media_buyer_reports').select('report_for, metrics, analysis').order('report_for', { ascending: false }).limit(1).maybeSingle();
  const [creativesReady, emailsPending, competitorsNew, prospectsNew] = await Promise.all([
    count('creative_queue', (q) => q.eq('status', 'ready')),
    count('email_queue', (q) => q.eq('status', 'pending_approval')),
    count('competitor_ads', (q) => q.eq('status', 'new')),
    count('affiliate_prospects', (q) => q.eq('status', 'new')),
  ]);
  const { data: topCreative } = await admin.from('creative_queue').select('id, concept, score').eq('status', 'ready').order('score', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return {
    // Qualitative heads-up ONLY — no figures. Numbers must come from get_ad_report
    // (correct Pacific timezone + live), never from this stale saved report.
    latest_saved_report: mb ? { headline: mb.analysis?.headline, account_health: mb.analysis?.account_health, top_recommendation: mb.analysis?.recommendations?.[0], NUMBERS_NOTE: 'NEVER quote spend/sales/revenue/ROAS/CPA from here — call get_ad_report for any figure, even "yesterday".' } : null,
    creatives_ready: creativesReady, top_ready_creative: topCreative || null,
    emails_pending: emailsPending, competitor_opportunities: competitorsNew, partner_prospects: prospectsNew,
  };
}

// ---------------------------------------------------------------------------
// Chat tools (the assistant can DO things by forwarding the admin session)
// ---------------------------------------------------------------------------
function tools() {
  return [
    { name: 'approve_creative', description: 'Approve a creative so it auto-posts. Omit id to approve the top-scored one waiting.', input_schema: { type: 'object', properties: { creative_id: { type: 'string' } } } },
    { name: 'run_competitor_scan', description: 'Trigger a fresh scan of competitor ads.', input_schema: { type: 'object', properties: {} } },
    { name: 'run_affiliate_scan', description: 'Trigger a fresh scan for affiliate/partner prospects.', input_schema: { type: 'object', properties: {} } },
    { name: 'refresh_briefing', description: 'Regenerate the morning Chief-of-Staff briefing.', input_schema: { type: 'object', properties: {} } },
    { name: 'generate_creatives', description: 'Ask the Creative Studio art director to generate creatives from a brief.', input_schema: { type: 'object', properties: { brief: { type: 'string', description: 'What to make, e.g. "5 Mother\'s Day photoreal ads".' } }, required: ['brief'] } },
    { name: 'get_ad_report', description: 'Pull the real ad-performance report for a DATE RANGE — LIVE from Meta (full history), with per-day spend, real paid sales, ROAS, and top campaigns. Use this for ANY question about ad results over a period — "this week", "Monday to now", "last 7 days", "last month", or specific dates. Dates are the owner\'s PACIFIC days labeled by their 9am start (e.g. "2026-06-25" = Jun 25 9am → Jun 26 9am Pacific) — just pass his Pacific dates; the tool converts to the Meta/Manila ad-day internally. Do NOT answer ad-results questions from the yesterday snapshot.', input_schema: { type: 'object', properties: { from: { type: 'string', description: "Start date YYYY-MM-DD in the owner's Pacific frame (inclusive)." }, to: { type: 'string', description: "End date YYYY-MM-DD Pacific (inclusive). Defaults to today." } }, required: ['from'] } },
  ];
}

async function runTool(admin: any, authHeader: string, snap: any, name: string, input: any): Promise<string> {
  const fwd = (fn: string, body: any) => fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authHeader }, body: JSON.stringify(body) });
  try {
    if (name === 'approve_creative') {
      const id = input.creative_id || snap?.top_ready_creative?.id;
      if (!id) return 'No creative is waiting for approval.';
      const r = await (await fwd('creative-studio-admin', { action: 'approve', id })).json();
      return r.success ? `Approved — ${r.posted ? 'posting to your socials now.' : 'approved (posting paused).'}` : `Could not approve: ${r.error}`;
    }
    if (name === 'run_competitor_scan') { await fwd('competitors-admin', { action: 'scan' }); return 'Competitor scan started — fresh ads in ~1 min.'; }
    if (name === 'run_affiliate_scan') { await fwd('affiliate-recruiter-admin', { action: 'scan' }); return 'Partner scan started — new prospects in ~1 min.'; }
    if (name === 'refresh_briefing') { fwd('chief-of-staff-daily', {}).catch(() => {}); return 'Refreshing the briefing now.'; }
    if (name === 'generate_creatives') { const r = await (await fwd('creative-chat', { action: 'send', message: input.brief })).json(); return r.success ? `On it — the art director is generating: "${input.brief}". They'll show up in Creative Studio shortly.` : `Could not start: ${r.error}`; }
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
  return `You are ${name}, the Chief of Staff for the owner (Gerardo) of "Regalos Que Cantan", a US-Hispanic brand selling personalized Spanish songs as gifts (~$30). You are his trusted right hand — ${persona?.vibe === 'witty' ? 'cool, clever, a little witty' : persona?.vibe === 'premium' ? 'elegant, calm, precise' : 'warm, sharp, encouraging'}. You speak naturally, bilingual (Spanish/English, matching how he writes), concise and decisive — never a wall of text.

You can SEE the whole business and you can ACT: approve a creative, trigger a competitor or partner scan, refresh the briefing, have the Creative Studio generate creatives, or pull the ad report for any date range. When the owner asks you to do one of these, use the tool — don't just talk about it. Confirm crisply what you did. For ANY question that asks for ad spend, sales, revenue, ROAS or CPA — for ANY day or range, INCLUDING a single "yesterday", "today", or "${todayPT}" — you MUST call get_ad_report and report ONLY the numbers it returns. NEVER state these figures from the snapshot or memory: the snapshot's latest_saved_report is a stale, wrong-timezone heads-up with NO numbers. DATES: every report date is the owner's PACIFIC day labeled by its 9am start — e.g. "June 25" means Jun 25 9:00am → Jun 26 9:00am Pacific. Pass dates in his Pacific frame; the tool converts to the Meta/Manila ad-day internally. So "yesterday" = ${todayPT} minus one day — call get_ad_report with from=to=that date. For things you can't do directly (changing ad budgets, sending money, emailing customers), give a clear recommendation and tell him which tab to do it in.

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
      return json({ success: true, persona, messages: msgs || [] });
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
      for (let i = 0; i < 3; i++) {
        const resp = await callClaude(messages, system);
        const content = resp.content || [];
        messages.push({ role: 'assistant', content });
        const toolUses = content.filter((c: any) => c.type === 'tool_use');
        const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
        if (text) finalText = text;
        if (resp.stop_reason !== 'tool_use' || !toolUses.length) break;
        const results = [];
        for (const tu of toolUses) results.push({ type: 'tool_result', tool_use_id: tu.id, content: await runTool(admin, authHeader, snap, tu.name, tu.input || {}) });
        messages.push({ role: 'user', content: results });
      }

      await admin.from('cos_chat_messages').insert({ role: 'user', content: userMsg });
      const { data: saved } = await admin.from('cos_chat_messages').insert({ role: 'assistant', content: finalText || '(listo)' }).select('id').single();
      return json({ success: true, reply: finalText, message_id: saved?.id || null });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('cos-assistant error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
