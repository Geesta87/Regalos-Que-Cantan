// supabase/functions/seo-coach/index.ts
// ===========================================================================
// SEO COACH — interactive, advice-only search specialist
// ===========================================================================
// A chat surface where the owner asks about organic search ("what should I
// build next?", "why does nobody find us?", "is this page working?") and gets
// answers grounded in (a) LIVE Google Search Console data for the site, (b) the
// verified SEO Brain (_shared/seo-brain.ts — how Google + AI answers actually
// select results in 2026), and (c) the real pages themselves — the coach can
// FETCH and read any live page (ours or a competitor's) during the chat.
//
// ADVICE-ONLY BY DESIGN: this function never changes the site. It reads Search
// Console (read-only scope), reads public pages, and talks. Mirrors ads-coach.
//
// Admin-only (verify_jwt = true + admin_users gate, same as ads-coach).
// Deploy: supabase functions deploy seo-coach --project-ref yzbvajungshqcpusfiia
// Required secrets: GSC_SERVICE_ACCOUNT_JSON (the seo-coach service-account key
// JSON, whole file as one secret), ANTHROPIC_API_KEY (already set).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { seoBrainContext, SEO_BRAIN_LAST_REVIEWED } from '../_shared/seo-brain.ts';
import { brandContext } from '../_shared/brand-brief.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('SEO_COACH_MODEL') || 'claude-opus-4-8';
const EXTRACT_MODEL = Deno.env.get('SEO_COACH_EXTRACT_MODEL') || 'claude-haiku-4-5-20251001';

const GSC_KEY_JSON = Deno.env.get('GSC_SERVICE_ACCOUNT_JSON');
const GSC_SITE = Deno.env.get('GSC_SITE_URL') || 'https://regalosquecantan.com/';
const RQC_PLATFORM = Deno.env.get('MEDIA_BUYER_PLATFORM') || 'es';
// Queries that are really people looking for US by name (not new demand).
const BRAND_RE = /regalos?\s*que\s*cantan|regalosque\s*cantan|regalosquecantan/i;

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => r1(n * 100);

// ---------------------------------------------------------------------------
// Google Search Console auth + query (service account, read-only scope).
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

async function gscQuery(body: Record<string, unknown>): Promise<any[]> {
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
const RANGE = {
  cur: { startDate: dayISO(W.end + W.days - 1), endDate: dayISO(W.end) },
  prev: { startDate: dayISO(W.end + 2 * W.days - 1), endDate: dayISO(W.end + W.days) },
  quarter: { startDate: dayISO(W.end + 90 - 1), endDate: dayISO(W.end) },
};

function shapeRow(row: any) {
  return { clicks: num(row.clicks), impressions: num(row.impressions), ctr: pct(num(row.ctr)), position: r1(num(row.position)) };
}

// Pull the live search snapshot the coach reasons over. Every sub-pull is
// .catch-isolated so one hiccup can never blank the whole snapshot.
async function gatherSearchContext(supabase: any) {
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

  // Real paid orders (deduped per stripe_session_id) for business context. NOTE:
  // we can NOT attribute orders to organic search yet (utm_source is only set on
  // tagged links) — the coach must say so instead of inventing an organic ROAS.
  const dedupedOrders = async (startISO: string, endISO: string) => {
    const { data } = await supabase
      .from('songs').select('stripe_session_id, amount_paid')
      .eq('paid', true).gte('paid_at', `${startISO}T00:00:00Z`).lt('paid_at', `${endISO}T23:59:59Z`)
      .eq('platform', RQC_PLATFORM).not('stripe_session_id', 'is', null);
    const per = new Map<string, number>();
    for (const r of (data || [])) { const sid = r.stripe_session_id as string; const amt = num(r.amount_paid); if (!per.has(sid) || amt > (per.get(sid) as number)) per.set(sid, amt); }
    return { orders: per.size, revenue: r2([...per.values()].reduce((a, b) => a + b, 0)) };
  };
  let orders_28d = { orders: 0, revenue: 0 }, orders_prev_28d = { orders: 0, revenue: 0 };
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
      note: 'ALL-channel real paid orders (deduped). We cannot attribute orders to organic search yet (utm gap) — never invent an organic ROAS; say this plainly if asked.',
    },
  };
}

// ---------------------------------------------------------------------------
// fetch_page tool — the coach's "vision": it can read any live page (ours or a
// competitor's) as Google would see the served HTML. Capped + fail-soft.
// ---------------------------------------------------------------------------
function extractPageFacts(html: string): any {
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

async function fetchPageFacts(url: string): Promise<any> {
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

const PAGE_TOOL = {
  name: 'fetch_page',
  description: 'Fetch a live web page (one of ours or a competitor\'s) and get its served HTML facts: title, meta description, canonical, robots meta, H1/H2s, whether it has JSON-LD, and a visible-text excerpt. Use it to ground any page critique in what is ACTUALLY published instead of guessing — check our own landing pages, or see what a competitor ranking for a query is doing. Max 3 fetches per turn.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to fetch, e.g. https://regalosquecantan.com/ocasiones/dia-de-las-madres' },
      why: { type: 'string', description: 'One line on what you are checking.' },
    },
    required: ['url'],
  },
};

// ---------------------------------------------------------------------------
// The coach persona. Brain + live snapshot appended at call time.
// ---------------------------------------------------------------------------
const COACH_SYSTEM = `You are a world-class SEO coach for "Regalos Que Cantan", a US-Hispanic e-commerce brand selling personalized Spanish songs (~$25-40 order) at regalosquecantan.com. You advise the NON-TECHNICAL owner directly.

Your job is to make the owner genuinely good at organic search AND tell them the highest-leverage move right now — grounded in how Google and AI answer engines ACTUALLY select results today, and in the site's LIVE Search Console numbers. Never generic tips.

How you operate:
- You never change the site yourself. You hand the owner (or their developer session) a specific move — "rewrite the title on /ocasiones/dia-de-las-madres to promise X", "build the quinceañera page now so it has 6 months to mature". Be concrete and ranked.
- GROUND EVERY PAGE OPINION IN THE REAL PAGE. You have the fetch_page tool — when discussing a specific page of ours or a competitor's, FETCH it first and critique what is actually there (title, meta, H1s, content). Never review a page from imagination. Max 3 fetches per turn — choose them well.
- For substantive recommendations, lead with the MECHANIC then the move — explain WHY (how Google/AI select) before WHAT to do. For a quick factual question, just answer it.
- Respect the confidence tags in the brain below: assert [VERIFIED]; say "Google says" for [GOOGLE-SAYS]; give [LEAKED] with its caveat; recommend [CONSENSUS] directionally; present [DEBATE] as options; correct [MYTH] on sight; re-check [SNAPSHOT] before big bets.
- The LIVE Search Console snapshot OUTRANKS the brain doc. If they disagree, trust the data and say so.
- BE HONEST ABOUT TIME. Organic compounds over 6-18 months. Never promise fast rankings. The genuinely fast levers: fixing striking-distance queries (position 4-20), sharper titles on pages that already get impressions, seasonal pages built months early, and brand/AI-answer visibility via mentions.
- Distinguish BRANDED from NON-BRANDED ruthlessly. Branded clicks are people who already know us (ads and social built that); non-branded is new demand. Never let branded volume flatter the SEO picture — the snapshot splits them; use the split.
- WHAT YOU CANNOT SEE — say so plainly instead of guessing: no keyword-volume database (no Ahrefs/Semrush access), no backlink index, no AI Overview citation report (Google folds AI traffic into normal Web totals), no per-order organic attribution (utm gap), GSC data lags ~2 days, and you can't crawl the whole site (only fetch specific pages). If a question needs one of these, name the gap and give the best grounded answer possible.
- Never invent a number (a keyword volume, a difficulty score, a benchmark CTR). If the owner asks "how many people search X", say what the snapshot shows about our own impressions for similar queries and be explicit that you have no volume database.
- MATCH LENGTH TO THE QUESTION. Simple/narrow question → a few sentences, direct, done. Reserve the fuller mechanic-and-teaching treatment for strategic or open questions, or when asked. Never pad. Plain language, warm and direct.
- FORMATTING: plain text only. No markdown — no ** or __, no ## headers, no asterisk bullets (they render as literal clutter in the owner's chat). Lists use "- " or "1." only.`;

// Raw Anthropic call with retry (mirrors ads-coach).
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

// Chat runner with the fetch_page tool. Caps: 3 fetches/turn, 3 rounds.
async function runChatWithTools(system: string, convo: any[]): Promise<{ text: string; fetched: string[] }> {
  const fetched: string[] = [];
  const messages = convo.map((m) => ({ role: m.role, content: m.content }));
  for (let round = 0; round < 3; round++) {
    const data = await anthropicRaw({ model: MODEL, max_tokens: 1800, system, tools: [PAGE_TOOL], messages });
    const content = data?.content || [];
    const toolUses = content.filter((c: any) => c.type === 'tool_use');
    if (!toolUses.length) return { text: textOf(data), fetched };
    messages.push({ role: 'assistant', content });
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      if (tu.name === 'fetch_page' && fetched.length < 3) {
        const facts = await fetchPageFacts(String(tu.input?.url || ''));
        if (!facts.error) fetched.push(facts.url);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(facts).slice(0, 12_000), is_error: !!facts.error });
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: fetched.length >= 3 ? 'Fetch limit reached this turn (3).' : 'Unknown tool.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return { text: 'I fetched the pages but ran out of room to finish — ask me again and I will answer directly.', fetched };
}

// Extract the single most concrete recommendation for the track record (Haiku).
async function extractRecommendation(reply: string): Promise<any> {
  if (!ANTHROPIC_API_KEY) return null;
  const sys = `Read this SEO coach message and extract its SINGLE most important concrete recommendation, if any. Return ONLY minified JSON: {"recommendation":"","rationale":"","target_page":""}. "recommendation" = the specific action (e.g. "Rewrite the title on /ocasiones/dia-de-las-madres to lead with 'canción personalizada'"); EMPTY string if no concrete actionable move (pure explanation counts as none). Keep every field short.`;
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
    // --- Admin gate (same as ads-coach / cos-assistant) ---
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow || roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const action = body.action || 'chat';

    // --- MEMORY: past conversation + track record (cross-session) ---
    if (action === 'history') {
      const [{ data: msgs }, { data: calls }] = await Promise.all([
        admin.from('seo_coach_messages').select('role, content, created_at').order('created_at', { ascending: true }).limit(60),
        admin.from('seo_coach_calls').select('*').order('created_at', { ascending: false }).limit(30),
      ]);
      return json({ success: true, messages: msgs || [], calls: calls || [] });
    }

    // --- TRACK RECORD: owner grades a past recommendation ---
    if (action === 'resolve_call') {
      const id = body.id; const verdict = body.verdict;
      if (!id || !['correct', 'wrong', 'dismissed'].includes(verdict)) return json({ success: false, error: 'bad resolve' }, 400);
      await admin.from('seo_coach_calls').update({ status: verdict, resolved_at: new Date().toISOString() }).eq('id', id);
      const { data: calls } = await admin.from('seo_coach_calls').select('*').order('created_at', { ascending: false }).limit(30);
      return json({ success: true, calls: calls || [] });
    }

    // --- CHAT (default) ---
    if (!GSC_KEY_JSON) return json({ success: false, error: 'GSC_SERVICE_ACCOUNT_JSON not set — the coach needs the Search Console key to read your search data.' }, 200);
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const convo = incoming
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!convo.length || convo[convo.length - 1].role !== 'user') {
      return json({ success: false, error: 'Ask the coach a question.' }, 400);
    }
    const userQuestion = String(convo[convo.length - 1].content);

    // Live snapshot — best-effort; a GSC hiccup means answering on principle, flagged.
    let context: any = null, contextErr = '';
    try { context = await gatherSearchContext(admin); }
    catch (e: any) { contextErr = String(e?.message || e).slice(0, 200); }

    const contextBlock = context
      ? `LIVE SEARCH CONSOLE SNAPSHOT (pulled just now — reason from THIS, it outranks the doc):\n${JSON.stringify(context, null, 2)}`
      : `LIVE SEARCH CONSOLE SNAPSHOT: unavailable this turn (${contextErr || 'no data'}). Tell the owner you couldn't pull fresh search data and answer on principle, clearly flagged.`;

    // Seasonal push context (same source the creative generators use).
    let promoNotes = '';
    try {
      const { data: cfg } = await admin.from('creative_studio_config').select('promo_notes').eq('id', 1).single();
      promoNotes = cfg?.promo_notes || '';
    } catch (_e) { /* optional */ }

    const system = `${COACH_SYSTEM}

WHAT THIS BUSINESS SELLS (so your advice fits the real product, not generic e-commerce):
${brandContext(promoNotes)}

${contextBlock}

${seoBrainContext('HOW GOOGLE + AI SEARCH SELECT RESULTS — reason with these mechanics (respect the confidence tags):')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL OUTPUT RULES — these override the formatting of everything above. Obey them every single time:
1. PLAIN TEXT ONLY. Absolutely no markdown. Never ** or __ or ## (they show as literal symbols in the owner's chat). Lists use "- " or "1." only. The doc above uses CAPS/symbols for YOUR reading — do not copy that style.
2. MATCH LENGTH TO THE QUESTION. Narrow question → a few sentences. Strategic/open question → fuller treatment. Never pad or repeat.
3. When you discuss a specific page (ours or a competitor's), use fetch_page FIRST and critique the real page. Never review a page from imagination.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    const { text: reply, fetched } = await runChatWithTools(system, convo);

    // MEMORY: persist just this turn (frontend re-sends history each call).
    try {
      await admin.from('seo_coach_messages').insert([
        { role: 'user', content: userQuestion.slice(0, 8000) },
        { role: 'assistant', content: reply.slice(0, 8000) },
      ]);
    } catch (_e) { /* best-effort */ }

    // TRACK RECORD: log the top concrete recommendation for owner grading.
    let calls: any[] = [];
    try {
      const rec = await extractRecommendation(reply);
      if (rec?.recommendation) {
        await admin.from('seo_coach_calls').insert({
          recommendation: String(rec.recommendation).slice(0, 300),
          rationale: String(rec.rationale || '').slice(0, 400),
          target_page: String(rec.target_page || '').slice(0, 200),
        });
      }
      const { data } = await admin.from('seo_coach_calls').select('*').order('created_at', { ascending: false }).limit(30);
      calls = data || [];
    } catch (_e) { /* best-effort */ }

    return json({ success: true, reply, brain_reviewed: SEO_BRAIN_LAST_REVIEWED, had_live_data: !!context, pages_read: fetched, calls });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});
