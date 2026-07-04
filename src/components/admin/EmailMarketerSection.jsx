// src/components/admin/EmailMarketerSection.jsx
// "Emails" section of the Creative Studio. Shows the weekly AI-drafted
// promotional emails. Preview each, send a test to yourself, then Approve →
// it sends to your customer list (suppression + unsubscribe handled server-side).
import React, { useState, useEffect, useCallback } from 'react';
import { Mail, RefreshCw, Loader2, ArrowLeft, Check, X, Send, Users, Palette, FlaskConical } from 'lucide-react';
import { Badge, Stat, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-marketer-admin`;

const STATUS = {
  pending_approval: { label: 'To review', tone: 'amber' },
  approved:         { label: 'Approved',  tone: 'green' },
  sending:          { label: 'Sending…',  tone: 'accent' },
  sent:             { label: 'Sent',      tone: 'green' },
  rejected:         { label: 'Discarded', tone: 'gray' },
  failed:           { label: 'Failed',    tone: 'red' },
};

const SEGMENT_LABELS = {
  all: 'Everyone', recent: 'Recent buyers', winback: 'Win-back',
  video_buyers: 'Video-addon buyers', no_video: 'Bought song, never video',
  nonbuyers: 'Non-buyers',
};
const pct = (num, den) => (den ? `${Math.round((100 * num) / den)}%` : '—');

export default function EmailMarketerSection({ accessToken, showToast, onEditInStudio }) {
  const [emails, setEmails] = useState([]);
  const [audience, setAudience] = useState(0);
  const [segmentCounts, setSegmentCounts] = useState({ all: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

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
      if (r.success) { setEmails(r.emails || []); setAudience(r.audience_size || 0); setSegmentCounts(r.segment_counts || { all: r.audience_size || 0 }); }
      else showToast?.(`Error: ${r.error || 'could not load'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);
  // Poll while anything is sending (progress bar updates).
  const anySending = emails.some((e) => e.status === 'sending');
  useEffect(() => { if (!anySending) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [anySending, load]);

  const sel = emails.find((e) => e.id === selectedId);
  const segCountFor = (seg) => segmentCounts[seg || 'all'] ?? audience;

  // Load per-campaign stats (opens / clicks / revenue) for a sent/sending email.
  const loadStats = useCallback(async (id) => {
    setStatsLoading(true); setStats(null);
    try { const r = await call({ action: 'results_detail', id }); if (r.success) setStats(r.stats); }
    catch { /* non-fatal */ }
    finally { setStatsLoading(false); }
  }, [call]);

  useEffect(() => {
    if (sel && (sel.status === 'sending' || sel.status === 'sent') && sel.campaign_key) loadStats(sel.id);
    else setStats(null);
  }, [selectedId, sel?.status, sel?.campaign_key, loadStats]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id, action) => {
    if (action === 'approve') {
      const seg = sel?.segment || 'all';
      const n = segCountFor(seg);
      const who = seg === 'all' ? `${n.toLocaleString()} customers` : `${n.toLocaleString()} — ${SEGMENT_LABELS[seg] || seg}`;
      if (!window.confirm(`Send "${sel?.subject}" to ${who}? This cannot be undone.`)) return;
    }
    setBusy(true);
    try {
      const r = await call({ action, id });
      if (r.success) {
        showToast?.(action === 'test' ? `Test sent to ${r.sent_to}` : action === 'approve' ? `Sending to ${r.recipients_total?.toLocaleString()}` : 'Discarded');
        if (action !== 'test') { await load(); if (action !== 'approve') setSelectedId(null); }
      } else showToast?.(`Error: ${r.error || 'failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  // ---- DETAIL ----
  if (sel) {
    const sm = STATUS[sel.status] || { label: sel.status, tone: 'gray' };
    return (
      <div className="max-w-3xl">
        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"><ArrowLeft size={16} /> All emails</button>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge tone={sm.tone}>{sm.label}</Badge>
          <Badge tone="gray"><Users size={11} className="mr-1" /> {SEGMENT_LABELS[sel.segment] || 'Everyone'}</Badge>
          {sel.subject_b && <Badge tone="accent"><FlaskConical size={11} className="mr-1" /> A/B</Badge>}
          {sel.reason && <span className="text-xs text-gray-400">{sel.reason}</span>}
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">{sel.subject}</h2>
        {sel.preview_text && <p className="text-sm text-gray-500 mb-3">{sel.preview_text}</p>}

        <iframe title="preview" srcDoc={(sel.body_html || '').replace(/\{\{UNSUB_URL\}\}/g, '#')}
          className="w-full border border-gray-200 rounded-xl bg-white" style={{ height: 560 }} />

        {sel.status === 'sending' || sel.status === 'sent' ? (
          <div className="mt-4">
            <div className="text-sm text-gray-600">
              {sel.status === 'sending' ? 'Sending' : 'Sent'} — {sel.recipients_sent?.toLocaleString()} / {sel.recipients_total?.toLocaleString()} delivered
              <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500" style={{ width: `${sel.recipients_total ? Math.min(100, Math.round(100 * sel.recipients_sent / sel.recipients_total)) : 0}%` }} />
              </div>
            </div>
            {statsLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-3"><Loader2 size={13} className="animate-spin" /> Loading results…</div>
            ) : stats ? (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-3">
                  <Stat label="Delivered" value={(stats.delivered || 0).toLocaleString()} />
                  <Stat label="Opens" value={pct(stats.opens, stats.delivered)} />
                  <Stat label="Clicks" value={pct(stats.clicks, stats.delivered)} />
                  <Stat label="Orders" value={(stats.orders || 0).toLocaleString()} tone={stats.orders ? 'green' : undefined} />
                  <Stat label="Revenue" value={`$${Number(stats.revenue || 0).toFixed(2)}`} tone={stats.revenue ? 'green' : undefined} />
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {(stats.unsubscribes || 0).toLocaleString()} unsubscribed · {(stats.spam_reports || 0).toLocaleString()} spam complaints.
                  Opens are directional (Apple Mail inflates them). Full breakdown in the <span className="font-medium text-gray-500">Results</span> tab.
                </p>
              </>
            ) : sel.campaign_key ? (
              <p className="text-[11px] text-gray-400 mt-3">Stats appear a few minutes after the first sends (SendGrid reporting lag).</p>
            ) : null}
          </div>
        ) : sel.status === 'pending_approval' ? (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button onClick={() => act(sel.id, 'test')} disabled={busy} className={btn.ghost}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send test to me
            </button>
            <button onClick={() => act(sel.id, 'approve')} disabled={busy} className={btn.success}>
              <Check size={15} /> Approve &amp; send to {segCountFor(sel.segment).toLocaleString()}
            </button>
            <button onClick={() => act(sel.id, 'reject')} disabled={busy} className={btn.ghost}>
              <X size={15} /> Reject
            </button>
            {onEditInStudio && (
              <button onClick={() => onEditInStudio({ id: sel.id, subject: sel.subject, subject_b: sel.subject_b, segment: sel.segment, preview_text: sel.preview_text, html: sel.body_html })}
                disabled={busy} className={btn.ghost}>
                <Palette size={15} /> Edit in Studio
              </button>
            )}
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
        <button onClick={load} disabled={loading} className={btn.ghost}>
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
            const sm = STATUS[e.status] || { label: e.status, tone: 'gray' };
            return (
              <button key={e.id} onClick={() => setSelectedId(e.id)}
                className="w-full text-left flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-gray-300 transition">
                <Mail size={18} className="text-gray-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm truncate">{e.subject}</div>
                  <div className="text-xs text-gray-400 truncate">{e.reason || e.preview_text}</div>
                </div>
                {e.subject_b && <FlaskConical size={13} className="text-indigo-400 flex-shrink-0" title="A/B subject test" />}
                {e.segment && e.segment !== 'all' && (
                  <Badge tone="gray" className="flex-shrink-0 hidden sm:inline-flex">{SEGMENT_LABELS[e.segment] || e.segment}</Badge>
                )}
                {(e.status === 'sending' || e.status === 'sent') && (
                  <span className="text-[11px] text-gray-400">{e.recipients_sent?.toLocaleString()}/{e.recipients_total?.toLocaleString()}</span>
                )}
                <Badge tone={sm.tone} className="flex-shrink-0">{sm.label}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
