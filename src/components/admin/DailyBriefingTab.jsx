// src/components/admin/DailyBriefingTab.jsx
// Daily Briefing — reads the Media Buyer's stored morning briefs
// (media_buyer_reports) and shows the latest one in the dashboard, with a date
// switcher for past days. Admin-only. Talks to daily-briefing-admin.
import React, { useState, useEffect, useCallback } from 'react';
import { Newspaper, RefreshCw, Loader2, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-briefing-admin`;

const HEALTH = {
  healthy: { label: 'Healthy', cls: 'bg-green-100 text-green-800', bar: '#16a34a' },
  watch:   { label: 'Watch',   cls: 'bg-amber-100 text-amber-800', bar: '#f59e0b' },
  at_risk: { label: 'At risk', cls: 'bg-red-100 text-red-700',     bar: '#dc2626' },
};
const VERDICT = {
  scale: '🔼 Scale', keep: '✅ Keep', watch: '👀 Watch',
  trim: '🔻 Trim', fix: '🛠️ Fix', off: '⚫ Off',
};
const m = (n) => (n == null || isNaN(n) ? '—' : `$${Number(n).toFixed(2)}`);

function Metric({ label, value, sub }) {
  return (
    <div style={{ background: '#f9fafb' }} className="rounded-lg p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

export default function DailyBriefingTab({ accessToken, showToast }) {
  const [reports, setReports] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(FN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ limit: 14 }),
      });
      const r = await res.json();
      if (r.success) { setReports(r.reports || []); setLastRun(r.last_run || null); setIdx(0); }
      else if (res.status === 403) setDenied(true);
      else showToast?.(`Error: ${r.error || 'no se pudo cargar'}`);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [accessToken, showToast]);

  useEffect(() => { load(); }, [load]);

  if (denied) return <div className="text-gray-400 py-16 text-center">This briefing is available to admins only.</div>;

  const rep = reports[idx];
  const a = rep?.analysis || {};
  const mt = rep?.metrics || {};
  const rc = mt.revenue_crosscheck || {};
  const acc = mt.account_yesterday || {};
  const health = HEALTH[a.account_health] || HEALTH.watch;
  const camps = mt.campaigns_last_7d || [];

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Newspaper size={22} className="text-gray-700" /> Daily Briefing
          </h2>
          <p className="text-sm text-gray-500 mt-1">Your Media Buyer's morning brief — ad performance vs. real revenue, with recommended moves. Generated automatically at 9am Pacific.</p>
        </div>
        <div className="flex items-center gap-2">
          {reports.length > 1 && (
            <select value={idx} onChange={(e) => setIdx(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
              {reports.map((r, i) => <option key={r.id} value={i}>{r.report_for}</option>)}
            </select>
          )}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {lastRun?.status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          <AlertTriangle size={15} /> Last run errored: {lastRun.error?.slice(0, 160)}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : !rep ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          No briefs yet. The first one generates at 9am Pacific (or run the Media Buyer manually).
        </div>
      ) : (
        <>
          {/* Headline + health */}
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-xs px-2 py-1 rounded-full ${health.cls}`}>{health.label}</span>
            <span className="text-xs text-gray-400">For {rep.report_for}{rep.email_sent ? ' · emailed' : ''}</span>
          </div>
          <div className="text-base text-gray-900 font-medium border-l-4 pl-3 mb-3" style={{ borderColor: health.bar }}>
            {a.headline}
          </div>
          <p className="text-sm text-gray-600 leading-relaxed mb-5">{a.account_summary}</p>

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <Metric label="Spend (yesterday)" value={m(acc.spend)} />
            <Metric label="Real orders" value={rc.real_orders ?? '—'} sub={`Meta said ${rc.meta_reported_purchases ?? '—'}`} />
            <Metric label="Revenue" value={m(rc.real_revenue)} />
            <Metric label="Cost / sale" value={m(rc.real_cpa)} />
            <Metric label="ROAS" value={rc.real_roas != null ? `${Number(rc.real_roas).toFixed(2)}x` : '—'} />
            <Metric label="CTR" value={acc.ctr != null ? `${acc.ctr}%` : '—'} />
          </div>

          {/* Recommendations */}
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Recommended moves <span className="text-gray-400 font-normal text-xs">— staged for your approval, nothing applied</span></h3>
          <div className="space-y-2 mb-6">
            {(a.recommendations || []).map((r, i) => (
              <div key={i} className="flex gap-3 bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-gray-300 font-bold text-sm">{r.priority ?? i + 1}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{r.action}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{r.rationale}</div>
                </div>
                {r.type && <span className="text-[10px] uppercase tracking-wide text-gray-400 self-start">{r.type}</span>}
              </div>
            ))}
          </div>

          {/* Campaign table */}
          {camps.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Last 7 days by campaign</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs">
                      <th className="py-2 pr-3">Campaign</th>
                      <th className="py-2 px-3 text-right">Spend</th>
                      <th className="py-2 px-3 text-right">Sales</th>
                      <th className="py-2 px-3 text-right">$/sale</th>
                      <th className="py-2 px-3 text-right">CTR</th>
                      <th className="py-2 pl-3">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {camps.map((c, i) => {
                      const v = (a.campaigns || []).find((x) => x.name === c.name)?.verdict;
                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="py-2 pr-3 text-gray-800">{c.name}</td>
                          <td className="py-2 px-3 text-right">{m(c.spend)}</td>
                          <td className="py-2 px-3 text-right">{c.purchases}</td>
                          <td className="py-2 px-3 text-right">{m(c.meta_cpa)}</td>
                          <td className="py-2 px-3 text-right">{c.ctr}%</td>
                          <td className="py-2 pl-3 whitespace-nowrap text-gray-700">{VERDICT[v] || ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {a.data_caveats && <p className="text-[11px] text-gray-400 mt-5 border-t border-gray-100 pt-3">{a.data_caveats}</p>}
        </>
      )}
    </div>
  );
}
