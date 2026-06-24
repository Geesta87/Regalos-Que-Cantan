// src/components/admin/ClonamivozAdminTab.jsx
//
// Self-contained admin tab for the Clone Mi Voz tier. Lives in its own
// file so the giant AdminDashboard.jsx only needs 4 small surgical edits
// (import + tab button + render branch) — no risk of stepping on the
// existing dashboard's state.
//
// Reads from the new admin-cloned-voice-songs edge function (which has
// the same admin-auth posture as admin-songs but queries the dedicated
// cloned_voice_songs table).
//
// Props
// -----
//   accessToken: Supabase user JWT (already verified by the dashboard's
//                auth flow). Required for the edge function to identify
//                the caller's admin role.
//   role:        'admin' | 'assistant' — passed in so we can show or
//                hide revenue columns to match the backend's redaction.

import React, { useState, useEffect, useMemo, useCallback } from 'react';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

const FN_URL = `${SUPABASE_URL}/functions/v1/admin-cloned-voice-songs`;

// Status → badge color + label for the table.
const STATUS_STYLES = {
  pending:             { bg: 'bg-gray-200',    text: 'text-gray-800',    label: 'Pending' },
  generating_lyrics:   { bg: 'bg-blue-100',    text: 'text-blue-800',    label: 'Writing lyrics' },
  lyrics_ready:        { bg: 'bg-blue-100',    text: 'text-blue-800',    label: 'Lyrics ready' },
  generating_preview:  { bg: 'bg-purple-100',  text: 'text-purple-800',  label: 'Generating preview' },
  preview_ready:       { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'Preview ready (unpaid)' },
  awaiting_payment:    { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'In Stripe checkout' },
  paid:                { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Paid · creating song' },
  generating_song:     { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Generating song' },
  success:             { bg: 'bg-emerald-500', text: 'text-white',       label: '✓ Ready' },
  failed:              { bg: 'bg-rose-500',    text: 'text-white',       label: 'Failed' },
};

const STATUS_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'paid',    label: 'Paid' },
  { key: 'preview', label: 'Preview only (unpaid)' },
  { key: 'failed',  label: 'Failed' },
  { key: 'active',  label: 'In progress' },
];

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-MX', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedSongId, setSelectedSongId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

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
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSongs(data.songs || []);
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
    // Status filter
    if (filter === 'paid') rows = rows.filter((s) => s.paid);
    else if (filter === 'preview') rows = rows.filter((s) => !s.paid && s.status === 'preview_ready');
    else if (filter === 'failed') rows = rows.filter((s) => s.status === 'failed');
    else if (filter === 'active') {
      rows = rows.filter((s) =>
        ['generating_preview', 'generating_song', 'paid', 'awaiting_payment'].includes(s.status)
      );
    }
    // Search filter (email or recipient name)
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
  }, [songs, filter, search]);

  // Counts for the filter chips
  const counts = useMemo(() => {
    return {
      all: songs.length,
      paid: songs.filter((s) => s.paid).length,
      preview: songs.filter((s) => !s.paid && s.status === 'preview_ready').length,
      failed: songs.filter((s) => s.status === 'failed').length,
      active: songs.filter((s) =>
        ['generating_preview', 'generating_song', 'paid', 'awaiting_payment'].includes(s.status)
      ).length,
    };
  }, [songs]);

  const totalRevenueCents = useMemo(() => {
    if (role === 'assistant') return null;
    return songs.reduce((sum, s) => sum + (s.paid && s.amount_cents ? s.amount_cents : 0), 0);
  }, [songs, role]);

  return (
    <div className="p-4 sm:p-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            🎙️ Clone Mi Voz
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Orders for the customer-voice song tier · /clonamivoz
          </p>
        </div>
        <div className="flex items-center gap-3">
          {role === 'admin' && totalRevenueCents != null && (
            <div className="text-right">
              <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider">
                Revenue
              </div>
              <div className="text-xl font-bold text-emerald-600">
                {formatMoney(totalRevenueCents)}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={fetchSongs}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg bg-pink-600 hover:bg-pink-700 text-white font-semibold transition disabled:opacity-50"
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_FILTERS.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm rounded-full font-semibold transition ${
                active
                  ? 'bg-pink-600 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 text-xs ${active ? 'opacity-80' : 'text-gray-500'}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email, recipient, or ID…"
          className="w-full sm:max-w-md px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:border-pink-500 focus:outline-none"
        />
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-100 border border-rose-300 text-rose-800 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">For</th>
              <th className="px-3 py-2 text-left">Genre</th>
              <th className="px-3 py-2 text-left">Status</th>
              {role === 'admin' && <th className="px-3 py-2 text-right">$</th>}
              <th className="px-3 py-2 text-left">Audio</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filteredSongs.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={role === 'admin' ? 8 : 7}
                  className="px-3 py-12 text-center text-gray-400"
                >
                  {songs.length === 0
                    ? 'No Clone Mi Voz orders yet.'
                    : 'No orders match your filter.'}
                </td>
              </tr>
            )}
            {filteredSongs.map((s) => {
              const stylesheet = STATUS_STYLES[s.status] || {
                bg: 'bg-gray-200', text: 'text-gray-800', label: s.status,
              };
              const fullUrls = s.permanent_audio_urls?.length
                ? s.permanent_audio_urls
                : (s.suno_audio_urls || []);
              return (
                <tr
                  key={s.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">
                    {formatDateTime(s.created_at)}
                  </td>
                  <td className="px-3 py-2 text-gray-900 dark:text-white">
                    <div className="font-medium">{s.customer_email || '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                    <div>{s.recipient_name || '—'}</div>
                    <div className="text-xs text-gray-400">{s.occasion}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300 capitalize">
                    {s.genre_slug}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${stylesheet.bg} ${stylesheet.text}`}
                    >
                      {stylesheet.label}
                    </span>
                    {s.paid && (
                      <div className="text-[10px] text-emerald-600 mt-0.5">
                        💳 Paid {s.paid_at ? formatDateTime(s.paid_at) : ''}
                      </div>
                    )}
                  </td>
                  {role === 'admin' && (
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                      {s.paid ? formatMoney(s.amount_cents) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      {s.preview_audio_url && (
                        <a
                          href={s.preview_audio_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-amber-700 dark:text-amber-400 hover:underline inline-flex items-center gap-1"
                        >
                          🎧 Preview
                        </a>
                      )}
                      {fullUrls.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-pink-600 hover:underline inline-flex items-center gap-1"
                        >
                          🎵 Version {i + 1}
                        </a>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => loadDetail(s.id)}
                      className="text-xs text-pink-600 hover:underline font-semibold"
                    >
                      View details →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {selectedSongId && (
        <DetailModal
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

function DetailModal({ songId, detail, loading, role, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Order detail
            </h3>
            <div className="text-xs text-gray-500 font-mono mt-0.5 break-all">{songId}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          {loading && <div className="text-center text-gray-500 py-8">Loading…</div>}
          {detail?._error && (
            <div className="text-rose-600 bg-rose-50 p-3 rounded-lg">{detail._error}</div>
          )}
          {detail && !detail._error && (
            <>
              <Field label="Customer" value={detail.customer_email} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Recipient" value={detail.recipient_name} />
                <Field label="Relationship" value={detail.relationship} />
                <Field label="Occasion" value={detail.occasion} />
                <Field label="Genre" value={detail.genre_slug} />
              </div>
              <Field label="Story" value={detail.story} multiline />
              <Field label="Lyrics" value={detail.lyrics} multiline mono />

              {detail.preview_audio_url && (
                <div>
                  <Label>Preview</Label>
                  <audio controls src={detail.preview_audio_url} className="w-full mt-1" />
                </div>
              )}
              {detail.permanent_audio_urls?.map((url, i) => (
                <div key={i}>
                  <Label>Full song — version {i + 1} (permanent)</Label>
                  <audio controls src={url} className="w-full mt-1" />
                </div>
              ))}
              {!detail.permanent_audio_urls?.length &&
                detail.suno_audio_urls?.map((url, i) => (
                  <div key={i}>
                    <Label>Full song — version {i + 1} (Suno, may expire)</Label>
                    <audio controls src={url} className="w-full mt-1" />
                  </div>
                ))}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200 dark:border-gray-800">
                <Field label="Status" value={detail.status} mono />
                <Field label="Paid" value={detail.paid ? '✓ Yes' : '✗ No'} />
                {role === 'admin' && (
                  <Field label="Amount" value={formatMoney(detail.amount_cents)} />
                )}
                <Field label="Paid at" value={formatDateTime(detail.paid_at)} />
                <Field label="Stripe session" value={detail.stripe_session_id} mono small />
                <Field label="Stripe payment_intent" value={detail.stripe_payment_intent} mono small />
                <Field label="Kie task (song)" value={detail.kie_task_id} mono small />
                <Field label="Kie task (preview)" value={detail.preview_kie_task_id} mono small />
              </div>

              {detail.error_message && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">
                  <div className="font-semibold mb-1">Error:</div>
                  {detail.error_message}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return (
    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
      {children}
    </div>
  );
}

function Field({ label, value, multiline, mono, small }) {
  return (
    <div>
      <Label>{label}</Label>
      <div
        className={`mt-1 ${small ? 'text-xs' : 'text-sm'} ${mono ? 'font-mono break-all' : ''} ${
          multiline ? 'whitespace-pre-wrap' : ''
        } text-gray-900 dark:text-gray-100`}
      >
        {value || <span className="text-gray-400">—</span>}
      </div>
    </div>
  );
}
