// src/components/admin/ContentCalendarTab.jsx
// Content Calendar — the hands-off auto-poster's schedule, with full control.
// Lists the [MES-1] queue by post date; lets the owner edit the caption,
// reschedule a post to a different day, delete it, and pause/resume the whole
// auto-poster. Talks to creative-studio-admin (schedule_list / update /
// reschedule / reject / set_posting). Admin-only mutations.
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, Image as ImageIcon, Film, Pencil, Trash2, Check, X, Play, Pause, ArrowRight } from 'lucide-react';
import { Card, Badge, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/creative-studio-admin`;

const STATUS = {
  ready:    { label: 'En cola',   tone: 'amber' },
  posted:   { label: 'Publicado', tone: 'green' },
  approved: { label: 'Aprobado',  tone: 'green' },
};

const fmtDay = (d) => {
  try { return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }); }
  catch { return d; }
};

export default function ContentCalendarTab({ accessToken, showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [postingOn, setPostingOn] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');

  const call = useCallback(async (payload) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    return res.json();
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const r = await call({ action: 'schedule_list' });
      if (r.success) { setItems(r.creatives || []); setRole(r.role); setPostingOn(!!r.posting_enabled); }
      else showToast?.(`Error: ${r.error || 'no se pudo cargar'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [accessToken, call, showToast]);

  useEffect(() => { load(); }, [load]);

  const isAdmin = role === 'admin';

  const togglePosting = async () => {
    if (!isAdmin) { showToast?.('Solo admins'); return; }
    setToggling(true);
    try {
      const r = await call({ action: 'set_posting', enabled: !postingOn });
      if (r.success) { setPostingOn(!!r.posting_enabled); showToast?.(r.posting_enabled ? 'Publicación automática reanudada' : 'Publicación automática en pausa'); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setToggling(false); }
  };

  const startEdit = (c) => { setEditId(c.id); setEditText(c.caption || ''); };
  const saveCaption = async (id) => {
    setBusyId(id);
    try {
      const r = await call({ action: 'update', id, caption: editText });
      if (r.success) { setItems((p) => p.map((c) => c.id === id ? { ...c, caption: editText } : c)); setEditId(null); showToast?.('Texto actualizado'); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const reschedule = async (id, date) => {
    if (!date) return;
    setBusyId(id);
    try {
      const r = await call({ action: 'reschedule', id, batch_date: date });
      if (r.success) { setItems((p) => p.map((c) => c.id === id ? { ...c, batch_date: date } : c).sort((a, b) => (a.batch_date > b.batch_date ? 1 : a.batch_date < b.batch_date ? -1 : 0))); showToast?.('Reprogramado'); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const del = async (id) => {
    if (!isAdmin) { showToast?.('Solo admins'); return; }
    setBusyId(id);
    try {
      const r = await call({ action: 'reject', id });
      if (r.success) { setItems((p) => p.filter((c) => c.id !== id)); showToast?.('Eliminado del calendario'); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  // group by day
  const days = {};
  for (const it of items) { (days[it.batch_date] ||= []).push(it); }
  const dates = Object.keys(days).sort();
  const nextImg = items.find((c) => c.status === 'ready' && c.kind === 'image')?.id;
  const nextVid = items.find((c) => c.status === 'ready' && c.kind === 'video')?.id;
  const readyCount = items.filter((c) => c.status === 'ready').length;
  const postedCount = items.filter((c) => c.status === 'posted').length;

  return (
    <div className="max-w-5xl">
      {/* Posting switch */}
      <Card className="mb-5 p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${postingOn ? 'bg-green-500' : 'bg-amber-500'}`} />
          <div>
            <p className="text-sm font-medium text-gray-900">{postingOn ? 'Publicación automática activa' : 'Publicación en pausa'}</p>
            <p className="text-xs text-gray-500">Se publica 1 imagen (~10am) y 1 video (~6pm) cada día, en orden. {readyCount} en cola · {postedCount} publicados.</p>
          </div>
        </div>
        <button onClick={togglePosting} disabled={toggling || !isAdmin}
          className={postingOn ? btn.ghost : btn.success}>
          {toggling ? <Loader2 size={15} className="animate-spin" /> : postingOn ? <Pause size={15} /> : <Play size={15} />}
          {postingOn ? 'Pausar todo' : 'Reanudar'}
        </button>
      </Card>

      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400">Toca el texto para editar la descripción · cambia la fecha para reprogramar · la papelera lo quita del calendario.</p>
        <button onClick={load} disabled={loading} className={btn.ghost}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Cargando calendario…</div>
      ) : dates.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">No hay nada programado todavía.</div>
      ) : (
        <div className="space-y-5">
          {dates.map((d) => (
            <div key={d}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-800 capitalize">{fmtDay(d)}</span>
                <span className="text-[11px] text-gray-400">{d}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {days[d].map((c) => {
                  const sm = STATUS[c.status] || { label: c.status, tone: 'gray' };
                  const isNext = c.status === 'ready' && (c.id === nextImg || c.id === nextVid);
                  const editable = c.status !== 'posted';
                  return (
                    <Card key={c.id} className="p-3 flex gap-3">
                      <div className="relative w-20 flex-none">
                        {c.kind === 'video'
                          ? <video src={`${c.media_url}#t=2`} muted playsInline preload="metadata" className="w-20 h-24 object-cover rounded-lg bg-gray-900" />
                          : <img src={c.media_url} alt="" className="w-20 h-24 object-cover rounded-lg bg-gray-100" />}
                        <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-black/60 text-white">
                          {c.kind === 'video' ? <Film size={9} /> : <ImageIcon size={9} />}{c.kind === 'video' ? 'Video' : 'Imagen'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <Badge tone={sm.tone}>{sm.label}</Badge>
                          {isNext && <Badge tone="accent">El siguiente <ArrowRight size={10} className="ml-0.5" /></Badge>}
                        </div>
                        {c.headline && <p className="text-[13px] font-medium text-gray-900 leading-snug mb-1">{c.headline}</p>}
                        {editId === c.id ? (
                          <div className="space-y-1.5">
                            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4}
                              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-800 resize-none" />
                            <div className="flex gap-2">
                              <button onClick={() => saveCaption(c.id)} disabled={busyId === c.id} className={btn.primary + ' !text-xs !py-1.5'}>
                                {busyId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Guardar
                              </button>
                              <button onClick={() => setEditId(null)} className={btn.ghost + ' !text-xs !py-1.5'}><X size={13} /> Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <p onClick={() => editable && isAdmin && startEdit(c)}
                            className={`text-xs text-gray-600 leading-relaxed line-clamp-3 ${editable && isAdmin ? 'cursor-text hover:text-gray-900' : ''}`}>
                            {c.caption || <span className="text-gray-400 italic">Sin descripción</span>}
                          </p>
                        )}
                        {editId !== c.id && (
                          <div className="flex items-center gap-2 mt-2">
                            {editable && (
                              <input type="date" defaultValue={c.batch_date} disabled={!isAdmin || busyId === c.id}
                                onChange={(e) => reschedule(c.id, e.target.value)}
                                className="text-[11px] border border-gray-200 rounded px-1.5 py-1 text-gray-600" title="Cambiar la fecha de publicación" />
                            )}
                            {editable && isAdmin && (
                              <>
                                <button onClick={() => startEdit(c)} className={btn.iconGhost + ' !w-8 !h-8'} title="Editar texto"><Pencil size={13} /></button>
                                <button onClick={() => del(c.id)} disabled={busyId === c.id} className={btn.iconGhost + ' !w-8 !h-8 hover:!text-red-600'} title="Quitar del calendario"><Trash2 size={13} /></button>
                              </>
                            )}
                            {c.status === 'posted' && <span className="text-[11px] text-green-700 inline-flex items-center gap-1"><Check size={12} /> Ya publicado</span>}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
