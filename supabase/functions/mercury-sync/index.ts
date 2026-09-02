// supabase/functions/mercury-sync/index.ts
// ===========================================================================
// MERCURY SYNC — pulls every bank transaction into mercury_transactions
// ===========================================================================
// Runs nightly via pg_cron (see CRON_SETUP.sql) and on-demand from the
// Finance tab (finance-data proxies with the service key). First run
// backfills MERCURY_BACKFILL_MONTHS (default 24) of history; after that each
// run re-pulls a 7-day overlap window so pending→sent status flips and late
// postings self-heal.
//
// SAFETY: MERCURY_API_TOKEN must be a READ-ONLY token (no IP whitelist
// needed; a read-write token requires one we can't provide from edge
// functions anyway). This function only ever GETs. The nightly run also
// keeps the token alive — Mercury auto-deletes tokens unused for 45 days.
//
// Alerts: any single NEW debit ≥ MERCURY_ALERT_DEBIT_USD (default $500,
// owner-set 2026-09-02) fires the health-check WhatsApp+email channel.
// Backfill runs and transactions older than 72h never alert (no spam storm
// on first sync), and a run sends at most 5 alerts.
//
// verify_jwt = false (pg_cron caller — pinned in supabase/config.toml).
// Response carries counts only, never transaction data.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MERCURY_API_TOKEN = Deno.env.get('MERCURY_API_TOKEN');
const MERCURY_BASE = 'https://api.mercury.com/api/v1';
const BACKFILL_MONTHS = Number(Deno.env.get('MERCURY_BACKFILL_MONTHS')) || 24;
const ALERT_DEBIT_USD = Number(Deno.env.get('MERCURY_ALERT_DEBIT_USD')) || 500;

// Same alert channel as health-check.
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM');
const ALERT_WHATSAPP_TO = Deno.env.get('ALERT_WHATSAPP_TO');
const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || 'hola@regalosquecantan.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function mercuryGet(path: string) {
  const res = await fetch(`${MERCURY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${MERCURY_API_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Mercury ${path.split('?')[0]} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Normalize a counterparty for rule matching: lowercase, collapse whitespace,
// strip everything but letters/digits/spaces.
function cleanCounterparty(name: string | null | undefined): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Mercury's own category enum → our P&L buckets (rules take precedence).
const MERCURY_CATEGORY_MAP: Record<string, string> = {
  'Advertising': 'ads_other',
  'Software': 'software_tools',
  'Bank Fees': 'fees_bank',
  'Fees': 'fees_bank',
  'Taxes': 'taxes',
};

type Rule = { id: string; pattern: string; category: string; priority: number };
function categorize(clean: string, mercuryCategory: string | null, rules: Rule[]): { category: string; source: string } {
  for (const r of rules) {
    if (r.pattern && clean.includes(r.pattern)) return { category: r.category, source: 'rule' };
  }
  if (mercuryCategory && MERCURY_CATEGORY_MAP[mercuryCategory]) {
    return { category: MERCURY_CATEGORY_MAP[mercuryCategory], source: 'mercury' };
  }
  return { category: 'other', source: 'default' };
}

async function sendBigDebitAlert(txn: { counterparty_name: string | null; amount: number; created_at_mercury: string | null; kind: string | null }) {
  const usd = Math.abs(txn.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const who = txn.counterparty_name || 'Unknown counterparty';
  const when = txn.created_at_mercury ? new Date(txn.created_at_mercury).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) : 'unknown time';
  const title = `Mercury: ${usd} debit — ${who}`;
  const body = `${usd} left the bank account.\nTo: ${who}\nType: ${txn.kind || 'unknown'}\nWhen: ${when}\n\nReview it in the admin Finance tab or on mercury.com.`;

  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM && ALERT_WHATSAPP_TO) {
    try {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: TWILIO_WHATSAPP_FROM, To: ALERT_WHATSAPP_TO, Body: `🟡 ${title}\n\n${body}` }).toString(),
      });
    } catch (e) { console.error('WhatsApp alert error:', e); }
  }
  if (SENDGRID_API_KEY) {
    try {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SENDGRID_API_KEY}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
          from: { email: 'hola@regalosquecantan.com', name: 'RQC Finance' },
          subject: `🟡 ${title}`,
          content: [{ type: 'text/plain', value: body }],
          categories: ['finance_alert', 'rqc_internal'],
          tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false }, subscription_tracking: { enable: false } },
        }),
      });
    } catch (e) { console.error('Email alert error:', e); }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const fail = async (msg: string, status = 500) => {
    console.error('mercury-sync failed:', msg);
    await admin.from('mercury_sync_state').update({ last_error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', 1);
    return json({ success: false, error: msg }, status);
  };

  try {
    if (!MERCURY_API_TOKEN) return await fail('MERCURY_API_TOKEN is not set (create a READ-ONLY token on mercury.com → Settings → API tokens).', 200);

    // ── Accounts + live balances ──────────────────────────────────────────
    const accData = await mercuryGet('/accounts');
    const accounts: any[] = accData?.accounts || [];
    const ownAccountIds = new Set(accounts.map((a) => a.id));
    for (const a of accounts) {
      await admin.from('mercury_accounts').upsert({
        id: a.id,
        name: a.name || a.nickname || null,
        kind: a.kind || a.type || null,
        status: a.status || null,
        current_balance: a.currentBalance ?? null,
        available_balance: a.availableBalance ?? null,
        raw: a,
        synced_at: new Date().toISOString(),
      });
    }

    // ── Sync window ───────────────────────────────────────────────────────
    const { data: state } = await admin.from('mercury_sync_state').select('*').eq('id', 1).maybeSingle();
    const isBackfill = !state?.backfill_done;
    const startDate = new Date();
    if (isBackfill) startDate.setMonth(startDate.getMonth() - BACKFILL_MONTHS);
    else startDate.setTime((state?.last_synced_at ? new Date(state.last_synced_at).getTime() : Date.now()) - 7 * 24 * 3600 * 1000);
    const start = startDate.toISOString().slice(0, 10);

    const { data: ruleRows } = await admin.from('mercury_category_rules')
      .select('id, pattern, category, priority').order('priority', { ascending: true }).order('created_at', { ascending: false });
    const rules: Rule[] = ruleRows || [];

    // ── Pull transactions (cursor-paginated, ascending) ───────────────────
    const PAGE = 500;
    let cursor: string | null = null;
    let inserted = 0, updated = 0, alertsSent = 0;
    const alertCutoff = Date.now() - 72 * 3600 * 1000;

    for (let page = 0; page < 200; page++) { // hard stop: 100k txns
      const qs = new URLSearchParams({ start, limit: String(PAGE), order: 'asc' });
      if (cursor) qs.set('start_after', cursor);
      const data = await mercuryGet(`/transactions?${qs.toString()}`);
      const txns: any[] = data?.transactions || [];
      if (txns.length === 0) break;
      cursor = txns[txns.length - 1].id;

      const ids = txns.map((t) => t.id);
      const { data: existingRows } = await admin.from('mercury_transactions')
        .select('id, category_source, alerted_at').in('id', ids);
      const existing = new Map((existingRows || []).map((r) => [r.id, r]));

      for (const t of txns) {
        const clean = cleanCounterparty(t.counterpartyNickname || t.counterpartyName);
        // Internal moves between our own Mercury accounts double-count the
        // P&L, so flag and exclude them. That INCLUDES Mercury Credit card
        // bill payments: the card's individual charges (Meta ads etc.) are
        // already counted, so the monthly payment from checking is just money
        // moving between our own pockets (verified against live data
        // 2026-09-02 — these were inflating "fees" by ~$25-35k/mo).
        const isTransfer = t.kind === 'internalTransfer'
          || (t.counterpartyId && ownAccountIds.has(t.counterpartyId))
          || /^mercury (credit|checking|savings|treasury|vault)/.test(clean);
        const prior = existing.get(t.id);
        const base = {
          account_id: t.accountId,
          amount: t.amount,
          counterparty_name: t.counterpartyName || t.counterpartyNickname || null,
          counterparty_clean: clean,
          status: t.status || null,
          kind: t.kind || null,
          mercury_category: t.mercuryCategory || null,
          bank_description: t.bankDescription || null,
          note: t.note || null,
          created_at_mercury: t.createdAt || null,
          posted_at: t.postedAt || null,
          is_transfer: !!isTransfer,
          dashboard_link: t.dashboardLink || null,
          raw: t,
          synced_at: new Date().toISOString(),
        };

        if (prior) {
          // Re-sync mutable bank fields; NEVER touch category fields the
          // owner (manual) or a rule already set — re-run the categorizer
          // only for rows still on the fallback bucket.
          const patch: Record<string, unknown> = { ...base };
          if (prior.category_source === 'default' || prior.category_source === 'mercury') {
            const c = categorize(clean, t.mercuryCategory || null, rules);
            patch.category = c.category; patch.category_source = c.source;
          }
          const { error } = await admin.from('mercury_transactions').update(patch).eq('id', t.id);
          if (!error) updated++;
        } else {
          const c = categorize(clean, t.mercuryCategory || null, rules);
          const { error } = await admin.from('mercury_transactions')
            .insert({ id: t.id, ...base, category: c.category, category_source: c.source });
          if (!error) {
            inserted++;
            // Big-debit alert: new, recent, not a transfer, not dead-on-arrival.
            const isRecent = t.createdAt && new Date(t.createdAt).getTime() >= alertCutoff;
            const isLive = !['cancelled', 'failed'].includes(t.status);
            if (!isBackfill && isRecent && isLive && !isTransfer && t.amount <= -ALERT_DEBIT_USD && alertsSent < 5) {
              alertsSent++;
              await sendBigDebitAlert(base as any);
              await admin.from('mercury_transactions').update({ alerted_at: new Date().toISOString() }).eq('id', t.id);
            }
          }
        }
      }
      if (txns.length < PAGE) break;
    }

    await admin.from('mercury_sync_state').update({
      last_synced_at: new Date().toISOString(),
      backfill_done: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);

    console.log(`mercury-sync ok: ${accounts.length} accounts, +${inserted} new, ~${updated} refreshed, ${alertsSent} alerts (backfill=${isBackfill})`);
    return json({ success: true, accounts: accounts.length, inserted, updated, alerts_sent: alertsSent, backfill: isBackfill });
  } catch (e) {
    return await fail(String((e as Error)?.message || e));
  }
});
