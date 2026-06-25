// src/components/admin/EmailMarketerSection.jsx
// "Emails" section of the Creative Studio. Shows the weekly AI-drafted
// promotional emails. Preview each, send a test to yourself, then Approve →
// it sends to your customer list (suppression + unsubscribe handled server-side).
import React, { useState, useEffect, useCallback } from 'react';
import { Mail, RefreshCw, Loader2, ArrowLeft, Check, X, Send, Users } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-marketer-admin`;

const STATUS = {
  pending_approval: { label: 'Para revisar', cls: 'bg-amber-100 text-amber-800' },
  approved:         { label: 'Aprobado',     cls: 'bg-green-50 text-green-700' },
  sending:          { label: 'Enviando…',    cls: 'bg-blue-100 text-blue-800' },
  sent:             { label: 'Enviado',       cls: 'bg-green-100 text-green-800' },
  rejected:         { label: 'Descartado',    cls: 'bg-gray-100 text-gray-500' },
  failed:           { label: 'Falló',         cls: 'bg-red-100 text-red-700' },
};

export default function EmailMarketerSection({ accessToken, showToast }) {
  const [emails, setEmails] = useState([]);
  const [audience, setAudience] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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
      if (r.success) { setEmails(r.emails || []); setAudience(r.audience_size || 0); }
      else showToast?.(`Error: ${r.error || 'could not load'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);
  // Poll while anything is sending (progress bar updates).
  const anySending = emails.some((e) => e.status === 'sending');
  useEffect(() => { if (!anySending) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [anySending, load]);

  const sel = emails.find((e) => e.id === selectedId);

  const act = async (id, action) => {
    if (action === 'approve') {
      if (!window.confirm(`Send "${sel?.subject}" to ${audience.toLocaleString()} customers? This cannot be undone.`)) return;
    }
    setBusy(true);
    try {
      const r = await call({ action, id });
      if (r.success) {
        showToast?.(action === 'test' ? `Test sent to ${r.sent_to}` : action === 'approve' ? `Sending to ${r.recipients_total?.toLocaleString()} 🚀` : 'Descartado');
        if (action !== 'test') { await load(); if (action !== 'approve') setSelectedId(null); }
      } else showToast?.(`Error: ${r.error || 'failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  // ---- DETAIL ----
  if (sel) {
    const sm = STATUS[sel.status] || { label: sel.status, cls: 'bg-gray-100 text-gray-600' };
    return (
      <div className="max-w-3xl">
        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"><ArrowLeft size={16} /> All emails</button>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-2 py-1 rounded-full ${sm.cls}`}>{sm.label}</span>
          {sel.reason && <span className="text-xs text-gray-400">{sel.reason}</span>}
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">{sel.subject}</h2>
        {sel.preview_text && <p className="text-sm text-gray-500 mb-3">{sel.preview_text}</p>}

        <iframe title="preview" srcDoc={(sel.body_html || '').replace(/\{\{UNSUB_URL\}\}/g, '#')}
          className="w-full border border-gray-200 rounded-xl bg-white" style={{ height: 560 }} />

        {sel.status === 'sending' || sel.status === 'sent' ? (
          <div className="mt-4 text-sm text-gray-600">
            {sel.status === 'sending' ? 'Sending' : 'Sent'} — {sel.recipients_sent?.toLocaleString()} / {sel.recipients_total?.toLocaleString()} delivered
            <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500" style={{ width: `${sel.recipients_total ? Math.min(100, Math.round(100 * sel.recipients_sent / sel.recipients_total)) : 0}%` }} />
            </div>
          </div>
        ) : sel.status === 'pending_approval' ? (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button onClick={() => act(sel.id, 'test')} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send test to me
            </button>
            <button onClick={() => act(sel.id, 'approve')} disabled={busy}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              <Check size={15} /> Approve & send to {audience.toLocaleString()}
            </button>
            <button onClick={() => act(sel.id, 'reject')} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
              <X size={15} /> Reject
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // ---- LIST ----
  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Mail size={18} className="text-gray-700" /> Weekly marketing emails</h3>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
            <Users size={14} /> Your list: {audience.toLocaleString()} customers · the agent drafts 2-3 each week for your approval.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : emails.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          No emails yet. The Email Marketer drafts a fresh batch every Monday.
        </div>
      ) : (
        <div className="space-y-2">
          {emails.map((e) => {
            const sm = STATUS[e.status] || { label: e.status, cls: 'bg-gray-100 text-gray-600' };
            return (
              <button key={e.id} onClick={() => setSelectedId(e.id)}
                className="w-full text-left flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-gray-300 transition">
                <Mail size={18} className="text-gray-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm truncate">{e.subject}</div>
                  <div className="text-xs text-gray-400 truncate">{e.reason || e.preview_text}</div>
                </div>
                {(e.status === 'sending' || e.status === 'sent') && (
                  <span className="text-[11px] text-gray-400">{e.recipients_sent?.toLocaleString()}/{e.recipients_total?.toLocaleString()}</span>
                )}
                <span className={`text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 ${sm.cls}`}>{sm.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
