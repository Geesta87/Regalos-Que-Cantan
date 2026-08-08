// supabase/functions/_shared/seo-gsc.ts
// ===========================================================================
// Shared Google Search Console access + live-page reading for the SEO staff:
// seo-coach (interactive chat) and seo-agent-weekly (campaign heartbeat).
// Extracted verbatim from seo-coach so both reason over IDENTICAL data.
//
// Requires secrets: GSC_SERVICE_ACCOUNT_JSON (service-account key JSON).
// Optional: GSC_SITE_URL (default https://regalosquecantan.com/),
//           MEDIA_BUYER_PLATFORM (default 'es'),
//           TRAFFIC_SOURCE_LIVE_FROM (default 2026-07-23).
// ===========================================================================

const GSC_KEY_JSON = Deno.env.get('GSC_SERVICE_ACCOUNT_JSON');
export const GSC_SITE = Deno.env.get('GSC_SITE_URL') || 'https://regalosquecantan.com/';
const RQC_PLATFORM = Deno.env.get('MEDIA_BUYER_PLATFORM') || 'es';
// Queries that are really people looking for US by name (not new demand).
export const BRAND_RE = /regalos?\s*que\s*cantan|regalosque\s*cantan|regalosquecantan/i;
// Date referrer-based attribution went live. Orders before this have no
// referrer_source, so organic revenue is unmeasured (not zero) before it.
export const TRAFFIC_SOURCE_LIVE_FROM = Deno.env.get('TRAFFIC_SOURCE_LIVE_FROM') || '2026-07-23';

export const hasGscKey = () => !!GSC_KEY_JSON;

const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => r1(n * 100);

// ---------------------------------------------------------------------------
// GSC auth + query (service account, read-only scope).
// ---------------------------------------------------------------------------
let cachedToken: { token: string; exp: number } | null = null;

function b64urlBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlStr = (s: string) => b64urlBytes(new TextEncoder().encode(s));

async function gscToken(): Promise<string> {
  if (!GSC_KEY_JSON) throw new Error('GSC_SERVICE_ACCOUNT_JSON not set');
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 120 > now) return cachedToken.token;
  const key = JSON.parse(GSC_KEY_JSON);
  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlStr(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const pem = String(key.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const ck = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', ck, new TextEncoder().encode(`${header}.${claims}`)));
  const jwt = `${header}.${claims}.${b64urlBytes(sig)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`GSC token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: now + num(data.expires_in || 3600) };
  return data.access_token;
}

export async function gscQuery(body: Record<string, unknown>): Promise<any[]> {
  const token = await gscToken();
  const site = encodeURIComponent(GSC_SITE);
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GSC query ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).rows || [];
}

// GSC data lags ~2 days; all windows end at today-3 (UTC) to be safe.
const dayISO = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
const W = { end: 3, days: 28 }; // primary window: 28 days ending 3 days ago
export const RANGE = {
  cur: { startDate: dayISO(W.end + W.days - 1), endDate: dayISO(W.end) },
  prev: { startDate: dayISO(W.end + 2 * W.days - 1), endDate: dayISO(W.end + W.days) },
  quarter: { startDate: dayISO(W.end + 90 - 1), endDate: dayISO(W.end) },
};

export function shapeRow(row: any) {
  return { clicks: num(row.clicks), impressions: num(row.impressions), ctr: pct(num(row.ctr)), position: r1(num(row.position)) };
}

// Pull the live search snapshot the staff reasons over. Every sub-pull is
// .catch-isolated so one hiccup can never blank the whole snapshot.
export async function gatherSearchContext(supabase: any) {
  const soft = (p: Promise<any[]>) => p.catch(() => []);
  const [curTotal, prevTotal, quarterTotal, curQueries, prevQueries, curPages, prevPages, countries, devices] = await Promise.all([
    soft(gscQuery({ ...RANGE.cur, rowLimit: 1 })),
    soft(gscQuery({ ...RANGE.prev, rowLimit: 1 })),
    soft(gscQuery({ ...RANGE.quarter, rowLimit: 1 })),
    soft(gscQuery({ ...RANGE.cur, dimensions: ['query'], rowLimit: 250 })),
    soft(gscQuery({ ...RANGE.prev, dimensions: ['query'], rowLimit: 250 })),
    soft(gscQuery({ ...RANGE.cur, dimensions: ['page'], rowLimit: 50 })),
    soft(gscQuery({ ...RANGE.prev, dimensions: ['page'], rowLimit: 50 })),
    soft(gscQuery({ ...RANGE.cur, dimensions: ['country'], rowLimit: 8 })),
    soft(gscQuery({ ...RANGE.cur, dimensions: ['device'], rowLimit: 3 })),
  ]);

  const prevByQuery: Record<string, any> = {};
  for (const r of prevQueries) prevByQuery[r.keys?.[0]] = r;
  const prevByPage: Record<string, any> = {};
  for (const r of prevPages) prevByPage[r.keys?.[0]] = r;

  // Branded vs non-branded split (across the top 250 queries — an approximation,
  // labeled as such in the note below).
  const branded = { clicks: 0, impressions: 0 };
  const nonBranded = { clicks: 0, impressions: 0 };
  for (const r of curQueries) {
    const bucket = BRAND_RE.test(String(r.keys?.[0] || '')) ? branded : nonBranded;
    bucket.clicks += num(r.clicks); bucket.impressions += num(r.impressions);
  }

  const withPrev = (r: any, prevMap: Record<string, any>) => {
    const out: any = { ...shapeRow(r) };
    const p = prevMap[r.keys?.[0]];
    if (p) out.prev_28d = shapeRow(p);
    return out;
  };

  const top_queries_28d = curQueries.slice(0, 20).map((r) => ({ query: r.keys?.[0], ...withPrev(r, prevByQuery) }));
  // "Striking distance": real impressions, ranking page 1 bottom to page 2 —
  // the cheapest wins in SEO are almost always here, not in new pages.
  const almost_ranking = curQueries
    .filter((r) => { const p = num(r.position); return p >= 4 && p <= 20 && num(r.impressions) >= 15 && !BRAND_RE.test(String(r.keys?.[0] || '')); })
    .sort((a, b) => num(b.impressions) - num(a.impressions))
    .slice(0, 15)
    .map((r) => ({ query: r.keys?.[0], ...shapeRow(r) }));

  const top_pages_28d = curPages.slice(0, 12).map((r) => ({ page: String(r.keys?.[0] || '').replace(GSC_SITE.replace(/\/$/, ''), '') || '/', ...withPrev(r, prevByPage) }));

  // Real paid orders (deduped per stripe_session_id) for business context.
  // referrer_source is filled from the landing referrer (added 2026-07);
  // utm_source wins when present, so paid campaigns never double-count as organic.
  const dedupedOrders = async (startISO: string, endISO: string) => {
    const { data } = await supabase
      .from('songs').select('stripe_session_id, amount_paid, utm_source, referrer_source, landing_path')
      .eq('paid', true).gte('paid_at', `${startISO}T00:00:00Z`).lt('paid_at', `${endISO}T23:59:59Z`)
      .eq('platform', RQC_PLATFORM).not('stripe_session_id', 'is', null);
    const per = new Map<string, { amt: number; src: string; landing: string | null }>();
    for (const r of (data || [])) {
      const sid = r.stripe_session_id as string;
      const amt = num(r.amount_paid);
      const src = (r.utm_source || r.referrer_source || 'unknown') as string;
      if (!per.has(sid) || amt > (per.get(sid) as any).amt) per.set(sid, { amt, src, landing: r.landing_path || null });
    }
    const rows = [...per.values()];
    const isOrganicSearch = (s: string) => /-organic$/.test(s) || s === 'google';
    const org = rows.filter((x) => isOrganicSearch(x.src));
    const bySource: Record<string, { orders: number; revenue: number }> = {};
    for (const x of rows) {
      const k = x.src;
      if (!bySource[k]) bySource[k] = { orders: 0, revenue: 0 };
      bySource[k].orders++; bySource[k].revenue = r2(bySource[k].revenue + x.amt);
    }
    // Which landing page the organic buyers entered on — GSC shows clicks, this
    // shows which page actually earns money.
    const organicLanding: Record<string, number> = {};
    for (const x of org) { const k = x.landing || '(unrecorded)'; organicLanding[k] = (organicLanding[k] || 0) + 1; }
    return {
      orders: rows.length,
      revenue: r2(rows.reduce((a, b) => a + b.amt, 0)),
      organic_search: { orders: org.length, revenue: r2(org.reduce((a, b) => a + b.amt, 0)) },
      unknown_source: rows.filter((x) => x.src === 'unknown').length,
      by_source: bySource,
      organic_landing_pages: organicLanding,
    };
  };
  const emptyOrders = { orders: 0, revenue: 0, organic_search: { orders: 0, revenue: 0 }, unknown_source: 0, by_source: {}, organic_landing_pages: {} };
  let orders_28d: any = emptyOrders, orders_prev_28d: any = emptyOrders;
  try { [orders_28d, orders_prev_28d] = await Promise.all([dedupedOrders(RANGE.cur.startDate, RANGE.cur.endDate), dedupedOrders(RANGE.prev.startDate, RANGE.prev.endDate)]); } catch (_e) { /* best-effort */ }

  const hadData = curTotal.length > 0 || curQueries.length > 0;
  if (!hadData) throw new Error('Search Console returned no data');

  return {
    window: `Primary window: ${RANGE.cur.startDate} → ${RANGE.cur.endDate} (28 days, ending 3 days back — GSC data lags ~2 days). prev_28d = the 28 days before that. 90d totals included for baseline.`,
    totals_28d: shapeRow(curTotal[0] || {}),
    totals_prev_28d: shapeRow(prevTotal[0] || {}),
    totals_90d: shapeRow(quarterTotal[0] || {}),
    branded_vs_nonbranded_28d: {
      branded: { ...branded, note: 'people searching our name — retention/brand demand, not new discovery' },
      non_branded: { ...nonBranded, note: 'real new-demand queries — THIS is the growth surface' },
      method_note: 'split computed over the top 250 queries by regex on the brand name; treat as close approximation',
    },
    top_queries_28d,
    almost_ranking: { note: 'Non-branded queries at position 4-20 with real impressions — the cheapest wins (improve these pages before building new ones).', rows: almost_ranking },
    top_pages_28d,
    countries_28d: countries.map((r) => ({ country: r.keys?.[0], ...shapeRow(r) })),
    devices_28d: devices.map((r) => ({ device: r.keys?.[0], ...shapeRow(r) })),
    real_orders_context: {
      last_28d: orders_28d, prev_28d: orders_prev_28d,
      note: `Deduped real paid orders, split by source. utm_source (paid/email/tagged links) wins; when absent we fall back to referrer_source, captured from the landing referrer. organic_search = arrived from a search engine (google/bing/duckduckgo/yahoo/ecosia). CRITICAL HONESTY RULES: (1) Referrer capture went live ${TRAFFIC_SOURCE_LIVE_FROM}. For any period BEFORE that date organic_search reads 0 because it was never measured, NOT because there were no organic sales — never report that as growth or a decline, and say so when the window spans that date. (2) unknown_source counts orders with neither a UTM nor a referrer (older orders, or browsers/apps that strip the referrer) — real organic is somewhat HIGHER than measured, so treat organic numbers as a floor. (3) Google strips the search term, so this gives the CHANNEL, never the keyword — keywords only come from the Search Console data above. (4) organic_landing_pages shows which page organic BUYERS entered on (GSC shows clicks; this shows money).`,
    },
  };
}

// Per-query positions for a specific set of queries (used by the weekly agent
// to track movement on task target queries beyond the top-250 pull).
export async function positionsForQueries(queries: string[]): Promise<Record<string, any>> {
  if (!queries.length) return {};
  const out: Record<string, any> = {};
  try {
    const rows = await gscQuery({
      ...RANGE.cur,
      dimensions: ['query'],
      rowLimit: 25000,
      dimensionFilterGroups: [{ filters: queries.slice(0, 40).map((q) => ({ dimension: 'query', operator: 'equals', expression: q })), groupType: 'or' }],
    });
    for (const r of rows) out[String(r.keys?.[0] || '')] = shapeRow(r);
  } catch (_e) { /* best-effort */ }
  return out;
}

// ---------------------------------------------------------------------------
// URL Inspection — is a page actually IN Google's index? The #1 silent killer
// for new pages is "Crawled - currently not indexed"; this makes it visible.
// Same service account + readonly scope as the query API. Quota: 2k/day.
// ---------------------------------------------------------------------------
export async function inspectUrl(url: string): Promise<any> {
  try {
    const token = await gscToken();
    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: GSC_SITE }),
    });
    if (!res.ok) return { url, error: `inspect ${res.status}: ${(await res.text()).slice(0, 150)}` };
    const r = (await res.json())?.inspectionResult?.indexStatusResult || {};
    return {
      url,
      verdict: r.verdict || 'UNKNOWN',                 // PASS = indexed
      coverage_state: r.coverageState || 'unknown',    // human-readable, e.g. "Crawled - currently not indexed"
      last_crawl: r.lastCrawlTime || null,
      indexed: r.verdict === 'PASS',
    };
  } catch (e: any) {
    return { url, error: String(e?.message || e).slice(0, 150) };
  }
}

// ---------------------------------------------------------------------------
// fetch_page — read any live page (ours or a competitor's) as served HTML.
// ---------------------------------------------------------------------------
export function extractPageFacts(html: string): any {
  const pick = (re: RegExp) => (html.match(re)?.[1] || '').replace(/\s+/g, ' ').trim();
  const all = (re: RegExp, cap: number) => { const out: string[] = []; let m; const g = new RegExp(re.source, 'gis'); while ((m = g.exec(html)) && out.length < cap) { const t = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); if (t) out.push(t); } return out; };
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  return {
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
    meta_description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    canonical: pick(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
    robots_meta: pick(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i),
    h1: all(/<h1[^>]*>([\s\S]*?)<\/h1>/i, 3),
    h2: all(/<h2[^>]*>([\s\S]*?)<\/h2>/i, 10),
    has_jsonld: /application\/ld\+json/i.test(html),
    visible_text_excerpt: body.slice(0, 2800),
    text_length_chars: body.length,
  };
}

export async function fetchPageFacts(url: string): Promise<any> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { error: 'only http(s) URLs' };
    const res = await fetch(u.toString(), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; RQC-SEO-Coach/1.0)' }, redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) return { url: u.toString(), http_status: res.status, error: `HTTP ${res.status}` };
    if (!/text\/html/i.test(ct)) return { url: u.toString(), http_status: res.status, error: `not HTML (${ct.split(';')[0]})` };
    const html = (await res.text()).slice(0, 600_000);
    return { url: u.toString(), http_status: res.status, ...extractPageFacts(html) };
  } catch (e: any) {
    return { url, error: String(e?.message || e).slice(0, 150) };
  }
}

// ---------------------------------------------------------------------------
// Seasonal calendar — the dates the campaign must build AHEAD of (pages need
// months of indexing time — see seo-brain §4 timelines). lead_days = when the
// weekly agent should start proposing the work.
// ---------------------------------------------------------------------------
export const SEASONAL_CALENDAR = [
  { key: 'reyes', name: 'Día de Reyes', month: 1, day: 6, lead_days: 100, note: 'Jan 6 — real and growing in the US.' },
  { key: 'san-valentin', name: 'Día del Amor y la Amistad', month: 2, day: 14, lead_days: 110, note: 'Feb 14 — shared holiday, romance is our core buyer.' },
  { key: 'dia-madres', name: 'Día de las Madres', month: 5, day: 10, lead_days: 130, note: 'FIXED May 10 (Mexico/Guatemala/El Salvador families) — biggest seasonal spike; many also celebrate US Mother\'s Day.' },
  { key: 'dia-padre', name: 'Día del Padre', month: 6, day: 21, lead_days: 100, note: 'Follows US Father\'s Day (3rd Sunday of June — date approximated).' },
  { key: 'navidad', name: 'Navidad', month: 12, day: 25, lead_days: 120, note: 'Christmas gifting season starts ramping in October.' },
];

export function upcomingSeasonalWindows(now = new Date()): Array<{ key: string; name: string; date: string; days_until: number; in_build_window: boolean; note: string }> {
  const out: Array<{ key: string; name: string; date: string; days_until: number; in_build_window: boolean; note: string }> = [];
  for (const s of SEASONAL_CALENDAR) {
    let d = new Date(Date.UTC(now.getUTCFullYear(), s.month - 1, s.day));
    if (d.getTime() < now.getTime()) d = new Date(Date.UTC(now.getUTCFullYear() + 1, s.month - 1, s.day));
    const daysUntil = Math.round((d.getTime() - now.getTime()) / 864e5);
    out.push({
      key: s.key, name: s.name, date: d.toISOString().slice(0, 10), days_until: daysUntil,
      in_build_window: daysUntil <= s.lead_days, note: s.note,
    });
  }
  return out.sort((a, b) => a.days_until - b.days_until);
}
