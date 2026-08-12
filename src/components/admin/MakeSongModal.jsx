import React, { useEffect, useMemo, useState } from 'react';
import genres from '../../config/genres';
import { glossFor } from '../../config/genreGlossEn';
import {
  OCCASIONS, EMOTIONAL_TONES, RELATIONSHIPS, VOICE_TYPES,
  OCCASION_IDS, EMOTIONAL_TONE_IDS, RELATIONSHIP_IDS,
} from '../../config/songOptions';
import { occasionPrompts } from '../../services/api';

// ──────────────────────────────────────────────────────────────────────────
// "Make Song for Customer" — admin-side song creation from a WhatsApp thread.
//
// The problem this solves: Ivan handles the customers who ask US to build the
// song for them, but he doesn't read Spanish, so the details were going through
// ChatGPT by hand and arriving in the song wrong. A blank 22-field form would
// not have fixed that — it just moves the same translation problem onto him.
//
// So this is an EXTRACT → REVIEW → CONFIRM screen, not a data-entry form:
//   1. Claude reads the thread and fills the whole brief (`extract-brief`).
//   2. Every field shows WHERE it came from — the customer's Spanish words plus
//      an English translation — so the brief can be verified without Spanish.
//   3. Anything not grounded in the conversation comes back EMPTY with a
//      ready-to-send Spanish question, and blocks the Generate button.
//   4. On confirm, `create-song` proxies the brief to the normal generate-song
//      pipeline, so the song is identical to one a customer would have made.
//
// THE STORY IS QUOTED, NEVER SUMMARIZED.
// `details` is injected into the lyric prompt verbatim as "DETALLES PERSONALES"
// and the fact-checker treats it as ground truth — so an AI paraphrase that
// shifts one verb becomes a false fact the rest of the pipeline then faithfully
// protects. The model therefore only SELECTS spans of the customer's own
// messages; the server re-slices each span out of the source transcript and
// discards anything it can't find. What the operator assembles here is the
// customer's literal words, plus optionally a clearly-marked team note.
// ──────────────────────────────────────────────────────────────────────────

const EMPTY_BRIEF = {
  recipientName: '', senderName: '', relationship: '', customRelationship: '',
  occasion: '', customOccasion: '', emotionalTone: '',
  genre: '', subGenre: '', customStyle: '', voiceType: '', email: '',
};

// Same normalization the server uses, for the "what got left out" check.
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Assemble what actually goes to the songwriter. Quotes verbatim, in order;
// team notes appended under an explicit label so the lyric writer (and anyone
// auditing later) can tell whose words are whose.
function buildDetails(quotes, clarifications) {
  const body = quotes.filter((q) => q.include).map((q) => q.text).join('\n');
  const notes = clarifications.filter((c) => c.include).map((c) => c.text);
  if (!notes.length) return body;
  return `${body}\n\nNOTA DEL EQUIPO: ${notes.join(' ')}`.trim();
}

function buildNotes(requested, operatorNotes) {
  const lines = requested.filter((r) => r.include).map((r) => `"${r.text}"`);
  const parts = [];
  if (lines.length) parts.push(`Incluye estas frases del cliente TAL CUAL en la letra: ${lines.join(' / ')}`);
  if (operatorNotes.trim()) parts.push(operatorNotes.trim());
  return parts.join(' ').slice(0, 500);
}

function EvidenceBadge({ ev }) {
  if (!ev) return null;
  const style = {
    stated: { cls: 'bg-green-500/15 text-green-300 border-green-500/30', label: 'from chat' },
    inferred: { cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: 'inferred' },
    missing: { cls: 'bg-red-500/15 text-red-300 border-red-500/30', label: 'not mentioned' },
  }[ev.status] || { cls: 'bg-white/10 text-gray-400 border-white/20', label: ev.status };
  return (
    <span className={`text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${style.cls}`}>
      {style.label}
    </span>
  );
}

// The quote + translation + reason under a field. This is the part that lets a
// non-Spanish-speaker actually audit the extraction.
function EvidenceDetail({ ev }) {
  if (!ev) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {ev.quoteEs ? (
        <p className="text-[10px] text-gray-400 leading-snug">
          <span className="text-gray-500">Customer wrote: </span>
          <span className="italic">“{ev.quoteEs}”</span>
        </p>
      ) : null}
      {ev.quoteEn ? (
        <p className="text-[10px] text-indigo-300/80 leading-snug">
          <span className="text-gray-500">Means: </span>“{ev.quoteEn}”
        </p>
      ) : null}
      {ev.noteEn ? <p className="text-[10px] text-gray-500 leading-snug">{ev.noteEn}</p> : null}
    </div>
  );
}

function Field({ label, ev, hint, children }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1">
        <label className="text-[11px] uppercase tracking-wide text-gray-500">{label}</label>
        <EvidenceBadge ev={ev} />
      </div>
      {children}
      {hint ? <p className="text-[10px] text-gray-500 mt-1">{hint}</p> : null}
      <EvidenceDetail ev={ev} />
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-400/60';
const selectCls =
  'w-full px-3 py-2 bg-[#1b212c] border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-400/60';

export default function MakeSongModal({
  open, onClose, accessToken, conversation, turns, exchange, isDemo, onAskInSpanish,
}) {
  const [phase, setPhase] = useState('reading'); // reading | review | generating | done
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [storyQuotes, setStoryQuotes] = useState([]);
  const [clarifications, setClarifications] = useState([]);
  const [requestedLines, setRequestedLines] = useState([]);
  const [rejectedQuotes, setRejectedQuotes] = useState([]);
  const [operatorNotes, setOperatorNotes] = useState('');
  const [manualDetails, setManualDetails] = useState(null); // non-null = operator took over
  const [evidence, setEvidence] = useState({});
  const [questions, setQuestions] = useState([]);
  const [notSongRequest, setNotSongRequest] = useState(false);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState('');
  const [result, setResult] = useState(null);
  const [forceDuplicate, setForceDuplicate] = useState(false);

  // Only the CUSTOMER's messages — the verbatim check must never match against
  // something we said, or a suggestion of ours could come back as their fact.
  const customerText = useMemo(
    () => (turns || []).filter((t) => t.who === 'customer').map((t) => t.text).join('\n'),
    [turns]
  );

  const genreList = useMemo(
    () => Object.entries(genres).map(([id, g]) => ({
      id, name: g.name, description: g.description,
      subGenres: Object.entries(g.subGenres || {}).map(([sid, s]) => ({ id: sid, name: s.name, description: s.description })),
    })),
    []
  );

  const subGenreList = useMemo(() => {
    const g = genreList.find((x) => x.id === brief.genre);
    return g ? g.subGenres : [];
  }, [genreList, brief.genre]);

  const details = manualDetails !== null ? manualDetails : buildDetails(storyQuotes, clarifications);

  // Customer messages that no included quote covers — shown so nothing the
  // customer said can quietly disappear from the story.
  const leftOut = useMemo(() => {
    const included = storyQuotes.filter((q) => q.include).map((q) => norm(q.text));
    return (turns || [])
      .filter((t) => t.who === 'customer' && t.text.trim())
      .filter((t) => {
        const n = norm(t.text);
        return !included.some((q) => q && n.includes(q));
      });
  }, [turns, storyQuotes]);

  const missing = useMemo(() => {
    const out = [];
    if (!brief.email.trim()) out.push('Email');
    if (!brief.recipientName.trim()) out.push('Song is for');
    if (!brief.senderName.trim()) out.push('Song is from');
    if (!brief.relationship) out.push('Relationship');
    if (brief.relationship === 'otro' && !brief.customRelationship.trim()) out.push('Relationship (write-in)');
    if (!brief.occasion) out.push('Occasion');
    if (brief.occasion === 'otro' && brief.customOccasion.trim().length < 20) out.push('Occasion (write-in)');
    if (brief.occasion === 'otro' && !brief.emotionalTone) out.push('Emotional tone');
    if (!brief.genre) out.push('Genre');
    if (brief.genre === 'otro' && !brief.customStyle.trim()) out.push('Style (write-in)');
    if (!brief.voiceType) out.push('Voice');
    if (details.trim().length < 20) out.push('The story');
    return out;
  }, [brief, details]);

  const set = (patch) => setBrief((b) => ({ ...b, ...patch }));
  const toggleAt = (setter, i) => setter((arr) => arr.map((x, k) => (k === i ? { ...x, include: !x.include } : x)));

  // ── Read the conversation and fill the brief ────────────────────────────
  useEffect(() => {
    if (!open) return;
    setPhase('reading');
    setBrief(EMPTY_BRIEF);
    setStoryQuotes([]); setClarifications([]); setRequestedLines([]); setRejectedQuotes([]);
    setOperatorNotes(''); setManualDetails(null);
    setEvidence({}); setQuestions([]); setNotSongRequest(false);
    setError(''); setWarn(''); setResult(null); setForceDuplicate(false);

    if (isDemo) {
      setPhase('review');
      setError('Demo mode — the inbox backend is not reachable, so nothing was extracted. Fill the brief in by hand to review the UI.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'extract-brief',
            exchange,
            customerText,
            // Names are also allowed to match the thread's saved contact name —
            // senders rarely retype their own name mid-conversation.
            customerName: conversation?.customer_name || '',
            catalog: genreList,
            occasionIds: OCCASION_IDS,
            relationshipIds: RELATIONSHIP_IDS,
            toneIds: EMOTIONAL_TONE_IDS,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.success) throw new Error(data?.error || `extract-brief ${res.status}`);

        const b = data.brief || {};
        setBrief({
          recipientName: b.recipientName || '',
          senderName: b.senderName || '',
          relationship: RELATIONSHIP_IDS.includes(b.relationship) ? b.relationship : '',
          customRelationship: b.customRelationship || '',
          occasion: OCCASION_IDS.includes(b.occasion) ? b.occasion : '',
          customOccasion: b.customOccasion || '',
          emotionalTone: EMOTIONAL_TONE_IDS.includes(b.emotionalTone) ? b.emotionalTone : '',
          genre: (b.genre === 'otro' || genreList.some((g) => g.id === b.genre)) ? b.genre : '',
          subGenre: b.subGenre || '',
          customStyle: b.customStyle || '',
          voiceType: b.voiceType === 'female' || b.voiceType === 'male' ? b.voiceType : '',
          email: (b.email || '').trim().toLowerCase(),
        });
        // Story spans are ON by default (they're the customer's words); team
        // notes are OFF by default (they're the AI's).
        setStoryQuotes((Array.isArray(b.storyQuotes) ? b.storyQuotes : []).map((q) => ({ ...q, include: true })));
        setRequestedLines((Array.isArray(b.requestedLines) ? b.requestedLines : []).map((q) => ({ ...q, include: true })));
        setClarifications((Array.isArray(b.clarifications) ? b.clarifications : []).map((c) => ({ ...c, include: false })));
        setRejectedQuotes(Array.isArray(b.rejectedQuotes) ? b.rejectedQuotes : []);

        const evMap = {};
        for (const e of Array.isArray(b.evidence) ? b.evidence : []) {
          if (e?.field) evMap[e.field] = e;
        }
        setEvidence(evMap);
        setQuestions(Array.isArray(b.openQuestions) ? b.openQuestions : []);
        setNotSongRequest(b.isSongRequest === false);
        setPhase('review');
      } catch (e) {
        if (cancelled) return;
        setError(`Could not read the conversation: ${e.message}. You can still fill the brief in by hand.`);
        setPhase('review');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exchange, customerText, isDemo, accessToken]);

  // ── Generate ────────────────────────────────────────────────────────────
  const generate = async () => {
    if (missing.length) return;
    if (isDemo) { setResult({ demo: true }); setPhase('done'); return; }
    setPhase('generating');
    setError(''); setWarn('');
    try {
      const g = genreList.find((x) => x.id === brief.genre);
      const s = subGenreList.find((x) => x.id === brief.subGenre);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create-song',
          force: forceDuplicate,
          brief: {
            ...brief,
            details,
            songwriterNotes: buildNotes(requestedLines, operatorNotes),
            // Display labels + the Spanish occasion phrase, exactly as the
            // customer funnel sends them (services/api.js).
            genreName: brief.genre === 'otro' ? (brief.customStyle || 'Otro estilo') : (g?.name || ''),
            subGenreName: s?.name || '',
            subGenrePrompt: s?.description || '',
            occasionPrompt: occasionPrompts[brief.occasion] || '',
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        if (data?.code === 'DUPLICATE_RECENT') {
          setForceDuplicate(true);
          setWarn(data.error);
          setPhase('review');
          return;
        }
        throw new Error(data?.error || `create-song ${res.status}`);
      }
      setResult(data);
      setPhase('done');
    } catch (e) {
      setError(e.message);
      setPhase('review');
    }
  };

  if (!open) return null;
  const busy = phase === 'reading' || phase === 'generating';

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-4xl bg-[#141922] border border-white/10 rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">🎵 Make Song for Customer</h3>
            <p className="text-[11px] text-gray-500 truncate">
              {conversation?.customer_name || conversation?.phone || 'Customer'} · the story is quoted from the chat word-for-word, never rewritten
            </p>
          </div>
          <button onClick={() => !busy && onClose()} className="text-gray-400 hover:text-white text-lg px-1" aria-label="Close">✕</button>
        </div>

        {phase === 'done' ? (
          <div className="px-6 py-10 text-center">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm text-white font-medium mb-1">Song is generating.</p>
            <p className="text-xs text-gray-400 mb-1">
              Two versions are being created for <strong>{brief.recipientName}</strong> under <strong>{brief.email}</strong>, exactly like a customer order.
            </p>
            <p className="text-xs text-gray-500 mb-5">
              It shows up in the <strong>Orders</strong> tab in a few minutes. It is <strong>unpaid</strong> — send the customer their payment link once you've listened to it.
            </p>
            {result?.song?.id && <p className="text-[10px] text-gray-600 font-mono mb-4">{result.song.id}</p>}
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-500 text-white hover:bg-indigo-400 transition">Done</button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* ── LEFT: conversation + the story ──────────────────────── */}
              <div className="min-w-0">
                <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Conversation</label>
                <div className="px-2.5 py-2.5 bg-black/30 border border-white/10 rounded-xl max-h-[26vh] overflow-y-auto space-y-1.5">
                  {(turns && turns.length) ? turns.map((t, i) => (
                    <div key={i} className={`flex ${t.who === 'customer' ? 'justify-start' : 'justify-end'}`}>
                      <div className="max-w-[85%]">
                        <p className={`text-[9px] uppercase tracking-wide mb-0.5 ${t.who === 'customer' ? 'text-gray-500 text-left' : 'text-indigo-300/70 text-right'}`}>
                          {t.who === 'customer' ? 'Customer' : 'Us'}
                        </p>
                        <div className={`rounded-2xl px-3 py-1.5 text-xs whitespace-pre-wrap break-words ${
                          t.who === 'customer'
                            ? 'bg-white/8 text-gray-100 rounded-tl-sm'
                            : 'bg-indigo-500/15 text-indigo-50 border border-indigo-500/25 rounded-tr-sm'
                        }`}>{t.text}</div>
                      </div>
                    </div>
                  )) : <p className="text-xs text-gray-500">No messages in this conversation yet.</p>}
                </div>

                {phase !== 'reading' && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-[11px] uppercase tracking-wide text-gray-500">The story — becomes the lyrics</label>
                      <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border bg-green-500/15 text-green-300 border-green-500/30">
                        verbatim
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mb-2">
                      These are the customer's exact words, checked character-for-character against their messages. Untick anything that shouldn't be in the song.
                    </p>

                    {rejectedQuotes.length > 0 && (
                      <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                        <p className="text-[11px] text-red-300 font-semibold">
                          {rejectedQuotes.length} passage{rejectedQuotes.length > 1 ? 's were' : ' was'} thrown out for not matching the chat
                        </p>
                        <p className="text-[10px] text-red-200/80 mt-0.5">
                          The AI reworded these instead of quoting, so they were discarded. Check the "left out" list below — if something important is missing, add it yourself.
                        </p>
                      </div>
                    )}

                    {storyQuotes.length === 0 ? (
                      <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        Nothing usable was found in the chat. The customer hasn't told us their story yet — ask before generating.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {storyQuotes.map((q, i) => (
                          <button
                            key={i}
                            onClick={() => { setManualDetails(null); toggleAt(setStoryQuotes, i); }}
                            className={`w-full text-left rounded-xl px-3 py-2 border transition ${q.include ? 'bg-white/5 border-white/15' : 'bg-transparent border-white/5 opacity-45'}`}
                          >
                            <p className="text-xs text-gray-100 leading-snug">
                              <span className="text-gray-500 mr-1">{q.include ? '☑' : '☐'}</span>“{q.text}”
                            </p>
                            {q.en ? <p className="text-[10px] text-indigo-300/80 mt-0.5 pl-4">{q.en}</p> : null}
                            {q.whyEn ? <p className="text-[10px] text-gray-500 pl-4">{q.whyEn}</p> : null}
                          </button>
                        ))}
                      </div>
                    )}

                    {leftOut.length > 0 && (
                      <div className="mt-2.5">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Left out of the story ({leftOut.length})</p>
                        <div className="space-y-1">
                          {leftOut.map((t, i) => (
                            <div key={i} className="rounded-lg bg-black/25 border border-white/5 px-2.5 py-1.5 flex items-start gap-2">
                              <p className="text-[11px] text-gray-400 flex-1 leading-snug">{t.text}</p>
                              <button
                                onClick={() => { setManualDetails(null); setStoryQuotes((arr) => [...arr, { text: t.text, en: '', whyEn: 'Added by you from the chat.', include: true }]); }}
                                className="text-[10px] font-semibold text-indigo-300 hover:text-indigo-200 flex-shrink-0"
                              >
                                + Add
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {clarifications.length > 0 && (
                      <div className="mt-2.5">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                          Team notes — <span className="text-amber-300">written by the AI, not the customer</span>
                        </p>
                        <div className="space-y-1">
                          {clarifications.map((c, i) => (
                            <button
                              key={i}
                              onClick={() => { setManualDetails(null); toggleAt(setClarifications, i); }}
                              className={`w-full text-left rounded-lg px-2.5 py-1.5 border transition ${c.include ? 'bg-amber-500/10 border-amber-500/30' : 'bg-transparent border-white/5 opacity-50'}`}
                            >
                              <p className="text-[11px] text-gray-200"><span className="text-gray-500 mr-1">{c.include ? '☑' : '☐'}</span>{c.text}</p>
                              {c.en ? <p className="text-[10px] text-gray-500 pl-4">{c.en}</p> : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* What actually ships */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Exactly what the songwriter receives</p>
                        <button
                          onClick={() => setManualDetails(manualDetails === null ? details : null)}
                          className="text-[10px] font-semibold text-indigo-300 hover:text-indigo-200"
                        >
                          {manualDetails === null ? 'Edit by hand' : 'Back to quotes'}
                        </button>
                      </div>
                      {manualDetails === null ? (
                        <pre className="text-[11px] text-gray-300 whitespace-pre-wrap bg-black/30 border border-white/10 rounded-xl px-3 py-2 max-h-40 overflow-y-auto font-sans">
                          {details || '—'}
                        </pre>
                      ) : (
                        <>
                          <textarea value={manualDetails} onChange={(e) => setManualDetails(e.target.value)} rows={6} className={`${inputCls} resize-y`} />
                          <p className="text-[10px] text-amber-300/80 mt-1">You're editing by hand — this is no longer guaranteed to match the chat.</p>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {questions.length > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-[11px] font-semibold text-amber-200 mb-2">
                      ⚠️ {questions.length} thing{questions.length > 1 ? 's' : ''} the customer never told us
                    </p>
                    <div className="space-y-2">
                      {questions.map((q, i) => (
                        <div key={i} className="rounded-lg bg-black/25 border border-white/10 p-2">
                          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">{q.field}</p>
                          <p className="text-[11px] text-gray-200">{q.questionEn}</p>
                          <p className="text-[11px] text-gray-500 italic mt-0.5">“{q.questionEs}”</p>
                          <button
                            onClick={() => { onAskInSpanish?.(q.questionEs); onClose(); }}
                            className="mt-1.5 text-[10px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-full px-2.5 py-1 transition"
                          >
                            Ask this in Spanish →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── RIGHT: the rest of the brief ────────────────────────── */}
              <div className="min-w-0">
                {phase === 'reading' ? (
                  <div className="h-40 flex flex-col items-center justify-center text-center">
                    <p className="text-2xl mb-2 animate-pulse">✨</p>
                    <p className="text-sm text-gray-300">Reading the conversation…</p>
                    <p className="text-[11px] text-gray-500 mt-1">Pulling out the customer's own words, not a summary.</p>
                  </div>
                ) : (
                  <>
                    {notSongRequest && (
                      <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                        <p className="text-[11px] text-amber-200">
                          This chat doesn't look like a request for a <strong>new</strong> song. If they want an existing song corrected, close this and use <strong>🎧 Send to Ace</strong> instead.
                        </p>
                      </div>
                    )}

                    <p className="text-[11px] text-gray-400 mb-3">
                      Check each field against the quote under it. Anything marked <span className="text-red-300 font-semibold">not mentioned</span> must be asked — never guessed.
                    </p>

                    {/* Names are spelling-checked against the chat before they
                        get here — the name is SUNG, so a "corrected" accent or
                        an expanded nickname is a re-do. */}
                    <Field
                      label="Song is for (recipient)"
                      ev={evidence.recipientName}
                      hint={brief.recipientName ? 'Spelling matched to the customer\'s own message.' : undefined}
                    >
                      <input value={brief.recipientName} onChange={(e) => set({ recipientName: e.target.value })} className={inputCls} placeholder="Ask the customer — don't guess the spelling" />
                    </Field>

                    <Field
                      label="Song is from (sender)"
                      ev={evidence.senderName}
                      hint={brief.senderName ? 'Spelling matched to the customer\'s own message.' : undefined}
                    >
                      <input value={brief.senderName} onChange={(e) => set({ senderName: e.target.value })} className={inputCls} placeholder="Ask the customer — don't guess the spelling" />
                    </Field>

                    <Field label="Relationship" ev={evidence.relationship}>
                      <select value={brief.relationship} onChange={(e) => set({ relationship: e.target.value })} className={selectCls}>
                        <option value="">— pick one —</option>
                        {RELATIONSHIPS.map((r) => <option key={r.id} value={r.id}>{r.en} · {r.name}</option>)}
                      </select>
                      {brief.relationship === 'otro' && (
                        <input value={brief.customRelationship} onChange={(e) => set({ customRelationship: e.target.value })} className={`${inputCls} mt-2`} placeholder="In Spanish, the customer's own words" />
                      )}
                    </Field>

                    <Field label="Occasion" ev={evidence.occasion}>
                      <select value={brief.occasion} onChange={(e) => set({ occasion: e.target.value })} className={selectCls}>
                        <option value="">— pick one —</option>
                        {OCCASIONS.map((o) => <option key={o.id} value={o.id}>{o.en}</option>)}
                      </select>
                      {brief.occasion === 'otro' && (
                        <>
                          <textarea value={brief.customOccasion} onChange={(e) => set({ customOccasion: e.target.value })} rows={2} className={`${inputCls} mt-2 resize-y`} placeholder="In Spanish — what are they celebrating? (20+ characters)" />
                          <select value={brief.emotionalTone} onChange={(e) => set({ emotionalTone: e.target.value })} className={`${selectCls} mt-2`}>
                            <option value="">— emotional tone —</option>
                            {EMOTIONAL_TONES.map((t) => <option key={t.id} value={t.id}>{t.en}</option>)}
                          </select>
                        </>
                      )}
                    </Field>

                    <Field label="Genre" ev={evidence.genre} hint={glossFor(brief.genre) || undefined}>
                      <select value={brief.genre} onChange={(e) => set({ genre: e.target.value, subGenre: '' })} className={selectCls}>
                        <option value="">— pick one —</option>
                        {genreList.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        <option value="otro">Other / not in the list — write it in</option>
                      </select>
                      {brief.genre === 'otro' && (
                        <input value={brief.customStyle} onChange={(e) => set({ customStyle: e.target.value })} maxLength={150} className={`${inputCls} mt-2`} placeholder="The style the customer named (no artist names)" />
                      )}
                    </Field>

                    {brief.genre && brief.genre !== 'otro' && (
                      <Field
                        label="Sub-genre"
                        ev={evidence.subGenre}
                        hint={glossFor(brief.genre, brief.subGenre) || 'Pick the one that matches what they described — sub-genres change the song a lot.'}
                      >
                        <select value={brief.subGenre} onChange={(e) => set({ subGenre: e.target.value })} className={selectCls}>
                          <option value="">— none / let the genre decide —</option>
                          {subGenreList.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}{glossFor(brief.genre, s.id) ? ` — ${glossFor(brief.genre, s.id)}` : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}

                    <Field label="Singer's voice" ev={evidence.voiceType}>
                      <div className="flex gap-2">
                        {VOICE_TYPES.map((v) => (
                          <button
                            key={v.id}
                            onClick={() => set({ voiceType: v.id })}
                            className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold transition ${brief.voiceType === v.id ? 'bg-indigo-500 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
                          >
                            {v.en}
                          </button>
                        ))}
                      </div>
                    </Field>

                    {/* Word-for-word requests — verbatim, same guarantee as the story */}
                    {requestedLines.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-[11px] uppercase tracking-wide text-gray-500">Must be sung word-for-word</label>
                          <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border bg-green-500/15 text-green-300 border-green-500/30">verbatim</span>
                        </div>
                        <div className="space-y-1">
                          {requestedLines.map((r, i) => (
                            <button
                              key={i}
                              onClick={() => toggleAt(setRequestedLines, i)}
                              className={`w-full text-left rounded-lg px-2.5 py-1.5 border transition ${r.include ? 'bg-white/5 border-white/15' : 'bg-transparent border-white/5 opacity-45'}`}
                            >
                              <p className="text-[11px] text-gray-100"><span className="text-gray-500 mr-1">{r.include ? '☑' : '☐'}</span>“{r.text}”</p>
                              {r.en ? <p className="text-[10px] text-indigo-300/80 pl-4">{r.en}</p> : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <Field label="Your own instructions (optional)">
                      <input
                        value={operatorNotes}
                        onChange={(e) => setOperatorNotes(e.target.value)}
                        className={inputCls}
                        placeholder='In Spanish, e.g. "que no sea triste"'
                      />
                    </Field>

                    <Field label="Customer email (the song is delivered here)" ev={evidence.email}>
                      <input value={brief.email} onChange={(e) => set({ email: e.target.value.trim().toLowerCase() })} className={inputCls} placeholder="name@example.com" />
                    </Field>
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-white/10 px-5 py-3">
              {error && <p className="text-[11px] text-red-300 mb-2">{error}</p>}
              {warn && (
                <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <p className="text-[11px] text-amber-200">{warn}</p>
                  <p className="text-[10px] text-amber-200/70 mt-0.5">Press Generate again to create it anyway.</p>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-gray-500 min-w-0 truncate">
                  {phase === 'generating'
                    ? "Writing the lyrics and sending it to the studio — this takes a minute, don't close this."
                    : missing.length
                      ? <>Still needed: <span className="text-amber-300">{missing.join(', ')}</span></>
                      : 'Ready — this creates a real unpaid order, same as a customer submitting the form.'}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={onClose} disabled={busy} className="px-3 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-300 hover:bg-white/10 transition disabled:opacity-40">Cancel</button>
                  <button
                    onClick={generate}
                    disabled={busy || missing.length > 0}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-500 text-white hover:bg-indigo-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {phase === 'generating' ? 'Generating…' : '🎵 Generate song'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
