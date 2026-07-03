// src/components/admin/EmailResultsSection.jsx
// "Results" section of the Creative Studio email area. Full per-campaign
// visibility for every marketing email that has actually gone out: delivered,
// opens, clicks, unsubscribes, spam complaints, orders and attributed revenue.
// Revenue comes from songs.utm_campaign (deduped per Stripe session); opens /
// clicks / unsub / spam come from SendGrid category stats. Read-only.
import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, RefreshCw, Loader2, ArrowLeft, Users, FlaskConical, Info } from 'lucide-react';
import { Card, Badge, Stat, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-marketer-admin`;

const SEGMENT_LABELS = {
  all: 'Everyone', recent: 'Recent buyers', winback: 'Win-back',
  video_buyers: 'Video-addon buyers', no_video: 'Bought song, never video',
};
const pct = (num, den) => (den ? `${Math.round((100 * num) / den)}%` : '—');
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

export default function EmailResultsSection({ accessToken, showToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const call = useCallback(async (payload) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    return res.json();
  }, [accessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call({ action: 'results_overview' });
      if (r.success) setRows(r.results || []);
      else showToast?.(`Error: ${r.error || 'could not load'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    setSelectedId(id); setDetail(null); setDetailLoading(true);
    try { const r = await call({ action: 'results_detail', id }); if (r.success) setDetail(r.stats); }
    catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setDetailLoading(false); }
  };

  const totals = rows.reduce((a, r) => ({
    orders: a.orders + (r.orders || 0), revenue: a.revenue + (Number(r.revenue) || 0),
    delivered: a.delivered + (r.delivered || 0), clicks: a.clicks + (r.clicks || 0),
  }), { orders: 0, revenue: 0, delivered: 0, clicks: 0 });

  // ---- DETAIL ----
  const sel = rows.find((r) => r.id === selectedId);
  if (selectedId) {
    return (
      <div className="max-w-3xl">
        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"><ArrowLeft size={16} /> All results</button>
        {sel && (
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge tone="gray"><Users size={11} className="mr-1" /> {SEGMENT_LABELS[sel.segment] || 'Everyone'}</Badge>
            {sel.subject_b && <Badge tone="accent"><FlaskConical size={11} className="mr-1" /> A/B</Badge>}
            <span className="text-xs text-gray-400">{fmtDate(sel.sent_at || sel.created_at)}</span>
          </div>
        )}
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{sel?.subject}</h2>

        {detailLoading ? (
          <div className="flex items-center gap-2 text-gray-500 py-12 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : detail ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Sent" value={(detail.recipients_sent || 0).toLocaleString()} />
              <Stat label="Delivered" value={(detail.delivered || 0).toLocaleString()} />
              <Stat label="Opens" value={pct(detail.opens, detail.delivered)} />
              <Stat label="Clicks (CTA)" value={pct(detail.clicks, detail.delivered)} />
              <Stat label="Unsubscribed" value={(detail.unsubscribes || 0).toLocaleString()} />
              <Stat label="Spam complaints" value={(detail.spam_reports || 0).toLocaleString()} tone={detail.spam_reports ? 'red' : undefined} />
              <Stat label="Orders" value={(detail.orders || 0).toLocaleString()} tone={detail.orders ? 'green' : undefined} />
              <Stat label="Revenue" value={money(detail.revenue)} tone={detail.revenue ? 'green' : undefined} />
            </div>

            {detail.ab && (
              <Card className="p-4 mt-4">
                <div className="flex items-center gap-1.5 mb-3 text-sm font-medium text-gray-900"><FlaskConical size={15} className="text-indigo-500" /> Subject A/B test</div>
                {['a', 'b'].map((v) => {
                  const d = detail.ab[v]; if (!d) return null;
                  const open = pct(d.opens, d.delivered), click = pct(d.clicks, d.delivered);
                  const other = detail.ab[v === 'a' ? 'b' : 'a'];
                  const win = other && d.delivered && other.delivered && (d.opens / d.delivered) >= (other.opens / other.delivered);
                  return (
                    <div key={v} className="flex items-center gap-3 py-2 border-t border-gray-100 first:border-t-0">
                      <Badge tone={win ? 'green' : 'gray'}>{v.toUpperCase()}{win ? ' · winner' : ''}</Badge>
                      <span className="flex-1 text-sm text-gray-700 truncate" title={d.subject}>{d.subject}</span>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{d.delivered.toLocaleString()} sent · {open} opens · {click} clicks</span>
                    </div>
                  );
                })}
                <p className="text-[11px] text-gray-400 mt-2">Winner is by open rate — subject lines mainly drive opens. Both versions share one link, so revenue is counted for the whole campaign.</p>
              </Card>
            )}

            <div className="flex items-start gap-2 mt-4 text-[11px] text-gray-400 bg-gray-50 rounded-lg p-3">
              <Info size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                <strong className="text-gray-500">Opens</strong> are directional — Apple Mail Privacy auto-opens inflate them, so trust clicks and revenue more.
                <strong className="text-gray-500"> Spam complaints</strong> = people who hit "report spam"; this is <em>not</em> how many landed in the spam folder
                (no email platform reports that per campaign — Gmail folder reputation lives in Google Postmaster Tools).
              </span>
            </div>
          </>
        ) : (
          <div className="text-center text-gray-400 py-12">No stats yet — they appear a few minutes after sending starts.</div>
        )}
      </div>
    );
  }

  // ---- LIST ----
  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><BarChart3 size={18} className="text-gray-700" /> Campaign results</h3>
          <p className="text-sm text-gray-500 mt-1">What each email actually did — delivered, opens, clicks, unsubscribes, spam complaints, and real sales.</p>
        </div>
        <button onClick={load} disabled={loading} className={btn.ghost}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        <Stat label="Email revenue" value={money(totals.revenue)} tone={totals.revenue ? 'green' : undefined} />
        <Stat label="Orders" value={totals.orders.toLocaleString()} tone={totals.orders ? 'green' : undefined} />
        <Stat label="Total delivered" value={totals.delivered.toLocaleString()} />
        <Stat label="Total clicks" value={totals.clicks.toLocaleString()} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          No sent campaigns yet. Approve an email in the Emails tab and its results will show up here.
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="font-medium px-3 py-2">Campaign</th>
                  <th className="font-medium px-2 py-2 whitespace-nowrap">Date</th>
                  <th className="font-medium px-2 py-2 text-right">Sent</th>
                  <th className="font-medium px-2 py-2 text-right">Opens</th>
                  <th className="font-medium px-2 py-2 text-right">Clicks</th>
                  <th className="font-medium px-2 py-2 text-right">Unsub</th>
                  <th className="font-medium px-2 py-2 text-right">Spam</th>
                  <th className="font-medium px-2 py-2 text-right">Orders</th>
                  <th className="font-medium px-3 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => openDetail(r.id)}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-900 truncate max-w-[220px] flex items-center gap-1.5">
                        {r.subject_b && <FlaskConical size={12} className="text-indigo-400 flex-shrink-0" />} {r.subject}
                      </div>
                      <div className="text-[11px] text-gray-400">{SEGMENT_LABELS[r.segment] || 'Everyone'}</div>
                    </td>
                    <td className="px-2 py-2.5 text-gray-500 whitespace-nowrap">{fmtDate(r.sent_at || r.created_at)}</td>
                    <td className="px-2 py-2.5 text-right text-gray-700">{(r.recipients_sent || r.delivered || 0).toLocaleString()}</td>
                    <td className="px-2 py-2.5 text-right text-gray-700">{pct(r.opens, r.delivered)}</td>
                    <td className="px-2 py-2.5 text-right text-gray-700">{pct(r.clicks, r.delivered)}</td>
                    <td className="px-2 py-2.5 text-right text-gray-500">{(r.unsubscribes || 0).toLocaleString()}</td>
                    <td className={`px-2 py-2.5 text-right ${r.spam_reports ? 'text-red-600' : 'text-gray-500'}`}>{(r.spam_reports || 0).toLocaleString()}</td>
                    <td className="px-2 py-2.5 text-right text-gray-700">{(r.orders || 0).toLocaleString()}</td>
                    <td className={`px-3 py-2.5 text-right font-medium ${r.revenue ? 'text-green-700' : 'text-gray-500'}`}>{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="text-[11px] text-gray-400 mt-3 flex items-start gap-1.5">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        Opens are directional (Apple Mail inflates them). "Spam" = complaints, not spam-folder placement. Revenue is attributed via email links, deduped per order.
      </p>
    </div>
  );
}
