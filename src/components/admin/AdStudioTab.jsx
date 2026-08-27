// src/components/admin/AdStudioTab.jsx
// Ad Studio — owner-driven ad-video generator on Atlas Cloud (Seedance 2.5),
// the productized "Podcast & Street" recipe (2026-08-19 batch). Describe the
// ad in plain language → AI writes the Seedance dialogue prompt (editable) →
// generate 1-3 takes with native Spanish spoken audio → review, download, or
// send to the Creative Studio approval queue. Talks only to the ad-studio
// edge function (own table + own bucket). $0.134/sec on Atlas (~$4 per 30s).
//
// Design matches CharacterStudioTab: dark-native glass surfaces, indigo→violet
// accents, EXPLICIT text colors on every input (the shell is text-white).
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clapperboard, RefreshCw, Loader2, Trash2, Sparkles, Film, AlertTriangle,
  Download, Send, Mic2, MapPin, Heart, Palette, Volume2, VolumeX, Wand2,
} from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ad-studio`;

const FORMATS = [
  { id: 'podcast', name: 'Podcast', desc: 'Studio two-shot, she carries the message', icon: Mic2, grad: 'from-indigo-500 to-violet-600' },
  { id: 'street', name: 'Street', desc: 'Street interview, market behind', icon: MapPin, grad: 'from-amber-400 to-orange-600' },
  { id: 'reaction', name: 'Reaction', desc: 'Family plays the song, camera holds the tears', icon: Heart, grad: 'from-rose-500 to-pink-600' },
  { id: 'custom', name: 'Custom', desc: 'Your brief drives the whole scene', icon: Palette, grad: 'from-emerald-400 to-teal-600' },
];

const DURATIONS = [10, 15, 20, 25, 30];
const ASPECTS = ['9:16', '1:1', '16:9'];
const COST_PER_SEC = 0.134;

// Proven briefs from the 08-19 batch — one tap fills the brief box (still
// editable). Real A/B pairs: price named vs not, studio vs street.
const BRIEF_PRESETS = [
  { name: 'Awareness + price', b: 'Most people still don\'t know this exists. She explains the 4 steps (tell the story, hear the full song BEFORE paying, ready in minutes, from $29.99 — spoken, never on screen) and closes warm.' },
  { name: 'Awareness, no price', b: 'Most people still don\'t know this exists. She explains the 4 steps and how you hear the full song before paying — do NOT mention the price. Closes warm.' },
  { name: 'Ella les dice', b: 'She tells the men watching what women actually want as a gift: not flowers, not chocolates — a song with her name and her story. Ends with "Y ésta no se muere." and speaks the site name.' },
  { name: 'Testimonial', b: 'She tells the host about the song she gave her mom — "la canción que más ha llorado mi mamá" — how easy it was and how her mom reacted.' },
];

// ---------------------------------------------------------------------------
// Shared dark-theme atoms (explicit colors everywhere — the shell is text-white)
// ---------------------------------------------------------------------------
const field = 'w-full bg-white/[0.06] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20 transition';
const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 shadow-lg shadow-indigo-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all';
const btnGhost = 'inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-sm font-medium rounded-xl text-gray-300 bg-white/[0.06] border border-white/10 hover:bg-white/10 hover:text-white disabled:opacity-40 transition-all';
const panel = 'bg-white/[0.04] border border-white/10 rounded-2xl';

function Chip({ tone = 'gray', children, className = '' }) {
  const tones = {
    gray: 'bg-white/10 text-gray-300',
    indigo: 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/20',
    amber: 'bg-amber-500/20 text-amber-300 border border-amber-400/20',
    green: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/20',
    red: 'bg-red-500/20 text-red-300 border border-red-400/20',
  };
  return <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${tones[tone]} ${className}`}>{children}</span>;
}

function Label({ children }) {
  return <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">{children}</label>;
}

function Shimmer() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] via-white/[0.08] to-white/[0.03] animate-pulse" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-gray-400">
        <span className="relative flex h-9 w-9 items-center justify-center">
          <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500/20 animate-ping" />
          <Loader2 size={20} className="animate-spin text-indigo-300 relative" />
        </span>
        <span className="text-xs font-medium">Rendering… can take several minutes</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function AdStudioTab({ accessToken, showToast }) {
  const [generations, setGenerations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const pollRef = useRef(null);

  // Composer state
  const [format, setFormat] = useState('podcast');
  const [brief, setBrief] = useState('');
  const [prompt, setPrompt] = useState('');
  const [label, setLabel] = useState('');
  const [duration, setDuration] = useState(30);
  const [aspect, setAspect] = useState('9:16');
  // 720p is pinned: Atlas emits H.264 at 720p but 10-bit HEVC at 1080p, and
  // HEVC plays as black video + audio in Chrome/Windows (2026-08-26 bug).
  const [audio, setAudio] = useState(true);
  const [finish, setFinish] = useState(true);
  const [count, setCount] = useState(1);

  const call = useCallback(async (action, payload = {}) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action, ...payload }),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.success) throw new Error(j.error || `Request failed (${res.status})`);
    return j;
  }, [accessToken]);

  const refresh = useCallback(async (silent = false) => {
    if (!accessToken) return;
    if (!silent) setLoading(true);
    try {
      const j = await call('list');
      setGenerations(j.generations || []);
    } catch (e) {
      if (!silent) showToast?.(e.message, 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessToken, call, showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while anything is generating.
  const anyGenerating = generations.some((g) => g.status === 'generating');
  useEffect(() => {
    clearInterval(pollRef.current);
    if (anyGenerating) pollRef.current = setInterval(() => refresh(true), 8000);
    return () => clearInterval(pollRef.current);
  }, [anyGenerating, refresh]);

  const writeScript = async () => {
    if (!brief.trim()) { showToast?.('Describe the ad first — what should it say?', 'error'); return; }
    setWriting(true);
    try {
      const j = await call('write-script', { format, brief, duration });
      setPrompt(j.prompt || '');
      if (j.label) setLabel(j.label);
      showToast?.('Script ready — review it, then generate', 'success');
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setWriting(false);
    }
  };

  const generate = async () => {
    if (!prompt.trim()) { showToast?.('Write (or AI-write) the prompt first', 'error'); return; }
    setBusy(true);
    try {
      await call('generate', {
        prompt, format, brief, label, duration, count,
        aspectRatio: aspect, resolution: '720p',
        generateAudio: audio, finish: finish ? 'standard' : 'off',
      });
      showToast?.(`Generating ${count} take${count > 1 ? 's' : ''} — ~$${(duration * COST_PER_SEC * count).toFixed(2)}`, 'success');
      refresh(true);
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendToCreative = async (gen) => {
    setBusy(true);
    try {
      const j = await call('send-to-creative', { generationId: gen.id });
      showToast?.(j.already ? 'Already in the Creative Studio queue' : 'Sent to Creative Studio for approval', 'success');
      refresh(true);
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteGen = async (gen) => {
    if (!window.confirm('Delete this render? The video file is removed too.')) return;
    setBusy(true);
    try {
      await call('delete-generation', { generationId: gen.id });
      setGenerations((gs) => gs.filter((g) => g.id !== gen.id));
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const estCost = (duration * COST_PER_SEC * count).toFixed(2);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Clapperboard size={22} className="text-indigo-300" /> Ad Studio
          </h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Spoken-dialogue video ads on Atlas Cloud (Seedance 2.5) — ${COST_PER_SEC.toFixed(3)}/sec, ≈ $4 per 30s clip
          </p>
        </div>
        <button onClick={() => refresh()} disabled={loading} className={btnGhost}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Composer */}
      <div className={`${panel} p-5 mb-6`}>
        {/* Format */}
        <Label>Format</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          {FORMATS.map((f) => {
            const Icon = f.icon;
            const active = format === f.id;
            return (
              <button key={f.id} onClick={() => setFormat(f.id)}
                className={`text-left p-3 rounded-xl border transition ${active ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'}`}>
                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br ${f.grad} text-white mb-2`}>
                  <Icon size={16} />
                </span>
                <div className="text-sm font-semibold text-white">{f.name}</div>
                <div className="text-[11px] text-gray-400 leading-snug mt-0.5">{f.desc}</div>
              </button>
            );
          })}
        </div>

        {/* Brief + presets */}
        <Label>What should the ad say?</Label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {BRIEF_PRESETS.map((p) => (
            <button key={p.name} onClick={() => setBrief(p.b)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition">
              {p.name}
            </button>
          ))}
        </div>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={2}
          placeholder="e.g. She tells the host about the song she gave her mom, mentions you hear it before paying, closes with 'Y ésta no se muere'"
          className={field} />

        <div className="flex items-center gap-2 mt-3 mb-4">
          <button onClick={writeScript} disabled={writing || busy} className={btnPrimary}>
            {writing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {writing ? 'Writing…' : 'Write script with AI'}
          </button>
          <span className="text-[11px] text-gray-500">Dialogue in Spanish, lip-synced. On-screen text is never generated (it garbles) — URLs get burned on later.</span>
        </div>

        {/* Prompt */}
        <Label>Seedance prompt (editable)</Label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6}
          placeholder="The full scene + dialogue prompt lands here — edit anything before generating"
          className={`${field} font-mono text-[12.5px] leading-relaxed`} />

        {/* Knobs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
          <div>
            <Label>Name</Label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="internal name" className={field} />
          </div>
          <div>
            <Label>Duration</Label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={field}>
              {DURATIONS.map((d) => <option key={d} value={d} className="bg-[#0f1419]">{d}s — ${(d * COST_PER_SEC).toFixed(2)}</option>)}
            </select>
          </div>
          <div>
            <Label>Aspect</Label>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} className={field}>
              {ASPECTS.map((a) => <option key={a} value={a} className="bg-[#0f1419]">{a}</option>)}
            </select>
          </div>
          <div>
            <Label>Resolution</Label>
            <div className={`${field} text-gray-400 cursor-default`} title="1080p disabled: Atlas outputs HEVC at 1080p, which plays as black video in browsers">720p (H.264)</div>
          </div>
          <div>
            <Label>Takes</Label>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={field}>
              {[1, 2, 3].map((n) => <option key={n} value={n} className="bg-[#0f1419]">{n}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Options</Label>
            <button onClick={() => setAudio((v) => !v)}
              className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition ${audio ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200' : 'border-white/10 bg-white/[0.04] text-gray-400'}`}>
              {audio ? <Volume2 size={13} /> : <VolumeX size={13} />} Spoken audio
            </button>
            <button onClick={() => setFinish((v) => !v)}
              className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition ${finish ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200' : 'border-white/10 bg-white/[0.04] text-gray-400'}`}>
              <Sparkles size={13} /> Finish pass
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mt-5">
          <span className="text-xs text-gray-400">Estimated cost: <span className="text-white font-semibold">${estCost}</span> ({count} × {duration}s)</span>
          <button onClick={generate} disabled={busy || !prompt.trim()} className={btnPrimary}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
            Generate {count > 1 ? `${count} takes` : ''}
          </button>
        </div>
      </div>

      {/* Gallery */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : generations.length === 0 ? (
        <div className={`${panel} p-10 text-center text-gray-400 text-sm`}>
          No renders yet — write a brief above and generate your first ad.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {generations.map((g) => (
            <div key={g.id} className={`${panel} overflow-hidden flex flex-col`}>
              <div className={`relative bg-black/40 ${g.aspect_ratio === '16:9' ? 'aspect-video' : g.aspect_ratio === '1:1' ? 'aspect-square' : 'aspect-[9/16] max-h-[420px]'}`}>
                {g.status === 'generating' ? (
                  <Shimmer />
                ) : g.status === 'failed' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-red-300 p-4 text-center">
                    <AlertTriangle size={20} />
                    <span className="text-xs">{g.error || 'Generation failed'}</span>
                  </div>
                ) : (
                  <video src={g.media_url} controls preload="metadata" className="absolute inset-0 w-full h-full object-contain" />
                )}
              </div>
              <div className="p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Chip tone="indigo">{g.format}</Chip>
                  {g.duration ? <Chip>{g.duration}s</Chip> : null}
                  {g.meta?.estCostUsd ? <Chip>${Number(g.meta.estCostUsd).toFixed(2)}</Chip> : null}
                  {g.meta?.take ? <Chip tone="amber">take {g.meta.take}</Chip> : null}
                  {g.meta?.sentToCreative ? <Chip tone="green">Sent</Chip> : null}
                </div>
                <p className="text-xs text-gray-300 line-clamp-2" title={g.prompt}>
                  {g.meta?.label || g.brief || g.prompt}
                </p>
                {g.status === 'ready' && (
                  <div className="flex items-center gap-1.5">
                    <a href={g.media_url} download target="_blank" rel="noreferrer" className={`${btnGhost} !px-2.5 !py-1.5 text-xs`}>
                      <Download size={13} /> Download
                    </a>
                    <button onClick={() => sendToCreative(g)} disabled={busy || g.meta?.sentToCreative} className={`${btnGhost} !px-2.5 !py-1.5 text-xs`}>
                      <Send size={13} /> Creative Studio
                    </button>
                    <button onClick={() => deleteGen(g)} disabled={busy} className={`${btnGhost} !px-2 !py-1.5 text-xs text-red-300 hover:text-red-200 ml-auto`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
                {g.status === 'failed' && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => deleteGen(g)} disabled={busy} className={`${btnGhost} !px-2 !py-1.5 text-xs text-red-300 hover:text-red-200 ml-auto`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
