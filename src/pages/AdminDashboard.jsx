import React, { useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';
import { AppContext } from '../App';
import { supabase } from '../services/api';
import { trackStep, FUNNEL_STEPS } from '../services/tracking';
import ClonamivozAdminTab from '../components/admin/ClonamivozAdminTab';
import SmsInboxTab from '../components/admin/SmsInboxTab';

// Debounce hook for search inputs
function useDebounce(value, delay = 350) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// ✅ STRICT: Check if a song row is actually paid. Pure function — kept at
// module scope so any hook/effect/useMemo inside the component can call it
// without worrying about temporal-dead-zone (referencing a const defined
// later in the function body throws and unmounts the dashboard).
function isPaid(song) {
  if (!song) return false;
  if (song.paid === true) return true;
  if (song.paid === 'true') return true;
  if (song.paid === 1) return true;
  if (song.is_paid === true) return true;
  if (song.payment_status === 'paid') return true;
  if (song.payment_status === 'completed') return true;
  if (song.payment_status === 'succeeded') return true;
  if (song.stripe_payment_id) return true;
  if (song.paid_at) return true;
  if (song.amount_paid && parseFloat(song.amount_paid) > 0) return true;
  // NOTE: stripe_session_id alone does NOT mean paid — it's created when
  // checkout starts.
  return false;
}

// Valentine blast email builder
function buildValentineBlastEmail(recipientName) {
  const hasRecipient = recipientName && recipientName.trim().length > 0;
  const ctaUrl = 'https://www.regalosquecantan.com/v2';
  const headline = hasRecipient
    ? `&iquest;A&uacute;n no le diste su regalo a <span style="color:#ff6b8a;">${recipientName}</span>?`
    : `&iquest;A&uacute;n no tienes el regalo perfecto?`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>San Valent&iacute;n</title><style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}body{margin:0!important;padding:0!important;width:100%!important;}@media only screen and (max-width:620px){.email-container{width:100%!important;}.mobile-padding{padding-left:16px!important;padding-right:16px!important;}.mobile-text{font-size:24px!important;}}</style></head>
<body style="margin:0;padding:0;background-color:#0a0507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0a0507;">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container" style="max-width:600px;width:100%;">
<tr><td style="background:linear-gradient(90deg,#c9184a,#e8364f,#c9184a);padding:14px 20px;text-align:center;border-radius:12px 12px 0 0;">
<span style="color:#ffffff;font-size:14px;font-weight:800;letter-spacing:1px;">&#9200; SAN VALENT&Iacute;N ES MA&Ntilde;ANA &mdash; QUEDAN POCAS HORAS</span></td></tr>
<tr><td style="background-color:#1a080e;border-left:1px solid rgba(201,24,74,0.2);border-right:1px solid rgba(201,24,74,0.2);">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr><td align="center" style="padding:48px 40px 0;" class="mobile-padding"><div style="font-size:64px;line-height:1;">&#128152;</div></td></tr>
<tr><td align="center" style="padding:20px 32px 0;" class="mobile-padding"><h1 class="mobile-text" style="margin:0;font-size:32px;line-height:1.2;color:#ffffff;font-weight:800;">${headline}</h1></td></tr>
<tr><td align="center" style="padding:16px 40px 0;" class="mobile-padding"><p style="margin:0;font-size:17px;color:rgba(255,255,255,0.6);line-height:1.6;">Ma&ntilde;ana es <strong style="color:#ff8fa3;">14 de febrero</strong>. Todav&iacute;a est&aacute;s a tiempo de regalar algo que <strong style="color:#ffffff;">nadie m&aacute;s puede dar</strong>.</p></td></tr>
<tr><td align="center" style="padding:28px 50px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="60"><tr><td style="border-top:1px solid rgba(201,24,74,0.3);font-size:1px;">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:0 36px;" class="mobile-padding">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:rgba(201,24,74,0.06);border:1px solid rgba(201,24,74,0.15);border-radius:16px;">
<tr><td style="padding:28px;">
<p style="margin:0 0 16px;font-size:13px;color:#ff8fa3;font-weight:700;letter-spacing:1px;text-transform:uppercase;">&#10024; UNA CANCI&Oacute;N &Uacute;NICA EN ~3 MINUTOS</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr><td style="padding:6px 0;font-size:15px;color:rgba(255,255,255,0.75);line-height:1.5;">&#9829; Letra personalizada con nombres reales</td></tr>
<tr><td style="padding:6px 0;font-size:15px;color:rgba(255,255,255,0.75);line-height:1.5;">&#9829; Elige entre 20+ g&eacute;neros: corrido, bachata, reggaet&oacute;n...</td></tr>
<tr><td style="padding:6px 0;font-size:15px;color:rgba(255,255,255,0.75);line-height:1.5;">&#9829; 2 versiones &uacute;nicas para elegir</td></tr>
<tr><td style="padding:6px 0;font-size:15px;color:rgba(255,255,255,0.75);line-height:1.5;">&#9829; Descarga MP3 + p&aacute;gina de regalo especial</td></tr>
<tr><td style="padding:6px 0;font-size:15px;color:rgba(255,255,255,0.75);line-height:1.5;">&#9829; Preview GRATIS antes de pagar</td></tr>
</table></td></tr></table></td></tr>
<tr><td align="center" style="padding:32px 40px 12px;" class="mobile-padding">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
<tr><td align="center" style="border-radius:50px;background:linear-gradient(135deg,#c9184a,#a01540);">
<a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:19px 48px;font-size:18px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:50px;background:linear-gradient(135deg,#c9184a,#a01540);text-align:center;box-shadow:0 4px 20px rgba(201,24,74,0.4);">&#9829; CREAR SU CANCI&Oacute;N AHORA</a>
</td></tr></table></td></tr>
<tr><td align="center" style="padding:0 40px 8px;"><p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);">&#128274; Preview gratis &bull; Listo en minutos &bull; Pago seguro</p></td></tr>
<tr><td align="center" style="padding:20px 36px 0;" class="mobile-padding">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:rgba(255,0,0,0.06);border:1px solid rgba(255,0,0,0.15);border-radius:12px;">
<tr><td align="center" style="padding:20px;">
<p style="margin:0;font-size:15px;color:#ff6b6b;font-weight:700;">&#128680; Ma&ntilde;ana 14 de febrero ya no hay tiempo</p>
<p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.5;">Crea la canci&oacute;n HOY y tenla lista para ma&ntilde;ana.<br/>En 3 minutos tienes el regalo m&aacute;s &uacute;nico que puedes dar.</p>
</td></tr></table></td></tr>
<tr><td style="padding:28px 36px;" class="mobile-padding">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;">
<tr><td style="padding:20px 24px;">
<p style="margin:0;font-size:15px;color:rgba(255,255,255,0.65);font-style:italic;line-height:1.6;text-align:center;">&ldquo;Mi esposa llor&oacute; de felicidad. Nunca hab&iacute;a visto una reacci&oacute;n as&iacute; con un regalo.&rdquo;</p>
<p style="margin:10px 0 0;font-size:12px;color:#ff8fa3;font-weight:600;text-align:center;">&mdash; Roberto M. &nbsp;&#11088;&#11088;&#11088;&#11088;&#11088;</p>
</td></tr></table></td></tr>
</table></td></tr>
<tr><td style="background-color:#1a080e;padding:20px 36px;text-align:center;border-top:1px solid rgba(201,24,74,0.1);border-left:1px solid rgba(201,24,74,0.2);border-right:1px solid rgba(201,24,74,0.2);border-radius:0 0 12px 12px;">
<p style="margin:0 0 8px;font-size:12px;color:rgba(255,255,255,0.2);">&iquest;Preguntas? <a href="https://wa.me/12136666619?text=Hola%2C%20tengo%20una%20pregunta%20sobre%20RegalosQueCantan" style="color:#ff8fa3;text-decoration:none;">Escr&iacute;benos por WhatsApp</a></p>
<p style="margin:0;font-size:10px;color:rgba(255,255,255,0.1);letter-spacing:1px;">&copy; 2026 RegalosQueCantan &bull; Hecho con &#9829;</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

export default function AdminDashboard() {
  const { navigateTo } = useContext(AppContext);
  const [userRole, setUserRole] = useState(null); // 'admin' | 'assistant' | null
  const [accessToken, setAccessToken] = useState(null);
  // isAuthChecking gates the full-page spinner. Once auth is verified the
  // dashboard renders even if the songs fetch is still in flight (the songs
  // payload is multi-MB and used to wedge the whole UI behind it).
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [songs, setSongs] = useState([]);
  const [isLoading, setIsLoading] = useState(false); // songs-fetch indicator only
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedSong, setSelectedSong] = useState(null);
  const [activeTab, setActiveTab] = useState('orders');
  // Toast notifications — replaces blocking window.alert() popups. showToast
  // keeps showToast()'s single-string call signature, so call sites swap 1:1.
  // Type (success/error/info) is auto-detected from the message when omitted.
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((message, type) => {
    const msg = String(message);
    let kind = type;
    if (!kind) {
      if (msg.includes('✅') || /(copiad|copied|sent|enviad|updated|saved|marked|regenerat)/i.test(msg)) kind = 'success';
      else if (msg.includes('❌') || /(error|failed|falta|no se|invalid|could not|cannot)/i.test(msg)) kind = 'error';
      else kind = 'info';
    }
    const clean = msg.replace(/[✅❌⚠️]/g, '').trim();
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message: clean, type: kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);
  const [blastStatus, setBlastStatus] = useState(null); // null | 'loading' | 'preview' | 'sending' | 'done'
  const [blastData, setBlastData] = useState(null);
  const [dateRange, setDateRange] = useState('7days');
  const [funnelData, setFunnelData] = useState([]);
  const [emailLogs, setEmailLogs] = useState([]);
  const [emailPreview, setEmailPreview] = useState(null);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [emailCampaigns, setEmailCampaigns] = useState([]);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [emailFilter, setEmailFilter] = useState('all'); // all, purchase_confirmation, abandoned_1hr, abandoned_24hr, failed
  const [previewingCampaign, setPreviewingCampaign] = useState(null);
  const [resendingEmail, setResendingEmail] = useState(null);
  // Mureka credits (admin-only banner)
  const [murekaCredits, setMurekaCredits] = useState(null); // { balance, estimated_remaining, anchored_at, status, ... }
  const [murekaModalOpen, setMurekaModalOpen] = useState(false);
  const [murekaSaving, setMurekaSaving] = useState(false);
  const [murekaForm, setMurekaForm] = useState({ balance: '', low_threshold: '', critical_threshold: '', credits_per_generation: '' });
  // Social posting pipeline toggle (FB · IG · TikTok · YT via GHL)
  const [socialPipeline, setSocialPipeline] = useState(null); // { enabled, updated_at, role }
  const [socialToggling, setSocialToggling] = useState(false);
  const [lookupSearch, setLookupSearch] = useState('');
  const [lookupSearchType, setLookupSearchType] = useState('all'); // 'all', 'email', 'name', 'phone'
  const [copiedLinkId, setCopiedLinkId] = useState(null);
  const [hotLeadSort, setHotLeadSort] = useState('recent'); // 'recent', 'oldest'
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  // Affiliate tab state
  const [affiliates, setAffiliates] = useState([]);
  const [affiliatesLoaded, setAffiliatesLoaded] = useState(false);
  const [newAffiliate, setNewAffiliate] = useState({ name: '', email: '', code: '', couponCode: '', password: '' });
  const [creatingAffiliate, setCreatingAffiliate] = useState(false);
  const [affiliateMsg, setAffiliateMsg] = useState(null);
  // Record-payout modal state
  const [payoutModal, setPayoutModal] = useState(null); // { affiliate, suggestedAmount } | null
  const [payoutForm, setPayoutForm] = useState({ amount: '', method: '', note: '' });
  const [recordingPayout, setRecordingPayout] = useState(false);
  const [payoutModalError, setPayoutModalError] = useState('');
  const [ordersPage, setOrdersPage] = useState(0);
  const [lookupPage, setLookupPage] = useState(0);
  const ORDERS_PER_PAGE = 50;
  const LOOKUP_PER_PAGE = 50;
  // Server-side search results for the Lookup tab. null = no active search
  // (use local songs array). Populated by the useEffect below.
  const [lookupServerResults, setLookupServerResults] = useState(null);
  const [lookupServerTotal, setLookupServerTotal] = useState(0);
  const [lookupServerLoading, setLookupServerLoading] = useState(false);
  // Feature: internal admin notes on orders
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  // Feature: one-click retry for stuck/failed songs
  const [retryingId, setRetryingId] = useState(null);
  const [retryResult, setRetryResult] = useState(null); // { ok, message }
  // Feature: inline audio preview in orders table
  const [previewingId, setPreviewingId] = useState(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioRef = useRef(null);
  // Por Enviar (Pending to Send) tab state
  const [pendingSendSort, setPendingSendSort] = useState('oldest'); // 'oldest' | 'recent'
  const [selectedPendingIds, setSelectedPendingIds] = useState(() => new Set());
  const [markSendBusy, setMarkSendBusy] = useState(null); // songId currently being marked
  const [bulkSendBusy, setBulkSendBusy] = useState(false);
  const [autoMarkOnSend, setAutoMarkOnSend] = useState(true); // toggle: auto-mark when admin clicks WhatsApp
  const [backfillModalOpen, setBackfillModalOpen] = useState(false);
  const [backfillCutoff, setBackfillCutoff] = useState(() => {
    // Default: midnight last night (so "everything before today" is the obvious choice)
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm for datetime-local input
  });
  const [backfillBusy, setBackfillBusy] = useState(false);
  // Orders tab: "Today only" quick-filter
  const [todayOnly, setTodayOnly] = useState(false);
  // Search input ref so the "/" keyboard shortcut can focus it
  const searchInputRef = useRef(null);
  // Live payment notifications — toast queue + opt-in toggle stored in
  // localStorage so each admin gets to keep their own preference. Default ON
  // so admins are alerted out of the box; they can mute via the bell button.
  const [paymentToasts, setPaymentToasts] = useState([]);
  const [paymentAlertsEnabled, setPaymentAlertsEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const v = window.localStorage.getItem('rqc_admin_payment_alerts');
    return v === null ? true : v === 'true';
  });
  // High-water-mark of paid_at we've already seen — set after the first
  // fetch so we don't toast every historical row on page load.
  const paymentHighWaterRef = useRef(0);
  const seenPaymentIdsRef = useRef(new Set());
  // Running count of alerts fired since this dashboard tab was opened. Lets
  // admins verify "yes, the system is working — 3 payments came in today
  // and the bell rang each time" without needing to remember if the toast
  // already auto-dismissed.
  const [paymentAlertCount, setPaymentAlertCount] = useState(0);
  // Video orders: map of songId → video_order row (fetched on-demand when modal opens)
  const [videoOrdersMap, setVideoOrdersMap] = useState({});
  const [retryingVideo, setRetryingVideo] = useState(false);
  const debouncedSearchTerm = useDebounce(searchTerm);
  const debouncedLookupSearch = useDebounce(lookupSearch);
  const [stats, setStats] = useState({
    totalSongs: 0,
    totalRevenue: 0,
    paidOrders: 0,
    pendingOrders: 0,
    freeOrders: 0,
    todayRevenue: 0,
    todayOrders: 0,
    whatsappContacts: 0
  });

  // ─── Live payment-alert helpers ─────────────────────────────────────────
  // Declared HERE (above the auth useEffect + songs-watcher useEffect) so
  // that any effect referencing them has a value to read when it runs.
  // Moving them lower in the file caused a temporal-dead-zone ReferenceError
  // and a fully-blank dashboard.
  const playPaymentSound = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [
        { freq: 880, start: 0, dur: 0.18 },
        { freq: 1320, start: 0.12, dur: 0.25 },
      ].forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.35, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.02);
      });
    } catch {
      // Audio failed (no permission, no audio device, autoplay blocked).
    }
  }, []);

  const fireDesktopNotification = useCallback((song) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('💰 New paid song!', {
        body: song.recipient_name
          ? `For ${song.recipient_name}${song.sender_name ? ' — from ' + song.sender_name : ''}`
          : 'A new payment just came in.',
        tag: song.id,
        icon: '/favicon.png',
      });
    } catch {
      // ignore
    }
  }, []);

  const triggerPaymentAlert = useCallback((song) => {
    if (!song || !song.id) return;
    console.log('[admin-alerts] triggerPaymentAlert', song.id, song.recipient_name);
    if (seenPaymentIdsRef.current.has(song.id)) {
      console.log('[admin-alerts] skipped: already seen', song.id);
      return;
    }
    seenPaymentIdsRef.current.add(song.id);
    if (!paymentAlertsEnabled) {
      console.log('[admin-alerts] skipped: alerts disabled');
      return;
    }

    const toastId = `${song.id}:${Date.now()}`;
    setPaymentToasts(prev => [...prev, { id: toastId, song, at: Date.now() }]);
    setTimeout(() => {
      setPaymentToasts(prev => prev.filter(t => t.id !== toastId));
    }, 12000);
    playPaymentSound();
    fireDesktopNotification(song);
    setPaymentAlertCount(c => c + 1);
  }, [paymentAlertsEnabled, playPaymentSound, fireDesktopNotification]);

  // Bypasses the seen-id dedupe and the alerts-enabled toggle so admins can
  // verify the full toast + sound + desktop-notification pipeline is wired
  // up without waiting for a real payment to land.
  const fireTestPaymentAlert = useCallback(() => {
    console.log('[admin-alerts] TEST button clicked — firing fake payment alert');
    const fakeSong = {
      id: `test-${Date.now()}`,
      recipient_name: 'María González',
      sender_name: 'Roberto',
      amount_paid: 29.99,
      genre: 'mariachi',
      paid_at: new Date().toISOString(),
    };
    const toastId = `${fakeSong.id}`;
    setPaymentToasts(prev => {
      const next = [...prev, { id: toastId, song: fakeSong, at: Date.now() }];
      console.log('[admin-alerts] toast queue size:', next.length);
      return next;
    });
    setTimeout(() => {
      setPaymentToasts(prev => prev.filter(t => t.id !== toastId));
    }, 12000);
    playPaymentSound();
    fireDesktopNotification(fakeSong);
    // We deliberately do NOT bump paymentAlertCount on test fires so the
    // header counter reflects only real payments.
  }, [playPaymentSound, fireDesktopNotification]);

  // Check auth on mount: real Supabase Auth session + admin_users role lookup
  useEffect(() => {
    let cancelled = false;
    let emailSubscription = null;
    let campaignSubscription = null;

    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;

      if (!session?.user) {
        setIsAuthChecking(false);
        navigateTo('adminLogin');
        return;
      }

      const { data: roleRow, error: roleErr } = await supabase
        .from('admin_users')
        .select('role')
        .eq('user_id', session.user.id)
        .single();

      if (roleErr || !roleRow) {
        await supabase.auth.signOut();
        setIsAuthChecking(false);
        navigateTo('adminLogin');
        return;
      }

      if (cancelled) return;

      setUserRole(roleRow.role);
      setAccessToken(session.access_token);
      // Auth is good — let the dashboard render now. Data fetches continue
      // in the background; their loading state is shown inline, not full-page.
      setIsAuthChecking(false);

      // Pass the token directly into the first fetch so we don't race with
      // setAccessToken's async state commit.
      fetchSongs(session.access_token);
      fetchFunnelData();
      fetchEmailLogs();
      fetchEmailCampaigns();
      // Credit balance banner is visible to both roles. The edit button +
      // modal stay admin-only (the edge function rejects writes from assistants).
      fetchMurekaCredits(session.access_token);
      // Social-pipeline toggle is visible to both roles; only admins can flip it.
      fetchSocialPipeline(session.access_token);

      emailSubscription = supabase
        .channel('email_logs_changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_logs' }, (payload) => {
          setEmailLogs(prev => [payload.new, ...prev]);
        })
        .subscribe();

      campaignSubscription = supabase
        .channel('email_campaigns_changes')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'email_campaigns' }, (payload) => {
          setEmailCampaigns(prev => prev.map(c => c.id === payload.new.id ? payload.new : c));
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (emailSubscription) emailSubscription.unsubscribe();
      if (campaignSubscription) campaignSubscription.unsubscribe();
    };
  }, [dateRange]);

  // Poll for new payments every 30s so the dashboard catches new orders
  // even when the tab has been open for hours without manual refresh.
  //
  // CRITICAL: this MUST be its own effect with [accessToken] as the
  // dependency, NOT inside the auth useEffect above. Why: the auth
  // useEffect runs once on mount when accessToken is still null, so any
  // setInterval set up there captures a closure with token = null. Every
  // poll then bails out of fetchSongs (`if (!token) return`) and the
  // songs list never refreshes — which is exactly what was happening
  // until this fix. Splitting it out forces the interval to be torn down
  // and recreated with a fresh fetchSongs closure once accessToken lands.
  useEffect(() => {
    if (!accessToken) return;
    console.log('[admin-alerts] polling started, fetch every 30s');
    const handle = setInterval(() => {
      console.log('[admin-alerts] poll → fetchSongs');
      fetchSongs();
    }, 30000);
    return () => clearInterval(handle);
  }, [accessToken]);

  // Watch the songs list for newly-paid rows and fire a toast + sound for
  // each one. The first time songs lands we just record a high-water-mark
  // so existing paid orders don't all toast at once on page load. After
  // that, any paid_at newer than the watermark triggers an alert.
  useEffect(() => {
    if (!songs || songs.length === 0) return;

    // First load: capture every paid song id as "already seen" so we don't
    // alert on history.
    if (paymentHighWaterRef.current === 0) {
      let max = 0;
      for (const s of songs) {
        if (isPaid(s)) {
          seenPaymentIdsRef.current.add(s.id);
          const t = s.paid_at ? new Date(s.paid_at).getTime() : 0;
          if (t > max) max = t;
        }
      }
      paymentHighWaterRef.current = max || Date.now();
      return;
    }

    // Subsequent loads: anything newer than the watermark is a new payment.
    let newMax = paymentHighWaterRef.current;
    for (const s of songs) {
      if (!isPaid(s)) continue;
      const paidAtMs = s.paid_at ? new Date(s.paid_at).getTime() : 0;
      if (paidAtMs > paymentHighWaterRef.current) {
        triggerPaymentAlert(s);
        if (paidAtMs > newMax) newMax = paidAtMs;
      }
    }
    paymentHighWaterRef.current = newMax;
  }, [songs, triggerPaymentAlert]);

  // Sync note textarea whenever the admin opens a different song.
  useEffect(() => {
    setNoteText(selectedSong?.admin_notes || '');
    setNoteSaved(false);
    setRetryResult(null);
  }, [selectedSong?.id]);

  // Auto-fetch video order when a song with video addon is selected in the modal.
  // We only fetch once per songId (sentinel stored in map). Re-fetching can be
  // triggered manually by a "Refresh" button in the panel if needed.
  useEffect(() => {
    if (
      selectedSong?.id &&
      selectedSong?.has_video_addon &&
      !(selectedSong.id in videoOrdersMap)
    ) {
      fetchVideoOrder(selectedSong.id);
    }
  }, [selectedSong?.id, selectedSong?.has_video_addon]);

  // Save an internal admin note for the open song.
  const saveNote = async () => {
    if (!selectedSong || !accessToken) return;
    setNoteSaving(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'save-note', songId: selectedSong.id, note: noteText }),
      });
      const result = await res.json();
      if (result.success) {
        const saved = noteText.trim() || null;
        setSongs(prev => prev.map(s => s.id === selectedSong.id ? { ...s, admin_notes: saved } : s));
        setSelectedSong(prev => prev ? { ...prev, admin_notes: saved } : prev);
        setNoteSaved(true);
        setTimeout(() => setNoteSaved(false), 2500);
      }
    } catch (e) {
      console.error('saveNote error:', e);
    } finally {
      setNoteSaving(false);
    }
  };

  // Retry a stuck/failed song — creates a new Mureka job server-side.
  const retrySong = async (songId) => {
    if (!accessToken) return;
    setRetryingId(songId);
    setRetryResult(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'retry', songId }),
      });
      const result = await res.json();
      if (result.success) {
        setSongs(prev => prev.map(s =>
          s.id === songId || (s.mureka_job_id && s.mureka_job_id === prev.find(x => x.id === songId)?.mureka_job_id)
            ? { ...s, status: 'processing' }
            : s
        ));
        setSelectedSong(prev => prev?.id === songId ? { ...prev, status: 'processing' } : prev);
        setRetryResult({ ok: true, message: result.message || 'Retry queued — check back in 3–5 min' });
      } else {
        setRetryResult({ ok: false, message: result.error || 'Retry failed' });
      }
    } catch (e) {
      setRetryResult({ ok: false, message: e.message });
    } finally {
      setRetryingId(null);
    }
  };

  // Inline audio preview: play or pause the selected song row.
  const togglePreview = (songId, audioUrl) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewingId === songId) {
      // same song — toggle play/pause
      if (previewPlaying) {
        audio.pause();
        setPreviewPlaying(false);
      } else {
        audio.play().then(() => setPreviewPlaying(true)).catch(() => {});
      }
    } else {
      // different song — swap src and play
      audio.pause();
      audio.src = audioUrl;
      audio.currentTime = 0;
      setPreviewingId(songId);
      setPreviewPlaying(false);
      audio.play().then(() => setPreviewPlaying(true)).catch(() => {});
    }
  };

  // (isPaid is now defined at module scope above the component — no need
  // to redeclare here. Doing so caused a temporal-dead-zone ReferenceError
  // because earlier hooks already referenced it.)

  // Fetch full song details on demand (for detail modal). Goes through the
  // admin-songs edge function so the assistant role still gets the row with
  // amount_paid stripped server-side.
  const fetchSongDetails = async (songId) => {
    if (!accessToken) return;
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'detail', songId }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) return;
      const data = result.song;
      if (data) {
        setSongs(prev => prev.map(s => s.id === songId ? { ...s, ...data, _fullLoaded: true } : s));
        setSelectedSong(prev => prev?.id === songId ? { ...prev, ...data, _fullLoaded: true } : prev);
      }
    } catch (err) {
      console.error('fetchSongDetails error:', err);
    }
  };

  // Fetch video_order for a song on demand (used when detail modal opens for
  // a song with has_video_addon = true). Uses supabase client directly — no
  // edge function needed because video_orders is a standard table.
  const fetchVideoOrder = async (songId) => {
    if (!songId) return;
    try {
      const { data, error } = await supabase
        .from('video_orders')
        .select('id, status, paid, photo_urls, video_url, created_at, updated_at')
        .eq('song_id', songId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        setVideoOrdersMap(prev => ({ ...prev, [songId]: data }));
      } else if (!error && !data) {
        // No video order exists yet — store null sentinel so we don't re-fetch
        setVideoOrdersMap(prev => ({ ...prev, [songId]: null }));
      }
    } catch (err) {
      console.error('fetchVideoOrder error:', err);
    }
  };

  const retryVideoRender = async (songId, videoOrderId) => {
    if (!videoOrderId) { showToast('No se encontró la orden de video.'); return; }
    setRetryingVideo(true);
    try {
      // 1. Reset status back to photos_uploaded
      const patchRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/video_orders?id=eq.${videoOrderId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({ status: 'photos_uploaded', shotstack_render_id: null }),
        }
      );
      if (!patchRes.ok) throw new Error(`Reset status failed: HTTP ${patchRes.status}`);

      // 2. Call generate-video
      const genRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-video`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ videoOrderId }),
        }
      );
      const genData = await genRes.json();
      if (!genRes.ok || !genData.success) throw new Error(genData.error || `HTTP ${genRes.status}`);

      showToast(`✅ Video re-enviado a Shotstack. Render ID: ${genData.renderId}`);
      // 3. Refresh the video order panel
      await fetchVideoOrder(songId);
    } catch (err) {
      showToast(`Error al reintentar: ${err.message}`);
    } finally {
      setRetryingVideo(false);
    }
  };

  const SONG_LIST_COLUMNS = [
    'id', 'created_at', 'email', 'recipient_name', 'sender_name',
    'genre', 'genre_name', 'sub_genre', 'occasion', 'voice_type',
    'session_id', 'stripe_session_id', 'stripe_payment_id', 'payment_status',
    'paid', 'paid_at', 'amount_paid',
    'coupon_code', 'affiliate_code', 'utm_source',
    'audio_url', 'whatsapp_phone', 'whatsapp_sent_at', 'download_count', 'downloaded',
    'has_video_addon', 'admin_dismissed_at', 'status', 'admin_notes'
  ].join(',');

  const fetchSongs = async (tokenOverride) => {
    setIsLoading(true);
    setError(null);
    let lastErr = null;
    const token = tokenOverride || accessToken;
    if (!token) {
      // No session — bail out; the auth effect will redirect.
      setIsLoading(false);
      return;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ action: 'list' }),
          }
        );
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || `HTTP ${response.status}`);
        }
        const data = result.songs;
        // Server told us the role; keep our state in sync (covers role
        // changes between login and refresh).
        if (result.role) setUserRole(result.role);

        setSongs(data || []);

      // Lifetime totals come from result.stats, computed server-side over the
      // FULL songs table. The function only ships the recent working set of
      // rows (not all ~40k) so it stays under the edge runtime's memory limit —
      // see admin-songs/index.ts. Today's numbers are still computed here from
      // the returned rows (today's orders are always in the recent set), which
      // keeps the viewer's-local-timezone behavior unchanged.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let todayRevenue = 0;
      let todayOrders = 0;
      (data || []).forEach(song => {
        if (!isPaid(song)) return;
        const songDate = new Date(song.created_at);
        if (songDate >= today) {
          todayRevenue += getSongPrice(song);
          todayOrders++;
        }
      });

      let lifetime;
      if (result.stats && typeof result.stats.totalSongs === 'number') {
        lifetime = result.stats;
      } else {
        // Fallback for an older server build that doesn't send stats: compute
        // from the returned rows the way we always did. Correct as long as the
        // function returned the full set; harmless otherwise.
        const paidSongs = (data || []).filter(s => isPaid(s));
        let rev = 0;
        let free = 0;
        paidSongs.forEach(s => {
          const p = getSongPrice(s);
          rev += p;
          if (p === 0) free++;
        });
        lifetime = {
          totalSongs: data?.length || 0,
          paidOrders: paidSongs.length,
          pendingOrders: (data?.length || 0) - paidSongs.length,
          totalRevenue: rev,
          freeOrders: free,
          whatsappContacts: new Set(
            (data || []).filter(s => s.whatsapp_phone).map(s => s.whatsapp_phone)
          ).size,
        };
      }

      setStats({
        totalSongs: lifetime.totalSongs ?? 0,
        totalRevenue: lifetime.totalRevenue ?? 0,
        paidOrders: lifetime.paidOrders ?? 0,
        pendingOrders: lifetime.pendingOrders ?? 0,
        freeOrders: lifetime.freeOrders ?? 0,
        todayRevenue,
        todayOrders,
        whatsappContacts: lifetime.whatsappContacts ?? 0
      });
        setIsLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        console.error(`Error fetching songs (attempt ${attempt + 1}/2):`, err);
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 800));
        }
      }
    }
    setError(lastErr?.message || 'No se pudieron cargar los datos');
    setIsLoading(false);
  };

  const fetchFunnelData = async () => {
    try {
      // Calculate date range
      let startDate = new Date();
      if (dateRange === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (dateRange === '7days') {
        startDate.setDate(startDate.getDate() - 7);
      } else if (dateRange === '14days') {
        startDate.setDate(startDate.getDate() - 14);
      } else if (dateRange === '30days') {
        startDate.setDate(startDate.getDate() - 30);
      }

      const { data, error } = await supabase
        .from('funnel_events')
        .select('step, session_id')
        .gte('created_at', startDate.toISOString());

      if (error) throw error;

      // Count unique sessions per step
      const stepCounts = {};
      const sessionsByStep = {};
      
      (data || []).forEach(event => {
        if (!sessionsByStep[event.step]) {
          sessionsByStep[event.step] = new Set();
        }
        sessionsByStep[event.step].add(event.session_id);
      });

      Object.keys(sessionsByStep).forEach(step => {
        stepCounts[step] = sessionsByStep[step].size;
      });

      setFunnelData(stepCounts);
    } catch (err) {
      console.error('Error fetching funnel data:', err);
    }
  };

  // Reads via the admin-affiliates edge function. Direct table reads from the
  // browser don't work — `affiliates`, `affiliate_events`, and
  // `affiliate_payouts` have RLS enabled with no policies, so the anon-key
  // client returns 0 rows. The edge function uses service-role behind an
  // admin_users role check.
  const fetchAffiliates = async (tokenOverride) => {
    const token = tokenOverride || accessToken;
    if (!token) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-affiliates`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.success) {
        // Server returns lastSale as ISO string; normalize back to Date for
        // existing rendering code that may compare/format it.
        const list = (data.affiliates || []).map(a => ({
          ...a,
          _stats: a._stats
            ? { ...a._stats, lastSale: a._stats.lastSale ? new Date(a._stats.lastSale) : null }
            : a._stats,
        }));
        setAffiliates(list);
      } else {
        console.error('admin-affiliates error:', data.error);
      }
      setAffiliatesLoaded(true);
    } catch (err) { console.error('Failed to fetch affiliates:', err); setAffiliatesLoaded(true); }
  };

  const createAffiliate = async () => {
    const { name, email, code, password, couponCode } = newAffiliate;
    if (!name || !email || !code || !password) {
      setAffiliateMsg({ type: 'error', text: 'Name, email, code and password are required' });
      return;
    }
    setCreatingAffiliate(true);
    setAffiliateMsg(null);
    try {
      // Auth: pass the admin user's JWT (not the anon key). The function
      // verifies the caller has admin_users.role = 'admin' before inserting.
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-affiliate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ name, email, code, couponCode: couponCode || undefined, password })
      });
      const data = await res.json();
      if (data.success) {
        setAffiliateMsg({ type: 'success', text: `Affiliate ${data.affiliate.name} created. Welcome email sent to ${data.affiliate.email}` });
        setNewAffiliate({ name: '', email: '', code: '', couponCode: '', password: '' });
        fetchAffiliates();
      } else {
        setAffiliateMsg({ type: 'error', text: data.error || 'Error creating affiliate' });
      }
    } catch (err) {
      setAffiliateMsg({ type: 'error', text: err.message });
    } finally { setCreatingAffiliate(false); }
  };

  // Open the record-payout modal for a specific affiliate. Pre-fills the
  // amount with what the partner is currently owed and the method with
  // whatever they registered on their dashboard.
  const openPayoutModal = (affiliate) => {
    const stats = affiliate._stats || {};
    const owed = Math.max(0, (stats.commission || 0) - (stats.paidOut || 0));
    setPayoutForm({
      amount: owed > 0 ? owed.toFixed(2) : '',
      method: affiliate.payout_method || '',
      note: '',
    });
    setPayoutModalError('');
    setPayoutModal({ affiliate, suggestedAmount: owed });
  };

  const recordPayout = async () => {
    if (!payoutModal) return;
    setPayoutModalError('');
    const amount = parseFloat(payoutForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayoutModalError('Enter a positive amount');
      return;
    }
    setRecordingPayout(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-record-payout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            affiliateCode: payoutModal.affiliate.code,
            amount,
            method: payoutForm.method || null,
            note: payoutForm.note || null,
          })
        }
      );
      const data = await res.json();
      if (!data.success) {
        setPayoutModalError(data.error || 'Failed to record payout');
        return;
      }
      setPayoutModal(null);
      setPayoutForm({ amount: '', method: '', note: '' });
      // Refresh so the new payout shows up immediately
      fetchAffiliates();
    } catch (err) {
      setPayoutModalError(err.message || 'Network error');
    } finally {
      setRecordingPayout(false);
    }
  };

  const fetchEmailLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('email_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setEmailLogs(data || []);
    } catch (err) {
      console.error('Error fetching email logs:', err);
    }
  };

  const fetchMurekaCredits = async (tokenOverride) => {
    const token = tokenOverride || accessToken;
    if (!token) return;
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mureka-credits`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'get' }),
        }
      );
      const result = await response.json();
      if (result.success) setMurekaCredits(result);
    } catch (err) {
      console.error('Error fetching Mureka credits:', err);
    }
  };

  const saveMurekaBalance = async () => {
    const token = accessToken;
    if (!token) return;
    const balance = parseInt(murekaForm.balance, 10);
    if (!Number.isFinite(balance) || balance < 0) {
      showToast('Please enter a valid credit amount');
      return;
    }
    setMurekaSaving(true);
    try {
      const payload = { action: 'set_balance', balance };
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mureka-credits`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(payload),
        }
      );
      const result = await response.json();
      if (!result.success) {
        showToast(`Error: ${result.error || 'could not save'}`);
      } else {
        setMurekaCredits(result);
        // Optionally update thresholds / per-gen if user changed them
        const extras = {};
        const lo = parseInt(murekaForm.low_threshold, 10);
        const cr = parseInt(murekaForm.critical_threshold, 10);
        if (Number.isFinite(lo) && lo >= 0 && lo !== result.low_threshold) extras.low_threshold = lo;
        if (Number.isFinite(cr) && cr >= 0 && cr !== result.critical_threshold) extras.critical_threshold = cr;
        if (Object.keys(extras).length) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mureka-credits`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ action: 'set_thresholds', ...extras }),
          }).then(r => r.json()).then(r => { if (r.success) setMurekaCredits(r); }).catch(() => {});
        }
        const perGen = parseFloat(murekaForm.credits_per_generation);
        if (Number.isFinite(perGen) && perGen > 0 && perGen !== result.credits_per_generation) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mureka-credits`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ action: 'set_per_gen', credits_per_generation: perGen }),
          }).then(r => r.json()).then(r => { if (r.success) setMurekaCredits(r); }).catch(() => {});
        }
        setMurekaModalOpen(false);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setMurekaSaving(false);
    }
  };

  const openMurekaModal = () => {
    setMurekaForm({
      balance: murekaCredits?.balance != null ? String(murekaCredits.balance) : '',
      low_threshold: murekaCredits?.low_threshold != null ? String(murekaCredits.low_threshold) : '500',
      critical_threshold: murekaCredits?.critical_threshold != null ? String(murekaCredits.critical_threshold) : '100',
      credits_per_generation: murekaCredits?.credits_per_generation != null ? String(murekaCredits.credits_per_generation) : '1',
    });
    setMurekaModalOpen(true);
  };

  const fetchSocialPipeline = async (tokenOverride) => {
    const token = tokenOverride || accessToken;
    if (!token) return;
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/social-pipeline-config`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'get' }),
        }
      );
      const result = await response.json();
      if (result.success) setSocialPipeline(result);
    } catch (err) {
      console.error('Error fetching social pipeline state:', err);
    }
  };

  const toggleSocialPipeline = async () => {
    const token = accessToken;
    if (!token || !socialPipeline) return;
    if (socialPipeline.role !== 'admin') return; // assistants can't flip
    const next = !socialPipeline.enabled;
    setSocialToggling(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/social-pipeline-config`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'set_enabled', enabled: next }),
        }
      );
      const result = await response.json();
      if (!result.success) {
        showToast(`Error: ${result.error || 'could not change state'}`);
      } else {
        setSocialPipeline(result);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setSocialToggling(false);
    }
  };

  const fetchEmailCampaigns = async () => {
    try {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .order('delay_hours', { ascending: true });

      if (error) throw error;
      setEmailCampaigns(data || []);
    } catch (err) {
      console.error('Error fetching email campaigns:', err);
    }
  };

  const toggleCampaign = async (campaignId, enabled) => {
    try {
      const { error } = await supabase
        .from('email_campaigns')
        .update({ enabled: !enabled })
        .eq('id', campaignId);

      if (error) throw error;
      
      // Update local state
      setEmailCampaigns(prev => 
        prev.map(c => c.id === campaignId ? { ...c, enabled: !enabled } : c)
      );
    } catch (err) {
      console.error('Error toggling campaign:', err);
      showToast('Error changing state');
    }
  };

  const saveCampaign = async (campaign) => {
    setSavingCampaign(true);
    try {
      const { error } = await supabase
        .from('email_campaigns')
        .update({
          subject: campaign.subject,
          heading: campaign.heading,
          body_text: campaign.body_text,
          button_text: campaign.button_text,
          delay_hours: campaign.delay_hours
        })
        .eq('id', campaign.id);

      if (error) throw error;
      
      // Update local state
      setEmailCampaigns(prev => 
        prev.map(c => c.id === campaign.id ? campaign : c)
      );
      setEditingCampaign(null);
      showToast('✅ Campaign updated');
    } catch (err) {
      console.error('Error saving campaign:', err);
      showToast('Error saving');
    } finally {
      setSavingCampaign(false);
    }
  };

  const sendTestEmail = async (campaignId) => {
    setSendingTestEmail(campaignId);
    try {
      const testEmail = prompt('Send test email to:', 'you@email.com');
      if (!testEmail) {
        setSendingTestEmail(false);
        return;
      }

      // Get a song for test data (prefer paid, but any completed song works)
      const testSong = songs.find(s => isPaid(s)) || songs.find(s => s.audio_url);
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-test-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          email: testEmail,
          campaignId: campaignId,
          songId: testSong?.id || null
        })
      });

      const result = await response.json();
      if (result.success) {
        showToast(`✅ Email sent to ${testEmail}`);
        fetchEmailLogs();
      } else {
        showToast(`❌ Error: ${result.error}`);
      }
    } catch (err) {
      showToast(`❌ Error: ${err.message}`);
    } finally {
      setSendingTestEmail(false);
    }
  };

  // Resend a failed email
  const resendEmail = async (log) => {
    setResendingEmail(log.id);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-purchase-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          songIds: [log.song_id],
          email: log.email,
          isTest: false
        })
      });

      const result = await response.json();
      if (result.success) {
        showToast(`✅ Email resent to ${log.email}`);
        fetchEmailLogs();
      } else {
        showToast(`❌ Error: ${result.error}`);
      }
    } catch (err) {
      showToast(`❌ Error: ${err.message}`);
    } finally {
      setResendingEmail(null);
    }
  };

  // Calculate conversion stats for a campaign
  const getCampaignConversions = (campaignId) => {
    const campaignEmails = emailLogs.filter(e => e.email_type === campaignId);
    const sentCount = campaignEmails.length;
    
    // Get song IDs from emails
    const emailedSongIds = campaignEmails.map(e => e.song_id).filter(Boolean);
    
    // Count how many of those became paid
    const convertedCount = songs.filter(s => 
      emailedSongIds.includes(s.id) && isPaid(s)
    ).length;
    
    const rate = sentCount > 0 ? ((convertedCount / sentCount) * 100).toFixed(0) : 0;
    
    return { sent: sentCount, converted: convertedCount, rate };
  };

  // Generate email preview HTML from campaign data
  const generateEmailPreview = (campaign) => {
    const buttonColor = campaign.button_color || '#f20d80';
    const bgColor = campaign.id === 'abandoned_24hr' ? '#e11d74' : '#f20d80';
    
    return `
      <!DOCTYPE html>
      <html>
      <body style="margin: 0; padding: 0; background-color: #0f1419; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #f20d80; font-size: 28px; margin: 0;">🎵 RegalosQueCantan</h1>
          </div>
          <div style="background: linear-gradient(135deg, #181114 0%, #110d0f 100%); border-radius: 20px; padding: 40px; text-align: center; border: 1px solid #f20d8030;">
            <h2 style="color: #ffffff; font-size: 28px; margin: 0 0 20px 0;">${campaign.heading || '¡Tu canción está lista!'}</h2>
            <p style="color: #ffffff; font-size: 16px; margin: 0 0 30px 0; line-height: 1.6;">
              ${(campaign.body_text || '').replace('{{recipient_name}}', '<strong style="color: #f20d80;">María</strong>')}
            </p>
            <a href="#" style="display: inline-block; background: ${buttonColor}; color: ${buttonColor === '#e11d74' ? '#ffffff' : '#0f1419'}; text-decoration: none; padding: 16px 40px; border-radius: 30px; font-weight: bold; font-size: 16px;">
              ${campaign.button_text || 'Ver Canción'}
            </a>
          </div>
          <p style="color: #ffffff40; font-size: 12px; text-align: center; margin-top: 20px;">
            RegalosQueCantan © 2026
          </p>
        </div>
      </body>
      </html>
    `;
  };

  // Filter email logs
  const filteredEmailLogs = emailLogs.filter(log => {
    if (emailFilter === 'all') return true;
    if (emailFilter === 'failed') return log.status === 'failed';
    return log.email_type === emailFilter;
  });

  const getEmailTypeLabel = (type) => {
    const labels = {
      'abandoned_15min': '⚡ 15min Recuperación',
      'abandoned_1hr': '⏰ 1hr Recordatorio',
      'abandoned_24hr': '⚠️ 24hr Última oportunidad',
      'purchase_confirmation': '✅ Confirmación de Compra',
      'test': '🧪 Test'
    };
    return labels[type] || type;
  };

  const getEmailTypeColor = (type) => {
    const colors = {
      'abandoned_15min': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      'abandoned_1hr': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      'abandoned_24hr': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      'purchase_confirmation': 'bg-green-500/20 text-green-400 border-green-500/30',
      'test': 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    };
    return colors[type] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore — we still want to leave the page even if sign-out errored
    }
    window.location.href = '/';
  };

  // Reset page when filters change
  useEffect(() => { setOrdersPage(0); }, [debouncedSearchTerm, filterStatus, todayOnly]);

  // Lookup tab: server-side search. Fires whenever the debounced search term
  // or field type changes. Resets to page 0 and fetches up to 500 matches from
  // the DB so we never miss an order that isn't in the recent-2000 local cache.
  useEffect(() => {
    setLookupPage(0);
    if (!debouncedLookupSearch.trim() || !accessToken) {
      setLookupServerResults(null);
      setLookupServerTotal(0);
      return;
    }
    setLookupServerLoading(true);
    const field = lookupSearchType === 'all' ? undefined : lookupSearchType;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action: 'list', search: debouncedLookupSearch.trim(), searchField: field, limit: 500 }),
    })
      .then(r => r.json())
      .then(result => {
        if (result.success) {
          setLookupServerResults(result.songs || []);
          setLookupServerTotal(result.total_count ?? result.songs?.length ?? 0);
        }
      })
      .catch(err => console.error('[lookup] server search failed:', err))
      .finally(() => setLookupServerLoading(false));
  }, [debouncedLookupSearch, lookupSearchType, accessToken]);

  // Global keyboard shortcut: "/" focuses the Órdenes search input. Ignored
  // when the user is already typing in another input/textarea so we don't
  // hijack form fields.
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== '/') return;
      const target = e.target;
      const tag = target?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
      if (isTyping) return;
      if (activeTab !== 'orders') return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab]);

  // ─── Delivery / age helpers (used by Por Enviar tab + Órdenes table) ──
  // Declared BEFORE the useMemo blocks below — useMemo factories run on the
  // first render, so anything they reference must already be initialized.
  // (Putting these after the useMemos triggers a temporal-dead-zone
  // ReferenceError that wipes the entire dashboard to a blank page.)

  // A song "needs WhatsApp delivery" when it's paid, has a phone number,
  // has the audio URL ready (otherwise there's nothing to send), and has
  // never been marked sent.
  const needsWhatsAppDelivery = (song) =>
    isPaid(song) &&
    !!song.whatsapp_phone &&
    !!song.audio_url &&
    !song.whatsapp_sent_at;

  // "2h ago", "3d ago", "now" — short relative time used in tables.
  const timeAgo = (dateString) => {
    if (!dateString) return '';
    const ms = Date.now() - new Date(dateString).getTime();
    if (ms < 0) return 'now';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  // Subtle left-border color used on Órdenes rows so admins can spot a
  // fresh order at a glance without reading the timestamp column.
  const ageBorderClass = (dateString) => {
    if (!dateString) return '';
    const hours = (Date.now() - new Date(dateString).getTime()) / 3600000;
    if (hours < 1) return 'border-l-4 border-l-green-400';     // hot — last hour
    if (hours < 24) return 'border-l-4 border-l-amber-400';    // today
    if (hours < 72) return 'border-l-4 border-l-amber-400/40'; // last 3 days
    return '';
  };

  // Build the WhatsApp message + wa.me url for a paid song. Same logic that
  // already lives inline in the Órdenes table — extracted so the new Pending
  // to Send tab and the bulk "open all" helper can reuse it. The customer
  // message body stays in Spanish on purpose; admin labels are English.
  const buildWhatsAppDelivery = (song, allSongs) => {
    if (!song.whatsapp_phone) return null;
    const phone = song.whatsapp_phone.startsWith('1')
      ? song.whatsapp_phone
      : '1' + song.whatsapp_phone;
    // Group sibling songs from same Stripe session so a single link covers
    // bundled purchases.
    const siblings = (allSongs || []).filter(s =>
      s.id !== song.id &&
      isPaid(s) &&
      s.audio_url &&
      ((song.session_id && s.session_id === song.session_id) ||
       (song.stripe_session_id && s.stripe_session_id === song.stripe_session_id))
    );
    const ids = [song.id, ...siblings.map(s => s.id)].join(',');
    const url = `${window.location.origin}/song/${ids}`;
    const msg = `¡Hola! Tu canción personalizada para ${song.recipient_name || 'tu ser querido'} está lista. 🎵\n\nEscúchala aquí: ${url}\n\nCuando quieras regalársela, solo reenvía este mensaje con el link. ¡Gracias por tu compra con RegalosQueCantan! 🎶`;
    return { phone, url, msg, waHref: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` };
  };

  const filteredSongs = useMemo(() => {
    const term = debouncedSearchTerm.toLowerCase();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return songs.filter(song => {
      const matchesSearch = !term ||
        song.recipient_name?.toLowerCase().includes(term) ||
        song.sender_name?.toLowerCase().includes(term) ||
        song.email?.toLowerCase().includes(term) ||
        song.whatsapp_phone?.includes(debouncedSearchTerm);
      const matchesFilter =
        filterStatus === 'all' ||
        (filterStatus === 'paid' && isPaid(song)) ||
        (filterStatus === 'pending' && !isPaid(song));
      const matchesToday = !todayOnly ||
        (song.created_at && new Date(song.created_at) >= todayStart);
      return matchesSearch && matchesFilter && matchesToday;
    });
  }, [songs, debouncedSearchTerm, filterStatus, todayOnly]);

  // Pending WhatsApp deliveries — grouped by purchase so a customer who
  // bought 2 songs at once shows up as ONE row, not two. Same Stripe
  // session = same group; if both fields are missing we fall back to the
  // song id so the row at least appears.
  //
  // Each group exposes:
  //   - primary: the song to render in headline cells (oldest paid_at wins)
  //   - songs[]: every paid+phone+audio+unsent sibling, in oldest-first order
  //   - songCount: songs.length (used to render "WhatsApp (2 songs)")
  //   - recipients[]: unique recipient names (deduped, may differ if the
  //     same buyer made two songs for two different people in one cart)
  //   - groupKey: stable key for React + selection state
  const pendingSendGroups = useMemo(() => {
    const candidates = songs.filter(needsWhatsAppDelivery);
    const map = new Map();
    for (const s of candidates) {
      const key = s.stripe_session_id || s.session_id || `solo:${s.id}`;
      if (!map.has(key)) {
        map.set(key, { key, songs: [s] });
      } else {
        map.get(key).songs.push(s);
      }
    }
    const list = Array.from(map.values());
    for (const g of list) {
      g.songs.sort((a, b) =>
        new Date(a.paid_at || a.created_at).getTime() -
        new Date(b.paid_at || b.created_at).getTime()
      );
      g.primary = g.songs[0];
      g.songCount = g.songs.length;
      g.recipients = [...new Set(g.songs.map(s => s.recipient_name).filter(Boolean))];
      g.songIds = g.songs.map(s => s.id);
      g.groupKey = g.key;
    }
    list.sort((a, b) => {
      const ta = new Date(a.primary.paid_at || a.primary.created_at).getTime();
      const tb = new Date(b.primary.paid_at || b.primary.created_at).getTime();
      return pendingSendSort === 'oldest' ? ta - tb : tb - ta;
    });
    return list;
  }, [songs, pendingSendSort]);

  // Number of pending PURCHASES (not songs) — what the badge should show.
  const pendingSendCount = pendingSendGroups.length;

  // Stuck / failed songs = generation was attempted but never completed
  // within 10 minutes. Has nothing to do with payment status.
  //
  // A song is flagged when:
  //   - status is set (so generation was at least queued — NULL status means
  //     no attempt was made and there's nothing to be stuck on), AND
  //   - status is anything other than 'completed' (i.e. 'failed',
  //     'processing', 'pending', 'pending_upload', 'pending_manual'), AND
  //   - more than 10 minutes have passed since the row was created — gives
  //     the upstream Mureka pipeline plenty of time to finish (it usually
  //     delivers in ~3 minutes), AND
  //   - the admin hasn't already dismissed the row.
  //
  // Successful generations (status = 'completed') don't trip the badge;
  // neither do songs currently rendering inside the 10-minute window.
  const stuckSongsCount = useMemo(() => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    return songs.filter(s => {
      if (s.admin_dismissed_at) return false;
      if (!s.status || s.status === 'completed') return false;
      const createdMs = new Date(s.created_at).getTime();
      return createdMs < tenMinAgo;
    }).length;
  }, [songs]);

  // Repeat buyers — paid emails that appear more than once. Used to show a
  // badge on orders from returning customers.
  const repeatBuyerEmails = useMemo(() => {
    const counts = new Map();
    for (const s of songs) {
      if (s.email && isPaid(s)) {
        const key = s.email.toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const result = new Set();
    for (const [email, count] of counts) {
      if (count > 1) result.add(email);
    }
    return result;
  }, [songs]);

  // Hot leads count (matches the existing tab-badge logic) — extracted so the
  // attention summary row can reuse it without duplicating the inline math.
  // We treat whatsapp_sent_at as the "we already reached out" flag for unpaid
  // leads too, so the admin can mark a hot lead as handled and have it drop
  // out of the queue without losing the row.
  const hotLeadsCount = useMemo(() => {
    const paidEmails = new Set(
      songs.filter(s => isPaid(s) && s.email).map(s => s.email.toLowerCase())
    );
    const phones = new Set();
    songs.forEach(s => {
      if (!s.whatsapp_phone || !s.recipient_name || !s.email) return;
      if (paidEmails.has(s.email.toLowerCase())) return;
      if (s.whatsapp_sent_at) return; // already contacted via WhatsApp
      phones.add(s.whatsapp_phone);
    });
    return phones.size;
  }, [songs]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('es-MX', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const getSongPrice = (song) => {
    if (song.amount_paid !== undefined && song.amount_paid !== null) {
      return parseFloat(song.amount_paid) || 0;
    }
    if (song.coupon_code === 'GRATIS100' || song.is_free) return 0;
    if (song.is_bundle) return 34.99;
    return 29.99;
  };

  const getVoiceLabel = (song) => {
    const voice = song.voice_type || song.voiceType || 'male';
    return voice === 'female' ? '♀️' : '♂️';
  };

  const formatOccasion = (occasion) => {
    if (!occasion) return '-';
    const map = {
      'san_valentin': '❤️ San Valentín',
      'cumpleanos': '🎂 Cumpleaños',
      'aniversario': '💍 Aniversario',
      'madre': '👩 Día Madre',
      'padre': '👨 Día Padre',
      'boda': '💒 Boda',
      'graduacion': '🎓 Graduación',
      'otro': '🎁 Otro'
    };
    return map[occasion] || occasion.replace(/_/g, ' ');
  };

  // Mark a single song as sent. Optimistic update + rollback on error.
  // Both admins and assistants can mark sent — Ivan and the owner share
  // delivery duties, so a click by either operator must persist (and then
  // sync via the 30s poll) or they end up double-sending to the customer.
  const markSongAsSent = useCallback(async (songId) => {
    if (!accessToken || !userRole) return;
    setMarkSendBusy(songId);
    const previous = songs;
    const optimisticTime = new Date().toISOString();
    setSongs(prev => prev.map(s =>
      s.id === songId ? { ...s, whatsapp_sent_at: optimisticTime } : s
    ));
    setSelectedPendingIds(prev => {
      const next = new Set(prev);
      next.delete(songId);
      return next;
    });
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'mark-sent', songId }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
      // Reconcile with server timestamp if it sent one back.
      if (result.song?.whatsapp_sent_at) {
        setSongs(prev => prev.map(s =>
          s.id === songId ? { ...s, whatsapp_sent_at: result.song.whatsapp_sent_at } : s
        ));
      }
    } catch (err) {
      console.error('markSongAsSent error:', err);
      showToast(`Error marking as sent: ${err.message}`);
      setSongs(previous); // rollback
    } finally {
      setMarkSendBusy(null);
    }
  }, [accessToken, userRole, songs]);

  // Undo a mistaken mark-as-sent.
  const unmarkSongAsSent = useCallback(async (songId) => {
    if (!accessToken || !userRole) return;
    if (!confirm('Mark this song as NOT sent? It will return to the queue.')) return;
    const previous = songs;
    setSongs(prev => prev.map(s =>
      s.id === songId ? { ...s, whatsapp_sent_at: null } : s
    ));
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'unmark-sent', songId }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
    } catch (err) {
      console.error('unmarkSongAsSent error:', err);
      showToast(`Error: ${err.message}`);
      setSongs(previous);
    }
  }, [accessToken, userRole, songs]);

  // Mark / unmark a song as "email manually delivered" — the small checkbox
  // shown next to the customer's email on paid orders without a WhatsApp
  // number. Distinct from whatsapp_sent_at so a song delivered both ways
  // still has a clean record of which channel actually reached the buyer.
  const [emailSendBusy, setEmailSendBusy] = useState(null);
  const [sendingLinkEmail, setSendingLinkEmail] = useState(null); // songId being sent via recover-song
  const [editingPhone, setEditingPhone] = useState(false);       // whether phone edit input is open
  const [phoneEditValue, setPhoneEditValue] = useState('');      // current value in the input
  const [phoneSaving, setPhoneSaving] = useState(false);         // save in-flight
  const toggleEmailSent = useCallback(async (songId, currentlyMarked) => {
    if (!accessToken || !userRole) return;
    const previous = songs;
    const optimisticTime = currentlyMarked ? null : new Date().toISOString();
    setEmailSendBusy(songId);
    setSongs(prev => prev.map(s =>
      s.id === songId ? { ...s, email_sent_at: optimisticTime } : s
    ));
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            action: currentlyMarked ? 'unmark-email-sent' : 'mark-email-sent',
            songId,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
      if (result.song?.email_sent_at !== undefined) {
        setSongs(prev => prev.map(s =>
          s.id === songId ? { ...s, email_sent_at: result.song.email_sent_at } : s
        ));
      }
    } catch (err) {
      console.error('toggleEmailSent error:', err);
      showToast(`Error marking email as sent: ${err.message}`);
      setSongs(previous);
    } finally {
      setEmailSendBusy(null);
    }
  }, [accessToken, userRole, songs]);

  // 1-touch email delivery — calls the exact same recover-song function that
  // Mi Canción uses, so the email lands in inbox (not spam) using the same
  // SendGrid template and sender reputation. After a successful send it also
  // auto-marks the "email sent?" checkbox so we don't double-send.
  const sendLinkByEmail = async (song) => {
    // stripe_payment_id is null for all orders; the real bundle key is stripe_session_id
    const groupKey = song?.stripe_payment_id || song?.stripe_session_id;
    if (!song?.email || !groupKey) {
      showToast('Falta email o ID de pago — no se puede enviar.');
      return;
    }
    setSendingLinkEmail(song.id);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recover-song`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            email: song.email.trim().toLowerCase(),
            action: 'send',
            which: 'paid',
            group_key: groupKey,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.emailSent) {
        if (!song.email_sent_at) await toggleEmailSent(song.id, false);
        showToast('✅ Link enviado por email al cliente');
      } else {
        showToast(`❌ Error al enviar: ${data?.error || 'intenta de nuevo'}`);
      }
    } catch (err) {
      showToast(`❌ Error: ${err.message}`);
    } finally {
      setSendingLinkEmail(null);
    }
  };

  // Save a corrected WhatsApp phone number for a song
  const savePhone = async (songId, newPhone) => {
    const digits = newPhone.replace(/\D/g, '');
    if (!digits) { showToast('Enter a valid phone number.'); return; }
    setPhoneSaving(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/songs?id=eq.${songId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({ whatsapp_phone: digits }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSongs(prev => prev.map(s => s.id === songId ? { ...s, whatsapp_phone: digits } : s));
      setSelectedSong(prev => prev ? { ...prev, whatsapp_phone: digits } : prev);
      setEditingPhone(false);
    } catch (err) {
      showToast(`Error saving phone: ${err.message}`);
    } finally {
      setPhoneSaving(false);
    }
  };

  // Mark a group of song ids as sent in one bulk request. Used by the
  // "✓ Mark sent" button on a Pending to Send row that covers multiple
  // songs (one customer paid for both at once → both get stamped together).
  // Falls back to the single-song path when only one id is passed.
  const markGroupAsSent = useCallback(async (ids) => {
    if (!accessToken || !userRole) return;
    const cleanIds = (Array.isArray(ids) ? ids : []).filter(Boolean);
    if (cleanIds.length === 0) return;
    if (cleanIds.length === 1) return markSongAsSent(cleanIds[0]);

    setBulkSendBusy(true);
    const previous = songs;
    const optimisticTime = new Date().toISOString();
    setSongs(prev => prev.map(s =>
      cleanIds.includes(s.id) ? { ...s, whatsapp_sent_at: s.whatsapp_sent_at || optimisticTime } : s
    ));
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'bulk-mark-sent', songIds: cleanIds }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
    } catch (err) {
      console.error('markGroupAsSent error:', err);
      showToast(`Error: ${err.message}`);
      setSongs(previous);
    } finally {
      setBulkSendBusy(false);
    }
  }, [accessToken, userRole, songs, markSongAsSent]);

  // Mark every selected song as sent in one request.
  const bulkMarkAsSent = useCallback(async () => {
    if (!accessToken || !userRole) return;
    const ids = Array.from(selectedPendingIds);
    if (ids.length === 0) return;
    if (!confirm(`Mark ${ids.length} song${ids.length > 1 ? 's' : ''} as sent?`)) return;
    setBulkSendBusy(true);
    const previous = songs;
    const optimisticTime = new Date().toISOString();
    setSongs(prev => prev.map(s =>
      ids.includes(s.id) ? { ...s, whatsapp_sent_at: s.whatsapp_sent_at || optimisticTime } : s
    ));
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'bulk-mark-sent', songIds: ids }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
      setSelectedPendingIds(new Set());
      showToast(`✅ ${result.updated || 0} song${result.updated === 1 ? '' : 's'} marked as sent.`);
    } catch (err) {
      console.error('bulkMarkAsSent error:', err);
      showToast(`Error: ${err.message}`);
      setSongs(previous);
    } finally {
      setBulkSendBusy(false);
    }
  }, [accessToken, userRole, songs, selectedPendingIds]);

  // One-click backfill: mark every paid+phone song with created_at <= cutoff
  // as already sent. Stops the queue from being flooded with historical orders
  // on day one of the feature.
  const backfillSent = useCallback(async () => {
    if (!accessToken || userRole !== 'admin') return;
    if (!backfillCutoff) return;
    const cutoffIso = new Date(backfillCutoff).toISOString();
    setBackfillBusy(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-songs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'backfill-sent', cutoff: cutoffIso }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
      const stamp = result.sentAt || new Date().toISOString();
      // Update everything client-side so the queue updates instantly.
      setSongs(prev => prev.map(s => {
        if (
          isPaid(s) &&
          s.whatsapp_phone &&
          !s.whatsapp_sent_at &&
          new Date(s.created_at).getTime() <= new Date(cutoffIso).getTime()
        ) {
          return { ...s, whatsapp_sent_at: stamp };
        }
        return s;
      }));
      setBackfillModalOpen(false);
      showToast(`✅ ${result.updated || 0} historical songs marked as sent.`);
    } catch (err) {
      console.error('backfillSent error:', err);
      showToast(`Error: ${err.message}`);
    } finally {
      setBackfillBusy(false);
    }
  }, [accessToken, userRole, backfillCutoff]);

  // Full-page spinner only while we're verifying who's logged in. Once auth
  // resolves the dashboard mounts; songs/funnel/email data fill in as their
  // own fetches return. This avoids wedging the whole UI behind the multi-MB
  // songs payload.
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-[#0f1419] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Verifying access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1419] text-white md:pl-56">
      {/* Left sidebar navigation (desktop only). The grouped pill-tabs further
          down are kept for mobile (md:hidden); both call the same setActiveTab,
          so behavior is identical — this is purely a layout change. */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 w-56 bg-[#12161c] border-r border-white/5 py-5 px-3 overflow-y-auto z-40">
        <div className="flex items-center gap-2.5 px-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center text-black text-lg">🎵</div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Regalos</p>
            <p className="text-[11px] text-gray-500">Admin</p>
          </div>
        </div>
        <p className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold mb-1.5 px-2">Daily ops</p>
        <button onClick={() => setActiveTab('orders')} className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition mb-0.5 ${activeTab === 'orders' ? 'bg-amber-400/15 text-amber-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
          <span>📦</span> Orders
        </button>
        <button onClick={() => setActiveTab('pendingsend')} className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition mb-0.5 ${activeTab === 'pendingsend' ? 'bg-green-500/15 text-green-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
          <span>📤</span><span className="flex-1">Pending to Send</span>
          {pendingSendCount > 0 && <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">{pendingSendCount}</span>}
        </button>
        <button onClick={() => setActiveTab('hotleads')} className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition mb-0.5 ${activeTab === 'hotleads' ? 'bg-orange-500/15 text-orange-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
          <span>🔥</span><span className="flex-1">Hot Leads</span>
          {hotLeadsCount > 0 && <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">{hotLeadsCount}</span>}
        </button>
        <button onClick={() => setActiveTab('sms')} className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition mb-0.5 ${activeTab === 'sms' ? 'bg-emerald-500/15 text-emerald-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
          <span>💬</span> Mensajes SMS
        </button>
        <p className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold mb-1.5 mt-5 px-2">Marketing</p>
        <button onClick={() => { setActiveTab('affiliates'); if (!affiliatesLoaded) fetchAffiliates(); }} className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition mb-0.5 ${activeTab === 'affiliates' ? 'bg-blue-500/15 text-blue-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
          <span>🤝</span> Affiliates
        </button>
        <p className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold mb-1.5 mt-5 px-2">Insights</p>
        <button onClick={() => setActiveTab('lookup')} className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition mb-0.5 ${activeTab === 'lookup' ? 'bg-amber-400/15 text-amber-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
          <span>🔍</span> Lookup
        </button>
        <button onClick={() => setActiveTab('clonamivoz')} className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition mb-0.5 ${activeTab === 'clonamivoz' ? 'bg-pink-500/15 text-pink-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
          <span>🎙️</span> Clone Mi Voz
        </button>
      </aside>
      {/* Toast notifications — non-blocking replacement for window.alert(). */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl border text-sm shadow-lg ${
              t.type === 'success'
                ? 'bg-green-500/15 border-green-500/30 text-green-200'
                : t.type === 'error'
                ? 'bg-red-500/15 border-red-500/30 text-red-200'
                : 'bg-white/10 border-white/20 text-gray-100'
            }`}
          >
            <span className="mt-0.5 flex-shrink-0 font-bold">
              {t.type === 'success' ? '✓' : t.type === 'error' ? '!' : 'i'}
            </span>
            <span className="whitespace-pre-line break-words">{t.message}</span>
          </div>
        ))}
      </div>
      {/* Live payment-alert toasts. Stack in the top-right; admin can
          dismiss each individually. Auto-dismiss after 12s. Tapping the
          toast jumps to the song detail panel for one-click follow-up. */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
        {paymentToasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto bg-gradient-to-br from-emerald-500 to-green-600 text-white rounded-2xl shadow-2xl shadow-emerald-500/40 p-4 border border-emerald-300/40 animate-slide-in"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <div className="text-3xl leading-none">💰</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">New paid song!</p>
                <p className="text-xs opacity-90 mt-0.5">
                  For <strong>{t.song.recipient_name || '—'}</strong>
                  {t.song.sender_name && <> from <strong>{t.song.sender_name}</strong></>}
                </p>
                {/* Genre is shown to everyone (not financial info).
                    Amount is admin-only — assistant role NEVER sees it,
                    matching the rest of the dashboard's revenue redaction. */}
                {(t.song.genre || (userRole === 'admin' && t.song.amount_paid)) && (
                  <p className="text-xs opacity-90 capitalize">
                    {userRole === 'admin' && t.song.amount_paid && (
                      <>{formatCurrency(parseFloat(t.song.amount_paid) || 0)}{t.song.genre && ' · '}</>
                    )}
                    {t.song.genre}
                  </p>
                )}
                {t.song.has_video_addon && (
                  <p className="text-xs mt-0.5 font-semibold flex items-center gap-1">
                    <span>🎬</span> Includes video
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      setSelectedSong(t.song);
                      if (!t.song._fullLoaded) fetchSongDetails(t.song.id);
                      setPaymentToasts(prev => prev.filter(x => x.id !== t.id));
                    }}
                    className="text-xs font-semibold underline underline-offset-2 hover:opacity-80"
                  >
                    View order
                  </button>
                  <button
                    onClick={() => setPaymentToasts(prev => prev.filter(x => x.id !== t.id))}
                    className="text-xs opacity-70 hover:opacity-100 ml-auto"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="bg-[#1a1f26] border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-bold text-lg flex items-center gap-2">
                {({ orders: 'Orders', pendingsend: 'Pending to Send', hotleads: 'Hot Leads', sms: 'Mensajes SMS', affiliates: 'Affiliates', lookup: 'Lookup', clonamivoz: 'Clone Mi Voz' }[activeTab]) || 'Dashboard'}
                {userRole && (
                  <span
                    className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${
                      userRole === 'admin'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                    }`}
                    title={userRole === 'admin'
                      ? 'You can see revenue and commission amounts'
                      : 'Financial amounts are hidden in this role'}
                  >
                    {userRole === 'admin' ? '👑 Admin' : '👤 Assistant'}
                  </span>
                )}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isLoading && (
              <span className="hidden md:inline-flex items-center gap-2 text-xs text-gray-400">
                <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                Loading data...
              </span>
            )}
            {/* Big obvious "TEST" pill — fires a fake toast + sound + desktop
                notification so admins can verify the wiring without waiting
                for a real payment. Uses plain text + emoji so it's visible
                even if Material Symbols font hasn't loaded. */}
            <button
              onClick={fireTestPaymentAlert}
              className="px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-violet-500/30"
              title="Fire a test payment alert (verify sound + popup are working)"
              aria-label="Test payment alert"
            >
              <span>🧪</span>
              <span>TEST</span>
            </button>
            {/* Alert toggle pill with explicit ON/OFF text. The state was
                previously icon-only (notifications_active vs _off) which is
                indistinguishable at a glance — admins were missing whether
                they had the alerts muted. Now the pill says what state it's
                in, what the count is, and what clicking does. */}
            <button
              onClick={() => {
                const next = !paymentAlertsEnabled;
                setPaymentAlertsEnabled(next);
                window.localStorage.setItem('rqc_admin_payment_alerts', String(next));
                console.log('[admin-alerts] toggle →', next ? 'ON' : 'OFF');
                if (next && 'Notification' in window && Notification.permission === 'default') {
                  Notification.requestPermission().then(p => console.log('[admin-alerts] desktop notification permission:', p));
                }
              }}
              className={`px-3 py-2 rounded-lg transition flex items-center gap-1.5 text-xs font-bold ${
                paymentAlertsEnabled
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-md shadow-emerald-500/30'
                  : 'bg-gray-600 hover:bg-gray-500 text-white'
              }`}
              title={paymentAlertsEnabled
                ? `Alerts ON — ${paymentAlertCount} fired this session. Click to mute.`
                : 'Alerts OFF — click to enable'}
            >
              <span>{paymentAlertsEnabled ? '🔔' : '🔕'}</span>
              <span>{paymentAlertsEnabled ? 'ON' : 'OFF'}</span>
              {paymentAlertCount > 0 && (
                <span className="ml-0.5 bg-white/25 rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                  {paymentAlertCount}
                </span>
              )}
            </button>
            <button
              onClick={() => fetchSongs()}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition"
              title="Refresh"
            >
              <span className="material-symbols-outlined text-gray-400">refresh</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-red-400">error</span>
              <div>
                <p className="font-semibold text-red-300">Couldn't load data</p>
                <p className="text-sm text-red-200/80 mt-1">
                  The stats below may not match reality. Details: {error}
                </p>
              </div>
            </div>
            <button
              onClick={() => fetchSongs()}
              className="px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 text-sm font-medium whitespace-nowrap"
            >
              Retry
            </button>
          </div>
        )}
        {/* Audit-mode banner shown to assistants — keeps the "data is being
            recalculated" cover story consistent across the dashboard. */}
        {userRole && userRole !== 'admin' && (
          <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3 text-sm">
            <span className="text-amber-400">📊</span>
            <p className="text-amber-200/80">
              Financial data is in audit mode — amounts will be restored when the review ends.
            </p>
          </div>
        )}

        {/* Home overview (credits + social + stat cards + WhatsApp + today +
            attention) is shown ONLY on the Orders tab, which acts as the home
            screen. Every other tab renders just its own content. */}
        {activeTab === 'orders' && (<>
        {/* Song-credits banner. Visible to both admin + assistant roles so
            anyone can spot a low balance. Only admins see the "Actualizar
            saldo" edit button (the edge function rejects writes from
            assistants regardless). The provider name is intentionally omitted
            from the UI. */}
        {murekaCredits && (() => {
          const c = murekaCredits;
          const bg =
            c.status === 'critical' ? 'from-red-500/20 to-red-600/10 border-red-500/40' :
            c.status === 'low' ? 'from-amber-500/20 to-amber-600/10 border-amber-500/40' :
            'from-violet-500/15 to-purple-600/10 border-violet-500/30';
          const numColor =
            c.status === 'critical' ? 'text-red-400' :
            c.status === 'low' ? 'text-amber-400' :
            'text-violet-300';
          const pulse = c.status !== 'healthy' ? 'animate-pulse' : '';
          const daysSinceAnchor = c.anchored_at
            ? Math.max(0, Math.floor((Date.now() - new Date(c.anchored_at).getTime()) / 86400000))
            : null;
          return (
            <div className={`mb-6 rounded-2xl bg-gradient-to-br ${bg} border p-5`}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <span className={`text-3xl ${pulse}`}>🎵</span>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      Song credits (estimated)
                    </p>
                    <p className={`text-3xl font-bold ${numColor}`}>
                      {c.estimated_remaining.toLocaleString()}
                      <span className="text-sm font-normal text-gray-500 ml-2">
                        / {c.balance.toLocaleString()} credits
                      </span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      ≈ {Math.floor(c.estimated_remaining / Math.max(c.credits_per_generation, 1)).toLocaleString()} songs remaining
                      {' • '}
                      {c.generations_since_anchor.toLocaleString()} generated since last adjustment
                      {daysSinceAnchor !== null && ` (${daysSinceAnchor === 0 ? 'today' : daysSinceAnchor + 'd ago'})`}
                      {' • '}{c.credits_per_generation} credits/song
                    </p>
                    {c.status === 'critical' && (
                      <p className="text-xs text-red-300 font-semibold mt-2">
                        ⚠ Credits at critical level — top up now before songs start to fail.
                      </p>
                    )}
                    {c.status === 'low' && (
                      <p className="text-xs text-amber-300 mt-2">
                        Credits running low — consider topping up soon.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchMurekaCredits()}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition"
                    title="Recalculate"
                  >
                    <span className="material-symbols-outlined text-gray-400 text-base">refresh</span>
                  </button>
                  {userRole === 'admin' && (
                    <button
                      onClick={openMurekaModal}
                      className="px-4 py-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 text-sm font-medium border border-violet-500/30"
                    >
                      🔧 Update balance
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Social posting pipeline toggle. Admin-controlled pause for the
            FB · IG · TikTok · YT auto-posting flow (render-social-clip →
            social-clip-callback → post-to-ghl). Both roles see the state;
            only admins can flip it (the edge function rejects assistant
            writes regardless). */}
        {socialPipeline && (() => {
          const enabled = !!socialPipeline.enabled;
          const isAdmin = socialPipeline.role === 'admin';
          const cardBg = enabled
            ? 'from-emerald-500/15 to-green-600/10 border-emerald-500/30'
            : 'from-rose-500/15 to-red-600/10 border-rose-500/30';
          const updatedLabel = socialPipeline.updated_at
            ? new Date(socialPipeline.updated_at).toLocaleString()
            : null;
          return (
            <div className={`mb-6 rounded-2xl bg-gradient-to-br ${cardBg} border p-5`}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <span className="text-3xl">{enabled ? '📣' : '⏸️'}</span>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      Social posting (FB · IG · TikTok · YT)
                    </p>
                    <p className={`text-2xl font-bold ${enabled ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {enabled ? 'Active' : 'Paused'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {enabled
                        ? 'Every paid song is automatically posted as a reel + story.'
                        : 'Nothing new is being posted. Songs are still generated and delivered as usual.'}
                      {updatedLabel && (
                        <> {' • '}Last updated: {updatedLabel}</>
                      )}
                    </p>
                    {!isAdmin && (
                      <p className="text-xs text-gray-500 mt-1 italic">
                        Only an admin can change this state.
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={toggleSocialPipeline}
                  disabled={socialToggling || !isAdmin}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                    enabled
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                      : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {socialToggling
                    ? '⏳ ...'
                    : enabled
                      ? '✓ Posting active · pause'
                      : '○ Posting paused · activate'}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#1a1f26] rounded-2xl p-5 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">🎵</span>
              <span className="text-[11px] text-gray-500 uppercase tracking-wide">Total</span>
            </div>
            <p className="text-3xl font-bold text-white">{stats.totalSongs}</p>
            <p className="text-sm text-gray-400">Songs</p>
          </div>

          <div className="bg-[#1a1f26] rounded-2xl p-5 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">💰</span>
              <span className="text-[11px] text-gray-500 uppercase tracking-wide">Revenue</span>
            </div>
            <p className="text-3xl font-bold text-white">
              {userRole === 'admin'
                ? formatCurrency(stats.totalRevenue)
                : <span className="text-gray-400 animate-pulse">Calculating...</span>}
            </p>
            <p className="text-sm text-gray-400">
              {userRole === 'admin'
                ? (stats.freeOrders > 0 && `${stats.freeOrders} free`)
                : 'auditing'}
            </p>
          </div>

          <div className="bg-[#1a1f26] rounded-2xl p-5 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">✅</span>
              <span className="text-[11px] text-gray-500 uppercase tracking-wide">Paid</span>
            </div>
            <p className="text-3xl font-bold text-white">{stats.paidOrders}</p>
            <p className="text-sm text-gray-400">Completed orders</p>
          </div>

          <div className="bg-[#1a1f26] rounded-2xl p-5 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">⏳</span>
              <span className="text-[11px] text-gray-500 uppercase tracking-wide">Pending</span>
            </div>
            <p className="text-3xl font-bold text-white">{stats.pendingOrders}</p>
            <p className="text-sm text-gray-400">Unpaid</p>
          </div>
        </div>

        {/* WhatsApp Contacts Banner */}
        {stats.whatsappContacts > 0 && (
          <div className="bg-[#1a1f26] rounded-2xl p-4 mb-6 border border-white/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">💬</span>
                <div>
                  <p className="font-semibold text-green-400">WhatsApp Contacts</p>
                  <p className="text-sm text-gray-400">{stats.whatsappContacts} unique numbers collected</p>
                </div>
              </div>
              <button
                onClick={() => {
                  const contacts = songs
                    .filter(s => s.whatsapp_phone)
                    .map(s => `${s.whatsapp_phone}\t${s.email || ''}\t${s.recipient_name || ''}\t${s.sender_name || ''}`)
                    .filter((v, i, a) => a.indexOf(v) === i);
                  const csv = 'Phone\tEmail\tRecipient\tSender\n' + contacts.join('\n');
                  navigator.clipboard.writeText(csv);
                  showToast(`✅ ${contacts.length} contacts copied to clipboard (TSV format)`);
                }}
                className="px-4 py-2 bg-green-500/20 text-green-400 rounded-xl text-sm font-medium hover:bg-green-500/30 transition border border-green-500/30"
              >
                📋 Export Contacts
              </button>
            </div>
          </div>
        )}

        {/* Today's Stats Banner — admin only (hidden from assistant role) */}
        {userRole === 'admin' && stats.todayOrders > 0 && (
          <div className="bg-[#1a1f26] rounded-2xl p-4 mb-6 border border-white/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔥</span>
                <div>
                  <p className="font-semibold">Today</p>
                  <p className="text-sm text-gray-400">{stats.todayOrders} orders</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-green-400">
                  {userRole === 'admin'
                    ? formatCurrency(stats.todayRevenue)
                    : <span className="animate-pulse">Calculating...</span>}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Attention Summary — clickable counters that jump to the relevant tab.
            Hidden when nothing needs attention so the dashboard isn't always
            shouting. Shown to both admin and assistant roles. */}
        {(pendingSendCount > 0 || hotLeadsCount > 0 || stuckSongsCount > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <button
              onClick={() => setActiveTab('pendingsend')}
              disabled={pendingSendCount === 0}
              className={`text-left rounded-2xl p-4 border transition ${
                pendingSendCount > 0
                  ? 'bg-green-500/5 border-green-500/20 hover:bg-green-500/10 hover:border-green-400/40'
                  : 'bg-white/3 border-white/5 opacity-60 cursor-default'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">📤</span>
                <span className="text-3xl font-bold text-green-400">{pendingSendCount}</span>
              </div>
              <p className="text-sm text-gray-300 mt-1">Waiting to send via WhatsApp</p>
              <p className="text-xs text-gray-500">Paid with phone · not marked sent</p>
            </button>
            <button
              onClick={() => setActiveTab('hotleads')}
              disabled={hotLeadsCount === 0}
              className={`text-left rounded-2xl p-4 border transition ${
                hotLeadsCount > 0
                  ? 'bg-orange-500/5 border-orange-500/20 hover:bg-orange-500/10 hover:border-orange-400/40'
                  : 'bg-white/3 border-white/5 opacity-60 cursor-default'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">🔥</span>
                <span className="text-3xl font-bold text-orange-400">{hotLeadsCount}</span>
              </div>
              <p className="text-sm text-gray-300 mt-1">Hot leads, unpaid</p>
              <p className="text-xs text-gray-500">With WhatsApp · still recoverable</p>
            </button>
            <button
              onClick={() => { setActiveTab('orders'); setFilterStatus('pending'); }}
              disabled={stuckSongsCount === 0}
              className={`text-left rounded-2xl p-4 border transition ${
                stuckSongsCount > 0
                  ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10 hover:border-red-400/40'
                  : 'bg-white/3 border-white/5 opacity-60 cursor-default'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">⚠️</span>
                <span className="text-3xl font-bold text-red-400">{stuckSongsCount}</span>
              </div>
              <p className="text-sm text-gray-300 mt-1">Stuck or failed songs</p>
              <p className="text-xs text-gray-500">Generation attempted but never completed after 10 min</p>
            </button>
          </div>
        )}
        </>)}

        {/* Tabs — visually grouped so a new admin's eye knows where to start.
            Group 1: Día a día (Órdenes / Por Enviar / Hot Leads).
            Group 2: Marketing (Emails / Blast / Afiliados).
            Group 3: Datos (Funnel / Lookup). */}
        <div className="space-y-3 mb-6 md:hidden">
          {/* Group 1: Día a día */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5 ml-1">
              Daily ops
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab('orders')}
                className={`px-5 py-2.5 rounded-xl font-medium transition ${
                  activeTab === 'orders'
                    ? 'bg-amber-400 text-black'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                📦 Orders
              </button>
              <button
                onClick={() => setActiveTab('pendingsend')}
                className={`px-5 py-2.5 rounded-xl font-medium transition relative ${
                  activeTab === 'pendingsend'
                    ? 'bg-green-500 text-white'
                    : 'bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/30'
                }`}
              >
                📤 Pending to Send
                {pendingSendCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                    {pendingSendCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('hotleads')}
                className={`px-5 py-2.5 rounded-xl font-medium transition relative ${
                  activeTab === 'hotleads'
                    ? 'bg-orange-500 text-white'
                    : 'bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/30'
                }`}
              >
                🔥 Hot Leads
                {hotLeadsCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                    {hotLeadsCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('sms')}
                className={`px-5 py-2.5 rounded-xl font-medium transition ${
                  activeTab === 'sms'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
                }`}
              >
                💬 Mensajes SMS
              </button>
            </div>
          </div>

          {/* Group 2: Marketing */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5 ml-1">
              Marketing
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setActiveTab('affiliates'); if (!affiliatesLoaded) fetchAffiliates(); }}
                className={`px-5 py-2.5 rounded-xl font-medium transition ${
                  activeTab === 'affiliates'
                    ? 'bg-blue-500 text-white'
                    : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/30'
                }`}
              >
                🤝 Affiliates ({affiliates.length})
              </button>
            </div>
          </div>

          {/* Group 3: Insights */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5 ml-1">
              Insights
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab('lookup')}
                className={`px-5 py-2.5 rounded-xl font-medium transition ${
                  activeTab === 'lookup'
                    ? 'bg-amber-400 text-black'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                🔍 Lookup
              </button>
              {/* Clone Mi Voz tier — reads from cloned_voice_songs table
                  via admin-cloned-voice-songs edge function. Separate from
                  the main 'orders' tab so the Mureka funnel admin view
                  stays untouched. */}
              <button
                onClick={() => setActiveTab('clonamivoz')}
                className={`px-5 py-2.5 rounded-xl font-medium transition ${
                  activeTab === 'clonamivoz'
                    ? 'bg-pink-500 text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                🎙️ Clone Mi Voz
              </button>
            </div>
          </div>
        </div>

        {activeTab === 'orders' ? (
          <>
            {/* Filters */}
            <div className="bg-[#1a1f26] rounded-2xl p-4 mb-6 flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search by name, email or phone... (shortcut: /)"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-amber-400/50"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'all', label: 'All', count: songs.length },
                  { key: 'paid', label: '✅ Paid', count: stats.paidOrders },
                  { key: 'pending', label: '⏳ Pending', count: stats.pendingOrders }
                ].map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setFilterStatus(filter.key)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                      filterStatus === filter.key
                        ? 'bg-amber-400 text-black'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {filter.label} ({filter.count})
                  </button>
                ))}
                <button
                  onClick={() => setTodayOnly(v => !v)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition border ${
                    todayOnly
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10 border-white/10'
                  }`}
                  title="Show only today's orders"
                >
                  📅 Today only
                </button>
              </div>
            </div>

            {/* Orders Table — desktop table view */}
            <div className="hidden md:block bg-[#1a1f26] rounded-2xl overflow-hidden border border-white/5">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/5 text-left">
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Date</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Customer</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Song</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Occasion</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Amount</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Status</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Download</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Sent</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center w-[220px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredSongs.length === 0 ? (
                      <tr>
                        <td colSpan="9" className="px-4 py-12 text-center text-gray-500">
                          No orders found
                        </td>
                      </tr>
                    ) : (
                      filteredSongs.slice(ordersPage * ORDERS_PER_PAGE, (ordersPage + 1) * ORDERS_PER_PAGE).map((song) => (
                        <tr key={song.id} className={`hover:bg-white/5 transition ${ageBorderClass(song.created_at)}`}>
                          <td className="px-4 py-3">
                            <span className="text-sm text-gray-300">{formatDate(song.created_at)}</span>
                            <p className="text-[10px] text-gray-500 mt-0.5">{timeAgo(song.created_at)}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-white">{song.recipient_name || '—'}</p>
                              <p className="text-xs text-gray-500">from {song.sender_name || '—'}</p>
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs text-gray-500 truncate max-w-[160px]">{song.email}</p>
                                {song.email && repeatBuyerEmails.has(song.email.toLowerCase()) && (
                                  <span title="Repeat buyer" className="flex-shrink-0 text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30 rounded-full px-1.5 py-0.5 leading-none">
                                    ★ repeat
                                  </span>
                                )}
                              </div>
                              {/* 1-touch send button — shown on every paid order so admin can email the link regardless of whether a WhatsApp number was captured */}
                              {isPaid(song) && (
                                <button
                                  className="mt-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition disabled:opacity-50"
                                  onClick={(e) => { e.stopPropagation(); sendLinkByEmail(song); }}
                                  disabled={sendingLinkEmail === song.id}
                                >
                                  {sendingLinkEmail === song.id
                                    ? '⏳ Enviando...'
                                    : song.email_sent_at
                                      ? `✅ Enviado ${timeAgo(song.email_sent_at)}`
                                      : '📤 Enviar Link'}
                                </button>
                              )}
                              {song.whatsapp_phone && (
                                <a
                                  href={`https://wa.me/${song.whatsapp_phone.startsWith('1') ? song.whatsapp_phone : '1' + song.whatsapp_phone}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300 mt-0.5"
                                >
                                  💬 {song.whatsapp_phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-amber-400 capitalize flex items-center gap-1.5 flex-wrap">
                                <span>{song.genre || '—'}</span>
                                <span className="text-xs opacity-70" title={song.voice_type === 'female' ? 'Female voice' : 'Male voice'}>
                                  {getVoiceLabel(song)}
                                </span>
                                {/* V1/V2 chip — every song creation produces 2 audio variants
                                    (rows share a mureka_job_id). Color-coded so a glance at the
                                    list shows whether you're looking at V1 or V2. */}
                                {(song.version === 1 || song.version === 2) && (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      song.version === 1
                                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                        : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                    }`}
                                    title={`Version ${song.version} of 2 — sibling shares mureka_job_id ${song.mureka_job_id || '(none)'}`}
                                  >
                                    V{song.version}
                                  </span>
                                )}
                                {song.has_video_addon && (
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/40"
                                    title="Video addon purchased"
                                  >
                                    🎬 Video
                                  </span>
                                )}
                              </p>
                              {song.sub_genre && (
                                <p className="text-xs text-gray-500">{song.sub_genre}</p>
                              )}
                              {/* Source / affiliate badge — moved here so the dedicated columns
                                  could be removed and the Actions column gets more breathing room. */}
                              {(song.utm_source || song.affiliate_code) && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {song.utm_source && (
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      song.utm_source === 'tiktok' ? 'bg-cyan-500/20 text-cyan-400' :
                                      song.utm_source === 'fb' || song.utm_source === 'facebook' ? 'bg-blue-500/20 text-blue-400' :
                                      song.utm_source === 'ig' || song.utm_source === 'instagram' ? 'bg-purple-500/20 text-purple-400' :
                                      song.utm_source === 'email' ? 'bg-amber-500/20 text-amber-400' :
                                      song.utm_source === 'google' ? 'bg-red-500/20 text-red-400' :
                                      'bg-gray-500/20 text-gray-400'
                                    }`}>
                                      {song.utm_source === 'tiktok' ? '🎵' :
                                       song.utm_source === 'fb' || song.utm_source === 'facebook' ? '📘' :
                                       song.utm_source === 'ig' || song.utm_source === 'instagram' ? '📷' :
                                       song.utm_source === 'email' ? '📧' :
                                       song.utm_source === 'google' ? '🔍' : '🔗'} {song.utm_source}
                                    </span>
                                  )}
                                  {song.affiliate_code && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-pink-500/20 text-pink-400">
                                      🤝 {song.affiliate_code}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm">{formatOccasion(song.occasion)}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isPaid(song) ? (
                              userRole === 'admin' ? (
                                <span className="font-semibold text-green-400">
                                  {formatCurrency(getSongPrice(song))}
                                </span>
                              ) : (
                                <span className="font-semibold text-green-400 animate-pulse">Calculating...</span>
                              )
                            ) : (
                              <span className="text-gray-500">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isPaid(song) ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                                ✓ Paid
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                ⏳ Pending
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isPaid(song) ? (
                              song.downloaded ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">
                                  ✓ {song.download_count > 1 ? `${song.download_count}x` : 'Yes'}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-red-500/20 text-red-400">
                                  ✗ No
                                </span>
                              )
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {/* "Sent" — only meaningful for paid songs with a phone */}
                            {isPaid(song) && song.whatsapp_phone ? (
                              song.whatsapp_sent_at ? (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400"
                                  title={`Sent ${formatDate(song.whatsapp_sent_at)}`}
                                >
                                  ✓ {timeAgo(song.whatsapp_sent_at)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-amber-500/20 text-amber-400">
                                  ✗ Pending
                                </span>
                              )
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 w-[220px]">
                            <div className="flex items-center justify-end gap-1 flex-nowrap">
                              <button
                                onClick={() => { setSelectedSong(song); setEditingPhone(false); if (!song._fullLoaded) fetchSongDetails(song.id); }}
                                className="p-2 rounded-lg hover:bg-white/10 transition flex-shrink-0"
                                title="View details"
                              >
                                <span className="material-symbols-outlined text-gray-400 text-xl">visibility</span>
                              </button>
                              {song.audio_url && (
                                <>
                                  <button
                                    onClick={() => togglePreview(song.id, song.audio_url)}
                                    className={`p-2 rounded-lg hover:bg-white/10 transition flex-shrink-0 ${previewingId === song.id ? 'bg-amber-500/20' : ''}`}
                                    title={previewingId === song.id && previewPlaying ? 'Pause' : 'Play preview'}
                                  >
                                    <span className={`material-symbols-outlined text-xl ${previewingId === song.id && previewPlaying ? 'text-amber-300 animate-pulse' : 'text-amber-400'}`}>
                                      {previewingId === song.id && previewPlaying ? 'pause_circle' : 'play_circle'}
                                    </span>
                                  </button>
                                  <a
                                    href={song.audio_url}
                                    download
                                    className="p-2 rounded-lg hover:bg-white/10 transition flex-shrink-0"
                                    title="Download"
                                  >
                                    <span className="material-symbols-outlined text-blue-400 text-xl">download</span>
                                  </a>
                                </>
                              )}
                              {/* WhatsApp send button — only on PAID songs with a phone and
                                  audio. Per-row: if a customer paid for 1 of 2 songs, only
                                  the paid one shows this button. Unpaid lead outreach lives
                                  on the Hot Leads tab, not here.
                                  Rendered as a labeled pill ("WhatsApp" or "Sent") so it's
                                  visually distinct from the icon-only actions. */}
                              {isPaid(song) && song.whatsapp_phone && song.audio_url && (() => {
                                const delivery = buildWhatsAppDelivery(song, songs);
                                if (!delivery) return null;
                                const alreadySent = !!song.whatsapp_sent_at;
                                return (
                                  <a
                                    href={delivery.waHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => {
                                      if (autoMarkOnSend && !alreadySent) {
                                        markSongAsSent(song.id);
                                      }
                                    }}
                                    className={`ml-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap flex-shrink-0 ${
                                      alreadySent
                                        ? 'bg-white/5 text-gray-400 hover:bg-white/10'
                                        : 'bg-[#25D366] text-white hover:bg-[#20bd5a] shadow-md shadow-green-500/30'
                                    }`}
                                    title={alreadySent
                                      ? `Already sent ${formatDate(song.whatsapp_sent_at)} — click to resend`
                                      : `Send via WhatsApp to ${song.whatsapp_phone}`}
                                    aria-label={alreadySent ? 'Resend via WhatsApp' : 'Send via WhatsApp'}
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="currentColor"
                                      aria-hidden="true"
                                    >
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                    </svg>
                                    {alreadySent ? 'Sent' : 'WhatsApp'}
                                  </a>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {/* Pagination Controls */}
              {(() => {
                const totalPages = Math.ceil(filteredSongs.length / ORDERS_PER_PAGE);
                const start = ordersPage * ORDERS_PER_PAGE + 1;
                const end = Math.min((ordersPage + 1) * ORDERS_PER_PAGE, filteredSongs.length);
                return (
                  <div className="px-4 py-3 bg-white/5 flex items-center justify-between">
                    <span className="text-sm text-gray-500">
                      {filteredSongs.length > 0 ? `${start}–${end} of ${filteredSongs.length} orders` : '0 orders'}
                    </span>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setOrdersPage(p => Math.max(0, p - 1))}
                          disabled={ordersPage === 0}
                          className="px-3 py-1 rounded-lg text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          ← Previous
                        </button>
                        <span className="text-sm text-gray-400">
                          Page {ordersPage + 1} / {totalPages}
                        </span>
                        <button
                          onClick={() => setOrdersPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={ordersPage >= totalPages - 1}
                          className="px-3 py-1 rounded-lg text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          Next →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Orders — mobile card view (md:hidden mirrors of the table). */}
            <div className="md:hidden space-y-3">
              {filteredSongs.length === 0 ? (
                <div className="bg-[#1a1f26] rounded-2xl p-6 text-center text-gray-500 border border-white/5">
                  No orders found
                </div>
              ) : (
                filteredSongs.slice(ordersPage * ORDERS_PER_PAGE, (ordersPage + 1) * ORDERS_PER_PAGE).map((song) => {
                  // Same gate as desktop: only paid songs with a phone and audio
                  // get the WhatsApp delivery button.
                  const delivery = (isPaid(song) && song.whatsapp_phone && song.audio_url)
                    ? buildWhatsAppDelivery(song, songs)
                    : null;
                  return (
                    <div
                      key={song.id}
                      className={`bg-[#1a1f26] rounded-2xl p-4 border border-white/5 ${ageBorderClass(song.created_at)}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-white truncate">{song.recipient_name || '—'}</p>
                          <p className="text-xs text-gray-500 truncate">from {song.sender_name || '—'} · {song.email}</p>
                          {/* 1-touch send button — shown on every paid order, with or without a WhatsApp number */}
                          {isPaid(song) && (
                            <button
                              className="mt-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition disabled:opacity-50"
                              onClick={(e) => { e.stopPropagation(); sendLinkByEmail(song); }}
                              disabled={sendingLinkEmail === song.id}
                            >
                              {sendingLinkEmail === song.id
                                ? '⏳ Enviando...'
                                : song.email_sent_at
                                  ? `✅ Enviado ${timeAgo(song.email_sent_at)}`
                                  : '📤 Enviar Link'}
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 ml-3">
                          {isPaid(song) ? (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">✓ Paid</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400">⏳ Pending</span>
                          )}
                          <span className="text-[10px] text-gray-500">{timeAgo(song.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                        <span className="capitalize text-amber-400">🎵 {song.genre || '—'}</span>
                        {/* V1/V2 chip for the mobile card — same color scheme as the desktop table */}
                        {(song.version === 1 || song.version === 2) && (
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold self-start ${
                              song.version === 1
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            }`}
                            title={`Version ${song.version} of 2`}
                          >
                            V{song.version}
                          </span>
                        )}
                        <span>{formatOccasion(song.occasion)}</span>
                        {isPaid(song) && userRole === 'admin' && (
                          <span className="text-green-400">{formatCurrency(getSongPrice(song))}</span>
                        )}
                        {song.whatsapp_phone && (
                          <span className="text-green-400">💬 {song.whatsapp_phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => { setSelectedSong(song); setEditingPhone(false); if (!song._fullLoaded) fetchSongDetails(song.id); }}
                          className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 text-xs hover:bg-white/10"
                        >
                          👁️ Details
                        </button>
                        {song.audio_url && (
                          <a
                            href={song.audio_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 text-xs hover:bg-amber-500/25"
                          >
                            ▶ Play
                          </a>
                        )}
                        {delivery && (
                          <a
                            href={delivery.waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              if (autoMarkOnSend && !song.whatsapp_sent_at) {
                                markSongAsSent(song.id);
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                              song.whatsapp_sent_at
                                ? 'bg-white/5 text-gray-300 hover:bg-white/10'
                                : 'bg-[#25D366] text-white hover:bg-[#20bd5a]'
                            }`}
                          >
                            {song.whatsapp_sent_at ? `✓ Sent ${timeAgo(song.whatsapp_sent_at)}` : '💬 WhatsApp'}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {/* Mobile pagination */}
              {(() => {
                const totalPages = Math.ceil(filteredSongs.length / ORDERS_PER_PAGE);
                if (totalPages <= 1) return null;
                return (
                  <div className="flex items-center justify-between bg-[#1a1f26] rounded-2xl p-3 border border-white/5">
                    <button
                      onClick={() => setOrdersPage(p => Math.max(0, p - 1))}
                      disabled={ordersPage === 0}
                      className="px-3 py-1 rounded-lg text-sm bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30"
                    >
                      ← Previous
                    </button>
                    <span className="text-sm text-gray-400">Page {ordersPage + 1} / {totalPages}</span>
                    <button
                      onClick={() => setOrdersPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={ordersPage >= totalPages - 1}
                      className="px-3 py-1 rounded-lg text-sm bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30"
                    >
                      Next →
                    </button>
                  </div>
                );
              })()}
            </div>
          </>
        ) : activeTab === 'pendingsend' ? (
          /* ─── Por Enviar Tab — paid songs queued for WhatsApp delivery ─── */
          <div className="space-y-4">
            {/* Header bar: sort, auto-mark toggle, backfill helper, bulk actions */}
            <div className="bg-[#1a1f26] rounded-2xl p-4 border border-white/5 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    📤 Songs to send via WhatsApp
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Paid, with a phone number, not yet marked as sent.
                    {pendingSendCount > 0 && (
                      <> {' • '}<strong className="text-green-400">{pendingSendCount}</strong> in queue</>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="flex gap-1 bg-white/5 rounded-lg p-1">
                    <button
                      onClick={() => setPendingSendSort('oldest')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                        pendingSendSort === 'oldest' ? 'bg-green-500 text-white' : 'text-gray-400 hover:bg-white/5'
                      }`}
                    >
                      Oldest first
                    </button>
                    <button
                      onClick={() => setPendingSendSort('recent')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                        pendingSendSort === 'recent' ? 'bg-green-500 text-white' : 'text-gray-400 hover:bg-white/5'
                      }`}
                    >
                      Newest first
                    </button>
                  </div>
                  {userRole === 'admin' && (
                    <button
                      onClick={() => setBackfillModalOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-300 text-xs font-medium hover:bg-violet-500/25 border border-violet-500/30"
                      title="Mark every order older than a chosen date as already sent"
                    >
                      🗓️ Historical backfill
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/5">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoMarkOnSend}
                    onChange={(e) => setAutoMarkOnSend(e.target.checked)}
                    className="w-4 h-4 accent-green-500"
                  />
                  Mark as sent when clicking WhatsApp
                </label>
                {selectedPendingIds.size > 0 && userRole === 'admin' && (
                  <div className="flex gap-2 ml-auto">
                    {(() => {
                      // Dedupe by phone — multiple selected songs from the same
                      // customer should open ONE chat, not several. The wa.me
                      // link buildWhatsAppDelivery() builds already includes
                      // every sibling song, so one chat covers them all.
                      const phones = new Set();
                      const opens = [];
                      Array.from(selectedPendingIds).forEach(id => {
                        const s = songs.find(x => x.id === id);
                        if (!s || !s.whatsapp_phone) return;
                        if (phones.has(s.whatsapp_phone)) return;
                        const d = buildWhatsAppDelivery(s, songs);
                        if (d) {
                          phones.add(s.whatsapp_phone);
                          opens.push(d.waHref);
                        }
                      });
                      const cap = Math.min(opens.length, 5);
                      return (
                        <button
                          onClick={() => {
                            opens.slice(0, 5).forEach(href => window.open(href, '_blank', 'noopener'));
                            if (opens.length > 5) {
                              showToast(`Opened 5 chats. Select fewer customers to open them all at once (browsers block more).`);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-300 text-xs font-medium hover:bg-green-500/25 border border-green-500/30"
                        >
                          📱 Open {cap} chat{cap === 1 ? '' : 's'}
                        </button>
                      );
                    })()}
                    <button
                      onClick={bulkMarkAsSent}
                      disabled={bulkSendBusy}
                      className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-400 disabled:opacity-50"
                    >
                      {bulkSendBusy ? 'Marking…' : `✓ Mark ${selectedPendingIds.size} as sent`}
                    </button>
                    <button
                      onClick={() => setSelectedPendingIds(new Set())}
                      className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 text-xs hover:bg-white/10"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Empty state */}
            {pendingSendSongs.length === 0 ? (
              <div className="bg-[#1a1f26] rounded-2xl p-10 text-center border border-white/5">
                <div className="text-5xl mb-3">🎉</div>
                <p className="text-lg font-semibold text-white">No songs waiting to be sent</p>
                <p className="text-sm text-gray-500 mt-1">
                  Every paid order with a WhatsApp number is marked as sent.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop list */}
                <div className="hidden md:block bg-[#1a1f26] rounded-2xl overflow-hidden border border-white/5">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-white/5 text-left">
                        <th className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            disabled={userRole !== 'admin'}
                            checked={
                              pendingSendGroups.length > 0 &&
                              pendingSendGroups.every(g => g.songIds.every(id => selectedPendingIds.has(id)))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                const all = new Set();
                                pendingSendGroups.forEach(g => g.songIds.forEach(id => all.add(id)));
                                setSelectedPendingIds(all);
                              } else {
                                setSelectedPendingIds(new Set());
                              }
                            }}
                            className="w-4 h-4 accent-green-500"
                            title="Select all"
                          />
                        </th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Waiting</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Customer</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">For</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">WhatsApp</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center w-[260px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {pendingSendGroups.map((group) => {
                        const song = group.primary;
                        const songCount = group.songCount;
                        const since = song.paid_at || song.created_at;
                        const hours = (Date.now() - new Date(since).getTime()) / 3600000;
                        const urgencyColor =
                          hours > 24 ? 'text-red-400' :
                          hours > 6 ? 'text-orange-400' :
                          hours > 1 ? 'text-amber-400' :
                          'text-green-400';
                        const delivery = buildWhatsAppDelivery(song, songs);
                        const isGroupSelected = group.songIds.every(id => selectedPendingIds.has(id));
                        const groupBusy = group.songIds.some(id => markSendBusy === id);
                        const recipientLabel = group.recipients.length > 0
                          ? group.recipients.join(', ')
                          : '—';
                        return (
                          <tr key={group.groupKey} className="hover:bg-white/5">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                disabled={userRole !== 'admin'}
                                checked={isGroupSelected}
                                onChange={(e) => {
                                  setSelectedPendingIds(prev => {
                                    const next = new Set(prev);
                                    if (e.target.checked) group.songIds.forEach(id => next.add(id));
                                    else group.songIds.forEach(id => next.delete(id));
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 accent-green-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <p className={`text-sm font-semibold ${urgencyColor}`}>{timeAgo(since)}</p>
                              <p className="text-[10px] text-gray-500">{formatDate(since)}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-white">{song.sender_name || '—'}</p>
                              <p className="text-xs text-gray-500 truncate max-w-[180px]">{song.email}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-amber-400">{recipientLabel}</p>
                              <p className="text-xs text-gray-500 capitalize">
                                {songCount > 1
                                  ? `${songCount} songs in this purchase`
                                  : `${song.genre || ''} · ${formatOccasion(song.occasion)}`}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm text-green-400">
                                {song.whatsapp_phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
                              </span>
                            </td>
                            <td className="px-4 py-3 w-[260px]">
                              <div className="flex items-center justify-end gap-2 flex-nowrap">
                                {/* Same WhatsApp pill as the Orders tab — clearly green +
                                    labeled. When the purchase has multiple songs, the
                                    label shows the count so admins know one click sends
                                    the entire bundle (link covers all sibling song ids). */}
                                {delivery && (
                                  <a
                                    href={delivery.waHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => {
                                      if (autoMarkOnSend) {
                                        markGroupAsSent(group.songIds);
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#25D366] hover:bg-[#20bd5a] shadow-md shadow-green-500/30 transition whitespace-nowrap flex-shrink-0"
                                    title={songCount > 1
                                      ? `Send WhatsApp with ${songCount} songs to ${song.whatsapp_phone}`
                                      : `Send via WhatsApp to ${song.whatsapp_phone}`}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                    </svg>
                                    {songCount > 1 ? `WhatsApp · ${songCount} songs` : 'WhatsApp'}
                                  </a>
                                )}
                                {/* Manual "I already sent this from the Orders tab — clear
                                    it from the queue" checkmark. Distinct green-outlined
                                    pill so it reads as a confirmation control, not just
                                    another grey utility button. */}
                                {userRole === 'admin' && (
                                  <button
                                    onClick={() => markGroupAsSent(group.songIds)}
                                    disabled={groupBusy || bulkSendBusy}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 hover:bg-emerald-500/20 disabled:opacity-50 transition whitespace-nowrap flex-shrink-0"
                                    title={songCount > 1
                                      ? `Mark all ${songCount} songs as sent (already sent manually)`
                                      : 'Mark as sent (already sent manually)'}
                                  >
                                    {groupBusy ? '…' : (
                                      <>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        Sent
                                      </>
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() => { setSelectedSong(song); setEditingPhone(false); if (!song._fullLoaded) fetchSongDetails(song.id); }}
                                  className="p-1.5 rounded-lg hover:bg-white/10 flex-shrink-0"
                                  title="View details"
                                >
                                  <span className="material-symbols-outlined text-gray-400 text-base">visibility</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile card view */}
                <div className="md:hidden space-y-3">
                  {pendingSendGroups.map((group) => {
                    const song = group.primary;
                    const songCount = group.songCount;
                    const since = song.paid_at || song.created_at;
                    const hours = (Date.now() - new Date(since).getTime()) / 3600000;
                    const urgencyColor =
                      hours > 24 ? 'text-red-400' :
                      hours > 6 ? 'text-orange-400' :
                      hours > 1 ? 'text-amber-400' :
                      'text-green-400';
                    const delivery = buildWhatsAppDelivery(song, songs);
                    const isGroupSelected = group.songIds.every(id => selectedPendingIds.has(id));
                    const groupBusy = group.songIds.some(id => markSendBusy === id);
                    const recipientLabel = group.recipients.length > 0
                      ? group.recipients.join(', ')
                      : '—';
                    return (
                      <div key={group.groupKey} className="bg-[#1a1f26] rounded-2xl p-4 border border-white/5">
                        <div className="flex items-start gap-3 mb-3">
                          {userRole === 'admin' && (
                            <input
                              type="checkbox"
                              checked={isGroupSelected}
                              onChange={(e) => {
                                setSelectedPendingIds(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) group.songIds.forEach(id => next.add(id));
                                  else group.songIds.forEach(id => next.delete(id));
                                  return next;
                                });
                              }}
                              className="w-5 h-5 mt-0.5 accent-green-500"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-white">For {recipientLabel}</p>
                            <p className="text-xs text-gray-500 truncate">from {song.sender_name || '—'} · {song.email}</p>
                            {songCount > 1 && (
                              <p className="text-[10px] text-emerald-300 mt-0.5">📦 {songCount} songs in this purchase</p>
                            )}
                          </div>
                          <p className={`text-xs font-semibold whitespace-nowrap ${urgencyColor}`}>{timeAgo(since)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {delivery && (
                            <a
                              href={delivery.waHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => {
                                if (autoMarkOnSend) {
                                  markGroupAsSent(group.songIds);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#25D366] hover:bg-[#20bd5a]"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                              </svg>
                              {songCount > 1 ? `WhatsApp · ${songCount}` : 'WhatsApp'}
                            </a>
                          )}
                          {userRole === 'admin' && (
                            <button
                              onClick={() => markGroupAsSent(group.songIds)}
                              disabled={groupBusy || bulkSendBusy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                              {groupBusy ? '…' : (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  Sent
                                </>
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => { setSelectedSong(song); setEditingPhone(false); if (!song._fullLoaded) fetchSongDetails(song.id); }}
                            className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 text-xs hover:bg-white/10 ml-auto"
                          >
                            👁️ Details
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : activeTab === 'lookup' ? (
          /* Customer Lookup Tab */
          <div className="space-y-4">
            {/* Search/Filter Bar */}
            <div className="bg-[#1a1f26] rounded-2xl p-4 flex flex-col md:flex-row gap-3">
              <div className="flex gap-2">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'email', label: '📧 Email' },
                  { value: 'name', label: '👤 Name' },
                  { value: 'phone', label: '💬 WhatsApp' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setLookupSearchType(opt.value)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                      lookupSearchType === opt.value
                        ? 'bg-amber-400 text-black'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
                <input
                  type="text"
                  value={lookupSearch}
                  onChange={(e) => setLookupSearch(e.target.value)}
                  placeholder="Search by email, name, or ID..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
                />
                {lookupSearch && (
                  <button
                    onClick={() => setLookupSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Results count */}
            {(() => {
              // When a search term is active, use the server results (searches
              // the entire database, not just the 2000 most-recently-cached rows).
              // When no search term, fall back to the local songs array as before.
              const isServerSearch = !!debouncedLookupSearch.trim();
              const lookupFiltered = (() => {
                if (isServerSearch && lookupServerResults !== null) return lookupServerResults;
                if (!debouncedLookupSearch.trim()) return songs;
                const q = debouncedLookupSearch.toLowerCase().trim();
                return songs.filter(song => {
                  if (lookupSearchType === 'email') return (song.email || '').toLowerCase().includes(q);
                  if (lookupSearchType === 'name') return (song.recipient_name || '').toLowerCase().includes(q) || (song.sender_name || '').toLowerCase().includes(q);
                  if (lookupSearchType === 'phone') return (song.whatsapp_phone || '').includes(q);
                  return (
                    (song.email || '').toLowerCase().includes(q) ||
                    (song.recipient_name || '').toLowerCase().includes(q) ||
                    (song.sender_name || '').toLowerCase().includes(q) ||
                    (song.id || '').toLowerCase().includes(q) ||
                    (song.genre || '').toLowerCase().includes(q) ||
                    (song.whatsapp_phone || '').includes(q)
                  );
                });
              })();

              return (
                <>
                  <p className="text-sm text-gray-500">
                    {lookupServerLoading
                      ? 'Buscando...'
                      : debouncedLookupSearch
                        ? lookupServerTotal > lookupFiltered.length
                          ? `${lookupFiltered.length} de ${lookupServerTotal} resultados para "${debouncedLookupSearch}"`
                          : `${lookupFiltered.length} result${lookupFiltered.length !== 1 ? 's' : ''} for "${debouncedLookupSearch}"`
                        : `${lookupFiltered.length} total songs`
                    }
                  </p>

                  {/* Song List */}
                  <div className="space-y-3">
                    {lookupFiltered.slice(lookupPage * LOOKUP_PER_PAGE, (lookupPage + 1) * LOOKUP_PER_PAGE).map(song => {
                      const paid = isPaid(song);
                      const hasAudio = !!song.audio_url;
                      const previewLink = `${window.location.origin}/listen?song_id=${song.id}`;
                      const successLink = `${window.location.origin}/success?song_id=${song.id}`;
                      const polaroidLink = `${window.location.origin}/song/${song.id}`;

                      return (
                        <div
                          key={song.id}
                          className="bg-[#1a1f26] rounded-2xl p-4 border border-white/5 hover:border-white/15 transition"
                        >
                          {/* Top row */}
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h3 className="font-bold text-base">
                                🎵 {song.recipient_name || 'No name'}
                                {song.sender_name && (
                                  <span className="text-gray-500 font-normal text-sm"> ← {song.sender_name}</span>
                                )}
                              </h3>
                              <p className="text-xs text-gray-500 mt-1">
                                {song.email || 'No email'}
                                {song.whatsapp_phone && (
                                  <> • <a href={`https://wa.me/${song.whatsapp_phone.startsWith('1') ? song.whatsapp_phone : '1' + song.whatsapp_phone}`} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300">💬 {song.whatsapp_phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}</a></>
                                )}
                                {' '}• {(song.genre_name || song.genre || '').replace(/_/g, ' ')} • {formatDate(song.created_at)}
                              </p>
                            </div>
                            <span className={`text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap ${
                              paid
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : hasAudio
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                            }`}>
                              {paid ? '✓ Paid' : hasAudio ? '⏳ Unpaid' : '🔄 Generating'}
                            </span>
                          </div>

                          {/* Song ID */}
                          <div className="flex items-center gap-2 mb-3 bg-black/20 rounded-lg px-3 py-2">
                            <code className="text-xs text-gray-500 flex-1 overflow-hidden text-ellipsis">{song.id}</code>
                            <button
                              onClick={() => { navigator.clipboard.writeText(song.id); setCopiedLinkId(`id-${song.id}`); setTimeout(() => setCopiedLinkId(null), 2000); }}
                              className="text-xs text-gray-500 hover:text-white transition"
                            >
                              {copiedLinkId === `id-${song.id}` ? '✅' : '📋'}
                            </button>
                          </div>

                          {/* Link buttons */}
                          {hasAudio && (
                            <div className="flex gap-2 flex-wrap">
                              <button
                                onClick={() => { navigator.clipboard.writeText(previewLink); setCopiedLinkId(`preview-${song.id}`); setTimeout(() => setCopiedLinkId(null), 2000); }}
                                className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-semibold transition ${
                                  copiedLinkId === `preview-${song.id}`
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20'
                                }`}
                              >
                                {copiedLinkId === `preview-${song.id}` ? '✅ Copied!' : '🎧 Preview Link'}
                              </button>
                              <button
                                onClick={() => { navigator.clipboard.writeText(successLink); setCopiedLinkId(`success-${song.id}`); setTimeout(() => setCopiedLinkId(null), 2000); }}
                                className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-semibold transition ${
                                  copiedLinkId === `success-${song.id}`
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20'
                                }`}
                              >
                                {copiedLinkId === `success-${song.id}` ? '✅ Copied!' : '📥 Download Link'}
                              </button>
                            </div>
                          )}
                          {/* Polaroid shareable link */}
                          {hasAudio && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => { navigator.clipboard.writeText(polaroidLink); setCopiedLinkId(`polaroid-${song.id}`); setTimeout(() => setCopiedLinkId(null), 2000); }}
                                className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-semibold transition ${
                                  copiedLinkId === `polaroid-${song.id}`
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-pink-500/10 text-pink-400 border border-pink-500/30 hover:bg-pink-500/20'
                                }`}
                              >
                                {copiedLinkId === `polaroid-${song.id}` ? '✅ Copied!' : '🎨 Polaroid Page'}
                              </button>
                              <a
                                href={polaroidLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="py-2.5 px-4 rounded-xl text-sm font-semibold bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 transition text-center"
                              >
                                👁️
                              </a>
                            </div>
                          )}

                          {/* Combined link for song pairs (same email + recipient) */}
                          {hasAudio && (() => {
                            const pairSongs = songs.filter(s => 
                              s.id !== song.id && 
                              s.audio_url && 
                              s.email === song.email && 
                              s.recipient_name === song.recipient_name
                            );
                            if (pairSongs.length === 0) return null;
                            const combinedIds = [song.id, ...pairSongs.map(s => s.id)].join(',');
                            const combinedPreviewLink = `${window.location.origin}/listen?song_ids=${combinedIds}`;
                            const combinedSuccessLink = `${window.location.origin}/success?song_ids=${combinedIds}`;
                            return (
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => { navigator.clipboard.writeText(combinedPreviewLink); setCopiedLinkId(`combo-preview-${song.id}`); setTimeout(() => setCopiedLinkId(null), 2000); }}
                                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition ${
                                    copiedLinkId === `combo-preview-${song.id}`
                                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                      : 'bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20'
                                  }`}
                                >
                                  {copiedLinkId === `combo-preview-${song.id}` ? '✅ Copied!' : `📦 Both Preview (${pairSongs.length + 1})`}
                                </button>
                                <button
                                  onClick={() => { navigator.clipboard.writeText(combinedSuccessLink); setCopiedLinkId(`combo-success-${song.id}`); setTimeout(() => setCopiedLinkId(null), 2000); }}
                                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition ${
                                    copiedLinkId === `combo-success-${song.id}`
                                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                      : 'bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20'
                                  }`}
                                >
                                  {copiedLinkId === `combo-success-${song.id}` ? '✅ Copied!' : `📦 Both Download (${pairSongs.length + 1})`}
                                </button>
                              </div>
                            );
                          })()}

                          {/* Quick open + detail */}
                          <div className="flex items-center justify-between mt-2">
                            {hasAudio && (
                              <div className="flex gap-3">
                                <a href={previewLink} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-amber-400 underline">
                                  Open preview ↗
                                </a>
                                <a href={successLink} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-blue-400 underline">
                                  Open success ↗
                                </a>
                                <a href={polaroidLink} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-pink-400 underline">
                                  Open polaroid ↗
                                </a>
                              </div>
                            )}
                            <button
                              onClick={() => { setSelectedSong(song); setEditingPhone(false); if (!song._fullLoaded) fetchSongDetails(song.id); }}
                              className="text-xs text-gray-500 hover:text-white underline ml-auto"
                            >
                              View details
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {/* Lookup Pagination */}
                    {(() => {
                      const totalLookupPages = Math.ceil(lookupFiltered.length / LOOKUP_PER_PAGE);
                      if (totalLookupPages <= 1) return null;
                      const lStart = lookupPage * LOOKUP_PER_PAGE + 1;
                      const lEnd = Math.min((lookupPage + 1) * LOOKUP_PER_PAGE, lookupFiltered.length);
                      return (
                        <div className="flex items-center justify-between py-3">
                          <span className="text-sm text-gray-500">{lStart}–{lEnd} of {lookupFiltered.length}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setLookupPage(p => Math.max(0, p - 1))}
                              disabled={lookupPage === 0}
                              className="px-3 py-1 rounded-lg text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              ← Previous
                            </button>
                            <span className="text-sm text-gray-400">Page {lookupPage + 1} / {totalLookupPages}</span>
                            <button
                              onClick={() => setLookupPage(p => Math.min(totalLookupPages - 1, p + 1))}
                              disabled={lookupPage >= totalLookupPages - 1}
                              className="px-3 py-1 rounded-lg text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              Next →
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                    {lookupFiltered.length === 0 && (
                      <div className="text-center py-12 bg-[#1a1f26] rounded-2xl">
                        <p className="text-3xl mb-3">🔍</p>
                        <p className="text-gray-500">No songs found{debouncedLookupSearch ? ` for "${debouncedLookupSearch}"` : ''}</p>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        ) : activeTab === 'hotleads' ? (
          /* 🔥 HOT LEADS TAB - WhatsApp contacts who didn't buy */
          (() => {
            // Build leads: group by whatsapp_phone, exclude anyone who has ANY paid song
            const paidEmails = new Set(
              songs.filter(s => isPaid(s) && s.email).map(s => s.email.toLowerCase())
            );
            const paidPhones = new Set(
              songs.filter(s => isPaid(s) && s.whatsapp_phone).map(s => s.whatsapp_phone)
            );

            const leadsMap = {};
            songs.forEach(s => {
              if (!s.whatsapp_phone || !s.recipient_name || !s.email) return;
              // Skip if this person has paid (by email OR phone)
              if (paidEmails.has(s.email.toLowerCase())) return;
              if (paidPhones.has(s.whatsapp_phone)) return;
              // Skip if we've already reached out via WhatsApp (whatsapp_sent_at
              // doubles as the "contacted" flag for unpaid leads — same column
              // that marks paid songs as delivered).
              if (s.whatsapp_sent_at) return;

              const key = s.whatsapp_phone;
              if (!leadsMap[key]) {
                leadsMap[key] = {
                  phone: s.whatsapp_phone,
                  email: s.email,
                  senderName: s.sender_name,
                  songs: [],
                  latestDate: s.created_at,
                  occasions: new Set(),
                  genres: new Set()
                };
              }
              leadsMap[key].songs.push(s);
              if (s.occasion) leadsMap[key].occasions.add(s.occasion);
              if (s.genre) leadsMap[key].genres.add(s.genre);
              if (new Date(s.created_at) > new Date(leadsMap[key].latestDate)) {
                leadsMap[key].latestDate = s.created_at;
              }
            });

            const leads = Object.values(leadsMap).sort((a, b) => 
              hotLeadSort === 'recent' 
                ? new Date(b.latestDate) - new Date(a.latestDate)
                : new Date(a.latestDate) - new Date(b.latestDate)
            );

            // Calculate time since last activity
            const getTimeSince = (dateStr) => {
              const diff = Date.now() - new Date(dateStr).getTime();
              const mins = Math.floor(diff / 60000);
              if (mins < 60) return `${mins}m ago`;
              const hrs = Math.floor(mins / 60);
              if (hrs < 24) return `${hrs}h ago`;
              const days = Math.floor(hrs / 24);
              return `${days}d ago`;
            };

            // Heat level based on recency
            const getHeatLevel = (dateStr) => {
              const hrs = (Date.now() - new Date(dateStr).getTime()) / 3600000;
              if (hrs < 1) return { label: 'HOT', color: 'bg-red-500', emoji: '🔥🔥🔥' };
              if (hrs < 6) return { label: 'VERY HOT', color: 'bg-orange-500', emoji: '🔥🔥' };
              if (hrs < 24) return { label: 'WARM', color: 'bg-yellow-500', emoji: '🔥' };
              if (hrs < 72) return { label: 'COLD', color: 'bg-blue-400', emoji: '❄️' };
              return { label: 'OLD', color: 'bg-gray-500', emoji: '💤' };
            };

            // Build WhatsApp message for a lead
            const buildWhatsAppMessage = (lead) => {
              const song = lead.songs[0]; // most recent song
              const recipientName = song?.recipient_name || 'tu ser querido';
              const senderName = lead.senderName || 'amigo';
              const genreDisplay = song?.genre_name || song?.genre || 'personalizada';

              // Get songs that have audio ready
              const readySongs = lead.songs.filter(s => s.audio_url);

              let msg = `Hola ${senderName} 👋 Soy de RegalosQueCantan. Vi que creaste una canción increíble de ${genreDisplay} para ${recipientName} pero no completaste tu compra.\n\nTu canción todavía está guardada y lista para ti 🎵`;

              if (readySongs.length > 0) {
                // Single link to comparison page with both songs side by side
                const songIds = readySongs.map(s => s.id).join(',');
                const comparisonUrl = `${window.location.origin}/comparison?song_ids=${songIds}`;
                msg += `\n\nEscúchala aquí y completa tu compra 👇\n🎧 ${comparisonUrl}`;
                msg += `\n\n¡No dejes pasar este regalo único! 🎁`;
              } else {
                msg += `\n\n¿Quieres que te mande el link para escucharla otra vez?`;
              }

              return msg;
            };

            const buildWhatsAppUrl = (lead) => {
              const phone = lead.phone.startsWith('1') ? lead.phone : '1' + lead.phone;
              const msg = encodeURIComponent(buildWhatsAppMessage(lead));
              return `https://wa.me/${phone}?text=${msg}`;
            };

            return (
              <div className="space-y-4">
                {/* Header Stats */}
                <div className="bg-gradient-to-r from-orange-500/20 to-red-500/20 rounded-2xl p-5 border border-orange-500/30">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">🔥</span>
                      <div>
                        <h2 className="text-xl font-bold text-orange-400">Super Hot Leads</h2>
                        <p className="text-sm text-gray-400">Gave WhatsApp, created songs, but did NOT purchase</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold text-orange-400">{leads.length}</p>
                      <p className="text-xs text-gray-500">unconverted leads</p>
                    </div>
                  </div>
                  {/* Potential revenue */}
                  <div className="flex gap-4 mt-3 pt-3 border-t border-white/10">
                    <div className="flex-1 text-center">
                      <p className="text-lg font-bold text-green-400">
                        {userRole === 'admin'
                          ? formatCurrency(leads.length * 29.99)
                          : <span className="animate-pulse">Calculating...</span>}
                      </p>
                      <p className="text-xs text-gray-500">Potential revenue</p>
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-lg font-bold text-yellow-400">{leads.reduce((sum, l) => sum + l.songs.length, 0)}</p>
                      <p className="text-xs text-gray-500">Songs generated</p>
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-lg font-bold text-blue-400">{leads.filter(l => (Date.now() - new Date(l.latestDate).getTime()) < 86400000).length}</p>
                      <p className="text-xs text-gray-500">Last 24h</p>
                    </div>
                  </div>
                </div>

                {/* Sort + Bulk Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setHotLeadSort('recent')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        hotLeadSort === 'recent' ? 'bg-orange-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      Newest
                    </button>
                    <button
                      onClick={() => setHotLeadSort('oldest')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        hotLeadSort === 'oldest' ? 'bg-orange-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      Oldest
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      const csv = 'Phone,Email,Sender,Recipient,Genre,Occasion,Date,Songs\n' + 
                        leads.map(l => {
                          const s = l.songs[0];
                          return `${l.phone},${l.email},${l.senderName || ''},${s?.recipient_name || ''},${s?.genre || ''},${s?.occasion || ''},${new Date(l.latestDate).toLocaleDateString()},${l.songs.length}`;
                        }).join('\n');
                      navigator.clipboard.writeText(csv);
                      showToast(`✅ ${leads.length} leads copied (CSV)`);
                    }}
                    className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm font-medium hover:bg-white/10 transition border border-white/10"
                  >
                    📋 Export CSV
                  </button>
                </div>

                {/* Lead Cards */}
                {leads.length > 0 ? (
                  <div className="space-y-3">
                    {leads.map((lead, idx) => {
                      const heat = getHeatLevel(lead.latestDate);
                      const mainSong = lead.songs[0];
                      const phoneFormatted = lead.phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');

                      return (
                        <div key={lead.phone} className="bg-[#1a1f26] rounded-2xl border border-white/5 overflow-hidden hover:border-orange-500/30 transition">
                          {/* Lead Header */}
                          <div className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 ${heat.color} rounded-full flex items-center justify-center text-lg`}>
                                  {heat.emoji.charAt(0) === '🔥' ? '🔥' : heat.emoji}
                                </div>
                                <div>
                                  <p className="font-bold text-white text-lg">
                                    {lead.senderName || 'No name'}
                                  </p>
                                  <p className="text-sm text-gray-400">
                                    For: <span className="text-amber-400 font-medium">{mainSong?.recipient_name}</span>
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className={`inline-block px-2 py-1 rounded-full text-[10px] font-bold ${heat.color} text-white`}>
                                  {heat.label}
                                </span>
                                <p className="text-xs text-gray-500 mt-1">{getTimeSince(lead.latestDate)}</p>
                              </div>
                            </div>

                            {/* Lead Details Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                              <div className="bg-white/5 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase">WhatsApp</p>
                                <p className="text-sm font-medium text-green-400">{phoneFormatted}</p>
                              </div>
                              <div className="bg-white/5 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase">Email</p>
                                <p className="text-sm font-medium text-gray-300 truncate">{lead.email}</p>
                              </div>
                              <div className="bg-white/5 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase">Genre</p>
                                <p className="text-sm font-medium text-amber-400 capitalize">{[...lead.genres].join(', ') || '—'}</p>
                              </div>
                              <div className="bg-white/5 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase">Songs</p>
                                <p className="text-sm font-medium">{lead.songs.length} generated</p>
                              </div>
                            </div>

                            {/* Song preview links */}
                            {lead.songs.filter(s => s.audio_url).length > 0 && (
                              <div className="mb-3 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2">
                                <p className="text-[10px] text-amber-400 uppercase font-bold mb-1">🎵 Songs ready to listen:</p>
                                <div className="flex flex-wrap gap-1">
                                  {lead.songs.filter(s => s.audio_url).map((s, i) => {
                                    // Prefer the actual `version` column when present so the
                                    // chip matches the orders table (V1 / V2). Fall back to
                                    // positional numbering for legacy rows that pre-date the
                                    // version field.
                                    const v = (s.version === 1 || s.version === 2) ? s.version : (i + 1);
                                    return (
                                      <button
                                        key={s.id}
                                        onClick={() => {
                                          const url = `${window.location.origin}/listen?song_id=${s.id}`;
                                          navigator.clipboard.writeText(url);
                                          setCopiedLinkId(s.id);
                                          setTimeout(() => setCopiedLinkId(null), 2000);
                                        }}
                                        className="px-2 py-1 bg-amber-500/10 text-amber-400 rounded text-xs hover:bg-amber-500/20 transition"
                                      >
                                        {copiedLinkId === s.id ? '✅ Copied!' : `🎧 V${v}`}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                              {/* One-click WhatsApp with pre-filled message */}
                              <a
                                href={buildWhatsAppUrl(lead)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#25D366] text-white rounded-xl font-medium text-sm hover:bg-[#20bd5a] transition"
                              >
                                💬 Send WhatsApp
                              </a>
                              {/* Copy message to customize */}
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(buildWhatsAppMessage(lead));
                                  setCopiedMessageId(lead.phone);
                                  setTimeout(() => setCopiedMessageId(null), 2000);
                                }}
                                className={`px-4 py-2.5 rounded-xl font-medium text-sm transition ${
                                  copiedMessageId === lead.phone
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'
                                }`}
                              >
                                {copiedMessageId === lead.phone ? '✅ Copied' : '📋 Copy Message'}
                              </button>
                              {/* View song detail */}
                              <button
                                onClick={() => setSelectedSong(mainSong)}
                                className="px-4 py-2.5 bg-white/5 text-gray-400 rounded-xl font-medium text-sm hover:bg-white/10 transition border border-white/10"
                              >
                                👁️ View
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-16 bg-[#1a1f26] rounded-2xl">
                    <p className="text-5xl mb-4">🎉</p>
                    <p className="text-xl font-bold text-green-400 mb-2">No pending leads!</p>
                    <p className="text-gray-500">Every WhatsApp contact has already purchased</p>
                  </div>
                )}
              </div>
            );
          })()
        ) : activeTab === 'affiliates' ? (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-900/30 to-indigo-900/30 rounded-2xl p-6 border border-blue-500/20">
              <h2 className="text-2xl font-bold text-white mb-2">🤝 Affiliate Program</h2>
              <p className="text-gray-400">Add affiliates and they'll receive a welcome email with their credentials and link.</p>
            </div>

            {/* Add New Affiliate Form */}
            <div className="bg-[#1a1f26] rounded-2xl p-6 border border-white/5">
              <h3 className="text-white font-semibold mb-4">Add new affiliate</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Full name *</label>
                  <input
                    type="text"
                    placeholder="Maria Garcia"
                    value={newAffiliate.name}
                    onChange={e => setNewAffiliate(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:border-blue-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Email *</label>
                  <input
                    type="email"
                    placeholder="maria@example.com"
                    value={newAffiliate.email}
                    onChange={e => setNewAffiliate(p => ({ ...p, email: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:border-blue-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Affiliate code * <span className="text-gray-600">(used in ?ref=CODE)</span></label>
                  <input
                    type="text"
                    placeholder="maria20"
                    value={newAffiliate.code}
                    onChange={e => setNewAffiliate(p => ({ ...p, code: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:border-blue-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Password * <span className="text-gray-600">(for their portal)</span></label>
                  <input
                    type="text"
                    placeholder="password123"
                    value={newAffiliate.password}
                    onChange={e => setNewAffiliate(p => ({ ...p, password: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:border-blue-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Discount code <span className="text-gray-600">(optional, created automatically)</span></label>
                  <input
                    type="text"
                    placeholder="MARIA10"
                    value={newAffiliate.couponCode}
                    onChange={e => setNewAffiliate(p => ({ ...p, couponCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:border-blue-500/50 focus:outline-none"
                  />
                </div>
              </div>

              {affiliateMsg && (
                <div className={`rounded-xl p-3 mb-4 text-sm ${affiliateMsg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {affiliateMsg.type === 'success' ? '✅' : '❌'} {affiliateMsg.text}
                </div>
              )}

              <button
                onClick={createAffiliate}
                disabled={creatingAffiliate}
                className="px-6 py-2.5 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-400 transition disabled:opacity-50"
              >
                {creatingAffiliate ? '⏳ Creating...' : '➕ Create affiliate and send email'}
              </button>
            </div>

            {/* Summary Stats */}
            {affiliates.length > 0 && (() => {
              const totals = affiliates.reduce((acc, a) => {
                const s = a._stats || {};
                acc.visits += s.visits || 0;
                acc.sales += s.sales || 0;
                acc.commission += s.commission || 0;
                acc.paidOut += s.paidOut || 0;
                return acc;
              }, { visits: 0, sales: 0, commission: 0, paidOut: 0 });
              const owed = Math.max(0, totals.commission - totals.paidOut);
              const isAdmin = userRole === 'admin';
              const calculating = <span className="text-green-400 animate-pulse">Calculating...</span>;
              const summaryCards = [
                { label: 'Affiliates', value: affiliates.length, color: 'blue' },
                { label: 'Total clicks', value: totals.visits.toLocaleString(), color: 'gray' },
                { label: 'Total sales', value: totals.sales, color: 'green' },
                { label: 'Total commission', value: isAdmin ? `$${totals.commission.toFixed(2)}` : calculating, color: 'emerald' },
                { label: 'Owed', value: isAdmin ? `$${owed.toFixed(2)}` : calculating, color: isAdmin && owed > 0 ? 'amber' : 'gray' },
              ];
              return (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {summaryCards.map((s, i) => (
                    <div key={i} className={`bg-${s.color}-500/10 rounded-xl p-4 border border-${s.color}-500/20 text-center`}>
                      <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
                      <p className="text-gray-400 text-xs mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Affiliates Table */}
            <div className="bg-[#1a1f26] rounded-2xl border border-white/5 overflow-hidden">
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-white font-semibold">Affiliates ({affiliates.length})</h3>
                <button onClick={() => fetchAffiliates()} className="text-xs text-gray-400 hover:text-white transition">🔄 Refresh</button>
              </div>
              {affiliates.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  {affiliatesLoaded ? 'No affiliates registered yet' : '⏳ Loading...'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-xs uppercase border-b border-white/5">
                        <th className="text-left px-4 py-3">Affiliate</th>
                        <th className="text-left px-4 py-3">Code / Coupon</th>
                        <th className="text-right px-4 py-3">Clicks</th>
                        <th className="text-right px-4 py-3">Sales</th>
                        <th className="text-right px-4 py-3">Conv.</th>
                        <th className="text-right px-4 py-3">Commission</th>
                        <th className="text-right px-4 py-3">Paid</th>
                        <th className="text-right px-4 py-3">Owed</th>
                        <th className="text-left px-4 py-3">Payout</th>
                        <th className="text-left px-4 py-3">Last sale</th>
                        <th className="text-left px-4 py-3">Status</th>
                        {userRole === 'admin' && <th className="text-right px-4 py-3">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {affiliates.map(a => {
                        const s = a._stats || {};
                        const conv = s.visits > 0 ? ((s.sales / s.visits) * 100).toFixed(1) : '0.0';
                        const owed = Math.max(0, (s.commission || 0) - (s.paidOut || 0));
                        const daysSinceLastSale = s.lastSale ? Math.floor((Date.now() - s.lastSale.getTime()) / (1000 * 60 * 60 * 24)) : null;
                        return (
                          <tr key={a.id} className="border-b border-white/5 hover:bg-white/3">
                            <td className="px-4 py-3">
                              <div className="text-white font-medium">{a.name}</div>
                              <div className="text-gray-500 text-xs">{a.email}</div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-xs">{a.code}</span>
                              {a.coupon_code && (
                                <span className="font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-xs ml-1">{a.coupon_code}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-300 font-mono">{(s.visits || 0).toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono">
                              <span className={s.sales > 0 ? 'text-green-400 font-semibold' : 'text-gray-600'}>{s.sales || 0}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono">
                              <span className={parseFloat(conv) >= 5 ? 'text-green-400' : parseFloat(conv) > 0 ? 'text-amber-400' : 'text-gray-600'}>{conv}%</span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-green-400 font-semibold">
                              {userRole === 'admin'
                                ? `$${(s.commission || 0).toFixed(2)}`
                                : <span className="animate-pulse">Calculating...</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-gray-400">
                              {userRole === 'admin'
                                ? `$${(s.paidOut || 0).toFixed(2)}`
                                : <span className="text-green-400 animate-pulse">Calculating...</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-mono">
                              {userRole === 'admin' ? (
                                <span className={owed > 0 ? 'text-amber-400 font-semibold' : 'text-gray-600'}>${owed.toFixed(2)}</span>
                              ) : (
                                <span className="text-green-400 animate-pulse">Calculating...</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {a.payout_method ? (
                                <div>
                                  <div className="text-gray-300 font-medium capitalize">{a.payout_method}</div>
                                  <div className="text-gray-500 font-mono text-[10px] break-all" title={a.payout_handle || ''}>
                                    {a.payout_handle && a.payout_handle.length > 22
                                      ? a.payout_handle.slice(0, 20) + '…'
                                      : a.payout_handle || ''}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-amber-500/80 text-xs">Not set</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {s.lastSale ? (
                                <div>
                                  <div className="text-gray-300">{s.lastSale.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</div>
                                  <div className={`text-xs ${daysSinceLastSale > 30 ? 'text-red-400' : daysSinceLastSale > 14 ? 'text-amber-400' : 'text-green-400'}`}>
                                    {daysSinceLastSale === 0 ? 'Today' : daysSinceLastSale === 1 ? 'Yesterday' : `${daysSinceLastSale}d ago`}
                                  </div>
                                </div>
                              ) : <span className="text-gray-600">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                {a.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            {userRole === 'admin' && (
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={() => openPayoutModal(a)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${owed > 0 ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                  title={owed > 0 ? `Record payout (owed: $${owed.toFixed(2)})` : 'Record payout'}
                                >
                                  💸 Record
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'clonamivoz' ? (
          /* Clone Mi Voz tab — self-contained component. Reads from
             admin-cloned-voice-songs edge function (separate from
             admin-songs so the main funnel admin view is untouched). */
          <ClonamivozAdminTab accessToken={accessToken} role={userRole} />
        ) : activeTab === 'sms' ? (
          /* SMS Inbox — two-way Twilio texting. Self-contained component.
             Talks to a future `sms-admin` edge function; until that ships it
             renders clearly-labeled demo threads so the UX is reviewable. */
          <SmsInboxTab accessToken={accessToken} />
        ) : null}
      </main>

      {/* Record-payout modal — admin only. Inserts a row into
          affiliate_payouts so the partner's dashboard reflects "Pagado"
          and the Owed column drops accordingly. Triggered from the Record
          button in the affiliates table. */}
      {payoutModal && userRole === 'admin' && (() => {
        const a = payoutModal.affiliate;
        const stats = a._stats || {};
        const owed = payoutModal.suggestedAmount || 0;
        const payouts = a._payouts || [];
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => !recordingPayout && setPayoutModal(null)}
          >
            <div
              className="bg-[#1a1f26] rounded-2xl max-w-lg w-full overflow-hidden border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  💸 Record payout to {a.name}
                </h3>
                <button
                  onClick={() => !recordingPayout && setPayoutModal(null)}
                  className="p-2 rounded-lg hover:bg-white/10 transition text-gray-400"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="p-5 space-y-4">
                {/* Owed summary */}
                <div className="grid grid-cols-3 gap-3 text-center text-xs">
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-gray-400">Total commission</p>
                    <p className="text-emerald-400 font-mono font-semibold text-sm mt-1">
                      ${(stats.commission || 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-gray-400">Already paid</p>
                    <p className="text-gray-300 font-mono font-semibold text-sm mt-1">
                      ${(stats.paidOut || 0).toFixed(2)}
                    </p>
                  </div>
                  <div className={`rounded-lg p-3 ${owed > 0 ? 'bg-amber-500/10' : 'bg-white/5'}`}>
                    <p className="text-gray-400">Owed now</p>
                    <p className={`font-mono font-semibold text-sm mt-1 ${owed > 0 ? 'text-amber-300' : 'text-gray-500'}`}>
                      ${owed.toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Affiliate's saved payout method */}
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 text-xs">
                  <p className="text-gray-400 uppercase tracking-wide font-medium mb-1">Partner's payout info</p>
                  {a.payout_method ? (
                    <div>
                      <span className="text-blue-300 font-semibold capitalize">{a.payout_method}</span>
                      {' → '}
                      <span className="text-white font-mono break-all">{a.payout_handle}</span>
                      {a.payout_notes && <div className="text-gray-400 mt-1">{a.payout_notes}</div>}
                    </div>
                  ) : (
                    <span className="text-amber-400">Not set — ask partner to add it in their dashboard before paying.</span>
                  )}
                </div>

                {/* Inputs */}
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Amount (USD) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={payoutForm.amount}
                    onChange={e => setPayoutForm(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:border-blue-500/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Method</label>
                  <select
                    value={payoutForm.method}
                    onChange={e => setPayoutForm(p => ({ ...p, method: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:border-blue-500/50 focus:outline-none"
                  >
                    <option value="" className="bg-[#1a1f26]">— select —</option>
                    <option value="zelle" className="bg-[#1a1f26]">Zelle</option>
                    <option value="venmo" className="bg-[#1a1f26]">Venmo</option>
                    <option value="paypal" className="bg-[#1a1f26]">PayPal</option>
                    <option value="bank" className="bg-[#1a1f26]">Bank transfer</option>
                    <option value="other" className="bg-[#1a1f26]">Other</option>
                  </select>
                </div>

                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Note (optional)</label>
                  <input
                    type="text"
                    value={payoutForm.note}
                    onChange={e => setPayoutForm(p => ({ ...p, note: e.target.value }))}
                    placeholder="e.g. Zelle confirmation #ABC123"
                    maxLength={500}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:border-blue-500/50 focus:outline-none"
                  />
                </div>

                {payoutModalError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                    ❌ {payoutModalError}
                  </div>
                )}

                {/* Recent payouts for this affiliate (last 5) */}
                {payouts.length > 0 && (
                  <div className="border-t border-white/5 pt-4">
                    <p className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-2">
                      Recent payouts ({payouts.length})
                    </p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {payouts.slice(0, 5).map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs bg-white/3 rounded px-3 py-1.5">
                          <span className="text-gray-400">
                            {new Date(p.paid_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {p.method && <span className="ml-2 text-gray-500 capitalize">• {p.method}</span>}
                          </span>
                          <span className="text-emerald-400 font-mono">${p.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => !recordingPayout && setPayoutModal(null)}
                    disabled={recordingPayout}
                    className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-sm font-medium transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={recordPayout}
                    disabled={recordingPayout}
                    className="flex-1 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
                  >
                    {recordingPayout ? 'Recording…' : 'Record payout'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Backfill modal — admin only. Marks every paid+phone song with
          created_at <= cutoff as already sent so the Por Enviar queue isn't
          flooded with historical orders on day one. */}
      {backfillModalOpen && userRole === 'admin' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => !backfillBusy && setBackfillModalOpen(false)}
        >
          <div
            className="bg-[#1a1f26] rounded-2xl max-w-md w-full overflow-hidden border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <h3 className="font-semibold text-white flex items-center gap-2">
                🗓️ Backfill — mark as sent
              </h3>
              <button
                onClick={() => !backfillBusy && setBackfillModalOpen(false)}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                <span className="material-symbols-outlined text-gray-400">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-300">
                Mark as <strong className="text-green-400">already sent</strong> every paid song
                with a phone whose creation date is
                <em> earlier than </em> the moment you choose.
              </p>
              <p className="text-xs text-gray-500">
                Use this once when activating the "Pending to Send" queue so hundreds of
                historical orders you've probably already delivered by email don't show up.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Cutoff (everything created before this moment)
                </label>
                <input
                  type="datetime-local"
                  value={backfillCutoff}
                  onChange={(e) => setBackfillCutoff(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-violet-400 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Recommended: midnight today (what the field already has by default).
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => !backfillBusy && setBackfillModalOpen(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={backfillSent}
                  disabled={backfillBusy || !backfillCutoff}
                  className="flex-1 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 text-white font-medium disabled:opacity-50"
                >
                  {backfillBusy ? 'Applying…' : 'Mark as sent'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mureka Credits Update Modal — admin only */}
      {murekaModalOpen && userRole === 'admin' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => !murekaSaving && setMurekaModalOpen(false)}
        >
          <div
            className="bg-[#1a1f26] rounded-2xl max-w-md w-full overflow-hidden border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🎵</span>
                <h3 className="font-semibold text-white">Update credit balance</h3>
              </div>
              <button
                onClick={() => !murekaSaving && setMurekaModalOpen(false)}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                <span className="material-symbols-outlined text-gray-400">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Current balance (credits)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={murekaForm.balance}
                  onChange={(e) => setMurekaForm({ ...murekaForm, balance: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-violet-400 focus:border-transparent"
                  placeholder="e.g. 20000"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  The credit count you see in the music provider's dashboard after topping up.
                  This resets the generation counter.
                </p>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-gray-400 hover:text-white">Advanced settings</summary>
                <div className="mt-3 space-y-3 pl-2 border-l-2 border-white/5">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      Credits per song
                    </label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={murekaForm.credits_per_generation}
                      onChange={(e) => setMurekaForm({ ...murekaForm, credits_per_generation: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        Low threshold
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={murekaForm.low_threshold}
                        onChange={(e) => setMurekaForm({ ...murekaForm, low_threshold: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        Critical threshold
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={murekaForm.critical_threshold}
                        onChange={(e) => setMurekaForm({ ...murekaForm, critical_threshold: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                      />
                    </div>
                  </div>
                </div>
              </details>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => !murekaSaving && setMurekaModalOpen(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={saveMurekaBalance}
                  disabled={murekaSaving || !murekaForm.balance}
                  className="flex-1 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 text-white font-medium disabled:opacity-50"
                >
                  {murekaSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Preview Modal */}
      {previewingCampaign && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewingCampaign(null)}
        >
          <div 
            className="bg-[#1a1f26] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div>
                <h3 className="font-bold text-white">👁️ Email Preview</h3>
                <p className="text-xs text-gray-500">{previewingCampaign.name}</p>
              </div>
              <button 
                onClick={() => setPreviewingCampaign(null)}
                className="text-gray-400 hover:text-white text-xl"
              >
                ✕
              </button>
            </div>
            <div className="bg-gray-100 px-4 py-2">
              <p className="text-gray-600 text-sm">
                <strong>Subject:</strong> {previewingCampaign.subject.replace('{{recipient_name}}', 'María')}
              </p>
            </div>
            <iframe
              srcDoc={generateEmailPreview(previewingCampaign)}
              className="w-full h-[500px] border-0"
              title="Email Preview"
            />
          </div>
        </div>
      )}

      {/* Edit Campaign Modal */}
      {editingCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1a1f26] rounded-2xl max-w-lg w-full p-6 border border-white/10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">✏️ Edit Campaign</h3>
              <button 
                onClick={() => setEditingCampaign(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Timing (for abandoned cart emails) */}
              {editingCampaign.id !== 'purchase_confirmation' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">⏱️ Send after (hours)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="72"
                      value={editingCampaign.delay_hours}
                      onChange={(e) => setEditingCampaign({...editingCampaign, delay_hours: parseInt(e.target.value) || 1})}
                      className="w-24 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-amber-400 text-center"
                    />
                    <span className="text-gray-500 text-sm">hours after the song is created</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    {editingCampaign.id === 'abandoned_1hr' ? 'Recommended: 1-2 hours' : 'Recommended: 12-24 hours'}
                  </p>
                </div>
              )}

              {/* Subject — keeps the Spanish placeholder because the email goes to Spanish-speaking customers */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email subject</label>
                <input
                  type="text"
                  value={editingCampaign.subject}
                  onChange={(e) => setEditingCampaign({...editingCampaign, subject: e.target.value})}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-amber-400"
                  placeholder="🎵 ¡Tu canción está lista!"
                />
              </div>

              {/* Heading */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Main heading</label>
                <input
                  type="text"
                  value={editingCampaign.heading}
                  onChange={(e) => setEditingCampaign({...editingCampaign, heading: e.target.value})}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-amber-400"
                  placeholder="¡Tu canción está lista!"
                />
              </div>

              {/* Body Text */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Body text</label>
                <textarea
                  value={editingCampaign.body_text}
                  onChange={(e) => setEditingCampaign({...editingCampaign, body_text: e.target.value})}
                  rows={3}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-amber-400 resize-none"
                  placeholder="La canción para {{recipient_name}} está esperándote..."
                />
                <p className="text-xs text-gray-500 mt-1">Use {'{{recipient_name}}'} for the recipient's name</p>
              </div>

              {/* Button Text */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Button text</label>
                <input
                  type="text"
                  value={editingCampaign.button_text}
                  onChange={(e) => setEditingCampaign({...editingCampaign, button_text: e.target.value})}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-amber-400"
                  placeholder="Escuchar y Descargar"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingCampaign(null)}
                className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-gray-400 hover:bg-white/10 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => saveCampaign(editingCampaign)}
                disabled={savingCampaign}
                className="flex-1 px-4 py-3 rounded-xl bg-amber-400 text-black font-semibold hover:bg-amber-300 transition disabled:opacity-50"
              >
                {savingCampaign ? '⏳ Saving...' : '✓ Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Song Detail Modal */}
      {selectedSong && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" 
          onClick={() => setSelectedSong(null)}
        >
          <div 
            className="bg-[#1a1f26] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-[#1a1f26] border-b border-white/10 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                Order Details
                {/* Show V1/V2 right next to the title so it's obvious which audio
                    variant this row represents. Each song creation produces 2. */}
                {(selectedSong.version === 1 || selectedSong.version === 2) && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                      selectedSong.version === 1
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                        : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    }`}
                    title={`Version ${selectedSong.version} of 2`}
                  >
                    Version {selectedSong.version} de 2
                  </span>
                )}
              </h2>
              <button
                onClick={() => setSelectedSong(null)}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                <span className="material-symbols-outlined text-gray-400">close</span>
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Status & Price */}
              <div className="flex items-center justify-between">
                {isPaid(selectedSong) ? (
                  <span className="px-4 py-2 rounded-full font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                    ✓ Paid — {userRole === 'admin'
                      ? formatCurrency(getSongPrice(selectedSong))
                      : <span className="animate-pulse">Calculating...</span>}
                  </span>
                ) : (
                  <span className="px-4 py-2 rounded-full font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    ⏳ Pending
                  </span>
                )}
                <span className="text-sm text-gray-500">{formatDate(selectedSong.created_at)}</span>
              </div>
              
              {/* Download Status */}
              {isPaid(selectedSong) && (
                <div className={`rounded-xl p-4 ${selectedSong.downloaded ? 'bg-green-500/10 border border-green-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{selectedSong.downloaded ? '✅' : '⚠️'}</span>
                      <div>
                        <p className="font-medium">{selectedSong.downloaded ? 'Downloaded' : 'Not downloaded'}</p>
                        {selectedSong.downloaded && (
                          <p className="text-xs text-gray-400">
                            {selectedSong.download_count || 1}x
                            {selectedSong.last_downloaded_at && ` • ${formatDate(selectedSong.last_downloaded_at)}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Coupon Badge */}
              {selectedSong.coupon_code && (
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3">
                  <span className="text-purple-400 text-sm">🎟️ Coupon: <strong>{selectedSong.coupon_code}</strong></span>
                </div>
              )}
              
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">For</p>
                  <p className="font-semibold">{selectedSong.recipient_name || '—'}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">From</p>
                  <p className="font-semibold">{selectedSong.sender_name || '—'}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Genre</p>
                  <p className="font-semibold capitalize text-amber-400">{selectedSong.genre || '—'}</p>
                  {selectedSong.sub_genre && <p className="text-xs text-gray-500">{selectedSong.sub_genre}</p>}
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Occasion</p>
                  <p className="font-semibold">{formatOccasion(selectedSong.occasion)}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Voice</p>
                  <p className="font-semibold">{selectedSong.voice_type === 'female' ? '♀️ Female' : '♂️ Male'}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Relationship</p>
                  <p className="font-semibold capitalize">{selectedSong.relationship || '—'}</p>
                </div>
              </div>
              
              {/* Email */}
              <div className="bg-white/5 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-500">Email</p>
                  {selectedSong.email && repeatBuyerEmails.has(selectedSong.email.toLowerCase()) && (
                    <span className="text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30 rounded-full px-2 py-0.5">
                      ★ Repeat Buyer
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="font-semibold break-all">{selectedSong.email}</p>
                  {/* 1-touch send button — shown on every paid order, with or without a WhatsApp number */}
                  {isPaid(selectedSong) && (
                    <button
                      onClick={() => sendLinkByEmail(selectedSong)}
                      disabled={sendingLinkEmail === selectedSong.id}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition text-xs font-semibold disabled:opacity-50"
                    >
                      {sendingLinkEmail === selectedSong.id
                        ? '⏳ Enviando...'
                        : selectedSong.email_sent_at
                          ? `✅ Enviado ${timeAgo(selectedSong.email_sent_at)}`
                          : '📤 Enviar Link por Email'}
                    </button>
                  )}
                </div>
              </div>

              {/* WhatsApp */}
              {selectedSong.whatsapp_phone && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-green-400">💬 WhatsApp</p>
                    {isPaid(selectedSong) && (
                      selectedSong.whatsapp_sent_at ? (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          ✓ Sent {timeAgo(selectedSong.whatsapp_sent_at)}
                        </span>
                      ) : (
                        <span className="text-xs text-amber-400">⏳ Pending delivery</span>
                      )
                    )}
                  </div>
                  {/* Phone display / inline edit */}
                  {editingPhone ? (
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <input
                        type="tel"
                        value={phoneEditValue}
                        onChange={(e) => setPhoneEditValue(e.target.value)}
                        placeholder="10-digit number"
                        className="flex-1 min-w-[140px] px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-sm text-white focus:outline-none focus:border-green-400"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') savePhone(selectedSong.id, phoneEditValue);
                          if (e.key === 'Escape') setEditingPhone(false);
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => savePhone(selectedSong.id, phoneEditValue)}
                        disabled={phoneSaving}
                        className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-400 transition disabled:opacity-50"
                      >
                        {phoneSaving ? '⏳' : '✓ Save'}
                      </button>
                      <button
                        onClick={() => setEditingPhone(false)}
                        className="px-3 py-1.5 bg-white/10 text-white rounded-lg text-sm hover:bg-white/20 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 mb-3">
                      <p className="font-semibold text-lg">
                        {selectedSong.whatsapp_phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
                      </p>
                      <button
                        onClick={() => { setPhoneEditValue(selectedSong.whatsapp_phone); setEditingPhone(true); }}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-white/10 text-gray-400 hover:text-white hover:bg-white/20 transition"
                        title="Correct phone number"
                      >
                        ✏️ Edit
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap justify-end">
                      <a
                        href={`https://wa.me/${selectedSong.whatsapp_phone.startsWith('1') ? selectedSong.whatsapp_phone : '1' + selectedSong.whatsapp_phone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:bg-[#20bd5a] transition flex items-center gap-2"
                      >
                        💬 Open Chat
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedSong.whatsapp_phone);
                          showToast('Number copied!');
                        }}
                        className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-medium hover:bg-white/20 transition"
                      >
                        📋 Copy
                      </button>
                      {userRole === 'admin' && isPaid(selectedSong) && (
                        selectedSong.whatsapp_sent_at ? (
                          <button
                            onClick={() => unmarkSongAsSent(selectedSong.id)}
                            className="px-4 py-2 bg-amber-500/20 text-amber-300 rounded-lg text-sm font-medium hover:bg-amber-500/30 transition border border-amber-500/30"
                          >
                            ↺ Mark as NOT sent
                          </button>
                        ) : (
                          <button
                            onClick={() => markSongAsSent(selectedSong.id)}
                            disabled={markSendBusy === selectedSong.id}
                            className="px-4 py-2 bg-green-500/20 text-green-300 rounded-lg text-sm font-medium hover:bg-green-500/30 transition border border-green-500/30 disabled:opacity-50"
                          >
                            ✓ Mark as sent
                          </button>
                        )
                      )}
                    </div>
                </div>
              )}

              {/* Video Addon Panel — shown for songs with has_video_addon = true */}
              {selectedSong.has_video_addon && (() => {
                const vo = videoOrdersMap[selectedSong.id]; // undefined = loading, null = no order, object = fetched
                const photoUploadUrl = `${window.location.origin}/success?song_id=${selectedSong.id}`;
                const statusConfig = {
                  pending:         { label: 'Pendiente fotos',  color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
                  photos_uploaded: { label: 'Fotos subidas',    color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
                  processing:      { label: 'Procesando video', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
                  completed:       { label: '✅ Completado',    color: 'bg-green-500/20 text-green-300 border-green-500/40' },
                  failed:          { label: '❌ Falló',         color: 'bg-red-500/20 text-red-300 border-red-500/40' },
                };
                const sc = vo ? (statusConfig[vo.status] || { label: vo.status, color: 'bg-gray-500/20 text-gray-300 border-gray-500/40' }) : null;
                return (
                  <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-violet-400 font-semibold">🎬 Video Addon</p>
                      {vo === undefined && <span className="text-xs text-gray-500 animate-pulse">Cargando...</span>}
                      {vo !== undefined && !vo && <span className="text-xs text-amber-400">Sin orden de video</span>}
                      {vo && sc && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${sc.color}`}>{sc.label}</span>}
                      <button onClick={() => fetchVideoOrder(selectedSong.id)} className="text-[11px] text-gray-500 hover:text-gray-300 transition ml-1" title="Refresh">↻</button>
                    </div>
                    {vo?.status === 'failed' && vo?.photo_urls?.length >= 3 && (
                      <button
                        onClick={() => retryVideoRender(selectedSong.id, vo.id)}
                        disabled={retryingVideo}
                        className="w-full py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-semibold hover:bg-red-500/30 transition disabled:opacity-50"
                      >
                        {retryingVideo ? '⏳ Reintentando...' : '🔄 Reintentar render'}
                      </button>
                    )}
                    {vo && vo.photo_urls && vo.photo_urls.length > 0 && (
                      <p className="text-xs text-gray-400">📸 {vo.photo_urls.length} foto{vo.photo_urls.length !== 1 ? 's' : ''} subida{vo.photo_urls.length !== 1 ? 's' : ''}</p>
                    )}
                    {vo?.status === 'completed' && vo?.video_url && (
                      <div className="flex gap-2">
                        <input type="text" readOnly value={vo.video_url} className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-300" />
                        <button onClick={() => { navigator.clipboard.writeText(vo.video_url); showToast('Video URL copiada!'); }} className="px-3 py-2 bg-violet-500 text-white rounded-lg text-xs font-medium hover:bg-violet-400 transition">Copy</button>
                        <a href={vo.video_url} target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-white/10 text-white rounded-lg text-xs font-medium hover:bg-white/20 transition">👁️</a>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">📸 Link para subir fotos (enviar al cliente):</p>
                      <div className="flex gap-2">
                        <input type="text" readOnly value={photoUploadUrl} className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-300" />
                        <button onClick={() => { navigator.clipboard.writeText(photoUploadUrl); showToast('Link copiado!'); }} className="px-3 py-2 bg-violet-500 text-white rounded-lg text-xs font-medium hover:bg-violet-400 transition whitespace-nowrap">📋 Copiar</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Details */}
              {selectedSong.details && (
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-2">Details</p>
                  <p className="text-sm whitespace-pre-wrap">{selectedSong.details}</p>
                </div>
              )}

              {/* Lyrics */}
              {selectedSong.lyrics && (
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-2">Lyrics</p>
                  <p className="text-sm whitespace-pre-wrap font-mono max-h-40 overflow-y-auto text-gray-300">{selectedSong.lyrics}</p>
                </div>
              )}
              
              {/* Audio Player */}
              {selectedSong.audio_url && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-3">🎵 Audio</p>
                  <audio controls className="w-full mb-3" src={selectedSong.audio_url} />
                  <div className="flex gap-2">
                    <a
                      href={selectedSong.audio_url}
                      download
                      className="flex-1 py-2 px-4 bg-amber-400 text-black rounded-lg font-medium text-center text-sm hover:bg-amber-300 transition"
                    >
                      ⬇️ Download MP3
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedSong.audio_url);
                        showToast('URL copied!');
                      }}
                      className="py-2 px-4 bg-white/10 text-white rounded-lg font-medium text-sm hover:bg-white/20 transition"
                    >
                      📋 Copy URL
                    </button>
                  </div>
                </div>
              )}

              {/* Karaoke (instrumental) — only shows if the customer bought the add-on */}
              {(selectedSong.karaoke_status || selectedSong.karaoke_url) && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-3">🎤 Karaoke (versión sin voz)</p>

                  {selectedSong.karaoke_status === 'ready' && selectedSong.karaoke_url && (
                    <>
                      <audio controls className="w-full mb-3" src={selectedSong.karaoke_url} />
                      <div className="flex gap-2">
                        <a
                          href={selectedSong.karaoke_url}
                          download={`karaoke-para-${selectedSong.recipient_name || 'cliente'}.mp3`}
                          className="flex-1 py-2 px-4 bg-orange-400 text-black rounded-lg font-medium text-center text-sm hover:bg-orange-300 transition"
                        >
                          ⬇️ Download Karaoke
                        </a>
                        <button
                          onClick={() => {
                            // Share the branded KARAOKE PAGE (not the raw audio file) —
                            // /karaoke/<id> renders the decorated "instrumental, sin voz"
                            // page with player + download. Derived from the id so it works
                            // regardless of what karaoke_url points at.
                            const pageUrl = `https://www.regalosquecantan.com/karaoke/${selectedSong.id}`;
                            navigator.clipboard.writeText(pageUrl);
                            showToast('Karaoke share link copied!\n' + pageUrl);
                          }}
                          className="py-2 px-4 bg-white/10 text-white rounded-lg font-medium text-sm hover:bg-white/20 transition"
                        >
                          📋 Copy Share Link
                        </button>
                      </div>
                    </>
                  )}

                  {selectedSong.karaoke_status === 'pending' && (
                    <p className="text-xs text-orange-300">⏳ Procesando… (vuelve a abrir este modal en ~1 minuto)</p>
                  )}

                  {selectedSong.karaoke_status === 'failed' && (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-red-300">❌ La extracción falló. Toca el botón para reintentar.</p>
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-karaoke`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ songId: selectedSong.id }),
                            });
                            const data = await res.json();
                            if (data?.vercel_response?.success) {
                              showToast('✅ Karaoke regenerated! Cierra y reabre este modal para verlo.');
                            } else {
                              showToast('❌ Retry failed: ' + (data?.vercel_response?.error || data?.error || 'unknown'));
                            }
                          } catch (e) {
                            showToast('❌ Retry threw: ' + e.message);
                          }
                        }}
                        className="py-2 px-4 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-400 transition"
                      >
                        🔄 Reintentar
                      </button>
                    </div>
                  )}
                </div>
              )}
              
              {/* Customer Links */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                <p className="text-xs text-blue-400 mb-2">🔗 Customer links</p>

                {/* Preview Link */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1">🎧 Preview (20s + checkout):</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/listen?song_id=${selectedSong.id}`}
                      className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/listen?song_id=${selectedSong.id}`);
                        showToast('Preview link copied!');
                      }}
                      className="px-4 py-2 bg-amber-500 text-black rounded-lg text-sm font-medium hover:bg-amber-400 transition"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {/* Success Link */}
                <div>
                  <p className="text-xs text-gray-500 mb-1">📥 Download (full song):</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/success?song_id=${selectedSong.id}`}
                      className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/success?song_id=${selectedSong.id}`);
                        showToast('Download link copied!');
                      }}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-400 transition"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>

              {/* Polaroid Shareable Page Link */}
              <div className="bg-pink-500/10 border border-pink-500/20 rounded-xl p-4">
                <p className="text-xs text-pink-400 mb-2">🎨 Shareable page (Polaroid)</p>
                <p className="text-xs text-gray-500 mb-2">This link shows the song on a nice page to share via WhatsApp</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/song/${selectedSong.id}`}
                    className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/song/${selectedSong.id}`);
                      showToast('Polaroid link copied!');
                    }}
                    className="px-4 py-2 bg-pink-500 text-white rounded-lg text-sm font-medium hover:bg-pink-400 transition"
                  >
                    Copy
                  </button>
                  <a
                    href={`${window.location.origin}/song/${selectedSong.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-medium hover:bg-white/20 transition"
                  >
                    👁️ View
                  </a>
                </div>
              </div>
              
              {/* Retry button — only shown for stuck/failed songs (admin only) */}
              {userRole === 'admin' && selectedSong.status && selectedSong.status !== 'completed' && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-2">
                  <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">
                    ⚠️ Generation status: <span className="font-mono">{selectedSong.status}</span>
                  </p>
                  {retryResult && (
                    <p className={`text-xs ${retryResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                      {retryResult.ok ? '✓ ' : '✗ '}{retryResult.message}
                    </p>
                  )}
                  <button
                    onClick={() => retrySong(selectedSong.id)}
                    disabled={retryingId === selectedSong.id}
                    className="w-full py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm font-semibold transition disabled:opacity-50"
                  >
                    {retryingId === selectedSong.id ? '⏳ Submitting retry...' : '🔄 Retry Generation'}
                  </button>
                </div>
              )}

              {/* Admin notes — internal only, never shown to customers */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">📝 Internal Notes</p>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Add a private note about this order..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 resize-none focus:outline-none focus:border-amber-400/40"
                />
                <button
                  onClick={saveNote}
                  disabled={noteSaving}
                  className="px-4 py-1.5 rounded-lg bg-amber-400/15 hover:bg-amber-400/25 text-amber-300 text-xs font-semibold transition disabled:opacity-50"
                >
                  {noteSaving ? 'Saving...' : noteSaved ? '✓ Saved' : 'Save Note'}
                </button>
              </div>

              {/* Song ID */}
              <p className="text-center text-xs text-gray-600 font-mono">ID: {selectedSong.id}</p>
            </div>
          </div>
        </div>
      )}

      {/* Hidden audio player — shared across all rows */}
      <audio
        ref={audioRef}
        onEnded={() => { setPreviewPlaying(false); setPreviewingId(null); }}
        onPause={() => setPreviewPlaying(false)}
        onPlay={() => setPreviewPlaying(true)}
        style={{ display: 'none' }}
      />
    </div>
  );
}
