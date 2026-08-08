// src/components/admin/ClonamivozAdminTab.jsx
//
// Admin tab for the Clona Mi Voz tier (redesigned 2026-08-08 on the shared
// admin layout patterns but keeping this tab's existing PINK accent (brand
// color the tab has always used), white cards, Material icons, English.
//
// Reads from admin-cloned-voice-songs (admin-auth posture identical to
// admin-songs; 'assistant' role gets revenue fields redacted server-side).
// Still read-only — no mutations.
//
// Since the Suno Voice launch, orders carry voice_task_id: non-null means
// the song was generated with the customer's REAL cloned voice (persona
// engine); null means the legacy upload-cover engine. Test-mode orders are
// detected by the TEST_BYPASS_ prefix the bypass fn stamps on
// stripe_payment_intent — they show a "Test" badge and are EXCLUDED from
// the revenue stat so test runs never inflate the money numbers.
//
// Props
// -----
//   accessToken: Supabase user JWT (verified upstream by the dashboard).
//   role:        'admin' | 'assistant' — hides revenue for assistants.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, Badge as UiBadge, Stat, SectionLabel, btn } from './ui';

// Local badge with this tab's pink brand accent + blue in-progress tone.
// (Shared ui.jsx Badge only ships gray/green/amber/red/indigo.)
const LOCAL_TONES = {
  pink: 'bg-pink-100 text-pink-700',
  blue: 'bg-blue-100 text-blue-700',
};
function Badge({ tone = 'gray', children, className = '' }) {
  if (LOCAL_TONES[tone]) {
    return (
      <span
        className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${LOCAL_TONES[tone]} ${className}`}
      >
        {children}
      </span>
    );
  }
  return <UiBadge tone={tone} className={className}>{children}</UiBadge>;
}

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

const FN_URL = `${SUPABASE_URL}/functions/v1/admin-cloned-voice-songs`;

// Status → badge tone (ui.jsx tones) + label.
const STATUS_META = {
  pending:            { tone: 'gray',   label: 'Pending' },
  generating_lyrics:  { tone: 'blue',   label: 'Writing lyrics' },
  lyrics_ready:       { tone: 'blue',   label: 'Lyrics ready' },
  generating_preview: { tone: 'blue',   label: 'Generating preview' },
  preview_ready:      { tone: 'amber',  label: 'Preview ready' },
  awaiting_payment:   { tone: 'amber',  label: 'In checkout' },
  paid:               { tone: 'green',  label: 'Paid · queued' },
  generating_song:    { tone: 'blue',   label: 'Generating song' },
  success:            { tone: 'green',  label: 'Ready' },
  failed:             { tone: 'red',    label: 'Failed' },
};

const ACTIVE_STATUSES = ['generating_preview', 'generating_song', 'paid', 'awaiting_payment'];

const STATUS_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'paid',    label: 'Paid' },
  { key: 'preview', label: 'Preview only' },
  { key: 'active',  label: 'In progress' },
  { key: 'failed',  label: 'Failed' },
];

const ENGINE_FILTERS = [
  { key: 'all',    label: 'All engines' },
  { key: 'cloned', label: 'Cloned voice' },
  { key: 'legacy', label: 'Classic' },
];

const isTestOrder = (s) => (s.stripe_payment_intent || '').startsWith('TEST_BYPASS');
const isClonedEngine = (s) => Boolean(s.voice_task_id);

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatMoney(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ClonamivozAdminTab({ accessToken, role }) {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [engineFilter, setEngineFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedSongId, setSelectedSongId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const fetchSongs = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'list', limit: 500 }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setSongs(data.songs || []);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error('[ClonamivozAdminTab] fetch failed:', e);
      setError(e.message || 'Could not load orders.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  async function loadDetail(id) {
    setSelectedSongId(id);
    setSelectedDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'detail', id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setSelectedDetail(data.song);
    } catch (e) {
      console.error('[ClonamivozAdminTab] detail failed:', e);
      setSelectedDetail({ _error: e.message || 'Error loading details' });
    } finally {
      setDetailLoading(false);
    }
  }

  const filteredSongs = useMemo(() => {
    let rows = songs;
    if (filter === 'paid') rows = rows.filter((s) => s.paid);
    else if (filter === 'preview') rows = rows.filter((s) => !s.paid && s.status === 'preview_ready');
    else if (filter === 'failed') rows = rows.filter((s) => s.status === 'failed');
    else if (filter === 'active') rows = rows.filter((s) => ACTIVE_STATUSES.includes(s.status));

    if (engineFilter === 'cloned') rows = rows.filter(isClonedEngine);
    else if (engineFilter === 'legacy') rows = rows.filter((s) => !isClonedEngine(s));

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (s) =>
          (s.customer_email || '').toLowerCase().includes(q) ||
          (s.recipient_name || '').toLowerCase().includes(q) ||
          (s.id || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [songs, filter, engineFilter, search]);

  const counts = useMemo(
    () => ({
      all: songs.length,
      paid: songs.filter((s) => s.paid).length,
      preview: songs.filter((s) => !s.paid && s.status === 'preview_ready').length,
      failed: songs.filter((s) => s.status === 'failed').length,
      active: songs.filter((s) => ACTIVE_STATUSES.includes(s.status)).length,
    }),
    [songs]
  );

  // Revenue counts REAL payments only — bypass/test orders excluded.
  const stats = useMemo(() => {
    const realPaid = songs.filter((s) => s.paid && !isTestOrder(s));
    return {
      revenueCents: realPaid.reduce((sum, s) => sum + (s.amount_cents || 0), 0),
      realPaidCount: realPaid.length,
      testCount: songs.filter((s) => s.paid && isTestOrder(s)).length,
      clonedCount: songs.filter(isClonedEngine).length,
    };
  }, [songs]);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <span className="material-symbols-outlined text-pink-600">record_voice_over</span>
            Clona Mi Voz
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Voice-clone song orders · $69 tier · /clonamivoz
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-gray-400 hidden sm:inline">
              Updated{' '}
              {lastRefreshed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button type="button" onClick={fetchSongs} disabled={loading} className={btn.ghost}>
            <span className={`material-symbols-outlined text-base ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${role === 'admin' ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-2`}>
        <Stat label="Orders" value={counts.all} />
        <Stat label="Paid (real)" value={stats.realPaidCount} tone={stats.realPaidCount ? 'green' : undefined} />
        {role === 'admin' && (
          <Stat label="Revenue" value={formatMoney(stats.revenueCents)} tone="green" />
        )}
        <Stat label="Cloned voice" value={stats.clonedCount} />
        <Stat label="In progress" value={counts.active} />
        <Stat label="Failed" value={counts.failed} tone={counts.failed ? 'red' : undefined} />
      </div>

      {/* Toolbar */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    active
                      ? 'bg-pink-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f.label}
                  <span className={`ml-1 ${active ? 'text-pink-200' : 'text-gray-400'}`}>
                    {counts[f.key] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="h-5 w-px bg-gray-200 hidden sm:block" />
          <div className="flex items-center gap-1.5">
            {ENGINE_FILTERS.map((f) => {
              const active = engineFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setEngineFilter(f.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    active
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-lg pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Email, recipient, or order ID"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-3 border-red-200 bg-red-50">
          <div className="flex items-center gap-2 text-sm text-red-600">
            <span className="material-symbols-outlined text-base">error</span>
            {error}
            <button type="button" onClick={fetchSongs} className="ml-auto text-xs font-medium underline">
              Retry
            </button>
          </div>
        </Card>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Genre</th>
                <th className="px-4 py-3">Engine</th>
                <th className="px-4 py-3">Status</th>
                {role === 'admin' && <th className="px-4 py-3 text-right">Amount</th>}
                <th className="px-4 py-3">Audio</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading &&
                songs.length === 0 &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="animate-pulse">
                    {Array.from({ length: role === 'admin' ? 8 : 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-3 bg-gray-100 rounded w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))}

              {!loading && filteredSongs.length === 0 && (
                <tr>
                  <td colSpan={role === 'admin' ? 8 : 7} className="px-4 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-gray-200 block mb-2">
                      music_off
                    </span>
                    <p className="text-sm text-gray-400">
                      {songs.length === 0 ? 'No orders yet.' : 'No orders match the current filters.'}
                    </p>
                  </td>
                </tr>
              )}

              {filteredSongs.map((s) => {
                const meta = STATUS_META[s.status] || { tone: 'gray', label: s.status };
                const fullUrls = s.permanent_audio_urls?.length
                  ? s.permanent_audio_urls
                  : s.suno_audio_urls || [];
                return (
                  <tr
                    key={s.id}
                    onClick={() => loadDetail(s.id)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {formatDateTime(s.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 truncate max-w-[200px]">
                        {s.customer_email || 'No email'}
                      </div>
                      <div className="text-xs text-gray-400 truncate max-w-[200px]">
                        For {s.recipient_name || '—'}
                        {s.occasion ? ` · ${s.occasion}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 capitalize whitespace-nowrap">
                      {(s.genre_slug || '—').replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isClonedEngine(s) ? (
                        <Badge tone="pink">
                          <span className="material-symbols-outlined text-xs mr-0.5">fingerprint</span>
                          Cloned voice
                        </Badge>
                      ) : (
                        <Badge tone="gray">Classic</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {s.paid && isTestOrder(s) && <Badge tone="amber">Test</Badge>}
                        {s.paid && !isTestOrder(s) && <Badge tone="green">Paid</Badge>}
                      </div>
                    </td>
                    {role === 'admin' && (
                      <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                        {s.paid && !isTestOrder(s) ? formatMoney(s.amount_cents) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {s.preview_audio_url && (
                          <a
                            href={s.preview_audio_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Preview"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs font-medium transition-colors"
                          >
                            <span className="material-symbols-outlined text-sm">headphones</span>
                            Preview
                          </a>
                        )}
                        {fullUrls.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Version ${i + 1}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-pink-50 text-pink-600 hover:bg-pink-100 text-xs font-medium transition-colors"
                          >
                            <span className="material-symbols-outlined text-sm">music_note</span>
                            V{i + 1}
                          </a>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="material-symbols-outlined text-gray-300 text-lg">
                        chevron_right
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredSongs.length > 0 && (
          <div className="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-400">
            Showing {filteredSongs.length} of {songs.length} orders
          </div>
        )}
      </Card>

      {/* Detail drawer */}
      {selectedSongId && (
        <DetailDrawer
          songId={selectedSongId}
          detail={selectedDetail}
          loading={detailLoading}
          role={role}
          onClose={() => {
            setSelectedSongId(null);
            setSelectedDetail(null);
          }}
        />
      )}
    </div>
  );
}

function DetailDrawer({ songId, detail, loading, role, onClose }) {
  const d = detail && !detail._error ? detail : null;
  const meta = d ? STATUS_META[d.status] || { tone: 'gray', label: d.status } : null;
  const fullUrls = d
    ? d.permanent_audio_urls?.length
      ? d.permanent_audio_urls.map((u) => ({ url: u, permanent: true }))
      : (d.suno_audio_urls || []).map((u) => ({ url: u, permanent: false }))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-gray-900">Order detail</h3>
              {d && <Badge tone={meta.tone}>{meta.label}</Badge>}
              {d &&
                (isClonedEngine(d) ? (
                  <Badge tone="pink">
                    <span className="material-symbols-outlined text-xs mr-0.5">fingerprint</span>
                    Cloned voice
                  </Badge>
                ) : (
                  <Badge tone="gray">Classic engine</Badge>
                ))}
              {d && d.paid && isTestOrder(d) && <Badge tone="amber">Test bypass</Badge>}
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(songId).catch(() => {})}
              title="Copy order ID"
              className="mt-1 text-[11px] text-gray-400 font-mono break-all text-left hover:text-pink-600 transition-colors"
            >
              {songId}
            </button>
          </div>
          <button type="button" onClick={onClose} className={btn.iconGhost}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {loading && (
            <div className="space-y-3 animate-pulse py-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 bg-gray-100 rounded w-full" />
              ))}
            </div>
          )}
          {detail?._error && (
            <Card className="p-3 border-red-200 bg-red-50 text-sm text-red-600">
              {detail._error}
            </Card>
          )}

          {d && (
            <>
              {/* Audio */}
              {(d.preview_audio_url || fullUrls.length > 0) && (
                <section className="space-y-3">
                  <SectionLabel>Audio</SectionLabel>
                  {d.preview_audio_url && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Preview</p>
                      <audio controls src={d.preview_audio_url} className="w-full h-9" />
                    </div>
                  )}
                  {fullUrls.map((f, i) => (
                    <div key={i}>
                      <p className="text-xs text-gray-500 mb-1">
                        Full song · version {i + 1}
                        {!f.permanent && (
                          <span className="text-amber-600 ml-1">(Suno link — may expire)</span>
                        )}
                      </p>
                      <audio controls src={f.url} className="w-full h-9" />
                    </div>
                  ))}
                </section>
              )}

              {/* Customer & story */}
              <section className="space-y-3">
                <SectionLabel>Customer</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email" value={d.customer_email} />
                  <Field label="Recipient" value={d.recipient_name} />
                  <Field label="Relationship" value={d.relationship} />
                  <Field label="Occasion" value={d.occasion} />
                  <Field label="Genre" value={(d.genre_slug || '').replace(/_/g, ' ')} />
                  <Field label="Language" value={d.language} />
                </div>
                <Field label="Story" value={d.story} multiline />
              </section>

              {/* Lyrics */}
              {d.lyrics && (
                <section className="space-y-2">
                  <SectionLabel>Lyrics{d.title ? ` — ${d.title}` : ''}</SectionLabel>
                  <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {d.lyrics}
                  </div>
                </section>
              )}

              {/* Payment */}
              <section className="space-y-3">
                <SectionLabel>Payment</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Paid"
                    value={d.paid ? (isTestOrder(d) ? 'Yes — test bypass' : 'Yes') : 'No'}
                  />
                  <Field label="Paid at" value={formatDateTime(d.paid_at)} />
                  {role === 'admin' && (
                    <Field label="Amount" value={isTestOrder(d) ? '— (test)' : formatMoney(d.amount_cents)} />
                  )}
                  <Field label="Stripe session" value={d.stripe_session_id} mono small />
                  <Field label="Payment intent" value={d.stripe_payment_intent} mono small />
                </div>
              </section>

              {/* Pipeline */}
              <section className="space-y-3">
                <SectionLabel>Pipeline</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Engine"
                    value={isClonedEngine(d) ? 'Suno Voice (cloned)' : 'Upload-cover (classic)'}
                  />
                  <Field label="Voice task / persona" value={d.voice_task_id} mono small />
                  <Field label="Kie task (song)" value={d.kie_task_id} mono small />
                  <Field label="Kie task (preview)" value={d.preview_kie_task_id} mono small />
                  <Field label="Voice sample" value={d.voice_sample_id} mono small />
                  <Field label="Completed" value={formatDateTime(d.completed_at)} />
                </div>
              </section>

              {d.error_message && (
                <Card className="p-3 border-red-200 bg-red-50">
                  <p className="text-xs font-semibold text-red-600 mb-1">Error</p>
                  <p className="text-sm text-red-600">{d.error_message}</p>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, multiline, mono, small }) {
  return (
    <div className={multiline ? 'col-span-2' : ''}>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <div
        className={`${small ? 'text-xs' : 'text-sm'} ${mono ? 'font-mono break-all' : ''} ${
          multiline ? 'whitespace-pre-wrap' : ''
        } text-gray-900`}
      >
        {value || <span className="text-gray-300">—</span>}
      </div>
    </div>
  );
}
