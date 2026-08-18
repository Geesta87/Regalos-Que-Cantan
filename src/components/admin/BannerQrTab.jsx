// src/components/admin/BannerQrTab.jsx
// Banner QR — daily scans / orders / revenue per printed outdoor banner.
// Each banner's QR tags traffic with utm_campaign 'b-*' (nothing else uses the
// b- prefix), so the banner_qr_performance RPC isolates banner traffic cleanly.
// Numbers are a FLOOR: someone who scans on a phone and buys on a laptop loses
// the tag, so zeros here don't prove a banner is dead. Admin-only.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { QrCode, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../../services/api';
import { Card, Stat, Badge, SectionLabel, btn } from './ui';

// Rename codes to real places here as banners get hung — no database change
// needed. Unknown b-* codes that show up in the data still render (new prints).
const BANNERS = {
  'b-negro':     { label: 'Black + pink',      location: '' },
  'b-turquesa':  { label: 'Turquoise, photo',  location: '' },
  'b-negrofoto': { label: 'Black, taquería',   location: '' },
  'b-rosa':      { label: 'Pink, hearts',      location: '' },
  'b-crema':     { label: 'Cream + red',       location: '' },
};

const RANGES = [7, 30, 90];

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const bannerName = (code) => {
  const b = BANNERS[code];
  return b ? (b.location || b.label) : code;
};
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const fmtDay = (ymd) => {
  if (ymd === todayPT()) return 'Today';
  const d = new Date(`${ymd}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
};

export default function BannerQrTab({ accessToken, showToast }) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('banner_qr_performance', { days });
      if (rpcError) throw rpcError;
      setRows(data || []);
    } catch (e) {
      setError(e.message || 'failed to load');
      showToast?.(`Banner QR: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => { load(); }, [load]);

  // Totals per banner across the window. Known banners always appear (zeros
  // included); unknown b-* codes from the data are appended, not dropped.
  const totals = useMemo(() => {
    const byCode = {};
    for (const code of Object.keys(BANNERS)) byCode[code] = { code, visits: 0, orders: 0, revenue: 0 };
    for (const r of rows) {
      (byCode[r.code] ||= { code: r.code, visits: 0, orders: 0, revenue: 0 });
      byCode[r.code].visits += Number(r.visits || 0);
      byCode[r.code].orders += Number(r.orders || 0);
      byCode[r.code].revenue += Number(r.revenue || 0);
    }
    return Object.values(byCode).sort((a, b) => b.revenue - a.revenue || b.visits - a.visits || a.code.localeCompare(b.code));
  }, [rows]);

  const dayList = useMemo(() => [...new Set(rows.map((r) => r.day))].sort().reverse(), [rows]);
  const hasData = rows.length > 0;

  return (
    <div className="space-y-4">
      {/* Header: title + range toggle + refresh */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
              <QrCode size={20} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Banner QR</h2>
              <p className="text-xs text-gray-500">Scans and orders from the printed outdoor banners</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {RANGES.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading} className={btn.iconGhost} title="Refresh">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          UTM attribution undercounts (scan on phone, buy on laptop loses the tag) — these numbers are a floor per banner, not a headcount. A zero doesn't prove a banner is dead.
        </p>
      </Card>

      {error ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-600">Couldn't load banner data: {error}</p>
          <button onClick={load} className={`${btn.ghost} mt-3`}>Try again</button>
        </Card>
      ) : loading && !hasData ? (
        <Card className="p-10 flex items-center justify-center text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading banner data…
        </Card>
      ) : (
        <>
          {/* Top row: one stat card per banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {totals.map((t) => (
              <Card key={t.code} className="p-3.5">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <p className="text-sm font-medium text-gray-900 truncate" title={t.code}>{bannerName(t.code)}</p>
                  <Badge tone={t.orders > 0 ? 'green' : t.visits > 0 ? 'accent' : 'gray'}>{t.code}</Badge>
                </div>
                <p className="text-xl font-semibold text-gray-900">{money(t.revenue)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {t.orders} {t.orders === 1 ? 'order' : 'orders'} · {t.visits} {t.visits === 1 ? 'visit' : 'visits'}
                </p>
              </Card>
            ))}
          </div>

          {!hasData ? (
            <Card className="p-10 text-center">
              <QrCode size={28} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-700">No scans yet in the last {days} days</p>
              <p className="text-xs text-gray-500 mt-1.5 max-w-md mx-auto">
                The tab is working — the banners just haven't been scanned in this window. The first scan shows up here as a visit within about a minute.
              </p>
            </Card>
          ) : (
            <>
              {/* Totals by banner */}
              <Card className="p-4">
                <SectionLabel className="mb-3">By banner — last {days} days</SectionLabel>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="py-2 pr-4 font-medium">Banner</th>
                        <th className="py-2 pr-4 font-medium text-right">Visits</th>
                        <th className="py-2 pr-4 font-medium text-right">Orders</th>
                        <th className="py-2 pr-4 font-medium text-right">Revenue</th>
                        <th className="py-2 font-medium text-right">Conversion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.map((t) => (
                        <tr key={t.code} className="border-b border-gray-50 last:border-0">
                          <td className="py-2.5 pr-4">
                            <span className="font-medium text-gray-900">{bannerName(t.code)}</span>
                            <span className="text-xs text-gray-400 ml-2">{t.code}</span>
                          </td>
                          <td className="py-2.5 pr-4 text-right text-gray-700">{t.visits}</td>
                          <td className="py-2.5 pr-4 text-right text-gray-700">{t.orders}</td>
                          <td className="py-2.5 pr-4 text-right font-medium text-gray-900">{money(t.revenue)}</td>
                          <td className="py-2.5 text-right text-gray-700">
                            {t.visits > 0 ? `${((t.orders / t.visits) * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Daily breakdown, newest first */}
              <Card className="p-4">
                <SectionLabel className="mb-3">Daily breakdown</SectionLabel>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="py-2 pr-4 font-medium">Day</th>
                        <th className="py-2 pr-4 font-medium">Banner</th>
                        <th className="py-2 pr-4 font-medium text-right">Visits</th>
                        <th className="py-2 pr-4 font-medium text-right">Orders</th>
                        <th className="py-2 font-medium text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayList.map((d) => {
                        const dayRows = rows
                          .filter((r) => r.day === d)
                          .sort((a, b) => Number(b.revenue) - Number(a.revenue) || Number(b.visits) - Number(a.visits));
                        return dayRows.map((r, i) => (
                          <tr key={`${d}-${r.code}`} className="border-b border-gray-50 last:border-0">
                            <td className="py-2.5 pr-4 text-gray-700">
                              {i === 0 ? (
                                <span className={d === todayPT() ? 'font-semibold text-indigo-600' : 'font-medium text-gray-900'}>{fmtDay(d)}</span>
                              ) : ''}
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className="text-gray-900">{bannerName(r.code)}</span>
                              <span className="text-xs text-gray-400 ml-2">{r.code}</span>
                            </td>
                            <td className="py-2.5 pr-4 text-right text-gray-700">{Number(r.visits)}</td>
                            <td className="py-2.5 pr-4 text-right text-gray-700">{Number(r.orders)}</td>
                            <td className="py-2.5 text-right font-medium text-gray-900">{money(r.revenue)}</td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
