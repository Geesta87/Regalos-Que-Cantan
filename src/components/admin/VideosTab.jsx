import { useState, useEffect, useCallback } from 'react';

// Admin "Videos" tab for the $9.99 photo-slideshow video product.
// - Problem videos (failed / stuck) surfaced at top with one-click retry.
// - Search any customer to grab their video link to send.
// - Recent completed list with copy-link buttons.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const FN_URL = `${SUPABASE_URL}/functions/v1/admin-videos`;

export default function VideosTab({ accessToken, showToast }) {
  const [data, setData] = useState({ counts: {}, problems: [], completed: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [modalUrl, setModalUrl] = useState(null); // video preview modal

  const call = useCallback(async (cbody) => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(cbody),
    });
    const d = await res.json();
    if (!res.ok || !d.success) throw new Error(d.error || `HTTP ${res.status}`);
    return d;
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true); setError('');
    try { const d = await call({ action: 'list' }); setData(d); }
    catch (e) { setError(e.message || 'No se pudo cargar.'); }
    finally { setLoading(false); }
  }, [accessToken, call]);

  useEffect(() => { load(); }, [load]);

  const search = async () => {
    if (!q.trim()) { setResults(null); return; }
    try { const d = await call({ action: 'search', q: q.trim() }); setResults(d.results || []); }
    catch (e) { showToast?.(e.message || 'Error', 'error'); }
  };

  const retry = async (id) => {
    setBusy(id);
    try {
      const d = await call({ action: 'retry', id });
      showToast?.(`Reintentando (${d.renderer || 'render'})…`, 'success');
      await load();
    } catch (e) { showToast?.(e.message || 'Error', 'error'); }
    finally { setBusy(null); }
  };

  const copy = (url) => {
    try { navigator.clipboard.writeText(url); showToast?.('Link copiado', 'success'); }
    catch { showToast?.('No se pudo copiar', 'error'); }
  };

  const dismiss = async (id) => {
    setBusy(id);
    try { await call({ action: 'dismiss', id }); showToast?.('Quitado de problemas', 'success'); await load(); }
    catch (e) { showToast?.(e.message || 'Error', 'error'); }
    finally { setBusy(null); }
  };

  const c = data.counts || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">Videos (slideshow $9.99)</h2>
          <p className="text-sm text-gray-400">
            <span className="text-emerald-400 font-semibold">{c.completed ?? 0}</span> listos ·
            <span className="text-amber-400 font-semibold"> {c.processing ?? 0}</span> procesando ·
            <span className="text-rose-400 font-semibold"> {c.failed ?? 0}</span> fallidos ·
            <span className="text-gray-400"> {c.pending ?? 0} sin fotos</span>
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg bg-pink-600 hover:bg-pink-700 text-white font-semibold transition disabled:opacity-50">
          {loading ? '...' : '↻ Refrescar'}
        </button>
      </div>
      {error && <div className="rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm px-3 py-2">{error}</div>}

      {/* Search any customer to grab their link */}
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Buscar por nombre o email del cliente…"
          className="flex-1 px-3 py-2 rounded-lg bg-[#1a1f26] border border-gray-700 text-white text-sm outline-none focus:border-pink-500"
        />
        <button onClick={search} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold">Buscar</button>
        {results !== null && <button onClick={() => { setQ(''); setResults(null); }} className="px-3 py-2 rounded-lg text-gray-400 hover:text-white text-sm">✕</button>}
      </div>
      {results !== null && (
        <div className="space-y-2">
          {results.length === 0 ? <Empty text="Sin resultados." /> : results.map((v) => <Row key={v.id} v={v} onCopy={copy} onRetry={retry} onView={setModalUrl} busy={busy} />)}
        </div>
      )}

      {/* PROBLEMS */}
      {results === null && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-rose-400 font-semibold mb-3">⚠️ Problemas ({(data.problems || []).length})</h3>
          {(data.problems || []).length === 0
            ? <Empty text="Ningún video con problemas. 🎉" />
            : <div className="space-y-2">{data.problems.map((v) => <Row key={v.id} v={v} onCopy={copy} onRetry={retry} onView={setModalUrl} onDismiss={dismiss} busy={busy} />)}</div>}
        </section>
      )}

      {/* RECENT COMPLETED */}
      {results === null && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Listos recientes</h3>
          {(data.completed || []).length === 0
            ? <Empty text="Nada todavía." />
            : <div className="space-y-2">{data.completed.map((v) => <Row key={v.id} v={v} onCopy={copy} onRetry={retry} onView={setModalUrl} busy={busy} />)}</div>}
        </section>
      )}

      {/* Video preview modal — close to dismiss (no separate page) */}
      {modalUrl && (
        <div
          onClick={() => setModalUrl(null)}
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div onClick={(e) => e.stopPropagation()} className="relative">
            <button
              onClick={() => setModalUrl(null)}
              className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full bg-white text-black text-lg font-bold flex items-center justify-center shadow-lg hover:bg-gray-200"
              aria-label="Cerrar"
            >✕</button>
            <video
              src={modalUrl}
              controls
              autoPlay
              className="rounded-xl bg-black max-h-[85vh] max-w-[92vw] w-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    completed: ['Listo', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'],
    processing: ['Procesando', 'bg-amber-500/15 text-amber-300 border-amber-500/30'],
    photos_uploaded: ['En cola', 'bg-amber-500/15 text-amber-300 border-amber-500/30'],
    failed: ['Falló', 'bg-rose-500/15 text-rose-300 border-rose-500/30'],
    pending: ['Sin fotos', 'bg-gray-600/30 text-gray-300 border-gray-600/40'],
  };
  const [label, cls] = map[status] || [status, 'bg-gray-600/30 text-gray-300 border-gray-600/40'];
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}

// Which engine rendered it: in-house (our Cloud Run ffmpeg) vs Shotstack.
function RendererBadge({ renderer }) {
  if (renderer === 'inhouse') {
    return <span className="text-[11px] px-2 py-0.5 rounded-full border bg-sky-500/15 text-sky-300 border-sky-500/30" title="Renderizado por nuestro motor (sin costo Shotstack)">🏠 En casa</span>;
  }
  if (renderer === 'shotstack') {
    return <span className="text-[11px] px-2 py-0.5 rounded-full border bg-gray-600/30 text-gray-300 border-gray-600/40" title="Renderizado por Shotstack">Shotstack</span>;
  }
  return null;
}

function Row({ v, onCopy, onRetry, onView, onDismiss, busy }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-[#1a1f26] p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold truncate">{v.recipient_name}</span>
          <StatusPill status={v.status} />
          {v.status === 'completed' && <RendererBadge renderer={v.renderer} />}
          {v.photo_count ? <span className="text-[11px] text-gray-500">{v.photo_count} fotos</span> : null}
        </div>
        <div className="text-xs text-gray-500 truncate">{v.email}{v.error_message ? <span className="text-rose-400"> · {v.error_message}</span> : ''}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {v.video_url && (
          <>
            <button onClick={() => onView?.(v.video_url)}
              className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-semibold">Ver</button>
            <button onClick={() => onCopy(v.video_url)}
              className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">Copiar link</button>
          </>
        )}
        {(v.status === 'failed' || v.status === 'processing' || v.status === 'photos_uploaded') && (
          <button onClick={() => onRetry(v.id)} disabled={busy === v.id}
            className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50">
            {busy === v.id ? '...' : '↺ Reintentar'}
          </button>
        )}
        {onDismiss && (
          <button onClick={() => onDismiss(v.id)} disabled={busy === v.id} title="Quitar de problemas"
            className="px-2.5 py-1.5 text-xs rounded-lg bg-gray-800 hover:bg-rose-600/70 text-gray-400 hover:text-white font-semibold disabled:opacity-50">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <div className="rounded-xl border border-dashed border-gray-800 text-gray-500 text-sm px-4 py-6 text-center">{text}</div>;
}
