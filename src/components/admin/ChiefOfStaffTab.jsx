// src/components/admin/ChiefOfStaffTab.jsx
// Chief of Staff — a personified, interactive assistant. Has a name + avatar +
// voice, shows the morning briefing as its first message, and you can chat with
// it. It reads the whole business and can take actions across your agents. Voice
// via ElevenLabs (pick + preview in settings). Admin-only. Talks to
// cos-assistant (+ chief-of-staff-admin for the briefing).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Compass, Send, Loader2, Settings, Volume2, RefreshCw, Check, Sparkles, X } from 'lucide-react';

const COS = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cos-assistant`;
const BRIEF = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chief-of-staff-admin`;

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
  const audioRef = useRef(null);
  const scrollRef = useRef(null);

  const call = useCallback(async (url, payload) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify(payload || {}) });
    return { status: res.status, body: await res.json() };
  }, [accessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ status, body }, b2] = await Promise.all([call(COS, { action: 'get' }), call(BRIEF, {})]);
      if (body.success) { setPersona(body.persona); setName(body.persona?.name || ''); setMessages(body.messages || []); }
      else if (status === 403) setDenied(true);
      if (b2.body?.success) setBriefing(b2.body.briefings?.[0] || null);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, sending]);

  const play = (url) => { if (audioRef.current && url) { audioRef.current.src = url; audioRef.current.play().catch(() => {}); } };

  const speak = async (text, messageId) => {
    setSpeakingId(messageId || 'briefing');
    try {
      const { body } = await call(COS, { action: 'speak', text, message_id: messageId });
      if (body.success) play(body.audio_url);
      else showToast?.(body.error?.includes('voice') ? 'Pick a voice first (⚙️ settings)' : `Error: ${body.error}`);
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
      if (body.success) setMessages((p) => [...p, { id: body.message_id, role: 'assistant', content: body.reply }]);
      else showToast?.(`Error: ${body.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setSending(false); }
  };

  const pullReport = () => {
    if (!from) { showToast?.('Pick a start date'); return; }
    const end = to || new Date().toISOString().slice(0, 10);
    submit(`Give me the ad report from ${from} to ${end}: spend, sales, ROAS and which ads performed best.`);
  };

  const quickReport = (kind) => {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const d = new Date(now);
    if (kind === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    else d.setDate(d.getDate() - Number(kind));
    const start = d.toISOString().slice(0, 10);
    setFrom(start); setTo(end);
    submit(`Give me the ad report from ${start} to ${end}: spend, sales, ROAS and which ads performed best.`);
  };

  const loadVoices = async () => { const { body } = await call(COS, { action: 'list_voices' }); if (body.success) setVoices(body.voices || []); };
  const previewVoice = async (vid) => { setSpeakingId('preview'); const { body } = await call(COS, { action: 'preview_voice', voice_id: vid }); if (body.success) play(body.audio_url); else showToast?.('Preview failed'); setSpeakingId(null); };
  const setPersonaField = async (patch) => { const { body } = await call(COS, { action: 'set_persona', ...patch }); if (body.success) { setPersona(body.persona); showToast?.('Guardado'); } };
  const genAvatars = async () => { setGenningAvatars(true); setAvatars(null); try { const { body } = await call(COS, { action: 'gen_avatars', description: desc }); if (body.success) setAvatars(body.avatars || []); else showToast?.(`Error: ${body.error}`); } finally { setGenningAvatars(false); } };

  if (denied) return <div className="text-gray-400 py-16 text-center">The Chief of Staff is available to admins only.</div>;

  const nm = persona?.name || 'Sofía';
  const avatar = persona?.avatar_url;
  const a = briefing?.analysis;
  const briefingText = a ? `${a.greeting}\n\n${(a.top_actions || []).map((x, i) => `${i + 1}. ${x.action} (${x.where})`).join('\n')}` : '';

  return (
    <div className="max-w-3xl">
      <audio ref={audioRef} hidden />
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          {avatar ? <img src={avatar} alt={nm} className="w-12 h-12 rounded-full object-cover border border-gray-200" />
            : <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center"><Compass size={22} className="text-purple-600" /></div>}
          <div>
            <h2 className="text-lg font-bold text-gray-900">{nm}</h2>
            <p className="text-xs text-gray-500">Your Chief of Staff{persona?.voice_name ? ` · 🔊 ${persona.voice_name}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-400 hover:text-gray-700" title="Refresh"><RefreshCw size={16} /></button>
          <button onClick={() => { setSettings(!settings); }} className="p-2 text-gray-400 hover:text-gray-700" title="Personalize"><Settings size={16} /></button>
        </div>
      </div>

      {/* Ad report by date range — the assistant pulls ad spend, sales & ROAS for the window */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
        <span className="text-gray-600 font-medium">📊 Ad report:</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={sending}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white" />
        <span className="text-gray-400">→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={sending}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white" />
        <button onClick={pullReport} disabled={sending || !from}
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-50">Pull</button>
        <span className="text-gray-300">|</span>
        <button onClick={() => quickReport('week')} disabled={sending} className="px-2 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-50">This week</button>
        <button onClick={() => quickReport(7)} disabled={sending} className="px-2 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-50">Last 7 days</button>
        <button onClick={() => quickReport(30)} disabled={sending} className="px-2 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-50">30 days</button>
      </div>

      {/* Settings */}
      {settings && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 space-y-4">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">Personalize {nm}</h3><button onClick={() => setSettings(false)}><X size={16} className="text-gray-400" /></button></div>
          <div className="flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => setPersonaField({ name })} className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-white">Save name</button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-gray-700">Voice (ElevenLabs)</span>{!voices && <button onClick={loadVoices} className="text-xs text-blue-600">Load voices</button>}</div>
            {voices && (
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {voices.map((v) => (
                  <div key={v.voice_id} className={`flex items-center gap-2 p-2 rounded-lg text-sm ${persona?.voice_id === v.voice_id ? 'bg-purple-50 border border-purple-200' : 'bg-white border border-gray-100'}`}>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900">{v.name}</span>
                      <span className="text-[11px] text-gray-400 ml-1">{[v.labels?.accent, v.labels?.gender, v.labels?.use_case].filter(Boolean).join(' · ')}</span>
                    </div>
                    {v.preview_url && <button onClick={() => play(v.preview_url)} className="text-gray-400 hover:text-gray-700" title="Sample"><Volume2 size={15} /></button>}
                    <button onClick={() => previewVoice(v.voice_id)} className="text-[11px] text-purple-600 hover:underline" title="Escuchar en español">🇲🇽 es</button>
                    <button onClick={() => setPersonaField({ voice_id: v.voice_id, voice_name: v.name })} className="text-[11px] px-2 py-1 rounded bg-gray-900 text-white">{persona?.voice_id === v.voice_id ? '✓' : 'Usar'}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <span className="text-xs font-semibold text-gray-700">Avatar</span>
            <div className="flex items-center gap-2 mt-1">
              <input value={desc} onChange={(e) => setDesc(e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs" />
              <button onClick={genAvatars} disabled={genningAvatars} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-50">{genningAvatars ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate</button>
            </div>
            {avatars && (
              <div className="flex gap-2 mt-2">
                {avatars.map((u) => <button key={u} onClick={() => setPersonaField({ avatar_url: u })} className={`rounded-lg overflow-hidden border-2 ${persona?.avatar_url === u ? 'border-purple-500' : 'border-transparent'}`}><img src={u} className="w-20 h-20 object-cover" /></button>)}
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : (
        <div ref={scrollRef} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4 overflow-y-auto" style={{ height: '62vh' }}>
          {/* Briefing as the first message */}
          {a && (
            <div className="flex gap-2.5">
              {avatar ? <img src={avatar} className="w-8 h-8 rounded-full object-cover flex-shrink-0" /> : <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0"><Compass size={16} className="text-purple-600" /></div>}
              <div className="bg-white border border-purple-100 rounded-2xl px-4 py-3 max-w-[85%]">
                <div className="flex items-center gap-2 mb-1"><span className="text-xs font-semibold text-purple-700">Briefing de hoy</span><button onClick={() => speak(briefingText)} className="text-purple-400 hover:text-purple-700">{speakingId === 'briefing' ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />}</button></div>
                <p className="text-sm font-medium text-gray-900">{a.greeting}</p>
                <ol className="text-xs text-gray-600 mt-2 space-y-1.5 list-decimal pl-4">
                  {(a.top_actions || []).map((x, i) => (
                    <li key={i}>
                      {x.action} <span className="text-gray-400">· {x.where}</span>
                      <button onClick={() => submit(`Take care of this for me: ${x.action}`)} disabled={sending}
                        className="ml-2 align-middle text-[11px] font-medium text-purple-600 hover:underline disabled:opacity-50">▶ Do it</button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role !== 'user' && (avatar ? <img src={avatar} className="w-8 h-8 rounded-full object-cover flex-shrink-0" /> : <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0"><Compass size={16} className="text-purple-600" /></div>)}
              <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap max-w-[80%] ${m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                {m.content}
                {m.role !== 'user' && String(m.id).length > 10 && (
                  <button onClick={() => speak(m.content, m.id)} className="ml-2 text-gray-400 hover:text-gray-700 align-middle">{speakingId === m.id ? <Loader2 size={13} className="animate-spin inline" /> : <Volume2 size={13} className="inline" />}</button>
                )}
              </div>
            </div>
          ))}
          {sending && <div className="flex gap-2.5"><div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0"><Compass size={16} className="text-purple-600" /></div><div className="bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> pensando…</div></div>}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={`Pregúntale a ${nm}… (ej: "aprueba el mejor creativo")`} disabled={sending}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400 disabled:opacity-60" />
        <button onClick={() => submit()} disabled={sending || !input.trim()} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-700 disabled:opacity-50"><Send size={15} /></button>
      </div>
    </div>
  );
}
