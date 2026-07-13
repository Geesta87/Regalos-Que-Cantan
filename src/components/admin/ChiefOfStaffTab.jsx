// src/components/admin/ChiefOfStaffTab.jsx
// Chief of Staff — a personified, interactive assistant. Has a name + avatar +
// voice, shows the morning briefing as its first message, and you can chat with
// it. It reads the whole business and can take actions across your agents. Voice
// via ElevenLabs (pick + preview in settings). Admin-only. Talks to
// cos-assistant (+ chief-of-staff-admin for the briefing).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Compass, Send, Loader2, Settings, Volume2, RefreshCw, Check, Sparkles, X, FileText, ChevronDown, AlertTriangle, BarChart3, Play, TrendingUp } from 'lucide-react';
import { Card, Badge, Stat, SectionLabel, btn } from './ui';

const COS = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cos-assistant`;
const BRIEF = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chief-of-staff-admin`;

const TIER_META = {
  trusted: { label: 'Trusted', tone: 'green' },
  proven: { label: 'Proven', tone: 'accent' },
  probation: { label: 'Probation', tone: 'amber' },
  building: { label: 'Building', tone: 'gray' },
};

export default function ChiefOfStaffTab({ accessToken, showToast }) {
  const [persona, setPersona] = useState(null);
  const [messages, setMessages] = useState([]);
  const [briefing, setBriefing] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [settings, setSettings] = useState(false);
  const [voices, setVoices] = useState(null);
  const [avatars, setAvatars] = useState(null);
  const [genningAvatars, setGenningAvatars] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('a warm, friendly Latina chief of staff in her 30s, professional, approachable smile');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pending, setPending] = useState([]); // proposed Meta actions awaiting Confirm
  const [actingId, setActingId] = useState(null);
  const [memo, setMemo] = useState(null); // Sofía's weekly CEO memo
  const [memoBusy, setMemoBusy] = useState(false);
  const [memoOpen, setMemoOpen] = useState(true);
  const [score, setScore] = useState(null); // her track-record scoreboard
  const [scoreOpen, setScoreOpen] = useState(false);
  const audioRef = useRef(null);
  const scrollRef = useRef(null);

  const call = useCallback(async (url, payload) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify(payload || {}) });
    return { status: res.status, body: await res.json() };
  }, [accessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ status, body }, b2, m, sc] = await Promise.all([call(COS, { action: 'get' }), call(BRIEF, {}), call(COS, { action: 'get_weekly_memo' }), call(COS, { action: 'get_scorecard' })]);
      if (body.success) { setPersona(body.persona); setName(body.persona?.name || ''); setMessages(body.messages || []); setPending(body.pending_actions || []); }
      else if (status === 403) setDenied(true);
      if (b2.body?.success) setBriefing(b2.body.briefings?.[0] || null);
      if (m.body?.success) setMemo(m.body.memo || null);
      if (sc.body?.success) setScore(sc.body.scorecard || null);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  const resolveCall = async (id, verdict) => {
    try {
      const { body } = await call(COS, { action: 'resolve_call', id, verdict });
      if (body?.success) setScore(body.scorecard || null);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
  };

  const makeMemo = async () => {
    setMemoBusy(true);
    try {
      const { body } = await call(COS, { action: 'make_weekly_memo' });
      if (body?.success) { setMemo(body.memo || null); setMemoOpen(true); showToast?.('Sofía wrote a fresh CEO memo'); }
      else showToast?.(`Error: ${body?.error || 'could not generate'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setMemoBusy(false); }
  };

  useEffect(() => { load(); }, [load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, sending]);

  const play = (url) => { if (audioRef.current && url) { audioRef.current.src = url; audioRef.current.play().catch(() => {}); } };

  const speak = async (text, messageId) => {
    setSpeakingId(messageId || 'briefing');
    try {
      const { body } = await call(COS, { action: 'speak', text, message_id: messageId });
      if (body.success) play(body.audio_url);
      else showToast?.(body.error?.includes('voice') ? 'Pick a voice first (settings)' : `Error: ${body.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setSpeakingId(null); }
  };

  const submit = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput(''); setSending(true);
    setMessages((p) => [...p, { id: `t${Date.now()}`, role: 'user', content: msg }]);
    try {
      const { body } = await call(COS, { action: 'chat', message: msg });
      if (body.success) {
        setMessages((p) => [...p, { id: body.message_id, role: 'assistant', content: body.reply }]);
        if (body.pending_actions?.length) setPending((p) => [...body.pending_actions, ...p]);
      }
      else showToast?.(`Error: ${body.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setSending(false); }
  };

  // Proposed Meta actions — execute only on the owner's explicit Confirm.
  const confirmAction = async (id) => {
    setActingId(id);
    try {
      const { body } = await call(COS, { action: 'confirm_action', id });
      if (body.success) {
        showToast?.(body.result || 'Done');
        setMessages((p) => [...p, { id: `r${Date.now()}`, role: 'assistant', content: `Done — ${body.result}` }]);
      } else {
        showToast?.(`Error: ${body.result || body.error || 'failed'}`);
        setMessages((p) => [...p, { id: `r${Date.now()}`, role: 'assistant', content: `Couldn't complete that: ${body.result || body.error}` }]);
      }
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setActingId(null); setPending((p) => p.filter((x) => x.id !== id)); }
  };
  const cancelAction = async (id) => {
    setActingId(id);
    try { await call(COS, { action: 'cancel_action', id }); }
    catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setActingId(null); setPending((p) => p.filter((x) => x.id !== id)); }
  };

  // Today's date in the owner's Pacific frame (reports use his LA day).
  const todayPacific = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

  const pullReport = () => {
    if (!from) { showToast?.('Pick a start date'); return; }
    const end = to || todayPacific();
    submit(`Give me the ad report from ${from} to ${end} (my Pacific days): spend, sales, ROAS and which ads performed best.`);
  };

  const quickReport = (kind) => {
    const end = todayPacific();
    const d = new Date(`${end}T00:00:00Z`); // date math in UTC on the Pacific date
    if (kind === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
    else d.setUTCDate(d.getUTCDate() - Number(kind));
    const start = d.toISOString().slice(0, 10);
    setFrom(start); setTo(end);
    submit(`Give me the ad report from ${start} to ${end} (my Pacific days): spend, sales, ROAS and which ads performed best.`);
  };

  const loadVoices = async () => { const { body } = await call(COS, { action: 'list_voices' }); if (body.success) setVoices(body.voices || []); };
  const previewVoice = async (vid) => { setSpeakingId('preview'); const { body } = await call(COS, { action: 'preview_voice', voice_id: vid }); if (body.success) play(body.audio_url); else showToast?.('Preview failed'); setSpeakingId(null); };
  const setPersonaField = async (patch) => { const { body } = await call(COS, { action: 'set_persona', ...patch }); if (body.success) { setPersona(body.persona); showToast?.('Saved'); } };
  const genAvatars = async () => { setGenningAvatars(true); setAvatars(null); try { const { body } = await call(COS, { action: 'gen_avatars', description: desc }); if (body.success) setAvatars(body.avatars || []); else showToast?.(`Error: ${body.error}`); } finally { setGenningAvatars(false); } };

  if (denied) return <div className="text-gray-400 py-16 text-center">The Chief of Staff is available to admins only.</div>;

  const nm = persona?.name || 'Sofía';
  const avatar = persona?.avatar_url;
  const a = briefing?.analysis;
  // Guard: a malformed briefing (top_actions as a string) must never crash the tab.
  const topActions = Array.isArray(a?.top_actions) ? a.top_actions : [];
  // Include the snapshot — that's where the sales/campaign numbers live — so the
  // spoken briefing actually reads the results, not just the headline + actions.
  const briefingText = a
    ? [a.greeting, a.snapshot, topActions.map((x, i) => `${i + 1}. ${x?.action} (${x?.where})`).join('\n')]
        .filter(Boolean).join('\n\n')
    : '';

  // The daily briefing is read aloud in the "Jarvis" voice (Daniel) — an
  // authoritative news-anchor read of the sales + campaign numbers — regardless
  // of Sofía's own chat voice. preview_voice forces a voice_id without touching
  // the persona, so the interactive chat keeps her voice.
  const JARVIS_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9'; // Daniel — British broadcaster
  const speakBriefing = async () => {
    if (!briefingText) return;
    setSpeakingId('briefing');
    try {
      const { body } = await call(COS, { action: 'preview_voice', voice_id: JARVIS_VOICE_ID, text: briefingText });
      if (body.success) play(body.audio_url);
      else showToast?.(`Error: ${body.error || 'briefing voice failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setSpeakingId(null); }
  };
  const tier = score ? (TIER_META[score.tier] || TIER_META.building) : null;

  const Avatar = ({ size }) => avatar
    ? <img src={avatar} alt={nm} className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}><Compass size={size * 0.45} className="text-indigo-600" /></div>;

  return (
    <div className="max-w-3xl">
      <audio ref={audioRef} hidden />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Avatar size={44} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{nm}</h2>
              {tier && <Badge tone={tier.tone}>{tier.label}{score.accuracy != null ? ` · ${score.accuracy}%` : ''}</Badge>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Chief of staff{persona?.voice_name ? ` · ${persona.voice_name}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={load} className={btn.iconGhost} title="Refresh"><RefreshCw size={16} /></button>
          <button onClick={() => setSettings(!settings)} className={btn.iconGhost} title="Personalize"><Settings size={16} /></button>
        </div>
      </div>

      {/* Needs your confirm — top, prominent. Nothing runs until you tap Confirm. */}
      {pending.length > 0 && (
        <div className="space-y-2 mb-5">
          {pending.map((p) => {
            const working = actingId === p.id;
            const workLabel = p.action_type === 'extract_creative'
              ? 'Art Director is generating your ads… (~30–60s, then check Creative Studio → Ads)'
              : 'Applying the change in Meta…';
            return (
              <div key={p.id} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                {working ? (
                  <div>
                    <div className="flex items-center gap-2 text-sm text-gray-900 mb-2">
                      <Loader2 size={14} className="animate-spin text-amber-600" />
                      <span className="font-medium">{workLabel}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-200"><div className="h-full w-full rounded-full bg-amber-500 animate-pulse" /></div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-amber-700 mb-0.5">Needs your confirm</p>
                      <p className="text-sm text-gray-900">{p.summary || `${p.action_type} ${p.target_name || ''}`}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => confirmAction(p.id)} className={btn.success}><Check size={14} /> Confirm</button>
                      <button onClick={() => cancelAction(p.id)} className={btn.ghost}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Weekly CEO memo */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <button onClick={() => setMemoOpen((o) => !o)} className="flex items-center gap-2 text-left flex-1 min-w-0">
            <FileText size={16} className="text-indigo-600 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-900 truncate">
              {memo?.headline || 'Weekly CEO memo'}
              {memo?.week_of && <span className="ml-2 text-[11px] font-normal text-gray-400">week of {memo.week_of}</span>}
            </span>
            {memo && <ChevronDown size={15} className={`text-gray-400 flex-shrink-0 transition ${memoOpen ? 'rotate-180' : ''}`} />}
          </button>
          <button onClick={makeMemo} disabled={memoBusy} className={btn.accent + ' !px-2.5 !py-1.5 !text-xs'}>
            {memoBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {memo ? 'Refresh' : 'Write memo'}
          </button>
        </div>

        {memo && memoOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
            {memo.summary && <p className="text-sm text-gray-700 leading-relaxed">{memo.summary}</p>}

            {memo.body?.metrics && !Array.isArray(memo.body.metrics) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Stat label="Spend" value={`$${memo.body.metrics.spend}`} />
                <Stat label="Revenue" value={`$${memo.body.metrics.revenue}`} />
                <Stat label="Orders" value={memo.body.metrics.orders} />
                {memo.body.metrics.blended_roas != null && <Stat label="Blended ROAS" value={`${memo.body.metrics.blended_roas}×`} />}
              </div>
            )}

            {Array.isArray(memo.body?.moves) && memo.body.moves.length > 0 && (
              <div className="space-y-2">
                <SectionLabel>This week's moves</SectionLabel>
                {memo.body.moves.map((mv, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-start gap-2.5">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{mv.title}</p>
                        {mv.why && <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{mv.why}</p>}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                          {mv.number && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700"><TrendingUp size={12} /> {mv.number}</span>}
                          {mv.tab && <span className="text-[11px] text-gray-400">{mv.tab}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {memo.body?.watch && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span><span className="font-medium">Watch:</span> {memo.body.watch}</span>
              </div>
            )}
          </div>
        )}
        {!memo && memoOpen && (
          <div className="px-4 pb-4 text-xs text-gray-500 border-t border-gray-100 pt-3">No memo yet — Sofía writes one every Monday. Tap “Write memo” to have her analyze this week now.</div>
        )}
      </Card>

      {/* Track record */}
      {score && (
        <Card className="mb-4 overflow-hidden">
          <button onClick={() => setScoreOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Check size={16} className="text-gray-500 flex-shrink-0" />
              <span className="text-sm font-medium text-gray-900">Track record</span>
              {tier && <Badge tone={tier.tone}>{tier.label}</Badge>}
              <span className="text-xs text-gray-500 truncate">
                {score.accuracy == null ? 'no calls resolved yet' : `${score.accuracy}% (${score.correct}/${score.resolved})`}
                {score.open > 0 && <span className="text-amber-600"> · {score.open} to judge</span>}
              </span>
            </div>
            <ChevronDown size={15} className={`text-gray-400 flex-shrink-0 transition ${scoreOpen ? 'rotate-180' : ''}`} />
          </button>
          {scoreOpen && (
            <div className="px-4 pb-4 space-y-2 border-t border-gray-100 pt-3">
              <p className="text-[11px] text-gray-500">Mark each call right or wrong once it's played out — that's how she earns more autonomy. Money moves always stay Confirm-gated.</p>
              {(score.recent || []).length === 0 && <p className="text-xs text-gray-400">No calls logged yet — they appear here as she makes recommendations and takes ad actions.</p>}
              {(score.recent || []).map((c) => (
                <div key={c.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{c.call}</p>
                      {c.subject && <p className="text-[11px] text-gray-400 mt-0.5">{c.subject} · {c.kind}</p>}
                    </div>
                    {c.status === 'open' ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => resolveCall(c.id, 'correct')} title="Right call" className="p-1.5 rounded-lg border border-green-200 text-green-600 hover:bg-green-50"><Check size={13} /></button>
                        <button onClick={() => resolveCall(c.id, 'wrong')} title="Wrong call" className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><X size={13} /></button>
                        <button onClick={() => resolveCall(c.id, 'dismissed')} title="Not measurable / skip" className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 text-gray-400 hover:bg-white">Skip</button>
                      </div>
                    ) : (
                      <Badge tone={c.status === 'correct' ? 'green' : c.status === 'wrong' ? 'red' : 'gray'}>{c.status === 'correct' ? 'Right' : c.status === 'wrong' ? 'Wrong' : 'Skipped'}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Ad report toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5 font-medium text-gray-500"><BarChart3 size={14} /> Ad report</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={sending} className="border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white" />
        <span className="text-gray-400">→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={sending} className="border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white" />
        <button onClick={pullReport} disabled={sending || !from} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-50">Pull</button>
        <span className="text-gray-200">|</span>
        <button onClick={() => quickReport('week')} disabled={sending} className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">This week</button>
        <button onClick={() => quickReport(7)} disabled={sending} className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Last 7 days</button>
        <button onClick={() => quickReport(30)} disabled={sending} className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">30 days</button>
      </div>

      {/* Settings */}
      {settings && (
        <Card className="p-4 mb-4 space-y-4 bg-gray-50">
          <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-gray-900">Personalize {nm}</h3><button onClick={() => setSettings(false)} className={btn.iconGhost}><X size={16} /></button></div>
          <div className="flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={() => setPersonaField({ name })} className={btn.ghost}>Save name</button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium text-gray-700">Voice (ElevenLabs)</span>{!voices && <button onClick={loadVoices} className="text-xs text-indigo-600 hover:underline">Load voices</button>}</div>
            {voices && (
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {voices.map((v) => (
                  <div key={v.voice_id} className={`flex items-center gap-2 p-2 rounded-lg text-sm ${persona?.voice_id === v.voice_id ? 'bg-indigo-50 border border-indigo-200' : 'bg-white border border-gray-100'}`}>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900">{v.name}</span>
                      <span className="text-[11px] text-gray-400 ml-1">{[v.labels?.accent, v.labels?.gender, v.labels?.use_case].filter(Boolean).join(' · ')}</span>
                    </div>
                    {v.preview_url && <button onClick={() => play(v.preview_url)} className="text-gray-400 hover:text-gray-700" title="Sample"><Volume2 size={15} /></button>}
                    <button onClick={() => previewVoice(v.voice_id)} className="text-[11px] text-indigo-600 hover:underline" title="Preview in Spanish">Preview ES</button>
                    <button onClick={() => setPersonaField({ voice_id: v.voice_id, voice_name: v.name })} className="text-[11px] px-2 py-1 rounded bg-gray-900 text-white">{persona?.voice_id === v.voice_id ? 'In use' : 'Use'}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <span className="text-xs font-medium text-gray-700">Avatar</span>
            <div className="flex items-center gap-2 mt-1">
              <input value={desc} onChange={(e) => setDesc(e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs bg-white" />
              <button onClick={genAvatars} disabled={genningAvatars} className={btn.primary}>{genningAvatars ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate</button>
            </div>
            {avatars && (
              <div className="flex gap-2 mt-2">
                {avatars.map((u) => <button key={u} onClick={() => setPersonaField({ avatar_url: u })} className={`rounded-lg overflow-hidden border-2 ${persona?.avatar_url === u ? 'border-indigo-500' : 'border-transparent'}`}><img src={u} className="w-20 h-20 object-cover" /></button>)}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Conversation */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : (
        <div ref={scrollRef} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4 overflow-y-auto" style={{ height: '58vh' }}>
          {a && (
            <div className="flex gap-2.5">
              <Avatar size={32} />
              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 max-w-[85%]">
                <div className="flex items-center gap-2 mb-1"><span className="text-xs font-medium text-indigo-700">Today's briefing</span><button onClick={speakBriefing} title="Read aloud in the Jarvis voice" className="text-indigo-400 hover:text-indigo-700">{speakingId === 'briefing' ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />}</button></div>
                <p className="text-sm font-medium text-gray-900">{a.greeting}</p>
                <ol className="text-xs text-gray-600 mt-2 space-y-1.5 list-decimal pl-4">
                  {topActions.map((x, i) => (
                    <li key={i}>
                      {x?.action} <span className="text-gray-400">· {x?.where}</span>
                      <button onClick={() => submit(`Take care of this for me: ${x?.action}`)} disabled={sending} className="ml-2 align-middle inline-flex items-center gap-0.5 text-[11px] font-medium text-indigo-600 hover:underline disabled:opacity-50"><Play size={10} /> Do it</button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role !== 'user' && <Avatar size={32} />}
              <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap max-w-[80%] ${m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                {m.content}
                {m.role !== 'user' && String(m.id).length > 10 && (
                  <button onClick={() => speak(m.content, m.id)} className="ml-2 text-gray-400 hover:text-gray-700 align-middle">{speakingId === m.id ? <Loader2 size={13} className="animate-spin inline" /> : <Volume2 size={13} className="inline" />}</button>
                )}
              </div>
            </div>
          ))}
          {sending && <div className="flex gap-2.5"><Avatar size={32} /><div className="bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Thinking…</div></div>}
        </div>
      )}

      {/* Composer */}
      <div className="flex items-center gap-2 mt-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={`Ask ${nm}… (e.g. "pause the Corrido campaign")`} disabled={sending}
          className="flex-1 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-indigo-400 disabled:opacity-60" />
        <button onClick={() => submit()} disabled={sending || !input.trim()} className={btn.accent + ' !px-4'}><Send size={15} /></button>
      </div>
    </div>
  );
}
