// src/components/admin/ChiefOfStaffTab.jsx
// Chief of Staff — the morning command center. Reads the latest cross-agent
// briefing (cos_briefings) via chief-of-staff-admin: today's priorities (each
// pointing at a tab), a business snapshot, and each agent's health. Admin-only.
import React, { useState, useEffect, useCallback } from 'react';
import { Compass, RefreshCw, Loader2, Check, AlertTriangle, ArrowRight } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chief-of-staff-admin`;

function fmtDate(ymd) {
  if (!ymd) return '';
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function ChiefOfStaffTab({ accessToken, showToast }) {
  const [briefings, setBriefings] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [denied, setDenied] = useState(false);

  const call = useCallback(async (payload) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(payload || {}),
    });
    return { status: res.status, body: await res.json() };
  }, [accessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { status, body } = await call({});
      if (body.success) { setBriefings(body.briefings || []); setIdx(0); }
      else if (status === 403) setDenied(true);
      else showToast?.(`Error: ${body.error || 'could not load'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setRunning(true);
    try {
      const { body } = await call({ action: 'run' });
      if (body.success) { showToast?.('Refreshing your briefing… ~30s'); setTimeout(load, 30000); }
      else showToast?.(`Error: ${body.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setRunning(false); }
  };

  if (denied) return <div className="text-gray-400 py-16 text-center">The Chief of Staff briefing is available to admins only.</div>;

  const b = briefings[idx];
  const a = b?.analysis || {};

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Compass size={22} className="text-purple-600" /> Chief of Staff</h2>
          <p className="text-sm text-gray-500 mt-1">Your whole AI team, folded into one morning command center. Generated daily at 9:45am Pacific.</p>
        </div>
        <div className="flex items-center gap-2">
          {briefings.length > 1 && (
            <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
              {briefings.map((r, i) => <option key={r.id} value={i}>{r.briefing_for}</option>)}
            </select>
          )}
          <button onClick={run} disabled={running} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={15} className={running ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : !b ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          No briefing yet. Hit "Refresh" to generate one now, or it lands automatically at 9:45am Pacific.
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-400 mb-2">{fmtDate(b.briefing_for)}</div>
          <div className="text-lg font-medium text-gray-900 border-l-4 border-purple-500 pl-3 mb-3">{a.greeting}</div>
          <p className="text-sm text-gray-600 leading-relaxed mb-6">{a.snapshot}</p>

          <h3 className="text-sm font-semibold text-gray-900 mb-2">Today's priorities</h3>
          <div className="space-y-2 mb-6">
            {(a.top_actions || []).map((x, i) => (
              <div key={i} className="flex gap-3 bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-purple-300 font-bold text-sm w-4">{x.priority ?? i + 1}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{x.action}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{x.why}</div>
                </div>
                {x.where && <span className="self-start text-[11px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap">{x.where} <ArrowRight size={11} /></span>}
              </div>
            ))}
          </div>

          <h3 className="text-sm font-semibold text-gray-900 mb-2">Agents</h3>
          <div className="flex flex-wrap gap-2">
            {(a.agent_health || []).map((h, i) => (
              <span key={i} className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 ${h.status === 'ok' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`} title={h.note}>
                {h.status === 'ok' ? <Check size={12} /> : <AlertTriangle size={12} />} {h.agent}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
