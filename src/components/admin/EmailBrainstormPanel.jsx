// src/components/admin/EmailBrainstormPanel.jsx
// Email strategist chat for the Email Studio. The owner's actual blocker isn't
// designing emails — it's deciding WHAT to send. This is the agent that solves
// that: it knows the whole catalog, the US-Hispanic gifting calendar, the
// segments, what we already sent and how those performed. It proposes ideas as
// cards, argues them through, and once you agree it writes the finished brief
// straight into the Studio form above.
//
// Talks to the email-studio edge function, action: 'brainstorm'. Conversation
// state is client-side (this is a scratchpad, not a record) — it resets on
// reload, which is why "Load into the Studio" is the step that persists intent.
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Loader2, Lightbulb, Check, Wand2, RotateCcw } from 'lucide-react';
import { Card, SectionLabel, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-studio`;

const OPENERS = [
  'What should I send this week?',
  'Give me 5 ideas that are NOT about a holiday',
  "Something for people who bought a song but never a video",
  'An email that pushes the Animado bundle',
];

export default function EmailBrainstormPanel({ accessToken, showToast, onUseBrief, onDesignNow, busy }) {
  const [messages, setMessages] = useState([]); // { role, content, display, ideas, brief }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

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
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200) || 'empty response'}` }; }
  }, [accessToken]);

  const submit = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput(''); setError('');
    // `content` is what the agent sees next turn; `display` is what you read.
    const next = [...messages, { role: 'user', content: msg, display: msg }];
    setMessages(next);
    setSending(true);
    try {
      const r = await call({
        action: 'brainstorm',
        messages: next.map((m) => ({ role: m.role, content: m.content })),
      });
      if (!r.success) throw new Error(r.error || r.message || 'The strategist did not answer');
      setMessages([...next, {
        role: 'assistant',
        content: r.memo || r.reply,
        display: r.reply,
        ideas: r.ideas || null,
        brief: r.brief || null,
      }]);
      // "Once we agree it enters that information" — a locked-in brief fills the
      // Studio form immediately. Nothing is generated or sent until you say so.
      if (r.brief) {
        onUseBrief?.(r.brief);
        showToast?.(`Brief loaded into the Studio — "${r.brief.label}"`);
      }
    } catch (e) {
      setError(e.message);
      setMessages(next); // drop the failed turn so a retry doesn't double up
    } finally {
      setSending(false);
    }
  };

  const useIdea = (idea) =>
    submit(`Let's go with "${idea.title}". Lock in the brief for it.`);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <SectionLabel className="flex items-center gap-1.5">
          <Lightbulb size={12} className="text-amber-500" /> Email strategist
        </SectionLabel>
        <span className="text-[11px] text-gray-400">— stuck on what to send? Ask.</span>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setError(''); }} title="Start over"
            className="ml-auto text-gray-300 hover:text-gray-600"><RotateCcw size={13} /></button>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Knows every offer and price, the gifting calendar, your segments, and what you already sent.
        Agree on an idea and it fills in the brief above for you.
      </p>

      <div ref={scrollRef} className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3 overflow-y-auto" style={{ height: 380 }}>
        {messages.length === 0 && !sending ? (
          <div className="text-center py-6">
            <p className="text-xs text-gray-400 mb-3">Try one of these:</p>
            <div className="flex flex-col items-stretch gap-1.5">
              {OPENERS.map((s) => (
                <button key={s} onClick={() => submit(s)}
                  className="text-xs text-left text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2 hover:border-indigo-300 hover:text-indigo-700 transition">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[92%]">
              <div className={`rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed ${
                m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                {m.display}
              </div>

              {/* Idea cards — one click turns an idea into a locked-in brief. */}
              {m.ideas?.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {m.ideas.map((idea, k) => (
                    <div key={k} className="bg-white border border-gray-200 rounded-lg p-2.5">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-900">{idea.title}</p>
                          <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{idea.angle}</p>
                          <p className="text-[11px] text-gray-400 mt-1">{idea.why_now}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">{idea.offer}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-600 border border-gray-200">{idea.segment}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-600 border border-gray-200">{idea.style_id}</span>
                          </div>
                          {(idea.subject_a || idea.subject_b) && (
                            <p className="text-[10px] text-gray-400 mt-1.5 italic">
                              “{idea.subject_a}”{idea.subject_b ? ` · “${idea.subject_b}”` : ''}
                            </p>
                          )}
                        </div>
                        <button onClick={() => useIdea(idea)} disabled={sending}
                          className="text-[11px] whitespace-nowrap px-2 py-1 rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                          Use this
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* The agreed brief — already written into the form above. */}
              {m.brief && (
                <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                  <p className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5">
                    <Check size={13} /> Loaded into the Studio — {m.brief.label}
                  </p>
                  <p className="text-[11px] text-emerald-800 mt-1 leading-relaxed">{m.brief.brief}</p>
                  {m.brief.subject_ideas?.length > 0 && (
                    <p className="text-[10px] text-emerald-700 mt-1.5 italic">
                      Subject ideas: {m.brief.subject_ideas.map((s) => `“${s}”`).join(' · ')}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => onDesignNow?.(m.brief)} disabled={busy || sending}
                      className={btn.accent + ' !text-xs !px-2.5 !py-1.5'}>
                      <Wand2 size={13} /> Design it now
                    </button>
                    <button onClick={() => onUseBrief?.(m.brief)} disabled={sending}
                      className={btn.ghost + ' !text-xs !px-2.5 !py-1.5'}>
                      Re-fill the form
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3 py-2 text-xs bg-white border border-gray-200 text-gray-400 flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> Thinking…
            </div>
          </div>
        )}
        {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">{error}</p>}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Ask for ideas, or tell it what you're thinking…"
          disabled={sending}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400 disabled:opacity-60"
        />
        <button onClick={() => submit()} disabled={sending || !input.trim()} className={btn.primary}>
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </Card>
  );
}
