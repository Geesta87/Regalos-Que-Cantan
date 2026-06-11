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
const DEMO_CONVERSATIONS = [
  {
    id: 'demo-1',
    customer_name: 'María González',
    phone: '+12135550142',
    order_id: 'ord_demo_8821',
    unread: 2,
    opted_out: false,
    last_message_at: '2026-06-09T17:42:00Z',
    messages: [
      { id: 'm1', direction: 'outbound', status: 'delivered', created_at: '2026-06-09T16:10:00Z',
        body: '¡Hola María! 🎵 Tu canción para Roberto ya está lista. Escúchala aquí: https://regalosquecantan.com/c/8821' },
      { id: 'm2', direction: 'inbound', status: 'received', created_at: '2026-06-09T17:40:00Z',
        body: '¡Quedó hermosa! Pero la quiero un poco más romántica, ¿se puede cambiar?' },
      { id: 'm3', direction: 'inbound', status: 'received', created_at: '2026-06-09T17:42:00Z',
        body: 'Es para nuestro aniversario el sábado 🙏' },
    ],
  },
  {
    // Post-purchase order confirmation + a delivery-status question. Both are
    // within the approved transactional campaign (order confirmation, delivery
    // status, customer care). NO promotional / unpaid-lead messaging.
    id: 'demo-2',
    customer_name: 'Ana Martínez',
    phone: '+13235550199',
    order_id: 'ord_demo_8830',
    unread: 1,
    opted_out: false,
    last_message_at: '2026-06-09T15:05:00Z',
    messages: [
      { id: 'm1', direction: 'outbound', status: 'delivered', created_at: '2026-06-09T14:50:00Z',
        body: 'Confirmamos tu pedido en Regalos Que Cantan ✅ Tu canción se está creando y te enviaremos el enlace por aquí en unos minutos.' },
      { id: 'm2', direction: 'inbound', status: 'received', created_at: '2026-06-09T15:05:00Z',
        body: '¿Cuánto tiempo tarda en estar lista?' },
    ],
  },
  {
    id: 'demo-3',
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
    id: 'demo-4',
    customer_name: 'Cliente (dio de baja)',
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
  // Push-notification button state:
  // 'hidden' (unsupported desktop browser), 'ios-install' (iPhone Safari tab —
  // must add to home screen first), 'off', 'busy', 'on', 'denied'.
  const [notifState, setNotifState] = useState('hidden');
  const [showIosHint, setShowIosHint] = useState(false);
  const scrollRef = useRef(null);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...conversations].sort(
      (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)
    );
    if (!q) return sorted;
    return sorted.filter((c) =>
      (c.customer_name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    );
  }, [conversations, search]);

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
            body: JSON.stringify({ action: 'send', conversation_id: selected.id, body }),
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

  return (
    <div>
      {/* Demo / status banner */}
      {isDemo && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 mb-4 text-sm text-blue-200">
          <strong>Vista previa (demo)</strong> — El backend de SMS aún no está
          conectado, así que estás viendo conversaciones de ejemplo para revisar
          la experiencia. Cuando se active Twilio, aquí aparecerán los mensajes
          reales de los clientes y podrás responder desde esta misma pantalla.
        </div>
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            💬 Mensajes SMS
            {totalUnread > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                {totalUnread}
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500 hidden sm:block">
            Conversaciones de texto con clientes · responde igual que en WhatsApp
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              {notifState === 'on' ? '🔔 Avisos activados'
                : notifState === 'busy' ? '🔔 Activando…'
                : notifState === 'denied' ? '🔕 Avisos bloqueados'
                : '🔔 Activar avisos'}
            </button>
          )}
          <button
            onClick={() => loadConversations()}
            className="px-3 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-300 hover:bg-white/10 transition"
          >
            🔄 <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </div>

      {/* iPhone: web push only works once the site is installed on the home
          screen (iOS 16.4+), so walk the user through that first. */}
      {showIosHint && notifState === 'ios-install' && (
        <div className="bg-amber-400/10 border border-amber-400/25 rounded-xl px-4 py-3 mb-4 text-sm text-amber-200">
          <strong>Para recibir avisos en iPhone:</strong> primero instala la app.
          Toca el botón <strong>Compartir</strong> (cuadro con flecha ↑) de Safari y
          elige <strong>"Agregar a pantalla de inicio"</strong>. Luego abre la app
          <strong> RQC Admin</strong> desde tu pantalla de inicio y vuelve a tocar
          "Activar avisos".
        </div>
      )}
      {notifState === 'denied' && (
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-4 text-xs text-gray-400">
          Los avisos están bloqueados para este sitio. Para activarlos, permite las
          notificaciones en la configuración de tu navegador (Ajustes del sitio →
          Notificaciones → Permitir) y recarga la página.
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
                placeholder="Buscar por nombre o teléfono..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-amber-400/50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-gray-500 text-sm">Cargando…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">
                No hay conversaciones todavía.
              </div>
            ) : (
              filtered.map((c) => {
                const last = c.messages[c.messages.length - 1];
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
                        {c.unread > 0 && (
                          <span className="bg-green-500 text-white text-[10px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center flex-shrink-0">
                            {c.unread}
                          </span>
                        )}
                      </div>
                      {c.opted_out && (
                        <span className="inline-block mt-1 text-[10px] text-red-300 bg-red-500/15 border border-red-500/25 rounded px-1.5 py-0.5">
                          Dio de baja (STOP)
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
              <p className="text-sm">Selecciona una conversación para verla</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="md:hidden -ml-1 px-2 py-1.5 rounded-lg text-gray-300 hover:bg-white/10 transition flex-shrink-0"
                    aria-label="Volver a la lista"
                  >
                    ←
                  </button>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500/40 to-purple-500/30 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                    {(selected.customer_name || '?').trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {selected.customer_name || 'Cliente'}
                    </div>
                    <div className="text-xs text-gray-500">{formatPhone(selected.phone)}</div>
                  </div>
                </div>
                {selected.order_id && (
                  <span className="text-xs text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-lg px-2.5 py-1 flex-shrink-0">
                    📦 {selected.order_id}
                  </span>
                )}
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {selected.messages.map((m) => {
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
                          <span>{formatTime(m.created_at)}</span>
                          {out && (
                            <span>
                              · {m.status === 'queued' ? 'enviando…'
                                : m.status === 'failed' ? '⚠ falló'
                                : m.status === 'sent' ? '✓ enviado'
                                : '✓✓ entregado'}
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
                    🚫 Este cliente envió <strong>STOP</strong> y se dio de baja de los SMS.
                    Por ley no puedes enviarle más mensajes hasta que vuelva a escribir.
                  </p>
                </div>
              ) : (
                <div className="px-4 py-3 border-t border-white/5">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      rows={1}
                      placeholder="Escribe un mensaje…  (Enter para enviar)"
                      className="flex-1 resize-none px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-amber-400/50 max-h-32"
                    />
                    <button
                      onClick={handleSend}
                      disabled={sending || !reply.trim()}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-400 text-black hover:bg-amber-300 transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {sending ? '…' : 'Enviar'}
                    </button>
                  </div>
                  {/* Cost / encoding hint — reinforces the Spanish-accent cost gotcha */}
                  {reply.trim() && (
                    <div className="mt-1.5 text-[11px] text-gray-500 flex items-center gap-3">
                      <span>{segInfo.chars} caracteres</span>
                      <span>·</span>
                      <span>
                        {segInfo.segments} {segInfo.segments === 1 ? 'segmento' : 'segmentos'}
                        {segInfo.encoding === 'UCS-2' && (
                          <span className="text-amber-400/80"> (acentos/emoji → límite de 70)</span>
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
    </div>
  );
}
