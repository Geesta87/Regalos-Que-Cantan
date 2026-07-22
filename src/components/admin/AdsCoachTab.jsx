// src/components/admin/AdsCoachTab.jsx
// Meta Ads Coach — an advice-only ads specialist you chat with. It reads your
// LIVE Meta numbers + real paid orders, SEES your top ad creatives, and reasons
// with the Meta Algorithm Brain (how Meta actually delivers ads today), always
// explaining the WHY. It remembers past conversations and logs its own
// recommendations so you can grade them. It never changes your account — you
// apply its suggestions in Meta Ads Manager. Admin-only. Talks to the ads-coach
// edge function.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Target, Send, Loader2, RefreshCw, Sparkles, Check, X } from 'lucide-react';
import { btn, Badge } from './ui';

const COACH = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ads-coach`;

const STARTERS = [
  'What is my single highest-leverage move right now?',
  'Which of my individual ads is the winner, and which should I kill?',
  'Look at my ad creatives — are they too similar to each other?',
  'Is any campaign or ad showing signs of fatigue?',
  'What should I test next to find a new winner?',
];

const GREETING = "Hi — I'm your Meta ads coach. I can see your live account (last 7 days of spend, sales, real paid orders, and your individual ads — including the actual creative images), and I reason from how Meta's delivery really works today. Ask me anything — why an ad is winning or dying, what to test next, where your money is best spent. I explain the *why*, I remember our past chats, and I'll give you the exact move to make (you apply it in Meta Ads Manager — I never touch the account myself).";

export default function AdsCoachTab({ accessToken, showToast }) {
  const [messages, setMessages] = useState([]); // {role, content, live?}
  const [calls, setCalls] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  const call = useCallback(async (payload) => {
    const res = await fetch(COACH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    return res.json();
  }, [accessToken]);

  // Load past conversation + track record on open (cross-session memory).
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const body = await call({ action: 'history' });
      if (body.success) {
        setMessages((body.messages || []).map((m) => ({ role: m.role, content: m.content })));
        setCalls(body.calls || []);
      }
    } catch (e) { showToast?.(`Coach: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, sending]);

  const submit = useCallback(async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput('');
    const next = [...messages, { role: 'user', content: msg }];
    setMessages(next);
    setSending(true);
    try {
      const body = await call({ messages: next });
      if (body.success) {
        setMessages((p) => [...p, { role: 'assistant', content: body.reply, live: body.had_live_data, saw: body.saw_creatives }]);
        if (body.calls) setCalls(body.calls);
      } else {
        showToast?.(`Coach: ${body.error || 'something went wrong'}`);
        setMessages((p) => [...p, { role: 'assistant', content: `I couldn't answer that just now — ${body.error || 'please try again'}.` }]);
      }
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
      setMessages((p) => [...p, { role: 'assistant', content: `Connection problem — ${e.message}. Try again in a moment.` }]);
    } finally { setSending(false); }
  }, [input, sending, messages, call, showToast]);

  const resolve = async (id, verdict) => {
    try {
      const body = await call({ action: 'resolve_call', id, verdict });
      if (body.success) setCalls(body.calls || []);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
  };

  const openCalls = calls.filter((c) => c.status === 'open');
  const resolved = calls.filter((c) => c.status !== 'open');
  const correct = resolved.filter((c) => c.status === 'correct').length;
  const graded = resolved.filter((c) => c.status !== 'dismissed').length;

  const AvatarSm = () => (
    <div className="rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32 }}><Target size={15} className="text-indigo-600" /></div>
  );

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44 }}>
            <Target size={20} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ads Coach</h2>
            <p className="text-xs text-gray-500 mt-0.5">Sees your live account + creatives · remembers · advice-only</p>
          </div>
        </div>
        <button onClick={loadHistory} className={btn.iconGhost} title="Reload"><RefreshCw size={16} /></button>
      </div>

      {/* Track record */}
      {(openCalls.length > 0 || resolved.length > 0) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">Track record</span>
            {graded > 0 && <Badge tone={correct / graded >= 0.6 ? 'green' : 'amber'}>{Math.round((correct / graded) * 100)}% ({correct}/{graded})</Badge>}
          </div>
          <p className="text-[11px] text-gray-500 mb-2">Mark each recommendation right or wrong once it plays out — that's how you see if the Coach is actually helping.</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {openCalls.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                <div className="min-w-0"><p className="text-sm text-gray-900">{c.recommendation}</p>{c.target_campaign && <p className="text-[11px] text-gray-400 mt-0.5">{c.target_campaign}</p>}</div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => resolve(c.id, 'correct')} title="Right call" className="p-1.5 rounded-lg border border-green-200 text-green-600 hover:bg-green-50"><Check size={13} /></button>
                  <button onClick={() => resolve(c.id, 'wrong')} title="Wrong call" className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><X size={13} /></button>
                  <button onClick={() => resolve(c.id, 'dismissed')} title="Skip / not measurable" className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 text-gray-400 hover:bg-white">Skip</button>
                </div>
              </div>
            ))}
            {resolved.slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <p className="text-xs text-gray-500 truncate">{c.recommendation}</p>
                <Badge tone={c.status === 'correct' ? 'green' : c.status === 'wrong' ? 'red' : 'gray'}>{c.status === 'correct' ? 'Right' : c.status === 'wrong' ? 'Wrong' : 'Skipped'}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversation */}
      <div ref={scrollRef} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4 overflow-y-auto" style={{ height: '54vh' }}>
        <div className="flex gap-2.5">
          <AvatarSm />
          <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 max-w-[85%]">
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{GREETING}</p>
            {!loading && messages.length === 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => submit(s)} disabled={sending}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-full px-3 py-1.5 disabled:opacity-50">
                    <Sparkles size={12} /> {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Loading your history…</div>
        ) : messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role !== 'user' && <AvatarSm />}
            <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap max-w-[80%] ${m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
              {m.content}
              {m.role === 'assistant' && m.live === false && (
                <span className="block mt-1.5 text-[11px] text-amber-600">⚠ answered on principle — couldn't pull fresh account numbers this turn</span>
              )}
            </div>
          </div>
        ))}
        {sending && <div className="flex gap-2.5"><AvatarSm /><div className="bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading your account…</div></div>}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 mt-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Ask your ads coach… (e.g. “which of my ads should I kill?”)" disabled={sending || loading}
          className="flex-1 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-indigo-400 disabled:opacity-60" />
        <button onClick={() => submit()} disabled={sending || loading || !input.trim()} className={btn.accent + ' !px-4'}><Send size={15} /></button>
      </div>
    </div>
  );
}
