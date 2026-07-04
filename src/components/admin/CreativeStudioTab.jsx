// src/components/admin/CreativeStudioTab.jsx
// Creative Studio — the creative command center. Three groups:
//   Review (the approval queue: Ads / Social) · Create (Lab / Art director) ·
//   Marketing (Emails / Competitors). Approve to auto-post via GHL; nothing posts
//   until you approve it. Talks to creative-studio-admin with the admin JWT.
import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, RefreshCw, Check, X, Loader2, AlertTriangle, Megaphone, Pencil, Wand2, MoreHorizontal, Calendar, Image as ImageIcon, Film } from 'lucide-react';
import CreativeChatPanel from './CreativeChatPanel';
import EmailMarketerSection from './EmailMarketerSection';
import EmailStudioSection from './EmailStudioSection';
import EmailResultsSection from './EmailResultsSection';
import EmailPerformanceSection from './EmailPerformanceSection';
import CompetitorsSection from './CompetitorsSection';
import FreeformLabSection from './FreeformLabSection';
import { Card, Badge, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/creative-studio-admin`;

const STATUS_META = {
  ready:      { label: 'Ready to review',   tone: 'amber' },
  generating: { label: 'Generating…',       tone: 'accent' },
  posted:     { label: 'Published',         tone: 'green' },
  approved:   { label: 'Approved (paused)', tone: 'green' },
  failed:     { label: 'Failed',            tone: 'red' },
  rejected:   { label: 'Discarded',         tone: 'gray' },
};

const FILTERS = [
  { key: 'review', label: 'To review', statuses: ['ready', 'generating'] },
  { key: 'done',   label: 'Published',  statuses: ['posted', 'approved'] },
  { key: 'all',    label: 'All',        statuses: ['ready', 'generating', 'posted', 'approved', 'failed', 'rejected'] },
];

const GROUPS = [
  { key: 'review',    label: 'Review',    views: [['ads', 'Ads'], ['social', 'Social']] },
  { key: 'create',    label: 'Create',    views: [['lab', 'Lab'], ['chat', 'Art director']] },
  { key: 'marketing', label: 'Marketing', views: [['performance', 'Performance'], ['emails', 'Emails'], ['emailstudio', 'Email Studio'], ['emailresults', 'Results'], ['competitors', 'Competitors']] },
];

export default function CreativeStudioTab({ accessToken, showToast }) {
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('review');
  const [view, setView] = useState('ads');
  const [scheduleById, setScheduleById] = useState({});
  const [menuId, setMenuId] = useState(null);     // which card's overflow menu is open
  const [schedOpenId, setSchedOpenId] = useState(null); // which card is in "schedule" mode
  const [editId, setEditId] = useState(null);
  const [edits, setEdits] = useState({});
  const [tweakId, setTweakId] = useState(null);
  const [tweakText, setTweakText] = useState('');
  const [promo, setPromo] = useState('');
  const [promoSaved, setPromoSaved] = useState('');
  const [savingPromo, setSavingPromo] = useState(false);
  const [studioDraft, setStudioDraft] = useState(null); // email_queue draft handed to Email Studio for editing

  const call = useCallback(async (payload) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
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
      else showToast?.(`Error: ${r.error || 'could not load'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [accessToken, filter, call, showToast]);

  useEffect(() => { load(); }, [load]);

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
      if (r.success) { setPromoSaved(r.promo_notes || ''); showToast?.('Push saved — the next batch will use it'); }
      else showToast?.(`Error: ${r.error || 'could not save'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setSavingPromo(false); }
  };

  const act = async (id, action, extra = {}) => {
    if (role !== 'admin') { showToast?.('Admins only'); return; }
    setBusyId(id); setMenuId(null);
    try {
      const r = await call({ action, id, ...extra });
      if (r.success) {
        showToast?.(action === 'approve'
          ? (r.posted ? (extra.schedule_date ? 'Approved & scheduled' : 'Approved & posting') : 'Approved (posting paused)')
          : 'Discarded');
        setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, status: r.status } : c));
      } else showToast?.(`Error: ${r.error || 'failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const startEdit = (c) => {
    setTweakId(null); setMenuId(null);
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
        showToast?.('Copy updated');
      } else showToast?.(`Error: ${r.error || 'could not save'}`);
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
        showToast?.('Sent to the designer — the new version will appear shortly');
        load();
      } else showToast?.(`Error: ${r.error || 'failed'}`);
    } catch (err) { showToast?.(`Error: ${err.message}`); }
    finally { setBusyId(null); }
  };

  const currentGroup = GROUPS.find((g) => g.views.some(([k]) => k === view)) || GROUPS[0];
  const shown = creatives.filter((c) => (view === 'social' ? c.intended_use === 'social' : c.intended_use === 'ad'));
  const readyCount = shown.filter((c) => c.status === 'ready').length;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles size={20} className="text-indigo-600" /> Creative Studio
          </h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Your AI creative team — generate ads, emails and social posts, then approve to publish. Nothing posts until you approve it.
            {readyCount > 0 && currentGroup.key === 'review' && <span className="ml-1 font-medium text-amber-600">{readyCount} awaiting review.</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading} className={btn.ghost}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* This week's push */}
      <Card className="mb-5 p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Megaphone size={16} className="text-gray-500" />
          <h3 className="text-sm font-medium text-gray-900">This week's push</h3>
          <span className="text-[11px] text-gray-400">— what every new ad &amp; post should promote</span>
        </div>
        <textarea value={promo} onChange={(e) => setPromo(e.target.value)} rows={2}
          placeholder='e.g. "Promote Día del Padre this week + push the $9.99 video add-on" — leave blank for the normal rotation'
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400 resize-none" />
        <div className="flex items-center justify-between mt-2 gap-3">
          <p className="text-[11px] text-gray-400">The selling points &amp; prices ($29.99 song, $9.99 video, bundles…) are always built in — this just steers the focus.</p>
          <button onClick={savePromo} disabled={savingPromo || role !== 'admin' || promo === promoSaved} className={btn.accent + ' !px-3 !py-1.5 !text-sm whitespace-nowrap'}>
            {savingPromo ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {promo === promoSaved && promoSaved ? 'Saved' : 'Save push'}
          </button>
        </div>
      </Card>

      {/* Primary nav (groups) */}
      <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-1 w-fit">
        {GROUPS.map((g) => (
          <button key={g.key} onClick={() => setView(g.views[0][0])}
            className={`px-4 py-1.5 text-sm rounded-md transition ${currentGroup.key === g.key ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
            {g.label}
          </button>
        ))}
      </div>

      {/* Secondary nav (within the group) */}
      <div className="flex gap-2 mb-5">
        {currentGroup.views.map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-3 py-1.5 text-sm rounded-full transition ${view === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {currentGroup.key === 'create' ? (
        view === 'lab' ? <FreeformLabSection accessToken={accessToken} showToast={showToast} /> : <CreativeChatPanel accessToken={accessToken} showToast={showToast} />
      ) : currentGroup.key === 'marketing' ? (
        view === 'performance' ? <EmailPerformanceSection accessToken={accessToken} showToast={showToast} />
        : view === 'emails' ? <EmailMarketerSection accessToken={accessToken} showToast={showToast}
            onEditInStudio={(draft) => { setStudioDraft(draft); setView('emailstudio'); }} />
        : view === 'emailstudio' ? <EmailStudioSection accessToken={accessToken} showToast={showToast}
            initialDraft={studioDraft} onDraftConsumed={() => setStudioDraft(null)} />
        : view === 'emailresults' ? <EmailResultsSection accessToken={accessToken} showToast={showToast} />
        : <CompetitorsSection accessToken={accessToken} showToast={showToast} />
      ) : (
      <>
        {/* Status filter */}
        <div className="flex gap-2 mb-5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm rounded-full transition ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : shown.length === 0 ? (
          <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
            No {view === 'social' ? 'social posts' : 'ads'} here yet. Make some in Create → Art director, or the daily agent generates a fresh batch.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shown.map((c) => {
              const sm = STATUS_META[c.status] || { label: c.status, tone: 'gray' };
              return (
                <Card key={c.id} className="overflow-hidden flex flex-col">
                  {/* Media */}
                  <div className="relative bg-gray-900 aspect-[4/5] flex items-center justify-center">
                    {c.status === 'generating' || !c.media_url ? (
                      c.status === 'failed' ? (
                        <div className="text-red-300 text-xs flex flex-col items-center gap-1 p-4 text-center"><AlertTriangle size={20} /> {c.error || 'Generation failed'}</div>
                      ) : (
                        <div className="text-gray-400 text-xs flex flex-col items-center gap-2"><Loader2 size={20} className="animate-spin" /> Generating…</div>
                      )
                    ) : c.kind === 'video' ? (
                      <video src={c.media_url} controls playsInline className="w-full h-full object-cover" />
                    ) : (
                      <img src={c.media_url} alt={c.concept || 'creative'} className="w-full h-full object-cover" />
                    )}
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-black/60 text-white">
                      {c.kind === 'video' ? <Film size={11} /> : <ImageIcon size={11} />} {c.intended_use === 'ad' ? 'Ad' : 'Social'}
                    </span>
                    {typeof c.score === 'number' && <span className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/90 text-gray-800">{c.score}</span>}
                  </div>

                  {/* Copy */}
                  <div className="p-3 flex-1 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Badge tone={sm.tone}>{sm.label}</Badge>
                      {c.occasion && <span className="text-[11px] text-gray-400">{c.occasion}</span>}
                    </div>
                    {c.headline && <p className="font-medium text-gray-900 text-sm leading-snug">{c.headline}</p>}
                    {c.primary_text && <p className="text-xs text-gray-600 leading-relaxed line-clamp-4">{c.primary_text}</p>}
                    {c.caption && <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2 mt-0.5">{c.caption}</p>}
                    {Array.isArray(c.hashtags) && c.hashtags.length > 0 && (
                      <p className="text-[11px] text-indigo-500 mt-0.5">{c.hashtags.map((h) => `#${String(h).replace(/^#/, '')}`).join(' ')}</p>
                    )}
                    {c.persuasion_angle && <p className="text-[10px] text-gray-400 italic mt-0.5">Angle: {c.persuasion_angle}</p>}
                  </div>

                  {/* Actions */}
                  <div className="p-3 pt-0">
                    {c.status === 'ready' ? (
                      <div className="space-y-2">
                        {editId === c.id ? (
                          <div className="space-y-1.5 bg-gray-50 border border-gray-200 rounded-lg p-2">
                            <p className="text-[11px] font-medium text-gray-600">Edit the text before approving:</p>
                            <input value={edits[c.id]?.headline || ''} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...p[c.id], headline: e.target.value } }))} placeholder="Headline" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-900 placeholder-gray-400" />
                            <textarea value={edits[c.id]?.primary_text || ''} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...p[c.id], primary_text: e.target.value } }))} rows={2} placeholder="Primary text" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-900 placeholder-gray-400 resize-none" />
                            <textarea value={edits[c.id]?.caption || ''} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...p[c.id], caption: e.target.value } }))} rows={2} placeholder="Caption (what gets posted)" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-900 placeholder-gray-400 resize-none" />
                            <input value={edits[c.id]?.hashtags || ''} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...p[c.id], hashtags: e.target.value } }))} placeholder="#hashtags" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-900 placeholder-gray-400" />
                            <div className="flex gap-2">
                              <button onClick={() => saveCopy(c.id)} disabled={busyId === c.id} className={btn.primary + ' flex-1 !text-xs !py-1.5'}>{busyId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save copy</button>
                              <button onClick={() => setEditId(null)} className={btn.ghost + ' !text-xs !py-1.5'}>Cancel</button>
                            </div>
                          </div>
                        ) : tweakId === c.id ? (
                          <div className="space-y-1.5 bg-indigo-50 border border-indigo-200 rounded-lg p-2">
                            <p className="text-[11px] font-medium text-indigo-700">Request a change from the designer (generates a new version):</p>
                            <textarea value={tweakText} onChange={(e) => setTweakText(e.target.value)} rows={3} placeholder={'e.g. "make the background a sunset", "add the grandparents", "brighter and more colorful"'} className="w-full text-xs border border-indigo-200 rounded px-2 py-1.5 resize-none bg-white text-gray-900 placeholder-gray-400" />
                            <div className="flex gap-2">
                              <button onClick={() => requestChanges(c.id)} disabled={busyId === c.id} className={btn.accent + ' flex-1 !text-xs !py-1.5'}>{busyId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Send changes</button>
                              <button onClick={() => { setTweakId(null); setTweakText(''); }} className={btn.ghost + ' !text-xs !py-1.5'}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {schedOpenId === c.id && (
                              <input type="datetime-local" value={scheduleById[c.id] || ''} onChange={(e) => setScheduleById((p) => ({ ...p, [c.id]: e.target.value }))}
                                className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600" title="Schedule the publish time" />
                            )}
                            <div className="flex gap-2">
                              <button onClick={() => act(c.id, 'approve', schedOpenId === c.id && scheduleById[c.id] ? { schedule_date: new Date(scheduleById[c.id]).toISOString() } : {})} disabled={busyId === c.id || role !== 'admin'} className={btn.success + ' flex-1 !py-2'}>
                                {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {schedOpenId === c.id && scheduleById[c.id] ? 'Schedule' : 'Approve'}
                              </button>
                              <button onClick={() => setMenuId(menuId === c.id ? null : c.id)} disabled={role !== 'admin'} className={btn.ghost + ' !px-2.5 !py-2'} title="More actions"><MoreHorizontal size={16} /></button>
                            </div>
                            {menuId === c.id && (
                              <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                                <button onClick={() => { setMenuId(null); setSchedOpenId(schedOpenId === c.id ? null : c.id); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"><Calendar size={13} /> {schedOpenId === c.id ? 'Cancel schedule' : 'Schedule…'}</button>
                                <button onClick={() => startEdit(c)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"><Pencil size={13} /> Edit copy</button>
                                <button onClick={() => { setMenuId(null); setEditId(null); setTweakId(c.id); setTweakText(''); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-indigo-600 hover:bg-indigo-50"><Wand2 size={13} /> Request changes</button>
                                <button onClick={() => act(c.id, 'reject')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50"><X size={13} /> Reject</button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ) : c.status === 'posted' ? (
                      <div className="flex items-center gap-1.5 text-xs text-green-700"><Check size={14} /> Published{c.ghl_post_id ? ' to your channels' : ''}</div>
                    ) : c.status === 'approved' ? (
                      <p className="text-xs text-green-700">Approved — will post when posting is re-enabled.</p>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </>
      )}
    </div>
  );
}
