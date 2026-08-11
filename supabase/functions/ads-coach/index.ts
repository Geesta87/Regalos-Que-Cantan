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
import { kiePhotoBytes, kieEditBytes, openaiPhotoBytes, KIE_IMAGE_ENABLED, OPENAI_IMAGE_ENABLED } from '../_shared/kie-image.ts';

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

// ---------------------------------------------------------------------------
// META WRITE PATH — publish a Factory-built ad into an EXISTING ad set.
//
// SCOPE (deliberate): creates ADS ONLY, inside ad sets that already exist. It
// never creates campaigns or ad sets, never changes budgets, never enables
// anything. That matches the account strategy — consolidate, so new creative
// goes into existing ad sets as new ads, NOT into new campaigns.
//
// HARD GUARANTEES enforced in CODE (not in a prompt):
//   • status=PAUSED always — it cannot spend until the owner switches it on
//   • the target ad set must be one of the account's real ad sets (validated)
//   • UTM parameters always attached (fixes the account's attribution gap)
//   • text_optimizations / text_translation always OPTED OUT so Meta cannot
//     rewrite or translate the owner's Spanish copy
// ---------------------------------------------------------------------------
const FB_PAGE_ID = Deno.env.get('FB_PAGE_ID') || '950188118177218';
const IG_USER_ID = Deno.env.get('IG_USER_ID') || '17841479696876347';
const AD_UTM_TAGS = 'utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}';

async function metaUploadImage(bytes: Uint8Array): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append('access_token', META_ACCESS_TOKEN!);
    fd.append('filename', new Blob([bytes], { type: 'image/png' }), 'ad.png');
    const res = await fetch(`${META_BASE}/${META_AD_ACCOUNT_ID}/adimages`, { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { console.warn('[ads-coach] adimages failed', JSON.stringify(j).slice(0, 300)); return null; }
    const first: any = Object.values(j?.images || {})[0];
    return first?.hash || null;
  } catch (e) { console.warn('[ads-coach] adimages error', e); return null; }
}

async function metaFormPost(path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: META_ACCESS_TOKEN! });
  const res = await fetch(`${META_BASE}/${path}`, { method: 'POST', body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.error_user_msg || j?.error?.message || JSON.stringify(j).slice(0, 250));
  return j;
}

// Publish one finished ad image into an existing ad set, PAUSED.
async function publishAdToMeta(opts: {
  imageBytes: Uint8Array; adsetId: string; adName: string;
  primaryText: string; headline?: string; description?: string;
  link: string; ctaType?: string;
}): Promise<{ ad_id: string; creative_id: string }> {
  const hash = await metaUploadImage(opts.imageBytes);
  if (!hash) throw new Error('Could not upload the image to Meta.');

  const linkData: any = {
    image_hash: hash,
    link: opts.link,
    message: opts.primaryText,
    call_to_action: { type: opts.ctaType || 'ORDER_NOW', value: { link: opts.link } },
  };
  if (opts.headline) linkData.name = opts.headline;
  if (opts.description) linkData.description = opts.description;

  const creative = await metaFormPost(`${META_AD_ACCOUNT_ID}/adcreatives`, {
    name: `${opts.adName} — creative`.slice(0, 100),
    object_story_spec: JSON.stringify({ page_id: FB_PAGE_ID, instagram_user_id: IG_USER_ID, link_data: linkData }),
    url_tags: AD_UTM_TAGS,
    // Stop Meta rewriting/translating the owner's carefully-written Spanish.
    degrees_of_freedom_spec: JSON.stringify({
      creative_features_spec: {
        text_optimizations: { enroll_status: 'OPT_OUT' },
        text_translation: { enroll_status: 'OPT_OUT' },
      },
    }),
  });
  if (!creative?.id) throw new Error('Meta did not return a creative id.');

  const ad = await metaFormPost(`${META_AD_ACCOUNT_ID}/ads`, {
    name: opts.adName.slice(0, 100),
    adset_id: opts.adsetId,
    creative: JSON.stringify({ creative_id: creative.id }),
    status: 'PAUSED', // HARD RULE — never created live
  });
  if (!ad?.id) throw new Error('Meta did not return an ad id.');
  return { ad_id: ad.id, creative_id: creative.id };
}

// ---------------------------------------------------------------------------
// CAMPAIGN CREATION — owner-approved, always PAUSED.
//
// HARD GUARANTEES enforced in CODE (not in a prompt):
//  • The MODEL CANNOT REACH THIS. There is deliberately no generate_* tool for
//    it — the coach can only recommend a campaign in words. The only path that
//    creates anything is an explicit human click that sends confirm:true.
//  • Campaign AND ad set are created status=PAUSED. Nothing can spend until the
//    owner switches it on in Ads Manager.
//  • The daily budget is clamped to BUDGET_MIN/MAX_USD, so a mistyped number
//    cannot create a $5,000/day campaign.
//  • objective is allow-listed.
//  • Targeting / optimization / attribution are CLONED from one of the account's
//    real ad sets (validated server-side) — never invented by an LLM.
//  • special_ad_categories is always [] (this account runs no special category).
//  • Budget lives on the CAMPAIGN (CBO), matching how this account is run; the
//    ad set therefore carries no budget of its own.
//  • If ad-set creation fails, the just-created campaign is DELETED so a failed
//    attempt can never leave an orphan campaign behind.
// ---------------------------------------------------------------------------
const META_PIXEL_ID = Deno.env.get('META_PIXEL_ID') || '1296066869001492';
const CAMPAIGN_OBJECTIVES = ['OUTCOME_SALES'];
const BUDGET_MIN_USD = 5;
const BUDGET_MAX_USD = Number(Deno.env.get('ADS_COACH_MAX_DAILY_USD') || 150);

async function metaDelete(path: string): Promise<void> {
  try {
    await fetch(`${META_BASE}/${path}`, {
      method: 'POST',
      body: new URLSearchParams({ access_token: META_ACCESS_TOKEN!, _method: 'DELETE' }),
    });
  } catch (_e) { /* best-effort rollback */ }
}

// One of the account's REAL ad sets, used as the settings template. Returning
// null means "not in this account" — callers must refuse rather than invent.
async function fetchAdsetTemplate(adsetId: string): Promise<any | null> {
  const sets = await metaGet(`${META_AD_ACCOUNT_ID}/adsets`, {
    fields: 'id,name,optimization_goal,billing_event,attribution_spec,destination_type,promoted_object,targeting,campaign_id',
    limit: '200',
  });
  return (sets.data || []).find((s: any) => String(s.id) === String(adsetId)) || null;
}

// Meta rejects a few read-only keys that come back on a GET of targeting.
function cleanTargeting(t: any): any {
  const out = { ...(t || {}) };
  for (const k of ['is_whatsapp_destination_ad', 'targeting_optimization', 'brand_safety_content_filter_levels']) delete out[k];
  return out;
}

function budgetCentsOrError(usd: any): { cents?: number; error?: string } {
  const n = Number(usd);
  if (!Number.isFinite(n)) return { error: 'Enter a daily budget in dollars.' };
  if (n < BUDGET_MIN_USD) return { error: `Daily budget must be at least $${BUDGET_MIN_USD}.` };
  if (n > BUDGET_MAX_USD) return { error: `Daily budget is capped at $${BUDGET_MAX_USD}/day here as a safety limit. Raise ADS_COACH_MAX_DAILY_USD if you really want more.` };
  return { cents: Math.round(n * 100) };
}

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
  const [campaignsList, week, yday, ydayAccount, adsWeek, month, prevAccount, prevWeek, adsetsList, adsetWeek, placements, dailyAccount] = await Promise.all([
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
    // DAY-BY-DAY: one row per calendar day for the last 30 days (time_increment=1),
    // so the coach can audit specific days / weekdays vs weekends — instead of only
    // aggregates. This is what lets it answer "what happened last Thursday / Sunday".
    metaGet(acctPath, { level: 'account', date_preset: 'last_30d', time_increment: '1', fields: 'spend,impressions,clicks,ctr,cpm,frequency,actions', limit: '40' }).catch(() => ({ data: [] })),
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

  // 30-day real-order baseline (same dedupe) + PER-DAY real orders (bucketed to the
  // ad-account day so it lines up with Meta's daily spend) so the coach can audit
  // specific days with REAL orders, not just Meta's pixel count.
  let orders_30d = 0, revenue_30d = 0;
  const realByDay: Record<string, { sessions: Map<string, number> }> = {};
  const realByPacificDay: Record<string, Map<string, number>> = {};
  try {
    const { data: rows30 } = await supabase
      .from('songs').select('stripe_session_id, amount_paid, paid_at')
      .eq('paid', true).gte('paid_at', startOfTzDay(AD_TZ, -30).toISOString()).lt('paid_at', dayEnd)
      .eq('platform', RQC_PLATFORM).not('stripe_session_id', 'is', null);
    const per30 = new Map<string, number>();
    for (const r of (rows30 || [])) {
      const sid = r.stripe_session_id as string; const amt = num(r.amount_paid);
      if (!per30.has(sid) || amt > (per30.get(sid) as number)) per30.set(sid, amt);
      // Bucket to the ad-account (Manila) day — pairs with Meta's daily spend so
      // the CPA is exact. Dedupe per session within each day.
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: AD_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.paid_at as string));
      (realByDay[day] ||= { sessions: new Map() });
      const cur = realByDay[day].sessions.get(sid);
      if (cur == null || amt > cur) realByDay[day].sessions.set(sid, amt);
      // ALSO bucket to the owner's TRUE Pacific calendar day (midnight-midnight),
      // which is the honest number for "how did Sunday do" / weekday comparisons.
      const pday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.paid_at as string));
      (realByPacificDay[pday] ||= new Map());
      const pcur = realByPacificDay[pday].get(sid);
      if (pcur == null || amt > pcur) realByPacificDay[pday].set(sid, amt);
    }
    orders_30d = per30.size;
    revenue_30d = r2([...per30.values()].reduce((a, b) => a + b, 0));
  } catch (_e) { /* best-effort */ }

  // DAY-BY-DAY series: merge Meta's per-day metrics with real orders per day, and
  // tag the weekday so the coach can reason about weekends vs weekdays honestly.
  // The ad account bills in Asia/Manila, which is 15-16h AHEAD of the owner's
  // Pacific day: Manila day D runs from Pacific (D-1) 9am to D 9am, i.e. it is
  // essentially the owner's PREVIOUS calendar day. So every row is labeled with
  // the OWNER'S Pacific date + weekday (same convention as media-buyer-daily).
  // Getting this wrong makes the coach call the owner's Sunday a "Monday".
  const backOneDay = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  const daily_last_30d = (dailyAccount.data || []).map((r: any) => {
    const date = r.date_start;
    const rd = date && realByDay[date];
    const realOrders = rd ? rd.sessions.size : 0;
    const realRev = rd ? r2([...rd.sessions.values()].reduce((a, b) => a + b, 0)) : 0;
    const daySpend = r2(num(r.spend));
    const ownerDate = date ? backOneDay(date) : null;
    return {
      owner_date: ownerDate,
      weekday: ownerDate ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${ownerDate}T12:00:00Z`)) : null,
      ad_account_day: date,
      // True midnight-to-midnight Pacific orders for THIS weekday — the honest
      // number for demand/weekday questions (real_orders below is the Manila
      // 9am-9am window, which is what pairs exactly with spend for CPA).
      orders_owner_day: ownerDate && realByPacificDay[ownerDate] ? realByPacificDay[ownerDate].size : null,
      spend: daySpend,
      real_orders: realOrders,
      real_revenue: realRev,
      real_cpa: realOrders > 0 ? r2(daySpend / realOrders) : null,
      real_roas: daySpend > 0 ? r2(realRev / daySpend) : null,
      meta_purchases: purchasesOf(r),
      ctr: r2(num(r.ctr)), cpm: r2(num(r.cpm)), frequency: r2(num(r.frequency)),
    };
  });

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
    daily_last_30d,
    daily_note: 'ONE ROW PER DAY for the last 30 days. IMPORTANT: owner_date/weekday are the OWNER\'S Pacific calendar day — always speak in those terms. (ad_account_day is the raw Meta/Manila billing day, which starts 9am Pacific the PREVIOUS day; spend and orders in a row cover that same window so the CPA is apples-to-apples. Never quote ad_account_day to the owner — calling their Sunday a "Monday" is a real error.) TWO order numbers per row, use the right one: orders_owner_day = true midnight-to-midnight Pacific orders → use for ANY demand/weekday question ("how did Sunday do") and for comparing against weekday_baseline. real_orders = the Manila 9am-9am window, which pairs EXACTLY with that row\'s spend → use only for CPA/ROAS math (real_cpa/real_roas are computed from it). They differ by a few orders; that is expected, not an error. meta_purchases is the pixel count (undercounts). The most recent day is PARTIAL — say so rather than reporting it as a crash.',
    weekday_baseline: {
      note: 'MEASURED baseline of avg REAL orders by the OWNER\'S Pacific weekday (78 days, Father\'s Day week excluded). ALWAYS judge a day against its OWN weekday here, never against yesterday or the week\'s peak — most "the account is crashing" panics are just Monday being Monday.',
      Sat: 46.2, Fri: 41.5, Thu: 41.2, Wed: 37.6, Sun: 37.1, Tue: 36.3, Mon: 32.7,
      spread: 'Saturday runs ~41% above Monday every week — that gap alone moves CPA by several dollars with flat spend.',
    },
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
const COACH_SYSTEM = `You are Max, the Meta Ads Coach — a world-class Meta ads coach for "Regalos Que Cantan", a US-Hispanic ecommerce brand selling personalized Spanish songs (~$25-40 order). Your name is Max; if the owner addresses you by name or asks who you are, that's you. You advise the NON-TECHNICAL owner directly.

Your job is to make the owner a better advertiser AND tell them the highest-leverage move right now — grounded in how Meta ACTUALLY delivers ads today, not generic tips.

How you operate:
- You never change the ad ACCOUNT yourself (budgets, pausing) — you hand the owner a specific move to apply in Meta Ads Manager. Be concrete and ranked.

BUDGET-CHANGE DISCIPLINE (the owner's hard rules — violating these destroys your credibility):
1. NEVER propose a budget change without first computing it as a PERCENTAGE of that campaign's CURRENT daily_budget (it's in the snapshot). The owner moves budgets in ~20% increments, up or down. A "$100 shift" onto a $120/day campaign is +83% and is an unacceptable recommendation. Do the arithmetic BEFORE you write the sentence.
2. When shrinking a large campaign to feed small ones the numbers won't balance in one move — propose WAVES: repeat ~20% steps with a checkpoint after each, not one big reallocation.
3. JUDGE A BUDGET CHANGE AT ~14 DAYS, NOT 7. This account's own history proves it: when Corrido 6/26 went $100→$120, its CPA got WORSE for the first ~9 days (learning phase re-optimizing) and only then recovered to better-than-before. Judging at day 7 would have wrongly killed a working change. Always warn the owner to expect that dip.
4. CHANGE ONE VARIABLE AT A TIME. Never propose cutting one campaign and raising another in the same move — if orders drop, nothing is learned. Isolate.
5. Before recommending SCALING a campaign, check whether it can actually absorb spend: frequency (low/flat ~1.2 = audience headroom; climbing toward 2.5-3 = saturating), budget utilization (is it even spending its current budget?), and whether the campaign has ever run at a higher budget and what happened. If the evidence isn't there, say so instead of assuming.
6. NEVER assume linear scaling in a projection. "Move $X and get Y more orders at the same CPA" is almost always wrong — efficiency usually shifts as spend grows. If you give a number, state the assumption behind it and label it an estimate.

ANALYTICAL METHOD — separating campaign effects from market moves: a campaign's CPA moving is meaningless on its own. ALWAYS compare it to the ACCOUNT's CPA over the SAME window. If both moved together, it's the market (auction/CPM/demand) and the campaign is fine. If the campaign moved and the account didn't, it's the campaign. Express it as a ratio (campaign CPA ÷ account CPA) across periods — that ratio is the real performance signal. Apply this before ever telling the owner a campaign is degrading.
- YOU CREATE AD IMAGES YOURSELF using the generate_ad_image tool, as the CREATIVE DIRECTOR. When the owner asks you to make/create an ad — even vaguely ("make me an ad", "create something") — do NOT ask them for direction and do NOT ask which occasion or angle to use. Decide EVERYTHING yourself: pick the highest-leverage occasion/angle from the owner's current promo push (in the business section above) and what the account needs (a missing door, a fatiguing concept to replace), then write the exact text-free image prompt yourself (a real Latino/Mexican human moment, ONE emotion, photoreal, NO text/words/logos on the image — copy is typeset separately) AND write ALL the Spanish ad copy the tool needs: a short punchy headline (1-2 lines, each roughly <=16 characters), an accent word to highlight, an emotional subheadline, a CTA, a price, and pick a template (default "song"; use "poster" for a bold promo). Weave in ONE real proof point from the offer (e.g. "Escúchala GRATIS antes de pagar", "Lista en ~3 minutos"). Then call the tool — it returns a FINISHED ad (photo + headline + subhead + CTA typeset on-brand), not just a photo. After it generates, in one or two lines tell them WHAT you chose and WHY, and offer to try a different occasion/angle/template if they'd like. Only ask a clarifying question if the request is genuinely contradictory — never just to get direction you could decide yourself. ONE finished ad per turn (hard limit — pitch the next concept in words and offer to build it). Set variation_of_winner=true only when a fresh take on the current top ad is the right move. Never say you can't create images.
- For substantive recommendations, lead with the MECHANIC then the move — explain the WHY (how Meta delivers) before the WHAT; that's what separates you from generic AI. For a quick factual question, just answer it directly.
- Judge on REAL cost-per-sale and PROFIT, not vanity metrics. The real paid-order numbers beat Meta's pixel count; trust them and say so.
- Respect the confidence tags in the mechanics below: assert what's [VERIFIED], recommend [CONSENSUS] directionally, present [DEBATE] as an option with its tradeoff, and correct a [MYTH] if the owner repeats one.
- The LIVE account data OUTRANKS the doc. If the numbers disagree with a principle, trust the numbers and say the principle may not apply here.
- Never invent a precise benchmark to sound smart ("your hook rate should be 34%"). Say what's true: "the first 2-3 seconds likely aren't stopping the scroll."
- MATCH LENGTH TO THE QUESTION. This is important. A simple, narrow question ("which ad should I kill?", "what's my ROAS?", "how many ad sets do I have?") gets a SHORT, direct answer — the answer plus at most one line of why, a few sentences total. Reserve the fuller mechanic-and-teaching treatment for strategic or open questions ("is my structure right?", "what should I test?", "why is this dying?") or when the owner asks for more. Teach when it genuinely adds value, not on every turn. Never pad or repeat yourself; if one line is the honest, complete answer, give one line. Length should track the weight of the question, not be uniform. Plain language, warm and direct.
- FORMATTING: write in clean, plain text. Do NOT use markdown — no ** or __ for bold, no ## headers, no asterisk bullets. The owner reads this in a plain chat bubble, so any * or # shows up as literal clutter. For lists use a simple dash "-" or "1." ; for emphasis rely on word choice and short punchy sentences, not symbols. A section label can just be a short line of normal text.
- Use the TREND data: the snapshot has account_7d vs account_prev_7d vs account_30d, and each campaign's trend_prev_7d. Judge direction (improving vs fatiguing), not just today's snapshot. One week is a signal; the 30-day baseline says whether it's normal.
- DAY-BY-DAY: daily_last_30d has one row per day (last 30) with the OWNER'S Pacific date + weekday, spend, REAL orders/CPA/ROAS and Meta purchases. You CAN answer "what happened last Thursday / Sunday / this weekend" — do that instead of saying you lack daily data. ALWAYS speak in the owner's Pacific days (owner_date/weekday), never the raw ad_account_day: the Meta/Manila billing day starts 9am Pacific the PREVIOUS day, so quoting it calls the owner's Sunday a "Monday".
- JUDGE A DAY AGAINST ITS OWN WEEKDAY, never against yesterday or the week's best day. Use weekday_baseline. Saturday averages ~46 orders and Monday ~33 — a 33-order Monday is DEAD NORMAL, not a crash. Say "that's normal for a Monday" when it is. Only call a day genuinely soft when it's meaningfully below ITS OWN weekday average, and check whether the preceding days were an unusually hot streak (a return to normal after a hot week feels like a collapse but isn't). Never let the owner make a budget change based on one below-average day.
- You see: campaign + ad-SET + top-15 ad-level numbers, each campaign's type (objective, CBO vs ABO, Advantage+ vs manual, ad-set count), ad-set budgets + optimization goal + audience/targeting, a placement breakdown, per-day metrics for 30 days, the real creative thumbnails, real paid orders, and 7d/prior-7d/30d trends. You still do NOT see: audience-overlap analysis, hour-of-day dayparting, or history beyond ~30 days. When a question truly needs something you can't see, say so plainly instead of guessing.`;

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
  // Fail KIE FAST (15s). It has been degraded, and every second spent waiting on
  // it is a second stolen from the OpenAI fallback inside the same worker budget.
  // If KIE is healthy it answers well inside this; if not we move on immediately.
  const KIE_FAST = 15000;
  let photo = refUrl ? await kieEditBytes(prompt, refUrl, KIE_FAST) : await kiePhotoBytes(prompt, undefined, KIE_FAST);
  // FALLBACK: if KIE (the cheap reseller) failed/timed out, generate the photo
  // straight from OpenAI so a KIE outage never kills the build. (Text-to-image
  // only — variations off a reference stay on KIE's image-to-image.)
  let via = photo ? 'kie' : '';
  if (!photo && !refUrl && OPENAI_IMAGE_ENABLED) { photo = await openaiPhotoBytes(prompt); if (photo) via = 'openai'; }
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
  // This function NEVER typesets. render-ad.ts caches the resvg WASM module and
  // brand fonts at module level, so any worker that renders keeps that memory for
  // its whole life — which starved the NEXT image generation on the same warm
  // worker and produced intermittent WORKER_RESOURCE_LIMIT (546) failures.
  // Typesetting lives in the separate `ads-coach-render` function so these
  // workers never load the WASM at all.
  const path = `ads-coach/${crypto.randomUUID()}-photo.png`;
  const { error: upErr } = await admin.storage.from(IMG_BUCKET).upload(path, photo, { contentType: 'image/png', upsert: false });
  if (upErr) { console.warn('[ads-coach] upload failed:', upErr.message); return { url: null, qcNote: 'upload failed' }; }
  // creative-studio is a PUBLIC bucket → a public URL never fails and never expires
  // (a signed URL was the broken link: upload succeeded but the signed URL came back empty).
  const { data: pub } = admin.storage.from(IMG_BUCKET).getPublicUrl(path);
  return { url: pub?.publicUrl || null, qcNote: `(via ${via}) ${qcNote}` };
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
async function runChatWithTools(system: string, convo: any[], admin: any): Promise<{ text: string; images: string[]; made: any[]; staged: any[] }> {
  const images: string[] = [];
  const made: any[] = []; // (unused in the staged flow; kept for shape compatibility)
  // Ad specs the model asked to build. We return these to the frontend, which
  // then calls 'execute_build' in a SEPARATE request — image generation is far
  // too slow to run inside the chat turn without hitting the 150s request limit.
  const staged: any[] = [];
  const messages = convo.map((m) => ({ role: m.role, content: m.content }));
  for (let round = 0; round < 4; round++) {
    const data = await anthropicRaw({ model: MODEL, max_tokens: 1800, system, tools: [IMAGE_TOOL], messages });
    const content = data?.content || [];
    const toolUses = content.filter((c: any) => c.type === 'tool_use');
    if (!toolUses.length) return { text: textOf(data), images, made, staged };
    // Record the assistant's tool-use turn, then run the tools and feed results back.
    messages.push({ role: 'assistant', content });
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      if (tu.name === 'generate_ad_image' && KIE_IMAGE_ENABLED) {
        // DO NOT generate here. Image generation takes 60-120s; doing it inside
        // the chat turn (on top of the account pull, thumbnails and the model
        // call) blew Supabase's 150s request limit and killed the whole reply.
        // Instead we STAGE the spec and return fast; the frontend then fires a
        // dedicated 'execute_build' request that has the full budget for it.
        if (staged.length >= 1) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'You already staged one ad this message — one per message keeps it fast. Describe the next concept in words and offer to build it next turn.', is_error: true });
          continue;
        }
        staged.push(tu.input || {});
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Staged "${(tu.input || {}).concept_label || 'the ad'}" — it is being built now and will appear for the owner in about a minute. In one or two lines tell them WHAT you're building and WHY it opens a new door. Do not claim it is already finished, and never say you can't make images.` });
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: KIE_IMAGE_ENABLED ? 'Unknown tool.' : 'Image generation is not configured.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return { text: staged.length ? 'Building that ad now — it will appear in about a minute.' : 'Ask me again and I\'ll pick this up.', images, made, staged };
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
      // Settings audit: dump the real campaign/ad-set/ad configuration so the
      // owner can be told exactly what is set vs unset, instead of generic advice.
      // Token scope check — definitively answers whether the Meta token can WRITE
      // (ads_management) or is read-only (ads_read).
      if (body.mode === 'token') {
        try {
          const dbg = await metaGet('debug_token', { input_token: META_ACCESS_TOKEN!, access_token: META_ACCESS_TOKEN! });
          const d = dbg?.data || {};
          return json({ success: true, scopes: d.scopes || [], type: d.type, app_id: d.app_id, expires_at: d.expires_at, is_valid: d.is_valid, can_write: (d.scopes || []).includes('ads_management') });
        } catch (e: any) { return json({ success: false, error: String(e?.message || e).slice(0, 300) }); }
      }
      if (body.mode === 'settings') {
        const [camps, adsets, ads] = await Promise.all([
          metaGet(`${META_AD_ACCOUNT_ID}/campaigns`, { fields: 'name,objective,buying_type,status,effective_status,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,spend_cap,start_time,stop_time,smart_promotion_type', limit: '50', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]) }).catch((e) => ({ error: String(e).slice(0, 120) })),
          metaGet(`${META_AD_ACCOUNT_ID}/adsets`, { fields: 'name,campaign_id,daily_budget,billing_event,optimization_goal,bid_strategy,bid_amount,attribution_spec,destination_type,promoted_object,start_time,end_time,targeting', limit: '50', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]) }).catch((e) => ({ error: String(e).slice(0, 120) })),
          metaGet(`${META_AD_ACCOUNT_ID}/ads`, { fields: 'name,adset_id,status,tracking_specs,creative{name,object_story_spec,degrees_of_freedom_spec,asset_feed_spec,url_tags,link_destination_display_url,effective_object_story_id}', limit: '25', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]) }).catch((e) => ({ error: String(e).slice(0, 120) })),
        ]);
        return json({ success: true, campaigns: camps, adsets, ads });
      }
      const report: any = {}; const t = (s: number) => Date.now() - s;
      // mode:'build' — exercise ONLY the generation path (what execute_build does
      // in production). The full selftest additionally pulls the account and
      // downloads ad thumbnails, which together blow the worker's resource limit;
      // that combination no longer happens in the real flow.
      if (body.mode === 'build') {
        // Phase-1 only (photo + QC + store) — matches what execute_build does in
        // production. __photoOnly keeps resvg typesetting OUT of this worker.
        const s0 = Date.now();
        try {
          const { url, qcNote } = await generateAdImage(admin,
            String(body.prompt || 'Candid photo: a Mexican mother listening to a phone with happy tears in a real kitchen. No text anywhere.'),
            '', { ...(body.copy || { concept_label: 'buildtest', template: 'native', headline_lines: ['Prueba'] }), __photoOnly: true }, s0);
          return json({ success: !!url, build: { ok: !!url, secs: Math.round(t(s0) / 1000), qc: qcNote, url } });
        } catch (e: any) { return json({ success: false, build: { ok: false, secs: Math.round(t(s0) / 1000), error: String(e?.message || e).slice(0, 250) } }); }
      }
      try {
        let s = Date.now();
        const ctx = await gatherAccountContext(admin);
        report.meta_pull = { ok: true, ms: t(s), campaigns: ctx.campaigns_7d?.length ?? 0, ad_sets: ctx.ad_sets?.length ?? 0, top_ads: ctx.top_ads_7d?.length ?? 0, real_orders_7d: ctx.real_revenue_7d?.orders ?? null, daily_rows: ctx.daily_last_30d?.length ?? 0, daily_sample: (ctx.daily_last_30d || []).slice(-4) };
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
      // NEWEST 60, then reversed to chronological. Two deliberate choices:
      //  • DESC + reverse — ascending+limit returned the OLDEST 60, so once the
      //    thread crossed 60 rows every reload "reverted" the chat to an old
      //    conversation and silently dropped the latest turns.
      //  • order by id, not created_at — each turn's user+assistant rows are
      //    batch-inserted with the same timestamp, and a created_at sort can
      //    flip them; id is the true insertion order.
      const [{ data: msgs }, { data: calls }] = await Promise.all([
        admin.from('ads_coach_messages').select('role, content, created_at').eq('thread', thread).order('id', { ascending: false }).limit(60),
        admin.from('ads_coach_calls').select('*').order('created_at', { ascending: false }).limit(30),
      ]);
      return json({ success: true, messages: (msgs || []).reverse(), calls: calls || [] });
    }

    // --- GALLERY: every finished ad the Coach has built ---
    if (action === 'list_ads') {
      const { data: ads } = await admin.from('ads_coach_ads').select('*').order('created_at', { ascending: false }).limit(60);
      return json({ success: true, ads: ads || [] });
    }

    // --- EXECUTE BUILD: generate ONE finished ad from a spec the chat staged.
    // Runs in its own request so the whole 150s budget is available for the slow
    // parts (photo generation + vision QC + typeset), instead of sharing it with
    // the account pull and the model call. This is what fixes the 150s timeouts. ---
    if (action === 'execute_build') {
      if (!KIE_IMAGE_ENABLED && !OPENAI_IMAGE_ENABLED) return json({ success: false, error: 'No image provider is configured.' }, 200);
      const spec = body.spec || {};
      const prompt = String(spec.image_prompt || '').trim();
      if (!prompt) return json({ success: false, error: 'No image prompt was staged.' }, 400);
      const t0 = Date.now();
      let refUrl = '';
      if (spec.variation_of_winner) { try { const top = await topAdImageUrl(); refUrl = top.url || ''; } catch (_e) { /* optional */ } }
      try {
        // PHASE 1 only: generate + QC the photo and store it. The typeset layer
        // runs in the separate ads-coach-render FUNCTION (doing both in one
        // worker exceeds WORKER_RESOURCE_LIMIT — see that function's header).
        const { url: photoUrl, qcNote } = await generateAdImage(admin, prompt.slice(0, 3800), refUrl, { ...spec, __photoOnly: true }, t0);
        if (!photoUrl) return json({ success: false, error: 'The image service did not return a photo this time — ask me to build it again.' }, 200);
        const wantsTypeset = Array.isArray(spec.headline_lines) && spec.headline_lines.length > 0;
        if (wantsTypeset) {
          return json({ success: true, phase: 'photo', photo_url: photoUrl, qc: qcNote, spec, secs: Math.round((Date.now() - t0) / 1000) });
        }
        const url = photoUrl;
        const row = {
          url,
          concept: String(spec.concept_label || '').slice(0, 200),
          why_it_wins: String(spec.why_it_wins || '').slice(0, 500),
          distinct_from: String(spec.distinct_from || '').slice(0, 300),
          ad_copy: { template: spec.template, headline_lines: spec.headline_lines, accent_word: spec.accent_word, subhead: spec.subhead, cta: spec.cta, price: spec.price, song_title: spec.song_title, benefit_lines: spec.benefit_lines },
          qc_note: qcNote,
        };
        let ads: any[] = [];
        try {
          await admin.from('ads_coach_ads').insert(row);
          const { data } = await admin.from('ads_coach_ads').select('*').order('created_at', { ascending: false }).limit(60);
          ads = data || [];
        } catch (_e) { /* gallery write is best-effort */ }
        return json({ success: true, image: url, qc: qcNote, concept: row.concept, ads, secs: Math.round((Date.now() - t0) / 1000) });
      } catch (e: any) {
        return json({ success: false, error: String(e?.message || e).slice(0, 300) }, 200);
      }
    }

    // --- WHERE CAN AN AD GO: the account's existing ad sets, for the picker.
    // Only existing ad sets — publishing never creates campaigns or ad sets. ---
    if (action === 'list_ad_targets') {
      try {
        const [camps, sets] = await Promise.all([
          metaGet(`${META_AD_ACCOUNT_ID}/campaigns`, { fields: 'name', limit: '50', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]) }),
          metaGet(`${META_AD_ACCOUNT_ID}/adsets`, { fields: 'name,campaign_id,effective_status', limit: '50', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]) }),
        ]);
        const campName: Record<string, string> = {};
        for (const c of (camps.data || [])) campName[c.id] = c.name;
        const targets = (sets.data || []).map((s: any) => ({ adset_id: s.id, adset_name: s.name, campaign: campName[s.campaign_id] || s.campaign_id }));
        return json({ success: true, targets });
      } catch (e: any) { return json({ success: false, error: String(e?.message || e).slice(0, 300) }, 200); }
    }

    // --- PLAN A CAMPAIGN (READ-ONLY): builds the exact spec that would be sent
    // to Meta and returns it for the owner to review. Creates NOTHING. The
    // approval screen renders this verbatim, so what you approve is what runs.
    if (action === 'plan_campaign') {
      try {
        const templateId = String(body.template_adset_id || '');
        if (!templateId) return json({ success: false, error: 'Pick an existing ad set to copy the targeting from.' }, 400);
        const tpl = await fetchAdsetTemplate(templateId);
        if (!tpl) return json({ success: false, error: 'That ad set is not in your ad account.' }, 400);

        const { cents, error } = budgetCentsOrError(body.daily_budget_usd);
        if (error) return json({ success: false, error }, 400);

        const objective = String(body.objective || 'OUTCOME_SALES');
        if (!CAMPAIGN_OBJECTIVES.includes(objective)) return json({ success: false, error: `Objective must be one of: ${CAMPAIGN_OBJECTIVES.join(', ')}.` }, 400);

        const campaignName = String(body.campaign_name || '').trim().slice(0, 90);
        const adsetName = String(body.adset_name || '').trim().slice(0, 90) || `${campaignName} — ad set`;
        if (!campaignName) return json({ success: false, error: 'Give the campaign a name.' }, 400);

        // Warn (don't block) on a duplicate name so the owner notices.
        let duplicate = false;
        try {
          const camps = await metaGet(`${META_AD_ACCOUNT_ID}/campaigns`, { fields: 'name', limit: '200' });
          duplicate = (camps.data || []).some((c: any) => String(c.name).trim().toLowerCase() === campaignName.toLowerCase());
        } catch (_e) { /* non-fatal */ }

        const t = tpl.targeting || {};
        return json({
          success: true,
          plan: {
            campaign: {
              name: campaignName, objective, buying_type: 'AUCTION',
              status: 'PAUSED', daily_budget_usd: cents! / 100,
              bid_strategy: 'LOWEST_COST_WITHOUT_CAP', special_ad_categories: [],
            },
            adset: {
              name: adsetName, status: 'PAUSED',
              budget: 'none — the campaign holds the budget (CBO)',
              optimization_goal: tpl.optimization_goal || 'OFFSITE_CONVERSIONS',
              billing_event: tpl.billing_event || 'IMPRESSIONS',
              promoted_object: tpl.promoted_object || { pixel_id: META_PIXEL_ID, custom_event_type: 'PURCHASE' },
              copied_from: tpl.name,
              targeting_summary: {
                ages: `${t.age_min ?? '—'}–${t.age_max ?? '—'}`,
                genders: t.genders || 'all',
                countries: t.geo_locations?.countries || t.geo_locations?.location_types || '—',
                platforms: t.publisher_platforms || 'automatic',
                advantage_audience: t.targeting_automation?.advantage_audience ?? '—',
              },
            },
            duplicate_name: duplicate,
            guarantees: [
              'Campaign and ad set are both created PAUSED — nothing can spend until you switch it on.',
              `Targeting, optimization and attribution are copied from your existing "${tpl.name}" — nothing invented.`,
              `Budget is capped at $${BUDGET_MAX_USD}/day by this tool.`,
              'No ads are created here. You add those afterwards from the gallery.',
            ],
          },
        });
      } catch (e: any) { return json({ success: false, error: String(e?.message || e).slice(0, 300) }, 200); }
    }

    // --- CREATE THE CAMPAIGN (WRITE): requires an explicit confirm:true from a
    // human click. Re-derives every value server-side from the same inputs the
    // plan used, so nothing can be smuggled in between preview and creation. ---
    if (action === 'create_campaign') {
      if (body.confirm !== true) return json({ success: false, error: 'Not confirmed — nothing was created.' }, 400);
      try {
        const templateId = String(body.template_adset_id || '');
        const tpl = templateId ? await fetchAdsetTemplate(templateId) : null;
        if (!tpl) return json({ success: false, error: 'That ad set is not in your ad account.' }, 400);

        const { cents, error } = budgetCentsOrError(body.daily_budget_usd);
        if (error) return json({ success: false, error }, 400);

        const objective = String(body.objective || 'OUTCOME_SALES');
        if (!CAMPAIGN_OBJECTIVES.includes(objective)) return json({ success: false, error: 'Objective not allowed.' }, 400);

        const campaignName = String(body.campaign_name || '').trim().slice(0, 90);
        if (!campaignName) return json({ success: false, error: 'Give the campaign a name.' }, 400);
        const adsetName = String(body.adset_name || '').trim().slice(0, 90) || `${campaignName} — ad set`;

        // 1) Campaign — PAUSED, budget on the campaign (CBO).
        const camp = await metaFormPost(`${META_AD_ACCOUNT_ID}/campaigns`, {
          name: campaignName,
          objective,
          status: 'PAUSED', // HARD RULE — never created live
          buying_type: 'AUCTION',
          daily_budget: String(cents),
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          special_ad_categories: JSON.stringify([]),
        });
        if (!camp?.id) throw new Error('Meta did not return a campaign id.');

        // 2) Ad set — PAUSED, settings cloned from the proven template. If this
        // fails we delete the campaign so no orphan is left behind.
        let adset: any;
        try {
          const params: Record<string, string> = {
            name: adsetName,
            campaign_id: camp.id,
            status: 'PAUSED', // HARD RULE — never created live
            billing_event: tpl.billing_event || 'IMPRESSIONS',
            optimization_goal: tpl.optimization_goal || 'OFFSITE_CONVERSIONS',
            targeting: JSON.stringify(cleanTargeting(tpl.targeting)),
            promoted_object: JSON.stringify(tpl.promoted_object || { pixel_id: META_PIXEL_ID, custom_event_type: 'PURCHASE' }),
          };
          if (tpl.attribution_spec) params.attribution_spec = JSON.stringify(tpl.attribution_spec);
          if (tpl.destination_type) params.destination_type = tpl.destination_type;
          adset = await metaFormPost(`${META_AD_ACCOUNT_ID}/adsets`, params);
          if (!adset?.id) throw new Error('Meta did not return an ad set id.');
        } catch (inner: any) {
          await metaDelete(camp.id);
          return json({ success: false, error: `Ad set failed, so the campaign was rolled back (nothing left behind): ${String(inner?.message || inner).slice(0, 300)}` }, 200);
        }

        // Audit trail — who created what, when.
        try {
          await admin.from('ads_coach_campaigns').insert({
            campaign_id: camp.id, campaign_name: campaignName,
            adset_id: adset.id, adset_name: adsetName,
            daily_budget_usd: cents! / 100, objective,
            template_adset_id: templateId, template_adset_name: tpl.name,
            created_by: ud.user.email || ud.user.id,
          });
        } catch (_e) { /* audit is best-effort — never lose the result over it */ }

        return json({
          success: true,
          campaign_id: camp.id, adset_id: adset.id,
          campaign_name: campaignName, adset_name: adsetName,
          note: 'Created PAUSED. Nothing will spend until you switch it on in Ads Manager. Add ads to it from the gallery below.',
        });
      } catch (e: any) {
        return json({ success: false, error: String(e?.message || e).slice(0, 400) }, 200);
      }
    }

    // --- PUBLISH: put a Factory-built ad into an existing ad set, PAUSED. ---
    if (action === 'publish_ad') {
      const adRowId = body.ad_id;
      const adsetId = String(body.adset_id || '');
      if (!adRowId || !adsetId) return json({ success: false, error: 'Pick an ad and an ad set.' }, 400);

      const { data: row } = await admin.from('ads_coach_ads').select('*').eq('id', adRowId).single();
      if (!row?.url) return json({ success: false, error: 'That ad could not be found.' }, 404);
      if (row.published_ad_id) return json({ success: false, error: `Already published to Meta (ad ${row.published_ad_id}).` }, 200);

      // Validate the ad set actually belongs to this account — never trust the client.
      let adsetName = '';
      try {
        const sets = await metaGet(`${META_AD_ACCOUNT_ID}/adsets`, { fields: 'name', limit: '100' });
        const hit = (sets.data || []).find((s: any) => String(s.id) === adsetId);
        if (!hit) return json({ success: false, error: 'That ad set is not in your ad account.' }, 400);
        adsetName = hit.name;
      } catch (e: any) { return json({ success: false, error: `Could not verify the ad set: ${String(e?.message || e).slice(0, 160)}` }, 200); }

      const copy = row.ad_copy || {};
      const primaryText = String(body.primary_text || copy.subhead || row.concept || 'Una canción personalizada, hecha solo para esa persona.').slice(0, 2000);
      const headline = String(body.headline || (Array.isArray(copy.headline_lines) ? copy.headline_lines.join(' ') : '') || '').slice(0, 255);
      const description = String(body.description || '').slice(0, 255);
      const link = String(body.link || 'https://www.regalosquecantan.com/premium');
      const adName = String(body.ad_name || row.concept || 'Ads Coach ad').slice(0, 90);

      try {
        const imgRes = await fetch(row.url);
        if (!imgRes.ok) return json({ success: false, error: 'Could not read the ad image.' }, 200);
        const bytes = new Uint8Array(await imgRes.arrayBuffer());
        const { ad_id, creative_id } = await publishAdToMeta({
          imageBytes: bytes, adsetId, adName, primaryText,
          headline: headline || undefined, description: description || undefined,
          link, ctaType: String(body.cta_type || 'ORDER_NOW'),
        });
        await admin.from('ads_coach_ads').update({
          published_ad_id: ad_id, published_adset_id: adsetId, published_adset_name: adsetName,
          published_at: new Date().toISOString(), published_by: ud.user.email || ud.user.id,
        }).eq('id', adRowId);
        return json({ success: true, ad_id, creative_id, adset_name: adsetName,
          note: 'Created PAUSED. Nothing will spend until you switch it on in Ads Manager.' });
      } catch (e: any) {
        return json({ success: false, error: String(e?.message || e).slice(0, 400) }, 200);
      }
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

    // ATTACHMENTS: the owner can attach (or paste) up to 5 items for the coach
    // to look at / read — images (ad creatives, screenshots; several at once =
    // compare them), PDFs, or plain-text docs. Sent as the top-level `documents`
    // array (the older single `document` field is still accepted so cached
    // frontends keep working), NOT through messages (the convo filter above only
    // keeps string content, so blocks would be dropped). Claude reads PDFs
    // natively (text + layout) — no beta header needed. Files ride ONLY the turn
    // they're attached; the coach's analysis then lives on as saved reply text.
    // DO NOT DELETE when editing this file — the frontend 📎 / paste depends on it.
    const docBlocks: any[] = [];
    let docLabel = '';
    {
      const rawDocs: any[] = Array.isArray(body.documents) ? body.documents.slice(0, 5)
        : (body.document && typeof body.document === 'object' ? [body.document] : []);
      const descs: string[] = [];
      let imageCount = 0, hasDocs = false, totalChars = 0;
      for (const doc of rawDocs) {
        if (!doc || typeof doc.data !== 'string' || !doc.data.trim()) continue;
        const dname = String(doc.name || 'attachment').slice(0, 160);
        if (doc.kind === 'image') {
          const b64 = doc.data.replace(/\s+/g, '');
          if (b64.length > 9_000_000) return json({ success: false, error: `"${dname}" is too big to send — attach a smaller version of that image.` }, 400);
          totalChars += b64.length;
          const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
          const mt = allowed.includes(String(doc.mediaType)) ? doc.mediaType : 'image/jpeg';
          docBlocks.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } });
          imageCount++;
          descs.push(`image ${imageCount}: "${dname}"`);
        } else if (doc.kind === 'pdf') {
          const b64 = doc.data.replace(/\s+/g, ''); // base64 must carry no whitespace
          totalChars += b64.length;
          docBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
          hasDocs = true;
          descs.push(`PDF "${dname}"`);
        } else {
          const text = doc.data.slice(0, 200000);
          totalChars += text.length;
          docBlocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: text } });
          hasDocs = true;
          descs.push(`text document "${dname}"`);
        }
        if (totalChars > 22_000_000) return json({ success: false, error: 'Those attachments are too large together — remove one and try again.' }, 400);
      }
      if (docBlocks.length) {
        const parts: string[] = [
          `The owner attached ${docBlocks.length === 1 ? 'one item' : `${docBlocks.length} items`} to this message — they appear ABOVE, before anything else, in this order: ${descs.join('; ')}.`,
        ];
        if (imageCount === 1) {
          parts.push(`The uploaded image is for your feedback — likely an ad creative, a screenshot, or a reference. Look at it closely and give specific, honest feedback as their ads coach. If they didn't ask a specific question, critique it: thumbnail / first-frame stopping power, whether the offer and price read instantly, text legibility, authenticity (call out any AI tells or generic stock feel), and the 2-3 concrete changes most likely to lift performance — grounded in the craft rules and in how it compares to their current top ads.`);
        } else if (imageCount > 1) {
          parts.push(`The uploaded images are for your feedback. Treat them as a SET: if they look like variants or candidates, compare them directly against each other — rank them, name which one to run and why (the mechanic, not vibes), and what you'd change on the runner-up. If they're a sequence (e.g. carousel or before/after), judge them as one. Apply the same craft lens as always: hook/thumbnail stopping power, offer + price readability, legibility, authenticity, and how they stack up against the current top ads.`);
        }
        if (hasDocs) {
          parts.push(`Read any attached document fully and use it to answer. If the owner didn't ask a specific question about it, summarize what it says and what it means for their Meta ads.`);
        }
        docLabel = parts.join('\n');
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
          imgLabel = `${docBlocks.length ? `Separate from the owner's attachments: the LAST ${thumbs.length} images (immediately above this text)` : 'The images above'} are the ACTUAL creative thumbnails of your current top ads by spend, in order: ${thumbs.map((t, i) => `${i + 1}. ${t.label}`).join('; ')}. Use them to judge the hook/first frame, whether ads are visually too similar (Meta groups look-alikes under one Entity ID), and creative diversity — alongside the numbers in the snapshot.`;
        }
      } catch (_e) { /* vision is a bonus; never fail the answer over it */ }
    }
    // Prepend the owner's attachment (if any) + the top-ad thumbnails to the
    // latest turn, question text last. Both optional, both fail-soft.
    if (docBlocks.length || imgBlocks.length) {
      const last = convo[convo.length - 1];
      const labels = [docLabel, imgLabel].filter(Boolean).join('\n\n');
      last.content = [...docBlocks, ...imgBlocks, { type: 'text', text: `${labels}\n\n${last.content}` }] as any;
    }

    const { text: reply, images: chatImages, made, staged } = await runChatWithTools(system, convo, admin);

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

    return json({ success: true, reply, images: chatImages, ads, pending_builds: staged, brain_reviewed: META_BRAIN_LAST_REVIEWED, had_live_data: !!context, saw_creatives: sawCreatives, calls });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});
