import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  getPushSupport,
  getCurrentSubscription,
  enablePushNotifications,
} from '../../services/push';

// ──────────────────────────────────────────────────────────────────────────
// SMS Inbox (Admin)
//
// Two-pane WhatsApp-style inbox for two-way SMS over Twilio. The LEFT pane is
// the conversation list; the RIGHT pane is the open thread + reply composer.
//
// Backend is NOT wired yet. This component talks to a future `sms-admin` edge
// function (same auth pattern as the rest of the dashboard). Until that exists,
// it falls back to clearly-labeled DEMO threads so the full UX is clickable
// locally. When the edge function ships, the demo banner disappears and real
// conversations load — no UI rewrite needed.
//
// Data shape this component expects from the backend (per conversation):
//   {
//     id, customer_name, phone, order_id (nullable), unread (int),
//     opted_out (bool), last_message_at (ISO), messages: [
//       { id, direction: 'inbound'|'outbound', body, created_at (ISO),
//         status: 'queued'|'sent'|'delivered'|'failed'|'received' }
//     ]
//   }
// ──────────────────────────────────────────────────────────────────────────

// GSM-7 basic + extension charset. Anything outside this forces UCS-2 encoding,
// which drops the per-segment limit from 160 chars to 70. Spanish acutes
// (á í ó ú) and emoji are NOT in GSM-7 → they roughly double the send cost.
const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' +
  '^{}\\[~]|€';

function isGsm7(text) {
  for (const ch of text) {
    if (!GSM7.includes(ch)) return false;
  }
  return true;
}

// Estimate SMS segments + rough all-in cost (Twilio base + US carrier fee).
// ~1.2¢ per outbound segment is a realistic all-in figure for US long codes.
const COST_PER_SEGMENT_USD = 0.012;
function estimateSegments(text) {
  const len = [...text].length;
  if (len === 0) return { encoding: 'GSM-7', segments: 0, chars: 0 };
  const gsm = isGsm7(text);
  if (gsm) {
    const segments = len <= 160 ? 1 : Math.ceil(len / 153);
    return { encoding: 'GSM-7', segments, chars: len };
  }
  const segments = len <= 70 ? 1 : Math.ceil(len / 67);
  return { encoding: 'UCS-2', segments, chars: len };
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
}

function formatPhone(p) {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return p;
}

// ── DEMO data — only used until the sms-admin edge function exists ──────────
// Includes AI drafts (status:'draft') and a WhatsApp thread so the full
// draft-and-approve + channel-sub-tab experience is clickable locally.
const DEMO_CONVERSATIONS = [
  {
    id: 'demo-1',
    channel: 'sms',
    customer_name: 'María González',
    phone: '+12135550142',
    order_id: 'ord_demo_8821',
    unread: 2,
    opted_out: false,
    last_message_at: '2026-06-09T17:43:00Z',
    messages: [
      { id: 'm1', direction: 'outbound', status: 'delivered', created_at: '2026-06-09T16:10:00Z',
        body: '¡Hola María! 🎵 Tu canción para Roberto ya está lista. Escúchala aquí: https://regalosquecantan.com/c/8821' },
      { id: 'm2', direction: 'inbound', status: 'received', created_at: '2026-06-09T17:40:00Z',
        body: '¡Quedó hermosa! Pero la quiero un poco más romántica, ¿se puede cambiar?' },
      { id: 'm3', direction: 'inbound', status: 'received', created_at: '2026-06-09T17:42:00Z',
        body: 'Es para nuestro aniversario el sábado 🙏' },
      // AI draft that escalates (a change to a finished song → needs a human).
      { id: 'm4', direction: 'outbound', status: 'draft', ai_generated: true, needs_human: true,
        created_at: '2026-06-09T17:43:00Z',
        body: '¡Gracias María! ❤️ Con mucho gusto revisamos cómo hacerla más romántica para su aniversario. Un compañero del equipo te ayudará con el ajuste enseguida. 🙏' },
    ],
  },
  {
    // Post-purchase order confirmation + a delivery-status question. Both are
    // within the approved transactional campaign (order confirmation, delivery
    // status, customer care). NO promotional / unpaid-lead messaging.
    id: 'demo-2',
    channel: 'sms',
    customer_name: 'Ana Martínez',
    phone: '+13235550199',
    order_id: 'ord_demo_8830',
    unread: 1,
    opted_out: false,
    last_message_at: '2026-06-09T15:06:00Z',
    // MIXED thread (like Francisco): SMS confirmation, then the customer replies
    // on WhatsApp. Shows in BOTH tabs; each shows the other channel as context.
    messages: [
      { id: 'm1', channel: 'sms', direction: 'outbound', status: 'delivered', created_at: '2026-06-09T14:50:00Z',
        body: 'Confirmamos tu pedido en Regalos Que Cantan ✅ Tu canción se está creando y te enviaremos el enlace por aquí en unos minutos.' },
      { id: 'm2', channel: 'whatsapp', direction: 'inbound', status: 'received', created_at: '2026-06-09T15:05:00Z',
        body: '¿Cuánto tiempo tarda en estar lista?' },
      // AI draft on WhatsApp (the channel she just used) — ready to approve.
      { id: 'm3', channel: 'whatsapp', direction: 'outbound', status: 'draft', ai_generated: true, needs_human: false,
        created_at: '2026-06-09T15:06:00Z',
        body: '¡Hola Ana! 🎵 Normalmente tu canción está lista en unos 3 minutos. Te enviamos el enlace por aquí en cuanto esté lista. 😊' },
    ],
  },
  {
    id: 'demo-3',
    channel: 'sms',
    customer_name: 'Jorge Ramírez',
    phone: '+19155550173',
    order_id: 'ord_demo_8807',
    unread: 0,
    opted_out: false,
    last_message_at: '2026-06-09T12:20:00Z',
    messages: [
      { id: 'm1', direction: 'outbound', status: 'delivered', created_at: '2026-06-09T11:00:00Z',
        body: '¡Hola Jorge! Tu canción ya está lista 🎶 https://regalosquecantan.com/c/8807' },
      { id: 'm2', direction: 'inbound', status: 'received', created_at: '2026-06-09T12:18:00Z',
        body: '¡Mil gracias! Mi mamá lloró de la emoción ❤️' },
      { id: 'm3', direction: 'outbound', status: 'delivered', created_at: '2026-06-09T12:20:00Z',
        body: '¡Qué hermoso saberlo, Jorge! Gracias a ti. 🙏' },
    ],
  },
  {
    id: 'demo-5',
    channel: 'whatsapp',
    customer_name: 'Luis Herrera',
    phone: '+15125550164',
    order_id: 'ord_demo_8845',
    unread: 1,
    opted_out: false,
    last_message_at: '2026-06-09T18:12:00Z',
    messages: [
      { id: 'm1', channel: 'whatsapp', direction: 'inbound', status: 'received', created_at: '2026-06-09T18:10:00Z',
        body: 'Hola, ya pagué mi canción pero no encuentro el enlace para descargarla 😕' },
      // AI draft — would look up the order by this number and share the link.
      { id: 'm2', channel: 'whatsapp', direction: 'outbound', status: 'draft', ai_generated: true, needs_human: false,
        created_at: '2026-06-09T18:12:00Z',
        body: '¡Hola Luis! 🎵 Aquí está tu canción para descargarla cuando quieras: https://regalosquecantan.com/s/ab7kq9 ¡Gracias por tu compra! ❤️' },
    ],
  },
  {
    id: 'demo-4',
    channel: 'sms',
    customer_name: 'Customer (opted out)',
    phone: '+17025550188',
    order_id: null,
    unread: 0,
    opted_out: true,
    last_message_at: '2026-06-08T09:30:00Z',
    messages: [
      { id: 'm1', direction: 'outbound', status: 'delivered', created_at: '2026-06-08T09:00:00Z',
        body: 'Tu canción está lista 🎵 https://regalosquecantan.com/c/8790' },
      { id: 'm2', direction: 'inbound', status: 'received', created_at: '2026-06-08T09:30:00Z',
        body: 'STOP' },
    ],
  },
];

export default function SmsInboxTab({ accessToken }) {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  // Channel sub-tab: 'sms' | 'whatsapp'. Conversations with no channel are SMS.
  const [channelTab, setChannelTab] = useState('sms');
  // AI-draft approval state.
  const [editingDraftId, setEditingDraftId] = useState(null);
  const [draftEdit, setDraftEdit] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  // Admin "Ask AI" copilot (private — about the open order).
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotMsgs, setCopilotMsgs] = useState([]); // { role, content }
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const replyRef = useRef(null);
  const copilotInputRef = useRef(null);
  // Auto-grow the reply box so long messages (e.g. a quick reply) are fully
  // visible instead of hidden in a one-line box.
  useEffect(() => {
    const el = replyRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 220) + 'px'; }
  }, [reply]);
  // Same auto-grow for the Ask-AI copilot input.
  useEffect(() => {
    const el = copilotInputRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 220) + 'px'; }
  }, [copilotInput]);
  // Push-notification button state:
  // 'hidden' (unsupported desktop browser), 'ios-install' (iPhone Safari tab —
  // must add to home screen first), 'off', 'busy', 'on', 'denied'.
  const [notifState, setNotifState] = useState('hidden');
  const [showIosHint, setShowIosHint] = useState(false);
  const scrollRef = useRef(null);
  // Out-of-office auto-reply. When on, inbound texts get one friendly "we're
  // away" reply until the team is back. `ooMessage` is the customer-facing text.
  const [outOfOffice, setOutOfOffice] = useState(false);
  const [ooMessage, setOoMessage] = useState('');
  const [ooEditing, setOoEditing] = useState(false);
  const [ooDraft, setOoDraft] = useState('');
  const [ooBusy, setOoBusy] = useState(false);

  useEffect(() => {
    const { supported, isIos, isStandalone } = getPushSupport();
    if (!supported) {
      setNotifState(isIos && !isStandalone ? 'ios-install' : 'hidden');
      return;
    }
    if (Notification.permission === 'denied') {
      setNotifState('denied');
      return;
    }
    getCurrentSubscription()
      .then((sub) => setNotifState(sub ? 'on' : 'off'))
      .catch(() => setNotifState('off'));
  }, []);

  const handleEnableNotifications = async () => {
    if (notifState === 'ios-install') {
      setShowIosHint((v) => !v);
      return;
    }
    setNotifState('busy');
    try {
      await enablePushNotifications(accessToken);
      setNotifState('on');
    } catch (e) {
      setNotifState(e?.message === 'permission-denied' ? 'denied' : 'off');
    }
  };

  const loadConversations = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-admin`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      if (!res.ok) throw new Error(`sms-admin ${res.status}`);
      const data = await res.json();
      setConversations(Array.isArray(data?.conversations) ? data.conversations : []);
      if (data?.settings) {
        setOutOfOffice(!!data.settings.out_of_office);
        setOoMessage(data.settings.out_of_office_message || '');
      }
      setIsDemo(false);
    } catch (_e) {
      // Quiet background polls must never clobber the live inbox with demo
      // data over a flaky connection — keep whatever is on screen.
      if (!silent) {
        // Backend not deployed yet — show demo threads so the UX is reviewable.
        setConversations(DEMO_CONVERSATIONS);
        setIsDemo(true);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Flip the out-of-office toggle (and optionally save an edited message).
  const saveOutOfOffice = async (nextOn, nextMessage) => {
    if (isDemo) { // Demo mode has no backend — just reflect the toggle locally.
      setOutOfOffice(nextOn);
      if (typeof nextMessage === 'string') setOoMessage(nextMessage);
      setOoEditing(false);
      return;
    }
    setOoBusy(true);
    // Optimistic — snap the UI, roll back if the save fails.
    const prevOn = outOfOffice;
    const prevMsg = ooMessage;
    setOutOfOffice(nextOn);
    if (typeof nextMessage === 'string') setOoMessage(nextMessage);
    try {
      const payload = { action: 'set-out-of-office', out_of_office: nextOn };
      if (typeof nextMessage === 'string' && nextMessage.trim()) {
        payload.out_of_office_message = nextMessage.trim();
      }
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-admin`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `sms-admin ${res.status}`);
      if (data?.settings) {
        setOutOfOffice(!!data.settings.out_of_office);
        setOoMessage(data.settings.out_of_office_message || '');
      }
      setOoEditing(false);
    } catch (e) {
      // Roll back.
      setOutOfOffice(prevOn);
      setOoMessage(prevMsg);
      alert(`Could not update out-of-office: ${e.message}`);
    } finally {
      setOoBusy(false);
    }
  };

  // Keep the inbox fresh without manual refreshes: poll quietly every 25s and
  // re-sync whenever the tab/app regains focus (key for the phone PWA, where
  // the app wakes from background when a notification is tapped).
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) loadConversations({ silent: true });
    };
    const intervalId = setInterval(tick, 25000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadConversations]);

  const msgChannel = (m) => m.channel || 'sms';
  // Which channels a conversation has ANY message on. A phone that used both
  // SMS and WhatsApp shows up in BOTH tabs (so you can always find a customer
  // under SMS to confirm their text went out, and under WhatsApp to chat).
  const convChannels = (c) => {
    const s = new Set((c.messages || []).map(msgChannel));
    if (s.size === 0) s.add('sms');
    return s;
  };
  const hasPendingDraftInChannel = (c, ch) =>
    (c.messages || []).some((m) => m.status === 'draft' && msgChannel(m) === ch);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inChannel = conversations.filter((c) => convChannels(c).has(channelTab));
    const sorted = [...inChannel].sort(
      (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)
    );
    if (!q) return sorted;
    return sorted.filter((c) =>
      (c.customer_name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    );
  }, [conversations, search, channelTab]);

  // Per-channel badges: unread + AI drafts waiting, counted by each message's
  // actual channel.
  const channelStats = useMemo(() => {
    const base = { sms: { unread: 0, drafts: 0 }, whatsapp: { unread: 0, drafts: 0 } };
    for (const c of conversations) {
      const chans = convChannels(c);
      for (const ch of ['sms', 'whatsapp']) {
        if (!chans.has(ch)) continue;
        base[ch].unread += c.unread || 0;
        if (hasPendingDraftInChannel(c, ch)) base[ch].drafts += 1;
      }
    }
    return base;
  }, [conversations]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  );

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unread || 0), 0),
    [conversations]
  );

  // Auto-scroll the open thread to the newest message.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedId, selected?.messages?.length]);

  const openConversation = (id) => {
    setSelectedId(id);
    // Fresh copilot per conversation.
    if (id !== selectedId) setCopilotMsgs([]);
    // Optimistically clear the unread badge on open.
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
    );
    // Persist the read state in live mode (fire-and-forget). Skipped in demo.
    if (!isDemo) {
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'mark-read', conversation_id: id }),
      }).catch(() => {});
    }
  };

  const segInfo = estimateSegments(reply);
  const replyCost = (segInfo.segments * COST_PER_SEGMENT_USD).toFixed(3);

  const handleSend = async () => {
    if (!selected || !reply.trim() || selected.opted_out) return;
    const body = reply.trim();
    const optimistic = {
      id: `local-${Date.now()}`,
      direction: 'outbound',
      status: 'queued',
      created_at: new Date().toISOString(),
      body,
    };
    // Optimistic append.
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selected.id
          ? { ...c, messages: [...c.messages, optimistic], last_message_at: optimistic.created_at }
          : c
      )
    );
    setReply('');
    setSending(true);
    try {
      if (isDemo) {
        // No backend yet — just mark the optimistic message delivered.
        await new Promise((r) => setTimeout(r, 400));
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selected.id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === optimistic.id ? { ...m, status: 'delivered' } : m
                  ),
                }
              : c
          )
        );
      } else {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-admin`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ action: 'send', conversation_id: selected.id, body, channel: channelTab }),
          }
        );
        if (!res.ok) throw new Error(`send ${res.status}`);
        await loadConversations();
      }
    } catch (_e) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === optimistic.id ? { ...m, status: 'failed' } : m
                ),
              }
            : c
        )
      );
    } finally {
      setSending(false);
    }
  };

  const postToSmsAdmin = async (payload) => {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-admin`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) throw new Error(`sms-admin ${res.status}`);
    return res.json();
  };

  // Approve an AI draft (optionally edited) → it gets sent to the customer.
  const handleApproveDraft = async (msg) => {
    if (!selected || draftBusy) return;
    const edited = editingDraftId === msg.id ? draftEdit.trim() : '';
    setDraftBusy(true);
    try {
      if (isDemo) {
        await new Promise((r) => setTimeout(r, 350));
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selected.id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msg.id
                      ? { ...m, status: 'sent', needs_human: false, body: edited || m.body }
                      : m
                  ),
                }
              : c
          )
        );
      } else {
        await postToSmsAdmin({
          action: 'approve-draft',
          conversation_id: selected.id,
          message_id: msg.id,
          body: edited,
        });
        await loadConversations();
      }
    } catch (_e) {
      // Surface a soft failure without clobbering the thread.
    } finally {
      setDraftBusy(false);
      setEditingDraftId(null);
      setDraftEdit('');
    }
  };

  const handleDiscardDraft = async (msg) => {
    if (!selected || draftBusy) return;
    setDraftBusy(true);
    try {
      if (isDemo) {
        await new Promise((r) => setTimeout(r, 200));
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selected.id
              ? { ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, status: 'discarded' } : m)) }
              : c
          )
        );
      } else {
        await postToSmsAdmin({ action: 'discard-draft', message_id: msg.id });
        await loadConversations();
      }
    } catch (_e) {
      // ignore
    } finally {
      setDraftBusy(false);
      if (editingDraftId === msg.id) { setEditingDraftId(null); setDraftEdit(''); }
    }
  };

  const switchChannel = (ch) => {
    setChannelTab(ch);
    setSelectedId(null);
    setEditingDraftId(null);
  };

  // Private admin copilot — ask the AI about the open order.
  const handleCopilotSend = async () => {
    const q = copilotInput.trim();
    if (!q || !selected || copilotBusy) return;
    const next = [...copilotMsgs, { role: 'user', content: q }];
    setCopilotMsgs(next);
    setCopilotInput('');
    setCopilotBusy(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cs-copilot`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ conversation_id: selected.id, messages: next }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setCopilotMsgs((m) => [...m, { role: 'assistant', content: data.answer || '(sin respuesta)' }]);
    } catch (e) {
      setCopilotMsgs((m) => [...m, { role: 'assistant', content: `⚠ ${e.message}` }]);
    } finally {
      setCopilotBusy(false);
    }
  };

  const copyText = (text, idx) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    }).catch(() => {});
  };

  return (
    <div>
      {/* Demo / status banner */}
      {isDemo && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 mb-4 text-sm text-blue-200">
          <strong>Preview (demo)</strong> — The SMS backend isn't connected yet,
          so you're seeing sample conversations to review the experience. Once
          Twilio is live, real customer messages will appear here and you'll be
          able to reply from this same screen.
        </div>
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            💬 Messages
            {totalUnread > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                {totalUnread}
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500 hidden sm:block">
            Customer conversations over SMS &amp; WhatsApp · reply or approve AI drafts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Out-of-office auto-reply toggle. When on, inbound texts get one
              friendly "we're away" auto-reply until the team is back. */}
          <button
            onClick={() => saveOutOfOffice(!outOfOffice)}
            disabled={ooBusy}
            title={outOfOffice
              ? 'Out of office is ON — customers get an auto-reply. Click to turn off.'
              : 'Turn on to auto-reply to customers while you are away.'}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition disabled:opacity-60 ${
              outOfOffice
                ? 'bg-amber-400/20 text-amber-200 border border-amber-400/40 hover:bg-amber-400/30'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            {outOfOffice ? '🌙 Out of office · ON' : '🌙 Out of office'}
          </button>
          {notifState !== 'hidden' && (
            <button
              onClick={handleEnableNotifications}
              disabled={notifState === 'busy' || notifState === 'on' || notifState === 'denied'}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition ${
                notifState === 'on'
                  ? 'bg-green-500/15 text-green-300 cursor-default'
                  : notifState === 'denied'
                  ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                  : 'bg-amber-400/15 text-amber-300 hover:bg-amber-400/25'
              }`}
            >
              {notifState === 'on' ? '🔔 Alerts on'
                : notifState === 'busy' ? '🔔 Enabling…'
                : notifState === 'denied' ? '🔕 Alerts blocked'
                : '🔔 Enable alerts'}
            </button>
          )}
          <button
            onClick={() => loadConversations()}
            className="px-3 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-300 hover:bg-white/10 transition"
          >
            🔄 <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Channel sub-tabs — one inbox, SMS and WhatsApp side by side. Each shows
          its own unread count + how many AI drafts are waiting for approval. */}
      <div className="flex items-center gap-2 mb-4">
        {[
          { key: 'sms', label: '💬 SMS' },
          { key: 'whatsapp', label: '🟢 WhatsApp' },
        ].map((t) => {
          const stats = channelStats[t.key] || { unread: 0, drafts: 0 };
          const activeTab = channelTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => switchChannel(t.key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${
                activeTab
                  ? 'bg-amber-400 text-black'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              {t.label}
              {stats.drafts > 0 && (
                <span className={`text-[10px] font-bold rounded-full px-1.5 h-4 flex items-center ${
                  activeTab ? 'bg-black/20 text-black' : 'bg-purple-500/30 text-purple-200'
                }`}>
                  ✍️ {stats.drafts}
                </span>
              )}
              {stats.unread > 0 && (
                <span className={`text-[10px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center ${
                  activeTab ? 'bg-black/20 text-black' : 'bg-green-500 text-white'
                }`}>
                  {stats.unread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Out-of-office banner — shows the message customers auto-receive while
          away, and lets the owner edit it. Only visible when the toggle is on. */}
      {outOfOffice && (
        <div className="bg-amber-400/10 border border-amber-400/25 rounded-xl px-4 py-3 mb-4 text-sm text-amber-100">
          {!ooEditing ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-amber-200 mb-0.5">🌙 Out of office is on</div>
                <div className="text-amber-100/80 text-xs">
                  New customers get this auto-reply (once each, until you turn it off):
                </div>
                <div className="mt-1 text-amber-50/90 italic">“{ooMessage}”</div>
              </div>
              <button
                onClick={() => { setOoDraft(ooMessage); setOoEditing(true); }}
                className="flex-shrink-0 text-xs font-medium bg-amber-400/15 text-amber-200 border border-amber-400/30 rounded-lg px-2.5 py-1.5 hover:bg-amber-400/25 transition"
              >
                ✏️ Edit
              </button>
            </div>
          ) : (
            <div>
              <div className="font-semibold text-amber-200 mb-1.5">Edit the away message</div>
              <textarea
                value={ooDraft}
                onChange={(e) => setOoDraft(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-black/20 border border-amber-400/30 rounded-lg text-amber-50 text-sm focus:outline-none focus:border-amber-400/60 resize-y"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => saveOutOfOffice(true, ooDraft)}
                  disabled={ooBusy || !ooDraft.trim()}
                  className="text-xs font-semibold bg-amber-400 text-black rounded-lg px-3 py-1.5 hover:bg-amber-300 transition disabled:opacity-50"
                >
                  {ooBusy ? 'Saving…' : 'Save message'}
                </button>
                <button
                  onClick={() => setOoEditing(false)}
                  className="text-xs font-medium text-amber-200/80 hover:text-amber-100 px-2 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* iPhone: web push only works once the site is installed on the home
          screen (iOS 16.4+), so walk the user through that first. */}
      {showIosHint && notifState === 'ios-install' && (
        <div className="bg-amber-400/10 border border-amber-400/25 rounded-xl px-4 py-3 mb-4 text-sm text-amber-200">
          <strong>To get alerts on iPhone:</strong> first install the app.
          Tap Safari's <strong>Share</strong> button (the box with an ↑ arrow) and
          choose <strong>"Add to Home Screen"</strong>. Then open the
          <strong> RQC Admin</strong> app from your home screen and tap
          "Enable alerts" again.
        </div>
      )}
      {notifState === 'denied' && (
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-4 text-xs text-gray-400">
          Alerts are blocked for this site. To enable them, allow notifications in
          your browser settings (Site settings → Notifications → Allow) and reload
          the page.
        </div>
      )}

      {/* Mobile (under md): WhatsApp-style master-detail — the list fills the
          screen until a thread is opened, then the thread takes over with a
          back arrow. Desktop (md+): classic two-pane side by side.
          100dvh-based height keeps the composer above the phone keyboard. */}
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] gap-4 h-[calc(100dvh-15rem)] min-h-[420px] md:h-[640px]">
        {/* ── Left: conversation list ── */}
        <div className={`bg-[#1a1f26] rounded-2xl flex-col overflow-hidden ${selected ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-3 border-b border-white/5">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
              <input
                type="text"
                placeholder="Search by name or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-amber-400/50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-gray-500 text-sm">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">
                No conversations yet.
              </div>
            ) : (
              filtered.map((c) => {
                const msgs = c.messages || [];
                // Preview the last message ON THIS TAB's channel.
                const last = [...msgs].reverse().find((m) => msgChannel(m) === channelTab)
                  || msgs[msgs.length - 1];
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className={`w-full text-left px-4 py-3 border-b border-white/5 transition flex gap-3 items-start ${
                      active ? 'bg-amber-400/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/40 to-purple-500/30 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {(c.customer_name || '?').trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white truncate">
                          {c.customer_name || formatPhone(c.phone)}
                        </span>
                        <span className="text-[10px] text-gray-500 flex-shrink-0">
                          {formatTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className={`text-xs truncate ${c.unread > 0 ? 'text-gray-200 font-medium' : 'text-gray-500'}`}>
                          {last?.direction === 'outbound' ? '↩ ' : ''}{last?.body}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {hasPendingDraftInChannel(c, channelTab) && (
                            <span className="bg-purple-500/30 text-purple-200 text-[10px] font-bold rounded-full px-1.5 h-4 flex items-center" title="AI draft waiting for approval">
                              ✍️
                            </span>
                          )}
                          {c.unread > 0 && (
                            <span className="bg-green-500 text-white text-[10px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
                              {c.unread}
                            </span>
                          )}
                        </div>
                      </div>
                      {c.opted_out && (
                        <span className="inline-block mt-1 text-[10px] text-red-300 bg-red-500/15 border border-red-500/25 rounded px-1.5 py-0.5">
                          Opted out (STOP)
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: open conversation ── */}
        <div className={`bg-[#1a1f26] rounded-2xl flex-col overflow-hidden ${selected ? 'flex' : 'hidden md:flex'}`}>
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-2">
              <div className="text-5xl">💬</div>
              <p className="text-sm">Select a conversation to view it</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="md:hidden -ml-1 px-2 py-1.5 rounded-lg text-gray-300 hover:bg-white/10 transition flex-shrink-0"
                    aria-label="Back to list"
                  >
                    ←
                  </button>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500/40 to-purple-500/30 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                    {(selected.customer_name || '?').trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {selected.customer_name || 'Customer'}
                    </div>
                    <div className="text-xs text-gray-500">{formatPhone(selected.phone)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setCopilotOpen(true)}
                    className="text-xs font-semibold bg-indigo-500/15 text-indigo-200 border border-indigo-400/30 rounded-lg px-2.5 py-1.5 hover:bg-indigo-500/25 transition"
                    title="Ask the AI privately about this order"
                  >
                    🤖 Ask AI
                  </button>
                  {selected.order_id && (
                    <span className="text-xs text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-lg px-2.5 py-1 hidden sm:inline">
                      📦 {selected.order_id}
                    </span>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {selected.messages.map((m) => {
                  // Discarded drafts are hidden from the thread.
                  if (m.status === 'discarded') return null;

                  const mCh = msgChannel(m);
                  // Messages from the OTHER channel: an unsent draft belongs to
                  // its own tab (approve it there), so hide it here; a real
                  // message shows as a muted "— sent via SMS/WhatsApp · time"
                  // context line so you keep the full history without confusion.
                  if (mCh !== channelTab) {
                    if (m.status === 'draft') return null;
                    const outX = m.direction === 'outbound';
                    return (
                      <div key={m.id} className={`flex ${outX ? 'justify-end' : 'justify-start'} opacity-60`}>
                        <div className="max-w-[80%] rounded-2xl px-3.5 py-2 bg-white/5 border border-dashed border-white/15">
                          <div className="text-[9px] uppercase tracking-wide text-gray-400 mb-0.5">
                            {mCh === 'whatsapp' ? '🟢 vía WhatsApp' : '💬 vía SMS'} · {outX ? 'enviado' : 'recibido'} {formatTime(m.created_at)}
                          </div>
                          <p className="text-xs whitespace-pre-wrap break-words text-gray-300">{m.body}</p>
                        </div>
                      </div>
                    );
                  }

                  // AI draft awaiting the owner's approval — full-width card with
                  // Approve · Edit · Discard. Nothing here has been sent yet.
                  if (m.status === 'draft') {
                    const editing = editingDraftId === m.id;
                    return (
                      <div key={m.id} className="flex justify-end">
                        <div className="w-full max-w-[92%] rounded-2xl border border-purple-400/40 bg-purple-500/10 px-3.5 py-3">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-[11px] font-semibold text-purple-200 flex items-center gap-1">
                              ✍️ AI draft — review before sending
                            </span>
                            {m.needs_human && (
                              <span className="text-[10px] font-bold text-amber-200 bg-amber-400/15 border border-amber-400/30 rounded px-1.5 py-0.5">
                                ⚠ needs a human
                              </span>
                            )}
                          </div>

                          {editing ? (
                            <textarea
                              value={draftEdit}
                              onChange={(e) => setDraftEdit(e.target.value)}
                              rows={3}
                              className="w-full resize-none px-3 py-2 bg-white/5 border border-white/15 rounded-lg text-white text-sm focus:outline-none focus:border-amber-400/50"
                            />
                          ) : (
                            <p className="text-sm whitespace-pre-wrap break-words text-white">{m.body}</p>
                          )}

                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <button
                              onClick={() => handleApproveDraft(m)}
                              disabled={draftBusy || selected.opted_out}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500 text-white hover:bg-green-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {draftBusy ? '…' : editing ? '✓ Send edited' : '✓ Approve & send'}
                            </button>
                            {editing ? (
                              <button
                                onClick={() => { setEditingDraftId(null); setDraftEdit(''); }}
                                disabled={draftBusy}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-gray-200 hover:bg-white/15 transition"
                              >
                                Cancel edit
                              </button>
                            ) : (
                              <button
                                onClick={() => { setEditingDraftId(m.id); setDraftEdit(m.body); }}
                                disabled={draftBusy}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-gray-200 hover:bg-white/15 transition"
                              >
                                ✏️ Edit
                              </button>
                            )}
                            <button
                              onClick={() => handleDiscardDraft(m)}
                              disabled={draftBusy}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-300 hover:bg-red-500/25 transition"
                            >
                              Discard
                            </button>
                          </div>
                          {selected.opted_out && (
                            <p className="text-[10px] text-red-300 mt-1.5">
                              Customer opted out — this draft can't be sent.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const out = m.direction === 'outbound';
                  return (
                    <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
                          out
                            ? 'bg-amber-400 text-black rounded-br-sm'
                            : 'bg-white/8 text-white rounded-bl-sm'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                        <div className={`text-[10px] mt-1 flex items-center gap-1 ${out ? 'text-black/50 justify-end' : 'text-gray-400'}`}>
                          {m.ai_generated && out && <span title="Sent from an approved AI draft">🤖</span>}
                          <span>{formatTime(m.created_at)}</span>
                          {out && (
                            <span>
                              · {m.status === 'queued' ? 'sending…'
                                : m.status === 'failed' ? '⚠ failed'
                                : m.status === 'sent' ? '✓ sent'
                                : '✓✓ delivered'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Composer */}
              {selected.opted_out ? (
                <div className="px-4 py-4 border-t border-white/5 bg-red-500/5">
                  <p className="text-sm text-red-300 text-center">
                    🚫 This customer sent <strong>STOP</strong> and opted out of SMS.
                    By law you can't message them again until they write back.
                  </p>
                </div>
              ) : (
                <div className="px-4 py-3 border-t border-white/5">
                  {/* One-tap quick replies — fill the box, then edit/Send. The
                      first one asks for the email so you can look them up when
                      the copilot can't find them by phone. */}
                  <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {[
                      { label: '📧 Pedir correo', text: '¡Con gusto te ayudo a localizar tu canción! 🎵 ¿Me compartes el correo con el que hiciste tu pedido, por favor?' },
                      { label: '⏳ Un momento', text: '¡Claro! Dame un momentito por favor mientras lo reviso 🙏' },
                      { label: '🎵 Nombre', text: '¿Me confirmas el nombre de la persona a quien va dedicada la canción? Así la ubico más rápido 😊' },
                      { label: '❤️ ¿Algo más?', text: '¡Con mucho gusto! ¿Hay algo más en lo que te pueda ayudar? ❤️' },
                    ].map((q) => (
                      <button
                        key={q.label}
                        onClick={() => setReply(q.text)}
                        className="flex-shrink-0 text-xs bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 rounded-full px-3 py-1.5 transition whitespace-nowrap"
                        title={q.text}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={replyRef}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      rows={1}
                      placeholder="Type a message…  (Enter to send)"
                      className="flex-1 resize-none overflow-y-auto px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm leading-relaxed focus:outline-none focus:border-amber-400/50"
                    />
                    <button
                      onClick={handleSend}
                      disabled={sending || !reply.trim()}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-400 text-black hover:bg-amber-300 transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {sending ? '…' : 'Send'}
                    </button>
                  </div>
                  {/* Cost / encoding hint — reinforces the Spanish-accent cost gotcha */}
                  {reply.trim() && (
                    <div className="mt-1.5 text-[11px] text-gray-500 flex items-center gap-3">
                      <span>{segInfo.chars} characters</span>
                      <span>·</span>
                      <span>
                        {segInfo.segments} {segInfo.segments === 1 ? 'segment' : 'segments'}
                        {segInfo.encoding === 'UCS-2' && (
                          <span className="text-amber-400/80"> (accents/emoji → 70 limit)</span>
                        )}
                      </span>
                      <span>·</span>
                      <span>~${replyCost} USD</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Admin "Ask AI" copilot — private, about the open order ── */}
      {copilotOpen && selected && (
        <div className="fixed inset-0 z-[10000] flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCopilotOpen(false)} />
          <div className="relative w-full max-w-md h-full bg-[#141922] border-l border-white/10 flex flex-col shadow-2xl">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white flex items-center gap-2">🤖 Ask AI <span className="text-[10px] font-normal text-indigo-300 bg-indigo-500/15 rounded px-1.5 py-0.5">private</span></p>
                <p className="text-[11px] text-gray-500 truncate">About {selected.customer_name || formatPhone(selected.phone)}'s order — only you see this</p>
              </div>
              <button onClick={() => setCopilotOpen(false)} className="text-gray-400 hover:text-white px-2 text-lg" aria-label="Close">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {copilotMsgs.length === 0 ? (
                <div className="text-center text-gray-500 text-sm mt-4">
                  Ask about this order — payment, links, song details, lyrics.
                  <div className="mt-3 flex flex-col gap-1.5 text-left">
                    {['¿Ya pagó? Dame su link de descarga', '¿Cuál es su link de preview?', '¿Cuál es la letra de su canción?'].map((s) => (
                      <button key={s} onClick={() => setCopilotInput(s)} className="text-xs text-indigo-300 bg-indigo-500/10 rounded-lg px-2.5 py-1.5 hover:bg-indigo-500/20 transition">{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                copilotMsgs.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 ${m.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-white/8 text-gray-100'}`}>
                      <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                      {m.role === 'assistant' && (
                        <button onClick={() => copyText(m.content, i)} className="mt-1 text-[10px] text-gray-400 hover:text-white transition">
                          {copiedIdx === i ? '✓ Copied' : '📋 Copy'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              {copilotBusy && <div className="text-xs text-gray-500 pl-1">Thinking…</div>}
            </div>

            <div className="px-3 py-3 border-t border-white/10 flex items-end gap-2">
              <textarea
                ref={copilotInputRef}
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCopilotSend(); } }}
                rows={1}
                placeholder="Ask about this order…"
                className="flex-1 resize-none overflow-y-auto px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm leading-relaxed placeholder-gray-500 focus:outline-none focus:border-indigo-400/50"
              />
              <button
                onClick={handleCopilotSend}
                disabled={copilotBusy || !copilotInput.trim()}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-500 text-white hover:bg-indigo-400 transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              >
                {copilotBusy ? '…' : 'Ask'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
