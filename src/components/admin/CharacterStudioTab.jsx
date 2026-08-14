// src/components/admin/CharacterStudioTab.jsx
// Character Studio — in-house AI influencer / brand-character builder (the
// Eromify replacement, 2026-08-13). Create a character in any style
// (photoreal / Pixar 3D / illustrated / anime / custom), pick one portrait as
// the identity anchor, then generate identity-consistent images & videos.
// Talks only to the character-studio edge function (own tables + own bucket).
//
// Design: dark-native premium look that matches the dashboard shell
// (bg-[#0f1419]) — glass surfaces, indigo→violet accents. Every input sets an
// EXPLICIT text color: the admin wrapper is `text-white`, so an unstyled input
// renders white-on-white (the 2026-08-13 invisible-text bug).
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Contact, Plus, RefreshCw, Loader2, ArrowLeft, Trash2, Check, Sparkles,
  Image as ImageIcon, Film, AlertTriangle, Pin, X, Download, Repeat,
  Camera, Palette, Wand2, Brush, PenTool, ChevronDown, Pencil, Send, Layers,
} from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/character-studio`;

const STYLES = [
  { id: 'photoreal', name: 'Photoreal', desc: 'A realistic human — photographic', icon: Camera, grad: 'from-sky-500 to-indigo-600' },
  { id: 'pixar', name: 'Pixar 3D', desc: '3D animated film character', icon: Wand2, grad: 'from-amber-400 to-orange-600' },
  { id: 'illustrated', name: 'Illustrated', desc: 'Flat editorial illustration', icon: Brush, grad: 'from-emerald-400 to-teal-600' },
  { id: 'anime', name: 'Anime', desc: 'Anime key-visual style', icon: PenTool, grad: 'from-pink-500 to-rose-600' },
  { id: 'custom', name: 'Custom', desc: 'Your description drives the style', icon: Palette, grad: 'from-violet-500 to-fuchsia-600' },
];
const STYLE_NAME = Object.fromEntries(STYLES.map((s) => [s.id, s.name]));

// Every RQC-brand visual shows authentic Mexican/Latino people (owner rule).
const RQC_AUDIENCE_LINE = 'Authentic Mexican/Latino features and styling, warm and natural';

const IMG_ASPECTS = ['3:4', '1:1', '4:5', '9:16', '16:9'];
const VID_ASPECTS = ['9:16', '1:1', '16:9'];

// Shot menu — proven scene prompts, one tap fills the prompt box (still
// editable before generating). Identity comes from the references; these only
// describe the scene, per the "prompt the scene, never her looks" rule.
const PRESETS = {
  image: [
    { name: 'Studio Session', p: 'recording vocals in a cozy home music studio, warm lamp light, headphones on, singing into a condenser microphone' },
    { name: 'Reacting to a Song', p: 'listening to a song on her phone, hand on heart, moved and smiling with happy tears in her eyes, soft living room light' },
    { name: 'Behind the Scenes', p: 'candid behind-the-scenes moment, laughing between takes, ring light and phone tripod visible in the background' },
    { name: 'Golden Hour', p: 'outdoor portrait at golden hour, warm sunset backlight, gentle breeze, joyful relaxed expression' },
    { name: 'Phone in Hand', p: 'holding her phone toward the camera showing a music player on the screen, excited expression, bright daylight interior' },
    { name: 'Día de las Madres', p: 'celebrating Día de las Madres, pastel flowers and soft decorations around her, holding a small wrapped gift, tender smile' },
    { name: 'Navidad', p: 'cozy Christmas scene, warm fairy lights and a decorated tree behind her, festive but elegant outfit, joyful expression' },
    { name: 'Cumpleaños', p: 'birthday celebration scene, confetti and a small cake with candles on the table, laughing, warm festive light' },
  ],
  video: [
    { name: 'Waves & Smiles', p: 'she smiles warmly and waves at the camera, slight breeze in her hair, natural relaxed movement' },
    { name: 'Talks to Camera', p: 'she speaks enthusiastically to the camera like a host presenting something exciting, natural hand gestures' },
    { name: 'Cinematic Push-in', p: 'slow cinematic push-in while she looks at the camera with a warm confident smile, shallow depth of field' },
  ],
};

// ---------------------------------------------------------------------------
// Shared dark-theme atoms (explicit colors everywhere — the shell is text-white)
// ---------------------------------------------------------------------------
const field = 'w-full bg-white/[0.06] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20 transition';
const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 shadow-lg shadow-indigo-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all';
const btnGhost = 'inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-sm font-medium rounded-xl text-gray-300 bg-white/[0.06] border border-white/10 hover:bg-white/10 hover:text-white disabled:opacity-40 transition-all';
const btnIcon = 'inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-300 bg-black/50 backdrop-blur-sm hover:bg-black/70 hover:text-white transition-all';
const panel = 'bg-white/[0.04] border border-white/10 rounded-2xl';

function Chip({ tone = 'gray', children, className = '' }) {
  const tones = {
    gray: 'bg-white/10 text-gray-300',
    indigo: 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/20',
    amber: 'bg-amber-500/20 text-amber-300 border border-amber-400/20',
    green: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/20',
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
        <span className="text-xs font-medium">Rendering…</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function CharacterStudioTab({ accessToken, showToast }) {
  const [characters, setCharacters] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const pollRef = useRef(null);

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

  const refresh = useCallback(async (characterId = null, silent = false) => {
    if (!accessToken) return;
    if (!silent) setLoading(true);
    try {
      const j = await call('list', characterId ? { characterId } : {});
      setCharacters(j.characters);
      if (characterId) setGenerations(j.generations);
    } catch (e) {
      if (!silent) showToast?.(e.message, 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessToken, call, showToast]);

  useEffect(() => { refresh(selectedId); }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while anything renders — the list's finalize pass does the real work.
  const hasPending = generations.some((g) => g.status === 'generating');
  useEffect(() => {
    clearInterval(pollRef.current);
    if (selectedId && hasPending) {
      pollRef.current = setInterval(() => refresh(selectedId, true), 6000);
    }
    return () => clearInterval(pollRef.current);
  }, [selectedId, hasPending, refresh]);

  const openCharacter = async (id) => { setSelectedId(id); setGenerations([]); await refresh(id); };
  const selected = characters.find((c) => c.id === selectedId) || null;

  const act = async (action, payload, okMsg) => {
    setBusy(true);
    try {
      await call(action, payload);
      if (okMsg) showToast?.(okMsg, 'success');
      await refresh(selectedId, true);
    } catch (e) { showToast?.(e.message, 'error'); }
    finally { setBusy(false); }
  };

  if (loading && !characters.length) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-gray-400 gap-3">
        <span className="relative flex h-12 w-12 items-center justify-center">
          <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500/20 animate-ping" />
          <Contact size={24} className="text-indigo-300 relative" />
        </span>
        Loading Character Studio…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!selected ? (
        <ListView
          characters={characters} onOpen={openCharacter}
          onRefresh={() => refresh(null)} onNew={() => setCreating(true)}
        />
      ) : (
        <DetailView
          character={selected} generations={generations} busy={busy}
          onBack={() => { setSelectedId(null); setGenerations([]); refresh(null, true); }}
          onAct={act}
        />
      )}

      {creating && (
        <CreateModal
          busy={busy} onClose={() => setCreating(false)}
          onCreate={async (payload) => {
            setBusy(true);
            try {
              const j = await call('create-character', payload);
              setCreating(false);
              showToast?.('Character created — rendering 3 portrait options', 'success');
              await openCharacter(j.character.id);
            } catch (e) { showToast?.(e.message, 'error'); }
            finally { setBusy(false); }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ListView({ characters, onOpen, onRefresh, onNew }) {
  return (
    <>
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-950/80 via-[#141a2e] to-[#0f1419] p-7">
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-indigo-600/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-28 left-1/3 w-72 h-72 rounded-full bg-fuchsia-600/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-900/50">
                <Contact size={20} className="text-white" />
              </span>
              <h2 className="text-2xl font-bold text-white tracking-tight">Character Studio</h2>
            </div>
            <p className="text-sm text-gray-400 mt-2 max-w-md">
              Your own AI influencers &amp; brand characters — any style, identity locked on every render, generated on our stack.
            </p>
          </div>
          <div className="flex gap-2.5">
            <button className={btnGhost} onClick={onRefresh}><RefreshCw size={15} /> Refresh</button>
            <button className={btnPrimary} onClick={onNew}><Plus size={16} /> New Character</button>
          </div>
        </div>
      </div>

      {!characters.length ? (
        <div className={`${panel} p-14 text-center`}>
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
            <Contact size={26} className="text-gray-500" />
          </span>
          <p className="text-gray-300 font-medium">No characters yet</p>
          <p className="text-sm text-gray-500 mt-1">Create the first one — you'll get 3 portrait options to pick the face from.</p>
          <button className={`${btnPrimary} mt-5`} onClick={onNew}><Plus size={16} /> Create your first character</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {characters.map((c) => (
            <button key={c.id} onClick={() => onOpen(c.id)}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-left transition-all duration-300 hover:border-indigo-400/40 hover:shadow-xl hover:shadow-indigo-950/40 hover:-translate-y-0.5">
              <div className="aspect-[3/4] relative overflow-hidden">
                {c.portrait_url ? (
                  <img src={c.portrait_url} alt={c.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                ) : (
                  <Shimmer />
                )}
                <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 p-3.5">
                  <p className="font-semibold text-white text-[15px] drop-shadow">{c.name}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Chip tone="indigo">{STYLE_NAME[c.style] || c.style}</Chip>
                    {c.status === 'draft' && <Chip tone="amber">Picking face</Chip>}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function CreateModal({ busy, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [style, setStyle] = useState('photoreal');
  const [description, setDescription] = useState('');
  const [rqcAudience, setRqcAudience] = useState(true);
  const [model, setModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const submit = () => {
    const desc = rqcAudience && style === 'photoreal'
      ? `${description.trim().replace(/\.\s*$/, '')}. ${RQC_AUDIENCE_LINE}.`
      : description.trim();
    onCreate({ name: name.trim(), style, description: desc, model: model.trim() || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#131a24] shadow-2xl shadow-black/60">
        {/* Modal header */}
        <div className="relative overflow-hidden px-6 pt-6 pb-5 border-b border-white/10">
          <div className="absolute -top-16 -right-10 w-52 h-52 rounded-full bg-indigo-600/15 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">New character</h3>
              <p className="text-sm text-gray-400 mt-0.5">Describe them once — the face you pick next locks the identity forever.</p>
            </div>
            <button className={btnIcon} onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <Label>Name</Label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Valentina" className={field} autoFocus />
          </div>

          <div>
            <Label>Style</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {STYLES.map((s) => {
                const Icon = s.icon;
                const active = style === s.id;
                return (
                  <button key={s.id} type="button" onClick={() => setStyle(s.id)}
                    className={`relative flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all ${
                      active
                        ? 'border-indigo-400/60 bg-indigo-500/10 ring-2 ring-indigo-500/25'
                        : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'
                    }`}>
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${s.grad} shadow-md`}>
                      <Icon size={15} className="text-white" />
                    </span>
                    <span>
                      <span className={`block text-sm font-semibold ${active ? 'text-white' : 'text-gray-200'}`}>{s.name}</span>
                      <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">{s.desc}</span>
                    </span>
                    {active && <Check size={14} className="absolute top-2 right-2 text-indigo-300" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label>Who are they?</Label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder="Looks, age, styling — e.g. a warm charismatic woman in her mid 30s, long dark wavy hair, gold hoop earrings, embroidered blouse"
              className={`${field} resize-none leading-relaxed`} />
            {style === 'photoreal' && (
              <label className="mt-2.5 flex items-start gap-2.5 text-sm text-gray-300 cursor-pointer group">
                <input type="checkbox" checked={rqcAudience} onChange={(e) => setRqcAudience(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/10 text-indigo-500 focus:ring-indigo-500/40 focus:ring-offset-0" />
                <span>
                  RQC brand character
                  <span className="block text-xs text-gray-500 mt-0.5">Adds “{RQC_AUDIENCE_LINE}” to every render</span>
                </span>
              </label>
            )}
          </div>

          <div>
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors">
              <ChevronDown size={13} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} /> Advanced
            </button>
            {showAdvanced && (
              <div className="mt-2.5">
                <Label>Custom Kie model slug (optional)</Label>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="google/nano-banana"
                  className={`${field} md:w-2/3 font-mono text-xs`} />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-white/10 bg-white/[0.02]">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy || !name.trim() || !description.trim()} onClick={submit}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Create + render 3 portraits
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DetailView({ character: c, generations, busy, onBack, onAct }) {
  const [kind, setKind] = useState('image');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('3:4');
  const [takes, setTakes] = useState(3); // images default 3 takes; video 1 (cost)
  const [duration, setDuration] = useState(5);
  const [fromImageUrl, setFromImageUrl] = useState('');
  const [loop, setLoop] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);

  const portraits = generations.filter((g) => g.kind === 'portrait');
  const content = generations.filter((g) => g.kind !== 'portrait');
  const readyImages = generations.filter((g) => g.kind !== 'video' && g.status === 'ready' && g.media_url);
  const refs = c.reference_urls || [];
  const isDraft = c.status === 'draft';

  const generate = () => {
    const payload = { characterId: c.id, kind, prompt, aspectRatio: aspect, count: takes };
    if (kind === 'video') Object.assign(payload, { duration, fromImageUrl: fromImageUrl || undefined, loop });
    onAct('generate', payload, `Rendering ${takes > 1 ? `${takes} takes` : kind}…`);
    setPrompt('');
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <button className={btnGhost} onClick={onBack}><ArrowLeft size={15} /> All characters</button>
        <button className={`${btnGhost} !text-gray-500 hover:!text-red-300`}
          onClick={() => { if (confirm(`Archive ${c.name}?`)) onAct('archive-character', { characterId: c.id }, 'Archived'); }}>
          <Trash2 size={15} /> Archive
        </button>
      </div>

      <div className="grid md:grid-cols-[300px_1fr] gap-6 mt-5">
        {/* Identity column */}
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            <div className="aspect-[3/4] relative">
              {c.portrait_url ? (
                <img src={c.portrait_url} alt={c.name} className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gray-500">
                  Pick a portrait to lock the identity
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/90 via-black/45 to-transparent pointer-events-none" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <p className="text-lg font-bold text-white drop-shadow">{c.name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Chip tone="indigo">{STYLE_NAME[c.style] || c.style}</Chip>
                  {isDraft ? <Chip tone="amber">Draft</Chip> : <Chip tone="green"><Check size={10} /> Identity locked</Chip>}
                </div>
              </div>
              <button title="Edit identity" onClick={() => setEditing(true)}
                className="absolute top-2.5 right-2.5 inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-200 bg-black/50 backdrop-blur-sm hover:bg-black/70 hover:text-white transition-all">
                <Pencil size={14} />
              </button>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed p-4 border-t border-white/10">{c.description}</p>
          </div>

          {!isDraft && (
            <button className={`${btnGhost} w-full !justify-start`} disabled={busy}
              title="Renders 6 canonical shots (angles, expressions, full body). Pin the winners as references — more references = stronger identity lock."
              onClick={() => onAct('identity-kit', { characterId: c.id }, 'Rendering the 6-shot identity kit — pin the winners')}>
              <Layers size={15} className="text-indigo-300" />
              <span className="text-left">
                Build identity kit
                <span className="block text-[11px] text-gray-500 font-normal">6 canonical shots → pin the best</span>
              </span>
            </button>
          )}

          {!!refs.length && (
            <div className={`${panel} p-3.5`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2.5">Extra references · {refs.length}</p>
              <div className="grid grid-cols-3 gap-2">
                {refs.map((u) => (
                  <div key={u} className="relative group rounded-lg overflow-hidden">
                    <img src={u} alt="ref" className="aspect-square object-cover w-full" />
                    <button onClick={() => onAct('remove-reference', { characterId: c.id, url: u })}
                      className="absolute top-1 right-1 bg-black/70 text-white rounded-md p-1 opacity-0 group-hover:opacity-100 transition-opacity"><X size={11} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Work column */}
        <div className="space-y-6">
          {isDraft ? (
            <div className={`${panel} p-5`}>
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-bold">1</span>
                <div>
                  <p className="text-sm font-semibold text-white">Pick the face</p>
                  <p className="text-xs text-gray-500">This portrait becomes the identity on every future render.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {portraits.map((g) => (
                  <GenTile key={g.id} g={g} action={g.status === 'ready' ? (
                    <button className={`${btnPrimary} w-full !py-2 !text-xs`} disabled={busy}
                      onClick={() => onAct('choose-portrait', { characterId: c.id, generationId: g.id }, 'Portrait locked — start generating')}>
                      <Check size={14} /> Use this one
                    </button>
                  ) : null} />
                ))}
              </div>
              <div className="mt-4 flex gap-2.5">
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional direction for the next batch — e.g. shorter hair, brighter light"
                  className={field} />
                <button className={`${btnGhost} shrink-0`} disabled={busy}
                  onClick={() => { onAct('more-portraits', { characterId: c.id, note: note || undefined }, 'Rendering 3 more'); setNote(''); }}>
                  <RefreshCw size={15} /> 3 more
                </button>
              </div>
            </div>
          ) : (
            <div className={`${panel} p-5 space-y-4`}>
              {/* Segmented Image / Video switch */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm font-semibold text-white">Generate</p>
                <div className="relative flex rounded-xl bg-black/40 border border-white/10 p-1">
                  {[
                    { id: 'image', label: 'Image', icon: ImageIcon, defAspect: '3:4', defTakes: 3 },
                    { id: 'video', label: 'Video', icon: Film, defAspect: '9:16', defTakes: 1 },
                  ].map((t) => {
                    const Icon = t.icon;
                    const active = kind === t.id;
                    return (
                      <button key={t.id} onClick={() => { setKind(t.id); setAspect(t.defAspect); setTakes(t.defTakes); }}
                        className={`relative flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                          active ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-950/50' : 'text-gray-400 hover:text-gray-200'
                        }`}>
                        <Icon size={14} /> {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Shot menu — tap a proven scene, tweak if you want, generate */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {PRESETS[kind].map((ps) => (
                  <button key={ps.name} title={ps.p} onClick={() => setPrompt(ps.p)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      prompt === ps.p
                        ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200'
                        : 'border-white/10 bg-white/[0.04] text-gray-400 hover:text-white hover:border-white/25'
                    }`}>
                    {ps.name}
                  </button>
                ))}
              </div>

              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
                placeholder={kind === 'image'
                  ? 'Tap a preset above, or describe the scene — e.g. recording a song in a cozy home studio, golden hour light'
                  : 'Tap a preset above, or describe the clip — e.g. she smiles and waves at the camera, slight breeze in her hair'}
                className={`${field} resize-none leading-relaxed`} />

              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mr-1">Aspect</span>
                  {(kind === 'image' ? IMG_ASPECTS : VID_ASPECTS).map((a) => (
                    <button key={a} onClick={() => setAspect(a)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                        aspect === a ? 'bg-white text-gray-900 border-white' : 'border-white/15 text-gray-400 hover:text-white hover:border-white/30'
                      }`}>{a}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5" title="Independent takes of the same prompt — pick the winner">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mr-1">Takes</span>
                  {[1, 3].map((n) => (
                    <button key={n} onClick={() => setTakes(n)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                        takes === n ? 'bg-white text-gray-900 border-white' : 'border-white/15 text-gray-400 hover:text-white hover:border-white/30'
                      }`}>×{n}</button>
                  ))}
                </div>
                {kind === 'video' && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mr-1">Length</span>
                      {[5, 10].map((d) => (
                        <button key={d} onClick={() => setDuration(d)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                            duration === d ? 'bg-white text-gray-900 border-white' : 'border-white/15 text-gray-400 hover:text-white hover:border-white/30'
                          }`}>{d}s</button>
                      ))}
                    </div>
                    <select value={fromImageUrl}
                      onChange={(e) => { setFromImageUrl(e.target.value); if (!e.target.value) setLoop(false); }}
                      className="bg-white/[0.06] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 max-w-[230px] focus:outline-none focus:border-indigo-400/60 [&>option]:bg-[#131a24] [&>option]:text-gray-200">
                      <option value="">Animate from: identity references</option>
                      {c.portrait_url && <option value={c.portrait_url}>Animate from: portrait</option>}
                      {readyImages.map((g, i) => <option key={g.id} value={g.media_url}>Animate from: image #{readyImages.length - i}</option>)}
                    </select>
                    {fromImageUrl && (
                      <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-indigo-500 focus:ring-indigo-500/40 focus:ring-offset-0" />
                        <Repeat size={12} /> Perfect loop
                      </label>
                    )}
                  </>
                )}
                <button className={`${btnPrimary} ml-auto`} disabled={busy || !prompt.trim()} onClick={generate}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Generate
                </button>
              </div>
            </div>
          )}

          {/* Gallery */}
          {!!content.length && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2.5">Gallery</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {content.map((g) => (
                  <GenTile key={g.id} g={g} hoverActions action={g.status === 'ready' ? (
                    <div className="flex gap-1.5">
                      <button title={g.meta?.sentToCreative ? 'Already in the Creative Studio queue' : 'Send to Creative Studio (Claude drafts the Spanish caption; you approve there before it posts)'}
                        className={`${btnIcon} ${g.meta?.sentToCreative ? '!text-emerald-300' : 'hover:!text-indigo-300'}`} disabled={busy}
                        onClick={() => onAct('send-to-creative', { generationId: g.id }, 'Sent to Creative Studio — approve it there')}>
                        {g.meta?.sentToCreative ? <Check size={14} /> : <Send size={14} />}
                      </button>
                      <a href={g.media_url} target="_blank" rel="noreferrer" title="Open full size" className={btnIcon}><Download size={14} /></a>
                      {g.kind !== 'video' && (
                        <button title="Pin as identity reference" className={btnIcon} disabled={busy}
                          onClick={() => onAct('add-reference', { characterId: c.id, generationId: g.id }, 'Added to references')}><Pin size={14} /></button>
                      )}
                      <button title="Delete" className={`${btnIcon} hover:!text-red-300`} disabled={busy}
                        onClick={() => { if (confirm('Delete this render?')) onAct('delete-generation', { generationId: g.id }); }}><Trash2 size={14} /></button>
                    </div>
                  ) : null} />
                ))}
              </div>
            </div>
          )}

          {/* Portrait history — switch faces later */}
          {!isDraft && portraits.some((g) => g.status === 'ready' && g.media_url !== c.portrait_url) && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2.5">Other portrait takes</p>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                {portraits.filter((g) => g.status === 'ready' && g.media_url !== c.portrait_url).map((g) => (
                  <GenTile key={g.id} g={g} action={
                    <button className={`${btnGhost} w-full !py-1.5 !text-xs`} disabled={busy}
                      onClick={() => onAct('choose-portrait', { characterId: c.id, generationId: g.id }, 'Portrait switched')}>
                      <Check size={13} /> Make portrait
                    </button>
                  } />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditIdentityModal
          character={c} busy={busy} onClose={() => setEditing(false)}
          onSave={(patch) => { onAct('update-character', { characterId: c.id, ...patch }, 'Identity updated'); setEditing(false); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Edit identity — refine name / description / model. The description is
// re-injected into EVERY render prompt, so wardrobe anchors edited here apply
// to all future content. Face lock is untouched (portrait + references).
function EditIdentityModal({ character: c, busy, onClose, onSave }) {
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const [model, setModel] = useState(c.image_model || '');
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#131a24] shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">Edit identity</h3>
            <p className="text-sm text-gray-400 mt-0.5">The description rides on every render — signature anchors (hair, jewelry, wardrobe) go here.</p>
          </div>
          <button className={btnIcon} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <Label>Name</Label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div>
            <Label>Identity description</Label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className={`${field} resize-none leading-relaxed`} />
            <p className="text-[11px] text-gray-500 mt-1.5">Tip: 2–3 never-changing anchors keep the brand read consistent — same hairstyle, one signature jewelry piece, a wardrobe element in brand colors.</p>
          </div>
          <div>
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors">
              <ChevronDown size={13} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} /> Advanced
            </button>
            {showAdvanced && (
              <div className="mt-2.5">
                <Label>Custom Kie model slug (optional)</Label>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="google/nano-banana"
                  className={`${field} md:w-2/3 font-mono text-xs`} />
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-white/10 bg-white/[0.02]">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy || !name.trim() || !description.trim()}
            onClick={() => onSave({ name: name.trim(), description: description.trim(), model: model.trim() || null })}>
            <Check size={16} /> Save identity
          </button>
        </div>
      </div>
    </div>
  );
}

// Tile: ready media, shimmer while rendering, red tint on failure. With
// hoverActions the buttons float over the media on hover (gallery); otherwise
// they sit in a footer bar (portrait picking).
function GenTile({ g, action, hoverActions = false }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition-all hover:border-white/25">
      <div className="aspect-[3/4] relative">
        {g.status === 'generating' && <Shimmer />}
        {g.status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center bg-red-950/20">
            <AlertTriangle size={17} className="text-red-400" />
            <span className="text-[11px] text-red-300/90 leading-snug">{String(g.error || 'failed').slice(0, 90)}</span>
          </div>
        )}
        {g.status === 'ready' && g.media_url && (
          g.kind === 'video'
            ? <video src={g.media_url} controls loop muted playsInline className="w-full h-full object-cover" />
            : <img src={g.media_url} alt={g.kind} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        )}
        {g.kind === 'video' && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white bg-black/60 backdrop-blur-sm rounded-md px-1.5 py-0.5 pointer-events-none">
            <Film size={10} /> Video
          </span>
        )}
        {g.status === 'ready' && g.meta?.sentToCreative && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-200 bg-emerald-900/70 backdrop-blur-sm border border-emerald-400/20 rounded-md px-1.5 py-0.5 pointer-events-none">
            <Check size={10} /> In queue
          </span>
        )}
        {hoverActions && action && (
          <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {action}
          </div>
        )}
      </div>
      {!hoverActions && action && <div className="p-2.5 border-t border-white/10">{action}</div>}
    </div>
  );
}
