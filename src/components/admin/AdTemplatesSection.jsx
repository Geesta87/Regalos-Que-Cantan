// src/components/admin/AdTemplatesSection.jsx
// "Templates" section of the Creative Studio. A gallery of proven ad-style
// templates; click "Generar 5" on any → it produces 5 on-brand ad variations in
// that style (rendered by gpt-image-1) straight into the Ads queue. Admin-only.
import React, { useState, useEffect, useCallback } from 'react';
import { LayoutTemplate, Loader2, Wand2, ImageIcon } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ad-templates`;

export default function AdTemplatesSection({ accessToken, showToast }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [prepping, setPrepping] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [dest, setDest] = useState('ad'); // 'ad' | 'social' — where the 5 land

  const call = useCallback(async (payload) => {
    const res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify(payload) });
    return res.json();
  }, [accessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call({ action: 'list_templates' });
      if (r.success) setTemplates(r.templates || []);
      else showToast?.(`Error: ${r.error || 'no se pudo cargar'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);

  // One-time: generate sample preview thumbnails if missing.
  useEffect(() => {
    if (seeded || loading || !templates.length) return;
    if (templates.every((t) => t.thumbnail_url)) return;
    setSeeded(true); setPrepping(true);
    call({ action: 'seed_thumbnails' }).then(() => load()).finally(() => setPrepping(false));
  }, [templates, loading, seeded, call, load]);

  const generate = async (t) => {
    setBusyId(t.id);
    try {
      const r = await call({ action: 'generate_from_template', template_id: t.id, count: 5, intended_use: dest });
      if (r.success) showToast?.(`🎨 Generando 5 estilo "${t.name}" → revísalos en ${dest === 'social' ? 'Social' : 'Ads'}`);
      else showToast?.(`Error: ${r.error || 'falló'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><LayoutTemplate size={18} className="text-gray-700" /> Plantillas de anuncios</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">Estilos probados. Elige un estilo, decide el destino, y genera 5 variaciones (gpt-image-2, calidad premium).{prepping && <span className="ml-1 text-amber-600">Preparando vistas previas…</span>}</p>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-gray-500">Generar para:</span>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[['ad', '📣 Ads'], ['social', '📱 Social']].map(([k, label]) => (
              <button key={k} onClick={() => setDest(k)} className={`px-3 py-1 text-sm rounded-md transition ${dest === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
              <div className="aspect-[4/5] bg-gray-100 flex items-center justify-center">
                {t.thumbnail_url ? <img src={t.thumbnail_url} alt={t.name} className="w-full h-full object-cover" />
                  : <div className="flex flex-col items-center gap-1 text-gray-300">{prepping ? <Loader2 size={20} className="animate-spin" /> : <ImageIcon size={28} />}<span className="text-3xl">{t.emoji}</span></div>}
              </div>
              <div className="p-3 flex-1 flex flex-col">
                <div className="font-semibold text-gray-900 text-sm">{t.emoji} {t.name}</div>
                <p className="text-xs text-gray-500 mt-0.5 flex-1">{t.description}</p>
                <button onClick={() => generate(t)} disabled={busyId === t.id}
                  className="mt-3 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                  {busyId === t.id ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Generar 5 con este estilo
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
