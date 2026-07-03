// supabase/functions/media-buyer-intraday/index.ts
// ===========================================================================
// MEDIA BUYER — INTRADAY WATCHDOG (reactive half of the media buyer)
// ===========================================================================
// Runs every ~3 hours via pg_cron. Deterministic (no LLM): pulls TODAY's Meta
// numbers + today's REAL paid orders and fires an SMS/email alert the moment
// money is being wasted, instead of the owner finding out in tomorrow's brief:
//
//   • Account is spending with ZERO real sales today (past a $ threshold)
//   • A single campaign burned $X today with zero pixel purchases
//   • Real ROAS today has collapsed below a floor at meaningful spend
//   • The Meta token is dead (401/403) — which silently blinds every ad agent
//
// READ-ONLY: never writes to the ad account. Alerts are throttled through
// ops_alert_state (same mechanism as health-check) so a bad day pings the
// owner once per window, not every 3 hours.
//
// verify_jwt = false (pg_cron) — see supabase/config.toml.
// Deploy: supabase functions deploy media-buyer-intraday --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN');
const META_AD_ACCOUNT_ID = Deno.env.get('META_AD_ACCOUNT_ID') || 'act_832413711748940';
const META_API_VERSION = Deno.env.get('META_API_VERSION') || 'v21.0';
// Same ad-day boundary as media-buyer-daily: the ad account is permanently on
// Asia/Manila, so "today" for spend AND revenue is the Manila calendar day.
const REVENUE_TZ = Deno.env.get('MEDIA_BUYER_TZ') || Deno.env.get('META_AD_TZ') || 'Asia/Manila';
const RQC_PLATFORM = Deno.env.get('MEDIA_BUYER_PLATFORM') || 'es';
const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || 'hola@regalosquecantan.com';
const ALERT_SMS_TO = Deno.env.get('ALERT_SMS_TO');

// Thresholds (env-overridable, USD)
const SPEND_NO_SALES = Number(Deno.env.get('INTRADAY_SPEND_NO_SALES') || 60);          // account spend today w/ 0 real orders
const CAMPAIGN_SPEND_NO_PURCHASES = Number(Deno.env.get('INTRADAY_CAMPAIGN_SPEND') || 40); // one campaign, 0 pixel purchases
const ROAS_FLOOR = Number(Deno.env.get('INTRADAY_ROAS_FLOOR') || 0.8);                 // real ROAS floor…
const ROAS_FLOOR_MIN_SPEND = Number(Deno.env.get('INTRADAY_ROAS_MIN_SPEND') || 100);   // …once spend passes this

const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

function num(x: any): number { const n = Number(x); return Number.isFinite(n) ? n : 0; }

function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a: any, x) => (a[x.type] = x.value, a), {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime();
}

function startOfTzToday(tz: string): Date {
  const now = new Date();
  const off = tzOffsetMs(now, tz);
  const wall = new Date(now.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);
  let utc = new Date(wall.getTime() - off);
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off) utc = new Date(wall.getTime() - off2);
  return utc;
}

async function metaGet(path: string, params: Record<string, string>): Promise<{ ok: boolean; status: number; data?: any; body?: string }> {
  const qs = new URLSearchParams({ ...params, access_token: META_ACCESS_TOKEN! });
  const res = await fetch(`${META_BASE}/${path}?${qs.toString()}`);
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 300) };
  return { ok: true, status: res.status, data: await res.json() };
}

function purchasesOf(row: any): number {
  const find = (t: string) => {
    const hit = Array.isArray(row.actions) ? row.actions.find((a: any) => a.action_type === t) : null;
    return hit ? Number(hit.value || 0) : 0;
  };
  return find('purchase') || find('omni_purchase');
}

// Alert once per `hours` per key (shared ops_alert_state table).
async function shouldAlert(supabase: any, key: string, hours: number): Promise<boolean> {
  try {
    const { data } = await supabase.from('ops_alert_state').select('last_alerted_at').eq('key', key).maybeSingle();
    if (data && Date.now() - new Date(data.last_alerted_at).getTime() < hours * 3600 * 1000) return false;
    await supabase.from('ops_alert_state').upsert({ key, last_alerted_at: new Date().toISOString() });
    return true;
  } catch { return true; }
}

async function alertOwner(subject: string, message: string) {
  const jobs: Promise<unknown>[] = [];
  if (ALERT_SMS_TO) jobs.push(sendSms(ALERT_SMS_TO, message).then((r) => { if (!r.ok) console.warn('SMS failed:', r.error); }));
  if (SENDGRID_API_KEY) {
    jobs.push(fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
        from: { email: 'hola@regalosquecantan.com', name: 'RQC Media Buyer' },
        subject,
        content: [{ type: 'text/plain', value: message }],
        categories: ['media_buyer_intraday', 'rqc_internal'],
        tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false }, subscription_tracking: { enable: false } },
      }),
    }));
  }
  await Promise.allSettled(jobs);
}

Deno.serve(async (_req: Request) => {
  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const json = (s: number, b: any) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

  if (Deno.env.get('MEDIA_BUYER_ENABLED') === 'false') return json(200, { ok: true, skipped: 'disabled' });
  if (!META_ACCESS_TOKEN) return json(200, { ok: true, skipped: 'META_ACCESS_TOKEN missing' });

  try {
    // ---- Today's Meta numbers (account + campaigns) ----
    const [acct, camps] = await Promise.all([
      metaGet(`${META_AD_ACCOUNT_ID}/insights`, { level: 'account', date_preset: 'today', fields: 'spend,actions', limit: '1' }),
      metaGet(`${META_AD_ACCOUNT_ID}/insights`, { level: 'campaign', date_preset: 'today', fields: 'campaign_name,spend,actions', limit: '100' }),
    ]);

    // Token dead = every ad agent is blind. Loudest alert, throttled 12h.
    if ((!acct.ok && (acct.status === 401 || acct.status === 403)) || (!camps.ok && (camps.status === 401 || camps.status === 403))) {
      if (await shouldAlert(supabase, 'meta-token-dead', 12)) {
        await alertOwner('🔴 Meta access token problem', `🔴 Meta API rejected the access token (${acct.status || camps.status}). The Media Buyer, Sofía's ad tools and ad reporting are BLIND until it's renewed.\n\n${(acct.body || camps.body || '').slice(0, 200)}`);
      }
      return json(200, { ok: false, alert: 'meta token' });
    }
    if (!acct.ok || !camps.ok) throw new Error(`Meta error ${acct.status}/${camps.status}: ${acct.body || camps.body}`);

    const accRow = (acct.data.data || [])[0] || {};
    const spendToday = num(accRow.spend);

    // ---- Today's REAL orders (same Manila ad-day, deduped per session) ----
    const dayStartISO = startOfTzToday(REVENUE_TZ).toISOString();
    const { data: paidRows } = await supabase
      .from('songs')
      .select('stripe_session_id, amount_paid')
      .eq('paid', true)
      .eq('platform', RQC_PLATFORM)
      .gte('paid_at', dayStartISO)
      .not('stripe_session_id', 'is', null);
    const perSession = new Map<string, number>();
    for (const r of paidRows || []) {
      const amt = num(r.amount_paid);
      if (!perSession.has(r.stripe_session_id) || amt > perSession.get(r.stripe_session_id)!) perSession.set(r.stripe_session_id, amt);
    }
    const ordersToday = perSession.size;
    const revenueToday = [...perSession.values()].reduce((a, b) => a + b, 0);
    const roasToday = spendToday > 0 ? revenueToday / spendToday : null;

    const issues: string[] = [];

    if (spendToday >= SPEND_NO_SALES && ordersToday === 0) {
      issues.push(`💸 $${spendToday.toFixed(0)} spent today with ZERO real sales.`);
    }

    for (const c of camps.data.data || []) {
      const cSpend = num(c.spend);
      if (cSpend >= CAMPAIGN_SPEND_NO_PURCHASES && purchasesOf(c) === 0) {
        issues.push(`🕳️ "${c.campaign_name}": $${cSpend.toFixed(0)} today, 0 purchases (pixel).`);
      }
    }

    if (roasToday != null && spendToday >= ROAS_FLOOR_MIN_SPEND && roasToday < ROAS_FLOOR) {
      issues.push(`📉 Real ROAS today is ${roasToday.toFixed(2)}x ($${revenueToday.toFixed(0)} rev / $${spendToday.toFixed(0)} spend) — below the ${ROAS_FLOOR}x floor.`);
    }

    let alerted = false;
    if (issues.length && await shouldAlert(supabase, 'intraday-ad-alarm', 6)) {
      alerted = true;
      await alertOwner(
        '🟡 Ads need a look today',
        `🟡 Media Buyer intraday check:\n\n${issues.join('\n')}\n\nSo far today: $${spendToday.toFixed(0)} spend · ${ordersToday} real orders · $${revenueToday.toFixed(0)} revenue. Nothing was changed — review in Ads Manager or ask Sofía.`,
      );
    }

    return json(200, { ok: true, spend_today: spendToday, orders_today: ordersToday, issues, alerted, execution_ms: Date.now() - started });
  } catch (e: any) {
    console.error('[media-buyer-intraday]', e?.message || e);
    return json(500, { ok: false, error: String(e?.message || e).slice(0, 300) });
  }
});
