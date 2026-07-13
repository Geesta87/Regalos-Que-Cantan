// src/components/admin/ClipStudioTab.jsx
// Clip Studio (Phase 1) — upload a video, get a word-timed transcript, burn
// animated social-media captions (Submagic-style) and download the clips.
// Standalone tool: talks only to the clip-studio edge function (own tables +
// own 'clip-studio' bucket), so the whole feature can move to its own project.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clapperboard, UploadCloud, RefreshCw, Loader2, ArrowLeft, Trash2,
  Download, Play, AlertTriangle, ChevronRight, Captions, Clock,
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

export default function ClipStudioTab({ accessToken, showToast }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [upload, setUpload] = useState(null); // { name, pct, phase }
  const [form, setForm] = useState({ start: '', end: '', aspect: '9:16', style: 'boldpop', label: '' });
  const [rendering, setRendering] = useState(false);
  const fileRef = useRef(null);
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
      await call({ action: 'render_clip', project_id: project.id, start_sec: start, end_sec: end, aspect: form.aspect, style: form.style, label: form.label || null });
      showToast?.('Clip rendering — usually under a minute');
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
    const working = ['preparing', 'transcribing'].includes(project.status);
    return (
      <div className="max-w-5xl">
        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
          <ArrowLeft size={16} /> All videos
        </button>

        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 break-all">{project.title}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge tone={ps.tone}>{working && <Loader2 size={11} className="animate-spin mr-1" />}{ps.label}</Badge>
              {project.duration_sec != null && <span className="text-xs text-gray-400 flex items-center gap-1"><Clock size={12} /> {fmtTime(project.duration_sec)}</span>}
              {project.word_count > 0 && <span className="text-xs text-gray-400">{project.word_count} words</span>}
            </div>
          </div>
          <button onClick={() => removeProject(project)} className={btn.iconGhost} title="Delete video">
            <Trash2 size={16} />
          </button>
        </div>

        {project.status === 'error' && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle size={15} /> {project.error_message}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* left: player + transcript */}
          <div>
            {project.source_url && (
              <video ref={videoRef} src={project.source_url} controls className="w-full rounded-xl bg-black mb-3" />
            )}
            {working && (
              <Card className="p-4 text-sm text-gray-500 flex items-center gap-2">
                <Loader2 size={15} className="animate-spin text-indigo-500" />
                {project.status === 'preparing' ? 'Reading the video and extracting audio…' : 'Transcribing with word-level timing…'} This page updates automatically.
              </Card>
            )}
            {project.transcript_text && (
              <Card className="p-4">
                <SectionLabel className="mb-2">Transcript</SectionLabel>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">{project.transcript_text}</p>
              </Card>
            )}
          </div>

          {/* right: make a clip */}
          <div>
            <Card className="p-4 mb-4">
              <SectionLabel className="mb-3">Make a captioned clip</SectionLabel>

              <div className="grid grid-cols-2 gap-3 mb-3">
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
              <p className="text-[11px] text-gray-400 mb-3">Leave both empty to caption the whole video (up to 3 minutes). Pause the player where you want a cut and press “here”.</p>

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

              <label className="text-xs text-gray-500 block mb-1">Name (optional)</label>
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Testimonial hook v1"
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />

              <button onClick={() => renderClip(project)} disabled={rendering || project.status !== 'ready'} className={`${btn.accent} w-full`}>
                {rendering ? <Loader2 size={15} className="animate-spin" /> : <Captions size={15} />}
                {project.status === 'ready' ? 'Generate captioned clip' : 'Waiting for transcript…'}
              </button>
            </Card>

            {/* clips list */}
            {(project.clips || []).length > 0 && (
              <div className="space-y-3">
                <SectionLabel>Clips</SectionLabel>
                {project.clips.map((c) => {
                  const cs = CLIP_STATUS[c.status] || CLIP_STATUS.rendering;
                  return (
                    <Card key={c.id} className="p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge tone={cs.tone}>{c.status === 'rendering' && <Loader2 size={11} className="animate-spin mr-1" />}{cs.label}</Badge>
                          <span className="text-sm text-gray-800 truncate">{c.label || `${STYLE_META[c.style]?.name || c.style} · ${c.aspect}`}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {c.status === 'ready' && (
                            <button onClick={() => downloadClip(c)} className={btn.iconGhost} title="Download MP4"><Download size={15} /></button>
                          )}
                          <button onClick={() => removeClip(c)} className={btn.iconGhost} title="Delete clip"><Trash2 size={15} /></button>
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-400 mb-2">
                        {fmtTime(c.start_sec)}–{fmtTime(c.end_sec)} · {ASPECT_META[c.aspect]?.name || c.aspect} · {STYLE_META[c.style]?.name || c.style}
                        {c.render_seconds ? ` · rendered in ${c.render_seconds}s` : ''}
                      </div>
                      {c.status === 'ready' && c.video_url && (
                        <video src={c.video_url} controls className="w-full rounded-lg bg-black" style={{ maxHeight: 300 }} />
                      )}
                      {c.status === 'failed' && <div className="text-xs text-red-600">{c.error_message}</div>}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
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
        <button onClick={() => load()} disabled={loading} className={btn.ghost}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* upload zone */}
      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
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
