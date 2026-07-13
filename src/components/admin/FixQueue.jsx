// src/components/admin/FixQueue.jsx
// "Pending fixes" queue at the top of the Fix Song tab. Fed by the CS AI agent
// (owner approving a fix-draft in Messages inserts a song_fix_requests row) and
// backed by the song-fix-queue edge function.
//
// NOTE (2026-07-13): this file was reconstructed against the DEPLOYED
// song-fix-queue function (v3) after the original was lost from the local tree
// uncommitted. Statuses: pending → in_progress → awaiting_approval → done/rejected.
// Assistants can claim/work/stage; only the owner (role='admin') can Release.
import React, { useState } from 'react';
import { Loader2, RefreshCw, Wrench, Hand, Undo2, ShieldCheck, X, ChevronDown, ChevronUp } from 'lucide-react';

const STATUS = {
  pending:            { label: 'Pending',        cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' },
  in_progress:        { label: 'In progress',    cls: 'bg-blue-500/15 text-blue-300 border border-blue-500/30' },
  awaiting_approval:  { label: 'Ready to release', cls: 'bg-green-500/15 text-green-300 border border-green-500/30' },
  done:               { label: 'Done',           cls: 'bg-white/10 text-gray-300 border border-white/10' },
  rejected:           { label: 'Rejected',       cls: 'bg-red-500/15 text-red-300 border border-red-500/30' },
};

const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }); } catch { return ''; } };

export default function FixQueue({ requests = [], role, busyId, loading, onClaim, onWork, onUnclaim, onRelease, onReject, onRefresh }) {
  const [showResolved, setShowResolved] = useState(false);
  const open = requests.filter((r) => ['pending', 'in_progress', 'awaiting_approval'].includes(r.status));
  const resolved = requests.filter((r) => ['done', 'rejected'].includes(r.status));

  if (loading && requests.length === 0) {
    return (
      <div className="mb-5 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={14} className="animate-spin" /> Loading fix requests…
      </div>
    );
  }
  if (open.length === 0 && resolved.length === 0) return null;

  const reject = (req) => {
    const reason = window.prompt('Reason for rejecting this fix request (optional):', '');
    if (reason === null) return;
    onReject?.(req, reason);
  };

  return (
    <div className="mb-6 rounded-2xl bg-white/5 border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Wrench size={15} className="text-amber-400" />
          Pending fixes
          {open.length > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-400 text-black font-bold">{open.length}</span>}
        </h3>
        <button onClick={onRefresh} className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {open.length === 0 && (
        <p className="text-xs text-gray-500">No open requests. Approved fix-drafts from Messages land here.</p>
      )}

      <div className="space-y-2.5">
        {open.map((r) => {
          const st = STATUS[r.status] || STATUS.pending;
          const busy = busyId === r.id;
          const ctx = r.context || {};
          const who = ctx.customer_name || r.song?.recipient_name || ctx.phone || 'Customer';
          return (
            <div key={r.id} className="rounded-xl bg-black/20 border border-white/10 p-3">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                <span className="text-xs text-gray-400">{who}</span>
                {r.song && <span className="text-[11px] text-gray-500">· {r.song.genre_name || r.song.genre || ''} para {r.song.recipient_name}</span>}
                <span className="text-[11px] text-gray-600 ml-auto">{fmtDate(r.created_at)}</span>
              </div>
              <p className="text-sm text-gray-200 leading-snug">{r.customer_request}</p>
              {r.worked_by && r.status !== 'pending' && (
                <p className="text-[11px] text-gray-500 mt-1">Worked by {r.worked_by}</p>
              )}

              {r.status === 'awaiting_approval' && (
                <div className="mt-2">
                  {r.candidate_summary && <p className="text-xs text-green-200/80 mb-1.5">{r.candidate_summary}</p>}
                  {r.candidate_audio_url && <audio src={r.candidate_audio_url} controls className="w-full h-9" />}
                </div>
              )}

              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                {r.status === 'pending' && (
                  <button onClick={() => onClaim?.(r)} disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Hand size={12} />} Claim &amp; work on it
                  </button>
                )}
                {r.status === 'in_progress' && (
                  <>
                    <button onClick={() => onWork?.(r)} disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition">
                      <Wrench size={12} /> Open fix workspace
                    </button>
                    <button onClick={() => onUnclaim?.(r)} disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/15 text-gray-300 hover:bg-white/10 disabled:opacity-50 transition">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Unclaim
                    </button>
                  </>
                )}
                {r.status === 'awaiting_approval' && role === 'admin' && (
                  <button onClick={() => onRelease?.(r)} disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Release to customer
                  </button>
                )}
                {r.status === 'awaiting_approval' && role !== 'admin' && (
                  <span className="text-[11px] text-gray-500">Staged — waiting for the owner to release it.</span>
                )}
                <button onClick={() => reject(r)} disabled={busy}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg text-gray-500 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition ml-auto">
                  <X size={12} /> Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {resolved.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowResolved((v) => !v)} className="text-[11px] text-gray-500 hover:text-gray-300 flex items-center gap-1">
            {showResolved ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Recently resolved ({resolved.length})
          </button>
          {showResolved && (
            <div className="mt-2 space-y-1.5">
              {resolved.map((r) => {
                const st = STATUS[r.status] || STATUS.done;
                return (
                  <div key={r.id} className="flex items-center gap-2 text-xs text-gray-500 rounded-lg bg-black/10 border border-white/5 px-3 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    <span className="truncate flex-1">{r.customer_request}</span>
                    <span className="text-gray-600 whitespace-nowrap">{fmtDate(r.resolved_at || r.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
