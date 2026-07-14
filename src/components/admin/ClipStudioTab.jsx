// src/components/admin/ClipStudioTab.jsx
// Clip Studio — upload a video, get a word-timed transcript, burn animated
// social-media captions (Submagic-style) and download the clips.
// Standalone tool: talks only to the clip-studio edge function (own tables +
// own 'clip-studio' bucket), so the whole feature can move to its own project.
//
// Detail view is a guided 3-step flow: 1) pick the moment (AI picks first),
// 2) choose the look, 3) name + generate. Finished clips live in their own
// gallery section below.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clapperboard, UploadCloud, RefreshCw, Loader2, ArrowLeft, Trash2,
  Download, Play, AlertTriangle, ChevronRight, ChevronDown, ChevronUp,
  Captions, Clock, Sparkles, Check, Send, Music,
} from 'lucide-react';
import { Card, Badge, SectionLabel, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clip-studio`;

const STYLE_META = {
  boldpop:  { name: 'Bold Pop',  desc: 'Big white caps, yellow word highlight', sample: ['ESTE', 'REGALO', 'CAMBIA TODO'], hi: '#FFD400', upper: true, box: false },
  goldglow: { name: 'Gold',      desc: 'White caps, gold word highlight',       sample: ['UNA', 'CANCIÓN', 'PARA MAMÁ'],  hi: '#F5B70A', upper: true, box: false },
  cleanbox: { name: 'Clean Box', desc: 'Sentence case on a soft dark box',      sample: ['Una canción hecha', 'solo para ella'], hi: null, upper: false, box: true },
};
const ASPECT_META = {
  '9:16': { name: 'Vertical',  desc: 'Reels / TikTok / Shorts' },
  '1:1':  { name: 'Square',    desc: 'Feed ads' },
  '16:9': { name: 'Landscape', desc: 'YouTube / web' },
};
const PROJECT_STATUS = {
  uploaded:     { label: 'Uploaded',      tone: 'gray' },
  preparing:    { label: 'Reading video', tone: 'amber' },
  transcribing: { label: 'Transcribing',  tone: 'amber' },
  ready:        { label: 'Ready',         tone: 'green' },
  error:        { label: 'Error',         tone: 'red' },
};
const CLIP_STATUS = {
  rendering: { label: 'Rendering', tone: 'amber' },
  ready:     { label: 'Ready',     tone: 'green' },
  failed:    { label: 'Failed',    tone: 'red' },
};

const fmtTime = (s) => {
  if (s == null || isNaN(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// Mini caption preview used on the style picker cards.
function StylePreview({ styleKey }) {
  const st = STYLE_META[styleKey];
  return (
    <div className="rounded-lg bg-gray-900 h-20 flex items-end justify-center pb-3 overflow-hidden">
      <div className={st.box ? 'bg-black/60 rounded px-2 py-1' : ''}>
        {st.sample.map((line, i) => (
          <div key={i} className="text-center leading-tight" style={{
            color: '#fff', fontWeight: 800, fontSize: st.upper ? 13 : 12,
            textShadow: st.box ? 'none' : '0 0 4px #000, 1px 1px 0 #000, -1px -1px 0 #000',
          }}>
            {line.split(' ').map((w, j) => (
              <span key={j} style={{ color: st.hi && i === 0 && j === 0 ? st.hi : '#fff' }}>{w} </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Numbered header for each step of the flow.
function StepHeader({ n, title, hint }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">{n}</span>
      <span className="text-sm font-semibold text-gray-900">{title}</span>
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </div>
  );
}

// "Uploaded → Reading → Transcribing → Ready" progress while a video processes.
function PipelineProgress({ status }) {
  const steps = [
    { key: 'uploaded', label: 'Uploaded' },
    { key: 'preparing', label: 'Reading video' },
    { key: 'transcribing', label: 'Transcribing' },
    { key: 'ready', label: 'Ready' },
  ];
  const idx = Math.max(0, steps.findIndex((s) => s.key === status));
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ${
            i < idx ? 'bg-green-100 text-green-700' : i === idx ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'
          }`}>
            {i < idx ? <Check size={11} /> : i === idx && s.key !== 'ready' ? <Loader2 size={11} className="animate-spin" /> : null}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-gray-300">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function ClipStudioTab({ accessToken, showToast }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [upload, setUpload] = useState(null); // { name, pct, phase }
  const [form, setForm] = useState({
    start: '', end: '', aspect: '9:16', style: 'boldpop', label: '',
    framing: 'auto', silences: false, zoom: false, hook: false, emphasis: true, music: false, broll: false,
  });
  const [rendering, setRendering] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const fileRef = useRef(null);
  const musicRef = useRef(null);
  const videoRef = useRef(null);

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
    const r = await res.json();
    if (!r.success) throw new Error(r.error || `request failed (${res.status})`);
    return r;
  }, [accessToken]);

  const load = useCallback(async (silent = false) => {
    if (!accessToken) return;
    if (!silent) setLoading(true);
    try {
      const r = await call({ action: 'list' });
      setProjects(r.projects || []);
    } catch (e) {
      if (!silent) showToast?.(`Error: ${e.message}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessToken, call, showToast]);

  useEffect(() => { load(); }, [load]);

  // Poll every 5s while anything is in flight (prepare / transcribe / render).
  const busy = projects.some((p) =>
    ['preparing', 'transcribing'].includes(p.status) || (p.clips || []).some((c) => c.status === 'rendering'));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [busy, load]);

  // ---- upload flow: create_project -> XHR PUT (progress) -> ingest ----
  const onFile = async (file) => {
    if (!file) return;
    if (file.size > 1024 * 1024 * 1024) { showToast?.('Max upload size is 1GB'); return; }
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
    setUpload({ name: file.name, pct: 0, phase: 'Preparing upload…' });
    try {
      const { project_id, signed_url, path } = await call({ action: 'create_project', title: file.name, ext });
      setUpload({ name: file.name, pct: 0, phase: 'Uploading…' });
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signed_url);
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUpload({ name: file.name, pct: Math.round((e.loaded / e.total) * 100), phase: 'Uploading…' });
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('upload failed (network)'));
        xhr.send(file);
      });
      setUpload({ name: file.name, pct: 100, phase: 'Starting transcription…' });
      await call({ action: 'ingest', project_id, path });
      setUpload(null);
      setSelectedId(project_id);
      showToast?.('Video uploaded — transcribing now');
      load(true);
    } catch (e) {
      setUpload(null);
      showToast?.(`Upload error: ${e.message}`);
    }
  };

  const suggestClips = async (project) => {
    setSuggesting(true);
    try {
      await call({ action: 'suggest_clips', project_id: project.id });
      showToast?.('AI picked the best moments');
      load(true);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setSuggesting(false);
    }
  };

  const useSuggestion = (s) => {
    setForm((f) => ({ ...f, start: String(s.start_sec), end: String(s.end_sec), label: s.title || f.label }));
    if (videoRef.current) { videoRef.current.currentTime = s.start_sec; }
    showToast?.('Moment selected — now choose the look below');
  };

  const retryIngest = async (project) => {
    setRetrying(true);
    try {
      await call({ action: 'ingest', project_id: project.id, path: project.source_path });
      showToast?.('Retrying — reading the video again');
      load(true);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setRetrying(false);
    }
  };

  const setFromPlayer = (field) => {
    const t = videoRef.current?.currentTime;
    if (t == null) return;
    setForm((f) => ({ ...f, [field]: (Math.round(t * 10) / 10).toString() }));
  };

  const renderClip = async (project) => {
    const start = parseFloat(form.start) || 0;
    const end = form.end === '' ? (project.duration_sec || 0) : parseFloat(form.end);
    setRendering(true);
    try {
      await call({
        action: 'render_clip', project_id: project.id, start_sec: start, end_sec: end,
        aspect: form.aspect, style: form.style, label: form.label || null,
        options: { framing: form.framing, remove_silences: form.silences, zoom: form.zoom, hook_title: form.hook, emphasis: form.emphasis, music: form.music, broll: form.broll },
      });
      showToast?.('Clip rendering — it will appear in "Your clips" below');
      load(true);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setRendering(false);
    }
  };

  const downloadClip = async (clip) => {
    try {
      const res = await fetch(clip.video_url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(clip.label || 'clip').replace(/[^a-z0-9_-]/gi, '_')}-${clip.aspect.replace(':', 'x')}.mp4`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(clip.video_url, '_blank');
    }
  };

  const sendToCreative = async (clip) => {
    setSendingId(clip.id);
    try {
      await call({ action: 'send_to_creative', clip_id: clip.id });
      showToast?.('Sent — waiting for your approval in Creative Studio');
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setSendingId(null);
    }
  };

  const onMusicFile = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { showToast?.('Music files up to 20MB'); return; }
    setMusicBusy(true);
    try {
      const { signed_url } = await call({ action: 'sign_music', filename: file.name });
      const res = await fetch(signed_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      showToast?.(`Added "${file.name}" to the music library`);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setMusicBusy(false);
    }
  };

  const removeClip = async (clip) => {
    if (!window.confirm('Delete this clip?')) return;
    try { await call({ action: 'delete_clip', clip_id: clip.id }); load(true); }
    catch (e) { showToast?.(`Error: ${e.message}`); }
  };

  const removeProject = async (project) => {
    if (!window.confirm(`Delete "${project.title}" and all its clips?`)) return;
    try { await call({ action: 'delete_project', project_id: project.id }); setSelectedId(null); load(); }
    catch (e) { showToast?.(`Error: ${e.message}`); }
  };

  const project = projects.find((p) => p.id === selectedId);

  // ---------------- DETAIL VIEW ----------------
  if (project) {
    const ps = PROJECT_STATUS[project.status] || PROJECT_STATUS.uploaded;
    const working = ['uploaded', 'preparing', 'transcribing'].includes(project.status);
    const ready = project.status === 'ready';
    const suggestions = project.ai_suggestions?.suggestions || [];
    const selStart = parseFloat(form.start) || 0;
    const selEnd = form.end === '' ? (project.duration_sec || 0) : parseFloat(form.end);
    const selDur = Math.max(0, selEnd - selStart);
    const hasSelection = form.start !== '' || form.end !== '';
    const extrasOn = [form.silences && 'no silences', form.zoom && 'zoom', form.hook && 'title'].filter(Boolean);

    return (
      <div className="max-w-6xl">
        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
          <ArrowLeft size={16} /> All videos
        </button>

        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 break-all">{project.title}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge tone={ps.tone}>{ps.label}</Badge>
              {project.duration_sec != null && <span className="text-xs text-gray-400 flex items-center gap-1"><Clock size={12} /> {fmtTime(project.duration_sec)}</span>}
              {project.word_count > 0 && <span className="text-xs text-gray-400">{project.word_count} words</span>}
            </div>
          </div>
          <button onClick={() => removeProject(project)} className={btn.iconGhost} title="Delete video and all its clips">
            <Trash2 size={16} />
          </button>
        </div>

        {project.status === 'error' && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle size={15} className="flex-shrink-0" />
            <span className="flex-1">{project.error_message}</span>
            {project.source_path && (
              <button onClick={() => retryIngest(project)} disabled={retrying}
                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition">
                {retrying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Retry
              </button>
            )}
          </div>
        )}

        {working && (
          <Card className="p-4 mb-4">
            <PipelineProgress status={project.status} />
            <p className="text-xs text-gray-400 mt-2">Getting your video ready — this page updates by itself. Longer videos take a few minutes.</p>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* LEFT: player + transcript */}
          <div className="lg:col-span-2">
            <div className="lg:sticky lg:top-4">
              {project.source_url && (
                <video ref={videoRef} src={project.source_url} controls className="w-full rounded-xl bg-black mb-3" />
              )}
              {project.transcript_text && (
                <Card className="p-4">
                  <button onClick={() => setTranscriptOpen((v) => !v)} className="w-full flex items-center justify-between">
                    <SectionLabel>Transcript</SectionLabel>
                    {transcriptOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </button>
                  {transcriptOpen && (
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto mt-2">{project.transcript_text}</p>
                  )}
                </Card>
              )}
            </div>
          </div>

          {/* RIGHT: guided 3-step flow */}
          <div className="lg:col-span-3 space-y-4">
            {/* STEP 1 — pick the moment */}
            <Card className="p-4">
              <StepHeader n={1} title="Pick the moment" hint="what part of the video becomes the clip" />
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs text-gray-500">Let the AI read the transcript and propose the strongest moments — or pick a range yourself.</p>
                <button onClick={() => suggestClips(project)} disabled={suggesting || !ready}
                  className={suggestions.length ? btn.ghost : btn.accent}>
                  {suggesting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {suggesting ? 'Reading…' : suggestions.length ? 'Pick again' : 'Find best clips'}
                </button>
              </div>

              {suggestions.map((s, i) => {
                const active = form.start === String(s.start_sec) && form.end === String(s.end_sec);
                return (
                  <div key={i} className={`flex items-start gap-3 border rounded-lg p-2.5 mt-2 transition ${active ? 'border-indigo-500 ring-2 ring-indigo-100 bg-indigo-50/40' : 'border-gray-100'}`}>
                    <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-semibold flex items-center justify-center">
                      {Number(s.score).toFixed(0)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 leading-snug">{s.title}</p>
                      <p className="text-[11px] text-gray-400">{fmtTime(s.start_sec)}–{fmtTime(s.end_sec)} · {Math.round(s.end_sec - s.start_sec)}s</p>
                      {s.reason && <p className="text-xs text-gray-500 mt-1 leading-snug">{s.reason}</p>}
                    </div>
                    <button onClick={() => useSuggestion(s)}
                      className={`flex-shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg transition ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                      {active ? <span className="inline-flex items-center gap-1"><Check size={12} /> Selected</span> : 'Use'}
                    </button>
                  </div>
                );
              })}

              <button onClick={() => setManualOpen((v) => !v)} className="mt-3 text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1">
                {manualOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Pick the range manually
              </button>
              {manualOpen && (
                <div className="mt-2">
                  <div className="grid grid-cols-2 gap-3">
                    {['start', 'end'].map((field) => (
                      <div key={field}>
                        <label className="text-xs text-gray-500 block mb-1">{field === 'start' ? 'Start (seconds)' : 'End (seconds)'}</label>
                        <div className="flex gap-1.5">
                          <input
                            type="number" min="0" step="0.1"
                            value={form[field]}
                            placeholder={field === 'start' ? '0' : project.duration_sec ? String(Math.floor(project.duration_sec)) : 'end'}
                            onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                          />
                          <button onClick={() => setFromPlayer(field)} className="text-[11px] px-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 whitespace-nowrap" title="Use the player's current position">
                            <Play size={11} className="inline -mt-0.5" /> here
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">Pause the player where you want a cut and press “here”. Empty = whole video (up to 3 minutes).</p>
                </div>
              )}

              <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${hasSelection ? 'bg-indigo-50 text-indigo-800' : 'bg-gray-50 text-gray-400'}`}>
                {hasSelection
                  ? <>Selected: <strong>{fmtTime(selStart)}–{fmtTime(selEnd)}</strong> ({Math.round(selDur)}s)</>
                  : 'Nothing selected yet — the whole video will be used.'}
              </div>
            </Card>

            {/* STEP 2 — choose the look */}
            <Card className="p-4">
              <StepHeader n={2} title="Choose the look" />
              <label className="text-xs text-gray-500 block mb-1">Format</label>
              <div className="flex gap-2 mb-3">
                {Object.entries(ASPECT_META).map(([key, a]) => (
                  <button key={key} onClick={() => setForm((f) => ({ ...f, aspect: key }))}
                    className={`flex-1 rounded-lg border px-2 py-2 text-center transition ${form.aspect === key ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="text-sm font-medium text-gray-800">{a.name}</div>
                    <div className="text-[10px] text-gray-400">{a.desc}</div>
                  </button>
                ))}
              </div>

              {form.aspect !== '16:9' && (
                <>
                  <label className="text-xs text-gray-500 block mb-1">Framing</label>
                  <div className="flex gap-2 mb-1">
                    {[['auto', 'Auto — track speaker'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([key, name]) => (
                      <button key={key} onClick={() => setForm((f) => ({ ...f, framing: key }))}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-sm transition ${form.framing === key ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                        {name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mb-3">
                    {form.framing === 'auto'
                      ? 'The camera follows the speaker automatically (falls back to center if no face is found).'
                      : 'Fixed crop — use when Auto misses or there is no face on screen.'}
                  </p>
                </>
              )}

              <label className="text-xs text-gray-500 block mb-1">Caption style</label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {Object.entries(STYLE_META).map(([key, s]) => (
                  <button key={key} onClick={() => setForm((f) => ({ ...f, style: key }))}
                    className={`rounded-lg border p-1.5 text-left transition ${form.style === key ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'}`}>
                    <StylePreview styleKey={key} />
                    <div className="text-xs font-medium text-gray-800 mt-1.5">{s.name}</div>
                    <div className="text-[10px] text-gray-400 leading-tight">{s.desc}</div>
                  </button>
                ))}
              </div>

              <label className="text-xs text-gray-500 block mb-1">Extras</label>
              <div className="space-y-1.5">
                {[
                  ['silences', 'Remove silences & filler words', 'auto-cuts pauses, dead air, and "um/uh/eh"'],
                  ['emphasis', 'Highlight key words', 'AI paints the power words gold and bigger'],
                  ['zoom', 'Subtle zoom', 'slow push-in for extra motion'],
                  ['hook', 'Title overlay', 'shows the clip name at the top for the first seconds'],
                  ['music', 'Background music', 'a track from your music library, ducked under speech'],
                  ['broll', 'AI B-roll', 'cuts to matching stock footage while the voice continues'],
                ].map(([key, name, desc]) => (
                  <label key={key} className="flex items-start gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                      className="mt-0.5 accent-indigo-600" />
                    <span className="text-sm text-gray-700">{name} <span className="text-[11px] text-gray-400">— {desc}</span></span>
                  </label>
                ))}
              </div>
            </Card>

            {/* STEP 3 — name + generate */}
            <Card className="p-4">
              <StepHeader n={3} title="Name it and generate" />
              <label className="text-xs text-gray-500 block mb-1">
                Clip name {form.hook ? <span className="text-indigo-500">(shown as the title overlay)</span> : '(optional — used for the file name)'}
              </label>
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Testimonial hook v1"
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <p className="text-[11px] text-gray-400 mb-3">
                {ASPECT_META[form.aspect].name} · {STYLE_META[form.style].name} · {fmtTime(selStart)}–{fmtTime(selEnd)} ({Math.round(selDur)}s)
                {extrasOn.length ? ` · ${extrasOn.join(' + ')}` : ''}
              </p>
              <button onClick={() => renderClip(project)} disabled={rendering || !ready} className={`${btn.accent} w-full`}>
                {rendering ? <Loader2 size={15} className="animate-spin" /> : <Captions size={15} />}
                {ready ? 'Generate captioned clip' : 'Waiting for transcript…'}
              </button>
            </Card>
          </div>
        </div>

        {/* YOUR CLIPS — full-width gallery */}
        <div className="mt-8">
          <SectionLabel className="mb-3">Your clips {project.clips?.length ? `(${project.clips.length})` : ''}</SectionLabel>
          {(project.clips || []).length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-10 border border-dashed border-gray-200 rounded-xl">
              No clips yet. {ready ? 'Start with “Find best clips” above.' : 'They will appear here once the video is ready.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {project.clips.map((c) => {
                const cs = CLIP_STATUS[c.status] || CLIP_STATUS.rendering;
                return (
                  <Card key={c.id} className="p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge tone={cs.tone}>{c.status === 'rendering' && <Loader2 size={11} className="animate-spin mr-1" />}{cs.label}</Badge>
                        <span className="text-sm text-gray-800 truncate">{c.label || `${STYLE_META[c.style]?.name || c.style} · ${c.aspect}`}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {c.status === 'ready' && (
                          <>
                            <button onClick={() => sendToCreative(c)} disabled={sendingId === c.id} className={btn.iconGhost} title="Send to Creative Studio (ads/social approval queue)">
                              {sendingId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                            </button>
                            <button onClick={() => downloadClip(c)} className={btn.iconGhost} title="Download MP4"><Download size={15} /></button>
                          </>
                        )}
                        <button onClick={() => removeClip(c)} className={btn.iconGhost} title="Delete clip"><Trash2 size={15} /></button>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-400 mb-2">
                      {fmtTime(c.start_sec)}–{fmtTime(c.end_sec)} · {ASPECT_META[c.aspect]?.name || c.aspect} · {STYLE_META[c.style]?.name || c.style}
                      {c.render_seconds ? ` · ${c.render_seconds}s render` : ''}
                    </div>
                    {c.status === 'rendering' && (
                      <div className="rounded-lg bg-gray-50 text-gray-400 text-xs flex items-center justify-center h-40">
                        <Loader2 size={14} className="animate-spin mr-1.5" /> Rendering — usually under a minute for short clips
                      </div>
                    )}
                    {c.status === 'ready' && c.video_url && (
                      <video src={c.video_url} controls className="w-full rounded-lg bg-black" style={{ maxHeight: 320 }} />
                    )}
                    {c.status === 'failed' && <div className="text-xs text-red-600">{c.error_message}</div>}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------- LIST VIEW ----------------
  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Clapperboard size={22} className="text-gray-700" /> Clip Studio
          </h2>
          <p className="text-sm text-gray-500 mt-1">Upload a video, get an automatic transcript, and burn animated captions ready for Reels, TikTok, and ads.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => musicRef.current?.click()} disabled={musicBusy} className={btn.ghost}
            title="Upload MP3s here to use with the Background music extra">
            {musicBusy ? <Loader2 size={15} className="animate-spin" /> : <Music size={15} />} Music library
          </button>
          <button onClick={() => load()} disabled={loading} className={btn.ghost}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* upload zone */}
      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={musicRef} type="file" accept=".mp3,.m4a,.aac,audio/*" className="hidden" onChange={(e) => { onMusicFile(e.target.files?.[0]); e.target.value = ''; }} />
      {upload ? (
        <Card className="p-5 mb-6">
          <div className="flex items-center gap-2 text-sm text-gray-700 mb-2">
            <Loader2 size={15} className="animate-spin text-indigo-500" /> {upload.phase} <span className="text-gray-400 truncate">{upload.name}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${upload.pct}%` }} />
          </div>
        </Card>
      ) : (
        <button onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 rounded-xl p-8 text-center transition mb-6 group">
          <UploadCloud size={28} className="mx-auto text-gray-300 group-hover:text-indigo-400 mb-2" />
          <div className="text-sm font-medium text-gray-700">Upload a video</div>
          <div className="text-xs text-gray-400 mt-1">MP4 / MOV up to 1GB — transcription starts automatically</div>
        </button>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : projects.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          No videos yet. Upload one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((p) => {
            const ps = PROJECT_STATUS[p.status] || PROJECT_STATUS.uploaded;
            const readyClips = (p.clips || []).filter((c) => c.status === 'ready').length;
            return (
              <button key={p.id} onClick={() => setSelectedId(p.id)}
                className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition group">
                <div className="flex items-center justify-between mb-2">
                  <Badge tone={ps.tone}>
                    {['preparing', 'transcribing'].includes(p.status) && <Loader2 size={11} className="animate-spin mr-1" />}
                    {ps.label}
                  </Badge>
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500" />
                </div>
                <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2 break-all">{p.title}</p>
                <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-400">
                  <span>{fmtTime(p.duration_sec)}</span>
                  <span>{(p.clips || []).length} clip{(p.clips || []).length === 1 ? '' : 's'}{readyClips ? ` (${readyClips} ready)` : ''}</span>
                  <span>{new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
