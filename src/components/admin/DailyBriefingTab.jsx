// src/components/admin/DailyBriefingTab.jsx
// Daily Briefing — a grid of dated boxes (one per morning brief). Click a box
// to open that day's full, easy-to-read report. Reads media_buyer_reports via
// daily-briefing-admin. Admin-only.
import React, { useState, useEffect, useCallback } from 'react';
import { Newspaper, RefreshCw, Loader2, AlertTriangle, ArrowLeft, ChevronRight } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-briefing-admin`;

const HEALTH = {
  healthy: { label: 'Healthy', cls: 'bg-green-100 text-green-800', bar: '#16a34a', dot: '#16a34a' },
  watch:   { label: 'Watch',   cls: 'bg-amber-100 text-amber-800', bar: '#f59e0b', dot: '#f59e0b' },
  at_risk: { label: 'At risk', cls: 'bg-red-100 text-red-700',     bar: '#dc2626', dot: '#dc2626' },
};
const VERDICT = {
  scale: '🔼 Scale', keep: '✅ Keep', watch: '👀 Watch',
  trim: '🔻 Trim', fix: '🛠️ Fix', off: '⚫ Off',
};
const m = (n) => (n == null || isNaN(n) ? '—' : `$${Number(n).toFixed(2)}`);

// 'YYYY-MM-DD' -> { wd:'Wed', md:'Jun 24', full:'Wednesday, June 24' } (no TZ shift)
function fmtDate(ymd) {
  if (!ymd) return { wd: '', md: '', full: '' };
  const [y, mo, d] = ymd.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  return {
    wd: dt.toLocaleDateString('en-US', { weekday: 'short' }),
    md: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    full: dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  };
}

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
  const [selectedId, setSelectedId] = useState(null);
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
        body: JSON.stringify({ limit: 30 }),
      });
      const r = await res.json();
      if (r.success) { setReports(r.reports || []); setLastRun(r.last_run || null); }
      else if (res.status === 403) setDenied(true);
      else showToast?.(`Error: ${r.error || 'could not load'}`);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [accessToken, showToast]);

  useEffect(() => { load(); }, [load]);

  if (denied) return <div className="text-gray-400 py-16 text-center">This briefing is available to admins only.</div>;

  const rep = reports.find((r) => r.id === selectedId);

  // ---- DETAIL VIEW ----
  if (rep) {
    const a = rep.analysis || {};
    const mt = rep.metrics || {};
    const rc = mt.revenue_crosscheck || {};
    const acc = mt.account_yesterday || {};
    const health = HEALTH[a.account_health] || HEALTH.watch;
    const camps = mt.campaigns_last_7d || [];
    const d = fmtDate(rep.report_for);
    return (
      <div className="max-w-4xl">
        <button onClick={() => setSelectedId(null)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
          <ArrowLeft size={16} /> All briefings
        </button>

        <div className="flex items-center gap-3 mb-2">
          <span className={`text-xs px-2 py-1 rounded-full ${health.cls}`}>{health.label}</span>
          <span className="text-sm text-gray-700 font-medium">{d.full}</span>
          {rep.email_sent && <span className="text-xs text-gray-400">· emailed</span>}
        </div>
        <div className="text-base text-gray-900 font-medium border-l-4 pl-3 mb-3" style={{ borderColor: health.bar }}>
          {a.headline}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed mb-5">{a.account_summary}</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <Metric label="Spend" value={m(acc.spend)} />
          <Metric label="Real orders" value={rc.real_orders ?? '—'} sub={`Meta said ${rc.meta_reported_purchases ?? '—'}`} />
          <Metric label="Revenue" value={m(rc.real_revenue)} />
          <Metric label="Cost / sale" value={m(rc.real_cpa)} />
          <Metric label="ROAS" value={rc.real_roas != null ? `${Number(rc.real_roas).toFixed(2)}x` : '—'} />
          <Metric label="CTR" value={acc.ctr != null ? `${acc.ctr}%` : '—'} />
        </div>

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
      </div>
    );
  }

  // ---- LIST VIEW (dated boxes) ----
  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Newspaper size={22} className="text-gray-700" /> Daily Briefing
          </h2>
          <p className="text-sm text-gray-500 mt-1">A new brief lands every morning at 9am Pacific. Click any day to read the full report.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {lastRun?.status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          <AlertTriangle size={15} /> Last run errored: {lastRun.error?.slice(0, 160)}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : reports.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          No briefs yet. The first one lands at 9am Pacific.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {reports.map((r, idx) => {
            const a = r.analysis || {};
            const rc = (r.metrics || {}).revenue_crosscheck || {};
            const acc = (r.metrics || {}).account_yesterday || {};
            const health = HEALTH[a.account_health] || HEALTH.watch;
            const d = fmtDate(r.report_for);
            return (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span style={{ background: health.dot }} className="w-2 h-2 rounded-full inline-block" />
                    <span className="text-sm font-semibold text-gray-900">{d.wd} · {d.md}</span>
                    {idx === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-900 text-white">Latest</span>}
                  </div>
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500" />
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${health.cls}`}>{health.label}</span>
                <p className="text-sm text-gray-700 mt-2 leading-snug line-clamp-2">{a.headline}</p>
                <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-400">
                  <span>{m(acc.spend)} spend</span>
                  <span>{rc.real_orders ?? '—'} orders</span>
                  <span>{rc.real_roas != null ? `${Number(rc.real_roas).toFixed(2)}x` : '—'} ROAS</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
