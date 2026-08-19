// src/components/admin/GiftSmsTab.jsx
// Gift SMS — every $5 "send this song as a scheduled surprise text" purchase:
// who bought one, when it goes out, and whether it actually reached the
// recipient's phone. Reads the gift_sms_admin_list RPC (the table's RLS blocks
// the anon key on purpose — recipient phones are transactional-only).
// Status meanings: 'delivered' = Twilio confirmed receipt on the recipient's
// phone; 'sent' = sent, receipt not (yet) confirmed; 'scheduled'/'processing'
// = paid and waiting for its send time; 'failed'/'canceled' = did not go out;
// 'awaiting_payment' = the buyer opened checkout but never paid (not a sale).
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Gift, Loader2, RefreshCw, ExternalLink, ChevronDown } from 'lucide-react';
import { supabase } from '../../services/api';
import { Card, Stat, Badge, SectionLabel, btn } from './ui';

const STATUS = {
  delivered:        { label: 'Delivered',   tone: 'green' },
  sent:             { label: 'Sent',        tone: 'accent' },
  scheduled:        { label: 'Pending',     tone: 'amber' },
  processing:       { label: 'Sending now', tone: 'amber' },
  failed:           { label: 'Failed',      tone: 'red' },
  canceled:         { label: 'Canceled',    tone: 'gray' },
  awaiting_payment: { label: 'Never paid',  tone: 'gray' },
};

const PENDING = new Set(['scheduled', 'processing']);

const money = (cents) => `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPT = (iso) => iso
  ? `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))} PT`
  : '—';
const untilText = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'due now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `in ${hours}h ${mins % 60}m`;
  return `in ${Math.round(hours / 24)} days`;
};

export default function GiftSmsTab({ accessToken, showToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showUnpaid, setShowUnpaid] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('gift_sms_admin_list', { limit_n: 300 });
      if (rpcError) throw rpcError;
      setRows(data || []);
    } catch (e) {
      setError(e.message || 'failed to load');
      showToast?.(`Gift SMS: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const { paid, pending, history, unpaid, stats } = useMemo(() => {
    const paid = rows.filter((r) => r.status !== 'awaiting_payment');
    const pending = paid
      .filter((r) => PENDING.has(r.status))
      .sort((a, b) => new Date(a.send_at) - new Date(b.send_at));
    const history = paid
      .filter((r) => !PENDING.has(r.status))
      .sort((a, b) => new Date(b.sent_at || b.send_at) - new Date(a.sent_at || a.send_at));
    const unpaid = rows.filter((r) => r.status === 'awaiting_payment');
    const stats = {
      revenue: paid.reduce((s, r) => s + Number(r.amount_cents || 0), 0),
      delivered: paid.filter((r) => r.status === 'delivered').length,
      sent: paid.filter((r) => r.status === 'sent').length,
      failed: paid.filter((r) => r.status === 'failed' || r.status === 'canceled').length,
    };
    return { paid, pending, history, unpaid, stats };
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Gift size={20} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Gift SMS</h2>
              <p className="text-xs text-gray-500">The $5 scheduled surprise texts — purchases, delivery, and what's still waiting to go out</p>
            </div>
          </div>
          <button onClick={load} disabled={loading} className={btn.iconGhost} title="Refresh">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </Card>

      {error ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-600">Couldn't load gift messages: {error}</p>
          <button onClick={load} className={`${btn.ghost} mt-3`}>Try again</button>
        </Card>
      ) : loading && rows.length === 0 ? (
        <Card className="p-10 flex items-center justify-center text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading gift messages…
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Purchases" value={paid.length} />
            <Stat label="Revenue" value={money(stats.revenue)} tone="green" />
            <Stat label="Delivered to phone" value={stats.delivered} tone="green" />
            <Stat label="Waiting to send" value={pending.length} />
            <Stat label="Failed / canceled" value={stats.failed} tone={stats.failed > 0 ? 'red' : undefined} />
          </div>

          {paid.length === 0 && (
            <Card className="p-10 text-center">
              <Gift size={28} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-700">No gift texts purchased yet</p>
              <p className="text-xs text-gray-500 mt-1.5 max-w-md mx-auto">
                Every $5 gift-text purchase appears here the moment it's paid, then tracks through pending, sent, and delivered.
              </p>
            </Card>
          )}

          {pending.length > 0 && (
            <Card className="p-4">
              <SectionLabel className="mb-3">Waiting to send</SectionLabel>
              <div className="space-y-2.5">
                {pending.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-gray-50 rounded-lg px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{r.buyer_name || '—'}</span>
                        <span className="text-gray-400 mx-1.5">→</span>
                        <span className="font-medium">{r.recipient_name || 'recipient'}</span>
                        <span className="text-gray-500 ml-2">{r.recipient_phone}</span>
                      </p>
                      {r.personal_message && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate" title={r.personal_message}>“{r.personal_message}”</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">{fmtPT(r.send_at)}</p>
                      <p className="text-xs text-gray-500">{untilText(r.send_at)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge tone="amber">{STATUS[r.status]?.label || r.status}</Badge>
                      {r.twilio_scheduled
                        ? <Badge tone="accent">Handed to Twilio</Badge>
                        : <Badge tone="gray">Cron will send</Badge>}
                      {r.song_id && (
                        <a href={`/song/${r.song_id}`} target="_blank" rel="noreferrer" className={btn.iconGhost} title="Open the song">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">
                "Handed to Twilio" = Twilio delivers it at the exact second. "Cron will send" = our every-minute job sends it when it comes due (normal for sends more than 7 days out).
              </p>
            </Card>
          )}

          {history.length > 0 && (
            <Card className="p-4">
              <SectionLabel className="mb-3">Sent history</SectionLabel>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-2 pr-4 font-medium">When</th>
                      <th className="py-2 pr-4 font-medium">From → To</th>
                      <th className="py-2 pr-4 font-medium">Message</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 font-medium text-right">Song</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 last:border-0 align-top">
                        <td className="py-2.5 pr-4 whitespace-nowrap text-gray-700">{fmtPT(r.sent_at || r.send_at)}</td>
                        <td className="py-2.5 pr-4">
                          <p className="text-gray-900"><span className="font-medium">{r.buyer_name || '—'}</span> → {r.recipient_name || 'recipient'}</p>
                          <p className="text-xs text-gray-500">{r.recipient_phone}</p>
                        </td>
                        <td className="py-2.5 pr-4 max-w-[260px]">
                          <p className="text-xs text-gray-600 truncate" title={r.personal_message || ''}>{r.personal_message || <span className="text-gray-400">no personal note</span>}</p>
                          {r.error_message && (
                            <p className="text-xs text-red-600 mt-0.5" title={r.error_message}>{r.error_message}</p>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge tone={STATUS[r.status]?.tone || 'gray'}>{STATUS[r.status]?.label || r.status}</Badge>
                        </td>
                        <td className="py-2.5 text-right">
                          {r.song_id ? (
                            <a href={`/song/${r.song_id}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 text-xs font-medium">
                              Open <ExternalLink size={12} />
                            </a>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Delivered = Twilio confirmed it reached the recipient's phone. Sent = it went out but the delivery receipt hasn't come back (some carriers never send one).
              </p>
            </Card>
          )}

          {unpaid.length > 0 && (
            <Card className="p-4">
              <button onClick={() => setShowUnpaid((v) => !v)} className="w-full flex items-center justify-between text-left">
                <SectionLabel>Started checkout but never paid ({unpaid.length})</SectionLabel>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${showUnpaid ? 'rotate-180' : ''}`} />
              </button>
              {showUnpaid && (
                <div className="mt-3 space-y-1.5">
                  {unpaid.map((r) => (
                    <p key={r.id} className="text-xs text-gray-500">
                      {fmtPT(r.created_at)} — {r.buyer_name || 'someone'} for {r.recipient_name || 'a recipient'}, wanted it sent {fmtPT(r.send_at)}
                    </p>
                  ))}
                  <p className="text-xs text-gray-400 pt-1.5">These are abandoned gift checkouts, not sales — no charge happened and nothing will be sent.</p>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
