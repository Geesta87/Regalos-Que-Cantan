// src/components/admin/EmailPerformanceSection.jsx
// "Performance" section of Creative Studio → Marketing — the Email Command
// Center. Reads the email-analytics function (pre-aggregated rollup) and renders
// the full agency view: KPIs, win-back engine, campaign leaderboard by family,
// flows-vs-blasts, deliverability, revenue trend, and alerts. Read-only.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Loader2, RefreshCw, TrendingUp, Mail, DollarSign,
  RotateCcw, ShieldCheck, AlertTriangle, CheckCircle2, Info, Zap,
} from 'lucide-react';
import { Card, Stat, SectionLabel, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-analytics`;

const RANGES = [[30, '30d'], [90, '90d'], [365, '1yr'], [100000, 'All']];
const FAMILIES = {
  win_back: 'Win-back & recovery',
  upsell: 'Upsell & add-ons',
  seasonal: 'Seasonal blasts',
  newsletter: 'Newsletter & marketing',
  transactional: 'Transactional',
  other: 'Other',
};

const usd = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString());
const usd2 = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctf = (n) => (n == null ? '—' : n + '%');
const intf = (n) => (n == null ? '—' : Number(n).toLocaleString());
const dateShort = (s) => { try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };

function KpiCard({ icon: Icon, label, value, sub, tone }) {
  const c = tone === 'good' ? 'text-green-600' : tone === 'bad' ? 'text-red-600' : 'text-gray-400';
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {Icon && <Icon size={13} className={c} />} {label}
      </div>
      <p className="text-2xl font-semibold text-gray-900 mt-1.5 leading-none">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
    </Card>
  );
}

// Tiny inline revenue trend (SVG area). No deps.
function Trend({ data }) {
  if (!data || data.length < 2) return null;
  const w = 640, h = 60, pad = 2;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => [pad + i * step, h - pad - (d.revenue / max) * (h - pad * 2)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-14">
      <polygon points={area} fill="rgba(79,70,229,0.08)" />
      <polyline points={line} fill="none" stroke="#4f46e5" strokeWidth="1.5" />
    </svg>
  );
}

const alertStyle = {
  good: { cls: 'bg-green-50 border-green-200', icon: CheckCircle2, ic: 'text-green-600' },
  warn: { cls: 'bg-amber-50 border-amber-200', icon: AlertTriangle, ic: 'text-amber-600' },
  critical: { cls: 'bg-red-50 border-red-200', icon: AlertTriangle, ic: 'text-red-600' },
  info: { cls: 'bg-gray-50 border-gray-200', icon: Info, ic: 'text-gray-500' },
};

function Bar({ value, max, tone = 'accent' }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  const bg = tone === 'flow' ? 'bg-indigo-500' : 'bg-amber-500';
  return <div className="h-2 rounded bg-gray-100 overflow-hidden"><div className={`h-full rounded ${bg}`} style={{ width: `${w}%` }} /></div>;
}

export default function EmailPerformanceSection({ accessToken, showToast }) {
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const res = await fetch(FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ days: d }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || 'Failed to load analytics');
      setData(j);
    } catch (e) {
      showToast?.(e.message || 'Failed to load email analytics', 'error');
    } finally {
      setLoading(false);
    }
  }, [accessToken, showToast]);

  useEffect(() => { load(days); }, [days, load]);

  const ov = data?.overview;
  const hd = data?.headline;
  const engReady = data?.meta?.engagement_ready;
  const trackedSince = data?.meta?.tracking_enabled_at;

  // group campaigns by family, in family order
  const grouped = {};
  (data?.campaigns || []).forEach((c) => { (grouped[c.family] ||= []).push(c); });
  const famOrder = Object.keys(FAMILIES).filter((f) => grouped[f]?.length);

  const flowsRev = data?.split?.flows?.revenue || 0;
  const blastsRev = data?.split?.blasts?.revenue || 0;
  const splitMax = Math.max(flowsRev, blastsRev, 1);

  return (
    <div>
      {/* Header + range */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Email Command Center</h3>
          <p className="text-xs text-gray-500">Every campaign, every dollar, list-health at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map(([d, l]) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm rounded-full transition ${days === d ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{l}</button>
            ))}
          </div>
          <button onClick={() => load(days)} className={btn.iconGhost} title="Refresh"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {/* engagement banner */}
      {!engReady && (
        <div className="flex items-start gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-4">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>Revenue &amp; conversions cover your full history. <strong>Opens &amp; clicks</strong> begin populating from {trackedSince ? dateShort(trackedSince) : 'now'} — capture was just turned on.</span>
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="animate-spin" size={24} /></div>
      ) : !data ? (
        <p className="text-sm text-gray-500 py-10 text-center">No data yet.</p>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
            <KpiCard icon={DollarSign} label="Email revenue" value={usd(ov.revenue)} sub={`${intf(ov.purchases)} purchases`} tone="good" />
            <KpiCard icon={RotateCcw} label="Carts recovered" value={intf(hd.win_back_recovered)} sub={usd(hd.win_back_revenue) + ' recovered'} tone="good" />
            <KpiCard icon={TrendingUp} label="Revenue / 1k" value={usd(ov.rev_per_1k)} />
            <KpiCard icon={Mail} label="Emails sent" value={intf(ov.sent)} sub={`${(data.campaigns || []).length} campaigns`} />
            <KpiCard icon={Zap} label="Open rate" value={pctf(ov.open_rate)} sub={ov.open_rate == null ? 'from capture' : 'unique'} />
            <KpiCard icon={ShieldCheck} label="Unsub rate" value={pctf(ov.unsub_rate)} tone={ov.unsub_rate != null && ov.unsub_rate < 0.3 ? 'good' : undefined} />
          </div>

          {/* Revenue trend */}
          <Card className="p-4 mb-5">
            <div className="flex items-center justify-between mb-1">
              <SectionLabel>Email revenue trend</SectionLabel>
              <span className="text-xs text-gray-400">last refresh {data.meta?.last_refresh ? dateShort(data.meta.last_refresh) : '—'}</span>
            </div>
            <Trend data={data.trend} />
          </Card>

          {/* Campaign leaderboard by family */}
          <Card className="p-0 mb-5 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><SectionLabel>Campaign leaderboard</SectionLabel></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="text-left font-medium px-4 py-2">Campaign</th>
                    <th className="text-right font-medium px-3 py-2">Sent</th>
                    <th className="text-right font-medium px-3 py-2">Open%</th>
                    <th className="text-right font-medium px-3 py-2">Click%</th>
                    <th className="text-right font-medium px-3 py-2">Purch.</th>
                    <th className="text-right font-medium px-3 py-2">Revenue</th>
                    <th className="text-right font-medium px-3 py-2">Conv%</th>
                    <th className="text-right font-medium px-3 py-2">Rev/1k</th>
                    <th className="text-right font-medium px-3 py-2">Unsub%</th>
                  </tr>
                </thead>
                <tbody>
                  {famOrder.map((fam) => (
                    <React.Fragment key={fam}>
                      <tr className="bg-gray-50"><td colSpan={9} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{FAMILIES[fam]}</td></tr>
                      {grouped[fam].map((c) => (
                        <tr key={c.key} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-2">
                            <span className="font-medium text-gray-800">{c.display_name}</span>
                            <span className="ml-2 text-[10px] text-gray-400 uppercase">{c.kind}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{intf(c.sent)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{pctf(c.open_rate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{pctf(c.click_rate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{intf(c.purchases)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{usd(c.revenue)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{pctf(c.conv_rate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{usd(c.rev_per_1k)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${c.unsub_rate > 0.4 ? 'text-amber-600' : 'text-gray-500'}`}>{pctf(c.unsub_rate)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-5 mb-5">
            {/* Flows vs blasts */}
            <Card className="p-4">
              <SectionLabel className="mb-3">Flows vs one-time blasts</SectionLabel>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1"><span className="text-gray-600">Automated flows</span><span className="font-semibold text-gray-900">{usd(flowsRev)}</span></div>
                  <Bar value={flowsRev} max={splitMax} tone="flow" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1"><span className="text-gray-600">One-time blasts</span><span className="font-semibold text-gray-900">{usd(blastsRev)}</span></div>
                  <Bar value={blastsRev} max={splitMax} tone="blast" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                Flows run 24/7 and compound. {flowsRev + blastsRev > 0 ? `They drive ${Math.round((flowsRev / (flowsRev + blastsRev)) * 100)}% of email revenue.` : ''}
              </p>
            </Card>

            {/* Deliverability */}
            <Card className="p-4">
              <SectionLabel className="mb-3">Deliverability &amp; list health</SectionLabel>
              <div className="grid grid-cols-2 gap-2.5">
                <Stat label="Delivered rate" value={pctf(ov.deliver_rate)} />
                <Stat label="Spam rate" value={pctf(ov.spam_rate)} tone={ov.spam_rate != null && ov.spam_rate >= 0.3 ? 'red' : undefined} />
                <Stat label="Suppression list" value={intf(data.deliverability?.suppression_list)} />
                <Stat label="Reachable leads" value={intf(data.deliverability?.reachable_list)} />
              </div>
            </Card>
          </div>

          {/* Alerts */}
          {data.alerts?.length > 0 && (
            <Card className="p-4">
              <SectionLabel className="mb-3">Health &amp; opportunity alerts</SectionLabel>
              <div className="space-y-2">
                {data.alerts.map((a, i) => {
                  const s = alertStyle[a.severity] || alertStyle.info;
                  const Ic = s.icon;
                  return (
                    <div key={i} className={`flex items-start gap-2.5 text-sm px-3 py-2.5 rounded-lg border ${s.cls}`}>
                      <Ic size={16} className={`mt-0.5 shrink-0 ${s.ic}`} />
                      <div><span className="font-medium text-gray-800">{a.title}.</span> <span className="text-gray-600">{a.detail}</span></div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
