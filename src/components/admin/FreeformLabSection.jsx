// src/components/admin/FreeformLabSection.jsx
// Freeform Lab — prompt gpt-image-2 DIRECTLY, with no brand brief, style, or
// design-layer guardrails (exactly what you'd get prompting the model itself).
// Saves every image; "Create more like this" generates similar ones off it
// (image-to-image), so the owner can show the Art Director / Sofía the exact
// look they want. Talks straight to the creative-chat edge function.
import React, { useState, useEffect, useCallback } from 'react';
import { Beaker, Loader2, Sparkles, Copy, AlertTriangle, RefreshCw, Wand2, X } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/creative-chat`;

export default function FreeformLabSection({ accessToken, showToast }) {
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moreId, setMoreId] = useState(null);   // image being "create more like this"-ed
  const [moreTweak, setMoreTweak] = useState('');

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
      const r = await call({ action: 'raw_list' });
      if (r.success) setImages(r.creatives || []);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [accessToken, call, showToast]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!prompt.trim()) { showToast?.('Write a prompt first'); return; }
    setBusy(true);
    try {
      const r = await call({ action: 'raw_generate', prompt: prompt.trim(), count });
      if (r.success) { showToast?.(`✨ Generated ${r.count} image${r.count > 1 ? 's' : ''}`); load(); }
      else showToast?.(`Error: ${r.error || 'generation failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  const createMore = async (id) => {
    setBusy(true);
    try {
      const r = await call({ action: 'raw_more', creative_id: id, tweak: moreTweak.trim() || undefined, count: 3 });
      if (r.success) { showToast?.(`✨ Made ${r.count} more like this`); setMoreId(null); setMoreTweak(''); load(); }
      else showToast?.(`Error: ${r.error || 'failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  const copyPrompt = (p) => {
    navigator.clipboard?.writeText(p || '').then(() => showToast?.('Prompt copied')).catch(() => {});
  };

  const hasGenerating = images.some((i) => i.status === 'generating');

  return (
    <div className="max-w-6xl">
      {/* Prompt box */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Beaker size={17} className="text-indigo-600" />
          <h3 className="text-sm font-semibold text-gray-900">Freeform Lab</h3>
          <span className="text-[11px] text-gray-500">— prompt the image model directly, no brand or style rules applied</span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder='Describe exactly the image you want, as if you were prompting GPT directly — e.g. "A cinematic close-up of an older Mexican father in a kitchen, tears in his eyes, holding a phone, warm window light, shallow depth of field, photoreal, 35mm"'
          className="w-full text-sm border border-indigo-200 rounded-lg px-3 py-2 text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
        <div className="flex items-center justify-between mt-2.5">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span>How many:</span>
            {[1, 2, 3].map((n) => (
              <button key={n} onClick={() => setCount(n)}
                className={`w-7 h-7 rounded-md text-xs font-medium ${count === n ? 'bg-indigo-600 text-white' : 'bg-white border border-indigo-200 text-gray-600 hover:bg-indigo-50'}`}>
                {n}
              </button>
            ))}
          </div>
          <button onClick={generate} disabled={busy || !prompt.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Generate
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          These are raw images — no logo, no headline, no template. Use “Create more like this” on any one to build a set, then tell the Art Director “make ads from my Lab images”.
        </p>
      </div>

      {/* Gallery */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-700">Your Lab images</h4>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh{hasGenerating ? ' (generating…)' : ''}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : images.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          No Lab images yet. Write a prompt above and hit Generate.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {images.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
              <div className="relative bg-gray-900 aspect-[3/4] flex items-center justify-center">
                {c.status === 'generating' ? (
                  <div className="text-gray-400 text-xs flex flex-col items-center gap-2"><Loader2 size={20} className="animate-spin" /> Generating…</div>
                ) : c.status === 'failed' ? (
                  <div className="text-red-300 text-xs flex flex-col items-center gap-1 p-3 text-center"><AlertTriangle size={18} /> {c.error || 'Failed'}</div>
                ) : (
                  <img src={c.media_url} alt={c.concept || 'lab image'} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="p-2.5 flex-1 flex flex-col gap-1.5">
                <p className="text-[11px] text-gray-500 line-clamp-2" title={c.gen_prompt || ''}>{c.gen_prompt || '—'}</p>
                {moreId === c.id ? (
                  <div className="space-y-1.5 bg-indigo-50 border border-indigo-200 rounded-lg p-2 mt-auto">
                    <textarea value={moreTweak} onChange={(e) => setMoreTweak(e.target.value)} rows={2}
                      placeholder="Optional: what to change (e.g. 'a mother instead', 'sunset light')"
                      className="w-full text-[11px] border border-indigo-200 rounded px-2 py-1 bg-white text-gray-900 placeholder-gray-400 resize-none" />
                    <div className="flex gap-1.5">
                      <button onClick={() => createMore(c.id)} disabled={busy}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Make 3
                      </button>
                      <button onClick={() => { setMoreId(null); setMoreTweak(''); }} className="px-2 py-1.5 text-[11px] rounded-lg border border-indigo-200 text-indigo-500 hover:bg-white"><X size={12} /></button>
                    </div>
                  </div>
                ) : c.status === 'ready' ? (
                  <div className="flex gap-1.5 mt-auto">
                    <button onClick={() => { setMoreId(c.id); setMoreTweak(''); }} disabled={busy}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                      <Wand2 size={12} /> Create more like this
                    </button>
                    <button onClick={() => copyPrompt(c.gen_prompt)} title="Copy prompt"
                      className="px-2 py-1.5 text-[11px] rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><Copy size={12} /></button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
