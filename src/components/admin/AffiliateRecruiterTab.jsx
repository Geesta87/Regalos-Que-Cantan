// src/components/admin/AffiliateRecruiterTab.jsx
// "Recruit Partners" — the Affiliate Recruiter agent's screen. Shows ranked
// creator prospects (TikTok/IG) with a ready-to-send Spanish outreach DM. This
// is Ivan's daily workspace: work the "To contact" queue top-down — one click
// opens the creator's profile AND copies the DM, then mark it sent. Chase warm
// leads from "Follow up", and convert them into a real affiliate on reply
// (reuses create-affiliate). Open to admin + assistant roles.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UserPlus, RefreshCw, Loader2, Copy, Check, X, ExternalLink, SlidersHorizontal, Users, Heart, Film, ChevronLeft, ChevronRight, Send, Mail, Clock, Globe, Phone, CalendarDays, MessageCircle } from 'lucide-react';
import { Card, Badge, btn } from './ui';

const PAGE_SIZE = 15;
const FOLLOWUP_DAYS = 4; // "contacted this long ago, no reply" → worth a nudge

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-recruiter-admin`;
const STATUS = {
  new: { label: 'New', tone: 'amber' },
  contacted: { label: 'Contacted', tone: 'accent' },
  responded: { label: 'Replied', tone: 'accent' },
  converted: { label: 'Affiliate', tone: 'green' },
};
const fmt = (n) => (n == null ? '—' : Intl.NumberFormat('en', { notation: 'compact' }).format(n));
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const isFollowup = (p) => p.status === 'contacted' && p.contacted_at && daysAgo(p.contacted_at) >= FOLLOWUP_DAYS;

// Scheduled intro calls booked on /partners (partner_call_bookings)
const CALL_STATUS = {
  pending: { label: 'New request', tone: 'amber' },
  confirmed: { label: 'Confirmed', tone: 'accent' },
  done: { label: 'Done', tone: 'green' },
  no_show: { label: 'No-show', tone: 'gray' },
};
const fmtPhone = (d) => {
  const s = String(d || '');
  if (s.length === 10) return `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}`;
  if (s.length === 11 && s.startsWith('1')) return `(${s.slice(1, 4)}) ${s.slice(4, 7)}-${s.slice(7)}`;
  return s;
};
const waNumber = (d) => (String(d || '').length === 10 ? `1${d}` : String(d || ''));
const callDateLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const isPastCall = (b) => new Date(`${b.preferred_date}T23:59:59`) < new Date();

export default function AffiliateRecruiterTab({ accessToken, showToast }) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [convertId, setConvertId] = useState(null);
  const [email, setEmail] = useState('');
  const [platform, setPlatform] = useState('all');
  const [view, setView] = useState('queue'); // queue (to contact) | followup | all
  // Search criteria for the next scan (steer who the recruiter goes after)
  const [showFilters, setShowFilters] = useState(false);
  const [minF, setMinF] = useState('');
  const [maxF, setMaxF] = useState('');
  const [terms, setTerms] = useState('');
  const [page, setPage] = useState(1);
  const [scanActive, setScanActive] = useState(false); // polling while a scan is landing
  // Scheduled Calls sub-tab
  const [section, setSection] = useState('prospects'); // prospects | calls
  const [calls, setCalls] = useState([]);
  const [callsLoading, setCallsLoading] = useState(true);
  const [callBusyId, setCallBusyId] = useState(null);

  const call = useCallback(async (payload) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    return res.json();
  }, [accessToken]);

  const load = useCallback(async () => {
    try {
      const r = await call({ action: 'list' });
      if (r.success) {
        setProspects(r.prospects || []);
        const startedAt = r.last_scan?.started_at ? new Date(r.last_scan.started_at).getTime() : 0;
        if (startedAt && Date.now() - startedAt < 150000) setScanActive(true);
      } else showToast?.(`Error: ${r.error || 'could not load'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLoading(false); }
  }, [call, showToast]);

  useEffect(() => { load(); }, [load]);

  const loadCalls = useCallback(async () => {
    try {
      const r = await call({ action: 'calls_list' });
      if (r.success) setCalls(r.calls || []);
      else showToast?.(`Error: ${r.error || 'could not load calls'}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setCallsLoading(false); }
  }, [call, showToast]);

  useEffect(() => { loadCalls(); }, [loadCalls]);

  const updateCall = async (id, status) => {
    setCallBusyId(id);
    try {
      const r = await call({ action: 'call_update', call_id: id, status });
      if (r.success) {
        if (status === 'cancelled') setCalls((c) => c.filter((x) => x.id !== id));
        else setCalls((c) => c.map((x) => x.id === id ? { ...x, status } : x));
      } else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setCallBusyId(null); }
  };

  // While a scan is landing, poll every 8s (max ~2.5 min) so results surface even
  // if the owner navigated away and came back. Results themselves persist in the DB.
  useEffect(() => {
    if (!scanActive) return;
    const iv = setInterval(load, 8000);
    const stop = setTimeout(() => setScanActive(false), 150000);
    return () => { clearInterval(iv); clearTimeout(stop); };
  }, [scanActive, load]);

  const scan = async () => {
    setScanning(true);
    try {
      const filters = {};
      if (minF !== '' && Number.isFinite(Number(minF))) filters.min_followers = Number(minF);
      if (maxF !== '' && Number.isFinite(Number(maxF))) filters.max_followers = Number(maxF);
      const t = terms.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      if (t.length) filters.niches = t;
      if (platform !== 'all') filters.platform = platform;
      const r = await call({ action: 'scan', ...filters });
      if (r.success) { showToast?.('Scanning for creators… results appear here in ~1 min (you can leave this page).'); setScanActive(true); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setScanning(false); }
  };

  const setStatus = async (id, status) => {
    setBusyId(id);
    try {
      const r = await call({ action: 'status', id, status });
      if (r.success) {
        if (status === 'dismissed') setProspects((p) => p.filter((x) => x.id !== id));
        else setProspects((p) => p.map((x) => x.id === id ? { ...x, status, contacted_at: r.contacted_at ?? x.contacted_at } : x));
      } else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const convert = async (id) => {
    if (!email.trim()) { showToast?.("Enter the creator's email"); return; }
    setBusyId(id);
    try {
      const r = await call({ action: 'convert', id, email });
      if (r.success) { showToast?.(`Affiliate created: ${r.code} (email sent)`); setProspects((p) => p.map((x) => x.id === id ? { ...x, status: 'converted', affiliate_code: r.code } : x)); setConvertId(null); setEmail(''); }
      else showToast?.(`Error: ${r.error}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const copy = (text, label) => { navigator.clipboard?.writeText(text || ''); showToast?.(label || 'Message copied'); };

  // One-click outreach: copy the DM to the clipboard AND open the creator's
  // profile in a new tab (where the Message button is one tap). Ivan pastes,
  // sends, then hits "Mark sent".
  const openAndMessage = (p) => {
    copy(p.outreach_draft || '', 'DM copied — paste it in the message box');
    if (p.profile_url) window.open(p.profile_url, '_blank', 'noopener,noreferrer');
  };

  // Reset to page 1 whenever the filters change.
  useEffect(() => { setPage(1); }, [platform, view]);

  const counts = useMemo(() => {
    const c = { new: 0, contacted: 0, responded: 0, converted: 0, followup: 0 };
    for (const p of prospects) { if (c[p.status] != null) c[p.status] += 1; if (isFollowup(p)) c.followup += 1; }
    return c;
  }, [prospects]);

  const shown = useMemo(() => {
    let base = prospects;
    if (view === 'queue') base = prospects.filter((p) => p.status === 'new');
    else if (view === 'followup') base = prospects.filter(isFollowup);
    return base.filter((p) => platform === 'all' || p.platform === platform);
  }, [prospects, view, platform]);

  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const upcomingCallCount = useMemo(
    () => calls.filter((b) => !isPastCall(b) && (b.status === 'pending' || b.status === 'confirmed')).length,
    [calls],
  );

  const VIEWS = [
    ['queue', `To contact${counts.new ? ` · ${counts.new}` : ''}`],
    ['followup', `Follow up${counts.followup ? ` · ${counts.followup}` : ''}`],
    ['all', 'All'],
  ];

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><UserPlus size={22} className="text-gray-700" /> Recruit Partners</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">Latino creators who'd make great affiliates, ranked by fit. Work the <b>To contact</b> queue top-down: one click opens their profile and copies the Spanish DM — paste, send, mark it sent. Convert them when they reply. (We never auto-DM.)</p>
        </div>
        {section === 'prospects' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setShowFilters((s) => !s)} className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition ${showFilters ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              <SlidersHorizontal size={15} /> Filters
            </button>
            <button onClick={scan} disabled={scanning} className={btn.primary}>
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Scan now
            </button>
          </div>
        )}
      </div>

      {/* Section switcher: creator prospects vs scheduled intro calls */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          ['prospects', 'Prospects'],
          ['calls', `Scheduled Calls${upcomingCallCount ? ` · ${upcomingCallCount}` : ''}`],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setSection(k)} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition ${section === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {k === 'calls' && <CalendarDays size={14} />}{label}
          </button>
        ))}
      </div>

      {section === 'calls' ? (
        /* ---- Scheduled Calls: no-commitment intro calls booked on /partners ---- */
        callsLoading ? (
          <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : calls.length === 0 ? (
          <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
            No calls booked yet. When someone schedules a call on the /partners page, it shows up here.
          </div>
        ) : (
          <div className="space-y-6">
            {[
              ['Upcoming', calls.filter((b) => !isPastCall(b))],
              ['Past', calls.filter(isPastCall).reverse()],
            ].map(([groupLabel, group]) => group.length > 0 && (
              <div key={groupLabel}>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">{groupLabel} <span className="text-gray-400 font-normal">· {group.length}</span></h3>
                <div className="space-y-3">
                  {group.map((b) => {
                    const cs = CALL_STATUS[b.status] || { label: b.status, tone: 'gray' };
                    return (
                      <Card key={b.id} className="p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-900">{b.name}</span>
                              <Badge tone={cs.tone}>{cs.label}</Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-[13px] text-gray-600 flex-wrap">
                              <span className="flex items-center gap-1 font-medium"><CalendarDays size={13} /> {callDateLabel(b.preferred_date)} · {b.preferred_time} <span className="text-gray-400 font-normal">PT</span></span>
                              <span className="flex items-center gap-1"><Phone size={12} /> {fmtPhone(b.phone)}</span>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1">Requested {new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 items-center flex-shrink-0">
                            <a href={`https://wa.me/${waNumber(b.phone)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-white hover:bg-black">
                              <MessageCircle size={13} /> WhatsApp
                            </a>
                            {b.status === 'pending' && (
                              <button onClick={() => updateCall(b.id, 'confirmed')} disabled={callBusyId === b.id} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                                <Check size={12} /> Confirm
                              </button>
                            )}
                            {(b.status === 'pending' || b.status === 'confirmed') && (
                              <>
                                <button onClick={() => updateCall(b.id, 'done')} disabled={callBusyId === b.id} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">Done</button>
                                <button onClick={() => updateCall(b.id, 'no_show')} disabled={callBusyId === b.id} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">No-show</button>
                              </>
                            )}
                            <button onClick={() => updateCall(b.id, 'cancelled')} disabled={callBusyId === b.id} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 flex items-center gap-1" title="Remove">
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
      <>
      {/* Scoreboard — where the pipeline stands right now */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[['To contact', counts.new, 'text-amber-600'], ['Contacted', counts.contacted, 'text-gray-900'], ['Replied', counts.responded, 'text-indigo-600'], ['Affiliates', counts.converted, 'text-green-600']].map(([label, n, cls]) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
            <div className={`text-2xl font-bold ${cls}`}>{n}</div>
            <div className="text-[11px] text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Search criteria — steer who the recruiter goes after on the next scan */}
      {showFilters && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3.5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Who to look for</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">Min followers
              <input type="number" min="0" value={minF} onChange={(e) => setMinF(e.target.value)} placeholder="3,000"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
            </label>
            <label className="text-xs text-gray-600">Max followers
              <input type="number" min="0" value={maxF} onChange={(e) => setMaxF(e.target.value)} placeholder="1,500,000"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
            </label>
          </div>
          <label className="text-xs text-gray-600 block">Search terms / niches <span className="text-gray-400">(comma-separated)</span>
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2}
              placeholder="canción personalizada, regalo personalizado, quinceañera, boda mexicana, música regional mexicana"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white resize-none" />
          </label>
          <p className="text-[11px] text-gray-400">
            Leave blank to use the defaults (3K–1.5M followers, standard niches). These filters apply when you hit <b>Scan now</b>. Search terms stay in Spanish to match the creators you're targeting.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {/* Work view: what to do next */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {VIEWS.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1 text-sm rounded-md transition ${view === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
          ))}
        </div>
        {/* Platform filter */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {[['all', 'All'], ['tiktok', 'TikTok'], ['instagram', 'Instagram']].map(([k, label]) => (
            <button key={k} onClick={() => setPlatform(k)} className={`px-3 py-1 text-sm rounded-md transition ${platform === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
          ))}
        </div>
      </div>

      {scanActive && (
        <div className="mb-3 flex items-center gap-2 text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
          <Loader2 size={15} className="animate-spin" /> Scanning for creators… results will appear here automatically.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          {view === 'queue' ? 'Queue is clear — nobody left to contact. Hit "Scan now" for more, or check Follow up.'
            : view === 'followup' ? 'No follow-ups due. Anyone contacted 4+ days ago with no reply lands here.'
            : 'No prospects yet. Hit "Scan now" — or the weekly scan will fill this in.'}
        </div>
      ) : (
        <>
        <div className="flex items-center justify-between mb-3 text-xs text-gray-500">
          <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, shown.length)} of {shown.length}</span>
        </div>
        <div className="space-y-3">
          {pageItems.map((p) => {
            const sm = STATUS[p.status] || { label: p.status, tone: 'gray' };
            const dAgo = daysAgo(p.contacted_at);
            return (
              <Card key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{p.display_name || p.handle}</span>
                      <a href={p.profile_url} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline flex items-center gap-0.5">@{p.handle} <ExternalLink size={12} /></a>
                      <Badge tone="gray">{p.platform}</Badge>
                      <Badge tone={sm.tone}>{sm.label}</Badge>
                      {p.status === 'contacted' && dAgo != null && (
                        <span className={`text-[11px] flex items-center gap-0.5 ${isFollowup(p) ? 'text-amber-600' : 'text-gray-400'}`}><Clock size={11} /> {dAgo === 0 ? 'today' : `${dAgo}d ago`}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[12px] text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1"><Users size={12} /> {fmt(p.followers)} followers</span>
                      {p.likes != null && <span className="flex items-center gap-1"><Heart size={12} /> {fmt(p.likes)}</span>}
                      {p.videos != null && <span className="flex items-center gap-1"><Film size={12} /> {fmt(p.videos)}</span>}
                      <span className="text-gray-300">·</span>
                      <span>via "{p.niche}"</span>
                    </div>
                    {p.fit_reason && <p className="text-xs text-gray-600 mt-1.5">{p.fit_reason}</p>}
                    {/* Contact details captured from the bio (email outreach lane) */}
                    {(p.business_email || p.external_url) && (
                      <div className="flex items-center gap-3 mt-1.5 text-[12px] flex-wrap">
                        {p.business_email && (
                          <button onClick={() => copy(p.business_email, 'Email copied')} className="flex items-center gap-1 text-indigo-600 hover:underline" title="Copy email">
                            <Mail size={12} /> {p.business_email}
                          </button>
                        )}
                        {p.external_url && (
                          <a href={p.external_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-gray-500 hover:underline">
                            <Globe size={12} /> website
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold text-gray-900">{p.fit_score ?? '—'}</div>
                    <div className="text-[10px] text-gray-400">fit</div>
                  </div>
                </div>

                {p.outreach_draft && p.status !== 'converted' && (
                  <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed relative">
                    {p.outreach_draft}
                    <button onClick={() => copy(p.outreach_draft, 'Message copied')} className="absolute top-2 right-2 text-gray-400 hover:text-gray-700" title="Copy"><Copy size={14} /></button>
                  </div>
                )}

                {p.status === 'converted' ? (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-green-700"><Check size={14} /> Affiliate created{p.affiliate_code ? ` · code ${p.affiliate_code}` : ''}</div>
                ) : convertId === p.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Creator's email" type="email"
                      className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
                    <button onClick={() => convert(p.id)} disabled={busyId === p.id} className={btn.success + ' !text-sm'}>
                      {busyId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Create affiliate
                    </button>
                    <button onClick={() => { setConvertId(null); setEmail(''); }} className="text-sm text-gray-500 px-2 hover:text-gray-700">Cancel</button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    {/* Primary action: open profile + copy DM in one click */}
                    {(p.status === 'new' || p.status === 'contacted') && p.profile_url && (
                      <button onClick={() => openAndMessage(p)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-white hover:bg-black">
                        <Send size={13} /> Open &amp; message
                      </button>
                    )}
                    {p.status === 'new' && <button onClick={() => setStatus(p.id, 'contacted')} disabled={busyId === p.id} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"><Check size={12} /> Mark sent</button>}
                    {p.status === 'contacted' && <button onClick={() => setStatus(p.id, 'responded')} disabled={busyId === p.id} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">They replied</button>}
                    <button onClick={() => { setConvertId(p.id); setEmail(p.business_email || ''); }} className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Convert to affiliate</button>
                    <button onClick={() => setStatus(p.id, 'dismissed')} disabled={busyId === p.id} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 flex items-center gap-1"><X size={12} /> Dismiss</button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-5">
            <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={safePage <= 1}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40 hover:bg-gray-50">
              <ChevronLeft size={15} /> Prev
            </button>
            <span className="text-sm text-gray-500">Page {safePage} of {totalPages}</span>
            <button onClick={() => setPage((n) => Math.min(totalPages, n + 1))} disabled={safePage >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40 hover:bg-gray-50">
              Next <ChevronRight size={15} />
            </button>
          </div>
        )}
        </>
      )}
      </>
      )}
    </div>
  );
}
