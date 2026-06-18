import { useState, useEffect, useCallback } from 'react';

// Admin "Needs Approval" tab for the animated story-video pipeline.
// Two gates: pick 1 of 2 likeness options, then approve/reject the final video.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const FN_URL = `${SUPABASE_URL}/functions/v1/admin-story-videos`;

export default function NeedsApprovalTab({ accessToken, showToast }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // `${id}:${action}`
  const [error, setError] = useState('');

  const call = useCallback(async (body) => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true); setError('');
    try { const d = await call({ action: 'list' }); setOrders(d.orders || []); }
    catch (e) { setError(e.message || 'No se pudo cargar.'); }
    finally { setLoading(false); }
  }, [accessToken, call]);

  useEffect(() => { load(); }, [load]);

  async function act(id, action, extra = {}) {
    setBusy(`${id}:${action}`);
    try {
      await call({ action, id, ...extra });
      showToast?.(action.includes('approve') ? '✓ Aprobado' : 'Hecho', 'success');
      await load();
    } catch (e) { showToast?.(e.message || 'Error', 'error'); }
    finally { setBusy(null); }
  }

  const likeness = orders.filter((o) => o.state === 'likeness_review');
  const finals = orders.filter((o) => o.state === 'final_review');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Videos Animados — Aprobaciones</h2>
          <p className="text-sm text-gray-400">{likeness.length} likeness · {finals.length} videos por revisar</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg bg-pink-600 hover:bg-pink-700 text-white font-semibold transition disabled:opacity-50">
          {loading ? '...' : '↻ Refrescar'}
        </button>
      </div>
      {error && <div className="rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm px-3 py-2">{error}</div>}

      {/* GATE 1 — pick the likeness */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">① Elegir parecido (likeness)</h3>
        {likeness.length === 0 ? <Empty text="Nada pendiente de parecido." /> : (
          <div className="space-y-4">
            {likeness.map((o) => (
              <div key={o.id} className="rounded-xl border border-gray-800 bg-[#1a1f26] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-white font-semibold">{o.recipient}</div>
                  <button onClick={() => act(o.id, 'reject_likeness')} disabled={busy}
                    className="text-xs text-gray-400 hover:text-rose-400">Rechazar / pedir otra foto</button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {(o.character_options || []).map((opt, i) => (
                    <div key={i} className="rounded-lg overflow-hidden bg-gray-900 ring-1 ring-gray-800">
                      <img src={opt.url} alt={`opción ${i + 1}`} className="w-full aspect-[3/4] object-cover" />
                      <button onClick={() => act(o.id, 'approve_likeness', { index: i })}
                        disabled={busy === `${o.id}:approve_likeness`}
                        className="w-full py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50">
                        {busy === `${o.id}:approve_likeness` ? '...' : `✓ Usar opción ${i + 1}`}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* GATE 2 — approve the final video */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">② Aprobar video final</h3>
        {finals.length === 0 ? <Empty text="Nada pendiente de aprobación final." /> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {finals.map((o) => (
              <div key={o.id} className="rounded-xl border border-gray-800 bg-[#1a1f26] p-4">
                <div className="text-white font-semibold mb-3">{o.recipient}</div>
                {o.video_url && <video controls src={o.video_url} className="w-full rounded-lg bg-black aspect-[9/16] max-h-[480px] mx-auto" />}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => act(o.id, 'approve_final')} disabled={busy}
                    className="flex-1 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50">
                    {busy === `${o.id}:approve_final` ? '...' : '✓ Aprobar y enviar'}
                  </button>
                  <button onClick={() => act(o.id, 'reject_final')} disabled={busy}
                    className="px-3 py-2 text-sm font-semibold rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition disabled:opacity-50">
                    ↺ Rehacer
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Empty({ text }) {
  return <div className="rounded-xl border border-dashed border-gray-800 text-gray-500 text-sm px-4 py-8 text-center">{text}</div>;
}
