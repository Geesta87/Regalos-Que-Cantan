// src/components/admin/OpsAgentTab.jsx
// Ops Agent — the customer-support & operations chat console (admin-only).
//
// Chat with an agent that looks up orders/payments, verifies video files
// really exist in storage, audits duplicate charges, reads a customer's
// WhatsApp/SMS history, runs bulk problem-finding sweeps, and drafts
// customer messages in Spanish. Every WRITE the agent wants to make is
// STAGED as a pending action (ops_pending_actions) and shown here as a
// Confirm/Cancel card — nothing executes until the owner taps Confirm.
//
// Server: ops-agent edge function (admin_users gate; reads via the read-only
// analyst_run_sql RPC + service-role lookups; writes only through existing
// endpoints on Confirm). Chat is stateless server-side — the rolling history
// lives in this component, same as the Business Analyst chat.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Headset, Send, Loader2, Check, X, RefreshCw, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { Card, Badge, SectionLabel, btn } from './ui';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const SUGGESTED = [
  'Look up cliente@gmail.com — what did they buy and did they pay?',
  'Show me every paid order missing its video',
  'This customer was charged 3 times — are they legit charges?',
  'All stuck Animado orders still awaiting photos',
  'Any customer requests in SMS we never followed up on this week?',
];

const ACTION_LABEL = {
  retry_render: 'Retry video render',
  reset_for_reupload: 'Reset video for re-upload',
  update_order: 'Fix order data',
  resend_delivery: 'Resend delivery email',
  retry_karaoke: 'Retry karaoke',
  fix_song_intake: 'Send to Fix Song queue',
};

export default function OpsAgentTab({ accessToken, showToast }) {
  const [messages, setMessages] = useState([]); // {role, content, actions?: [pendingAction]}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState([]);   // staged actions awaiting Confirm
  const [recent, setRecent] = useState([]);     // last executed/failed actions
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  const call = useCallback(async (body) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ops-agent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || data.result || `HTTP ${res.status}`);
    return data;
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError('');
    try {
      const d = await call({ action: 'get' });
      setPending(d.pending_actions || []);
      setRecent(d.recent_actions || []);
    } catch (e) { setError(e.message || 'Could not load pending actions.'); }
  }, [accessToken, call]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const ask = async (q) => {
    const message = (q ?? input).trim();
    if (!message || busy) return;
    setInput('');
    // Text-only rolling history (the server is stateless).
    const history = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const d = await call({ action: 'chat', message, history });
      const actions = d.pending_actions || [];
      setMessages((m) => [...m, { role: 'assistant', content: d.answer || 'No answer.', actions }]);
      if (actions.length) setPending((p) => [...actions, ...p]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong: ${e.message}` }]);
    } finally { setBusy(false); }
  };

  // Confirm/Cancel a staged action. The card lives both inline (on the message
  // that proposed it) and in the pending panel — resolve it everywhere.
  const resolveAction = async (id, kind) => {
    setBusyAction(`${id}:${kind}`);
    try {
      const d = await call({ action: kind === 'confirm' ? 'confirm_action' : 'cancel_action', id });
      const status = kind === 'confirm' ? (d.status || 'done') : 'cancelled';
      const patch = (a) => (a.id === id ? { ...a, status, result: d.result || a.result } : a);
      setPending((p) => p.filter((a) => a.id !== id));
      setMessages((msgs) => msgs.map((m) => (m.actions ? { ...m, actions: m.actions.map(patch) } : m)));
      if (kind === 'confirm') {
        showToast?.(d.result || 'Done', d.status === 'done' ? 'success' : 'error');
        setRecent((r) => [{ id, status, result: d.result, summary: (pending.find((a) => a.id === id) || {}).summary }, ...r].slice(0, 8));
      } else {
        showToast?.('Cancelled — nothing was changed', 'info');
      }
    } catch (e) {
      showToast?.(e.message || 'Action failed', 'error');
      load(); // resync — the action may have executed and failed, or already resolved
    } finally { setBusyAction(null); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ---- Staged actions waiting on the owner ---- */}
      {(pending.length > 0 || error) && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center"><ShieldCheck size={18} /></div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Waiting for your Confirm</h2>
                <p className="text-xs text-gray-500">Nothing here has run yet. Confirm executes it; Cancel discards it.</p>
              </div>
            </div>
            <button onClick={load} className={btn.iconGhost} title="Refresh"><RefreshCw size={16} /></button>
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          <div className="space-y-2 mt-3">
            {pending.map((a) => (
              <ActionCard key={a.id} action={a} busyAction={busyAction} onResolve={resolveAction} />
            ))}
          </div>
        </Card>
      )}

      {/* ---- The chat ---- */}
      <Card className="p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><Headset size={18} /></div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Ops Agent</h2>
            <p className="text-xs text-gray-500">Customer support & operations: lookups, payment audits, video checks, SMS history, bulk sweeps, message drafts — and one-tap fixes you approve.</p>
          </div>
        </div>

        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {SUGGESTED.map((s) => (
              <button key={s} onClick={() => ask(s)} disabled={busy}
                className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.length > 0 && (
          <div className="space-y-3 mb-3 max-h-[32rem] overflow-y-auto pr-1">
            {messages.map((m, i) => (
              <div key={i}>
                <div className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={m.role === 'user'
                    ? 'bg-indigo-600 text-white text-sm rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[85%]'
                    : 'bg-gray-100 text-gray-800 text-sm rounded-2xl rounded-bl-sm px-3.5 py-2 max-w-[85%] whitespace-pre-wrap'}>
                    {m.content}
                  </div>
                </div>
                {m.actions?.length > 0 && (
                  <div className="space-y-2 mt-2 ml-1 mr-8">
                    {m.actions.map((a) => (
                      <ActionCard key={a.id} action={a} busyAction={busyAction} onResolve={resolveAction} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
                <Loader2 size={13} className="animate-spin" /> Working — checking the database…
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex items-center gap-2">
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Look up maria@gmail.com — did her video actually render?"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
          />
          <button type="submit" disabled={busy || !input.trim()} className={btn.accent}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </form>
        <p className="text-[11px] text-gray-400 mt-2">
          Reads are instant and read-only. Any change (video reset, data fix, resend, fix-song) is staged as a card you must Confirm — and refunds always stay in your hands in Stripe.
        </p>
      </Card>

      {/* ---- Recent executed actions ---- */}
      {recent.length > 0 && (
        <Card className="p-5">
          <SectionLabel className="mb-2">Recently executed</SectionLabel>
          <div className="space-y-1.5">
            {recent.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-xs text-gray-600">
                <Badge tone={a.status === 'done' ? 'green' : 'red'}>{a.status}</Badge>
                <div className="min-w-0">
                  <p className="truncate">{a.summary || ACTION_LABEL[a.action_type] || a.action_type}</p>
                  {a.result && <p className="text-gray-400 mt-0.5">{a.result}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ActionCard({ action: a, busyAction, onResolve }) {
  const resolved = a.status && a.status !== 'pending';
  return (
    <div className={`border rounded-lg p-3 ${resolved ? 'border-gray-100 bg-gray-50 opacity-80' : 'border-amber-200 bg-amber-50/60'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={resolved ? (a.status === 'done' ? 'green' : a.status === 'failed' ? 'red' : 'gray') : 'amber'}>
          {resolved ? a.status : ACTION_LABEL[a.action_type] || a.action_type}
        </Badge>
        {a.target_name && <span className="text-[11px] text-gray-400">{a.target_name}</span>}
      </div>
      <p className="text-sm text-gray-800 mt-1.5">{a.summary}</p>
      {a.result && resolved && <p className="text-xs text-gray-500 mt-1">{a.result}</p>}
      {!resolved && (
        <div className="flex items-center gap-2 mt-2.5">
          <button onClick={() => onResolve(a.id, 'confirm')} disabled={!!busyAction} className={btn.success}>
            {busyAction === `${a.id}:confirm` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Confirm
          </button>
          <button onClick={() => onResolve(a.id, 'cancel')} disabled={!!busyAction} className={btn.ghost}>
            {busyAction === `${a.id}:cancel` ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Cancel
          </button>
        </div>
      )}
    </div>
  );
}
