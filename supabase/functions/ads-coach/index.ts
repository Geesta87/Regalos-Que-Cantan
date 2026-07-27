// supabase/functions/ads-coach/index.ts
// ===========================================================================
// META ADS COACH — interactive, advice-only ads specialist
// ===========================================================================
// A chat surface where the owner asks about the Meta account ("why is my best
// ad throttled?", "what should I test next?", "is this campaign fatiguing?") and
// gets answers grounded in (a) the LIVE account numbers and (b) the Meta
// Algorithm Brain (_shared/meta-algorithm-brain.ts) — how Meta actually delivers
// ads today. It explains the WHY behind every recommendation and respects each
// fact's confidence tag.
//
// ADVICE-ONLY BY DESIGN: this function NEVER writes to the Meta account. It reads
// ad insights (ads_read) + cross-checks real paid orders, and talks. Every move
// it suggests, the owner applies by hand in Meta Ads Manager. (Mirrors the
// Media Buyer's recommend-only stance.)
//
// STATELESS: the browser holds the conversation and posts the full message list
// each turn — no new DB table, no migration. Admin-only (verify_jwt = true;
// handler additionally requires an admin_users row, same gate as cos-assistant).
//
// Deploy: supabase functions deploy ads-coach --project-ref yzbvajungshqcpusfiia
// Required secrets: META_ACCESS_TOKEN, ANTHROPIC_API_KEY (both already set).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as encodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { metaBrainContext, META_BRAIN_LAST_REVIEWED } from '../_shared/meta-algorithm-brain.ts';
import { brandContext } from '../_shared/brand-brief.ts';
import { kiePhotoBytes, kieEditBytes, KIE_IMAGE_ENABLED } from '../_shared/kie-image.ts';
import { renderAd } from '../_shared/render-ad.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ADS_COACH_MODEL') || 'claude-opus-4-8';

const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN');
const META_AD_ACCOUNT_ID = Deno.env.get('META_AD_ACCOUNT_ID') || 'act_832413711748940';
const META_API_VERSION = Deno.env.get('META_API_VERSION') || 'v21.0';
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
// The ad account bills its day in Asia/Manila, so revenue is bucketed there too
// to keep spend-vs-revenue apples-to-apples (see media-buyer-daily for the why).
const AD_TZ = Deno.env.get('META_AD_TZ') || Deno.env.get('MEDIA_BUYER_TZ') || 'Asia/Manila';
const RQC_PLATFORM = Deno.env.get('MEDIA_BUYER_PLATFORM') || 'es';
// Bucket for Coach-generated ad images (reuses the Creative Studio bucket).
const IMG_BUCKET = Deno.env.get('CREATIVE_BUCKET') || 'creative-studio';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Meta Ads helpers (mirror media-buyer-daily / cos-assistant)
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

// Start-of-day (UTC instant) for a calendar day in `tz`, offset by dayOffset.
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = dtf.formatToParts(date).reduce((a: any, x) => (a[x.type] = x.value, a), {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}
function startOfTzDay(tz: string, dayOffset: number): Date {
  const now = new Date();
  const off = tzOffsetMs(now, tz);
  const wall = new Date(now.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);
  wall.setUTCDate(wall.getUTCDate() + dayOffset);
  let utc = new Date(wall.getTime() - off);
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off) utc = new Date(wall.getTime() - off2);
  return utc;
}

const INSIGHT_FIELDS = 'campaign_name,spend,impressions,clicks,reach,frequency,cpc,cpm,ctr,actions,cost_per_action_type';

function shapeCampaign(row: any, budgetByName: Record<string, number>) {
  const spend = num(row.spend);
  const purchases = purchasesOf(row);
  return {
    name: row.campaign_name,
    spend: r2(spend),
    purchases,
    meta_cpa: purchases > 0 ? r2(spend / purchases) : null,
    ctr: r2(num(row.ctr)),
    cpm: r2(num(row.cpm)),
    cpc: r2(num(row.cpc)),
    frequency: r2(num(row.frequency)),
    daily_budget: budgetByName[row.campaign_name] ?? null,
  };
}

// Ad-level shaping — lets the coach reason about INDIVIDUAL ads (which creative
// is the winner, which is fatiguing) instead of only campaign aggregates.
function shapeAd(row: any) {
  const spend = num(row.spend);
  const purchases = purchasesOf(row);
  return {
    id: row.ad_id,
    ad: row.ad_name,
    ad_set: row.adset_name,
    campaign: row.campaign_name,
    spend: r2(spend),
    purchases,
    meta_cpa: purchases > 0 ? r2(spend / purchases) : null,
    ctr: r2(num(row.ctr)),
    cpm: r2(num(row.cpm)),
    frequency: r2(num(row.frequency)),
  };
}

// Compact, human-readable summary of an ad set's targeting so the coach can judge
// audience width + whether Advantage+ audience is on, without prompt bloat.
function summarizeTargeting(t: any): string {
  if (!t) return 'targeting n/a';
  const parts: string[] = [];
  if (t.age_min || t.age_max) parts.push(`age ${t.age_min || 18}-${t.age_max || 65}`);
  const g = t.genders;
  if (Array.isArray(g) && g.length === 1) parts.push(g[0] === 1 ? 'men' : 'women');
  const geos = t.geo_locations?.countries;
  if (Array.isArray(geos) && geos.length) parts.push(geos.slice(0, 4).join('/'));
  const ca = t.custom_audiences;
  if (Array.isArray(ca) && ca.length) parts.push(`${ca.length} custom/LAL audience(s)`);
  const adv = t.targeting_automation?.advantage_audience;
  if (adv === 1 || adv === '1') parts.push('Advantage+ audience ON (broad)');
  const pp = t.publisher_platforms;
  parts.push(Array.isArray(pp) && pp.length ? `placements: ${pp.join(',')}` : 'placements: Advantage+ (auto)');
  return parts.join('; ') || 'broad';
}

// Pull the live account snapshot the coach reasons over: active budgets, 7-day +
// yesterday campaign performance, and the REAL paid-order revenue cross-check.
async function gatherAccountContext(supabase: any) {
  const acctPath = `${META_AD_ACCOUNT_ID}/insights`;
  const AD_INSIGHT_FIELDS = 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,clicks,cpm,cpc,ctr,frequency,actions';
  const ACC_FIELDS = 'spend,impressions,clicks,ctr,cpm,frequency,actions';
  // Prior 7-day window (days 8-14 ago) for trend comparison. Meta has no
  // "previous 7 days" preset, so build an explicit time_range in the ad-account tz.
  const adDate = (daysAgo: number) => new Intl.DateTimeFormat('en-CA', { timeZone: AD_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(startOfTzDay(AD_TZ, -daysAgo));
  const prior7 = JSON.stringify({ since: adDate(14), until: adDate(8) });
  const [campaignsList, week, yday, ydayAccount, adsWeek, month, prevAccount, prevWeek, adsetsList, adsetWeek, placements] = await Promise.all([
    metaGet(`${META_AD_ACCOUNT_ID}/campaigns`, { fields: 'id,name,daily_budget,objective,buying_type,smart_promotion_type,effective_status', limit: '100', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]) }),
    metaGet(acctPath, { level: 'campaign', date_preset: 'last_7d', fields: INSIGHT_FIELDS, limit: '100' }),
    metaGet(acctPath, { level: 'campaign', date_preset: 'yesterday', fields: INSIGHT_FIELDS, limit: '100' }),
    metaGet(acctPath, { level: 'account', date_preset: 'last_7d', fields: ACC_FIELDS, limit: '1' }),
    // Ad-level, last 7d — so the coach sees the real creative winners/losers, not
    // just campaign aggregates. We sort by spend and keep the top 15 below, so
    // no server-side spend filter is needed (Meta insights filtering on `spend`
    // is unreliable and would risk failing the whole live-data pull).
    metaGet(acctPath, { level: 'ad', date_preset: 'last_7d', fields: AD_INSIGHT_FIELDS, limit: '300' }),
    // Longer history: 30-day account baseline + prior-7d (days 8-14) for trend.
    // These are wrapped so a hiccup on the history calls can NEVER break the core
    // 7-day pull — worst case the trend/baseline is simply absent this turn.
    metaGet(acctPath, { level: 'account', date_preset: 'last_30d', fields: ACC_FIELDS, limit: '1' }).catch(() => ({ data: [] })),
    metaGet(acctPath, { level: 'account', time_range: prior7, fields: ACC_FIELDS, limit: '1' }).catch(() => ({ data: [] })),
    metaGet(acctPath, { level: 'campaign', time_range: prior7, fields: INSIGHT_FIELDS, limit: '100' }).catch(() => ({ data: [] })),
    // STRUCTURE: ad-set budgets, optimization goal, targeting/audience + Advantage+
    // flags — so the coach can judge whether the account is over-fragmented and
    // whether campaigns are Advantage+ or manual. All .catch-isolated.
    metaGet(`${META_AD_ACCOUNT_ID}/adsets`, { fields: 'name,campaign_id,daily_budget,lifetime_budget,optimization_goal,bid_strategy,effective_status,targeting{age_min,age_max,genders,geo_locations,custom_audiences,targeting_automation,publisher_platforms}', limit: '200', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]) }).catch(() => ({ data: [] })),
    metaGet(acctPath, { level: 'adset', date_preset: 'last_7d', fields: 'adset_name,campaign_name,spend,cpm,ctr,frequency,actions', limit: '200' }).catch(() => ({ data: [] })),
    metaGet(acctPath, { level: 'account', date_preset: 'last_7d', fields: 'spend,actions', breakdowns: 'publisher_platform', limit: '50' }).catch(() => ({ data: [] })),
  ]);

  const budgetByName: Record<string, number> = {};
  for (const c of (campaignsList.data || [])) if (c.daily_budget != null) budgetByName[c.name] = Math.round(num(c.daily_budget)) / 100;

  const campaigns_7d = (week.data || []).map((r: any) => shapeCampaign(r, budgetByName)).sort((a: any, b: any) => b.spend - a.spend);
  const campaigns_yesterday = (yday.data || []).map((r: any) => shapeCampaign(r, budgetByName));
  // TREND: attach each campaign's prior-7d (days 8-14) numbers so the coach can
  // tell a real trend from a one-day blip and see fatigue building over weeks.
  const prevByName: Record<string, any> = {};
  for (const r of (prevWeek.data || [])) prevByName[r.campaign_name] = r;
  for (const c of campaigns_7d as any[]) {
    const p = prevByName[c.name];
    if (p) c.trend_prev_7d = { spend: r2(num(p.spend)), purchases: purchasesOf(p), cpm: r2(num(p.cpm)), frequency: r2(num(p.frequency)) };
  }

  // STRUCTURE — campaign type (Advantage+ vs manual, CBO vs ABO) + ad-set breakdown.
  const campById: Record<string, any> = {};
  const campNameById: Record<string, string> = {};
  for (const c of (campaignsList.data || [])) { campById[c.id] = c; campNameById[c.id] = c.name; }
  // Count ad sets per campaign + build the ad-set list (structure merged w/ 7d perf).
  const adsetPerfByName: Record<string, any> = {};
  for (const r of (adsetWeek.data || [])) adsetPerfByName[r.adset_name] = r;
  // How many ads DELIVERED (got spend) in each ad set over the last 7d — the
  // practical "shots in the machine" count, so the coach never has to ask the
  // owner to count ads-per-ad-set by hand.
  const adsCountByAdset: Record<string, number> = {};
  for (const r of (adsWeek.data || [])) { const k = r.adset_name || '?'; adsCountByAdset[k] = (adsCountByAdset[k] || 0) + 1; }
  const adsetCountByCamp: Record<string, number> = {};
  const ad_sets = (adsetsList.data || []).map((s: any) => {
    const campName = campNameById[s.campaign_id] || s.campaign_id;
    adsetCountByCamp[campName] = (adsetCountByCamp[campName] || 0) + 1;
    const perf = adsetPerfByName[s.name] || {};
    const cbo = campById[s.campaign_id]?.daily_budget != null;
    return {
      campaign: campName,
      ad_set: s.name,
      budget: s.daily_budget != null ? `$${Math.round(num(s.daily_budget)) / 100}/day` : (s.lifetime_budget != null ? `$${Math.round(num(s.lifetime_budget)) / 100} lifetime` : (cbo ? 'campaign-level (CBO)' : 'n/a')),
      optimization_goal: s.optimization_goal || null,
      bid_strategy: s.bid_strategy || null,
      audience: summarizeTargeting(s.targeting),
      ads_delivered_7d: adsCountByAdset[s.name] ?? 0,
      spend: r2(num(perf.spend)),
      purchases: purchasesOf(perf),
      cpm: r2(num(perf.cpm)),
      frequency: r2(num(perf.frequency)),
    };
  }).sort((a: any, b: any) => b.spend - a.spend).slice(0, 25);
  // Attach type + ad-set count to each campaign row.
  for (const c of campaigns_7d as any[]) {
    const info = Object.values(campById).find((x: any) => x.name === c.name) as any;
    if (info) {
      c.objective = info.objective || null;
      c.buying_type = info.buying_type || null;
      c.budget_type = info.daily_budget != null ? 'CBO (budget at campaign)' : 'ABO (budget at ad-set)';
      c.likely_advantage_plus = /SMART|AUTOMATED|GUIDED/i.test(String(info.smart_promotion_type || '')) || undefined;
    }
    c.ad_set_count = adsetCountByCamp[c.name] ?? null;
  }
  // Placement breakdown (where spend/results come from).
  const placement_breakdown = (placements.data || []).map((r: any) => ({
    placement: r.publisher_platform || 'unknown',
    spend: r2(num(r.spend)),
    purchases: purchasesOf(r),
  })).sort((a: any, b: any) => b.spend - a.spend);
  // Top 15 ads by spend — enough for the coach to spot winners/fatigue without
  // flooding the prompt. Sorted so the biggest spenders are first.
  const ads_7d = (adsWeek.data || []).map(shapeAd).sort((a: any, b: any) => b.spend - a.spend).slice(0, 15);
  const acc = (ydayAccount.data || [])[0] || {};

  // Real revenue over the last 7 ad-days (deduped per stripe_session_id — the
  // 2-pack stamps the full total on both rows, so count each session once).
  const dayStart = startOfTzDay(AD_TZ, -7).toISOString();
  const dayEnd = startOfTzDay(AD_TZ, 0).toISOString();
  let real_orders = 0, real_revenue = 0;
  try {
    const { data: paidRows } = await supabase
      .from('songs').select('stripe_session_id, amount_paid')
      .eq('paid', true).gte('paid_at', dayStart).lt('paid_at', dayEnd)
      .eq('platform', RQC_PLATFORM).not('stripe_session_id', 'is', null);
    const perSession = new Map<string, number>();
    for (const r of (paidRows || [])) {
      const sid = r.stripe_session_id as string; const amt = num(r.amount_paid);
      if (!perSession.has(sid) || amt > (perSession.get(sid) as number)) perSession.set(sid, amt);
    }
    real_orders = perSession.size;
    real_revenue = r2([...perSession.values()].reduce((a, b) => a + b, 0));
  } catch (_e) { /* revenue cross-check is best-effort; coach still works on Meta data */ }

  // 30-day real-order baseline (same dedupe) for a longer ROAS/profit view.
  let orders_30d = 0, revenue_30d = 0;
  try {
    const { data: rows30 } = await supabase
      .from('songs').select('stripe_session_id, amount_paid')
      .eq('paid', true).gte('paid_at', startOfTzDay(AD_TZ, -30).toISOString()).lt('paid_at', dayEnd)
      .eq('platform', RQC_PLATFORM).not('stripe_session_id', 'is', null);
    const per30 = new Map<string, number>();
    for (const r of (rows30 || [])) { const sid = r.stripe_session_id as string; const amt = num(r.amount_paid); if (!per30.has(sid) || amt > (per30.get(sid) as number)) per30.set(sid, amt); }
    orders_30d = per30.size;
    revenue_30d = r2([...per30.values()].reduce((a, b) => a + b, 0));
  } catch (_e) { /* best-effort */ }

  const spend_7d = r2(num(acc.spend));
  const acc30 = (month.data || [])[0] || {};
  const spend_30d = r2(num(acc30.spend));
  const accPrev = (prevAccount.data || [])[0] || {};
  return {
    window: 'Primary window is last 7 days; also included: 30-day baseline and the prior 7 days (days 8-14) for TREND. All in the ad-account day, Asia/Manila.',
    account_7d: { spend: spend_7d, ctr: r2(num(acc.ctr)), cpm: r2(num(acc.cpm)), frequency: r2(num(acc.frequency)), meta_purchases: purchasesOf(acc) },
    account_prev_7d: { spend: r2(num(accPrev.spend)), ctr: r2(num(accPrev.ctr)), cpm: r2(num(accPrev.cpm)), frequency: r2(num(accPrev.frequency)), meta_purchases: purchasesOf(accPrev), note: 'The 7 days BEFORE last_7d (days 8-14 ago). Compare with account_7d for trend direction: rising CPM/frequency + falling purchases = fatigue building; the reverse = improving.' },
    account_30d: { spend: spend_30d, ctr: r2(num(acc30.ctr)), cpm: r2(num(acc30.cpm)), frequency: r2(num(acc30.frequency)), meta_purchases: purchasesOf(acc30), note: '30-day baseline — use it to judge whether the last 7 days are normal, better, or worse than the recent norm.' },
    real_revenue_7d: { orders: real_orders, revenue: real_revenue, real_cpa: real_orders > 0 ? r2(spend_7d / real_orders) : null, real_roas: spend_7d > 0 ? r2(real_revenue / spend_7d) : null, note: 'REAL deduped paid orders from the songs table — trust these over Meta pixel counts, which usually under-count.' },
    real_revenue_30d: { orders: orders_30d, revenue: revenue_30d, real_cpa: orders_30d > 0 ? r2(spend_30d / orders_30d) : null, real_roas: spend_30d > 0 ? r2(revenue_30d / spend_30d) : null, note: '30-day REAL-order baseline for a steadier ROAS read than any single week.' },
    campaigns_7d,
    campaigns_yesterday,
    top_ads_7d: ads_7d,
    ad_sets,
    placement_breakdown,
    structure_note: 'campaigns_7d now carries objective, buying_type, budget_type (CBO vs ABO), ad_set_count and likely_advantage_plus. ad_sets lists each active ad set with budget, optimization_goal, audience/targeting, ads_delivered_7d (how many ads actually GOT SPEND in that ad set over 7d — the real "shots in the machine" count; you already have this, so NEVER tell the owner to count ads-per-ad-set by hand) and its 7d performance. Use it to judge OVER-FRAGMENTATION (many small ad sets each starved of the ~50 conversions/week Meta needs) and whether campaigns are Advantage+ or manual. Note ads_delivered_7d counts ads that delivered, not paused/zero-spend ads. placement_breakdown shows where spend/results land. likely_advantage_plus is a heuristic from smart_promotion_type — if unset, infer from budget_type + audience rather than asserting.',
    ads_note: 'Individual ads (top 15 by spend, last 7d). Use these to judge which CREATIVE is winning or fatiguing — but remember Meta groups visually-similar ads under one Entity ID, and purchases here are Meta pixel counts (real order total is in real_revenue_7d). Each campaign in campaigns_7d also carries trend_prev_7d (its numbers from days 8-14) so you can see direction, not just a snapshot.',
  };
}

// Fetch the actual creative thumbnails for the top ads so the coach can SEE the
// ads (judge hooks, visual diversity, look-alike creatives). Small thumbnails →
// tiny vision cost. Fully fail-soft: any ad that can't be fetched is skipped, and
// a total failure just means the coach answers from numbers alone.
async function fetchTopAdThumbs(topAds: any[], max = 5): Promise<Array<{ label: string; media_type: string; b64: string }>> {
  const ads = (topAds || []).filter((a) => a && a.id).slice(0, max);
  if (!ads.length) return [];
  let creativeMap: any = {};
  try {
    creativeMap = await metaGet('', { ids: ads.map((a) => a.id).join(','), fields: 'creative{thumbnail_url,image_url}' });
  } catch (_e) { return []; }
  const out: Array<{ label: string; media_type: string; b64: string }> = [];
  for (const a of ads) {
    const cr = creativeMap?.[a.id]?.creative || {};
    const url = cr.thumbnail_url || cr.image_url;
    if (!url) continue;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!/^image\/(jpeg|png|gif|webp)$/.test(ct)) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 1_500_000 || buf.length === 0) continue; // guard huge/empty
      out.push({ label: a.ad || 'ad', media_type: ct, b64: encodeBase64(buf) });
    } catch (_e) { /* skip this ad, keep the rest */ }
  }
  return out;
}

// The top-spending ad's full creative image URL — the reference for "make a
// variation of my winning ad." Falls back to the thumbnail. Null on any failure.
async function topAdImageUrl(): Promise<{ url: string | null; adName: string | null }> {
  try {
    const acctPath = `${META_AD_ACCOUNT_ID}/insights`;
    const res = await metaGet(acctPath, { level: 'ad', date_preset: 'last_7d', fields: 'ad_id,ad_name,spend', limit: '50' });
    const top = (res.data || []).map((r: any) => ({ id: r.ad_id, name: r.ad_name, spend: num(r.spend) })).sort((a: any, b: any) => b.spend - a.spend)[0];
    if (!top?.id) return { url: null, adName: null };
    const cr = await metaGet('', { ids: top.id, fields: 'creative{image_url,thumbnail_url}' });
    const c = cr?.[top.id]?.creative || {};
    return { url: c.image_url || c.thumbnail_url || null, adName: top.name || null };
  } catch { return { url: null, adName: null }; }
}

// Turn the owner's ad idea into ONE strong, on-brand, TEXT-FREE image prompt
// (copy is typeset later — baked AI text is rejected slop). Cheap Haiku call;
// falls back to the raw concept if it fails.
async function craftImagePrompt(concept: string, isVariation: boolean): Promise<string> {
  if (!ANTHROPIC_API_KEY) return concept;
  const sys = `Turn the user's ad idea into ONE vivid image-generation prompt for a Meta ad for "Regalos Que Cantan" — personalized Spanish songs gifted to US-Hispanic family/loved ones (~$30). Apply ALL of these craft rules:\n${CREATIVE_CRAFT}\nVertical 2:3, one strong focal subject, cinematic natural light.${isVariation ? ' This is a fresh variation inspired by a provided reference ad — keep the same energy and composition family but make it a genuinely new take, not a copy.' : ''} Return ONLY the final prompt text, no preamble or quotes.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: EXTRACT_MODEL, max_tokens: 400, system: sys, messages: [{ role: 'user', content: concept.slice(0, 1200) }] }),
    });
    if (!res.ok) return concept;
    const data = await res.json();
    const text = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim();
    return text || concept;
  } catch { return concept; }
}

// ---------------------------------------------------------------------------
// The coach persona. The brain (mechanics) is appended below at call time.
// ---------------------------------------------------------------------------
const COACH_SYSTEM = `You are a world-class Meta ads coach for "Regalos Que Cantan", a US-Hispanic ecommerce brand selling personalized Spanish songs (~$25-40 order). You advise the NON-TECHNICAL owner directly.

Your job is to make the owner a better advertiser AND tell them the highest-leverage move right now — grounded in how Meta ACTUALLY delivers ads today, not generic tips.

How you operate:
- You never change the ad ACCOUNT yourself (budgets, pausing) — you hand the owner a specific move ("raise Corrido 6/26 from $120 to $180/day") to apply in Meta Ads Manager. Be concrete and ranked.
- YOU CREATE AD IMAGES YOURSELF using the generate_ad_image tool, as the CREATIVE DIRECTOR. When the owner asks you to make/create an ad — even vaguely ("make me an ad", "create something") — do NOT ask them for direction and do NOT ask which occasion or angle to use. Decide EVERYTHING yourself: pick the highest-leverage occasion/angle from the owner's current promo push (in the business section above) and what the account needs (a missing door, a fatiguing concept to replace), then write the exact text-free image prompt yourself (a real Latino/Mexican human moment, ONE emotion, photoreal, NO text/words/logos on the image — copy is typeset separately) AND write ALL the Spanish ad copy the tool needs: a short punchy headline (1-2 lines, each roughly <=16 characters), an accent word to highlight, an emotional subheadline, a CTA, a price, and pick a template (default "song"; use "poster" for a bold promo). Weave in ONE real proof point from the offer (e.g. "Escúchala GRATIS antes de pagar", "Lista en ~3 minutos"). Then call the tool — it returns a FINISHED ad (photo + headline + subhead + CTA typeset on-brand), not just a photo. After it generates, in one or two lines tell them WHAT you chose and WHY, and offer to try a different occasion/angle/template if they'd like. Only ask a clarifying question if the request is genuinely contradictory — never just to get direction you could decide yourself. ONE finished ad per turn (hard limit — pitch the next concept in words and offer to build it). Set variation_of_winner=true only when a fresh take on the current top ad is the right move. Never say you can't create images.
- For substantive recommendations, lead with the MECHANIC then the move — explain the WHY (how Meta delivers) before the WHAT; that's what separates you from generic AI. For a quick factual question, just answer it directly.
- Judge on REAL cost-per-sale and PROFIT, not vanity metrics. The real paid-order numbers beat Meta's pixel count; trust them and say so.
- Respect the confidence tags in the mechanics below: assert what's [VERIFIED], recommend [CONSENSUS] directionally, present [DEBATE] as an option with its tradeoff, and correct a [MYTH] if the owner repeats one.
- The LIVE account data OUTRANKS the doc. If the numbers disagree with a principle, trust the numbers and say the principle may not apply here.
- Never invent a precise benchmark to sound smart ("your hook rate should be 34%"). Say what's true: "the first 2-3 seconds likely aren't stopping the scroll."
- MATCH LENGTH TO THE QUESTION. This is important. A simple, narrow question ("which ad should I kill?", "what's my ROAS?", "how many ad sets do I have?") gets a SHORT, direct answer — the answer plus at most one line of why, a few sentences total. Reserve the fuller mechanic-and-teaching treatment for strategic or open questions ("is my structure right?", "what should I test?", "why is this dying?") or when the owner asks for more. Teach when it genuinely adds value, not on every turn. Never pad or repeat yourself; if one line is the honest, complete answer, give one line. Length should track the weight of the question, not be uniform. Plain language, warm and direct.
- FORMATTING: write in clean, plain text. Do NOT use markdown — no ** or __ for bold, no ## headers, no asterisk bullets. The owner reads this in a plain chat bubble, so any * or # shows up as literal clutter. For lists use a simple dash "-" or "1." ; for emphasis rely on word choice and short punchy sentences, not symbols. A section label can just be a short line of normal text.
- Use the TREND data: the snapshot has account_7d vs account_prev_7d vs account_30d, and each campaign's trend_prev_7d. Judge direction (improving vs fatiguing), not just today's snapshot. One week is a signal; the 30-day baseline says whether it's normal.
- You see: campaign + ad-SET + top-15 ad-level numbers, each campaign's type (objective, CBO vs ABO, Advantage+ vs manual, ad-set count), ad-set budgets + optimization goal + audience/targeting, a placement breakdown, the real creative thumbnails, real paid orders, and 7d/prior-7d/30d trends. So you CAN now judge structure and over-fragmentation directly. You still do NOT see: audience-overlap analysis, granular dayparting, or history beyond ~30 days. When a question needs something you can't see, say so plainly instead of guessing.`;

// Raw Anthropic Messages call with retry — returns the full response JSON so the
// caller can read text AND tool_use blocks.
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

// ---------------------------------------------------------------------------
// CREATIVE CRAFT — the ad-creation playbook, distilled from the Meta Algorithm
// Brain (verified mechanics) + the owner's hard creative rules. Injected into
// every generation step so the ads APPLY what the brain knows, instead of the
// model free-styling. This is the anti-slop contract for CREATION.
// ---------------------------------------------------------------------------
const CREATIVE_CRAFT = `AD CREATION CRAFT RULES (apply ALL of these to every ad you create):
1. HOOK AT THUMBNAIL SIZE: the photo must stop a scroll seen small on a phone. ONE strong focal human moment, face(s) large in frame, emotion instantly legible (tears, laughter, an embrace, a hand over the heart). No wide busy scenes where the emotion is tiny.
2. AUTHENTIC REPRESENTATION (Nielsen: 63% of Hispanics buy more from brands showing "people like them"): real Mexican/Latino people and culturally specific moments — the abuela in her kitchen, a quinceañera, a serenata, a rancho sunset, a family asado. Core buyers are adults 30-40; multigenerational scenes work. Dignified, never stereotyped, never generic stock-diverse.
3. CANDID BEATS PERFECT: warm natural light, slightly imperfect real-home settings. Overly polished stock-photo perfection reads as an ad and gets scrolled.
4. ONE emotion + ONE occasion + ONE offer + ONE proof point per ad. Never cram.
5. ENTITY-ID DIVERSITY: the new ad must be VISUALLY distinct from the account's current top ads (different setting, palette, composition, number of people) — Meta groups look-alikes as one ad, so a near-duplicate adds nothing.
6. PHOTO IS TEXT-FREE: no words, letters, logos, signs, phone-screen text anywhere in the image. Copy is typeset by the design layer.
7. COPY CRAFT (Spanish): ONE short punchy headline — the verified typography law is ONE large headline (2-5 words is ideal) plus AT MOST three short benefit lines; oversized type because everyone is on a phone. Headline content that VERIFIABLY wins: a clear offer/price frame, urgency/newness, or a bold claim / curiosity / confession — NOT vague emotional lifestyle lines ("El regalo perfecto" loses; "Le hice una canción" or "Solo $29" wins). Include ONE real proof point (Escúchala GRATIS antes de pagar / Lista en ~3 minutos / Con su nombre).
8. NO AI TELLS: hands with correct fingers, natural eyes, no warped faces, no floating objects, no gibberish textures.
9. LO-FI BEATS POLISH (measured: 42% of top-spending Meta ads are deliberately lo-fi; an ugly-vs-polished head-to-head measured ~+30% action intent for lo-fi; Meta itself ranks lo-fi among top performers): the photo should read like something a real person shot — phone-camera realism, natural imperfect light, real home/backyard/kitchen settings, cluttered-real over staged-perfect. Over-designed "beautiful ad" polish triggers people's subconscious ad-blindness and gets scrolled.
10. NO LOGO on the creative — the page's profile logo already shows beside every ad; a logo inside the image just makes it read as an ad. Information hierarchy ALWAYS beats brand-guideline prettiness.
11. TEMPLATE CHOICE BY VERIFIED ARCHETYPE: "native" (lo-fi caption chips on an organic-feeling photo) = default for NEW cold-audience concepts — it's the ad-blindness bypass. "poster" (bold offer-first promo) = the proven SCALE format (offer-first banners over-index on both hit rate and spend at $1.3B scale — and it is this account's own winning style). "bigtype" (huge text-forward editorial split) = message-clarity plays and promos. "song" (branded keepsake look with player chip) = warm retargeting/brand moments, use sparingly. "elegant" = almost never (over-designed).`;

// Vision QC gate — a second model LOOKS at the generated photo and grades it
// against the craft rules before we typeset and ship it. Returns pass/fail with
// issues and a corrected prompt for one retry. Fail-soft: QC errors = pass.
async function qcAdPhoto(photo: Uint8Array, intent: string): Promise<{ pass: boolean; issues: string; fixed_prompt: string }> {
  try {
    const media = photo[0] === 0x89 && photo[1] === 0x50 ? 'image/png' : 'image/jpeg';
    const data = await anthropicRaw({
      model: EXTRACT_MODEL, max_tokens: 500,
      system: `You are the creative QC gate for Meta ads for a US-Hispanic personalized-song brand. Judge the attached AI-generated ad photo STRICTLY against this checklist:\n${CREATIVE_CRAFT}\n\nThe intended concept was: "${intent}".\nFail it if ANY of these is true: people don't read as authentically Latino/Hispanic; the emotion is not instantly legible at thumbnail size; there is ANY text/letters/logos baked into the image; visible AI artifacts (wrong fingers, warped faces, dead eyes, floating objects); the scene is generic stock rather than a culturally specific moment. Be strict — a mediocre photo wastes ad spend.\nReturn ONLY minified JSON: {"pass":true|false,"issues":"one short line","fixed_prompt":"if fail: a corrected full image prompt that fixes the issues, else empty string"}`,
      messages: [{ role: 'user', content: [ { type: 'image', source: { type: 'base64', media_type: media, data: encodeBase64(photo) } }, { type: 'text', text: 'QC this ad photo.' } ] }],
    });
    const m = textOf(data).match(/\{[\s\S]*\}/);
    if (!m) return { pass: true, issues: '', fixed_prompt: '' };
    const j = JSON.parse(m[0]);
    return { pass: !!j.pass, issues: String(j.issues || ''), fixed_prompt: String(j.fixed_prompt || '') };
  } catch { return { pass: true, issues: '', fixed_prompt: '' }; }
}

// Generate a FINISHED ad: text-free photo (Kie) → VISION QC (regenerate once with
// a corrected prompt if it fails) → typeset design layer (renderAd: headline,
// subhead, CTA, price on-brand). Returns the public URL + an honest QC note.
async function generateAdImage(admin: any, prompt: string, refUrl: string, copy?: any, startedAt?: number): Promise<{ url: string | null; qcNote: string }> {
  let photo = refUrl ? await kieEditBytes(prompt, refUrl) : await kiePhotoBytes(prompt);
  if (!photo) return { url: null, qcNote: 'photo generation failed' };
  // QC gate: grade the photo; on fail, regenerate ONCE with the corrected prompt —
  // but only if there's runtime budget left (a retry adds up to ~100s; past ~60s
  // elapsed we'd risk blowing the edge function's execution limit, so we ship the
  // first take with an honest note instead of dying with no ad at all).
  const canRetry = !startedAt || (Date.now() - startedAt) < 60_000;
  let qcNote = 'passed QC';
  const qc1 = await qcAdPhoto(photo, String(copy?.concept_label || prompt).slice(0, 200));
  if (!qc1.pass && qc1.fixed_prompt && canRetry) {
    const retry = refUrl ? await kieEditBytes(qc1.fixed_prompt, refUrl) : await kiePhotoBytes(qc1.fixed_prompt);
    if (retry) {
      const qc2 = await qcAdPhoto(retry, String(copy?.concept_label || prompt).slice(0, 200));
      photo = retry; // corrected attempt is the better bet either way
      qcNote = qc2.pass ? 'failed first QC, regenerated and passed' : `regenerated once; remaining concern: ${qc2.issues || qc1.issues}`;
    } else {
      qcNote = `QC flagged: ${qc1.issues} (retry generation failed, shipped first take)`;
    }
  } else if (!qc1.pass) {
    qcNote = `QC flagged: ${qc1.issues}`;
  }
  let finalBytes = photo;
  if (copy && Array.isArray(copy.headline_lines) && copy.headline_lines.length) {
    try {
      const rendered = await renderAd({
        imageBytes: photo,
        template: copy.template || 'song',
        headlineLines: copy.headline_lines.slice(0, 3).map((s: any) => String(s)),
        accent: copy.accent_word ? String(copy.accent_word) : undefined,
        sub: copy.subhead ? String(copy.subhead) : undefined,
        cta: copy.cta ? String(copy.cta) : undefined,
        price: copy.price ? String(copy.price) : undefined,
        kicker: copy.kicker ? String(copy.kicker) : undefined,
        feats: Array.isArray(copy.benefit_lines) && copy.benefit_lines.length ? copy.benefit_lines.slice(0, 3).map((s: any) => String(s)) : (Array.isArray(copy.feats) ? copy.feats.slice(0, 3).map((s: any) => String(s)) : undefined),
        player: copy.song_title ? { title: String(copy.song_title) } : undefined,
      });
      if (rendered) finalBytes = rendered; // else keep the text-free photo
    } catch (_e) { /* design layer failed → ship the clean photo */ }
  }
  const path = `ads-coach/${crypto.randomUUID()}.png`;
  const { error: upErr } = await admin.storage.from(IMG_BUCKET).upload(path, finalBytes, { contentType: 'image/png', upsert: false });
  if (upErr) { console.warn('[ads-coach] upload failed:', upErr.message); return { url: null, qcNote: 'upload failed' }; }
  // creative-studio is a PUBLIC bucket → a public URL never fails and never expires
  // (a signed URL was the broken link: upload succeeded but the signed URL came back empty).
  const { data: pub } = admin.storage.from(IMG_BUCKET).getPublicUrl(path);
  return { url: pub?.publicUrl || null, qcNote };
}

// The tool the Coach uses to CREATE ads itself — it writes the exact prompt.
const IMAGE_TOOL = {
  name: 'generate_ad_image',
  description: 'Create a FINISHED, ready-to-run ad for the owner: a real text-free photo generated from your prompt, with the headline / subheadline / CTA / price professionally typeset on top (on-brand, no baked-in AI text). Call this when the owner asks you to make/create an ad, or when showing a concept would help. YOU write both the image prompt AND all the Spanish ad copy. The image_prompt must be a real Latino/Mexican human moment, ONE emotion, photoreal, with NO text/words/logos in the photo itself (the copy is added by the design layer). HARD LIMIT: one call per message — pitch further concepts in words and build them next turn.',
  input_schema: {
    type: 'object',
    properties: {
      image_prompt: { type: 'string', description: 'The exact vivid TEXT-FREE image-generation prompt (no words/letters/logos in the photo).' },
      concept_label: { type: 'string', description: 'Short internal name for this concept, e.g. "La reacción de mamá".' },
      template: { type: 'string', enum: ['native', 'poster', 'bigtype', 'song', 'elegant'], description: 'Pick by verified archetype: "native" = lo-fi caption-chip look on an organic-feeling photo (DEFAULT for new cold-audience concepts — ad-blindness bypass). "poster" = bold offer-first promo, the proven scale format and this account\'s own winning style. "bigtype" = huge text-forward editorial split (message clarity / promos). "song" = branded keepsake look with player chip (warm retargeting, sparingly). "elegant" = almost never.' },
      headline_lines: { type: 'array', items: { type: 'string' }, description: '1-2 SHORT Spanish headline lines set LARGE. Total headline ideally 2-5 punchy words (verified typography law), <=16 chars per line. e.g. ["Le hice una", "canción a mamá"] or ["Solo $29"].' },
      accent_word: { type: 'string', description: 'One word from the headline to highlight in gold/italic (optional), e.g. "canción".' },
      subhead: { type: 'string', description: 'One short emotional Spanish subheadline (used by song/elegant/native), e.g. "Y no pudo aguantar las lágrimas".' },
      benefit_lines: { type: 'array', items: { type: 'string' }, description: 'Up to 3 SHORT Spanish benefit/proof lines (verified law: max three) shown as check-lines on bigtype/song, e.g. ["Escúchala gratis antes de pagar","Lista en 3 minutos","Con su nombre"].' },
      cta: { type: 'string', description: 'Short Spanish call to action, e.g. "Créala ahora" or "Escúchala gratis".' },
      price: { type: 'string', description: 'Price badge text. song/elegant: "Solo $29". poster: "$29".' },
      song_title: { type: 'string', description: 'Optional song title for the now-playing chip on the song template, e.g. "Mi Reina".' },
      variation_of_winner: { type: 'boolean', description: 'True to base the photo on the current top-spending ad as a reference (a fresh take on what already works).' },
      why_it_wins: { type: 'string', description: 'REQUIRED reasoning: which verified mechanic this ad exploits (e.g. opens a new Entity-ID door the account lacks; authentic representation per Nielsen; emotion-first hook legible at thumbnail size) — one or two sentences.' },
      distinct_from: { type: 'string', description: 'One line naming how this is VISUALLY distinct from the account\'s current top ads (different setting/palette/composition/subjects), so Meta treats it as a genuinely new ad.' },
    },
    required: ['image_prompt', 'concept_label', 'headline_lines', 'why_it_wins', 'distinct_from'],
  },
};

// Chat runner WITH tool use, so the Coach can generate ad images itself. Returns
// the final text plus any images it created. Fail-soft on generation.
async function runChatWithTools(system: string, convo: any[], admin: any): Promise<{ text: string; images: string[]; made: any[] }> {
  const images: string[] = [];
  const made: any[] = []; // every finished ad built this turn (for the gallery)
  const startedAt = Date.now();
  // Hard cap: ONE finished ad per request. Building two stacks photo-gen + QC +
  // design-render twice into one invocation and blows the edge function's
  // execution budget (the failure the owner hit). The Coach offers the next ad
  // as a follow-up turn instead.
  let built = 0;
  const messages = convo.map((m) => ({ role: m.role, content: m.content }));
  for (let round = 0; round < 3; round++) {
    const data = await anthropicRaw({ model: MODEL, max_tokens: 1800, system, tools: [IMAGE_TOOL], messages });
    const content = data?.content || [];
    const toolUses = content.filter((c: any) => c.type === 'tool_use');
    if (!toolUses.length) return { text: textOf(data), images, made };
    // Record the assistant's tool-use turn, then run the tools and feed results back.
    messages.push({ role: 'assistant', content });
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      if (tu.name === 'generate_ad_image' && KIE_IMAGE_ENABLED) {
        if (built >= 1) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Build limit: ONE finished ad per message (each build is expensive and slow). Present the ad you already built, describe this second concept in words, and tell the owner to say "build it" to get it next.', is_error: true });
          continue;
        }
        built++;
        const inp = tu.input || {};
        let refUrl = '';
        if (inp.variation_of_winner) { const top = await topAdImageUrl(); refUrl = top.url || ''; }
        const { url, qcNote } = await generateAdImage(admin, String(inp.image_prompt || '').slice(0, 3800), refUrl, inp, startedAt);
        if (url) {
          images.push(url);
          made.push({ url, concept: String(inp.concept_label || '').slice(0, 200), why_it_wins: String(inp.why_it_wins || '').slice(0, 500), distinct_from: String(inp.distinct_from || '').slice(0, 300), ad_copy: { template: inp.template, headline_lines: inp.headline_lines, accent_word: inp.accent_word, subhead: inp.subhead, cta: inp.cta, price: inp.price, song_title: inp.song_title }, qc_note: qcNote });
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Generated the finished ad "${inp.concept_label || 'concept'}" (headline + copy typeset) and showed it to the owner. Vision QC result: ${qcNote}. If QC flagged a remaining concern, tell the owner honestly in one line.` });
        }
        else toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Image generation failed this time (${qcNote}).`, is_error: true });
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: KIE_IMAGE_ENABLED ? 'Unknown tool.' : 'Image generation is not configured.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return { text: 'I created the image(s) above.', images, made };
}

// Pull the single most concrete recommendation out of a coach reply, cheaply,
// with Haiku — so the track record logs real calls, not chit-chat. Returns null
// if the reply made no concrete recommendation. Fail-soft everywhere.
const EXTRACT_MODEL = Deno.env.get('ADS_COACH_EXTRACT_MODEL') || 'claude-haiku-4-5-20251001';
async function extractRecommendation(reply: string): Promise<any> {
  if (!ANTHROPIC_API_KEY) return null;
  const sys = `Read this Meta ads coach message and extract its SINGLE most important concrete recommendation, if any. Return ONLY minified JSON: {"recommendation":"","rationale":"","target_campaign":""}. "recommendation" = the specific action the owner should take (e.g. "Raise Corrido 6/26 budget $120→$180/day"); use an EMPTY string if the message gave no concrete, actionable move (pure explanation/teaching counts as none). Keep every field short.`;
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

// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // --- SELF-TEST (token-gated, before the admin gate): proves the ENTIRE real
    // pipeline works after a deploy — Meta pull → ad thumbnails → one full ad
    // build (photo → vision QC → typeset → upload) → fetch-back of the finished
    // file. "It boots" is not "it works"; this is the working check. Spends a few
    // cents per run. Off unless the ADS_COACH_TEST_TOKEN secret is set; token is
    // long+random and grants ONLY this test (no account data beyond counts).
    const TEST_TOKEN = Deno.env.get('ADS_COACH_TEST_TOKEN') || '';
    if (body.action === 'selftest') {
      if (!TEST_TOKEN || body.token !== TEST_TOKEN) return json({ success: false, error: 'not found' }, 404);
      const report: any = {}; const t = (s: number) => Date.now() - s;
      try {
        let s = Date.now();
        const ctx = await gatherAccountContext(admin);
        report.meta_pull = { ok: true, ms: t(s), campaigns: ctx.campaigns_7d?.length ?? 0, ad_sets: ctx.ad_sets?.length ?? 0, top_ads: ctx.top_ads_7d?.length ?? 0, real_orders_7d: ctx.real_revenue_7d?.orders ?? null };
        s = Date.now();
        const thumbs = await fetchTopAdThumbs(ctx.top_ads_7d || [], 3);
        report.thumbnails = { ok: thumbs.length > 0, ms: t(s), fetched: thumbs.length };
        s = Date.now();
        const testPrompt = String(body.prompt || 'Photorealistic candid moment in a warm Mexican-American family kitchen: a woman in her 60s (abuela) listening to a phone held by her adult daughter, tears of joy, string lights, golden hour window light. No text anywhere.');
        const testCopy = (body.copy && typeof body.copy === 'object') ? { concept_label: 'selftest', ...body.copy } : { concept_label: 'selftest', template: 'song', headline_lines: ['Prueba del', 'sistema'], accent_word: 'sistema', subhead: 'Verificación automática', cta: 'Ignorar', price: 'Solo $29' };
        const { url, qcNote } = await generateAdImage(admin, testPrompt, '', testCopy, Date.now());
        report.ad_build = { ok: !!url, ms: t(s), qc: qcNote, url };
        if (url) {
          s = Date.now();
          const head = await fetch(url);
          report.fetch_back = { ok: head.ok, ms: t(s), status: head.status, bytes: Number(head.headers.get('content-length')) || null };
        } else report.fetch_back = { ok: false, skipped: 'no url' };
        const allOk = report.meta_pull.ok && report.ad_build.ok && report.fetch_back.ok;
        return json({ success: allOk, report });
      } catch (e: any) {
        report.crashed = String(e?.message || e).slice(0, 300);
        return json({ success: false, report }, 200);
      }
    }

    // --- Admin gate (same as cos-assistant) ---
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow || roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    const action = body.action || 'chat';
    // Which workspace this request belongs to: the main coach chat, or the Ad
    // Factory (dedicated ad-building tab with its own conversation).
    const thread = body.thread === 'factory' ? 'factory' : 'coach';

    // --- MEMORY: load the past conversation + track record (cross-session) ---
    if (action === 'history') {
      const [{ data: msgs }, { data: calls }] = await Promise.all([
        admin.from('ads_coach_messages').select('role, content, created_at').eq('thread', thread).order('created_at', { ascending: true }).limit(60),
        admin.from('ads_coach_calls').select('*').order('created_at', { ascending: false }).limit(30),
      ]);
      return json({ success: true, messages: msgs || [], calls: calls || [] });
    }

    // --- GALLERY: every finished ad the Coach has built ---
    if (action === 'list_ads') {
      const { data: ads } = await admin.from('ads_coach_ads').select('*').order('created_at', { ascending: false }).limit(60);
      return json({ success: true, ads: ads || [] });
    }

    // --- TRACK RECORD: owner marks a past recommendation right/wrong/skip ---
    if (action === 'resolve_call') {
      const id = body.id; const verdict = body.verdict;
      if (!id || !['correct', 'wrong', 'dismissed'].includes(verdict)) return json({ success: false, error: 'bad resolve' }, 400);
      await admin.from('ads_coach_calls').update({ status: verdict, resolved_at: new Date().toISOString() }).eq('id', id);
      const { data: calls } = await admin.from('ads_coach_calls').select('*').order('created_at', { ascending: false }).limit(30);
      return json({ success: true, calls: calls || [] });
    }

    // --- IMAGE GENERATION: make a text-free ad photo from the owner's idea, or a
    // fresh variation of the current top-spending ad. Reuses the Creative Studio
    // GPT-Image-2 pipeline. Gated by an explicit owner request (this action). ---
    if (action === 'generate_image') {
      if (!KIE_IMAGE_ENABLED) return json({ success: false, error: 'Image generation needs the KIE_API_KEY secret set on the project.' }, 200);
      const concept = String(body.concept || '').trim();
      if (!concept) return json({ success: false, error: 'Describe the ad image you want.' }, 400);
      const count = Math.min(3, Math.max(1, parseInt(String(body.count)) || 1));
      const wantVariation = !!body.variation;

      let refUrl = ''; let refAdName: string | null = null;
      if (wantVariation) {
        const top = await topAdImageUrl();
        refUrl = top.url || ''; refAdName = top.adName;
      }
      const prompt = await craftImagePrompt(concept, wantVariation && !!refUrl);

      // Same QC-gated pipeline as the chat path (concept-only: no copy → no typeset).
      const results = await Promise.all(Array.from({ length: count }, () =>
        generateAdImage(admin, prompt, refUrl).then((r) => r.url)));
      const images = results.filter(Boolean) as string[];
      if (!images.length) return json({ success: false, error: 'The image generator returned nothing — try again or tweak the description.' }, 200);
      return json({ success: true, images, prompt_used: prompt, based_on_winner: refUrl ? (refAdName || true) : false });
    }

    // --- CHAT (default) ---
    if (!META_ACCESS_TOKEN) return json({ success: false, error: 'META_ACCESS_TOKEN not set — the coach needs the Meta token to read your account.' }, 200);
    // Accept the browser-held conversation. Keep the last 20 turns to bound tokens.
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const convo = incoming
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!convo.length || convo[convo.length - 1].role !== 'user') {
      return json({ success: false, error: 'Ask the coach a question.' }, 400);
    }
    // Keep the original question text before vision may replace it with image blocks.
    const userQuestion = String(convo[convo.length - 1].content);

    // DOCUMENT UPLOAD: the owner can attach a file (a PDF, or plain/pasted text —
    // e.g. an agency proposal, a Meta guide, a strategy doc, a P&L) so the coach
    // reads and analyzes the ACTUAL document. Sent as its own top-level field
    // (NOT smuggled through messages — the convo filter above drops non-string
    // content). Claude reads PDFs natively (text + layout), no beta header needed.
    // The doc rides only on the turn it's attached; the coach's analysis then
    // lives on as text in the saved reply, so we never re-send the file.
    const docBlocks: any[] = [];
    let docLabel = '';
    const doc = body.document;
    if (doc && typeof doc === 'object' && typeof doc.data === 'string' && doc.data.trim()) {
      const dname = String(doc.name || 'document').slice(0, 160);
      if (doc.kind === 'pdf') {
        // base64 must carry no whitespace/newlines
        const b64 = doc.data.replace(/\s+/g, '');
        docBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
        docLabel = `The owner attached a PDF named "${dname}". Read the whole document above and use it to answer their question. If they didn't ask a specific question, summarize what it says and what it means for their Meta ads.`;
      } else {
        // plain text / pasted document (cap to keep the turn bounded)
        const text = doc.data.slice(0, 200000);
        docBlocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: text } });
        docLabel = `The owner attached a document named "${dname}"; its full text is above. Use it to answer. If they didn't ask a specific question, summarize what it says and what it means for their Meta ads.`;
      }
    }

    // Pull the live account snapshot (best-effort — if Meta hiccups, still answer
    // with a clear note rather than failing the whole turn).
    let context: any = null, contextErr = '';
    try { context = await gatherAccountContext(admin); }
    catch (e: any) { contextErr = String(e?.message || e).slice(0, 200); }

    const contextBlock = context
      ? `LIVE ACCOUNT SNAPSHOT (pulled just now — reason from THIS, it outranks the doc):\n${JSON.stringify(context, null, 2)}`
      : `LIVE ACCOUNT SNAPSHOT: unavailable this turn (${contextErr || 'no data'}). Tell the owner you couldn't pull fresh numbers and answer on principle, clearly flagged.`;

    // Pull the owner's live seasonal push (same source the creative generators use)
    // so the coach's creative advice knows what's being promoted right now.
    let promoNotes = '';
    try {
      const { data: cfg } = await admin.from('creative_studio_config').select('promo_notes').eq('id', 1).single();
      promoNotes = cfg?.promo_notes || '';
    } catch (_e) { /* optional */ }

    const system = `${COACH_SYSTEM}

WHAT THIS BUSINESS SELLS (so your creative + strategy advice fits the real product, not generic DTC):
${brandContext(promoNotes)}

${contextBlock}

${metaBrainContext('HOW META DELIVERS — reason with these mechanics (respect the confidence tags):')}

${CREATIVE_CRAFT}

When you call generate_ad_image, your image_prompt and copy MUST apply every craft rule above, and why_it_wins / distinct_from must name the real mechanic — never a vague "it's engaging". Check the top_ads_7d thumbnails you were shown and make the new ad visually DIFFERENT from them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL OUTPUT RULES — these override the formatting of everything above. Obey them every single time:
1. PLAIN TEXT ONLY. Absolutely no markdown. Never write ** or __ (they show as literal asterisks in the owner's chat), never ## headers (they show as literal #). No bold, no header syntax, no asterisk bullets. For a list use "- " or "1." only. Emphasize with word choice and short sentences, never symbols. The document above uses lots of dashes, CAPS and symbols for YOUR reading — do NOT copy that style into your reply.
2. MATCH LENGTH TO THE QUESTION. A simple/narrow question (which ad to kill, what's my ROAS, how many ad sets) → a few sentences, direct, done. Only go long for genuinely strategic/open questions or when asked. Never pad or repeat. If one line is the complete honest answer, give one line.
3. You CREATE ad images yourself via the generate_ad_image tool — you write the prompt and call it. Never say you can't, and don't defer to a panel.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${thread === 'factory' ? `

AD FACTORY MODE — you are in the dedicated ad-building workspace. This OVERRIDES the "never ask for direction" rule:
- When the owner requests an ad and details that materially change the creative are missing (occasion, who it's for, the angle/emotion, which offer to feature, template preference), ASK FIRST: one single message with your 2-4 sharpest questions, like a real creative director taking a brief. Never ask about things you already know from the promo push or account data, and never interview twice — once they answer (or say "you decide"), BUILD.
- Build ONE finished concept per turn with generate_ad_image (the pipeline is heavy — one build per message is the hard limit), applying every craft rule, with a real why_it_wins.
- After building, present the ad in plain text: the concept name, why it can win (the mechanic), and what to watch when testing it. Then pitch ONE next distinct concept in words and offer to build it — that's how you deliver a portfolio, one turn at a time.
- Quality bar: if a request would produce a weak or duplicate ad (too similar to a running ad, cramming multiple offers, generic stock feel), say so and propose the stronger version instead of quietly building slop.` : ''}`;

    // VISION: attach the actual creative thumbnails of the top ads to the latest
    // question so the coach can SEE the ads (hooks, visual diversity, look-alikes),
    // not just their numbers. Capped at 5, fully fail-soft.
    let sawCreatives = 0;
    let imgBlocks: any[] = [];
    let imgLabel = '';
    if (context?.top_ads_7d?.length) {
      try {
        const thumbs = await fetchTopAdThumbs(context.top_ads_7d, 5);
        if (thumbs.length) {
          sawCreatives = thumbs.length;
          imgBlocks = thumbs.map((t) => ({ type: 'image', source: { type: 'base64', media_type: t.media_type, data: t.b64 } }));
          imgLabel = `The images above are the ACTUAL creative thumbnails of your current top ads by spend, in order: ${thumbs.map((t, i) => `${i + 1}. ${t.label}`).join('; ')}. Use them to judge the hook/first frame, whether ads are visually too similar (Meta groups look-alikes under one Entity ID), and creative diversity — alongside the numbers in the snapshot.`;
        }
      } catch (_e) { /* vision is a bonus; never fail the answer over it */ }
    }
    // Prepend any attached document + the creative thumbnails to the latest turn,
    // with the question text last. Both are optional and fully fail-soft.
    if (docBlocks.length || imgBlocks.length) {
      const last = convo[convo.length - 1];
      const labels = [docLabel, imgLabel].filter(Boolean).join('\n\n');
      last.content = [...docBlocks, ...imgBlocks, { type: 'text', text: `${labels}\n\n${last.content}` }] as any;
    }

    const { text: reply, images: chatImages, made } = await runChatWithTools(system, convo, admin);

    // MEMORY: persist just this turn (new question + reply) under its thread. The
    // frontend re-sends prior turns each call, so saving only the latest avoids dupes.
    try {
      await admin.from('ads_coach_messages').insert([
        { role: 'user', content: userQuestion.slice(0, 8000), thread },
        { role: 'assistant', content: reply.slice(0, 8000), thread },
      ]);
    } catch (_e) { /* memory is best-effort — never lose the answer over a write */ }

    // GALLERY: every finished ad built this turn goes into ads_coach_ads.
    let ads: any[] | undefined;
    if (made.length) {
      try {
        await admin.from('ads_coach_ads').insert(made);
        const { data } = await admin.from('ads_coach_ads').select('*').order('created_at', { ascending: false }).limit(60);
        ads = data || [];
      } catch (_e) { /* gallery is best-effort */ }
    }

    // TRACK RECORD: log the coach's top concrete recommendation (cheap Haiku
    // extraction) so the owner can grade it later. Coach thread only — in the
    // Factory the "recommendation" IS the ad, already logged above. Fail-soft.
    let calls: any[] = [];
    if (thread === 'coach') {
      try {
        const rec = await extractRecommendation(reply);
        if (rec?.recommendation) {
          await admin.from('ads_coach_calls').insert({
            recommendation: String(rec.recommendation).slice(0, 300),
            rationale: String(rec.rationale || '').slice(0, 400),
            target_campaign: String(rec.target_campaign || '').slice(0, 120),
          });
        }
        const { data } = await admin.from('ads_coach_calls').select('*').order('created_at', { ascending: false }).limit(30);
        calls = data || [];
      } catch (_e) { /* track record is best-effort */ }
    }

    return json({ success: true, reply, images: chatImages, ads, brain_reviewed: META_BRAIN_LAST_REVIEWED, had_live_data: !!context, saw_creatives: sawCreatives, calls });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});
