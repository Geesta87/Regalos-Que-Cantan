// supabase/functions/media-buyer-daily/index.ts
// ===========================================================================
// AGENT 1 — MEDIA BUYER (recommend-only)
// ===========================================================================
// Runs once each morning via pg_cron. Acts as a senior DTC media buyer:
//   1. Pulls Meta Ads insights (yesterday + last 7d) for the ad account.
//   2. Cross-checks Meta's pixel purchases against REAL paid orders in the
//      songs table (deduped per stripe_session_id — 2-pack safe, see
//      project_bundle_amount_model). Meta routinely over/under-counts.
//   3. Asks Claude (forced tool-use) to analyze like a pro buyer and emit a
//      structured brief: headline, per-campaign verdicts, ranked recommendations.
//   4. Stores the report + emails the owner.
//
// RECOMMEND-ONLY: this function NEVER writes to the Meta account. It only
// reads ad data and reports. Every suggested change is staged for the owner
// to apply manually. (Owner chose this mode 2026-06-25.)
//
// Fully isolated from stripe-webhook / the payment funnel — reads songs +
// writes only to agent_runs / media_buyer_reports.
//
// verify_jwt = false (pg_cron has no JWT) — see supabase/config.toml.
// Deploy: supabase functions deploy media-buyer-daily --project-ref yzbvajungshqcpusfiia
//
// Required project secrets:
//   META_ACCESS_TOKEN  — long-lived Meta system-user token with ads_read
//   ANTHROPIC_API_KEY  — (already set, shared with generate-song)
//   SENDGRID_API_KEY   — (already set)
// Optional:
//   META_AD_ACCOUNT_ID — defaults to act_832413711748940
//   META_API_VERSION   — defaults to v21.0
//   MEDIA_BUYER_MODEL  — defaults to claude-opus-4-8
//   MEDIA_BUYER_TZ     — revenue day boundary, defaults to America/Chicago
//   ALERT_EMAIL        — recipient, defaults to hola@regalosquecantan.com
//   MEDIA_BUYER_ENABLED — set to 'false' to pause the agent without undeploy

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');

const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN');
const META_AD_ACCOUNT_ID = Deno.env.get('META_AD_ACCOUNT_ID') || 'act_832413711748940';
const META_API_VERSION = Deno.env.get('META_API_VERSION') || 'v21.0';
const MODEL = Deno.env.get('MEDIA_BUYER_MODEL') || 'claude-opus-4-8';
// Revenue is bucketed to the AD-ACCOUNT day so it lines up with Meta's "yesterday"
// spend (always in the ad-account TZ). This account is permanently on Asia/Manila
// (set up that way by mistake, but Meta won't let you change a TZ after spend), so
// aligning the revenue day to Manila makes daily spend-vs-revenue ROAS exact —
// midnight Manila ≈ 9am US-Pacific (8am in winter). Override via MEDIA_BUYER_TZ /
// META_AD_TZ only if the ad account's timezone ever changes.
const REVENUE_TZ = Deno.env.get('MEDIA_BUYER_TZ') || Deno.env.get('META_AD_TZ') || 'Asia/Manila';
// The RQC Spanish funnel stamps songs.platform = 'es'. (NOT 'regalos_que_cantan'
// — that value is stale and matches zero rows; verified against live data
// 2026-06-25. clonamivoz lives in its own table and is excluded automatically.)
const RQC_PLATFORM = Deno.env.get('MEDIA_BUYER_PLATFORM') || 'es';

const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || 'hola@regalosquecantan.com';
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RQC Media Buyer';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Time helpers — resolve "yesterday" as a calendar day in REVENUE_TZ, which is
// set to the AD-ACCOUNT timezone (Asia/Manila) so it matches Meta's "yesterday"
// preset (Meta always reports in the ad-account TZ). Revenue and spend therefore
// cover the SAME 24h window — ROAS is exact, no TZ caveat needed.
// ---------------------------------------------------------------------------
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a: any, x) => (a[x.type] = x.value, a), {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Start-of-day (UTC instant) for a calendar day in `tz`, offset by dayOffset.
function startOfTzDay(tz: string, dayOffset: number): Date {
  const now = new Date();
  const off = tzOffsetMs(now, tz);
  const wall = new Date(now.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);
  wall.setUTCDate(wall.getUTCDate() + dayOffset);
  let utc = new Date(wall.getTime() - off);
  const off2 = tzOffsetMs(utc, tz);          // re-correct across DST edges
  if (off2 !== off) utc = new Date(wall.getTime() - off2);
  return utc;
}

function ymd(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// ---------------------------------------------------------------------------
// Meta Graph API
// ---------------------------------------------------------------------------
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const INSIGHT_FIELDS =
  'campaign_id,campaign_name,spend,impressions,clicks,reach,frequency,cpc,cpm,ctr,actions,cost_per_action_type';

async function metaGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ ...params, access_token: META_ACCESS_TOKEN! });
  const res = await fetch(`${META_BASE}/${path}?${qs.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function actionCount(actions: any[] | undefined, type: string): number {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find((a) => a.action_type === type);
  return hit ? Number(hit.value || hit.count || 0) : 0;
}

// Meta's "purchase" pixel count for a row. Prefer offsite pixel 'purchase';
// fall back to 'omni_purchase' (same number in this account).
function purchasesOf(row: any): number {
  return actionCount(row.actions, 'purchase') || actionCount(row.actions, 'omni_purchase');
}

function num(x: any): number { const n = Number(x); return Number.isFinite(n) ? n : 0; }

function shapeCampaignRow(row: any, budgetByName: Record<string, number>) {
  const spend = num(row.spend);
  const purchases = purchasesOf(row);
  return {
    name: row.campaign_name,
    spend: Math.round(spend * 100) / 100,
    purchases,
    meta_cpa: purchases > 0 ? Math.round((spend / purchases) * 100) / 100 : null,
    ctr: Math.round(num(row.ctr) * 100) / 100,
    cpm: Math.round(num(row.cpm) * 100) / 100,
    cpc: Math.round(num(row.cpc) * 100) / 100,
    frequency: Math.round(num(row.frequency) * 100) / 100,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    daily_budget: budgetByName[row.campaign_name] ?? null,
  };
}

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------
async function sendEmail(subject: string, html: string) {
  if (!SENDGRID_API_KEY) { console.warn('SENDGRID_API_KEY not set — skipping email'); return false; }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      content: [{ type: 'text/html', value: html }],
      categories: ['media_buyer', 'rqc_internal'],
      tracking_settings: {
        click_tracking: { enable: false }, open_tracking: { enable: false },
        subscription_tracking: { enable: false },
      },
    }),
  });
  if (!res.ok) { console.error('SendGrid error', res.status, await res.text()); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// Claude — the "pro media buyer" brain (forced tool-use, like generate-storyboard)
// ---------------------------------------------------------------------------
const BRIEF_TOOL = {
  name: 'emit_media_buyer_brief',
  description: 'Emit the structured daily media-buyer brief.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One punchy sentence: the single most important takeaway.' },
      account_health: { type: 'string', enum: ['healthy', 'watch', 'at_risk'] },
      account_summary: { type: 'string', description: '2-3 sentences on yesterday vs the 7-day trend, in plain language.' },
      campaigns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            verdict: { type: 'string', enum: ['scale', 'keep', 'watch', 'trim', 'fix', 'off'] },
            note: { type: 'string', description: 'One line: why this verdict.' },
          },
          required: ['name', 'verdict', 'note'],
        },
      },
      recommendations: {
        type: 'array',
        description: 'Ranked, highest-impact first. RECOMMEND-ONLY — these are staged for the owner to apply.',
        items: {
          type: 'object',
          properties: {
            priority: { type: 'integer' },
            type: { type: 'string', enum: ['scale', 'trim', 'relaunch', 'audience', 'creative', 'structure', 'other'] },
            action: { type: 'string', description: 'Concrete move, e.g. "Raise Corrido budget $50 → $75/day".' },
            rationale: { type: 'string', description: 'The evidence in one line.' },
            target_campaign: { type: 'string' },
          },
          required: ['priority', 'type', 'action', 'rationale'],
        },
      },
      data_caveats: { type: 'string', description: 'Honest limits of the data (TZ mismatch, pixel vs real revenue, low-volume days).' },
    },
    required: ['headline', 'account_health', 'account_summary', 'campaigns', 'recommendations', 'data_caveats'],
  },
};

const SYSTEM = `You are a senior direct-response media buyer managing Meta ads for "Regalos Que Cantan", a US-Hispanic ecommerce brand selling personalized AI-generated Spanish songs (~$30 average order). You brief the non-technical owner every morning.

Think like a real buyer, not a dashboard:
- Judge campaigns on COST PER REAL SALE and trend, not vanity metrics. One bad day is noise; a 7-day pattern is signal.
- The owner's TRUE revenue comes from the songs table (deduped paid orders), not Meta's pixel count. When they disagree, trust the real orders and say so.
- Spot the real levers: a winner that's budget-throttled (scale it), a whale that's the worst cost-per-sale (trim it), a proven creative that got turned off (relaunch it), an audience fatiguing (rising frequency + CPM → widen it).
- PROFIT beats ROAS: metrics.cost_model carries the owner's estimated per-order costs and monthly overhead. Judge the account and each move on ESTIMATED PROFIT (revenue − ad spend − costs), and say the profit number out loud in the headline or summary. A "nice ROAS" that loses money after costs is a trim/fix — say so plainly. If cost_model is missing, fall back to ROAS and note it.
- MEMORY — FOLLOW UP, don't goldfish: metrics.recent_briefs holds your own last briefs (recommendations + the campaign numbers at the time). For EVERY prior recommendation: if the numbers show it was applied (budget/spend changed), report what happened since; if it was ignored and the data still supports it, repeat it prefixed "(repeat)" with the days outstanding; if today's data contradicts it, own the miss and close it. Never present a repeated recommendation as if it were new.
- You are in RECOMMEND-ONLY mode. Never imply a change was made. Every recommendation is staged for the owner to apply by hand. Be specific and ranked.
- Plain language. No jargon dumps. The owner should know exactly what to do and why.`;

async function runBrief(metrics: any): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      tools: [BRIEF_TOOL],
      tool_choice: { type: 'tool', name: 'emit_media_buyer_brief' },
      messages: [{
        role: 'user',
        content:
          `Here is the account data as structured JSON. Analyze it and emit the brief.\n\n` +
          JSON.stringify(metrics, null, 2),
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const toolUse = (data.content || []).find((c: any) => c.type === 'tool_use');
  if (!toolUse) throw new Error('No brief returned by model');
  return toolUse.input;
}

// ---------------------------------------------------------------------------
// Email rendering
// ---------------------------------------------------------------------------
const VERDICT_BADGE: Record<string, string> = {
  scale: '🔼 SCALE', keep: '✅ KEEP', watch: '👀 WATCH',
  trim: '🔻 TRIM', fix: '🛠️ FIX', off: '⚫ OFF',
};

function money(n: number | null): string { return n == null ? '—' : `$${n.toFixed(2)}`; }

function renderEmail(brief: any, metrics: any, reportFor: string): string {
  const acc = metrics.account_yesterday;
  const rev = metrics.revenue_crosscheck;
  const rows = (metrics.campaigns_last_7d || []).map((c: any) => {
    const verdict = (brief.campaigns || []).find((b: any) => b.name === c.name)?.verdict || 'keep';
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;">${c.name}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${money(c.spend)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${c.purchases}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${money(c.meta_cpa)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${c.ctr}%</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${VERDICT_BADGE[verdict] || verdict}</td>
    </tr>`;
  }).join('');

  const recs = (brief.recommendations || []).map((r: any) =>
    `<li style="margin:0 0 10px;"><b>${r.action}</b><br><span style="color:#666;font-size:13px;">${r.rationale}</span></li>`
  ).join('');

  const healthColor = brief.account_health === 'at_risk' ? '#dc2626'
    : brief.account_health === 'watch' ? '#f59e0b' : '#16a34a';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#111827;padding:22px 28px;">
      <div style="color:#9ca3af;font-size:12px;letter-spacing:.5px;text-transform:uppercase;">Media Buyer · Morning Brief</div>
      <h1 style="color:#fff;margin:6px 0 0;font-size:20px;">Regalos Que Cantan — for ${reportFor}</h1>
    </div>
    <div style="padding:24px 28px;">
      <div style="font-size:16px;line-height:1.5;color:#111;border-left:4px solid ${healthColor};padding-left:12px;margin-bottom:18px;">
        ${brief.headline}
      </div>
      <p style="color:#374151;font-size:14px;line-height:1.6;">${brief.account_summary}</p>

      <div style="background:#f9fafb;border-radius:8px;padding:14px 16px;margin:18px 0;font-size:14px;">
        <b>Yesterday:</b> ${money(num(acc?.spend))} spent ·
        Meta says ${acc?.purchases ?? 0} sales ·
        <b>your DB shows ${rev?.real_orders ?? 0} paid orders</b>
        (${money(rev?.real_revenue ?? 0)} revenue) ·
        real cost/sale ${money(rev?.real_cpa ?? null)} ·
        ROAS ≈ ${rev?.real_roas != null ? rev.real_roas.toFixed(2) + 'x' : '—'}
        ${metrics.cost_model ? `<br><b>Est. profit: ${money(metrics.cost_model.est_profit_yesterday)}</b> <span style="color:#9ca3af;">(revenue − ads − ~${money(metrics.cost_model.est_costs_yesterday)} est. costs — edit in operating_costs)</span>` : ''}
      </div>

      <h3 style="margin:20px 0 8px;font-size:15px;color:#111;">Last 7 days by campaign</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="text-align:left;color:#6b7280;">
          <th style="padding:6px 10px;">Campaign</th>
          <th style="padding:6px 10px;text-align:right;">Spend</th>
          <th style="padding:6px 10px;text-align:right;">Sales</th>
          <th style="padding:6px 10px;text-align:right;">$/sale</th>
          <th style="padding:6px 10px;text-align:right;">CTR</th>
          <th style="padding:6px 10px;">Verdict</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <h3 style="margin:24px 0 8px;font-size:15px;color:#111;">Recommended moves <span style="color:#9ca3af;font-weight:normal;font-size:12px;">— staged for your approval, nothing applied</span></h3>
      <ol style="padding-left:18px;color:#111;font-size:14px;">${recs}</ol>

      <p style="color:#9ca3af;font-size:12px;line-height:1.5;margin-top:20px;border-top:1px solid #eee;padding-top:14px;">
        ${brief.data_caveats}<br><br>
        This brief is read-only — the agent never changes your ad account. Reply to apply any move.
      </p>
    </div>
  </div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// AUTO-GRADER — resolves Sofía's open cos_calls once their horizon passes, by
// comparing the target campaign's Meta numbers before vs after the call.
// Conservative on purpose: only clear cases become correct/wrong (they feed the
// trust-tier accuracy); everything ambiguous is closed as 'dismissed' with a
// note, so the scorecard stops piling up "open" forever but is never polluted
// with guessed grades.
// ---------------------------------------------------------------------------
async function gradeOpenCalls(supabase: any): Promise<number> {
  const { data: calls } = await supabase
    .from('cos_calls')
    .select('id, created_at, kind, subject, subject_ref, metric_at_call, horizon_days, status')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(10); // bound Meta API calls per run
  let graded = 0;
  const resolve = async (id: string, status: string, outcome: string) => {
    await supabase.from('cos_calls')
      .update({ status, resolved_at: new Date().toISOString(), outcome: outcome.slice(0, 300) })
      .eq('id', id);
    graded++;
  };

  for (const c of calls || []) {
    const callTime = new Date(c.created_at).getTime();
    const horizonMs = Math.max(1, c.horizon_days || 7) * 864e5;
    if (Date.now() - callTime < horizonMs) continue; // not due yet

    if (!c.subject_ref) {
      await resolve(c.id, 'dismissed', 'auto: no measurable target (subject_ref) — cannot grade');
      continue;
    }
    try {
      const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
      const [beforeRes, afterRes] = await Promise.all([
        metaGet(`${c.subject_ref}/insights`, {
          time_range: JSON.stringify({ since: fmt(callTime - 7 * 864e5), until: fmt(callTime) }),
          fields: 'spend,actions',
        }),
        metaGet(`${c.subject_ref}/insights`, {
          time_range: JSON.stringify({ since: fmt(callTime), until: fmt(Math.min(callTime + horizonMs, Date.now())) }),
          fields: 'spend,actions',
        }),
      ]);
      const b = (beforeRes.data || [])[0] || {};
      const a = (afterRes.data || [])[0] || {};
      const postDays = Math.max(1, Math.round(Math.min(horizonMs, Date.now() - callTime) / 864e5));
      const bSpendDay = num(b.spend) / 7;
      const aSpendDay = num(a.spend) / postDays;
      const bCpa = purchasesOf(b) > 0 ? num(b.spend) / purchasesOf(b) : null;
      const aCpa = purchasesOf(a) > 0 ? num(a.spend) / purchasesOf(a) : null;

      if (c.kind === 'cut') {
        if (aSpendDay < Math.max(1, bSpendDay * 0.15)) {
          await resolve(c.id, 'correct', `auto: cut applied — spend $${bSpendDay.toFixed(0)}/d → $${aSpendDay.toFixed(0)}/d, ~$${(bSpendDay - aSpendDay).toFixed(0)}/d freed`);
        } else if (bCpa != null && aCpa != null && aCpa < bCpa * 0.7) {
          await resolve(c.id, 'wrong', `auto: not cut and CPA improved $${bCpa.toFixed(0)} → $${aCpa.toFixed(0)} — the call was premature`);
        } else {
          await resolve(c.id, 'dismissed', 'auto: cut not applied within horizon — no grade');
        }
      } else if (c.kind === 'budget' || c.kind === 'scale') {
        if (bCpa == null || aCpa == null) {
          await resolve(c.id, 'dismissed', 'auto: too few purchases before/after to judge — no grade');
        } else if (aCpa <= bCpa * 1.15) {
          await resolve(c.id, 'correct', `auto: after the ${c.kind}, cost-per-sale held/improved ($${bCpa.toFixed(0)} → $${aCpa.toFixed(0)})`);
        } else if (aCpa > bCpa * 1.4) {
          await resolve(c.id, 'wrong', `auto: after the ${c.kind}, cost-per-sale worsened ($${bCpa.toFixed(0)} → $${aCpa.toFixed(0)})`);
        } else {
          await resolve(c.id, 'dismissed', `auto: cost-per-sale moved within noise ($${bCpa.toFixed(0)} → $${aCpa.toFixed(0)}) — no grade`);
        }
      } else {
        await resolve(c.id, 'dismissed', `auto: kind "${c.kind}" has no grading rule — no grade`);
      }
    } catch (e) {
      // Meta hiccup on one call must never block the rest (or the brief).
      console.warn(`gradeOpenCalls: ${c.id} failed`, e);
    }
  }
  return graded;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Pause switch (no redeploy needed to halt).
  if (Deno.env.get('MEDIA_BUYER_ENABLED') === 'false') {
    return json(200, { success: true, skipped: true, reason: 'agent_disabled' });
  }

  // Setup guard: if the Meta token isn't configured yet, tell the owner once
  // (via the agent_runs log) instead of hard-failing the cron.
  if (!META_ACCESS_TOKEN) {
    await supabase.from('agent_runs').insert({
      agent: 'media-buyer', status: 'skipped', ok: false,
      summary: 'META_ACCESS_TOKEN not set — agent idle until configured',
      finished_at: new Date().toISOString(), execution_ms: Date.now() - startTime,
    });
    return json(200, { success: false, skipped: true, reason: 'META_ACCESS_TOKEN missing' });
  }

  try {
    // The completed ad-day is "yesterday" in the ad-account TZ (Manila). Label it
    // by the Pacific date at its START (9am Pacific) so the report reads in the
    // owner's LA calendar: e.g. the Manila-Jun-26 ad-day is reported as "Jun 25".
    const reportFor = ymd(startOfTzDay(REVENUE_TZ, -1), 'America/Los_Angeles'); // Pacific start-date label

    // ---- 1. Meta: active campaign budgets + insights (yesterday + 7d) ----
    const acctPath = `${META_AD_ACCOUNT_ID}/insights`;
    const [campaignsList, ydayCampaigns, weekCampaigns, ydayAccount] = await Promise.all([
      metaGet(`${META_AD_ACCOUNT_ID}/campaigns`, {
        fields: 'name,daily_budget,effective_status', limit: '100',
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
      }),
      metaGet(acctPath, { level: 'campaign', date_preset: 'yesterday', fields: INSIGHT_FIELDS, limit: '100' }),
      metaGet(acctPath, { level: 'campaign', date_preset: 'last_7d', fields: INSIGHT_FIELDS, limit: '100' }),
      metaGet(acctPath, { level: 'account', date_preset: 'yesterday', fields: INSIGHT_FIELDS, limit: '1' }),
    ]);

    const budgetByName: Record<string, number> = {};
    for (const c of (campaignsList.data || [])) {
      if (c.daily_budget != null) budgetByName[c.name] = Math.round(num(c.daily_budget)) / 100; // cents → $
    }

    const campaigns_yesterday = (ydayCampaigns.data || []).map((r: any) => shapeCampaignRow(r, budgetByName));
    const campaigns_last_7d = (weekCampaigns.data || []).map((r: any) => shapeCampaignRow(r, budgetByName));
    const accRow = (ydayAccount.data || [])[0] || {};
    const account_yesterday = {
      spend: Math.round(num(accRow.spend) * 100) / 100,
      purchases: purchasesOf(accRow),
      ctr: Math.round(num(accRow.ctr) * 100) / 100,
      cpm: Math.round(num(accRow.cpm) * 100) / 100,
      cpc: Math.round(num(accRow.cpc) * 100) / 100,
      frequency: Math.round(num(accRow.frequency) * 100) / 100,
    };

    // ---- 2. Real revenue cross-check (deduped per stripe_session_id) ----
    const dayStart = startOfTzDay(REVENUE_TZ, -1).toISOString();
    const dayEnd = startOfTzDay(REVENUE_TZ, 0).toISOString();
    const { data: paidRows, error: paidErr } = await supabase
      .from('songs')
      .select('stripe_session_id, amount_paid')
      .eq('paid', true)
      .gte('paid_at', dayStart)
      .lt('paid_at', dayEnd)
      .eq('platform', RQC_PLATFORM)
      .not('stripe_session_id', 'is', null);
    if (paidErr) throw new Error(`songs query: ${paidErr.message}`);

    // Count each order once. The 2-pack stamps the full total on BOTH rows, so
    // dedupe by session id and take the per-session amount once. Use the MAX
    // across a session's rows so a null on one row doesn't zero out the order.
    const perSession = new Map<string, number>();
    for (const r of (paidRows || [])) {
      const sid = r.stripe_session_id as string;
      const amt = num(r.amount_paid);
      if (!perSession.has(sid) || amt > (perSession.get(sid) as number)) perSession.set(sid, amt);
    }
    const real_orders = perSession.size;
    const real_revenue = Math.round([...perSession.values()].reduce((a, b) => a + b, 0) * 100) / 100;
    const spend = account_yesterday.spend;
    const revenue_crosscheck = {
      real_orders,
      real_revenue,
      real_cpa: real_orders > 0 ? Math.round((spend / real_orders) * 100) / 100 : null,
      real_roas: spend > 0 ? Math.round((real_revenue / spend) * 100) / 100 : null,
      meta_reported_purchases: account_yesterday.purchases,
      revenue_window: `${dayStart} → ${dayEnd} (${REVENUE_TZ})`,
    };

    // ---- 2b. Cost model → estimated PROFIT (owner-editable operating_costs) ----
    let cost_model: any = null;
    try {
      const { data: costs } = await supabase
        .from('operating_costs')
        .select('kind, amount')
        .eq('active', true);
      if (costs && costs.length) {
        const perOrder = costs.filter((c: any) => c.kind === 'per_order').reduce((a: number, c: any) => a + num(c.amount), 0);
        const monthly = costs.filter((c: any) => c.kind === 'monthly').reduce((a: number, c: any) => a + num(c.amount), 0);
        const estCosts = Math.round((perOrder * real_orders + monthly / 30) * 100) / 100;
        cost_model = {
          per_order_cost: Math.round(perOrder * 100) / 100,
          monthly_overhead: monthly,
          est_costs_yesterday: estCosts,
          est_profit_yesterday: Math.round((real_revenue - spend - estCosts) * 100) / 100,
          note: 'Owner-editable ESTIMATES from the operating_costs table. profit = real_revenue − ad spend − these costs.',
        };
      }
    } catch (e) { console.warn('cost model load failed', e); }

    // ---- 2c. MEMORY: the agent's own last briefs, so it follows up instead of
    // re-discovering the account from scratch every morning ----
    let recent_briefs: any[] = [];
    try {
      const { data: prior } = await supabase
        .from('media_buyer_reports')
        .select('report_for, analysis, metrics')
        .neq('report_for', reportFor)
        .order('report_for', { ascending: false })
        .limit(3);
      recent_briefs = (prior || []).map((p: any) => ({
        report_for: p.report_for,
        headline: p.analysis?.headline,
        recommendations: (p.analysis?.recommendations || []).map((r: any) => ({
          type: r.type, action: r.action, target_campaign: r.target_campaign ?? null,
        })),
        campaign_state_then: (p.metrics?.campaigns_yesterday || []).map((c: any) => ({
          name: c.name, spend: c.spend, purchases: c.purchases, daily_budget: c.daily_budget,
        })),
        real_profit_then: p.metrics?.cost_model?.est_profit_yesterday ?? null,
      }));
    } catch (e) { console.warn('recent briefs load failed', e); }

    const metrics = {
      report_for: reportFor,
      account_id: META_AD_ACCOUNT_ID,
      account_yesterday,
      revenue_crosscheck,
      cost_model,
      campaigns_yesterday,
      campaigns_last_7d,
      recent_briefs,
      note_timezone: `report_for "${reportFor}" is the owner's PACIFIC day labeled by its 9am start: ${reportFor} 9:00am → next-day 9:00am Pacific (one Meta/Manila ad-day). Spend and revenue both cover that exact window — ROAS is apples-to-apples and the date matches the owner's LA calendar + Stripe.`,
    };

    // ---- 3. Claude brief ----
    const brief = await runBrief(metrics);
    // Defensive: forced tool-use occasionally returns arrays as JSON STRINGS
    // (same drift that crashed chief-of-staff-daily 2026-06-26). Coerce so the
    // renderer and report never die on it.
    const coerceArr = (x: any) => {
      if (typeof x === 'string') { try { const p = JSON.parse(x); return Array.isArray(p) ? p : []; } catch { return []; } }
      return Array.isArray(x) ? x : [];
    };
    brief.campaigns = coerceArr(brief.campaigns);
    brief.recommendations = coerceArr(brief.recommendations);

    // ---- 4. Store + email ----
    await supabase.from('media_buyer_reports').upsert({
      report_for: reportFor, account_id: META_AD_ACCOUNT_ID,
      metrics, analysis: brief, email_sent: false,
    }, { onConflict: 'report_for,account_id' });

    const emailed = await sendEmail(
      `📊 Media Buyer — ${brief.headline.slice(0, 80)}`,
      renderEmail(brief, metrics, reportFor),
    );

    if (emailed) {
      await supabase.from('media_buyer_reports')
        .update({ email_sent: true })
        .eq('report_for', reportFor).eq('account_id', META_AD_ACCOUNT_ID);
    }

    // ---- 5. Auto-grade Sofía's due open calls (fail-soft, never blocks the brief) ----
    let callsGraded = 0;
    try { callsGraded = await gradeOpenCalls(supabase); } catch (e) { console.warn('gradeOpenCalls failed', e); }

    await supabase.from('agent_runs').insert({
      agent: 'media-buyer', status: 'ok', ok: true,
      summary: `${brief.headline} (${real_orders} real orders, ${money(spend)} spend)`,
      payload: { report_for: reportFor, account_health: brief.account_health, recommendations: brief.recommendations?.length || 0, emailed, calls_graded: callsGraded, est_profit: cost_model?.est_profit_yesterday ?? null },
      finished_at: new Date().toISOString(), execution_ms: Date.now() - startTime,
    });

    return json(200, { success: true, report_for: reportFor, account_health: brief.account_health, emailed });
  } catch (e: any) {
    console.error('[media-buyer-daily] error:', e?.message || e);
    await supabase.from('agent_runs').insert({
      agent: 'media-buyer', status: 'error', ok: false,
      error: String(e?.message || e).slice(0, 800),
      finished_at: new Date().toISOString(), execution_ms: Date.now() - startTime,
    }).then(() => {}, () => {});
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
