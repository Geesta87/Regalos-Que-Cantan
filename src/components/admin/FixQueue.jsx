import React, { useMemo, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Fix Queue — "Pending customer songs to be fixed"
//
// Sits at the top of the admin "Fix Song" tab. Presentational: FixSongTab owns
// the data (from the song-fix-queue edge function) and the handlers; this just
// renders the queue and calls back.
//
// The queue is fed by the CS AI agent: when a customer asks (over SMS/WhatsApp)
// for a change to a song we already delivered, the agent proposes a fix on its
// draft, and the owner approving that draft drops a request here — with the
// customer's own words attached.
//
// Lifecycle a card walks through:
//   pending           → "Start fixing" (owner or assistant)
//   in_progress       → "Continue fixing"
//   awaiting_approval → the fix is staged (saved, NOT live). The OWNER reviews
//                       original-vs-corrected and releases it (or rejects).
//   done / rejected   → shown briefly under "Recently handled".
// ──────────────────────────────────────────────────────────────────────────

const STATUS_META = {
  pending:            { label: 'New',            tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  in_progress:        { label: 'In progress',    tone: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  awaiting_approval:  { label: 'Needs approval', tone: 'bg-purple-500/15 text-purple-200 border-purple-500/40' },
  done:               { label: 'Done',           tone: 'bg-green-500/15 text-green-300 border-green-500/30' },
  rejected:           { label: 'Rejected',       tone: 'bg-red-500/15 text-red-300 border-red-500/30' },
};

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

function ctx(req, key) {
  return (req.context && typeof req.context === 'object') ? req.context[key] : null;
}

function customerLabel(req) {
  return ctx(req, 'customer_name') || ctx(req, 'phone') || (req.song && req.song.recipient_name) || 'Customer';
}

function RequestCard({ req, role, busyId, onClaim, onWork, onUnclaim, onRelease, onReject }) {
  const meta = STATUS_META[req.status] || STATUS_META.pending;
  const busy = busyId === req.id;
  const isAdmin = role === 'admin';
  const recipient = req.song && req.song.recipient_name;
  const genre = req.song && (req.song.genre_name || req.song.genre);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="bg-[#1a1f26] rounded-xl p-4 border border-white/10">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {customerLabel(req)}
            {recipient && <span className="text-gray-500 font-normal"> · song for {recipient}</span>}
          </p>
          <p className="text-[11px] text-gray-500">
            {genre ? `${String(genre).replace(/_/g, ' ')} · ` : ''}requested {fmtWhen(req.created_at)}
          </p>
        </div>
        <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-full border ${meta.tone}`}>
          {meta.label}
        </span>
      </div>

      {/* What the customer wants changed */}
      <div className="rounded-lg bg-black/20 border border-white/5 px-3 py-2 mb-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Customer wants changed</p>
        <p className="text-sm text-gray-100 whitespace-pre-wrap break-words">{req.customer_request}</p>
        {ctx(req, 'source_message') && ctx(req, 'source_message') !== req.customer_request && (
          <p className="text-[11px] text-gray-500 mt-1 italic">“{ctx(req, 'source_message')}”</p>
        )}
      </div>

      {!req.song_id && (
        <p className="text-[11px] text-amber-300 mb-2">
          ⚠ No song linked yet — open it and search for the customer's song to attach it.
        </p>
      )}

      {/* Awaiting-approval: original vs corrected, side by side, for the owner. */}
      {req.status === 'awaiting_approval' && (
        <div className="rounded-lg bg-white/5 border border-white/10 p-3 mb-2 space-y-2">
          {req.candidate_summary && <p className="text-[11px] text-purple-100">📝 {req.candidate_summary}</p>}
          {req.worked_by && <p className="text-[10px] text-gray-500">Prepared by {req.worked_by}</p>}
          {req.song && req.song.audio_url && (
            <div>
              <p className="text-[11px] text-gray-500 mb-1">Current (live) song:</p>
              <audio controls className="w-full" src={req.song.audio_url} />
            </div>
          )}
          <div>
            <p className="text-[11px] text-gray-300 mb-1">✅ Corrected (not live yet):</p>
            <audio controls className="w-full" src={req.candidate_audio_url} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {req.status === 'pending' && (
          <button
            onClick={() => onClaim(req)}
            disabled={busy}
            className="py-1.5 px-3 bg-amber-500 text-black rounded-lg text-xs font-semibold hover:bg-amber-400 transition disabled:opacity-60"
          >
            {busy ? '…' : '🔧 Start fixing'}
          </button>
        )}

        {req.status === 'in_progress' && (
          <>
            <button
              onClick={() => onWork(req)}
              disabled={busy}
              className="py-1.5 px-3 bg-indigo-500 text-white rounded-lg text-xs font-semibold hover:bg-indigo-400 transition disabled:opacity-60"
            >
              🎧 Continue fixing
            </button>
            <button
              onClick={() => onUnclaim(req)}
              disabled={busy}
              className="py-1.5 px-3 bg-white/10 text-gray-200 rounded-lg text-xs font-medium hover:bg-white/15 transition disabled:opacity-60"
            >
              Put back
            </button>
          </>
        )}

        {req.status === 'awaiting_approval' && (
          <>
            {isAdmin ? (
              <button
                onClick={() => onRelease(req)}
                disabled={busy}
                className="py-1.5 px-3 bg-green-500 text-black rounded-lg text-xs font-semibold hover:bg-green-400 transition disabled:opacity-60"
              >
                {busy ? '⏳ Releasing…' : '✅ Confirm & replace the customer\'s song'}
              </button>
            ) : (
              <span className="text-[11px] text-gray-400 italic">Waiting for the owner to confirm & release.</span>
            )}
            <button
              onClick={() => onWork(req)}
              disabled={busy}
              className="py-1.5 px-3 bg-white/10 text-gray-200 rounded-lg text-xs font-medium hover:bg-white/15 transition disabled:opacity-60"
              title="Redo the fix"
            >
              ↺ Redo
            </button>
          </>
        )}

        {/* Reject (any open state) */}
        {['pending', 'in_progress', 'awaiting_approval'].includes(req.status) && !rejecting && (
          <button
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="py-1.5 px-3 bg-red-500/15 text-red-300 rounded-lg text-xs font-medium hover:bg-red-500/25 transition disabled:opacity-60"
          >
            Reject
          </button>
        )}

        {req.status === 'rejected' && req.reject_reason && (
          <span className="text-[11px] text-gray-500">Reason: {req.reject_reason}</span>
        )}
        {req.status === 'done' && (
          <span className="text-[11px] text-green-300">Released {fmtWhen(req.resolved_at)}{req.approved_by ? ` by ${req.approved_by}` : ''}</span>
        )}
      </div>

      {rejecting && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)…"
            className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-red-400/50"
          />
          <button
            onClick={() => { onReject(req, reason); setRejecting(false); setReason(''); }}
            disabled={busy}
            className="py-1.5 px-3 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-400 transition disabled:opacity-60"
          >
            Confirm reject
          </button>
          <button
            onClick={() => { setRejecting(false); setReason(''); }}
            className="py-1.5 px-2 text-xs text-gray-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default function FixQueue({ requests, role, busyId, loading, onClaim, onWork, onUnclaim, onRelease, onReject, onRefresh }) {
  const groups = useMemo(() => {
    const g = { awaiting_approval: [], in_progress: [], pending: [], resolved: [] };
    for (const r of requests || []) {
      if (r.status === 'awaiting_approval') g.awaiting_approval.push(r);
      else if (r.status === 'in_progress') g.in_progress.push(r);
      else if (r.status === 'pending') g.pending.push(r);
      else g.resolved.push(r);
    }
    return g;
  }, [requests]);

  const openCount = groups.awaiting_approval.length + groups.in_progress.length + groups.pending.length;
  const [showResolved, setShowResolved] = useState(false);

  const cardProps = { role, busyId, onClaim, onWork, onUnclaim, onRelease, onReject };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          📋 Pending fixes
          {openCount > 0 && (
            <span className="bg-amber-400 text-black text-[10px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
              {openCount}
            </span>
          )}
          {groups.awaiting_approval.length > 0 && (
            <span className="bg-purple-500/30 text-purple-200 text-[10px] font-bold rounded-full px-2 h-5 flex items-center">
              {groups.awaiting_approval.length} to approve
            </span>
          )}
        </h3>
        <button
          onClick={onRefresh}
          className="text-xs text-gray-400 hover:text-white transition"
        >
          🔄 Refresh
        </button>
      </div>

      {loading && openCount === 0 ? (
        <p className="text-sm text-gray-500">Loading the queue…</p>
      ) : openCount === 0 ? (
        <p className="text-sm text-gray-500 bg-[#1a1f26] rounded-xl p-4 border border-white/5">
          No customer fixes waiting. New requests from the AI chat (once you approve them in Messages) show up here.
        </p>
      ) : (
        <div className="space-y-2.5">
          {groups.awaiting_approval.map((r) => <RequestCard key={r.id} req={r} {...cardProps} />)}
          {groups.in_progress.map((r) => <RequestCard key={r.id} req={r} {...cardProps} />)}
          {groups.pending.map((r) => <RequestCard key={r.id} req={r} {...cardProps} />)}
        </div>
      )}

      {groups.resolved.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-300 transition"
          >
            {showResolved ? '▲ Hide' : '▼ Show'} recently handled ({groups.resolved.length})
          </button>
          {showResolved && (
            <div className="space-y-2.5 mt-2 opacity-80">
              {groups.resolved.map((r) => <RequestCard key={r.id} req={r} {...cardProps} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
