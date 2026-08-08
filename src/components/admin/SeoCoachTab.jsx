// src/components/admin/SeoCoachTab.jsx
// SEO Coach + Campaign — chat with the search specialist AND run the ongoing
// SEO campaign it proposes. The coach reads LIVE Google Search Console data,
// fetches real pages, and reasons with the verified SEO Brain. A weekly agent
// snapshots rankings, verifies shipped work, and posts a Monday review into
// this chat. Tasks the coach/agent propose appear here as cards; approving a
// title/meta task publishes it so the next site build applies it — nothing
// changes on the live site without the Approve tap. Admin-only.
// Talks to the seo-coach edge function (campaign actions included).
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Search, Send, Loader2, RefreshCw, Sparkles, Check, X, Globe,
  CalendarDays, Play, ChevronDown, Clock, TrendingUp,
} from 'lucide-react';
import { btn, Badge } from './ui';

const COACH = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/seo-coach`;

const STARTERS = [
  'What is my single highest-leverage SEO move right now?',
  'Draft a 90-day SEO campaign for me',
  'Which queries am I closest to ranking for?',
  'How much of my traffic is new people vs people who already know us?',
  'What should our seasonal page plan be for the next 3 months?',
];

const GREETING = "Hi — I'm your SEO coach. I can see your live Google Search Console data, read any page on your site or a competitor's, and I run an ongoing campaign with you: when we agree on a move, I save it as a task card you approve with one tap. A weekly agent tracks your rankings every Monday, checks what shipped, and reports what moved. Ask me anything — I'll always tell you the why, and I'm honest about how long SEO really takes.";

const TASK_STATUS_TONE = {
  proposed: 'amber', approved: 'accent', implemented: 'accent',
  verified: 'green', rejected: 'gray', dropped: 'gray',
};

export default function SeoCoachTab({ accessToken, showToast }) {
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [campaign, setCampaign] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runningWeekly, setRunningWeekly] = useState(false);
  const [busyTask, setBusyTask] = useState(null);
  const [expandedTask, setExpandedTask] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const scrollRef = useRef(null);

  const call = useCallback(async (payload) => {
    const res = await fetch(COACH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    return res.json();
  }, [accessToken]);

  // Load past conversation + track record + campaign (cross-session memory).
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const body = await call({ action: 'history' });
      if (body.success) {
        setMessages((body.messages || []).map((m) => ({ role: m.role, content: m.content })));
        setCalls(body.calls || []);
        if (body.campaign) setCampaign(body.campaign);
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
        setMessages((p) => [...p, { role: 'assistant', content: body.reply, live: body.had_live_data, pagesRead: body.pages_read, tasksProposed: body.tasks_proposed }]);
        if (body.calls) setCalls(body.calls);
        if (body.campaign) setCampaign(body.campaign);
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

  const taskAction = async (id, action) => {
    setBusyTask(id);
    try {
      const body = await call({ action, id });
      if (body.success) {
        if (body.campaign) setCampaign(body.campaign);
        if (action === 'approve_task') {
          showToast?.(body.applied
            ? (body.build_triggered ? 'Approved — change published, site rebuild started.' : 'Approved — change published; it goes live with the next site deploy.')
            : 'Approved — it will be applied from the task draft.');
        }
      } else showToast?.(`Error: ${body.error || 'failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyTask(null); }
  };

  const toggleAgent = async () => {
    const next = !(campaign?.state?.enabled !== false);
    try {
      const body = await call({ action: 'set_agent_enabled', enabled: next });
      if (body.success && body.campaign) setCampaign(body.campaign);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
  };

  const runWeekly = async () => {
    setRunningWeekly(true);
    showToast?.('Running the weekly review — this takes a minute or two…');
    try {
      const body = await call({ action: 'run_weekly' });
      if (body.success) {
        if (body.campaign) setCampaign(body.campaign);
        await loadHistory(); // the digest lands as a chat message
        showToast?.('Weekly review done — see the new message in the chat.');
      } else showToast?.(`Weekly review failed: ${body.error || 'unknown error'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setRunningWeekly(false); }
  };

  const openCalls = calls.filter((c) => c.status === 'open');
  const resolved = calls.filter((c) => c.status !== 'open');
  const correct = resolved.filter((c) => c.status === 'correct').length;
  const graded = resolved.filter((c) => c.status !== 'dismissed').length;

  const tasks = campaign?.tasks || [];
  const proposedTasks = tasks.filter((t) => t.status === 'proposed');
  const activeTasks = tasks.filter((t) => ['approved', 'implemented'].includes(t.status));
  const doneTasks = tasks.filter((t) => ['verified', 'rejected', 'dropped'].includes(t.status));
  const agentEnabled = campaign?.state?.enabled !== false;
  const lastRun = campaign?.state?.last_run_at ? new Date(campaign.state.last_run_at).toLocaleDateString() : null;

  const AvatarSm = () => (
    <div className="rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32 }}><Search size={15} className="text-indigo-600" /></div>
  );

  const TaskCard = ({ t }) => {
    const expanded = expandedTask === t.id;
    const d = t.draft || {};
    const hasDraft = d.title || d.meta_description || d.body_markdown || d.instructions;
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-gray-900">{t.title}</p>
              <Badge tone={TASK_STATUS_TONE[t.status] || 'gray'}>{t.status}</Badge>
              <Badge tone="gray">{t.task_type === 'title_meta' ? 'title/meta · auto-applies' : t.task_type.replace('_', ' ')}</Badge>
            </div>
            {t.target_path && <p className="text-[11px] text-gray-400 mt-0.5">{t.target_path}{t.due_date ? ` · due ${t.due_date}` : ''}</p>}
            {t.rationale && <p className="text-xs text-gray-500 mt-1">{t.rationale}</p>}
          </div>
          {t.status === 'proposed' && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => taskAction(t.id, 'approve_task')} disabled={busyTask === t.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                {busyTask === t.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
              </button>
              <button onClick={() => taskAction(t.id, 'reject_task')} disabled={busyTask === t.id}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50" title="Reject"><X size={13} /></button>
            </div>
          )}
        </div>
        {hasDraft && (
          <button onClick={() => setExpandedTask(expanded ? null : t.id)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800">
            <ChevronDown size={12} className={expanded ? 'rotate-180' : ''} /> {expanded ? 'Hide the draft' : 'See exactly what will change'}
          </button>
        )}
        {expanded && (
          <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-2.5 space-y-1.5 text-xs text-gray-700">
            {d.title && <p><span className="font-medium text-gray-500">New title:</span> {d.title}</p>}
            {d.meta_description && <p><span className="font-medium text-gray-500">New description:</span> {d.meta_description}</p>}
            {d.instructions && <p><span className="font-medium text-gray-500">How it gets applied:</span> {d.instructions}</p>}
            {d.body_markdown && <pre className="whitespace-pre-wrap font-sans text-[11px] text-gray-600 max-h-48 overflow-y-auto border-t border-gray-200 pt-1.5">{d.body_markdown}</pre>}
            {t.evidence?.verified && <p className="text-green-700"><span className="font-medium">Verified:</span> {Object.entries(t.evidence.verified.moved || {}).map(([q, m]) => `"${q}" ${m.from} → ${m.to}`).join(', ')}</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44 }}>
            <Search size={20} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">SEO Coach</h2>
            <p className="text-xs text-gray-500 mt-0.5">Live Search Console · runs your SEO campaign · weekly reviews</p>
          </div>
        </div>
        <button onClick={loadHistory} className={btn.iconGhost} title="Reload"><RefreshCw size={16} /></button>
      </div>

      {/* Campaign panel */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-indigo-600" />
            <span className="text-sm font-medium text-gray-900">{campaign?.plan?.title || 'SEO Campaign'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runWeekly} disabled={runningWeekly}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
              {runningWeekly ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run weekly review
            </button>
            <button onClick={toggleAgent} title={agentEnabled ? 'Weekly agent is ON — click to pause' : 'Weekly agent is PAUSED — click to resume'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border ${agentEnabled ? 'border-green-200 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500 bg-gray-50'}`}>
              <CalendarDays size={12} /> {agentEnabled ? 'Weekly agent on' : 'Weekly agent paused'}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">
          {lastRun ? `Last weekly review: ${lastRun}. ` : 'No weekly review yet. '}
          Tasks below are proposed by the coach — nothing touches the site until you approve it.
        </p>

        {proposedTasks.length === 0 && activeTasks.length === 0 && doneTasks.length === 0 && (
          <p className="text-xs text-gray-400">No tasks yet — ask the coach to draft your campaign and the cards will appear here.</p>
        )}

        {proposedTasks.length > 0 && (
          <div className="space-y-2 mb-3">
            <p className="text-[11px] font-medium text-amber-700 uppercase tracking-wide">Waiting for your approval ({proposedTasks.length})</p>
            {proposedTasks.map((t) => <TaskCard key={t.id} t={t} />)}
          </div>
        )}

        {activeTasks.length > 0 && (
          <div className="space-y-2 mb-2">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1"><Clock size={11} /> In progress ({activeTasks.length})</p>
            {activeTasks.map((t) => <TaskCard key={t.id} t={t} />)}
          </div>
        )}

        {doneTasks.length > 0 && (
          <div>
            <button onClick={() => setShowDone(!showDone)} className="text-[11px] font-medium text-gray-400 hover:text-gray-600 inline-flex items-center gap-1">
              <Check size={11} /> {showDone ? 'Hide' : 'Show'} finished ({doneTasks.length})
            </button>
            {showDone && <div className="space-y-2 mt-2">{doneTasks.map((t) => <TaskCard key={t.id} t={t} />)}</div>}
          </div>
        )}
      </div>

      {/* Track record */}
      {(openCalls.length > 0 || resolved.length > 0) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">Track record</span>
            {graded > 0 && <Badge tone={correct / graded >= 0.6 ? 'green' : 'amber'}>{Math.round((correct / graded) * 100)}% ({correct}/{graded})</Badge>}
          </div>
          <p className="text-[11px] text-gray-500 mb-2">Recommendations from past chats. The weekly agent auto-checks them against the live site; you can also grade them yourself.</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {openCalls.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">{c.recommendation}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {c.target_page}{c.auto_status ? ` · auto-check: ${c.auto_status.replace('_', ' ')}` : ''}
                  </p>
                </div>
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
      <div ref={scrollRef} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4 overflow-y-auto" style={{ height: '52vh' }}>
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
              {m.role === 'assistant' && m.pagesRead && m.pagesRead.length > 0 && (
                <span className="block mt-1.5 text-[11px] text-gray-400"><Globe size={10} className="inline mr-1" />read {m.pagesRead.length === 1 ? 'this page' : `${m.pagesRead.length} pages`} live: {m.pagesRead.map((u) => u.replace(/^https?:\/\//, '')).join(', ')}</span>
              )}
              {m.role === 'assistant' && m.tasksProposed && m.tasksProposed.length > 0 && (
                <span className="block mt-1.5 text-[11px] text-indigo-600"><TrendingUp size={10} className="inline mr-1" />added {m.tasksProposed.length === 1 ? 'a task card' : `${m.tasksProposed.length} task cards`} to the campaign — approve above</span>
              )}
              {m.role === 'assistant' && m.live === false && (
                <span className="block mt-1.5 text-[11px] text-amber-600">answered on principle — couldn't pull fresh Search Console data this turn</span>
              )}
            </div>
          </div>
        ))}
        {sending && <div className="flex gap-2.5"><AvatarSm /><div className="bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading your search data…</div></div>}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 mt-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Ask your SEO coach… (e.g. “draft a 90-day campaign”)" disabled={sending || loading}
          className="flex-1 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-indigo-400 disabled:opacity-60" />
        <button onClick={() => submit()} disabled={sending || loading || !input.trim()} className={btn.accent + ' !px-4'}><Send size={15} /></button>
      </div>
    </div>
  );
}
