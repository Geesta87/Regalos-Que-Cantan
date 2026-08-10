// src/components/admin/ActionInboxTab.jsx
// The admin HOME tab: one ranked queue of everything waiting on the owner,
// pulled from every agent/pipeline by the action-inbox edge function, plus
// the Business Analyst chat ("ask the business anything") underneath.
//
// Approvals are dispatched to the SAME endpoints the per-agent tabs use
// (sms-admin, seo-coach, cos-assistant), so this tab adds no new write paths.
// Dismissals are client-side only (localStorage) — hiding a card here never
// mutates the underlying queue; the item still exists in its own tab.
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Inbox, RefreshCw, Loader2, AlertTriangle, Check, X, ChevronRight,
  MessageCircleQuestion, Send, ArrowUpRight, Clock, Undo2,
} from 'lucide-react';
import { Card, Badge, SectionLabel, btn } from './ui';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const fnUrl = (name) => `${SUPABASE_URL}/functions/v1/${name}`;

// Hidden/snoozed cards live in localStorage as { [key]: 0 | untilMs }:
// 0 = hidden until the item leaves the feed, a timestamp = snoozed until then.
// Exported so AdminDashboard's nav badge counts the same visible set.
export const HIDDEN_KEY = 'rqc_inbox_hidden_v2';
const LEGACY_DISMISS_KEY = 'rqc_inbox_dismissed_v1';
export const loadHidden = () => {
  try {
    const map = JSON.parse(localStorage.getItem(HIDDEN_KEY) || 'null');
    if (map && typeof map === 'object') return map;
    // One-time migration from the v1 plain list (everything was hide-forever).
    const legacy = JSON.parse(localStorage.getItem(LEGACY_DISMISS_KEY) || '[]');
    return Object.fromEntries(legacy.map((k) => [k, 0]));
  } catch { return {}; }
};
const saveHidden = (map) => {
  // Keep the map bounded — old keys age out of the feed anyway.
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(Object.fromEntries(Object.entries(map).slice(-500))));
  } catch { /* ignore */ }
};
export const isHiddenNow = (hidden, key) => {
  const until = hidden[key];
  return until !== undefined && (until === 0 || until > Date.now());
};
// The tab announces its visible critical count so the sidebar badge updates
// the moment something is approved/hidden, without waiting for the next poll.
export const INBOX_COUNT_EVENT = 'rqc:inbox-critical';

const SEVERITY = {
  critical: { label: 'Fix now', tone: 'red' },
  high: { label: 'Today', tone: 'amber' },
  normal: { label: 'When free', tone: 'accent' },
};

const NAV_LABELS = {
  orders: 'Orders', pendingsend: 'Pending to Send', hotleads: 'Hot Leads', sms: 'SMS Messages',
  fixsong: 'Fix Song', animado: 'Animado', videos: 'Videos', seocoach: 'SEO Coach',
  chiefofstaff: 'Chief of Staff', dailybriefing: 'Daily Briefing',
};

// Themed sub-tabs inside the inbox. Each card's `source` (set by the
// action-inbox edge function) maps to one topic; unknown sources land in
// "Other" so a new agent never silently disappears from the inbox.
const TOPICS = [
  { id: 'chiefofstaff', label: 'Chief of Staff', sources: ['Chief of Staff'] },
  { id: 'seocoach', label: 'SEO Coach', sources: ['SEO Coach'] },
  { id: 'fixsong', label: 'Fix Song', sources: ['Fix Song'] },
  { id: 'ordersdelivery', label: 'Orders & Delivery', sources: ['Order pipeline', 'Delivery', 'Hot leads'] },
  { id: 'videos', label: 'Videos', sources: ['Animado', 'Video addon'] },
  { id: 'other', label: 'Other', sources: [] },
];
const topicForSource = (source) =>
  (TOPICS.find((t) => t.sources.includes(source)) || TOPICS[TOPICS.length - 1]).id;

const timeAgo = (iso) => {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export default function ActionInboxTab({ accessToken, showToast, onNavigate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [hidden, setHidden] = useState(loadHidden);
  const [showHidden, setShowHidden] = useState(false);
  const [topic, setTopic] = useState('all');

  const call = useCallback(async (name, body) => {
    const res = await fetch(fnUrl(name), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [accessToken]);

  const load = useCallback(async ({ silent } = {}) => {
    if (!accessToken) return;
    if (!silent) setLoading(true);
    setError('');
    try { const d = await call('action-inbox', { action: 'list' }); setItems(d.items || []); }
    catch (e) { setError(e.message || 'Could not load the inbox.'); }
    finally { setLoading(false); }
  }, [accessToken, call]);

  useEffect(() => { load(); }, [load]);

  // Silent auto-refresh so an open inbox never goes stale. Skips ticks while
  // the browser tab is in the background.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load({ silent: true }); }, 90e3);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => items.filter((i) => !isHiddenNow(hidden, i.key)), [items, hidden]);
  const hiddenItems = useMemo(() => items.filter((i) => isHiddenNow(hidden, i.key)), [items, hidden]);

  // Keep the sidebar badge in sync with what's actually visible here.
  useEffect(() => {
    if (loading && items.length === 0) return; // first load pending — don't zero the badge
    const critical = visible.filter((i) => i.severity === 'critical').length;
    window.dispatchEvent(new CustomEvent(INBOX_COUNT_EVENT, { detail: { critical } }));
  }, [visible, loading, items.length]);

  // Per-topic counts (and whether the topic holds anything critical) drive the
  // sub-tab pills; a topic with nothing waiting doesn't get a pill.
  const topicStats = useMemo(() => {
    const stats = new Map();
    visible.forEach((i) => {
      const id = topicForSource(i.source);
      const s = stats.get(id) || { count: 0, critical: 0 };
      s.count += 1;
      if (i.severity === 'critical') s.critical += 1;
      stats.set(id, s);
    });
    return stats;
  }, [visible]);

  // If everything in the open topic gets approved/dismissed, fall back to All
  // rather than stranding the owner on an empty tab with no pill.
  useEffect(() => {
    if (topic !== 'all' && !topicStats.has(topic)) setTopic('all');
  }, [topic, topicStats]);

  const shown = useMemo(
    () => (topic === 'all' ? visible : visible.filter((i) => topicForSource(i.source) === topic)),
    [visible, topic],
  );
  const grouped = useMemo(() => {
    const g = { critical: [], high: [], normal: [] };
    shown.forEach((i) => (g[i.severity] || g.normal).push(i));
    return g;
  }, [shown]);

  const setHiddenUntil = (key, until) => {
    const next = { ...hidden };
    if (until === null) delete next[key]; else next[key] = until;
    setHidden(next); saveHidden(next);
  };
  const hide = (key) => setHiddenUntil(key, 0);
  const snooze = (key) => setHiddenUntil(key, Date.now() + 24 * 36e5);
  const restore = (key) => setHiddenUntil(key, null);

  // One-tap approve/reject → the item's own existing endpoint.
  const act = async (item, kind) => {
    const spec = item.approve;
    if (!spec || !spec[kind]) return;
    setBusyKey(`${item.key}:${kind}`);
    try {
      await call(spec.fn, spec[kind]);
      showToast?.(kind === 'approve' ? 'Approved' : 'Rejected', 'success');
      setItems((prev) => prev.filter((i) => i.key !== item.key));
    } catch (e) {
      showToast?.(e.message || 'Action failed', 'error');
    } finally { setBusyKey(null); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ---- The queue ---- */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><Inbox size={18} /></div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Action Inbox</h2>
              <p className="text-xs text-gray-500">Everything your agents and pipelines are waiting on you for, worst first.</p>
            </div>
          </div>
          <button onClick={() => load()} disabled={loading} className={btn.iconGhost} title="Refresh">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} /> {error}
          </div>
        )}

        {/* ---- Themed sub-tabs ---- */}
        {!loading && !error && visible.length > 0 && (
          <div className="flex items-center gap-1.5 mt-4 overflow-x-auto pb-1 -mb-1">
            <TopicPill active={topic === 'all'} onClick={() => setTopic('all')} label="All" count={visible.length} />
            {TOPICS.filter((t) => topicStats.has(t.id)).map((t) => {
              const s = topicStats.get(t.id);
              return (
                <TopicPill key={t.id} active={topic === t.id} onClick={() => setTopic(t.id)}
                  label={t.label} count={s.count} critical={s.critical > 0} />
              );
            })}
          </div>
        )}

        {!loading && !error && shown.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-gray-700">Nothing needs you right now.</p>
            <p className="text-xs text-gray-400 mt-1">New drafts, approvals and stuck orders will show up here.</p>
          </div>
        )}

        {['critical', 'high', 'normal'].map((sev) => grouped[sev].length > 0 && (
          <div key={sev} className="mt-4">
            <SectionLabel className="mb-2">{SEVERITY[sev].label} ({grouped[sev].length})</SectionLabel>
            <div className="space-y-2">
              {grouped[sev].map((item) => (
                <div key={item.key} className="border border-gray-200 rounded-lg p-3.5 hover:border-gray-300 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={SEVERITY[sev].tone}>{item.source}</Badge>
                        {item.created_at && <span className="text-[11px] text-gray-400">{timeAgo(item.created_at)}</span>}
                      </div>
                      <p className="text-sm font-medium text-gray-900 mt-1.5">{item.title}</p>
                      {item.detail && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{item.detail}</p>}
                    </div>
                    <div className="flex items-center shrink-0">
                      <button onClick={() => snooze(item.key)} className={btn.iconGhost} title="Snooze until tomorrow">
                        <Clock size={15} />
                      </button>
                      <button onClick={() => hide(item.key)} className={btn.iconGhost} title="Hide from inbox (stays in its own tab)">
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2.5">
                    {item.approve && (
                      <button onClick={() => act(item, 'approve')} disabled={busyKey === `${item.key}:approve`} className={btn.success}>
                        {busyKey === `${item.key}:approve` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
                      </button>
                    )}
                    {item.approve?.reject && (
                      <button onClick={() => act(item, 'reject')} disabled={busyKey === `${item.key}:reject`} className={btn.ghost}>
                        <X size={14} /> Reject
                      </button>
                    )}
                    <button onClick={() => onNavigate?.(item.nav)} className={btn.ghost}>
                      {NAV_LABELS[item.nav] || 'Open'} <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* ---- Hidden & snoozed (undo lives here) ---- */}
        {!loading && hiddenItems.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <button onClick={() => setShowHidden((v) => !v)}
              className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors">
              {showHidden ? 'Hide' : 'Show'} hidden & snoozed ({hiddenItems.length})
            </button>
            {showHidden && (
              <div className="space-y-1.5 mt-2.5">
                {hiddenItems.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 opacity-80">
                    <div className="min-w-0 flex items-center gap-2">
                      <Badge>{item.source}</Badge>
                      <p className="text-xs text-gray-600 truncate">{item.title}</p>
                      {hidden[item.key] > 0 && (
                        <span className="text-[11px] text-gray-400 shrink-0">
                          snoozed until {new Date(hidden[item.key]).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <button onClick={() => restore(item.key)} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 shrink-0 transition-colors">
                      <Undo2 size={13} /> Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ---- Ask the business ---- */}
      <AnalystChat call={call} />
    </div>
  );
}

// One sub-tab pill: label + count, red dot when the topic holds a critical item.
function TopicPill({ active, onClick, label, count, critical }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'bg-indigo-600 border-indigo-600 text-white'
          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}>
      {critical && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-red-500'}`} />}
      {label}
      <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
        {count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Business Analyst chat. Stateless server; the rolling history lives here.
// ---------------------------------------------------------------------------
const SUGGESTED = [
  'How did this week compare to last week, same days?',
  'Which genres made the most money this month?',
  'How many orders had an empty story box this week?',
  'What share of this month’s orders came from each source?',
];

function AnalystChat({ call }) {
  const [messages, setMessages] = useState([]); // {role, content}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const ask = async (q) => {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput('');
    const history = messages.slice(-10);
    setMessages((m) => [...m, { role: 'user', content: question }]);
    setBusy(true);
    try {
      const d = await call('business-analyst', { question, history });
      setMessages((m) => [...m, { role: 'assistant', content: d.answer || 'No answer.' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong: ${e.message}` }]);
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><MessageCircleQuestion size={18} /></div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">Ask the business</h2>
          <p className="text-xs text-gray-500">Plain-English questions, answered from the live database with the double-count and paid-order rules already applied.</p>
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
        <div className="space-y-3 mb-3 max-h-[26rem] overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={m.role === 'user'
                ? 'bg-indigo-600 text-white text-sm rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[85%]'
                : 'bg-gray-100 text-gray-800 text-sm rounded-2xl rounded-bl-sm px-3.5 py-2 max-w-[85%] whitespace-pre-wrap'}>
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
              <Loader2 size={13} className="animate-spin" /> Checking the numbers…
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex items-center gap-2">
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Why were sales soft on Tuesday?"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
        />
        <button type="submit" disabled={busy || !input.trim()} className={btn.accent}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </form>
      <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
        <ArrowUpRight size={11} /> Read-only: this chat can look at the numbers but can never change anything.
      </p>
    </Card>
  );
}
