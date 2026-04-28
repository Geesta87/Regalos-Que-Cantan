import React, { useState, useEffect, useContext, useMemo } from 'react';
import { AppContext } from '../App';
import { supabase } from '../services/api';
import { trackStep, FUNNEL_STEPS } from '../services/tracking';

// Debounce hook for search inputs
function useDebounce(value, delay = 350) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
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
  const [songs, setSongs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedSong, setSelectedSong] = useState(null);
  const [activeTab, setActiveTab] = useState('orders');
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
  const [ordersPage, setOrdersPage] = useState(0);
  const [lookupPage, setLookupPage] = useState(0);
  const ORDERS_PER_PAGE = 50;
  const LOOKUP_PER_PAGE = 50;
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

  // Check auth on mount: real Supabase Auth session + admin_users role lookup
  useEffect(() => {
    let cancelled = false;
    let emailSubscription = null;
    let campaignSubscription = null;

    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;

      if (!session?.user) {
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
        navigateTo('adminLogin');
        return;
      }

      if (cancelled) return;

      setUserRole(roleRow.role);
      setAccessToken(session.access_token);

      // Pass the token directly into the first fetch so we don't race with
      // setAccessToken's async state commit.
      fetchSongs(session.access_token);
      fetchFunnelData();
      fetchEmailLogs();
      fetchEmailCampaigns();

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

  // ✅ STRICT: Check if song is actually paid
  const isPaid = (song) => {
    // Primary check: the paid boolean field
    if (song.paid === true) return true;
    if (song.paid === 'true') return true;
    if (song.paid === 1) return true;
    
    // Check is_paid field
    if (song.is_paid === true) return true;
    
    // Check payment_status field
    if (song.payment_status === 'paid') return true;
    if (song.payment_status === 'completed') return true;
    if (song.payment_status === 'succeeded') return true;
    
    // Check if has stripe_payment_id (indicates successful payment capture)
    if (song.stripe_payment_id) return true;
    
    // Check if paid_at timestamp exists (set only after successful payment)
    if (song.paid_at) return true;
    
    // Check amount_paid > 0 (should only be set after real payment)
    if (song.amount_paid && parseFloat(song.amount_paid) > 0) return true;
    
    // NOTE: stripe_session_id alone does NOT mean paid - it's created when checkout starts
    
    return false;
  };

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

  const SONG_LIST_COLUMNS = [
    'id', 'created_at', 'email', 'recipient_name', 'sender_name',
    'genre', 'genre_name', 'sub_genre', 'occasion', 'voice_type',
    'session_id', 'stripe_session_id', 'stripe_payment_id', 'payment_status',
    'paid', 'paid_at', 'amount_paid',
    'coupon_code', 'affiliate_code', 'utm_source',
    'audio_url', 'whatsapp_phone', 'download_count', 'downloaded',
    'has_video_addon'
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
      
      // Calculate stats using robust isPaid check
      const totalSongs = data?.length || 0;
      const paidSongs = data?.filter(s => isPaid(s)) || [];
      const paidOrders = paidSongs.length;
      const pendingOrders = totalSongs - paidOrders;
      
      let totalRevenue = 0;
      let freeOrders = 0;
      
      // Today's stats
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let todayRevenue = 0;
      let todayOrders = 0;
      
      paidSongs.forEach(song => {
        const price = getSongPrice(song);
        totalRevenue += price;
        if (price === 0) freeOrders++;
        
        // Check if order is from today
        const songDate = new Date(song.created_at);
        if (songDate >= today) {
          todayRevenue += price;
          todayOrders++;
        }
      });

      // Count unique WhatsApp contacts
      const whatsappContacts = new Set(
        data?.filter(s => s.whatsapp_phone).map(s => s.whatsapp_phone)
      ).size;

      setStats({
        totalSongs,
        totalRevenue,
        paidOrders,
        pendingOrders,
        freeOrders,
        todayRevenue,
        todayOrders,
        whatsappContacts
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

  const fetchAffiliates = async () => {
    try {
      const { data: affData, error } = await supabase
        .from('affiliates')
        .select('*')
        .order('created_at', { ascending: false });
      if (error || !affData) { setAffiliatesLoaded(true); return; }

      // Pull all affiliate events + payouts in bulk for performance stats
      const codes = affData.map(a => a.code);
      const [{ data: events }, { data: payouts }] = await Promise.all([
        supabase.from('affiliate_events').select('affiliate_code, event_type, amount, created_at').in('affiliate_code', codes),
        supabase.from('affiliate_payouts').select('affiliate_code, amount').in('affiliate_code', codes)
      ]);

      // Build per-affiliate stats
      const statsMap = {};
      for (const a of affData) {
        statsMap[a.code] = { visits: 0, checkouts: 0, sales: 0, revenue: 0, commission: 0, paidOut: 0, lastSale: null };
      }
      for (const e of (events || [])) {
        const s = statsMap[e.affiliate_code];
        if (!s) continue;
        if (e.event_type === 'visit') s.visits++;
        else if (e.event_type === 'checkout') s.checkouts++;
        else if (e.event_type === 'purchase') {
          s.sales++;
          const amt = parseFloat(e.amount) || 0;
          s.revenue += amt;
          const pct = affData.find(a => a.code === e.affiliate_code)?.commission_pct || 20;
          s.commission += amt * (pct / 100);
          const d = new Date(e.created_at);
          if (!s.lastSale || d > s.lastSale) s.lastSale = d;
        }
      }
      for (const p of (payouts || [])) {
        const s = statsMap[p.affiliate_code];
        if (s) s.paidOut += parseFloat(p.amount) || 0;
      }

      setAffiliates(affData.map(a => ({ ...a, _stats: statsMap[a.code] })));
      setAffiliatesLoaded(true);
    } catch (err) { console.error('Failed to fetch affiliates:', err); setAffiliatesLoaded(true); }
  };

  const createAffiliate = async () => {
    const { name, email, code, password, couponCode } = newAffiliate;
    if (!name || !email || !code || !password) {
      setAffiliateMsg({ type: 'error', text: 'Nombre, email, código y contraseña son requeridos' });
      return;
    }
    setCreatingAffiliate(true);
    setAffiliateMsg(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-affiliate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ name, email, code, couponCode: couponCode || undefined, password })
      });
      const data = await res.json();
      if (data.success) {
        setAffiliateMsg({ type: 'success', text: `Afiliado ${data.affiliate.name} creado. Email de bienvenida enviado a ${data.affiliate.email}` });
        setNewAffiliate({ name: '', email: '', code: '', couponCode: '', password: '' });
        fetchAffiliates();
      } else {
        setAffiliateMsg({ type: 'error', text: data.error || 'Error al crear afiliado' });
      }
    } catch (err) {
      setAffiliateMsg({ type: 'error', text: err.message });
    } finally { setCreatingAffiliate(false); }
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
      alert('Error al cambiar el estado');
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
      alert('✅ Campaña actualizada');
    } catch (err) {
      console.error('Error saving campaign:', err);
      alert('Error al guardar');
    } finally {
      setSavingCampaign(false);
    }
  };

  const sendTestEmail = async (campaignId) => {
    setSendingTestEmail(campaignId);
    try {
      const testEmail = prompt('Enviar email de prueba a:', 'tu@email.com');
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
        alert(`✅ Email enviado a ${testEmail}`);
        fetchEmailLogs();
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } catch (err) {
      alert(`❌ Error: ${err.message}`);
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
        alert(`✅ Email reenviado a ${log.email}`);
        fetchEmailLogs();
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } catch (err) {
      alert(`❌ Error: ${err.message}`);
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
  useEffect(() => { setOrdersPage(0); }, [debouncedSearchTerm, filterStatus]);
  useEffect(() => { setLookupPage(0); }, [debouncedLookupSearch, lookupSearchType]);

  const filteredSongs = useMemo(() => {
    const term = debouncedSearchTerm.toLowerCase();
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
      return matchesSearch && matchesFilter;
    });
  }, [songs, debouncedSearchTerm, filterStatus]);

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0f1419] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Cargando datos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1419] text-white">
      {/* Header */}
      <header className="bg-[#1a1f26] border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center text-xl">
              🎵
            </div>
            <div>
              <h1 className="font-bold text-lg">Admin Dashboard</h1>
              <p className="text-xs text-gray-400">RegalosQueCantan</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => fetchSongs()}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition"
              title="Refrescar"
            >
              <span className="material-symbols-outlined text-gray-400">refresh</span>
            </button>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              Salir
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
                <p className="font-semibold text-red-300">No se pudieron cargar los datos</p>
                <p className="text-sm text-red-200/80 mt-1">
                  Las estadísticas mostradas pueden no reflejar la realidad. Detalle: {error}
                </p>
              </div>
            </div>
            <button
              onClick={() => fetchSongs()}
              className="px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 text-sm font-medium whitespace-nowrap"
            >
              Reintentar
            </button>
          </div>
        )}
        {/* Audit-mode banner shown to assistants — keeps the "data is being
            recalculated" cover story consistent across the dashboard. */}
        {userRole && userRole !== 'admin' && (
          <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3 text-sm">
            <span className="text-amber-400">📊</span>
            <p className="text-amber-200/80">
              Datos financieros en auditoría — los montos se restablecerán cuando termine la revisión.
            </p>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-2xl p-5 border border-blue-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-blue-400 text-2xl">🎵</span>
              <span className="text-xs text-blue-400 bg-blue-500/20 px-2 py-1 rounded-full">Total</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalSongs}</p>
            <p className="text-sm text-gray-400">Canciones</p>
          </div>

          <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 rounded-2xl p-5 border border-green-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-green-400 text-2xl">💰</span>
              <span className="text-xs text-green-400 bg-green-500/20 px-2 py-1 rounded-full">Ingresos</span>
            </div>
            <p className="text-3xl font-bold">
              {userRole === 'admin'
                ? formatCurrency(stats.totalRevenue)
                : <span className="text-green-400 animate-pulse">Calculating...</span>}
            </p>
            <p className="text-sm text-gray-400">
              {userRole === 'admin'
                ? (stats.freeOrders > 0 && `${stats.freeOrders} gratis`)
                : 'auditando'}
            </p>
          </div>

          <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-2xl p-5 border border-emerald-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-emerald-400 text-2xl">✅</span>
              <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded-full">Pagadas</span>
            </div>
            <p className="text-3xl font-bold">{stats.paidOrders}</p>
            <p className="text-sm text-gray-400">Órdenes completadas</p>
          </div>
          
          <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 rounded-2xl p-5 border border-amber-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-amber-400 text-2xl">⏳</span>
              <span className="text-xs text-amber-400 bg-amber-500/20 px-2 py-1 rounded-full">Pendientes</span>
            </div>
            <p className="text-3xl font-bold">{stats.pendingOrders}</p>
            <p className="text-sm text-gray-400">Sin pagar</p>
          </div>
        </div>

        {/* WhatsApp Contacts Banner */}
        {stats.whatsappContacts > 0 && (
          <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-2xl p-4 mb-6 border border-green-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">💬</span>
                <div>
                  <p className="font-semibold text-green-400">WhatsApp Contacts</p>
                  <p className="text-sm text-gray-400">{stats.whatsappContacts} números únicos recopilados</p>
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
                  alert(`✅ ${contacts.length} contactos copiados al portapapeles (formato TSV)`);
                }}
                className="px-4 py-2 bg-green-500/20 text-green-400 rounded-xl text-sm font-medium hover:bg-green-500/30 transition border border-green-500/30"
              >
                📋 Exportar Contactos
              </button>
            </div>
          </div>
        )}

        {/* Today's Stats Banner */}
        {stats.todayOrders > 0 && (
          <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-2xl p-4 mb-6 border border-purple-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔥</span>
                <div>
                  <p className="font-semibold">Hoy</p>
                  <p className="text-sm text-gray-400">{stats.todayOrders} órdenes</p>
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

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-5 py-2.5 rounded-xl font-medium transition ${
              activeTab === 'orders' 
                ? 'bg-amber-400 text-black' 
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            📦 Órdenes
          </button>
          <button
            onClick={() => setActiveTab('funnel')}
            className={`px-5 py-2.5 rounded-xl font-medium transition ${
              activeTab === 'funnel' 
                ? 'bg-amber-400 text-black' 
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            📊 Funnel Analytics
          </button>
          <button
            onClick={() => { setActiveTab('emails'); fetchEmailLogs(); }}
            className={`px-5 py-2.5 rounded-xl font-medium transition ${
              activeTab === 'emails' 
                ? 'bg-amber-400 text-black' 
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            📧 Emails ({emailLogs.length})
          </button>
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
          <button
            onClick={() => setActiveTab('hotleads')}
            className={`px-5 py-2.5 rounded-xl font-medium transition relative ${
              activeTab === 'hotleads' 
                ? 'bg-orange-500 text-white' 
                : 'bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/30'
            }`}
          >
            🔥 Hot Leads
            {(() => {
              const count = (() => {
                const paidEmails = new Set(songs.filter(s => isPaid(s) && s.email).map(s => s.email.toLowerCase()));
                const leadsMap = {};
                songs.forEach(s => {
                  if (!s.whatsapp_phone || !s.recipient_name || !s.email) return;
                  if (paidEmails.has(s.email.toLowerCase())) return;
                  const key = s.whatsapp_phone;
                  if (!leadsMap[key]) leadsMap[key] = true;
                });
                return Object.keys(leadsMap).length;
              })();
              return count > 0 ? (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {count}
                </span>
              ) : null;
            })()}
          </button>
          <button
            onClick={() => setActiveTab('blast')}
            className={`px-5 py-2.5 rounded-xl font-medium transition ${
              activeTab === 'blast' 
                ? 'bg-rose-500 text-white' 
                : 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/30'
            }`}
          >
            💘 Valentine Blast
          </button>
          <button
            onClick={() => { setActiveTab('affiliates'); if (!affiliatesLoaded) fetchAffiliates(); }}
            className={`px-5 py-2.5 rounded-xl font-medium transition ${
              activeTab === 'affiliates'
                ? 'bg-blue-500 text-white'
                : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/30'
            }`}
          >
            🤝 Afiliados ({affiliates.length})
          </button>
        </div>

        {activeTab === 'orders' ? (
          <>
            {/* Filters */}
            <div className="bg-[#1a1f26] rounded-2xl p-4 mb-6 flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
                  <input 
                    type="text" 
                    placeholder="Buscar por nombre o email..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-amber-400/50"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                {[
                  { key: 'all', label: 'Todos', count: songs.length },
                  { key: 'paid', label: '✅ Pagados', count: stats.paidOrders },
                  { key: 'pending', label: '⏳ Pendientes', count: stats.pendingOrders }
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
              </div>
            </div>

            {/* Orders Table */}
            <div className="bg-[#1a1f26] rounded-2xl overflow-hidden border border-white/5">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/5 text-left">
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Fecha</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Cliente</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Canción</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Ocasión</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Voz</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Fuente</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Monto</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Estado</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Descarga</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredSongs.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="px-4 py-12 text-center text-gray-500">
                          No se encontraron órdenes
                        </td>
                      </tr>
                    ) : (
                      filteredSongs.slice(ordersPage * ORDERS_PER_PAGE, (ordersPage + 1) * ORDERS_PER_PAGE).map((song) => (
                        <tr key={song.id} className="hover:bg-white/5 transition">
                          <td className="px-4 py-3">
                            <span className="text-sm text-gray-300">{formatDate(song.created_at)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-white">{song.recipient_name || '—'}</p>
                              <p className="text-xs text-gray-500">de {song.sender_name || '—'}</p>
                              <p className="text-xs text-gray-500 truncate max-w-[180px]">{song.email}</p>
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
                              <p className="font-medium text-amber-400 capitalize">{song.genre || '—'}</p>
                              {song.sub_genre && (
                                <p className="text-xs text-gray-500">{song.sub_genre}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm">{formatOccasion(song.occasion)}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-lg" title={song.voice_type === 'female' ? 'Femenina' : 'Masculina'}>
                              {getVoiceLabel(song)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              {song.utm_source ? (
                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                                  song.utm_source === 'tiktok' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                                  song.utm_source === 'fb' || song.utm_source === 'facebook' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                  song.utm_source === 'ig' || song.utm_source === 'instagram' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                  song.utm_source === 'email' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                  song.utm_source === 'google' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                  'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                }`}>
                                  {song.utm_source === 'tiktok' ? '🎵 TikTok' :
                                   song.utm_source === 'fb' || song.utm_source === 'facebook' ? '📘 Facebook' :
                                   song.utm_source === 'ig' || song.utm_source === 'instagram' ? '📷 Instagram' :
                                   song.utm_source === 'email' ? '📧 Email' :
                                   song.utm_source === 'google' ? '🔍 Google' : `🔗 ${song.utm_source}`}
                                </span>
                              ) : !song.affiliate_code ? (
                                <span className="text-xs text-gray-600">directo</span>
                              ) : null}
                              {song.affiliate_code && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-pink-500/20 text-pink-400 border border-pink-500/30">
                                  🤝 {song.affiliate_code}
                                </span>
                              )}
                            </div>
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
                                ✓ Pagado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                ⏳ Pendiente
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isPaid(song) ? (
                              song.downloaded ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">
                                  ✓ {song.download_count > 1 ? `${song.download_count}x` : 'Sí'}
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
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button 
                                onClick={() => { setSelectedSong(song); if (!song._fullLoaded) fetchSongDetails(song.id); }} 
                                className="p-2 rounded-lg hover:bg-white/10 transition"
                                title="Ver detalles"
                              >
                                <span className="material-symbols-outlined text-gray-400 text-xl">visibility</span>
                              </button>
                              {song.audio_url && (
                                <>
                                  <a 
                                    href={song.audio_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="p-2 rounded-lg hover:bg-white/10 transition"
                                    title="Reproducir"
                                  >
                                    <span className="material-symbols-outlined text-amber-400 text-xl">play_circle</span>
                                  </a>
                                  <a 
                                    href={song.audio_url} 
                                    download 
                                    className="p-2 rounded-lg hover:bg-white/10 transition"
                                    title="Descargar"
                                  >
                                    <span className="material-symbols-outlined text-blue-400 text-xl">download</span>
                                  </a>
                                </>
                              )}
                              {/* WhatsApp delivery button - for paid songs with WhatsApp number */}
                              {isPaid(song) && song.whatsapp_phone && song.audio_url && (() => {
                                // Find all sibling songs from same purchase (same session_id or stripe_session_id)
                                const siblingsSongs = songs.filter(s => 
                                  s.id !== song.id && 
                                  isPaid(s) && 
                                  s.audio_url &&
                                  ((song.session_id && s.session_id === song.session_id) ||
                                   (song.stripe_session_id && s.stripe_session_id === song.stripe_session_id))
                                );
                                const allSongs = [song, ...siblingsSongs];
                                const songIds = allSongs.map(s => s.id).join(',');
                                const songPageUrl = `${window.location.origin}/song/${songIds}`;
                                const phone = song.whatsapp_phone.startsWith('1') ? song.whatsapp_phone : '1' + song.whatsapp_phone;
                                
                                const msg = `¡Hola! Tu canción personalizada para ${song.recipient_name || 'tu ser querido'} está lista. 🎵\n\nEscúchala aquí: ${songPageUrl}\n\nCuando quieras regalársela, solo reenvía este mensaje con el link. ¡Gracias por tu compra con RegalosQueCantan! 🎶`;
                                
                                return (
                                  <a
                                    href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 rounded-lg hover:bg-green-500/20 transition"
                                    title={`Enviar por WhatsApp a ${song.whatsapp_phone}`}
                                  >
                                    <span className="material-symbols-outlined text-green-400 text-xl">mail</span>
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
                      {filteredSongs.length > 0 ? `${start}–${end} de ${filteredSongs.length} órdenes` : '0 órdenes'}
                    </span>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setOrdersPage(p => Math.max(0, p - 1))}
                          disabled={ordersPage === 0}
                          className="px-3 py-1 rounded-lg text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          ← Anterior
                        </button>
                        <span className="text-sm text-gray-400">
                          Pág {ordersPage + 1} / {totalPages}
                        </span>
                        <button
                          onClick={() => setOrdersPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={ordersPage >= totalPages - 1}
                          className="px-3 py-1 rounded-lg text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          Siguiente →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </>
        ) : activeTab === 'funnel' ? (
          /* Funnel Analytics Tab */
          <div className="space-y-6">
            {/* Date Range Selector */}
            <div className="flex gap-2">
              {[
                { key: 'today', label: 'Hoy' },
                { key: '7days', label: '7 días' },
                { key: '14days', label: '14 días' },
                { key: '30days', label: '30 días' }
              ].map((range) => (
                <button
                  key={range.key}
                  onClick={() => setDateRange(range.key)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                    dateRange === range.key 
                      ? 'bg-amber-400 text-black' 
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  {range.label}
                </button>
              ))}
              <button
                onClick={fetchFunnelData}
                className="ml-auto px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 transition flex items-center gap-2"
              >
                🔄 Actualizar
              </button>
            </div>

            {/* Funnel Visualization */}
            <div className="bg-[#1a1f26] rounded-2xl p-6 border border-white/5">
              <h3 className="text-lg font-semibold mb-6">Funnel de Conversión</h3>
              <div className="space-y-3">
                {FUNNEL_STEPS.map((step, index) => {
                  const count = funnelData[step.key] || 0;
                  const maxCount = Math.max(...Object.values(funnelData), 1);
                  const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
                  const landingCount = funnelData['landing'] || funnelData['landing_v2'] || 1;
                  const conversionRate = landingCount > 0 ? ((count / landingCount) * 100).toFixed(1) : 0;
                  
                  // Calculate drop-off from previous step
                  const prevStep = FUNNEL_STEPS[index - 1];
                  const prevCount = prevStep ? (funnelData[prevStep.key] || 0) : count;
                  const dropOff = prevCount > 0 ? (((prevCount - count) / prevCount) * 100).toFixed(0) : 0;

                  return (
                    <div key={step.key} className="flex items-center gap-4">
                      <div className="w-28 text-sm text-gray-400 flex items-center gap-2">
                        <span>{step.icon}</span>
                        <span>{step.label}</span>
                      </div>
                      <div className="flex-1 h-10 bg-white/5 rounded-lg overflow-hidden relative">
                        <div 
                          className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg transition-all duration-500 flex items-center justify-end pr-3"
                          style={{ width: `${Math.max(percentage, 5)}%` }}
                        >
                          <span className="text-sm font-semibold text-white">
                            {count}
                          </span>
                        </div>
                      </div>
                      <div className="w-20 text-right">
                        <span className="text-sm text-gray-400">{conversionRate}%</span>
                      </div>
                      {index > 0 && dropOff > 0 && (
                        <div className="w-16 text-right">
                          <span className="text-xs text-red-400">-{dropOff}%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#1a1f26] rounded-2xl p-5 border border-white/5">
                <p className="text-gray-400 text-sm mb-1">Sesiones Únicas</p>
                <p className="text-3xl font-bold">{funnelData['landing'] || funnelData['landing_v2'] || 0}</p>
              </div>
              <div className="bg-[#1a1f26] rounded-2xl p-5 border border-white/5">
                <p className="text-gray-400 text-sm mb-1">Tasa de Conversión</p>
                <p className="text-3xl font-bold text-green-400">
                  {((funnelData['purchase'] || 0) / Math.max(funnelData['landing'] || funnelData['landing_v2'] || 1, 1) * 100).toFixed(1)}%
                </p>
              </div>
              <div className="bg-[#1a1f26] rounded-2xl p-5 border border-white/5">
                <p className="text-gray-400 text-sm mb-1">Mayor Drop-off</p>
                <p className="text-xl font-bold text-red-400">
                  {(() => {
                    let maxDrop = 0;
                    let maxDropStep = '';
                    FUNNEL_STEPS.forEach((step, i) => {
                      if (i === 0) return;
                      const prev = FUNNEL_STEPS[i - 1];
                      const prevCount = funnelData[prev.key] || 0;
                      const currCount = funnelData[step.key] || 0;
                      const drop = prevCount > 0 ? ((prevCount - currCount) / prevCount) * 100 : 0;
                      if (drop > maxDrop) {
                        maxDrop = drop;
                        maxDropStep = `${prev.label} → ${step.label}`;
                      }
                    });
                    return maxDropStep || 'N/A';
                  })()}
                </p>
              </div>
            </div>
          </div>
        ) : activeTab === 'emails' ? (
          /* Emails Tab - Clean & Simple with Enhanced Features */
          <div className="space-y-8">
            
            {/* Section 1: Email Campaigns */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">📬 Campañas de Email</h2>
                <button
                  onClick={fetchEmailCampaigns}
                  className="text-sm text-gray-400 hover:text-white transition"
                >
                  🔄 Actualizar
                </button>
              </div>
              
              <div className="grid gap-4">
                {emailCampaigns.length === 0 ? (
                  <div className="bg-[#1a1f26] rounded-2xl p-8 text-center border border-white/5">
                    <p className="text-gray-500">Cargando campañas...</p>
                  </div>
                ) : (
                  emailCampaigns.map((campaign) => {
                    const conversions = getCampaignConversions(campaign.id);
                    return (
                      <div 
                        key={campaign.id} 
                        className={`bg-[#1a1f26] rounded-2xl p-6 border transition ${
                          campaign.enabled ? 'border-green-500/30' : 'border-white/5 opacity-60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          {/* Campaign Info */}
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">
                                {campaign.id === 'purchase_confirmation' ? '✅' : 
                                 campaign.id === 'abandoned_15min' ? '⚡' :
                                 campaign.id === 'abandoned_1hr' ? '⏰' : '⚠️'}
                              </span>
                              <div>
                                <h3 className="font-semibold text-white">{campaign.name}</h3>
                                <p className="text-xs text-gray-500">{campaign.description}</p>
                              </div>
                            </div>
                            
                            {/* Subject Preview */}
                            <div className="bg-white/5 rounded-lg p-3 mt-3">
                              <p className="text-xs text-gray-500 mb-1">Asunto:</p>
                              <p className="text-sm text-amber-400">{campaign.subject}</p>
                            </div>
                            
                            {/* Stats with Conversion Rate */}
                            <div className="flex items-center gap-4 mt-3 text-xs">
                              <span className="text-gray-500">📧 {conversions.sent} enviados</span>
                              {campaign.id !== 'purchase_confirmation' && (
                                <span className={`${conversions.rate > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                                  💰 {conversions.converted} convertidos ({conversions.rate}%)
                                </span>
                              )}
                              {campaign.delay_hours > 0 && (
                                <span className="text-gray-500">⏱️ Se envía a las {campaign.delay_hours}h</span>
                              )}
                            </div>
                          </div>
                          
                          {/* Actions */}
                          <div className="flex flex-col gap-2">
                            {/* On/Off Toggle */}
                            <button
                              onClick={() => toggleCampaign(campaign.id, campaign.enabled)}
                              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                                campaign.enabled 
                                  ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                                  : 'bg-white/5 text-gray-500 border border-white/10'
                              }`}
                            >
                              {campaign.enabled ? '✓ Activa' : '○ Pausada'}
                            </button>
                            
                            {/* Preview Button */}
                            <button
                              onClick={() => setPreviewingCampaign(campaign)}
                              className="px-4 py-2 rounded-lg text-sm bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition"
                            >
                              👁️ Preview
                            </button>
                            
                            {/* Edit Button */}
                            <button
                              onClick={() => setEditingCampaign({...campaign})}
                              className="px-4 py-2 rounded-lg text-sm bg-white/5 text-gray-400 hover:bg-white/10 transition"
                            >
                              ✏️ Editar
                            </button>
                            
                            {/* Test Button */}
                            <button
                              onClick={() => sendTestEmail(campaign.id)}
                              disabled={sendingTestEmail === campaign.id}
                              className="px-4 py-2 rounded-lg text-sm bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition disabled:opacity-50"
                            >
                              {sendingTestEmail === campaign.id ? '⏳...' : '🧪 Test'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            
            {/* Section 2: Email History with Filters */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">📨 Historial de Emails</h2>
                <span className="text-sm text-gray-500">{filteredEmailLogs.length} de {emailLogs.length} emails</span>
              </div>
              
              {/* Filters */}
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  { key: 'all', label: 'Todos', count: emailLogs.length },
                  { key: 'purchase_confirmation', label: '✅ Confirmaciones', count: emailLogs.filter(e => e.email_type === 'purchase_confirmation').length },
                  { key: 'abandoned_15min', label: '⚡ 15min', count: emailLogs.filter(e => e.email_type === 'abandoned_15min').length },
                  { key: 'abandoned_1hr', label: '⏰ 1hr', count: emailLogs.filter(e => e.email_type === 'abandoned_1hr').length },
                  { key: 'abandoned_24hr', label: '⚠️ 24hr', count: emailLogs.filter(e => e.email_type === 'abandoned_24hr').length },
                  { key: 'failed', label: '❌ Fallidos', count: emailLogs.filter(e => e.status === 'failed').length }
                ].map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setEmailFilter(filter.key)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition ${
                      emailFilter === filter.key
                        ? 'bg-amber-400 text-black font-medium'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {filter.label} ({filter.count})
                  </button>
                ))}
              </div>
              
              <div className="bg-[#1a1f26] rounded-2xl overflow-hidden border border-white/5">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/5 text-left text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Para</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredEmailLogs.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="px-4 py-8 text-center text-gray-500">
                          No hay emails {emailFilter !== 'all' ? 'con este filtro' : 'enviados todavía'}
                        </td>
                      </tr>
                    ) : (
                      filteredEmailLogs.slice(0, 30).map((log) => (
                        <tr key={log.id} className="hover:bg-white/5">
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {formatDate(log.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full ${getEmailTypeColor(log.email_type)}`}>
                              {getEmailTypeLabel(log.email_type)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm text-white">{log.recipient_name || '—'}</p>
                            <p className="text-xs text-gray-500">{log.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            {log.status === 'sent' ? (
                              <span className="text-green-400 text-sm">✓ Enviado</span>
                            ) : (
                              <span className="text-red-400 text-sm">✗ Error</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {log.status === 'failed' && log.song_id && (
                              <button
                                onClick={() => resendEmail(log)}
                                disabled={resendingEmail === log.id}
                                className="px-3 py-1 rounded-lg text-xs bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition disabled:opacity-50"
                              >
                                {resendingEmail === log.id ? '⏳' : '🔄 Reenviar'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {filteredEmailLogs.length > 30 && (
                  <div className="px-4 py-3 bg-white/5 text-center">
                    <span className="text-sm text-gray-500">Mostrando últimos 30 de {filteredEmailLogs.length}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'lookup' ? (
          /* Customer Lookup Tab */
          <div className="space-y-4">
            {/* Search/Filter Bar */}
            <div className="bg-[#1a1f26] rounded-2xl p-4 flex flex-col md:flex-row gap-3">
              <div className="flex gap-2">
                {[
                  { value: 'all', label: 'Todos' },
                  { value: 'email', label: '📧 Email' },
                  { value: 'name', label: '👤 Nombre' },
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
                  placeholder="Buscar por email, nombre, o ID..."
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
              const lookupFiltered = (() => {
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
                    {debouncedLookupSearch
                      ? `${lookupFiltered.length} resultado${lookupFiltered.length !== 1 ? 's' : ''} para "${debouncedLookupSearch}"`
                      : `${lookupFiltered.length} canciones totales`
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
                                🎵 {song.recipient_name || 'Sin nombre'}
                                {song.sender_name && (
                                  <span className="text-gray-500 font-normal text-sm"> ← {song.sender_name}</span>
                                )}
                              </h3>
                              <p className="text-xs text-gray-500 mt-1">
                                {song.email || 'Sin email'}
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
                              {paid ? '✓ Pagada' : hasAudio ? '⏳ Sin pago' : '🔄 Generando'}
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
                                {copiedLinkId === `preview-${song.id}` ? '✅ ¡Copiado!' : '🎧 Preview Link'}
                              </button>
                              <button
                                onClick={() => { navigator.clipboard.writeText(successLink); setCopiedLinkId(`success-${song.id}`); setTimeout(() => setCopiedLinkId(null), 2000); }}
                                className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-semibold transition ${
                                  copiedLinkId === `success-${song.id}`
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20'
                                }`}
                              >
                                {copiedLinkId === `success-${song.id}` ? '✅ ¡Copiado!' : '📥 Download Link'}
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
                                {copiedLinkId === `polaroid-${song.id}` ? '✅ ¡Copiado!' : '🎨 Polaroid Page'}
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
                                  {copiedLinkId === `combo-preview-${song.id}` ? '✅ ¡Copiado!' : `📦 Both Preview (${pairSongs.length + 1})`}
                                </button>
                                <button
                                  onClick={() => { navigator.clipboard.writeText(combinedSuccessLink); setCopiedLinkId(`combo-success-${song.id}`); setTimeout(() => setCopiedLinkId(null), 2000); }}
                                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition ${
                                    copiedLinkId === `combo-success-${song.id}`
                                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                      : 'bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20'
                                  }`}
                                >
                                  {copiedLinkId === `combo-success-${song.id}` ? '✅ ¡Copiado!' : `📦 Both Download (${pairSongs.length + 1})`}
                                </button>
                              </div>
                            );
                          })()}

                          {/* Quick open + detail */}
                          <div className="flex items-center justify-between mt-2">
                            {hasAudio && (
                              <div className="flex gap-3">
                                <a href={previewLink} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-amber-400 underline">
                                  Abrir preview ↗
                                </a>
                                <a href={successLink} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-blue-400 underline">
                                  Abrir success ↗
                                </a>
                                <a href={polaroidLink} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-pink-400 underline">
                                  Abrir polaroid ↗
                                </a>
                              </div>
                            )}
                            <button
                              onClick={() => { setSelectedSong(song); if (!song._fullLoaded) fetchSongDetails(song.id); }}
                              className="text-xs text-gray-500 hover:text-white underline ml-auto"
                            >
                              Ver detalles
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
                          <span className="text-sm text-gray-500">{lStart}–{lEnd} de {lookupFiltered.length}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setLookupPage(p => Math.max(0, p - 1))}
                              disabled={lookupPage === 0}
                              className="px-3 py-1 rounded-lg text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              ← Anterior
                            </button>
                            <span className="text-sm text-gray-400">Pág {lookupPage + 1} / {totalLookupPages}</span>
                            <button
                              onClick={() => setLookupPage(p => Math.min(totalLookupPages - 1, p + 1))}
                              disabled={lookupPage >= totalLookupPages - 1}
                              className="px-3 py-1 rounded-lg text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              Siguiente →
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                    {lookupFiltered.length === 0 && (
                      <div className="text-center py-12 bg-[#1a1f26] rounded-2xl">
                        <p className="text-3xl mb-3">🔍</p>
                        <p className="text-gray-500">No se encontraron canciones{debouncedLookupSearch ? ` para "${debouncedLookupSearch}"` : ''}</p>
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
              if (mins < 60) return `hace ${mins}m`;
              const hrs = Math.floor(mins / 60);
              if (hrs < 24) return `hace ${hrs}h`;
              const days = Math.floor(hrs / 24);
              return `hace ${days}d`;
            };

            // Heat level based on recency
            const getHeatLevel = (dateStr) => {
              const hrs = (Date.now() - new Date(dateStr).getTime()) / 3600000;
              if (hrs < 1) return { label: 'CALIENTE', color: 'bg-red-500', emoji: '🔥🔥🔥' };
              if (hrs < 6) return { label: 'MUY CALIENTE', color: 'bg-orange-500', emoji: '🔥🔥' };
              if (hrs < 24) return { label: 'TIBIO', color: 'bg-yellow-500', emoji: '🔥' };
              if (hrs < 72) return { label: 'FRÍO', color: 'bg-blue-400', emoji: '❄️' };
              return { label: 'VIEJO', color: 'bg-gray-500', emoji: '💤' };
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
                        <p className="text-sm text-gray-400">Dieron WhatsApp, crearon canciones, pero NO compraron</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold text-orange-400">{leads.length}</p>
                      <p className="text-xs text-gray-500">leads sin convertir</p>
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
                      <p className="text-xs text-gray-500">Ingreso potencial</p>
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-lg font-bold text-yellow-400">{leads.reduce((sum, l) => sum + l.songs.length, 0)}</p>
                      <p className="text-xs text-gray-500">Canciones generadas</p>
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-lg font-bold text-blue-400">{leads.filter(l => (Date.now() - new Date(l.latestDate).getTime()) < 86400000).length}</p>
                      <p className="text-xs text-gray-500">Últimas 24hrs</p>
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
                      Más recientes
                    </button>
                    <button
                      onClick={() => setHotLeadSort('oldest')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        hotLeadSort === 'oldest' ? 'bg-orange-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      Más antiguos
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
                      alert(`✅ ${leads.length} leads copiados (CSV)`);
                    }}
                    className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm font-medium hover:bg-white/10 transition border border-white/10"
                  >
                    📋 Exportar CSV
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
                                    {lead.senderName || 'Sin nombre'}
                                  </p>
                                  <p className="text-sm text-gray-400">
                                    Para: <span className="text-amber-400 font-medium">{mainSong?.recipient_name}</span>
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
                                <p className="text-[10px] text-gray-500 uppercase">Género</p>
                                <p className="text-sm font-medium text-amber-400 capitalize">{[...lead.genres].join(', ') || '—'}</p>
                              </div>
                              <div className="bg-white/5 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase">Canciones</p>
                                <p className="text-sm font-medium">{lead.songs.length} generada{lead.songs.length !== 1 ? 's' : ''}</p>
                              </div>
                            </div>

                            {/* Song preview links */}
                            {lead.songs.filter(s => s.audio_url).length > 0 && (
                              <div className="mb-3 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2">
                                <p className="text-[10px] text-amber-400 uppercase font-bold mb-1">🎵 Canciones listas para escuchar:</p>
                                <div className="flex flex-wrap gap-1">
                                  {lead.songs.filter(s => s.audio_url).map((s, i) => (
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
                                      {copiedLinkId === s.id ? '✅ Copiado!' : `🎧 Canción ${i + 1}`}
                                    </button>
                                  ))}
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
                                💬 Enviar WhatsApp
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
                                {copiedMessageId === lead.phone ? '✅ Copiado' : '📋 Copiar Mensaje'}
                              </button>
                              {/* View song detail */}
                              <button
                                onClick={() => setSelectedSong(mainSong)}
                                className="px-4 py-2.5 bg-white/5 text-gray-400 rounded-xl font-medium text-sm hover:bg-white/10 transition border border-white/10"
                              >
                                👁️ Ver
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
                    <p className="text-xl font-bold text-green-400 mb-2">¡No hay leads pendientes!</p>
                    <p className="text-gray-500">Todos los contactos con WhatsApp ya compraron</p>
                  </div>
                )}
              </div>
            );
          })()
        ) : activeTab === 'blast' ? (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-rose-900/30 to-pink-900/30 rounded-2xl p-6 border border-rose-500/20">
              <h2 className="text-2xl font-bold text-white mb-2">💘 Valentine's Day Email Blast</h2>
              <p className="text-gray-400">Send a FOMO email to all leads who gave their email but didn't purchase. Safe to run multiple times — each lead only receives it once.</p>
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <button
                onClick={async () => {
                  setBlastStatus('loading');
                  setBlastData(null);
                  try {
                    // Query unpaid songs directly — no edge function needed
                    const { data: unpaidSongs, error: e1 } = await supabase
                      .from('songs')
                      .select('id, email, recipient_name, genre_name')
                      .eq('paid', false)
                      .not('email', 'is', null)
                      .not('email', 'eq', '')
                      .or('valentine_blast_sent.is.null,valentine_blast_sent.eq.false');
                    if (e1) throw e1;

                    const { data: paidSongs, error: e2 } = await supabase
                      .from('songs')
                      .select('email')
                      .eq('paid', true)
                      .not('email', 'is', null);
                    if (e2) throw e2;

                    const paidEmails = new Set((paidSongs || []).map(s => s.email.toLowerCase().trim()));
                    const emailMap = {};
                    for (const song of (unpaidSongs || [])) {
                      const em = song.email.toLowerCase().trim();
                      if (!paidEmails.has(em) && !emailMap[em]) {
                        emailMap[em] = { email: song.email, recipientName: song.recipient_name || '', songIds: [song.id] };
                      } else if (emailMap[em]) {
                        emailMap[em].songIds.push(song.id);
                      }
                    }
                    const recipients = Object.values(emailMap);
                    setBlastData({
                      dryRun: true,
                      recipientCount: recipients.length,
                      excludedPaidCount: paidEmails.size,
                      recipients: recipients.map(r => ({ email: r.email, recipientName: r.recipientName })),
                      _recipients: recipients // keep full data for send
                    });
                    setBlastStatus('preview');
                  } catch (err) {
                    setBlastData({ error: err.message });
                    setBlastStatus('done');
                  }
                }}
                disabled={blastStatus === 'loading' || blastStatus === 'sending'}
                className="px-6 py-3 bg-white/10 text-white rounded-xl font-semibold hover:bg-white/20 transition disabled:opacity-50"
              >
                {blastStatus === 'loading' ? '⏳ Loading...' : '👀 Preview Recipients'}
              </button>

              <button
                onClick={async () => {
                  const recipients = blastData?._recipients;
                  if (!recipients?.length) return;
                  if (!confirm(`Are you sure you want to send the Valentine blast to ${recipients.length} leads? This cannot be undone.`)) return;
                  setBlastStatus('sending');
                  
                  let sent = 0;
                  let failed = 0;
                  const errors = [];
                  const subject = '\u{1F498} San Valent\u00EDn es MA\u00D1ANA \u2014 \u00BFYa tienes el regalo perfecto?';
                  
                  for (const recipient of recipients) {
                    try {
                      const html = buildValentineBlastEmail(recipient.recipientName);
                      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-purchase-email`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
                        },
                        body: JSON.stringify({ customHtml: html, customSubject: subject, email: recipient.email })
                      });
                      const result = await res.json();
                      if (result.success) {
                        sent++;
                        // Mark songs so they don't get blasted again
                        await supabase.from('songs')
                          .update({ valentine_blast_sent: true })
                          .in('id', recipient.songIds);
                      } else {
                        failed++;
                        errors.push(`${recipient.email}: ${result.error || 'Failed'}`);
                      }
                    } catch (err) {
                      failed++;
                      errors.push(`${recipient.email}: ${err.message}`);
                    }
                    // Small delay between sends
                    await new Promise(r => setTimeout(r, 200));
                  }
                  
                  setBlastData({ sent, failed, total: recipients.length, errors: errors.length ? errors : undefined });
                  setBlastStatus('done');
                }}
                disabled={blastStatus !== 'preview' || !blastData?.recipientCount}
                className="px-6 py-3 bg-rose-500 text-white rounded-xl font-bold hover:bg-rose-600 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {blastStatus === 'sending' ? '🚀 Sending...' : `🚀 Send Blast${blastData?.recipientCount ? ` (${blastData.recipientCount} leads)` : ''}`}
              </button>

              {blastStatus && (
                <button
                  onClick={() => { setBlastStatus(null); setBlastData(null); }}
                  className="px-4 py-3 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 transition"
                >
                  🔄 Reset
                </button>
              )}
            </div>

            {/* Results */}
            {blastData && (
              <div className="bg-[#1a1f26] rounded-2xl p-6 border border-white/5">
                {blastData.error ? (
                  <div className="text-red-400">
                    <p className="font-bold text-lg mb-2">❌ Error</p>
                    <p className="font-mono text-sm">{blastData.error}</p>
                  </div>
                ) : blastData.dryRun ? (
                  <>
                    <div className="flex gap-6 mb-6">
                      <div className="bg-rose-500/10 rounded-xl p-4 flex-1 text-center border border-rose-500/20">
                        <p className="text-3xl font-bold text-rose-400">{blastData.recipientCount}</p>
                        <p className="text-gray-400 text-sm mt-1">Leads to email</p>
                      </div>
                      <div className="bg-green-500/10 rounded-xl p-4 flex-1 text-center border border-green-500/20">
                        <p className="text-3xl font-bold text-green-400">{blastData.excludedPaidCount}</p>
                        <p className="text-gray-400 text-sm mt-1">Paid (excluded)</p>
                      </div>
                    </div>
                    <p className="text-white font-semibold mb-3">📋 Recipient List:</p>
                    <div className="max-h-80 overflow-y-auto space-y-1">
                      {blastData.recipients?.map((r, i) => (
                        <div key={i} className="flex justify-between items-center bg-white/3 px-4 py-2 rounded-lg text-sm">
                          <span className="text-gray-300">{r.email}</span>
                          <span className="text-rose-400 text-xs">{r.recipientName ? `Para: ${r.recipientName}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-4xl mb-3">{blastData.failed === 0 ? '🎉' : '⚠️'}</p>
                    <p className="text-2xl font-bold text-white mb-2">Blast Complete!</p>
                    <div className="flex gap-6 justify-center mt-4">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-green-400">{blastData.sent}</p>
                        <p className="text-gray-400 text-sm">Sent ✅</p>
                      </div>
                      <div className="text-center">
                        <p className="text-3xl font-bold text-red-400">{blastData.failed}</p>
                        <p className="text-gray-400 text-sm">Failed ❌</p>
                      </div>
                    </div>
                    {blastData.errors && (
                      <div className="mt-4 text-left bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                        <p className="text-red-400 font-semibold text-sm mb-2">Errors:</p>
                        {blastData.errors.map((e, i) => (
                          <p key={i} className="text-red-300 text-xs font-mono">{e}</p>
                        ))}
                      </div>
                    )}
                    <p className="text-gray-500 text-sm mt-4">Run again later to catch new leads — already-sent leads are skipped.</p>
                  </div>
                )}
              </div>
            )}

            {/* Info */}
            <div className="bg-[#1a1f26] rounded-2xl p-5 border border-white/5">
              <p className="text-gray-400 text-sm leading-relaxed">
                <strong className="text-white">How it works:</strong> Queries all emails from the songs table where paid=false, 
                excludes anyone who already purchased, and excludes anyone who was already sent this blast. 
                Subject: "💘 San Valentín es MAÑANA — ¿Ya tienes el regalo perfecto?" • 
                CTA links to /v2 (standard pricing) • Personalized with recipient name when available.
              </p>
            </div>
          </div>
        ) : activeTab === 'affiliates' ? (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-900/30 to-indigo-900/30 rounded-2xl p-6 border border-blue-500/20">
              <h2 className="text-2xl font-bold text-white mb-2">🤝 Programa de Afiliados</h2>
              <p className="text-gray-400">Agrega afiliados y les llega un email de bienvenida con sus credenciales y link.</p>
            </div>

            {/* Add New Affiliate Form */}
            <div className="bg-[#1a1f26] rounded-2xl p-6 border border-white/5">
              <h3 className="text-white font-semibold mb-4">Agregar nuevo afiliado</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Nombre completo *</label>
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
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Código de afiliado * <span className="text-gray-600">(se usa en ?ref=CODE)</span></label>
                  <input
                    type="text"
                    placeholder="maria20"
                    value={newAffiliate.code}
                    onChange={e => setNewAffiliate(p => ({ ...p, code: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:border-blue-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Contraseña * <span className="text-gray-600">(para su portal)</span></label>
                  <input
                    type="text"
                    placeholder="password123"
                    value={newAffiliate.password}
                    onChange={e => setNewAffiliate(p => ({ ...p, password: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:border-blue-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Código de descuento <span className="text-gray-600">(opcional, se crea automático)</span></label>
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
                {creatingAffiliate ? '⏳ Creando...' : '➕ Crear afiliado y enviar email'}
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
                { label: 'Afiliados', value: affiliates.length, color: 'blue' },
                { label: 'Clicks totales', value: totals.visits.toLocaleString(), color: 'gray' },
                { label: 'Ventas totales', value: totals.sales, color: 'green' },
                { label: 'Comisión total', value: isAdmin ? `$${totals.commission.toFixed(2)}` : calculating, color: 'emerald' },
                { label: 'Por pagar', value: isAdmin ? `$${owed.toFixed(2)}` : calculating, color: isAdmin && owed > 0 ? 'amber' : 'gray' },
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
                <h3 className="text-white font-semibold">Afiliados ({affiliates.length})</h3>
                <button onClick={fetchAffiliates} className="text-xs text-gray-400 hover:text-white transition">🔄 Refrescar</button>
              </div>
              {affiliates.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  {affiliatesLoaded ? 'No hay afiliados registrados todavía' : '⏳ Cargando...'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-xs uppercase border-b border-white/5">
                        <th className="text-left px-4 py-3">Afiliado</th>
                        <th className="text-left px-4 py-3">Código / Cupón</th>
                        <th className="text-right px-4 py-3">Clicks</th>
                        <th className="text-right px-4 py-3">Ventas</th>
                        <th className="text-right px-4 py-3">Conv.</th>
                        <th className="text-right px-4 py-3">Comisión</th>
                        <th className="text-right px-4 py-3">Pagado</th>
                        <th className="text-right px-4 py-3">Por pagar</th>
                        <th className="text-left px-4 py-3">Última venta</th>
                        <th className="text-left px-4 py-3">Estado</th>
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
                              {s.lastSale ? (
                                <div>
                                  <div className="text-gray-300">{s.lastSale.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</div>
                                  <div className={`text-xs ${daysSinceLastSale > 30 ? 'text-red-400' : daysSinceLastSale > 14 ? 'text-amber-400' : 'text-green-400'}`}>
                                    {daysSinceLastSale === 0 ? 'Hoy' : daysSinceLastSale === 1 ? 'Ayer' : `hace ${daysSinceLastSale}d`}
                                  </div>
                                </div>
                              ) : <span className="text-gray-600">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                {a.active ? 'Activo' : 'Inactivo'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>

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
                <h3 className="font-bold text-white">👁️ Vista Previa del Email</h3>
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
              <h3 className="text-xl font-bold">✏️ Editar Campaña</h3>
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
                  <label className="block text-sm text-gray-400 mb-1">⏱️ Enviar después de (horas)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="72"
                      value={editingCampaign.delay_hours}
                      onChange={(e) => setEditingCampaign({...editingCampaign, delay_hours: parseInt(e.target.value) || 1})}
                      className="w-24 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-amber-400 text-center"
                    />
                    <span className="text-gray-500 text-sm">horas después de crear la canción</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    {editingCampaign.id === 'abandoned_1hr' ? 'Recomendado: 1-2 horas' : 'Recomendado: 12-24 horas'}
                  </p>
                </div>
              )}
              
              {/* Subject */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Asunto del Email</label>
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
                <label className="block text-sm text-gray-400 mb-1">Título Principal</label>
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
                <label className="block text-sm text-gray-400 mb-1">Texto del Mensaje</label>
                <textarea
                  value={editingCampaign.body_text}
                  onChange={(e) => setEditingCampaign({...editingCampaign, body_text: e.target.value})}
                  rows={3}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-amber-400 resize-none"
                  placeholder="La canción para {{recipient_name}} está esperándote..."
                />
                <p className="text-xs text-gray-500 mt-1">Usa {'{{recipient_name}}'} para el nombre del destinatario</p>
              </div>
              
              {/* Button Text */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Texto del Botón</label>
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
                Cancelar
              </button>
              <button
                onClick={() => saveCampaign(editingCampaign)}
                disabled={savingCampaign}
                className="flex-1 px-4 py-3 rounded-xl bg-amber-400 text-black font-semibold hover:bg-amber-300 transition disabled:opacity-50"
              >
                {savingCampaign ? '⏳ Guardando...' : '✓ Guardar'}
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
              <h2 className="text-xl font-bold">Detalles de la Orden</h2>
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
                    ✓ Pagado — {userRole === 'admin'
                      ? formatCurrency(getSongPrice(selectedSong))
                      : <span className="animate-pulse">Calculating...</span>}
                  </span>
                ) : (
                  <span className="px-4 py-2 rounded-full font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    ⏳ Pendiente
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
                        <p className="font-medium">{selectedSong.downloaded ? 'Descargado' : 'No descargado'}</p>
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
                  <span className="text-purple-400 text-sm">🎟️ Cupón: <strong>{selectedSong.coupon_code}</strong></span>
                </div>
              )}
              
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Para</p>
                  <p className="font-semibold">{selectedSong.recipient_name || '—'}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">De</p>
                  <p className="font-semibold">{selectedSong.sender_name || '—'}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Género</p>
                  <p className="font-semibold capitalize text-amber-400">{selectedSong.genre || '—'}</p>
                  {selectedSong.sub_genre && <p className="text-xs text-gray-500">{selectedSong.sub_genre}</p>}
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Ocasión</p>
                  <p className="font-semibold">{formatOccasion(selectedSong.occasion)}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Voz</p>
                  <p className="font-semibold">{selectedSong.voice_type === 'female' ? '♀️ Femenina' : '♂️ Masculina'}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Relación</p>
                  <p className="font-semibold capitalize">{selectedSong.relationship || '—'}</p>
                </div>
              </div>
              
              {/* Email */}
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Email</p>
                <p className="font-semibold">{selectedSong.email}</p>
              </div>

              {/* WhatsApp */}
              {selectedSong.whatsapp_phone && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                  <p className="text-xs text-green-400 mb-2">💬 WhatsApp</p>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-lg">
                      {selectedSong.whatsapp_phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
                    </p>
                    <div className="flex gap-2">
                      <a
                        href={`https://wa.me/${selectedSong.whatsapp_phone.startsWith('1') ? selectedSong.whatsapp_phone : '1' + selectedSong.whatsapp_phone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:bg-[#20bd5a] transition flex items-center gap-2"
                      >
                        💬 Abrir Chat
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedSong.whatsapp_phone);
                          alert('Número copiado!');
                        }}
                        className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-medium hover:bg-white/20 transition"
                      >
                        📋 Copiar
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Details */}
              {selectedSong.details && (
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-2">Detalles</p>
                  <p className="text-sm whitespace-pre-wrap">{selectedSong.details}</p>
                </div>
              )}
              
              {/* Lyrics */}
              {selectedSong.lyrics && (
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-2">Letra</p>
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
                      ⬇️ Descargar MP3
                    </a>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(selectedSong.audio_url);
                        alert('URL copiada!');
                      }}
                      className="py-2 px-4 bg-white/10 text-white rounded-lg font-medium text-sm hover:bg-white/20 transition"
                    >
                      📋 Copiar URL
                    </button>
                  </div>
                </div>
              )}
              
              {/* Customer Links */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                <p className="text-xs text-blue-400 mb-2">🔗 Links del cliente</p>
                
                {/* Preview Link */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1">🎧 Preview (20s + compra):</p>
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
                        alert('Preview link copiado!');
                      }}
                      className="px-4 py-2 bg-amber-500 text-black rounded-lg text-sm font-medium hover:bg-amber-400 transition"
                    >
                      Copiar
                    </button>
                  </div>
                </div>

                {/* Success Link */}
                <div>
                  <p className="text-xs text-gray-500 mb-1">📥 Download (canción completa):</p>
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
                        alert('Download link copiado!');
                      }}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-400 transition"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>

              {/* Polaroid Shareable Page Link */}
              <div className="bg-pink-500/10 border border-pink-500/20 rounded-xl p-4">
                <p className="text-xs text-pink-400 mb-2">🎨 Página Compartible (Polaroid)</p>
                <p className="text-xs text-gray-500 mb-2">Este link muestra la canción en una página bonita para compartir por WhatsApp</p>
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
                      alert('Polaroid link copiado!');
                    }}
                    className="px-4 py-2 bg-pink-500 text-white rounded-lg text-sm font-medium hover:bg-pink-400 transition"
                  >
                    Copiar
                  </button>
                  <a
                    href={`${window.location.origin}/song/${selectedSong.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-medium hover:bg-white/20 transition"
                  >
                    👁️ Ver
                  </a>
                </div>
              </div>
              
              {/* Song ID */}
              <p className="text-center text-xs text-gray-600 font-mono">ID: {selectedSong.id}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
