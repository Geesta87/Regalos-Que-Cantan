// src/components/admin/CharacterStudioTab.jsx
// Character Studio — in-house AI influencer / brand-character builder (the
// Eromify replacement, 2026-08-13). Create a character in any style
// (photoreal / Pixar 3D / illustrated / anime / custom), pick one portrait as
// the identity anchor, then generate identity-consistent images & videos.
// Talks only to the character-studio edge function (own tables + own bucket).
//
// Flow: New Character → 3 portrait candidates render → pick one → the detail
// view unlocks Image / Video generation with the portrait (+ optional extra
// reference stills) locking the identity on every render.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Contact, Plus, RefreshCw, Loader2, ArrowLeft, Trash2, Check, Sparkles,
  Image as ImageIcon, Film, AlertTriangle, Pin, X, Download, Repeat,
} from 'lucide-react';
import { Card, Badge, SectionLabel, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/character-studio`;

const STYLES = [
  { id: 'photoreal', name: 'Photoreal', desc: 'A realistic human — photographic' },
  { id: 'pixar', name: 'Pixar 3D', desc: '3D animated film character' },
  { id: 'illustrated', name: 'Illustrated', desc: 'Flat editorial illustration' },
  { id: 'anime', name: 'Anime', desc: 'Anime key-visual style' },
  { id: 'custom', name: 'Custom', desc: 'Your description drives the style' },
];
const STYLE_NAME = Object.fromEntries(STYLES.map((s) => [s.id, s.name]));

// Every RQC-brand visual shows authentic Mexican/Latino people (owner rule).
// Pre-checked on create; the line lands in the stored description so every
// later render repeats it.
const RQC_AUDIENCE_LINE = 'Authentic Mexican/Latino features and styling, warm and natural';

const IMG_ASPECTS = ['3:4', '1:1', '4:5', '9:16', '16:9'];
const VID_ASPECTS = ['9:16', '1:1', '16:9'];

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

  // Poll while anything is rendering (list's finalize pass does the real work).
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
    return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="animate-spin mr-2" size={20} /> Loading Character Studio…</div>;
  }

  return (
    <div className="space-y-5">
      {!selected ? (
        <ListView
          characters={characters} busy={busy} creating={creating} setCreating={setCreating}
          onOpen={openCharacter} onRefresh={() => refresh(null)}
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
      ) : (
        <DetailView
          character={selected} generations={generations} busy={busy}
          onBack={() => { setSelectedId(null); setGenerations([]); refresh(null, true); }}
          onAct={act}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ListView({ characters, busy, creating, setCreating, onOpen, onRefresh, onCreate }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Contact size={20} className="text-indigo-600" /> Character Studio</h2>
          <p className="text-sm text-gray-500 mt-0.5">Create AI influencers & brand characters — any style, identity locked, ours.</p>
        </div>
        <div className="flex gap-2">
          <button className={btn.ghost} onClick={onRefresh}><RefreshCw size={15} /> Refresh</button>
          <button className={btn.accent} onClick={() => setCreating(true)}><Plus size={15} /> New Character</button>
        </div>
      </div>

      {creating && <CreateForm busy={busy} onCancel={() => setCreating(false)} onCreate={onCreate} />}

      {!characters.length && !creating ? (
        <Card className="p-10 text-center text-gray-400">
          <Contact size={32} className="mx-auto mb-3 text-gray-300" />
          No characters yet. Create the first one — you'll get 3 portrait options to pick from.
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {characters.map((c) => (
            <Card key={c.id} className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={() => onOpen(c.id)}>
              <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center">
                {c.portrait_url
                  ? <img src={c.portrait_url} alt={c.name} className="w-full h-full object-cover" />
                  : <div className="text-gray-400 text-sm flex flex-col items-center gap-2"><Loader2 size={20} className="animate-spin" /> Picking portrait…</div>}
              </div>
              <div className="p-3">
                <p className="font-medium text-gray-900 truncate">{c.name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge tone="accent">{STYLE_NAME[c.style] || c.style}</Badge>
                  {c.status === 'draft' && <Badge tone="amber">Draft</Badge>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function CreateForm({ busy, onCancel, onCreate }) {
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
    <Card className="p-5 space-y-4 border-indigo-200">
      <SectionLabel>New character</SectionLabel>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-gray-600">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Valentina"
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Style</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {STYLES.map((s) => (
              <button key={s.id} type="button" title={s.desc} onClick={() => setStyle(s.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${style === s.id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Who are they? (looks, age, styling — this locks the identity)</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          placeholder="e.g. a warm charismatic woman in her mid 30s, long dark wavy hair, gold hoop earrings, embroidered blouse"
          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        {style === 'photoreal' && (
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={rqcAudience} onChange={(e) => setRqcAudience(e.target.checked)} className="rounded" />
            RQC brand character (adds: “{RQC_AUDIENCE_LINE}”)
          </label>
        )}
      </div>
      <div>
        <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '− Hide advanced' : '+ Advanced'}
        </button>
        {showAdvanced && (
          <div className="mt-2">
            <label className="text-xs font-medium text-gray-600">Custom Kie model slug (optional — default google/nano-banana)</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="google/nano-banana"
              className="mt-1 w-full md:w-1/2 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <button className={btn.ghost} onClick={onCancel}>Cancel</button>
        <button className={btn.accent} disabled={busy || !name.trim() || !description.trim()} onClick={submit}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Create + render 3 portraits
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function DetailView({ character: c, generations, busy, onBack, onAct }) {
  const [kind, setKind] = useState('image');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('3:4');
  const [duration, setDuration] = useState(5);
  const [fromImageUrl, setFromImageUrl] = useState('');
  const [loop, setLoop] = useState(false);
  const [note, setNote] = useState('');

  const portraits = generations.filter((g) => g.kind === 'portrait');
  const content = generations.filter((g) => g.kind !== 'portrait');
  const readyImages = generations.filter((g) => g.kind !== 'video' && g.status === 'ready' && g.media_url);
  const refs = c.reference_urls || [];
  const isDraft = c.status === 'draft';

  const generate = () => {
    const payload = { characterId: c.id, kind, prompt, aspectRatio: aspect };
    if (kind === 'video') Object.assign(payload, { duration, fromImageUrl: fromImageUrl || undefined, loop });
    onAct('generate', payload, `Rendering ${kind}…`);
    setPrompt('');
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <button className={btn.ghost} onClick={onBack}><ArrowLeft size={15} /> All characters</button>
        <button className={btn.ghost} onClick={() => { if (confirm(`Archive ${c.name}?`)) onAct('archive-character', { characterId: c.id }, 'Archived'); }}>
          <Trash2 size={15} /> Archive
        </button>
      </div>

      <div className="grid md:grid-cols-[280px_1fr] gap-5">
        {/* Identity column */}
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center">
              {c.portrait_url
                ? <img src={c.portrait_url} alt={c.name} className="w-full h-full object-cover" />
                : <span className="text-sm text-gray-400 px-4 text-center">Pick a portrait below to lock the identity</span>}
            </div>
            <div className="p-3">
              <p className="font-semibold text-gray-900">{c.name}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge tone="accent">{STYLE_NAME[c.style] || c.style}</Badge>
                {isDraft ? <Badge tone="amber">Draft</Badge> : <Badge tone="green">Active</Badge>}
              </div>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">{c.description}</p>
            </div>
          </Card>
          {!!refs.length && (
            <Card className="p-3">
              <SectionLabel className="mb-2">Extra references ({refs.length})</SectionLabel>
              <div className="grid grid-cols-3 gap-1.5">
                {refs.map((u) => (
                  <div key={u} className="relative group">
                    <img src={u} alt="ref" className="rounded aspect-square object-cover w-full" />
                    <button onClick={() => onAct('remove-reference', { characterId: c.id, url: u })}
                      className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><X size={11} /></button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Work column */}
        <div className="space-y-5">
          {/* Portrait pick (draft) — or generation controls (active) */}
          {isDraft ? (
            <Card className="p-4">
              <SectionLabel className="mb-3">Step 1 — pick the portrait (this face is the identity forever)</SectionLabel>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {portraits.map((g) => <GenTile key={g.id} g={g} action={g.status === 'ready' ? (
                  <button className={`${btn.accent} w-full`} disabled={busy}
                    onClick={() => onAct('choose-portrait', { characterId: c.id, generationId: g.id }, 'Portrait locked — start generating')}>
                    <Check size={15} /> Use this one
                  </button>
                ) : null} />)}
              </div>
              <div className="mt-3 flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional direction for the next batch (e.g. shorter hair, brighter light)"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <button className={btn.ghost} disabled={busy} onClick={() => { onAct('more-portraits', { characterId: c.id, note: note || undefined }, 'Rendering 3 more'); setNote(''); }}>
                  <RefreshCw size={15} /> 3 more options
                </button>
              </div>
            </Card>
          ) : (
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <SectionLabel>Generate</SectionLabel>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden ml-2">
                  <button onClick={() => { setKind('image'); setAspect('3:4'); }}
                    className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${kind === 'image' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}><ImageIcon size={14} /> Image</button>
                  <button onClick={() => { setKind('video'); setAspect('9:16'); }}
                    className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${kind === 'video' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}><Film size={14} /> Video</button>
                </div>
              </div>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
                placeholder={kind === 'image'
                  ? 'What are they doing? e.g. recording a song in a cozy home studio, golden hour light'
                  : 'What happens in the clip? e.g. she smiles and waves at the camera, slight breeze in her hair'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">Aspect</span>
                  {(kind === 'image' ? IMG_ASPECTS : VID_ASPECTS).map((a) => (
                    <button key={a} onClick={() => setAspect(a)}
                      className={`px-2 py-1 rounded text-xs border ${aspect === a ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{a}</button>
                  ))}
                </div>
                {kind === 'video' && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">Length</span>
                      {[5, 10].map((d) => (
                        <button key={d} onClick={() => setDuration(d)}
                          className={`px-2 py-1 rounded text-xs border ${duration === d ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{d}s</button>
                      ))}
                    </div>
                    <select value={fromImageUrl} onChange={(e) => { setFromImageUrl(e.target.value); if (!e.target.value) setLoop(false); }}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 max-w-[220px]">
                      <option value="">Animate from: identity references</option>
                      {c.portrait_url && <option value={c.portrait_url}>Animate from: portrait</option>}
                      {readyImages.map((g, i) => <option key={g.id} value={g.media_url}>Animate from: image #{readyImages.length - i}</option>)}
                    </select>
                    {fromImageUrl && (
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="rounded" />
                        <Repeat size={12} /> Perfect loop
                      </label>
                    )}
                  </>
                )}
                <button className={`${btn.accent} ml-auto`} disabled={busy || !prompt.trim()} onClick={generate}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Generate
                </button>
              </div>
            </Card>
          )}

          {/* Gallery */}
          {!!content.length && (
            <div>
              <SectionLabel className="mb-2">Gallery</SectionLabel>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {content.map((g) => (
                  <GenTile key={g.id} g={g} action={g.status === 'ready' ? (
                    <div className="flex gap-1.5">
                      <a href={g.media_url} target="_blank" rel="noreferrer" className={`${btn.ghost} flex-1 !py-1.5`}><Download size={13} /> Open</a>
                      {g.kind !== 'video' && (
                        <button title="Add as identity reference" className={`${btn.ghost} !py-1.5`} disabled={busy}
                          onClick={() => onAct('add-reference', { characterId: c.id, generationId: g.id }, 'Added to references')}><Pin size={13} /></button>
                      )}
                      <button title="Delete" className={`${btn.ghost} !py-1.5`} disabled={busy}
                        onClick={() => { if (confirm('Delete this render?')) onAct('delete-generation', { generationId: g.id }); }}><Trash2 size={13} /></button>
                    </div>
                  ) : null} />
                ))}
              </div>
            </div>
          )}
          {/* Portrait history for active characters (switch portrait later) */}
          {!isDraft && portraits.some((g) => g.status === 'ready' && g.media_url !== c.portrait_url) && (
            <div>
              <SectionLabel className="mb-2">Other portrait takes</SectionLabel>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                {portraits.filter((g) => g.status === 'ready' && g.media_url !== c.portrait_url).map((g) => (
                  <GenTile key={g.id} g={g} action={
                    <button className={`${btn.ghost} w-full !py-1.5`} disabled={busy}
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
    </>
  );
}

function GenTile({ g, action }) {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center relative">
        {g.status === 'generating' && (
          <div className="text-gray-400 text-xs flex flex-col items-center gap-2"><Loader2 size={18} className="animate-spin" /> Rendering…</div>
        )}
        {g.status === 'failed' && (
          <div className="text-red-500 text-xs flex flex-col items-center gap-1.5 px-3 text-center"><AlertTriangle size={16} /> {String(g.error || 'failed').slice(0, 90)}</div>
        )}
        {g.status === 'ready' && g.media_url && (
          g.kind === 'video'
            ? <video src={g.media_url} controls loop muted playsInline className="w-full h-full object-cover" />
            : <img src={g.media_url} alt={g.kind} className="w-full h-full object-cover" />
        )}
        {g.kind === 'video' && <Badge tone="gray" className="absolute top-1.5 left-1.5 !bg-black/60 !text-white">video</Badge>}
      </div>
      {action && <div className="p-2">{action}</div>}
    </Card>
  );
}
