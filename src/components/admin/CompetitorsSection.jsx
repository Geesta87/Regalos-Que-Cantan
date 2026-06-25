// src/components/admin/CompetitorsSection.jsx
// "Competitors" section of the Creative Studio. Shows rival personalized-song
// ads pulled from the Facebook Ad Library (ranked by strength + how long they've
// run), rated by the agent, with a "Make our version" button that generates an
// ORIGINAL Regalos ad from the winning concept into the Ads queue.
import React, { useState, useEffect, useCallback } from 'react';
import { Swords, RefreshCw, Loader2, Wand2, X, Clock, Check } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/competitors-admin`;
const FIT = { high: 'bg-green-100 text-green-800', medium: 'bg-amber-100 text-amber-800', low: 'bg-gray-100 text-gray-500' };

export default function CompetitorsSection({ accessToken, showToast }) {
  const [ads, setAds] = useState([]);
  const [lastScan, setLastScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [langFilter, setLangFilter] = useState('all'); // 'all' | 'es' | 'en'

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
      const r = await call({ action: 'list' });
      if (r.success) { setAds(r.ads || []); setLastScan(r.last_scan || null); }
      else showToast?.(`Error: ${r.error || 'could not load'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setScanning(true);
    try {
      const r = await call({ action: 'scan' });
      if (r.success) { showToast?.('Scanning competitors… new ads appear in ~1 min'); setTimeout(load, 60000); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setScanning(false); }
  };

  const act = async (id, action) => {
    setBusyId(id);
    try {
      const r = await call({ action, id });
      if (r.success) {
        if (action === 'make_version') { showToast?.('🎨 Generating your version in Ads'); setAds((p) => p.map((a) => a.id === id ? { ...a, status: 'cloned' } : a)); }
        else { showToast?.('Dismissed'); setAds((p) => p.filter((a) => a.id !== id)); }
      } else showToast?.(`Error: ${r.error || 'failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const shown = ads.filter((a) => langFilter === 'all' || a.lang === langFilter);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Swords size={18} className="text-gray-700" /> Competitor ads</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">Rival personalized-song ads from the Facebook Ad Library, ranked by strength + how long they've been running (longer = proven winner). Hit "Make our version" to spin up an original Regalos ad from the concept.</p>
        </div>
        <button onClick={scan} disabled={scanning} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
          {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Scan now
        </button>
      </div>

      {/* Language filter */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[['all', 'Todos'], ['es', 'Español'], ['en', 'English']].map(([k, label]) => (
          <button key={k} onClick={() => setLangFilter(k)}
            className={`px-3 py-1 text-sm rounded-md transition ${langFilter === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}{k !== 'all' ? ` (${ads.filter((a) => a.lang === k).length})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          {ads.length === 0 ? 'No competitor ads yet. Hit "Scan now" to pull the latest — or the weekly scan will fill this in.' : 'No ads in this language yet.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
              <div className="relative bg-gray-900 aspect-[4/5] flex items-center justify-center">
                {a.media_type === 'video' && a.video_url ? (
                  <video src={a.video_url} controls playsInline className="w-full h-full object-cover" />
                ) : a.image_url ? (
                  <img src={a.image_url} alt={a.page_name || 'ad'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="text-gray-500 text-xs">no preview</span>
                )}
                <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white">{a.page_name} · {a.lang?.toUpperCase()}</span>
                {typeof a.score === 'number' && <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-gray-800">{a.score}</span>}
                {a.active_days != null && (
                  <span className="absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white flex items-center gap-1"><Clock size={10} /> {a.active_days}d running</span>
                )}
              </div>

              <div className="p-3 flex-1 flex flex-col gap-1.5">
                {a.analysis?.hook && <p className="text-xs font-semibold text-gray-900">{a.analysis.hook}</p>}
                {a.body_text && <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">{a.body_text}</p>}
                {a.analysis?.why_working && <p className="text-[11px] text-gray-400 italic">Why it works: {a.analysis.why_working}</p>}
                {a.analysis?.rqc_fit && <span className={`self-start text-[10px] px-2 py-0.5 rounded-full ${FIT[a.analysis.rqc_fit] || FIT.low}`}>RQC fit: {a.analysis.rqc_fit}</span>}
                {a.analysis?.suggested_rqc_angle && <p className="text-[11px] text-purple-600 leading-snug mt-0.5">💡 {a.analysis.suggested_rqc_angle}</p>}
              </div>

              <div className="p-3 pt-0">
                {a.status === 'cloned' ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-700"><Check size={14} /> Your version is in Ads</div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => act(a.id, 'make_version')} disabled={busyId === a.id}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                      {busyId === a.id ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Make our version
                    </button>
                    <button onClick={() => act(a.id, 'dismiss')} disabled={busyId === a.id}
                      className="flex items-center justify-center px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                      <X size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
