// src/components/admin/CreativeStudioTab.jsx
// Agent 2 — Creative Studio review screen. Shows the daily AI-generated batch
// (5 videos + 5 visuals with copy) and lets the owner Approve (→ auto-post via
// GHL) or Reject each one. Self-contained, mirrors VideosTab/NeedsApprovalTab:
// talks to the creative-studio-admin edge function with the admin JWT.
import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, RefreshCw, Check, X, Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import CreativeChatPanel from './CreativeChatPanel';
import EmailMarketerSection from './EmailMarketerSection';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/creative-studio-admin`;

const STATUS_META = {
  ready:      { label: 'Listo para revisar', cls: 'bg-amber-100 text-amber-800' },
  generating: { label: 'Generando…',         cls: 'bg-blue-100 text-blue-800' },
  posted:     { label: 'Publicado',           cls: 'bg-green-100 text-green-800' },
  approved:   { label: 'Aprobado (en pausa)', cls: 'bg-green-50 text-green-700' },
  failed:     { label: 'Falló',               cls: 'bg-red-100 text-red-700' },
  rejected:   { label: 'Descartado',          cls: 'bg-gray-100 text-gray-500' },
};

const FILTERS = [
  { key: 'review',   label: 'Para revisar', statuses: ['ready', 'generating'] },
  { key: 'done',     label: 'Publicados',   statuses: ['posted', 'approved'] },
  { key: 'all',      label: 'Todos',        statuses: ['ready', 'generating', 'posted', 'approved', 'failed', 'rejected'] },
];

export default function CreativeStudioTab({ accessToken, showToast }) {
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('review');
  const [view, setView] = useState('ads'); // 'ads' | 'social' | 'emails' | 'chat'

  const call = useCallback(async (payload) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const statuses = (FILTERS.find((f) => f.key === filter) || FILTERS[0]).statuses;
      const r = await call({ action: 'list', statuses, limit: 80 });
      if (r.success) { setCreatives(r.creatives || []); setRole(r.role); }
      else showToast?.(`Error: ${r.error || 'no se pudo cargar'}`);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [accessToken, filter, call, showToast]);

  useEffect(() => { load(); }, [load]);

  const act = async (id, action) => {
    if (role !== 'admin') { showToast?.('Solo administradores pueden aprobar'); return; }
    setBusyId(id);
    try {
      const r = await call({ action, id });
      if (r.success) {
        showToast?.(action === 'approve'
          ? (r.posted ? '✅ Aprobado y publicándose' : '✅ Aprobado (publicación en pausa)')
          : 'Descartado');
        setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, status: r.status } : c));
      } else {
        showToast?.(`Error: ${r.error || 'falló'}`);
      }
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const shown = creatives.filter((c) => (view === 'social' ? c.intended_use === 'social' : c.intended_use === 'ad'));
  const readyCount = shown.filter((c) => c.status === 'ready').length;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles size={22} className="text-amber-500" /> Creative Studio
          </h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Today's AI-generated batch — 5 videos + 5 visuals with copy. Approve to auto-post to your
            connected social accounts; reject to discard. Nothing posts until you approve it.
            {readyCount > 0 && <span className="ml-1 font-semibold text-amber-600">{readyCount} awaiting review.</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Sections: Ads | Social | Emails | Art director */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {[['ads', 'Ads'], ['social', 'Social'], ['emails', 'Emails'], ['chat', 'Art director']].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 text-sm rounded-md transition ${view === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {view === 'chat' ? (
        <CreativeChatPanel accessToken={accessToken} showToast={showToast} />
      ) : view === 'emails' ? (
        <EmailMarketerSection accessToken={accessToken} showToast={showToast} />
      ) : (
      <>
      {/* Filters */}
      <div className="flex gap-2 mb-5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-sm rounded-full transition ${filter === f.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center">
          <Loader2 size={18} className="animate-spin" /> Cargando…
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          No {view === 'social' ? 'social posts' : 'ads'} here yet. Generate some in the Art director chat, or the daily agent makes a fresh batch.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((c) => {
            const sm = STATUS_META[c.status] || { label: c.status, cls: 'bg-gray-100 text-gray-600' };
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
                {/* Media */}
                <div className="relative bg-gray-900 aspect-[4/5] flex items-center justify-center">
                  {c.status === 'generating' || !c.media_url ? (
                    c.status === 'failed' ? (
                      <div className="text-red-300 text-xs flex flex-col items-center gap-1 p-4 text-center">
                        <AlertTriangle size={20} /> {c.error || 'Generación falló'}
                      </div>
                    ) : (
                      <div className="text-gray-400 text-xs flex flex-col items-center gap-2">
                        <Loader2 size={20} className="animate-spin" /> Generando arte…
                      </div>
                    )
                  ) : c.kind === 'video' ? (
                    <video src={c.media_url} controls playsInline className="w-full h-full object-cover" />
                  ) : (
                    <img src={c.media_url} alt={c.concept || 'creative'} className="w-full h-full object-cover" />
                  )}
                  <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-black/60 text-white">
                    {c.kind === 'video' ? '🎬 Video' : '🖼️ Visual'} · {c.intended_use === 'ad' ? 'Anuncio' : 'Social'}
                  </span>
                  {typeof c.score === 'number' && (
                    <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-gray-800">
                      {c.score}
                    </span>
                  )}
                </div>

                {/* Copy */}
                <div className="p-3 flex-1 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                    {c.occasion && <span className="text-[11px] text-gray-400">{c.occasion}</span>}
                  </div>
                  {c.headline && <p className="font-semibold text-gray-900 text-sm leading-snug">{c.headline}</p>}
                  {c.primary_text && <p className="text-xs text-gray-600 leading-relaxed line-clamp-4">{c.primary_text}</p>}
                  {c.caption && <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2 mt-0.5">{c.caption}</p>}
                  {Array.isArray(c.hashtags) && c.hashtags.length > 0 && (
                    <p className="text-[11px] text-blue-500 mt-0.5">{c.hashtags.map((h) => `#${String(h).replace(/^#/, '')}`).join(' ')}</p>
                  )}
                  {c.persuasion_angle && <p className="text-[10px] text-gray-400 italic mt-0.5">Ángulo: {c.persuasion_angle}</p>}
                </div>

                {/* Actions */}
                <div className="p-3 pt-0">
                  {c.status === 'ready' ? (
                    <div className="flex gap-2">
                      <button onClick={() => act(c.id, 'approve')} disabled={busyId === c.id || role !== 'admin'}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                        {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Aprobar
                      </button>
                      <button onClick={() => act(c.id, 'reject')} disabled={busyId === c.id || role !== 'admin'}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                        <X size={15} />
                      </button>
                    </div>
                  ) : c.status === 'posted' ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-700">
                      <Check size={14} /> Publicado{c.ghl_post_id ? ' en tus redes' : ''}
                    </div>
                  ) : c.status === 'approved' ? (
                    <p className="text-xs text-green-700">Aprobado — se publicará al reactivar el posteo.</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}
