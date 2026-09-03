// src/components/admin/DisputesTab.jsx
// Disputes — chargeback defense desk.
//
// Every Stripe dispute the webhook mirrored into public.disputes, with the
// evidence deadline counting down, the customer's block state, and a one-click
// "Build evidence pack" that runs the dispute-evidence-pack edge function and
// hands back a copy/paste-ready markdown pack for Stripe's counter-dispute form.
//
// This tab never talks to Stripe. The human reads the pack, opens the dispute
// in the Stripe dashboard, and pastes. Server: dispute-evidence-pack
// (actions: list | pack | unblock | block), admin_users-gated server-side.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldAlert, RefreshCw, Loader2, AlertTriangle, ExternalLink, Copy, Download, FileText, Ban, Unlock, Check, MessageSquare, Mail, ChevronDown, ChevronRight, Paperclip } from 'lucide-react';
import { Card, Badge, SectionLabel, Stat, btn } from './ui';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const REASON_LABELS = {
  fraudulent: 'Fraudulent — cardholder says it was not them',
  credit_not_processed: 'Credit not processed — says a refund was promised',
  product_not_received: 'Product not received',
  product_unacceptable: 'Product unacceptable',
  duplicate: 'Duplicate charge',
  subscription_canceled: 'Subscription canceled',
  unrecognized: 'Unrecognized charge',
  general: 'General',
};

// One-line playbook per reason. Kept deliberately short — the pack itself
// carries the full Stripe-form reminders.
const REASON_PLAYBOOK = {
  fraudulent: 'Lead with the customer\'s own story, lyrics and messages — proof they placed the order themselves. Never cite IP ranges, 3DS, AVS or Link OTP; those arguments have lost.',
  credit_not_processed: 'Show the song was delivered and consumed, and that no refund was promised. The full message thread is the key exhibit. If this is a good repeat customer, refunding may beat fighting.',
  product_not_received: 'Show delivery timestamps (email, SMS, WhatsApp) and the consumption log (page views, plays, downloads).',
  product_unacceptable: 'Show the customer\'s own submitted story next to the delivered lyrics, plus any revision offers in the thread.',
  unrecognized: 'Show the purchase confirmation email delivery and the customer\'s own submitted story with names they would recognize.',
  duplicate: 'Check the orders list — a 2-pack stamps the full total on both rows and is NOT a duplicate charge.',
};

const OPEN_STATUSES = new Set(['needs_response', 'warning_needs_response', 'warning_under_review', 'under_review']);

function statusTone(s) {
  if (s === 'won') return 'green';
  if (s === 'lost') return 'red';
  if (s === 'needs_response' || s === 'warning_needs_response') return 'amber';
  return 'gray';
}
function statusLabel(s) {
  switch (s) {
    case 'needs_response': return 'Needs response';
    case 'warning_needs_response': return 'Needs response (inquiry)';
    case 'under_review': return 'Under review';
    case 'warning_under_review': return 'Under review (inquiry)';
    case 'warning_closed': return 'Inquiry closed';
    case 'charge_refunded': return 'Refunded';
    case 'won': return 'Won';
    case 'lost': return 'Lost';
    default: return s || '—';
  }
}

const usd = (cents) => ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
function daysLeft(ts) {
  if (!ts) return null;
  return Math.ceil((new Date(ts).getTime() - Date.now()) / 86400000);
}

export default function DisputesTab({ accessToken, showToast }) {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // stripe_dispute_id
  const [pack, setPack] = useState(null); // { email, markdown }
  const [building, setBuilding] = useState(false);
  const [busyEmail, setBusyEmail] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [copied, setCopied] = useState(false);

  const call = useCallback(async (body) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/dispute-evidence-pack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [accessToken]);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await call({ action: 'list' });
      setDisputes(d.disputes || []);
    } catch (e) { setError(e.message || 'Could not load disputes.'); }
    finally { setLoading(false); }
  }, [call]);

  useEffect(() => { if (accessToken) load(); }, [accessToken, load]);

  const buildPack = async ({ email, dispute_id }) => {
    setBuilding(true);
    setPack(null);
    setCopied(false);
    try {
      const d = await call({ action: 'pack', email, dispute_id });
      setPack({ email: d.email, markdown: d.markdown });
      setSelected(dispute_id || null);
    } catch (e) { showToast?.(e.message || 'Could not build the evidence pack', 'error'); }
    finally { setBuilding(false); }
  };

  const toggleBlock = async (d) => {
    if (!d.customer_email) return;
    setBusyEmail(d.customer_email);
    try {
      await call({ action: d.blocked ? 'unblock' : 'block', email: d.customer_email, dispute_id: d.stripe_dispute_id });
      showToast?.(d.blocked ? `${d.customer_email} can order again` : `${d.customer_email} blocked from new orders`, 'success');
      await load();
    } catch (e) { showToast?.(e.message || 'Could not update block', 'error'); }
    finally { setBusyEmail(''); }
  };

  const copyPack = async () => {
    try {
      await navigator.clipboard.writeText(pack.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { showToast?.('Copy failed — select the text and copy manually', 'error'); }
  };

  const downloadPack = () => {
    const blob = new Blob([pack.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dispute-evidence-${(pack.email || 'customer').replace(/[^a-z0-9]+/gi, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    const open = disputes.filter((d) => OPEN_STATUSES.has(d.status));
    const won = disputes.filter((d) => d.status === 'won').length;
    const lost = disputes.filter((d) => d.status === 'lost').length;
    const decided = won + lost;
    const atRisk = open.reduce((s, d) => s + (d.amount_cents || 0), 0);
    return { open: open.length, won, lost, winRate: decided ? Math.round((won / decided) * 100) : null, atRisk };
  }, [disputes]);

  const openList = disputes.filter((d) => OPEN_STATUSES.has(d.status));
  const closedList = disputes.filter((d) => !OPEN_STATUSES.has(d.status));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Card className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><ShieldAlert size={18} /></div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Disputes — chargeback defense</h2>
              <p className="text-xs text-gray-500">
                Every Stripe dispute lands here the moment it opens. Build the evidence pack, review it, then paste it into the Stripe dispute form. Nothing here talks to Stripe.
              </p>
            </div>
          </div>
          <button onClick={() => { setLoading(true); load(); }} disabled={loading} className={btn.ghost}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">
            <AlertTriangle size={15} /> {error}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Open — needs a response" value={stats.open} tone={stats.open ? 'red' : 'green'} />
          <Stat label="At risk (open)" value={usd(stats.atRisk)} tone={stats.atRisk ? 'red' : undefined} />
          <Stat label="Won / lost" value={`${stats.won} / ${stats.lost}`} />
          <Stat label="Win rate" value={stats.winRate == null ? '—' : `${stats.winRate}%`} tone={stats.winRate == null ? undefined : stats.winRate >= 50 ? 'green' : 'red'} />
        </div>
      </Card>

      {/* ---- Open disputes ---- */}
      <Card className="p-5">
        <SectionLabel className="mb-3">Open disputes ({openList.length})</SectionLabel>
        {loading && disputes.length === 0 ? (
          <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</p>
        ) : openList.length === 0 ? (
          <p className="text-sm text-gray-500">No open disputes. New ones appear here automatically and you get a WhatsApp + email alert.</p>
        ) : (
          <div className="space-y-3">
            {openList.map((d) => (
              <DisputeRow key={d.stripe_dispute_id} d={d} selected={selected === d.stripe_dispute_id} building={building && selected === d.stripe_dispute_id}
                busy={busyEmail === d.customer_email} onBuild={() => buildPack({ email: d.customer_email, dispute_id: d.stripe_dispute_id })} onToggleBlock={() => toggleBlock(d)} />
            ))}
          </div>
        )}
      </Card>

      {/* ---- Evidence pack ---- */}
      {(building || pack) && (
        <Card className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <SectionLabel>Evidence pack{pack?.email ? ` — ${pack.email}` : ''}</SectionLabel>
            {pack && (
              <div className="flex gap-2">
                <button onClick={copyPack} className={btn.accent}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy all'}</button>
                <button onClick={downloadPack} className={btn.ghost}><Download size={15} /> Download .md</button>
              </div>
            )}
          </div>
          {building ? (
            <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Pulling orders, messages, email engagement and the consumption log…</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">Read it before pasting. Quote only the numbers marked as real customer activity; the "Reminders for the Stripe form" section at the bottom tells you which fields to fill and what never to attach.</p>
              <pre className="text-xs leading-relaxed text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-[32rem] overflow-auto whitespace-pre-wrap font-mono">{pack.markdown}</pre>
            </>
          )}
        </Card>
      )}

      {/* ---- Manual pack (pre-webhook disputes or a customer threatening one) ---- */}
      <Card className="p-5">
        <SectionLabel className="mb-2">Build a pack for any customer</SectionLabel>
        <p className="text-xs text-gray-500 mb-3">For disputes opened before the webhook existed, or a customer who is threatening a chargeback. Same pack, by email.</p>
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); if (manualEmail.includes('@')) buildPack({ email: manualEmail.trim().toLowerCase() }); }}>
          <input value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="customer@email.com" type="email"
            className="flex-1 min-w-[16rem] text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          <button type="submit" disabled={building || !manualEmail.includes('@')} className={btn.primary}><FileText size={15} /> Build evidence pack</button>
        </form>
      </Card>

      {/* ---- History ---- */}
      <Card className="p-5">
        <SectionLabel className="mb-3">History ({closedList.length})</SectionLabel>
        {closedList.length === 0 ? (
          <p className="text-sm text-gray-500">No closed disputes yet.</p>
        ) : (
          <div className="space-y-3">
            {closedList.map((d) => (
              <DisputeRow key={d.stripe_dispute_id} d={d} selected={selected === d.stripe_dispute_id} building={building && selected === d.stripe_dispute_id}
                busy={busyEmail === d.customer_email} onBuild={() => buildPack({ email: d.customer_email, dispute_id: d.stripe_dispute_id })} onToggleBlock={() => toggleBlock(d)} compact />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function DisputeRow({ d, selected, building, busy, onBuild, onToggleBlock, compact }) {
  const left = daysLeft(d.evidence_due_by);
  const isOpen = OPEN_STATUSES.has(d.status);
  const dueTone = left == null ? 'gray' : left <= 3 ? 'red' : left <= 7 ? 'amber' : 'gray';
  const playbook = REASON_PLAYBOOK[d.reason];
  return (
    <div className={`rounded-lg border p-4 ${selected ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-gray-900">{usd(d.amount_cents)}</span>
            <Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge>
            {isOpen && left != null && (
              <Badge tone={dueTone}>{left < 0 ? `Overdue by ${-left}d` : left === 0 ? 'Due today' : `${left}d left · due ${fmtDate(d.evidence_due_by)}`}</Badge>
            )}
            {d.blocked && <Badge tone="red">Blocked from ordering</Badge>}
            {d.evidence_submitted && <Badge tone="accent">Evidence submitted</Badge>}
          </div>
          <p className="text-sm text-gray-800 mt-1">{REASON_LABELS[d.reason] || d.reason}{d.network_reason_code ? <span className="text-gray-400"> · code {d.network_reason_code}</span> : null}</p>
          <p className="text-sm text-gray-600 mt-0.5">
            {d.customer_name || 'Unknown name'} · {d.customer_email || 'no email on the charge'}
            {d.orders_total != null && <span className="text-gray-400"> · {d.orders_paid} paid of {d.orders_total} orders</span>}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Opened {fmtDate(d.opened_at)}{d.closed_at ? ` · closed ${fmtDate(d.closed_at)}` : ''} · {d.stripe_dispute_id}</p>
          {!compact && playbook && <p className="text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 mt-2">{playbook}</p>}
        </div>
        <div className="flex flex-col gap-1.5 items-stretch shrink-0">
          <button onClick={onBuild} disabled={building || !d.customer_email} className={isOpen ? btn.accent : btn.ghost} title={!d.customer_email ? 'No email on the charge — use the manual box below' : ''}>
            {building ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Build evidence pack
          </button>
          <a href={`https://dashboard.stripe.com/disputes/${d.stripe_dispute_id}`} target="_blank" rel="noreferrer" className={btn.ghost}>
            <ExternalLink size={15} /> Open in Stripe
          </a>
          {d.customer_email && (
            <button onClick={onToggleBlock} disabled={busy} className={btn.ghost}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : d.blocked ? <Unlock size={15} /> : <Ban size={15} />} {d.blocked ? 'Unblock customer' : 'Block customer'}
            </button>
          )}
        </div>
      </div>
      <CommsPanel d={d} defaultOpen={!compact} />
    </div>
  );
}

// Every communication we have with the disputing customer, right in the box:
// the full SMS / WhatsApp thread (both directions, Twilio-verifiable) and
// every email we sent them. Open disputes start expanded; history collapsed.
function CommsPanel({ d, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const messages = d.messages || [];
  const emails = d.emails_sent || [];
  const inbound = messages.filter((m) => m.direction === 'inbound').length;
  const channels = [...new Set(messages.map((m) => (m.channel || 'sms').toLowerCase()))];
  const fmtTs = (ts) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left text-sm text-gray-700 hover:text-gray-900">
        {open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
        <MessageSquare size={15} className="text-indigo-500" />
        <span className="font-medium">Communications</span>
        <span className="text-gray-500">
          · {messages.length} message{messages.length === 1 ? '' : 's'}{messages.length ? ` (${inbound} from customer${channels.length ? `, ${channels.map((c) => c === 'whatsapp' ? 'WhatsApp' : c.toUpperCase()).join(' + ')}` : ''})` : ''}
          {' '}· {emails.length} email{emails.length === 1 ? '' : 's'} sent
        </span>
        {d.phones?.length > 0 && <span className="text-xs text-gray-400 ml-auto">{d.phones.join(', ')}</span>}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {messages.length === 0 && emails.length === 0 && (
            <p className="text-sm text-gray-500">No messages or emails on file for this customer. Check the SMS inbox by phone in case the thread is under a different number.</p>
          )}

          {messages.length > 0 && (
            <div>
              <SectionLabel className="mb-2">SMS / WhatsApp thread</SectionLabel>
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {messages.map((m, i) => {
                  const fromCustomer = m.direction === 'inbound';
                  return (
                    <div key={m.twilio_sid || i} className={`flex ${fromCustomer ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${fromCustomer ? 'bg-indigo-50 border border-indigo-100 text-gray-900' : 'bg-gray-100 text-gray-800'}`}>
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-0.5 flex-wrap">
                          <span className="font-medium text-gray-700">{fromCustomer ? 'Customer' : 'Us'}</span>
                          <span>· {fmtTs(m.created_at)}</span>
                          <span>· {(m.channel || 'sms').toLowerCase() === 'whatsapp' ? 'WhatsApp' : 'SMS'}</span>
                          {m.status && !fromCustomer && <span>· {m.status}</span>}
                          {m.ai_generated && !fromCustomer && <span>· AI draft</span>}
                          {m.media_type && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} /> {m.media_type}</span>}
                        </div>
                        <p className="whitespace-pre-wrap break-words">{m.body || (m.media_type ? '(attachment)' : '(empty)')}</p>
                        {m.twilio_sid && <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{m.twilio_sid}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {emails.length > 0 && (
            <div>
              <SectionLabel className="mb-2">Emails we sent</SectionLabel>
              <div className="space-y-1">
                {emails.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <Mail size={14} className="text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <span className="text-gray-500">{fmtTs(e.created_at)}</span> · <span className="font-medium">{e.subject || e.email_type || 'email'}</span>
                      <span className="text-gray-400"> · {e.email_type || '—'} · {e.status || '—'}{e.opened_at ? ` · opened ${fmtTs(e.opened_at)}` : ''}{e.clicked_at ? ` · clicked ${fmtTs(e.clicked_at)}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
