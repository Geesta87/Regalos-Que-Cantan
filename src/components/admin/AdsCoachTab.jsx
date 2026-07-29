// src/components/admin/AdsCoachTab.jsx
// Meta Ads Coach — two workspaces in one tab:
//   COACH: the advice-only specialist chat (live account + trends + brain +
//          memory + track record).
//   AD FACTORY: the dedicated ad-building workspace. Interview-first: you tell it
//          what you need, it asks the 2-4 questions a real creative director
//          would, then builds finished ads (QC-gated photo + typeset copy) and
//          keeps a gallery of everything it has built.
// Both talk to the ads-coach edge function (thread: 'coach' | 'factory').
// Admin-only. It never changes the ad account.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Target, Send, Loader2, RefreshCw, Sparkles, Check, X, ImagePlus, Wand2 } from 'lucide-react';
import { btn, Badge } from './ui';

const COACH = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ads-coach`;
// Typesetting lives in its own function: the resvg WASM it loads permanently
// occupies a worker, which starved image generation when they shared one.
const RENDER = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ads-coach-render`;

const COACH_STARTERS = [
  'What is my single highest-leverage move right now?',
  'Which of my individual ads is the winner, and which should I kill?',
  'Is any campaign or ad showing signs of fatigue?',
  'Is my campaign structure right, or am I over-fragmented?',
];
const FACTORY_STARTERS = [
  'Build the one ad my account most needs right now',
  'Build me an ad for Día de las Madres',
  'Build 2 distinct concepts to test against my best ad',
];

const COACH_GREETING = "Hi — I'm your Meta ads coach. I can see your live account (spend, sales, real paid orders, individual ads and their creatives, 7 and 30-day trends), and I reason from how Meta's delivery actually works today. Ask me anything — I'll explain the why and give you the exact move.";
const FACTORY_GREETING = "This is the Ad Factory — where I build finished, ready-to-run ads with everything I know about how Meta picks winners. Tell me what you need. If details matter (occasion, who it's for, the angle), I'll ask a couple of sharp questions first, like a creative director taking a brief — then I build: real photo, Spanish headline, subheadline, CTA and price, typeset in your brand style, quality-checked before you see it. Every ad comes with the reason it can win. Say \"you decide\" anytime and I'll make the calls.";

export default function AdsCoachTab({ accessToken, showToast }) {
  const [tab, setTab] = useState('coach'); // 'coach' | 'factory'
  const [msgs, setMsgs] = useState({ coach: [], factory: [] });
  const [calls, setCalls] = useState([]);
  const [ads, setAds] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showImg, setShowImg] = useState(false);
  const [imgConcept, setImgConcept] = useState('');
  const [imgVariation, setImgVariation] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [building, setBuilding] = useState(false);
  // Publish-to-Meta state (Ad Factory → existing ad set, always paused)
  const [publishAd, setPublishAd] = useState(null);
  const [targets, setTargets] = useState([]);
  const [publishTarget, setPublishTarget] = useState('');
  const [pubText, setPubText] = useState('');
  const [pubHeadline, setPubHeadline] = useState('');
  const [pubLink, setPubLink] = useState('https://www.regalosquecantan.com/premium');
  const [publishing, setPublishing] = useState(false);
  const scrollRef = useRef(null);

  const post = useCallback(async (url, payload) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    return res.json().catch(() => ({ success: false, error: `Server returned ${res.status}` }));
  }, [accessToken]);
  const call = useCallback((payload) => post(COACH, payload), [post]);

  // Build a staged ad in TWO requests: generate+QC the photo, then typeset it in
  // the separate renderer. Splitting them is what keeps each request inside
  // Supabase's worker resource limit.
  const buildStagedAd = useCallback(async (spec) => {
    const b1 = await post(COACH, { action: 'execute_build', spec });
    if (!b1.success) return { ok: false, error: b1.error || 'the build did not finish' };
    if (b1.phase !== 'photo') return { ok: true, image: b1.image, ads: b1.ads };
    const b2 = await post(RENDER, { photo_url: b1.photo_url, spec: b1.spec || spec, qc: b1.qc });
    if (!b2.success) return { ok: true, image: b1.photo_url, ads: null, note: 'photo only — the design layer failed' };
    return { ok: true, image: b2.image, ads: b2.ads };
  }, [post]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, f, g] = await Promise.all([
        call({ action: 'history', thread: 'coach' }),
        call({ action: 'history', thread: 'factory' }),
        call({ action: 'list_ads' }),
      ]);
      setMsgs({
        coach: c.success ? (c.messages || []).map((m) => ({ role: m.role, content: m.content })) : [],
        factory: f.success ? (f.messages || []).map((m) => ({ role: m.role, content: m.content })) : [],
      });
      if (c.success) setCalls(c.calls || []);
      if (g.success) setAds(g.ads || []);
    } catch (e) { showToast?.(`Coach: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, sending, tab]);

  const submit = useCallback(async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput('');
    const thread = tab;
    const next = [...msgs[thread], { role: 'user', content: msg }];
    setMsgs((p) => ({ ...p, [thread]: next }));
    setSending(true);
    try {
      const body = await call({ messages: next, thread });
      if (body.success) {
        setMsgs((p) => ({ ...p, [thread]: [...p[thread], { role: 'assistant', content: body.reply, images: body.images, live: body.had_live_data }] }));
        if (body.calls?.length) setCalls(body.calls);
        if (body.ads) setAds(body.ads);
        // The chat replies fast and STAGES the ad; the slow image work happens
        // here in its own requests so the chat turn can never time out.
        if (body.pending_builds?.length) {
          setBuilding(true);
          try {
            const r = await buildStagedAd(body.pending_builds[0]);
            if (r.ok) {
              setMsgs((p) => ({ ...p, [thread]: [...p[thread], { role: 'assistant', content: r.note || 'Here it is.', images: [r.image] }] }));
              if (r.ads) setAds(r.ads);
            } else {
              setMsgs((p) => ({ ...p, [thread]: [...p[thread], { role: 'assistant', content: `The ad didn't finish building — ${r.error}. Ask me to build it again.` }] }));
            }
          } finally { setBuilding(false); }
        }
      } else {
        // Surface the REAL failure: our own error field, or the platform's
        // message/code (e.g. execution-limit errors return {code, message}
        // without our shape) — never a blind "try again".
        const why = body.error || body.message || (body.code ? `platform error ${body.code}` : 'the request didn\'t complete — likely it ran too long; try again');
        showToast?.(`Coach: ${why}`);
        setMsgs((p) => ({ ...p, [thread]: [...p[thread], { role: 'assistant', content: `I couldn't do that just now — ${why}.` }] }));
      }
    } catch (e) {
      showToast?.(`Error: ${e.message}`);
      setMsgs((p) => ({ ...p, [thread]: [...p[thread], { role: 'assistant', content: `Connection problem — ${e.message}. Try again in a moment.` }] }));
    } finally { setSending(false); }
  }, [input, sending, msgs, tab, call, showToast]);

  // Open the publish panel for one Factory ad, prefilling its own copy.
  const openPublish = async (a) => {
    setPublishAd(a);
    setPublishTarget('');
    const c = a.ad_copy || {};
    setPubText(c.subhead || a.concept || '');
    setPubHeadline(Array.isArray(c.headline_lines) ? c.headline_lines.join(' ') : '');
    if (!targets.length) {
      try {
        const body = await call({ action: 'list_ad_targets' });
        if (body.success) setTargets(body.targets || []);
        else showToast?.(`Couldn't load your ad sets: ${body.error || ''}`);
      } catch (e) { showToast?.(`Error: ${e.message}`); }
    }
  };

  const doPublish = async () => {
    if (!publishAd || !publishTarget || publishing) return;
    setPublishing(true);
    try {
      const body = await call({
        action: 'publish_ad', ad_id: publishAd.id, adset_id: publishTarget,
        primary_text: pubText, headline: pubHeadline, link: pubLink,
        ad_name: publishAd.concept || 'Ads Coach ad',
      });
      if (body.success) {
        showToast?.(`Created in Meta — paused, in ${body.adset_name}`);
        setMsgs((p) => ({ ...p, factory: [...p.factory, { role: 'assistant', content: `Published “${publishAd.concept || 'ad'}” into ${body.adset_name} as a PAUSED ad (id ${body.ad_id}). It won't spend until you switch it on in Ads Manager. UTM tracking is attached and Meta's text rewriting is off.` }] }));
        setPublishAd(null);
        const g = await call({ action: 'list_ads' });
        if (g.success) setAds(g.ads || []);
      } else showToast?.(`Publish failed: ${body.error || 'unknown error'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setPublishing(false); }
  };

  const resolve = async (id, verdict) => {
    try {
      const body = await call({ action: 'resolve_call', id, verdict });
      if (body.success) setCalls(body.calls || []);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
  };

  const generateImage = async () => {
    const concept = imgConcept.trim();
    if (!concept || generating) return;
    setGenerating(true);
    setMsgs((p) => ({ ...p, factory: [...p.factory, { role: 'user', content: `🎨 Concept photo: ${concept}${imgVariation ? ' (variation of my best ad)' : ''}` }] }));
    try {
      const body = await call({ action: 'generate_image', concept, variation: imgVariation, count: 1 });
      if (body.success) {
        setMsgs((p) => ({ ...p, factory: [...p.factory, { role: 'assistant', images: body.images, content: 'Here is the text-free concept photo (no copy layer — for finished ads with headline and CTA, just ask me to build the ad instead).' }] }));
        setImgConcept('');
      } else showToast?.(`Image: ${body.error || 'failed'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setGenerating(false); }
  };

  const openCalls = calls.filter((c) => c.status === 'open');
  const resolved = calls.filter((c) => c.status !== 'open');
  const correct = resolved.filter((c) => c.status === 'correct').length;
  const graded = resolved.filter((c) => c.status !== 'dismissed').length;

  const AvatarSm = () => (
    <div className="rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32 }}><Target size={15} className="text-indigo-600" /></div>
  );

  const messages = msgs[tab];
  const starters = tab === 'coach' ? COACH_STARTERS : FACTORY_STARTERS;
  const greeting = tab === 'coach' ? COACH_GREETING : FACTORY_GREETING;

  return (
    <div className="max-w-3xl">
      {/* Header + workspace switcher */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44 }}>
            <Target size={20} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ads Coach</h2>
            <p className="text-xs text-gray-500 mt-0.5">Live account · verified Meta brain · advice-only on your account</p>
          </div>
        </div>
        <button onClick={load} className={btn.iconGhost} title="Reload"><RefreshCw size={16} /></button>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        <button onClick={() => setTab('coach')} className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${tab === 'coach' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          <Target size={14} /> Coach
        </button>
        <button onClick={() => setTab('factory')} className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${tab === 'factory' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          <Wand2 size={14} /> Ad Factory{ads.length > 0 && <span className={`text-[11px] rounded-full px-1.5 ${tab === 'factory' ? 'bg-white/20' : 'bg-indigo-50 text-indigo-700'}`}>{ads.length}</span>}
        </button>
      </div>

      {/* COACH: track record */}
      {tab === 'coach' && (openCalls.length > 0 || resolved.length > 0) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">Track record</span>
            {graded > 0 && <Badge tone={correct / graded >= 0.6 ? 'green' : 'amber'}>{Math.round((correct / graded) * 100)}% ({correct}/{graded})</Badge>}
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {openCalls.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                <div className="min-w-0"><p className="text-sm text-gray-900">{c.recommendation}</p>{c.target_campaign && <p className="text-[11px] text-gray-400 mt-0.5">{c.target_campaign}</p>}</div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => resolve(c.id, 'correct')} title="Right call" className="p-1.5 rounded-lg border border-green-200 text-green-600 hover:bg-green-50"><Check size={13} /></button>
                  <button onClick={() => resolve(c.id, 'wrong')} title="Wrong call" className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><X size={13} /></button>
                  <button onClick={() => resolve(c.id, 'dismissed')} title="Skip" className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 text-gray-400 hover:bg-white">Skip</button>
                </div>
              </div>
            ))}
            {resolved.slice(0, 4).map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <p className="text-xs text-gray-500 truncate">{c.recommendation}</p>
                <Badge tone={c.status === 'correct' ? 'green' : c.status === 'wrong' ? 'red' : 'gray'}>{c.status === 'correct' ? 'Right' : c.status === 'wrong' ? 'Wrong' : 'Skipped'}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FACTORY: gallery of built ads + publish-to-Meta */}
      {tab === 'factory' && ads.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
          <p className="text-sm font-medium text-gray-900 mb-2">Ads built by the factory</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {ads.map((a) => (
              <div key={a.id} className="flex-shrink-0 w-32">
                <a href={a.url} target="_blank" rel="noreferrer" title={a.why_it_wins || a.concept || ''}>
                  <img src={a.url} alt={a.concept || 'ad'} className="w-32 rounded-lg border border-gray-200 hover:opacity-90 transition" />
                </a>
                {a.concept && <p className="text-[11px] text-gray-500 mt-1 truncate">{a.concept}</p>}
                {a.published_ad_id ? (
                  <p className="text-[11px] text-green-700 mt-0.5">✓ In Meta (paused)</p>
                ) : (
                  <button onClick={() => openPublish(a)} className="mt-1 w-full text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded px-2 py-1">
                    Publish to Meta
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Publish panel — explicit confirm, always creates PAUSED */}
          {publishAd && (
            <div className="mt-4 border-t border-gray-200 pt-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">Publish “{publishAd.concept || 'ad'}” to Meta</p>
                <button onClick={() => setPublishAd(null)} className={btn.iconGhost}><X size={15} /></button>
              </div>
              <p className="text-[11px] text-gray-500">
                Creates a new ad inside an ad set you already have — <b>paused</b>, so it can’t spend until you switch it on in Ads Manager.
                UTM tracking is added automatically and Meta’s text rewriting is turned off.
              </p>

              <label className="block text-xs text-gray-600">Put it in this ad set
                <select value={publishTarget} onChange={(e) => setPublishTarget(e.target.value)} disabled={publishing}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white">
                  <option value="">Select an ad set…</option>
                  {targets.map((t) => <option key={t.adset_id} value={t.adset_id}>{t.campaign} → {t.adset_name}</option>)}
                </select>
              </label>

              <label className="block text-xs text-gray-600">Primary text (what people read above the image)
                <textarea rows={2} value={pubText} onChange={(e) => setPubText(e.target.value)} disabled={publishing}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white" />
              </label>

              <div className="flex gap-2">
                <label className="block text-xs text-gray-600 flex-1">Headline
                  <input value={pubHeadline} onChange={(e) => setPubHeadline(e.target.value)} disabled={publishing}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white" />
                </label>
                <label className="block text-xs text-gray-600 flex-1">Destination URL
                  <input value={pubLink} onChange={(e) => setPubLink(e.target.value)} disabled={publishing}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white" />
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={doPublish} disabled={publishing || !publishTarget} className={btn.accent + ' !px-4'}>
                  {publishing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create paused ad in Meta
                </button>
                <button onClick={() => setPublishAd(null)} className={btn.ghost}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conversation */}
      <div ref={scrollRef} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4 overflow-y-auto" style={{ height: tab === 'coach' ? '52vh' : '46vh' }}>
        <div className="flex gap-2.5">
          <AvatarSm />
          <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 max-w-[85%]">
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{greeting}</p>
            {!loading && messages.length === 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {starters.map((s) => (
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
          <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role !== 'user' && <AvatarSm />}
            <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap max-w-[80%] ${m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
              {m.content}
              {m.images && m.images.length > 0 && (
                <div className={`mt-2 grid gap-2 ${m.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {m.images.map((u, k) => (
                    <a key={k} href={u} target="_blank" rel="noreferrer" title="Open / download full size" className="block">
                      <img src={u} alt="Generated ad" className="rounded-lg border border-gray-200 w-full hover:opacity-90 transition" />
                    </a>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && m.live === false && (
                <span className="block mt-1.5 text-[11px] text-amber-600">⚠ answered on principle — couldn't pull fresh account numbers this turn</span>
              )}
            </div>
          </div>
        ))}
        {(sending || building) && <div className="flex gap-2.5"><AvatarSm /><div className="bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {building ? 'Building the ad — photo, quality check, then the design layer (about a minute)' : (tab === 'factory' ? 'Working…' : 'Reading your account…')}</div></div>}
      </div>

      {/* FACTORY: manual concept-photo panel */}
      {tab === 'factory' && (
        <div className="mt-3">
          <button onClick={() => setShowImg((s) => !s)} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800">
            <ImagePlus size={14} /> {showImg ? 'Hide concept-photo tool' : 'Concept photo only (no copy layer)'}
          </button>
          {showImg && (
            <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3 space-y-2">
              <textarea value={imgConcept} onChange={(e) => setImgConcept(e.target.value)} rows={2} disabled={generating}
                placeholder="Describe the photo… (for finished ads with headline + CTA, just ask in the chat above instead)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-indigo-400 disabled:opacity-60" />
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={imgVariation} onChange={(e) => setImgVariation(e.target.checked)} disabled={generating} /> Variation of my best ad</label>
                <button onClick={generateImage} disabled={generating || !imgConcept.trim()} className={btn.accent + ' !px-3 !py-1.5 !text-xs ml-auto'}>
                  {generating ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Generate
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <div className="flex items-center gap-2 mt-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} disabled={sending || loading}
          placeholder={tab === 'coach' ? 'Ask your ads coach… (e.g. "which of my ads should I kill?")' : 'Tell the factory what you need… (e.g. "build me an ad for mamá\'s birthday")'}
          className="flex-1 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-indigo-400 disabled:opacity-60" />
        <button onClick={() => submit()} disabled={sending || loading || !input.trim()} className={btn.accent + ' !px-4'}><Send size={15} /></button>
      </div>
    </div>
  );
}
