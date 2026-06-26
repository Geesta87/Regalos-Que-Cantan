// src/components/admin/AffiliateRecruiterTab.jsx
// "Recruit Partners" — the Affiliate Recruiter agent's screen. Shows ranked
// creator prospects (TikTok/IG) with a ready-to-send Spanish outreach DM. The
// owner copies + sends the DM, tracks status, and on a reply converts them into
// a real affiliate (reuses create-affiliate). Admin-only.
import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, RefreshCw, Loader2, Copy, Check, X, ExternalLink, SlidersHorizontal } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-recruiter-admin`;
const STATUS = {
  new: { label: 'Nuevo', cls: 'bg-amber-100 text-amber-800' },
  contacted: { label: 'Contactado', cls: 'bg-blue-100 text-blue-800' },
  responded: { label: 'Respondió', cls: 'bg-purple-100 text-purple-700' },
  converted: { label: 'Afiliado ✓', cls: 'bg-green-100 text-green-800' },
};
const fmt = (n) => (n == null ? '—' : Intl.NumberFormat('en', { notation: 'compact' }).format(n));

export default function AffiliateRecruiterTab({ accessToken, showToast }) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [convertId, setConvertId] = useState(null);
  const [email, setEmail] = useState('');
  const [platform, setPlatform] = useState('all');
  // Search criteria for the next scan (steer who the recruiter goes after)
  const [showFilters, setShowFilters] = useState(false);
  const [minF, setMinF] = useState('');
  const [maxF, setMaxF] = useState('');
  const [terms, setTerms] = useState('');

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
      if (r.success) setProspects(r.prospects || []);
      else showToast?.(`Error: ${r.error || 'could not load'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setScanning(true);
    try {
      const filters = {};
      if (minF !== '' && Number.isFinite(Number(minF))) filters.min_followers = Number(minF);
      if (maxF !== '' && Number.isFinite(Number(maxF))) filters.max_followers = Number(maxF);
      const t = terms.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      if (t.length) filters.niches = t;
      if (platform !== 'all') filters.platform = platform;
      const r = await call({ action: 'scan', ...filters });
      if (r.success) { showToast?.('Buscando creadores… aparecen en ~1 min'); setTimeout(load, 60000); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setScanning(false); }
  };

  const setStatus = async (id, status) => {
    setBusyId(id);
    try {
      const r = await call({ action: 'status', id, status });
      if (r.success) {
        if (status === 'dismissed') setProspects((p) => p.filter((x) => x.id !== id));
        else setProspects((p) => p.map((x) => x.id === id ? { ...x, status } : x));
      } else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const convert = async (id) => {
    if (!email.trim()) { showToast?.('Ingresa el email del creador'); return; }
    setBusyId(id);
    try {
      const r = await call({ action: 'convert', id, email });
      if (r.success) { showToast?.(`✅ Afiliado creado: ${r.code} (correo enviado)`); setProspects((p) => p.map((x) => x.id === id ? { ...x, status: 'converted', affiliate_code: r.code } : x)); setConvertId(null); setEmail(''); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const copy = (text) => { navigator.clipboard?.writeText(text); showToast?.('Mensaje copiado'); };

  const shown = prospects.filter((p) => platform === 'all' || p.platform === platform);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><UserPlus size={22} className="text-gray-700" /> Recruit Partners</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">Latino creators who'd make great affiliates, ranked by fit. Each comes with a ready Spanish DM — copy it, send it, and convert them when they reply. (We never auto-DM.)</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowFilters((s) => !s)} className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition ${showFilters ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            <SlidersHorizontal size={15} /> Filters
          </button>
          <button onClick={scan} disabled={scanning} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Scan now
          </button>
        </div>
      </div>

      {/* Search criteria — steer who the recruiter goes after on the next scan */}
      {showFilters && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3.5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Who to look for</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">Min followers
              <input type="number" min="0" value={minF} onChange={(e) => setMinF(e.target.value)} placeholder="3,000"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
            </label>
            <label className="text-xs text-gray-600">Max followers
              <input type="number" min="0" value={maxF} onChange={(e) => setMaxF(e.target.value)} placeholder="1,500,000"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
            </label>
          </div>
          <label className="text-xs text-gray-600 block">Search terms / niches <span className="text-gray-400">(comma-separated)</span>
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2}
              placeholder="canción personalizada, regalo personalizado, quinceañera, boda mexicana, música regional mexicana"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white resize-none" />
          </label>
          <p className="text-[11px] text-gray-400">
            Leave blank to use the defaults (3K–1.5M followers, standard niches). These filters apply when you hit <b>Scan now</b>. Search terms stay in Spanish to match the creators you're targeting.
          </p>
        </div>
      )}

      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[['all', 'Todos'], ['tiktok', 'TikTok'], ['instagram', 'Instagram']].map(([k, label]) => (
          <button key={k} onClick={() => setPlatform(k)} className={`px-3 py-1 text-sm rounded-md transition ${platform === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">No prospects yet. Hit "Scan now" — or the weekly scan will fill this in.</div>
      ) : (
        <div className="space-y-3">
          {shown.map((p) => {
            const sm = STATUS[p.status] || { label: p.status, cls: 'bg-gray-100 text-gray-600' };
            return (
              <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{p.display_name || p.handle}</span>
                      <a href={p.profile_url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-0.5">@{p.handle} <ExternalLink size={12} /></a>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.platform}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[12px] text-gray-500">
                      <span>👥 {fmt(p.followers)} seguidores</span>
                      {p.likes != null && <span>❤️ {fmt(p.likes)}</span>}
                      {p.videos != null && <span>🎬 {fmt(p.videos)}</span>}
                      <span className="text-gray-300">·</span>
                      <span>vía "{p.niche}"</span>
                    </div>
                    {p.fit_reason && <p className="text-xs text-gray-600 mt-1.5">{p.fit_reason}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold text-gray-900">{p.fit_score ?? '—'}</div>
                    <div className="text-[10px] text-gray-400">fit</div>
                    {p.suggested_commission && <div className="text-[10px] text-gray-400 mt-1">{p.suggested_commission}% com.</div>}
                  </div>
                </div>

                {p.outreach_draft && p.status !== 'converted' && (
                  <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed relative">
                    {p.outreach_draft}
                    <button onClick={() => copy(p.outreach_draft)} className="absolute top-2 right-2 text-gray-400 hover:text-gray-700" title="Copiar"><Copy size={14} /></button>
                  </div>
                )}

                {p.status === 'converted' ? (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-green-700"><Check size={14} /> Afiliado creado{p.affiliate_code ? ` · código ${p.affiliate_code}` : ''}</div>
                ) : convertId === p.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email del creador" type="email"
                      className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    <button onClick={() => convert(p.id)} disabled={busyId === p.id}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                      {busyId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Crear afiliado
                    </button>
                    <button onClick={() => { setConvertId(null); setEmail(''); }} className="text-sm text-gray-500 px-2">Cancelar</button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.status === 'new' && <button onClick={() => setStatus(p.id, 'contacted')} disabled={busyId === p.id} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">Marcar contactado</button>}
                    {p.status === 'contacted' && <button onClick={() => setStatus(p.id, 'responded')} disabled={busyId === p.id} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">Respondió</button>}
                    <button onClick={() => { setConvertId(p.id); setEmail(''); }} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">Convertir en afiliado</button>
                    <button onClick={() => setStatus(p.id, 'dismissed')} disabled={busyId === p.id} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 flex items-center gap-1"><X size={12} /> Descartar</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
