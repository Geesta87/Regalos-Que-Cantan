// src/components/admin/CreativeStudioTab.jsx
// Agent 2 — Creative Studio review screen. Shows the daily AI-generated batch
// (5 videos + 5 visuals with copy) and lets the owner Approve (→ auto-post via
// GHL) or Reject each one. Self-contained, mirrors VideosTab/NeedsApprovalTab:
// talks to the creative-studio-admin edge function with the admin JWT.
import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, RefreshCw, Check, X, Loader2, ExternalLink, AlertTriangle, Megaphone, Pencil, Wand2 } from 'lucide-react';
import CreativeChatPanel from './CreativeChatPanel';
import EmailMarketerSection from './EmailMarketerSection';
import CompetitorsSection from './CompetitorsSection';
import AdTemplatesSection from './AdTemplatesSection';

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
  const [scheduleById, setScheduleById] = useState({}); // creative id -> datetime-local string
  // Inline copy editor + "request changes" (redesign) per card
  const [editId, setEditId] = useState(null);
  const [edits, setEdits] = useState({}); // id -> { headline, primary_text, caption, hashtags }
  const [tweakId, setTweakId] = useState(null);
  const [tweakText, setTweakText] = useState('');
  // Live "promo box" — the seasonal push every generator leads with (creative_studio_config.promo_notes)
  const [promo, setPromo] = useState('');
  const [promoSaved, setPromoSaved] = useState('');
  const [savingPromo, setSavingPromo] = useState(false);

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

  // Load the current promo push once.
  useEffect(() => {
    if (!accessToken) return;
    call({ action: 'get_config' }).then((r) => {
      if (r?.success) { setPromo(r.promo_notes || ''); setPromoSaved(r.promo_notes || ''); }
    }).catch(() => {});
  }, [accessToken, call]);

  const savePromo = async () => {
    if (role !== 'admin') { showToast?.('Admins only'); return; }
    setSavingPromo(true);
    try {
      const r = await call({ action: 'save_promo', promo_notes: promo });
      if (r.success) { setPromoSaved(r.promo_notes || ''); showToast?.('✅ Enfoque guardado — el próximo lote lo usará'); }
      else showToast?.(`Error: ${r.error || 'no se pudo guardar'}`);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setSavingPromo(false);
    }
  };

  const act = async (id, action, extra = {}) => {
    if (role !== 'admin') { showToast?.('Solo administradores pueden aprobar'); return; }
    setBusyId(id);
    try {
      const r = await call({ action, id, ...extra });
      if (r.success) {
        showToast?.(action === 'approve'
          ? (r.posted ? (extra.schedule_date ? '✅ Aprobado y programado' : '✅ Aprobado y publicándose') : '✅ Aprobado (publicación en pausa)')
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

  const startEdit = (c) => {
    setTweakId(null);
    setEditId(c.id);
    setEdits((p) => ({ ...p, [c.id]: {
      headline: c.headline || '', primary_text: c.primary_text || '', caption: c.caption || '',
      hashtags: Array.isArray(c.hashtags) ? c.hashtags.map((h) => `#${String(h).replace(/^#/, '')}`).join(' ') : '',
    } }));
  };

  const saveCopy = async (id) => {
    if (role !== 'admin') { showToast?.('Admins only'); return; }
    const e = edits[id] || {};
    setBusyId(id);
    try {
      const hashtags = (e.hashtags || '').split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean);
      const r = await call({ action: 'update', id, headline: e.headline, primary_text: e.primary_text, caption: e.caption, hashtags });
      if (r.success) {
        setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, headline: e.headline, primary_text: e.primary_text, caption: e.caption, hashtags } : c));
        setEditId(null);
        showToast?.('✅ Copy updated');
      } else showToast?.(`Error: ${r.error || 'no se pudo guardar'}`);
    } catch (err) { showToast?.(`Error: ${err.message}`); }
    finally { setBusyId(null); }
  };

  const requestChanges = async (id) => {
    if (role !== 'admin') { showToast?.('Admins only'); return; }
    if (!tweakText.trim()) { showToast?.('Describe what to change'); return; }
    setBusyId(id);
    try {
      const r = await call({ action: 'request_changes', id, change_instructions: tweakText.trim() });
      if (r.success) {
        setTweakId(null); setTweakText('');
        showToast?.('🎨 Sent to the designer — the new version will appear shortly');
        load();
      } else showToast?.(`Error: ${r.error || 'falló'}`);
    } catch (err) { showToast?.(`Error: ${err.message}`); }
    finally { setBusyId(null); }
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
            Today's AI-generated batch — 5 visuals + 1 video with copy, every morning. Approve to auto-post
            to your connected social accounts; reject to discard. Nothing posts until you approve it.
            {readyCount > 0 && <span className="ml-1 font-semibold text-amber-600">{readyCount} awaiting review.</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Live promo box — what every generator (daily batch, chat, templates) leads with */}
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          <Megaphone size={16} className="text-amber-600" />
          <h3 className="text-sm font-semibold text-gray-900">This week's push</h3>
          <span className="text-[11px] text-gray-500">— what every new ad &amp; post should promote</span>
        </div>
        <textarea
          value={promo}
          onChange={(e) => setPromo(e.target.value)}
          rows={2}
          placeholder='e.g. "Promote Día del Padre this week + push the $9.99 video add-on" — leave blank for the normal rotation'
          className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[11px] text-gray-500">
            The selling points &amp; prices ($29.99 song, $9.99 video, bundles…) are always built in — this just steers the focus.
          </p>
          <button
            onClick={savePromo}
            disabled={savingPromo || role !== 'admin' || promo === promoSaved}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">
            {savingPromo ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {promo === promoSaved && promoSaved ? 'Saved' : 'Save push'}
          </button>
        </div>
      </div>

      {/* Sections: Ads | Social | Emails | Art director */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {[['ads', 'Ads'], ['templates', 'Plantillas'], ['social', 'Social'], ['competitors', 'Competitors'], ['emails', 'Emails'], ['chat', 'Art director']].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 text-sm rounded-md transition ${view === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {view === 'chat' ? (
        <CreativeChatPanel accessToken={accessToken} showToast={showToast} />
      ) : view === 'templates' ? (
        <AdTemplatesSection accessToken={accessToken} showToast={showToast} />
      ) : view === 'competitors' ? (
        <CompetitorsSection accessToken={accessToken} showToast={showToast} />
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
                    <div className="space-y-2">
                      {editId === c.id ? (
                        <div className="space-y-1.5 bg-gray-50 border border-gray-200 rounded-lg p-2">
                          <p className="text-[11px] font-medium text-gray-600">Edit the text before approving:</p>
                          <input value={edits[c.id]?.headline || ''} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...p[c.id], headline: e.target.value } }))}
                            placeholder="Headline" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-900 placeholder-gray-400" />
                          <textarea value={edits[c.id]?.primary_text || ''} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...p[c.id], primary_text: e.target.value } }))}
                            rows={2} placeholder="Primary text" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-900 placeholder-gray-400 resize-none" />
                          <textarea value={edits[c.id]?.caption || ''} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...p[c.id], caption: e.target.value } }))}
                            rows={2} placeholder="Caption (what gets posted)" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-900 placeholder-gray-400 resize-none" />
                          <input value={edits[c.id]?.hashtags || ''} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...p[c.id], hashtags: e.target.value } }))}
                            placeholder="#hashtags" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-900 placeholder-gray-400" />
                          <div className="flex gap-2">
                            <button onClick={() => saveCopy(c.id)} disabled={busyId === c.id}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-50">
                              {busyId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save copy
                            </button>
                            <button onClick={() => setEditId(null)} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-white">Cancel</button>
                          </div>
                        </div>
                      ) : tweakId === c.id ? (
                        <div className="space-y-1.5 bg-purple-50 border border-purple-200 rounded-lg p-2">
                          <p className="text-[11px] font-medium text-purple-700">Request a change from the designer (generates a new version):</p>
                          <textarea value={tweakText} onChange={(e) => setTweakText(e.target.value)} rows={3}
                            placeholder={'e.g. "make the background a sunset", "add the grandparents", "brighter and more colorful"'}
                            className="w-full text-xs border border-purple-200 rounded px-2 py-1.5 resize-none bg-white text-gray-900 placeholder-gray-400" />
                          <div className="flex gap-2">
                            <button onClick={() => requestChanges(c.id)} disabled={busyId === c.id}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                              {busyId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Send changes
                            </button>
                            <button onClick={() => { setTweakId(null); setTweakText(''); }} className="px-3 py-1.5 text-xs rounded-lg border border-purple-200 text-purple-500 hover:bg-white">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <input type="datetime-local" value={scheduleById[c.id] || ''}
                            onChange={(e) => setScheduleById((p) => ({ ...p, [c.id]: e.target.value }))}
                            className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600"
                            title="Opcional: programa la hora de publicación" />
                          <div className="flex gap-2">
                            <button onClick={() => act(c.id, 'approve', scheduleById[c.id] ? { schedule_date: new Date(scheduleById[c.id]).toISOString() } : {})} disabled={busyId === c.id || role !== 'admin'}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                              {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {scheduleById[c.id] ? 'Programar' : 'Aprobar'}
                            </button>
                            <button onClick={() => act(c.id, 'reject')} disabled={busyId === c.id || role !== 'admin'}
                              className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                              <X size={15} />
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => startEdit(c)} disabled={role !== 'admin'}
                              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                              <Pencil size={12} /> Edit copy
                            </button>
                            <button onClick={() => { setEditId(null); setTweakId(c.id); setTweakText(''); }} disabled={role !== 'admin'}
                              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded-lg border border-purple-200 text-purple-600 hover:bg-purple-50 disabled:opacity-50">
                              <Wand2 size={12} /> Request changes
                            </button>
                          </div>
                        </>
                      )}
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
