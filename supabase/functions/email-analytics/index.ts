// supabase/functions/email-analytics/index.ts
// ===========================================================================
// EMAIL COMMAND CENTER — admin analytics reader
// ===========================================================================
// Powers the "Email Performance" section in Creative Studio. Reads the
// pre-aggregated email_campaign_daily rollup (+ campaign_catalog, analytics_meta,
// email_unsubscribes) and returns a full dashboard payload in ONE call:
// overview KPIs, per-family + per-campaign leaderboard, revenue/sends trend,
// deliverability, and computed alerts. A `campaign` param returns a drill-down.
//
// Read-only. Revenue-sensitive → admins only (role='admin'), same auth pattern
// as daily-briefing-admin / creative-studio-admin. verify_jwt = true.
//
// Deploy: supabase functions deploy email-analytics --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Row = {
  campaign_key: string; day: string;
  sent: number; delivered: number; opens: number; unique_opens: number;
  clicks: number; unique_clicks: number; unsubs: number; spam: number;
  bounces: number; purchases: number; revenue_cents: number;
};
type Cat = { key: string; display_name: string; family: string; kind: string; active: boolean; sort: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? r2((num / den) * 100) : null);

function agg(rows: Row[]) {
  const t = { sent: 0, delivered: 0, opens: 0, unique_opens: 0, clicks: 0, unique_clicks: 0, unsubs: 0, spam: 0, bounces: 0, purchases: 0, revenue_cents: 0 };
  for (const r of rows) {
    t.sent += r.sent; t.delivered += r.delivered; t.opens += r.opens; t.unique_opens += r.unique_opens;
    t.clicks += r.clicks; t.unique_clicks += r.unique_clicks; t.unsubs += r.unsubs; t.spam += r.spam;
    t.bounces += r.bounces; t.purchases += r.purchases; t.revenue_cents += r.revenue_cents;
  }
  return t;
}

// A rollup slice → the metric object the UI renders. Engagement rates are null
// when nothing has been captured yet (historical), so the UI shows "— / capture".
function metrics(rows: Row[], extra: Record<string, unknown> = {}) {
  const t = agg(rows);
  const hasEng = t.delivered + t.opens + t.clicks > 0;
  const delivBase = t.delivered || t.sent;
  return {
    sent: t.sent,
    delivered: t.delivered,
    revenue: r2(t.revenue_cents / 100),
    purchases: t.purchases,
    conv_rate: pct(t.purchases, t.sent),
    rev_per_1k: t.sent > 0 ? r2((t.revenue_cents / 100 / t.sent) * 1000) : null,
    open_rate: hasEng ? pct(t.unique_opens, delivBase) : null,
    click_rate: hasEng ? pct(t.unique_clicks, delivBase) : null,
    ctor: hasEng && t.unique_opens > 0 ? pct(t.unique_clicks, t.unique_opens) : null,
    deliver_rate: t.delivered > 0 ? pct(t.delivered, t.sent) : null,
    bounce_rate: hasEng ? pct(t.bounces, t.sent) : null,
    spam_rate: t.delivered > 0 ? pct(t.spam, t.delivered) : null,
    unsub_rate: pct(t.unsubs, t.sent),
    has_engagement: hasEng,
    ...extra,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users').select('role').eq('user_id', userData.user.id).single();
    if (roleErr || !roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
    if (roleRow.role !== 'admin') return json({ success: false, error: 'Admins only (revenue data)' }, 403);

    let body: any = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
    const days = [30, 90, 365, 100000].includes(Number(body.days)) ? Number(body.days) : 90;
    const sinceIso = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);

    // Load catalog + rollup slice + meta.
    const [{ data: cats }, { data: rollup }, { data: meta }, { count: suppression }, { count: leads }] = await Promise.all([
      admin.from('campaign_catalog').select('key, display_name, family, kind, active, sort'),
      admin.from('email_campaign_daily').select('*').gte('day', sinceIso),
      admin.from('analytics_meta').select('key, value'),
      admin.from('email_unsubscribes').select('*', { count: 'exact', head: true }),
      admin.from('email_leads').select('*', { count: 'exact', head: true }),
    ]);
    const catMap = new Map<string, Cat>((cats || []).map((c: any) => [c.key, c]));
    const rows: Row[] = (rollup || []) as Row[];
    const metaMap = new Map<string, unknown>((meta || []).map((m: any) => [m.key, m.value]));

    // ── Drill-down for one campaign ──
    if (body.campaign) {
      const cr = rows.filter((r) => r.campaign_key === body.campaign);
      const series = cr.slice().sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ day: r.day, revenue: r2(r.revenue_cents / 100), sent: r.sent, purchases: r.purchases, opens: r.unique_opens, clicks: r.unique_clicks }));
      const cat = catMap.get(body.campaign);
      return json({ success: true, campaign: { key: body.campaign, ...cat, ...metrics(cr), series } });
    }

    // ── Per-campaign leaderboard ──
    const byCampaign = new Map<string, Row[]>();
    for (const r of rows) { if (!byCampaign.has(r.campaign_key)) byCampaign.set(r.campaign_key, []); byCampaign.get(r.campaign_key)!.push(r); }
    const campaigns = [...byCampaign.entries()].map(([key, rs]) => {
      const cat = catMap.get(key) || { key, display_name: key, family: 'other', kind: 'flow', sort: 100, active: true } as Cat;
      return { key, display_name: cat.display_name, family: cat.family, kind: cat.kind, sort: cat.sort, ...metrics(rs) };
    }).filter((c) => c.sent > 0).sort((a, b) => b.revenue - a.revenue);

    // ── Per-family rollup ──
    const FAM_ORDER = ['win_back', 'upsell', 'seasonal', 'newsletter', 'transactional', 'other'];
    const byFamily = new Map<string, Row[]>();
    for (const r of rows) {
      const fam = catMap.get(r.campaign_key)?.family || 'other';
      if (!byFamily.has(fam)) byFamily.set(fam, []); byFamily.get(fam)!.push(r);
    }
    const families = FAM_ORDER.filter((f) => byFamily.has(f)).map((f) => ({ family: f, ...metrics(byFamily.get(f)!) }));

    // ── Overall + flows vs blasts ──
    const overall = metrics(rows);
    const flowRows = rows.filter((r) => (catMap.get(r.campaign_key)?.kind || 'flow') === 'flow');
    const blastRows = rows.filter((r) => (catMap.get(r.campaign_key)?.kind) === 'blast');
    const split = { flows: metrics(flowRows), blasts: metrics(blastRows) };
    const winBackRevenue = r2(agg(byFamily.get('win_back') || []).revenue_cents / 100);
    const winBackRecovered = agg(byFamily.get('win_back') || []).purchases;

    // ── Trend by day ──
    const byDay = new Map<string, { revenue: number; sent: number; purchases: number; opens: number; clicks: number }>();
    for (const r of rows) {
      const d = byDay.get(r.day) || { revenue: 0, sent: 0, purchases: 0, opens: 0, clicks: 0 };
      d.revenue += r.revenue_cents / 100; d.sent += r.sent; d.purchases += r.purchases; d.opens += r.unique_opens; d.clicks += r.unique_clicks;
      byDay.set(r.day, d);
    }
    const trend = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, revenue: r2(v.revenue), sent: v.sent, purchases: v.purchases, opens: v.opens, clicks: v.clicks }));

    // ── Alerts (computed live from the slice) ──
    const alerts: any[] = [];
    const wb = campaigns.filter((c) => c.family === 'win_back' && c.sent > 200);
    if (wb.length >= 2) {
      const best = wb.reduce((a, b) => (a.conv_rate! >= (b.conv_rate ?? 0) ? a : b));
      const worst = wb.reduce((a, b) => (a.conv_rate! <= (b.conv_rate ?? 100) ? a : b));
      if (worst.conv_rate !== null && best.conv_rate !== null && worst.conv_rate < best.conv_rate * 0.35) {
        alerts.push({ severity: 'warn', title: `${worst.display_name} is underperforming`, detail: `${worst.conv_rate}% conversion vs ${best.conv_rate}% at ${best.display_name}. Test a softer offer or trim this touch.` });
      }
    }
    const bestRoi = campaigns.filter((c) => c.sent >= 20 && c.rev_per_1k !== null).sort((a, b) => (b.rev_per_1k! - a.rev_per_1k!))[0];
    if (bestRoi) alerts.push({ severity: 'good', title: `${bestRoi.display_name} is your best ROI`, detail: `$${bestRoi.rev_per_1k}/1k emails, ${bestRoi.conv_rate}% conversion. Consider adding a follow-up touch.` });
    const spammy = campaigns.filter((c) => c.spam_rate !== null && c.spam_rate! >= 0.1).sort((a, b) => b.spam_rate! - a.spam_rate!)[0];
    if (spammy) alerts.push({ severity: spammy.spam_rate! >= 0.3 ? 'critical' : 'warn', title: `Spam rate elevated on ${spammy.display_name}`, detail: `${spammy.spam_rate}% complaints. Tighten targeting to protect inbox placement (Gmail/Yahoo cap ~0.3%).` });
    const highUnsub = campaigns.filter((c) => c.kind === 'blast' && c.unsub_rate !== null).sort((a, b) => b.unsub_rate! - a.unsub_rate!)[0];
    if (highUnsub && highUnsub.unsub_rate! > 0.4) alerts.push({ severity: 'warn', title: `${highUnsub.display_name} drives the most unsubscribes`, detail: `${highUnsub.unsub_rate}% unsub. Send seasonal blasts to engaged segments only.` });

    // ── Dormant-buyer opportunity (light live query) ──
    const dormantSince = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
    const { count: recentBuyers } = await admin.from('songs')
      .select('*', { count: 'exact', head: true })
      .eq('paid', true).eq('platform', 'es').gte('paid_at', dormantSince);

    return json({
      success: true,
      range_days: days,
      generated_at: new Date().toISOString(),
      meta: {
        capture_started_at: metaMap.get('capture_started_at') || null,
        tracking_enabled_at: metaMap.get('tracking_enabled_at') || null,
        last_refresh: metaMap.get('last_refresh') || null,
        engagement_ready: overall.has_engagement,
      },
      overview: overall,
      headline: { win_back_revenue: winBackRevenue, win_back_recovered: winBackRecovered, email_revenue: overall.revenue, suppression, leads },
      split,
      families,
      campaigns,
      trend,
      deliverability: { ...metrics(rows), suppression_list: suppression, reachable_list: leads, recent_buyers_60d: recentBuyers },
      alerts,
    });
  } catch (e: any) {
    console.error('[email-analytics] error:', e?.message || e);
    return json({ success: false, error: e?.message || 'server_error' }, 500);
  }
});
