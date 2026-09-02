// src/components/admin/FinanceTab.jsx
// Finance — the Mercury bank P&L tab (OWNER-only; assistants never see it and
// the finance-data edge function rejects them server-side too).
//
// Shows every dollar in and out of the business bank account: live balances,
// month-by-month P&L by category, 90-day cash-flow, top vendors, and the full
// transaction ledger with one-tap recategorization (which mints a vendor rule
// so the same counterparty stays categorized forever).
//
// Server: finance-data (reads + recategorize + sync trigger). The data itself
// is pulled nightly from Mercury's API by mercury-sync using a READ-ONLY
// token — this system is architecturally unable to move money.
// Design doc: docs/pnl-financial-agent-mercury.md
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Landmark, RefreshCw, Loader2, AlertTriangle, ExternalLink, Search } from 'lucide-react';
import { Card, Badge, SectionLabel, Stat, btn } from './ui';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const CATEGORY_LABELS = {
  revenue_stripe: 'Stripe payouts',
  revenue_other: 'Other income',
  ads_meta: 'Meta ads',
  ads_other: 'Other ads',
  ai_apis: 'AI APIs (Kie, Mureka, Anthropic…)',
  infra: 'Infrastructure (Supabase, Vercel…)',
  messaging: 'Messaging (Twilio, SendGrid)',
  software_tools: 'Software & tools',
  fees_bank: 'Bank fees',
  refunds_chargebacks: 'Refunds & chargebacks',
  owner_draw: 'Owner draw',
  taxes: 'Taxes',
  other: 'Uncategorized / other',
};
const REVENUE_CATS = new Set(['revenue_stripe', 'revenue_other']);

const usd = (n, opts = {}) =>
  (n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...opts });
const usdCents = (n) => usd(n, { maximumFractionDigits: 2 });

export default function FinanceTab({ accessToken, showToast }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [txns, setTxns] = useState([]);
  const [txnFilter, setTxnFilter] = useState({ category: '', search: '' });
  const [searchDraft, setSearchDraft] = useState('');
  const [txnLoading, setTxnLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const call = useCallback(async (body) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/finance-data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [accessToken]);

  const loadOverview = useCallback(async () => {
    setError('');
    try {
      const d = await call({ action: 'overview' });
      setOverview(d);
    } catch (e) { setError(e.message || 'Could not load finance data.'); }
    finally { setLoading(false); }
  }, [call]);

  const loadTxns = useCallback(async (filter, append = false, offset = 0) => {
    setTxnLoading(true);
    try {
      const d = await call({
        action: 'transactions', limit: 100, offset,
        category: filter.category || undefined, search: filter.search || undefined,
      });
      setTxns((prev) => (append ? [...prev, ...d.transactions] : d.transactions));
      setHasMore(d.transactions.length === 100);
    } catch (e) { showToast?.(e.message || 'Could not load transactions', 'error'); }
    finally { setTxnLoading(false); }
  }, [call, showToast]);

  useEffect(() => { if (accessToken) { loadOverview(); loadTxns(txnFilter); } }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSync = async () => {
    setSyncing(true);
    try {
      const d = await call({ action: 'sync' });
      showToast?.(`Synced — ${d.inserted ?? 0} new, ${d.updated ?? 0} refreshed`, 'success');
      await loadOverview();
      await loadTxns(txnFilter);
    } catch (e) { showToast?.(e.message || 'Sync failed', 'error'); }
    finally { setSyncing(false); }
  };

  const recategorize = async (txn, category) => {
    try {
      const d = await call({ action: 'recategorize', id: txn.id, category, create_rule: true });
      setTxns((rows) => rows.map((r) =>
        r.counterparty_name === txn.counterparty_name && ['default', 'mercury'].includes(r.category_source)
          ? { ...r, category, category_source: 'rule' }
          : r.id === txn.id ? { ...r, category, category_source: 'manual' } : r,
      ));
      showToast?.(`Saved — rule applied to ${d.rule_applied_to} other ${txn.counterparty_name || 'vendor'} transactions`, 'success');
      loadOverview(); // rollups changed
    } catch (e) { showToast?.(e.message || 'Could not recategorize', 'error'); }
  };

  const applyFilter = (patch) => {
    const next = { ...txnFilter, ...patch };
    setTxnFilter(next);
    loadTxns(next);
  };

  // ── Derived numbers ─────────────────────────────────────────────────────
  const derived = useMemo(() => {
    if (!overview) return null;
    const balance = (overview.accounts || []).reduce((s, a) => s + Number(a.current_balance || 0), 0);
    const byMonth = {};
    for (const row of overview.pnl || []) {
      (byMonth[row.month] ||= {}).total = (byMonth[row.month].total || 0) + Number(row.total);
      byMonth[row.month][row.category] = Number(row.total);
    }
    const monthKeys = Object.keys(byMonth).sort().reverse();
    const thisMonth = monthKeys[0] ? byMonth[monthKeys[0]] : {};
    const monthIn = Object.entries(thisMonth).reduce((s, [k, v]) => (k !== 'total' && v > 0 ? s + v : s), 0);
    const monthOut = Object.entries(thisMonth).reduce((s, [k, v]) => (k !== 'total' && v < 0 ? s + -v : s), 0);
    // Runway: balance ÷ average net burn over the last 3 FULL months (skip the
    // current partial month). Cash-flow positive ⇒ no runway limit.
    const fullMonths = monthKeys.slice(1, 4).map((m) => byMonth[m].total || 0);
    const avgNet = fullMonths.length ? fullMonths.reduce((s, v) => s + v, 0) / fullMonths.length : 0;
    const runwayMonths = avgNet < 0 ? balance / -avgNet : null;
    return { balance, byMonth, monthKeys, monthIn, monthOut, monthNet: monthIn - monthOut, runwayMonths };
  }, [overview]);

  const maxFlow = useMemo(() => Math.max(1, ...(overview?.cashflow_daily || []).flatMap((d) => [Number(d.inflow), Number(d.outflow)])), [overview]);

  if (loading) {
    return <div className="flex items-center gap-2 text-gray-500 text-sm p-8"><Loader2 size={16} className="animate-spin" /> Loading finance data…</div>;
  }

  const syncState = overview?.sync_state;
  const neverSynced = !syncState?.last_synced_at;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ---- Header: what's in the bank ---- */}
      <Card className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><Landmark size={18} /></div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Finance — Mercury</h2>
              <p className="text-xs text-gray-500">
                Every dollar in and out of the business bank account. Read-only — nothing here can move money.
                {syncState?.last_synced_at && <> Last synced {new Date(syncState.last_synced_at).toLocaleString('en-US')}.</>}
              </p>
            </div>
          </div>
          <button onClick={runSync} disabled={syncing} className={btn.ghost}>
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync now
          </button>
        </div>

        {(error || syncState?.last_error) && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">
            <AlertTriangle size={15} /> {error || `Last sync error: ${syncState.last_error}`}
          </div>
        )}

        {neverSynced ? (
          <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="font-medium text-gray-900 mb-1">One-time setup needed</p>
            <p>1. On mercury.com → Settings → API Tokens, create a <b>Read Only</b> token (never Read-Write).</p>
            <p>2. Save it as the Supabase secret <code className="bg-white px-1 rounded">MERCURY_API_TOKEN</code>.</p>
            <p>3. Come back and hit <b>Sync now</b> — the first run backfills 24 months (can take a minute).</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Bank balance" value={usd(derived?.balance)} />
            <Stat label="This month in" value={usd(derived?.monthIn)} tone="green" />
            <Stat label="This month out" value={usd(derived?.monthOut)} tone="red" />
            <Stat
              label="Runway (3-mo avg burn)"
              value={derived?.runwayMonths == null ? 'Cash-flow positive' : `${derived.runwayMonths.toFixed(1)} months`}
              tone={derived?.runwayMonths != null && derived.runwayMonths < 6 ? 'red' : 'green'}
            />
          </div>
        )}

        {(overview?.accounts?.length || 0) > 1 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {overview.accounts.map((a) => (
              <Badge key={a.id} tone="gray">{a.name || a.kind}: {usd(Number(a.current_balance || 0))}</Badge>
            ))}
          </div>
        )}
      </Card>

      {/* ---- P&L by month ---- */}
      {!neverSynced && derived?.monthKeys?.length > 0 && (
        <Card className="p-5">
          <SectionLabel className="mb-3">P&L by month — bank actuals</SectionLabel>
          <div className="overflow-x-auto">
            <table className="text-sm w-full min-w-[560px]">
              <thead>
                <tr className="text-left text-xs text-gray-400">
                  <th className="py-1.5 pr-3 font-medium">Category</th>
                  {derived.monthKeys.slice(0, 6).map((m) => <th key={m} className="py-1.5 px-3 font-medium text-right">{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {(overview.categories || []).map((cat) => {
                  const hasData = derived.monthKeys.some((m) => derived.byMonth[m][cat]);
                  if (!hasData) return null;
                  return (
                    <tr key={cat} className="border-t border-gray-100">
                      <td className="py-1.5 pr-3 text-gray-700">{CATEGORY_LABELS[cat] || cat}</td>
                      {derived.monthKeys.slice(0, 6).map((m) => {
                        const v = derived.byMonth[m][cat] || 0;
                        return (
                          <td key={m} className={`py-1.5 px-3 text-right tabular-nums ${v > 0 ? 'text-green-700' : v < 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                            {v === 0 ? '—' : usd(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="py-2 pr-3 text-gray-900">Net</td>
                  {derived.monthKeys.slice(0, 6).map((m) => {
                    const v = derived.byMonth[m].total || 0;
                    return <td key={m} className={`py-2 px-3 text-right tabular-nums ${v >= 0 ? 'text-green-700' : 'text-red-600'}`}>{usd(v)}</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Cash view (when money actually moved), excludes internal transfers. Revenue here is Stripe's <i>net deposits</i> — after Stripe fees and refunds — so it will read lower than the dashboard's gross sales numbers.
          </p>
        </Card>
      )}

      {/* ---- 90-day cash-flow + top vendors ---- */}
      {!neverSynced && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="p-5">
            <SectionLabel className="mb-3">Cash-flow — last 90 days</SectionLabel>
            <div className="flex items-end gap-px h-28">
              {(overview.cashflow_daily || []).map((d) => (
                <div key={d.day} className="flex-1 flex flex-col justify-end gap-px min-w-0" title={`${d.day}: in ${usdCents(Number(d.inflow))}, out ${usdCents(Number(d.outflow))}`}>
                  <div className="bg-green-500/80 rounded-t-sm" style={{ height: `${(Number(d.inflow) / maxFlow) * 52}px` }} />
                  <div className="bg-red-400/80 rounded-b-sm" style={{ height: `${(Number(d.outflow) / maxFlow) * 52}px` }} />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500/80 inline-block" /> Money in</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400/80 inline-block" /> Money out</span>
            </div>
          </Card>
          <Card className="p-5">
            <SectionLabel className="mb-3">Top vendors — last 30 days</SectionLabel>
            <div className="space-y-1.5">
              {(overview.top_vendors_30d || []).map((v) => (
                <div key={v.counterparty} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 truncate mr-3">{v.counterparty} <span className="text-gray-400 text-xs">×{v.txn_count}</span></span>
                  <span className="tabular-nums text-gray-900 font-medium">{usd(Number(v.total_out))}</span>
                </div>
              ))}
              {(overview.top_vendors_30d || []).length === 0 && <p className="text-sm text-gray-400">No outflows in the last 30 days.</p>}
            </div>
          </Card>
        </div>
      )}

      {/* ---- Ledger ---- */}
      <Card className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <SectionLabel>Transactions</SectionLabel>
          <div className="flex items-center gap-2">
            <select value={txnFilter.category} onChange={(e) => applyFilter({ category: e.target.value })}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none">
              <option value="">All categories</option>
              {(overview?.categories || Object.keys(CATEGORY_LABELS)).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
            </select>
            <form onSubmit={(e) => { e.preventDefault(); applyFilter({ search: searchDraft }); }} className="flex items-center gap-1">
              <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search vendor…"
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 w-36 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              <button type="submit" className={btn.iconGhost} title="Search"><Search size={14} /></button>
            </form>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {txns.map((t) => (
            <div key={t.id} className={`py-2 flex items-center gap-3 text-sm ${['cancelled', 'failed'].includes(t.status) ? 'opacity-40' : ''}`}>
              <div className="w-20 flex-shrink-0 text-xs text-gray-400">
                {(t.posted_at || t.created_at_mercury || '').slice(0, 10)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-800 truncate">
                  {t.counterparty_name || t.bank_description || '(unknown)'}
                  {t.is_transfer && <Badge tone="gray" className="ml-2">transfer</Badge>}
                  {t.status === 'pending' && <Badge tone="amber" className="ml-2">pending</Badge>}
                  {['cancelled', 'failed', 'reversed', 'blocked'].includes(t.status) && <Badge tone="red" className="ml-2">{t.status}</Badge>}
                </p>
              </div>
              <select
                value={t.category}
                onChange={(e) => recategorize(t, e.target.value)}
                title="Change category — remembered for this vendor from now on"
                className="text-[11px] border border-gray-200 rounded-md px-1.5 py-1 text-gray-500 bg-white focus:outline-none max-w-[140px]"
              >
                {(overview?.categories || Object.keys(CATEGORY_LABELS)).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
              </select>
              <div className={`w-24 flex-shrink-0 text-right tabular-nums font-medium ${t.amount > 0 ? 'text-green-700' : 'text-gray-900'}`}>
                {usdCents(Number(t.amount))}
              </div>
              {t.dashboard_link && (
                <a href={t.dashboard_link} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-indigo-600" title="Open in Mercury">
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          ))}
          {txns.length === 0 && !txnLoading && <p className="text-sm text-gray-400 py-4">No transactions{txnFilter.category || txnFilter.search ? ' matching this filter' : ' yet — run a sync'}.</p>}
        </div>

        {hasMore && (
          <div className="mt-3">
            <button onClick={() => loadTxns(txnFilter, true, txns.length)} disabled={txnLoading} className={btn.ghost}>
              {txnLoading ? <Loader2 size={14} className="animate-spin" /> : null} Load more
            </button>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3">
          Changing a category also saves a rule for that vendor, so future (and past auto-categorized) transactions follow it.
        </p>
      </Card>
    </div>
  );
}
