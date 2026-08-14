// Cuento Ilustrado — admin test bench (test phase, 2026-08-13).
// Search a song → Generate → watch progress → open/copy the /cuento link.
// English admin UI per house rules. Calls generate-cuento with the admin JWT.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Search, Loader2, ExternalLink, Copy, RefreshCw, AlertTriangle } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-cuento`;

const box = 'bg-white border border-gray-200 rounded-xl p-4';
const btnPrimary = 'inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost = 'inline-flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg';

const STATUS_STYLE = {
  generating: 'bg-amber-100 text-amber-800',
  ready: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-700',
  planning: 'bg-gray-100 text-gray-600',
};

export default function CuentoTab({ accessToken, showToast }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [songs, setSongs] = useState([]);
  const [generatingSongId, setGeneratingSongId] = useState(null);
  const [cuentos, setCuentos] = useState([]);
  const pollRef = useRef(null);

  const call = useCallback(async (action, payload = {}) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action, ...payload }),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.success) throw new Error(j.error || `Request failed (${res.status})`);
    return j;
  }, [accessToken]);

  const refreshList = useCallback(async () => {
    try {
      const j = await call('list');
      setCuentos(j.cuentos || []);
      return j.cuentos || [];
    } catch { return []; }
  }, [call]);

  useEffect(() => { refreshList(); }, [refreshList]);

  // While anything is generating, tick 'status' on it every 10s (the status
  // action is what advances the pipeline: anchor → pages → ready).
  useEffect(() => {
    const active = cuentos.filter((c) => c.status === 'generating' || c.status === 'planning');
    if (!active.length) return undefined;
    pollRef.current = setInterval(async () => {
      for (const c of active) {
        try { await call('status', { cuentoId: c.id }); } catch { /* keep polling */ }
      }
      refreshList();
    }, 10000);
    return () => clearInterval(pollRef.current);
  }, [cuentos, call, refreshList]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const j = await call('find', { query: query.trim() });
      setSongs(j.songs || []);
      if (!(j.songs || []).length) showToast?.('No songs found for that search', 'error');
    } catch (e) { showToast?.(e.message, 'error'); }
    finally { setSearching(false); }
  };

  const generate = async (songId) => {
    setGeneratingSongId(songId);
    try {
      await call('generate', { songId });
      showToast?.('Cuento started — planning pages and rendering the cover');
      await refreshList();
    } catch (e) { showToast?.(e.message, 'error'); }
    finally { setGeneratingSongId(null); }
  };

  const copyLink = (token) => {
    const url = `${window.location.origin}/cuento/${token}`;
    navigator.clipboard?.writeText(url);
    showToast?.('Link copied');
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className={box}>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen size={18} className="text-indigo-600" />
          <h2 className="font-semibold text-gray-900">Cuento Ilustrado — test bench</h2>
        </div>
        <p className="text-sm text-gray-500 mb-3">
          Generates an illustrated storybook from a song's own lyrics (7 pages + cover, ~4 minutes,
          costs cents in Kie credits). Test phase: links are unlisted — nothing is sent to customers.
        </p>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
            placeholder="Search songs by recipient name or email"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button className={btnPrimary} onClick={search} disabled={searching || query.trim().length < 2}>
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Search
          </button>
        </div>
        {songs.length > 0 && (
          <div className="mt-3 divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {songs.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {s.recipient_name || 'No name'}{s.sender_name ? ` — from ${s.sender_name}` : ''}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {s.email} · {s.genre || '?'} · {s.occasion || '?'} · {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button className={btnPrimary} onClick={() => generate(s.id)} disabled={generatingSongId === s.id}>
                  {generatingSongId === s.id ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />}
                  Generate cuento
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={box}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900">Recent cuentos</h3>
          <button className={btnGhost} onClick={refreshList}><RefreshCw size={14} /> Refresh</button>
        </div>
        {cuentos.length === 0 && <p className="text-sm text-gray-500">Nothing generated yet.</p>}
        <div className="space-y-2">
          {cuentos.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2">
              {c.cover_url
                ? <img src={c.cover_url} alt="" className="w-10 h-[53px] object-cover rounded" />
                : <div className="w-10 h-[53px] bg-gray-100 rounded" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {c.title || 'Untitled'} — {c.recipient_name}
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[c.status] || 'bg-gray-100 text-gray-600'}`}>{c.status}</span>
                  <span>{c.pages_done}/{c.pages_total} pages</span>
                  {(c.status === 'generating' || c.status === 'planning') && <Loader2 size={12} className="animate-spin" />}
                </div>
                {c.status === 'failed' && c.error && (
                  <div className="text-xs text-red-600 flex items-center gap-1 mt-0.5">
                    <AlertTriangle size={12} /> {c.error}
                  </div>
                )}
              </div>
              {c.status === 'ready' && (
                <div className="flex gap-1.5 flex-shrink-0">
                  <a className={btnGhost} href={`/cuento/${c.share_token}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={14} /> Open
                  </a>
                  <button className={btnGhost} onClick={() => copyLink(c.share_token)}><Copy size={14} /> Copy</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
