import React, { useState, useEffect, useCallback } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// CS Insights (Admin)
//
// The quality instrument panel for the customer-service AI. Shows, from real
// data: volume, the draft-outcome funnel (approved as-is / edited / discarded /
// escalated), the same numbers BY question category, and a weekly "sent as-is"
// trend. The per-category "sent as-is %" is what tells you when a category is
// safe to auto-send. Read-only — talks to the cs-metrics edge function.
// ──────────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  price: 'Pricing',
  how_it_works: 'How it works',
  locate_song: 'Find my song',
  download_help: 'Download help',
  song_status: 'Song status',
  change_request: 'Change request',
  billing_money: 'Billing / money',
  complaint: 'Complaint',
  voice_options: 'Voice / options',
  upsell: 'Upsell / add-ons',
  greeting: 'Greeting',
  thanks_closing: 'Thanks / closing',
  other: 'Other',
  '(sin clasificar)': 'Untagged (older)',
};

// Topics that must always route to a human, regardless of accuracy.
const ALWAYS_HUMAN = new Set(['billing_money', 'complaint', 'change_request']);

// Target "sent as-is" rate before a category is safe to auto-send.
const TARGET = 85;

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 100);
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className={`text-xs font-medium ${accent || 'text-gray-400'}`}>{label}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function CsInsightsTab({ accessToken }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cs-metrics?days=${days}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, days]);

  useEffect(() => { load(); }, [load]);

  const ov = data?.overview;
  const vol = data?.volume;
  const resolved = ov ? (ov.as_is + ov.edited + ov.discarded) : 0;
  const asIsRate = pct(ov?.as_is || 0, resolved);
  const trend = data?.trend || [];
  const maxTrend = 100;

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">📊 CS Insights</h2>
          <p className="text-sm text-gray-500">How well the customer-service AI is doing — the numbers that gate auto-send.</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                days === d ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/40'
                           : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              {d}d
            </button>
          ))}
          <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 text-gray-300 hover:bg-white/10">🔄</button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-10 text-center">Loading…</div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 text-sm text-red-300">
          Couldn't load metrics: {error}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Volume */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Conversations" value={vol?.conversations ?? '—'} sub={`last ${days} days`} />
            <Stat label="Inbound messages" value={vol?.inbound ?? '—'} />
            <Stat label="AI drafts written" value={vol?.drafts ?? '—'} />
            <Stat
              label="Sent as-is"
              value={asIsRate != null ? `${asIsRate}%` : '—'}
              sub={`target ${TARGET}%`}
              accent={asIsRate == null ? 'text-gray-400' : asIsRate >= TARGET ? 'text-green-300' : 'text-amber-300'}
            />
          </div>

          {/* Funnel */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-3">Draft outcomes (last {days} days)</div>
            {ov && ov.total > 0 ? (
              <>
                <div className="flex h-3 rounded-full overflow-hidden bg-white/5 mb-3">
                  {[
                    { k: 'as_is', c: 'bg-green-500', n: ov.as_is },
                    { k: 'edited', c: 'bg-amber-400', n: ov.edited },
                    { k: 'discarded', c: 'bg-red-500', n: ov.discarded },
                    { k: 'pending', c: 'bg-white/20', n: ov.pending },
                  ].map((s) => s.n > 0 && (
                    <div key={s.k} className={s.c} style={{ width: `${(s.n / ov.total) * 100}%` }} title={`${s.k}: ${s.n}`} />
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <div><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />Sent as-is: <b className="text-white">{ov.as_is}</b></div>
                  <div><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />Edited: <b className="text-white">{ov.edited}</b></div>
                  <div><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />Discarded: <b className="text-white">{ov.discarded}</b></div>
                  <div><span className="inline-block w-2 h-2 rounded-full bg-white/30 mr-1" />Pending: <b className="text-white">{ov.pending}</b></div>
                  <div>⚠️ Escalated: <b className="text-white">{ov.escalated}</b></div>
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-500">No AI drafts in this window yet.</div>
            )}
          </div>

          {/* By category */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-1">By question type</div>
            <div className="text-[11px] text-gray-500 mb-3">
              "Sent as-is %" per topic. A topic is auto-send–ready around {TARGET}%+ over enough volume.
              Money, complaints and change requests always stay human.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left font-medium py-1.5">Topic</th>
                    <th className="text-right font-medium">Drafts</th>
                    <th className="text-right font-medium">As-is</th>
                    <th className="text-right font-medium">Edited</th>
                    <th className="text-right font-medium">Discarded</th>
                    <th className="text-right font-medium pr-2">As-is %</th>
                    <th className="text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.by_category || []).map((row) => {
                    const res = row.as_is + row.edited + row.discarded;
                    const rate = pct(row.as_is, res);
                    const human = ALWAYS_HUMAN.has(row.category);
                    let badge;
                    if (human) badge = <span className="text-purple-300">Always human</span>;
                    else if (rate == null || res < 10) badge = <span className="text-gray-500">Not enough data</span>;
                    else if (rate >= TARGET && res >= 30) badge = <span className="text-green-300">✓ Auto-send ready</span>;
                    else if (rate >= 70) badge = <span className="text-amber-300">Getting there</span>;
                    else badge = <span className="text-red-300">Needs work</span>;
                    return (
                      <tr key={row.category} className="border-b border-white/5">
                        <td className="py-1.5 text-gray-200">{CATEGORY_LABELS[row.category] || row.category}</td>
                        <td className="text-right text-gray-300">{row.total}</td>
                        <td className="text-right text-green-300">{row.as_is}</td>
                        <td className="text-right text-amber-300">{row.edited}</td>
                        <td className="text-right text-red-300">{row.discarded}</td>
                        <td className="text-right pr-2 font-semibold text-white">{rate == null ? '—' : `${rate}%`}</td>
                        <td>{badge}</td>
                      </tr>
                    );
                  })}
                  {(!data.by_category || data.by_category.length === 0) && (
                    <tr><td colSpan={7} className="text-gray-500 py-3 text-center">No data yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trend */}
          {trend.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-sm font-semibold text-white mb-3">"Sent as-is" by week</div>
              <div className="flex items-end gap-2 h-28">
                {trend.map((w) => {
                  const rate = pct(w.as_is, w.resolved);
                  return (
                    <div key={w.week} className="flex-1 flex flex-col items-center justify-end gap-1">
                      <div className="text-[10px] text-gray-400">{rate == null ? '' : `${rate}%`}</div>
                      <div
                        className={`w-full rounded-t ${rate != null && rate >= TARGET ? 'bg-green-500/70' : 'bg-amber-400/60'}`}
                        style={{ height: `${rate == null ? 2 : (rate / maxTrend) * 100}%`, minHeight: 2 }}
                        title={`${w.week}: ${w.as_is}/${w.resolved}`}
                      />
                      <div className="text-[9px] text-gray-600">{String(w.week).slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-600">
            Note: "Edited" only counts approvals made after this dashboard shipped — older approvals show as sent-as-is.
            The numbers get truer every day as you keep approving.
          </p>
        </div>
      )}
    </div>
  );
}
