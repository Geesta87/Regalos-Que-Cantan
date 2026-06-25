// src/components/admin/CreativeChatPanel.jsx
// Art-director chat for the Creative Studio. Talk to Claude to brainstorm,
// generate visuals on demand (they render inline), tweak creatives, and save
// style preferences. Talks to the creative-chat edge function.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, Sparkles, AlertTriangle } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/creative-chat`;

const SUGGESTIONS = [
  'Give me 3 fresh angles for Día de las Madres',
  'Make a photoreal anniversary gift-moment image',
  'From now on, lean warmer and more golden light',
];

export default function CreativeChatPanel({ accessToken, showToast }) {
  const [messages, setMessages] = useState([]);
  const [creatives, setCreatives] = useState({}); // id -> row
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

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

  const applyState = (r) => {
    if (!r?.success) { if (r?.error) showToast?.(`Error: ${r.error}`); return; }
    setMessages(r.messages || []);
    const map = {};
    (r.creatives || []).forEach((c) => { map[c.id] = c; });
    setCreatives(map);
  };

  const sync = useCallback(async () => {
    try { applyState(await call({ action: 'sync' })); }
    catch (e) { /* transient */ }
    finally { setLoading(false); }
  }, [call]);

  useEffect(() => { sync(); }, [sync]);

  // Poll while anything is still rendering.
  const anyGenerating = Object.values(creatives).some((c) => c.status === 'generating');
  useEffect(() => {
    if (!anyGenerating) return;
    const t = setInterval(sync, 4000);
    return () => clearInterval(t);
  }, [anyGenerating, sync]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, creatives]);

  const submit = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput('');
    setSending(true);
    // optimistic
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content: msg }]);
    try { applyState(await call({ action: 'send', message: msg })); }
    catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setSending(false); }
  };

  const renderCreative = (id) => {
    const c = creatives[id];
    if (!c) return null;
    if (c.status === 'failed') return (
      <div key={id} className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg p-2 mt-2">
        <AlertTriangle size={14} /> Couldn't generate{c.error ? `: ${c.error}` : ''}
      </div>
    );
    if (c.status !== 'ready' || !c.media_url) return (
      <div key={id} className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3 mt-2 w-48">
        <Loader2 size={14} className="animate-spin" /> Rendering {c.kind}…
      </div>
    );
    return (
      <div key={id} className="mt-2">
        {c.kind === 'video'
          ? <video src={c.media_url} controls playsInline className="rounded-lg max-w-[220px] border border-gray-200" />
          : <img src={c.media_url} alt={c.concept || 'creative'} className="rounded-lg max-w-[220px] border border-gray-200" />}
        {c.concept && <div className="text-[11px] text-gray-400 mt-1 max-w-[220px]">{c.concept}</div>}
      </div>
    );
  };

  return (
    <div className="flex flex-col" style={{ height: '70vh', maxWidth: 760 }}>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={18} className="text-amber-500" />
        <span className="font-semibold text-gray-900">Art director</span>
        <span className="text-xs text-gray-400">— brainstorm, generate, tweak, set your style</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 justify-center py-10"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-400 py-10">
            <p className="mb-3">Say hi to your art director. Try:</p>
            <div className="flex flex-col items-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} className="text-sm text-gray-700 bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-gray-300">{s}</button>
              ))}
            </div>
          </div>
        ) : messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                {msg.content}
              </div>
              {(msg.creative_ids || []).map((id) => renderCreative(id))}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3.5 py-2 text-sm bg-white border border-gray-200 text-gray-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> thinking…
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Message your art director…"
          disabled={sending}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400 disabled:opacity-60"
        />
        <button onClick={() => submit()} disabled={sending || !input.trim()}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-50">
          <Send size={15} /> Send
        </button>
      </div>
    </div>
  );
}
