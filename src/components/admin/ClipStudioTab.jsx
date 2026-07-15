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
  Captions, Clock, Sparkles, Check, Send, Music, Zap, Copy, Pencil, X,
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
    framing: 'auto', silences: false, zoom: false, hook: false, emphasis: true, music: false, broll: false, fx: true, clean: false, outro: false,
    musicTrack: '', // '' = random pick from the library
  });
  const [rendering, setRendering] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [songQ, setSongQ] = useState('');
  const [songResults, setSongResults] = useState(null);
  const [songBusy, setSongBusy] = useState(false);
  const [autoClip, setAutoClip] = useState(true);       // auto-clip new uploads
  const [retryingClipId, setRetryingClipId] = useState(null);
  const [musicPanel, setMusicPanel] = useState(false);  // music library panel
  const [tracks, setTracks] = useState(null);
  const [editWords, setEditWords] = useState(null);     // caption editor: full word list
  const [wordEdits, setWordEdits] = useState({});       // {index: corrected word}
  const [editingIdx, setEditingIdx] = useState(null);
  const [savingWords, setSavingWords] = useState(false);
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

  // Poll every 5s while anything is in flight (prepare / transcribe / render / auto-clip).
  const busy = projects.some((p) =>
    ['preparing', 'transcribing'].includes(p.status) ||
    (p.auto_pilot && ['pending', 'running'].includes(p.auto_pilot_state)) ||
    (p.clips || []).some((c) => c.status === 'rendering'));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [busy, load]);

  // ---- upload flow: create_project -> XHR PUT (progress) -> ingest ----
  const onFile = async (file) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024 * 1024) { showToast?.('Max upload size is 3GB'); return; }
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
    setUpload({ name: file.name, pct: 0, phase: 'Preparing upload…' });
    try {
      const { project_id, signed_url, path } = await call({ action: 'create_project', title: file.name, ext, auto_pilot: autoClip });
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
      showToast?.(autoClip
        ? 'Video uploaded — transcribing, then auto-clipping the best moments'
        : 'Video uploaded — transcribing now');
      load(true);
    } catch (e) {
      setUpload(null);
      showToast?.(`Upload error: ${e.message}`);
    }
  };

  // One click: make sure we have AI picks, then render every pick with the
  // current step-2 look. Silences+fillers, key words, and the hook title are
  // forced on — that's the whole point of auto-edit.
  const autoEdit = async (project) => {
    setAutoBusy(true);
    try {
      let sugg = project.ai_suggestions?.suggestions || [];
      if (!sugg.length) {
        const r = await call({ action: 'suggest_clips', project_id: project.id });
        sugg = r.ai_suggestions?.suggestions || [];
      }
      if (!sugg.length) throw new Error('No strong moments found in this video');
      let n = 0;
      for (const s of sugg) {
        await call({
          action: 'render_clip', project_id: project.id,
          start_sec: s.start_sec, end_sec: s.end_sec,
          aspect: form.aspect, style: form.style, label: s.title,
          options: {
            framing: form.framing, remove_silences: true, zoom: form.zoom,
            hook_title: true, emphasis: true, music: form.music, music_track: form.musicTrack || null,
            broll: form.broll, transitions: form.fx, clean_audio: form.clean, outro: form.outro,
          },
        });
        n++;
      }
      showToast?.(`Auto-edit: ${n} clips rendering — they'll appear below as they finish`);
      load(true);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setAutoBusy(false);
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
        options: { framing: form.framing, remove_silences: form.silences, zoom: form.zoom, hook_title: form.hook, emphasis: form.emphasis, music: form.music, music_track: form.musicTrack || null, broll: form.broll, transitions: form.fx, clean_audio: form.clean, outro: form.outro },
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

  const searchSongs = async () => {
    setSongBusy(true);
    try {
      const r = await call({ action: 'song_search', q: songQ });
      setSongResults(r.songs || []);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setSongBusy(false);
    }
  };

  const makeTeaser = async (song) => {
    setSongBusy(true);
    try {
      const r = await call({ action: 'create_teaser_project', song_id: song.id });
      setSelectedId(r.project_id);
      setSongResults(null);
      setSongQ('');
      showToast?.("Getting the song's word timing — usually a few seconds");
      load(true);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setSongBusy(false);
    }
  };

  const addToPool = async (project) => {
    try {
      await call({ action: 'pool_add', song_id: project.meta?.song_id });
      showToast?.('Added to the daily teaser pool');
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
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
      if (musicPanel) refreshTracks();
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setMusicBusy(false);
    }
  };

  const retryClip = async (clip) => {
    setRetryingClipId(clip.id);
    try {
      await call({ action: 'retry_clip', clip_id: clip.id });
      showToast?.('Retrying the render');
      load(true);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setRetryingClipId(null);
    }
  };

  // Load a finished clip's exact settings into the 3-step form so one tweak
  // (new style, new format) is a two-click re-render.
  const duplicateClip = (clip) => {
    const o = clip.options || {};
    setForm({
      start: String(clip.start_sec), end: String(clip.end_sec),
      aspect: clip.aspect, style: clip.style, label: clip.label || '',
      framing: o.framing || 'auto', silences: !!o.remove_silences, zoom: !!o.zoom,
      hook: !!o.hook_title, emphasis: o.emphasis !== false, music: !!o.music,
      broll: !!o.broll, fx: o.transitions !== false, clean: !!o.clean_audio, outro: !!o.outro,
      musicTrack: o.music_track || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast?.('Clip settings loaded — change anything and press Generate');
  };

  // ---- caption editor: click a word, fix it, save ----
  const openCaptionEditor = async () => {
    try {
      const r = await call({ action: 'get_words', project_id: selectedId });
      setEditWords(r.words || []);
      setWordEdits({});
      setEditingIdx(null);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    }
  };

  const saveCaptionEdits = async () => {
    const edits = Object.entries(wordEdits).map(([i, word]) => ({ i: Number(i), word }));
    if (!edits.length) { setEditWords(null); return; }
    setSavingWords(true);
    try {
      await call({ action: 'update_transcript', project_id: selectedId, edits });
      setEditWords(null);
      setWordEdits({});
      showToast?.(`Fixed ${edits.length} word${edits.length === 1 ? '' : 's'} — every clip you generate from now on uses the correction`);
      load(true);
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
    } finally {
      setSavingWords(false);
    }
  };

  // ---- music library panel ----
  const refreshTracks = async () => {
    try { const r = await call({ action: 'music_list' }); setTracks(r.tracks || []); }
    catch (e) { showToast?.(`Error: ${e.message}`); }
  };

  const toggleMusicPanel = () => {
    setMusicPanel((v) => !v);
    if (!musicPanel) refreshTracks();
  };

  const deleteTrack = async (name) => {
    if (!window.confirm(`Remove "${name}" from the music library?`)) return;
    try { await call({ action: 'music_delete', name }); refreshTracks(); }
    catch (e) { showToast?.(`Error: ${e.message}`); }
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
    const isTeaser = project.kind === 'song_teaser';
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
          <div className="flex items-center gap-1">
            {isTeaser && project.meta?.song_id && (
              <button onClick={() => addToPool(project)} className={btn.ghost} title="Clear this song for the daily teaser factory (rights-checked songs only)">
                <Music size={14} /> Add to daily pool
              </button>
            )}
            <button onClick={() => removeProject(project)} className={btn.iconGhost} title="Delete video and all its clips">
              <Trash2 size={16} />
            </button>
          </div>
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
            <p className="text-xs text-gray-400 mt-2">
              Getting your video ready — this page updates by itself. Longer videos take a few minutes.
              {project.auto_pilot && ' Auto-clip will start as soon as the transcript is done.'}
            </p>
          </Card>
        )}

        {/* Auto-clip status */}
        {project.auto_pilot && ready && ['pending', 'running'].includes(project.auto_pilot_state) && (
          <Card className="p-4 mb-4 border-indigo-200 bg-indigo-50/40">
            <div className="flex items-center gap-2 text-sm text-indigo-800">
              <Zap size={15} className="text-indigo-500" />
              <Loader2 size={14} className="animate-spin text-indigo-500" />
              Auto-clip is reading the whole video and rendering every strong, complete moment — clips appear in “Your clips” below as they finish.
            </div>
          </Card>
        )}
        {project.auto_pilot_state === 'error' && (
          <div className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle size={15} className="flex-shrink-0" />
            Auto-clip could not finish: {project.meta?.auto_pilot_error || 'unknown error'}. You can still make clips with the steps below.
          </div>
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
                  <div className="flex items-center justify-between">
                    <button onClick={() => setTranscriptOpen((v) => !v)} className="flex-1 flex items-center justify-between">
                      <SectionLabel>Transcript</SectionLabel>
                      {transcriptOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </button>
                    {ready && !editWords && (
                      <button onClick={openCaptionEditor} className="ml-3 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 flex-shrink-0"
                        title="Fix misheard words (names!) before rendering — click any word to correct it">
                        <Pencil size={12} /> Fix captions
                      </button>
                    )}
                  </div>

                  {/* caption editor: every word is clickable */}
                  {editWords && (
                    <div className="mt-3">
                      <p className="text-[11px] text-gray-500 mb-2">
                        Click any word the AI misheard (names especially) and type the correction. Timing is kept, so captions stay in sync.
                      </p>
                      <div className="max-h-72 overflow-y-auto leading-7 text-sm border border-gray-100 rounded-lg p-2.5">
                        {editWords.map((w, i) => (
                          editingIdx === i ? (
                            <input
                              key={i} autoFocus defaultValue={wordEdits[i] ?? w.word.trim()}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                setWordEdits((prev) => {
                                  const next = { ...prev };
                                  if (v && v !== w.word.trim()) next[i] = v; else delete next[i];
                                  return next;
                                });
                                setEditingIdx(null);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); }}
                              className="inline-block w-28 border border-indigo-300 rounded px-1 py-0 text-sm mx-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            />
                          ) : (
                            <span key={i} onClick={() => setEditingIdx(i)}
                              className={`cursor-pointer rounded px-0.5 ${wordEdits[i] ? 'bg-amber-100 text-amber-900 font-medium' : 'hover:bg-indigo-50'}`}
                              title={wordEdits[i] ? `was: ${w.word.trim()}` : 'Click to correct'}>
                              {(wordEdits[i] ?? w.word.trim()) + ' '}
                            </span>
                          )
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={saveCaptionEdits} disabled={savingWords || !Object.keys(wordEdits).length}
                          className={`${btn.accent} text-xs`}>
                          {savingWords ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          Save {Object.keys(wordEdits).length ? `${Object.keys(wordEdits).length} fix${Object.keys(wordEdits).length === 1 ? '' : 'es'}` : 'corrections'}
                        </button>
                        <button onClick={() => { setEditWords(null); setWordEdits({}); setEditingIdx(null); }} className={`${btn.ghost} text-xs`}>
                          <X size={13} /> Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {transcriptOpen && !editWords && (
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
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => suggestClips(project)} disabled={suggesting || autoBusy || !ready}
                    className={suggestions.length ? btn.ghost : btn.accent}>
                    {suggesting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {suggesting ? 'Reading…' : suggestions.length ? 'Pick again' : 'Find best clips'}
                  </button>
                  <button onClick={() => autoEdit(project)} disabled={autoBusy || suggesting || !ready}
                    className={btn.primary}
                    title="One click: find the best moments and render ALL of them with the look chosen in step 2">
                    {autoBusy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    {autoBusy ? 'Auto-editing…' : 'Auto-edit'}
                  </button>
                </div>
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

              {form.aspect !== '16:9' && !isTeaser && (
                <>
                  <label className="text-xs text-gray-500 block mb-1">Framing</label>
                  <div className="flex gap-2 mb-1">
                    {[['auto', 'Auto'], ['wide', 'Wide — everyone'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([key, name]) => (
                      <button key={key} onClick={() => setForm((f) => ({ ...f, framing: key }))}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-sm transition ${form.framing === key ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                        {name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mb-3">
                    {form.framing === 'auto'
                      ? 'One person: the camera follows them. Several people spread out: switches to the Wide layout so nobody is cut off.'
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

              {isTeaser ? (
                <p className="text-[11px] text-gray-400">Teasers use the song's cover art with a slow cinematic push-in, karaoke captions, and a brand end-card — the extras for spoken video don't apply.</p>
              ) : (
                <>
                  <label className="text-xs text-gray-500 block mb-1">Extras</label>
                  <div className="space-y-1.5">
                    {[
                      ['silences', 'Remove silences & filler words', 'auto-cuts pauses, dead air, and "um/uh/eh"'],
                      ['emphasis', 'Highlight key words', 'AI paints the power words gold and bigger'],
                      ['zoom', 'Subtle zoom', 'slow push-in for extra motion'],
                      ['hook', 'Title overlay', 'shows the clip name at the top for the first seconds'],
                      ['music', 'Background music', 'a track from your music library, ducked under speech'],
                      ['broll', 'AI B-roll', 'cuts to matching stock footage while the voice continues'],
                      ['fx', 'Transitions & effects', 'soft fades on cuts and b-roll'],
                      ['clean', 'Clean audio', 'reduce background noise in the voice'],
                      ['outro', 'Brand outro', 'adds a 3s end-card: RQC logo + regalosquecantan.com'],
                    ].map(([key, name, desc]) => (
                      <React.Fragment key={key}>
                        <label className="flex items-start gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={form[key]}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setForm((f) => ({ ...f, [key]: checked }));
                              if (key === 'music' && checked && tracks === null) refreshTracks();
                            }}
                            className="mt-0.5 accent-indigo-600" />
                          <span className="text-sm text-gray-700">{name} <span className="text-[11px] text-gray-400">— {desc}</span></span>
                        </label>
                        {key === 'music' && form.music && (
                          <div className="ml-6 mb-1">
                            <select
                              value={form.musicTrack}
                              onChange={(e) => setForm((f) => ({ ...f, musicTrack: e.target.value }))}
                              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200">
                              <option value="">Surprise me — random track</option>
                              {(tracks || []).map((name) => (
                                <option key={name} value={name}>
                                  {name.replace(/^instrumental-/, '').replace(/\.(mp3|m4a|aac)$/i, '')}
                                </option>
                              ))}
                            </select>
                            {tracks === null && <p className="text-[11px] text-gray-400 mt-1">Loading your music library…</p>}
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </>
              )}
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
                        {c.status !== 'rendering' && (
                          <button onClick={() => duplicateClip(c)} className={btn.iconGhost} title="Duplicate — load these settings into the form to re-render with tweaks">
                            <Copy size={15} />
                          </button>
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
                    {c.status === 'failed' && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-red-600 flex-1">{c.error_message}</span>
                        <button onClick={() => retryClip(c)} disabled={retryingClipId === c.id}
                          className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition">
                          {retryingClipId === c.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Retry
                        </button>
                      </div>
                    )}
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
          <button onClick={toggleMusicPanel} className={btn.ghost}
            title="Manage the MP3s used by the Background music extra">
            <Music size={15} /> Music library {musicPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button onClick={() => load()} disabled={loading} className={btn.ghost}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* upload zone */}
      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={musicRef} type="file" accept=".mp3,.m4a,.aac,audio/*" className="hidden" onChange={(e) => { onMusicFile(e.target.files?.[0]); e.target.value = ''; }} />

      {/* music library panel */}
      {musicPanel && (
        <Card className="p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <SectionLabel>Music library</SectionLabel>
            <button onClick={() => musicRef.current?.click()} disabled={musicBusy} className={`${btn.ghost} text-xs`}>
              {musicBusy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} Upload MP3
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">These tracks power the “Background music” extra — one is picked per clip and ducked under the speech.</p>
          {tracks === null ? (
            <div className="text-xs text-gray-400 flex items-center gap-1.5 py-2"><Loader2 size={13} className="animate-spin" /> Loading…</div>
          ) : tracks.length === 0 ? (
            <div className="text-xs text-gray-400 py-2">No tracks yet — upload an MP3 to get started.</div>
          ) : (
            <div className="space-y-1">
              {tracks.map((name) => (
                <div key={name} className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5">
                  <span className="text-sm text-gray-700 truncate flex items-center gap-2"><Music size={13} className="text-gray-300 flex-shrink-0" /> {name}</span>
                  <button onClick={() => deleteTrack(name)} className={btn.iconGhost} title="Remove from library"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
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
        <div className="mb-6">
          <button onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 rounded-xl p-8 text-center transition group">
            <UploadCloud size={28} className="mx-auto text-gray-300 group-hover:text-indigo-400 mb-2" />
            <div className="text-sm font-medium text-gray-700">Upload a video</div>
            <div className="text-xs text-gray-400 mt-1">MP4 / MOV up to 3GB — transcription starts automatically</div>
          </button>
          <label className="flex items-start gap-2 cursor-pointer select-none mt-2 px-1">
            <input type="checkbox" checked={autoClip} onChange={(e) => setAutoClip(e.target.checked)} className="mt-0.5 accent-indigo-600" />
            <span className="text-sm text-gray-700">
              <Zap size={13} className="inline -mt-0.5 text-indigo-500" /> Auto-clip
              <span className="text-[11px] text-gray-400"> — after upload, the AI reads the whole video and renders every strong, complete moment on its own (nothing cut off mid-thought)</span>
            </span>
          </label>
        </div>
      )}

      {/* Song teasers: turn a catalog song into a karaoke-caption teaser ad. */}
      <Card className="p-4 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Music size={16} className="text-indigo-500" />
          <span className="text-sm font-semibold text-gray-900">Song teaser</span>
          <span className="text-[11px] text-gray-400">— turn one of your songs into a video ad (cover art + lyrics lighting up)</span>
        </div>
        <p className="text-[11px] text-amber-600 mb-2">Only publish teasers from songs cleared for marketing (samples, demos, or customer-approved).</p>
        <div className="flex gap-2">
          <input
            value={songQ}
            onChange={(e) => setSongQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchSongs()}
            placeholder="Search recent songs by recipient name (empty = latest)"
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button onClick={searchSongs} disabled={songBusy} className={btn.accent}>
            {songBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Search
          </button>
        </div>
        {songResults && (
          <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
            {songResults.length === 0 && <p className="text-xs text-gray-400">No songs found.</p>}
            {songResults.map((s) => (
              <div key={s.id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-800">{s.recipient_name || 'Sin nombre'}</span>
                  <span className="text-[11px] text-gray-400 ml-2">{s.genre || ''}{s.occasion ? ` · ${s.occasion}` : ''} · {new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
                <button onClick={() => makeTeaser(s)} disabled={songBusy}
                  className="flex-shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition">
                  Make teaser
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

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
